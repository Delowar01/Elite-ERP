import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  accountsTable,
  inventoryMovementsTable,
  journalEntriesTable,
  journalLinesTable,
  productsTable,
  type InventoryMovementKind,
  type Tx,
} from "@/db";
import { getCurrency, roundMoney } from "@/lib/currency/currencies";

/**
 * ACC-01 — weighted-average inventory costing. The ONE place stock quantities and their cost move.
 *
 * Every posting path that touches stock calls in here, inside its own transaction, so a document,
 * its journal entry, its stock movements and the products' running state commit or roll back as
 * one. Nothing here opens a transaction of its own.
 *
 * ## The model
 *
 * Each stock product carries a weighted-average pool: `valued_quantity` units worth `stock_value`
 * in the base currency. Receipts and opening stock add units AT THEIR COST; issues, purchase
 * returns and decreases take units out at the pool's average (`stock_value / valued_quantity`), and
 * the unit that empties the pool takes exactly what is left, so no residue ever sits on zero
 * units. An outflow never changes the average of the units that stay. A customer's returned goods
 * come back at the cost their sale issued them at (the return of that sale). A reversal puts back
 * exactly what its original took out, at the original's cost.
 *
 * ## What is refused, and what is recorded as incomplete instead
 *
 * - **Negative stock is refused.** An outflow larger than the physical quantity on hand never
 *   posts; WAC on a negative pool has no meaning, and the error names the product and both counts.
 * - **Fractional stock is refused.** Stock is counted in whole units (`quantity_on_hand` is an
 *   integer); the old code truncated 2.5 to 2 silently.
 * - **Stock without a cost basis is never valued at zero.** Units added from now on always carry a
 *   cost (a purchase price, or a cost the user entered). Units that existed before ACC-01 have
 *   none: they are the gap `quantity_on_hand − valued_quantity`. Issuing them is allowed — the
 *   sale happened — but it writes an explicitly UNCOSTED movement (cost null), posts no COGS for
 *   it, and the valuation report lists it.
 * - **Services carry no stock.** Their lines are skipped by every stock path.
 *
 * Refusals throw `InventoryRefusal` inside the caller's transaction; the caller returns its message
 * in the session's language.
 */

/** A refusal the caller shows the user; thrown inside the caller's transaction so nothing commits. */
export class InventoryRefusal extends Error {
  readonly ar: string;
  constructor(en: string, ar: string) {
    super(en);
    this.name = "InventoryRefusal";
    this.ar = ar;
  }
}

/**
 * Whether `e` is an InventoryRefusal — by its name and its Arabic text as well as by class, so the
 * check holds even when the module is loaded twice (a test runner reaching it through both a
 * relative path and the `@/` alias gives two copies of the class, and `instanceof` fails across them).
 */
export function isInventoryRefusal(e: unknown): e is InventoryRefusal {
  return e instanceof InventoryRefusal
    || (e instanceof Error && e.name === "InventoryRefusal" && typeof (e as { ar?: unknown }).ar === "string");
}

/** A refusal's message in the session's language. */
export function refusalText(e: InventoryRefusal, locale: "en" | "ar"): string {
  return locale === "ar" ? e.ar : e.message;
}

export const INVENTORY_ACCOUNT = "1200";
export const COGS_ACCOUNT = "5000";
export const OPENING_EQUITY_ACCOUNT = "3000";
export const VAT_ACCOUNT = "2100";
export const AP_ACCOUNT = "2000";
/** Purchase lines that are not stock (free-text lines, services) are expensed here at receipt. */
export const NON_STOCK_PURCHASE_ACCOUNT = "5100";

export type InventoryContext = {
  orgId: number;
  userId: number;
  baseCurrency: string;
  /** The event's own date (YYYY-MM-DD) — invoice, receipt, note or adjustment date. */
  date: string;
};

/** Where a batch of movements came from; `journalEntryId` is the entry whose lines they belong to. */
export type MovementSource = {
  sourceType: string;
  sourceId: number | null;
  journalEntryId: number | null;
  memo: string;
};

export type DocumentStockLine = { productId: number | null; quantity: string | number; sourceLineId?: number | null };

// ---------------------------------------------------------------------------------------------
// Pure arithmetic
// ---------------------------------------------------------------------------------------------

const decimalsOf = (currency: string) => getCurrency(currency)?.decimalPlaces ?? 2;

/**
 * The cost of taking `quantity` units out of a weighted-average pool: the pool's whole remaining
 * value when the units empty it, otherwise quantity × value / pool quantity at the minor unit.
 */
export function weightedAverageCost(pool: { quantity: number; value: string }, quantity: number, currency: string): string {
  if (quantity <= 0 || pool.quantity <= 0) return roundMoney(0, currency);
  if (quantity >= pool.quantity) return roundMoney(pool.value, currency);
  return roundMoney((Number(pool.value) * quantity) / pool.quantity, currency);
}

/**
 * Split `total` across `weights` in proportion, at the currency's minor unit, so the parts sum to
 * `total` exactly — largest remainder first, ties to the earlier line. All-zero weights split
 * evenly. Used to spread a document's net (after its document-level discount) over its lines.
 */
export function allocateByWeight(total: string, weights: number[], currency: string): string[] {
  if (weights.length === 0) return [];
  const factor = 10 ** decimalsOf(currency);
  const units = Math.round(Number(total) * factor);
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sumW = w.reduce((a, b) => a + b, 0);
  const shares = sumW > 0 ? w.map((x) => x / sumW) : w.map(() => 1 / w.length);
  const sign = units < 0 ? -1 : 1;
  const abs = Math.abs(units);
  const exact = shares.map((s) => s * abs);
  const parts = exact.map((e) => Math.floor(e));
  let rest = abs - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    parts[i] += 1;
    rest -= 1;
  }
  return parts.map((u) => roundMoney((sign * u) / factor, currency));
}

const add = (a: string, b: string, currency: string) => roundMoney(Number(a) + Number(b), currency);
const sub = (a: string, b: string, currency: string) => roundMoney(Number(a) - Number(b), currency);
const neg = (a: string, currency: string) => roundMoney(-Number(a), currency);

// ---------------------------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------------------------

/** The org's account ids for `codes`; a refusal naming any that are missing. */
export async function inventoryAccounts(tx: Tx, orgId: number, codes: string[]): Promise<Map<string, number>> {
  const rows = await tx
    .select({ id: accountsTable.id, code: accountsTable.code })
    .from(accountsTable)
    .where(and(eq(accountsTable.orgId, orgId), inArray(accountsTable.code, codes)));
  const byCode = new Map(rows.map((r) => [r.code, r.id]));
  const missing = codes.filter((c) => !byCode.has(c));
  if (missing.length) {
    throw new InventoryRefusal(
      `Chart of accounts is missing a required system account (${missing.join("/")}).`,
      `دليل الحسابات ينقصه حساب نظامي مطلوب (${missing.join("/")}).`,
    );
  }
  return byCode;
}

// ---------------------------------------------------------------------------------------------
// Product state
// ---------------------------------------------------------------------------------------------

type StockState = {
  id: number;
  name: string;
  sku: string;
  itemType: "stock" | "service";
  onHand: number;
  valuedQty: number;
  value: string;
  touched: boolean;
};

/**
 * Lock the products `ids` (this org's only) FOR UPDATE, in ascending id order — every path locks
 * in the same order, so two postings sharing products queue instead of deadlocking, and each reads
 * the pool the other committed.
 */
async function lockProducts(tx: Tx, orgId: number, ids: number[]): Promise<Map<number, StockState>> {
  const unique = [...new Set(ids)].sort((a, b) => a - b);
  const out = new Map<number, StockState>();
  if (unique.length === 0) return out;
  const res = await tx.execute(sql`
    select id, name, sku, item_type, quantity_on_hand, valued_quantity, stock_value::text as stock_value
      from products
     where org_id = ${orgId} and id in (${sql.join(unique.map((id) => sql`${id}`), sql`, `)})
     order by id
       for update`);
  for (const r of res.rows as unknown as {
    id: number; name: string; sku: string; item_type: "stock" | "service";
    quantity_on_hand: number; valued_quantity: number; stock_value: string;
  }[]) {
    out.set(Number(r.id), {
      id: Number(r.id), name: r.name, sku: r.sku, itemType: r.item_type,
      onHand: Number(r.quantity_on_hand), valuedQty: Number(r.valued_quantity), value: r.stock_value, touched: false,
    });
  }
  return out;
}

const notInOrg = () =>
  new InventoryRefusal(
    "A line refers to a product that does not exist in this organization.",
    "أحد البنود يشير إلى منتج غير موجود في هذه المنشأة.",
  );

/** The line's quantity as whole units — a refusal for a fraction or a negative. */
function wholeUnits(s: StockState, quantity: string | number): number {
  const q = Number(quantity);
  if (!Number.isFinite(q) || q < 0) {
    throw new InventoryRefusal(
      `"${s.name}": ${quantity} is not a valid stock quantity.`,
      `"${s.name}": الكمية ${quantity} ليست كمية مخزون صالحة.`,
    );
  }
  if (!Number.isInteger(q)) {
    throw new InventoryRefusal(
      `"${s.name}" is a stock item counted in whole units — a quantity of ${quantity} cannot be posted.`,
      `"${s.name}" صنف مخزني يُحسب بالوحدات الكاملة، ولا يمكن ترحيل كمية ${quantity}.`,
    );
  }
  return q;
}

const insufficient = (s: StockState, needed: number) =>
  new InventoryRefusal(
    `Not enough stock of "${s.name}" (${s.sku}): ${s.onHand} on hand, ${needed} required. Stock cannot go negative — ` +
      "receive or adjust the stock first, or, if this item is a service, set its item type to Service.",
    `الكمية المتوفرة من "${s.name}" (${s.sku}) غير كافية: المتوفر ${s.onHand} والمطلوب ${needed}. لا يمكن أن يصبح المخزون بالسالب، ` +
      "فاستلم الكمية أو عدّل المخزون أولًا، وإن كان هذا الصنف خدمة فغيّر نوعه إلى خدمة.",
  );

/**
 * The stock lines of a document, with their products locked: lines without a product and lines of
 * services drop out; zero quantities drop out; every remaining line is whole units. A product that
 * is not this org's is a refusal, never a silent skip.
 */
async function lockStockLines<L extends DocumentStockLine>(tx: Tx, orgId: number, lines: L[]) {
  const withProduct = lines.filter((l) => l.productId != null);
  const states = await lockProducts(tx, orgId, withProduct.map((l) => Number(l.productId)));
  const items: { line: L; state: StockState; qty: number }[] = [];
  for (const line of withProduct) {
    const state = states.get(Number(line.productId));
    if (!state) throw notInOrg();
    if (state.itemType !== "stock") continue;
    const qty = wholeUnits(state, line.quantity);
    if (qty === 0) continue;
    items.push({ line, state, qty });
  }
  return { states, items };
}

type MovementDraft = {
  productId: number;
  kind: InventoryMovementKind;
  quantity: number;
  totalCost: string | null;
  sourceLineId: number | null;
  reversesMovementId?: number | null;
};

/** Insert the movements and write each touched product's running state back. */
async function persist(tx: Tx, ctx: InventoryContext, source: MovementSource, states: Map<number, StockState>, drafts: MovementDraft[]) {
  if (drafts.length === 0) return [] as number[];
  const rows = await tx
    .insert(inventoryMovementsTable)
    .values(drafts.map((d) => ({
      orgId: ctx.orgId,
      productId: d.productId,
      movementDate: ctx.date,
      kind: d.kind,
      quantity: d.quantity,
      totalCost: d.totalCost,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceLineId: d.sourceLineId,
      journalEntryId: source.journalEntryId,
      reversesMovementId: d.reversesMovementId ?? null,
      memo: source.memo,
      createdById: ctx.userId,
    })))
    .returning({ id: inventoryMovementsTable.id });
  for (const s of states.values()) {
    if (!s.touched) continue;
    await tx
      .update(productsTable)
      .set({ quantityOnHand: s.onHand, valuedQuantity: s.valuedQty, stockValue: s.value })
      .where(and(eq(productsTable.id, s.id), eq(productsTable.orgId, ctx.orgId)));
  }
  return rows.map((r) => r.id);
}

/** Add units at a known cost. */
function putIn(s: StockState, qty: number, cost: string, currency: string) {
  s.onHand += qty;
  s.valuedQty += qty;
  s.value = add(s.value, cost, currency);
  s.touched = true;
}

/**
 * Take units out: valued units first at the weighted average, then any units with no cost basis
 * (pre-ACC-01 stock) as an explicit uncosted part. Refuses to go below zero on hand.
 */
function takeOut(s: StockState, qty: number, currency: string) {
  if (qty > s.onHand) throw insufficient(s, qty);
  const valued = Math.min(qty, Math.max(0, s.valuedQty));
  const cost = weightedAverageCost({ quantity: s.valuedQty, value: s.value }, valued, currency);
  s.onHand -= qty;
  s.valuedQty -= valued;
  s.value = sub(s.value, cost, currency);
  s.touched = true;
  return { valued, cost, uncosted: qty - valued };
}

/** The costed and (when there is one) uncosted movement rows of one outflow. */
function outflowDrafts(kind: InventoryMovementKind, productId: number, sourceLineId: number | null, out: { valued: number; cost: string; uncosted: number }, currency: string): MovementDraft[] {
  const drafts: MovementDraft[] = [];
  if (out.valued > 0) drafts.push({ productId, kind, quantity: -out.valued, totalCost: neg(out.cost, currency), sourceLineId });
  if (out.uncosted > 0) drafts.push({ productId, kind, quantity: -out.uncosted, totalCost: null, sourceLineId });
  return drafts;
}

// ---------------------------------------------------------------------------------------------
// Document events
// ---------------------------------------------------------------------------------------------

/**
 * Sales issue (invoice posting): take each stock line out of stock. Returns the cost of goods sold
 * — the weighted-average cost of the VALUED units issued — which the caller posts as
 * Dr 5000 / Cr 1200 on the same entry as the revenue.
 */
export async function issueForSale(tx: Tx, ctx: InventoryContext, source: MovementSource, lines: DocumentStockLine[]) {
  const { states, items } = await lockStockLines(tx, ctx.orgId, lines);
  const drafts: MovementDraft[] = [];
  let cost = roundMoney(0, ctx.baseCurrency);
  let uncosted = 0;
  for (const { line, state, qty } of items) {
    const out = takeOut(state, qty, ctx.baseCurrency);
    cost = add(cost, out.cost, ctx.baseCurrency);
    uncosted += out.uncosted;
    drafts.push(...outflowDrafts("issue", state.id, line.sourceLineId ?? null, out, ctx.baseCurrency));
  }
  await persist(tx, ctx, source, states, drafts);
  return { cost, uncostedQuantity: uncosted };
}

/**
 * Purchase receipt: each stock line enters the pool at its allocated base-currency cost (the
 * caller has already split the document's net — after discount, before VAT — across its lines).
 */
export async function receiveIntoStock(
  tx: Tx,
  ctx: InventoryContext,
  source: MovementSource,
  lines: (DocumentStockLine & { cost: string })[],
) {
  const { states, items } = await lockStockLines(tx, ctx.orgId, lines);
  const drafts: MovementDraft[] = [];
  let value = roundMoney(0, ctx.baseCurrency);
  for (const { line, state, qty } of items) {
    const cost = roundMoney(line.cost, ctx.baseCurrency);
    putIn(state, qty, cost, ctx.baseCurrency);
    value = add(value, cost, ctx.baseCurrency);
    drafts.push({ productId: state.id, kind: "receipt", quantity: qty, totalCost: cost, sourceLineId: line.sourceLineId ?? null });
  }
  await persist(tx, ctx, source, states, drafts);
  return { value };
}

/**
 * Which lines of a purchase document are stock lines, so the caller can split its net between
 * inventory and expense before posting. Read under the same lock the posting takes.
 */
export async function stockLineFlags(tx: Tx, orgId: number, lines: DocumentStockLine[]): Promise<boolean[]> {
  const ids = lines.filter((l) => l.productId != null).map((l) => Number(l.productId));
  const states = await lockProducts(tx, orgId, ids);
  return lines.map((l) => {
    if (l.productId == null) return false;
    const s = states.get(Number(l.productId));
    if (!s) throw notInOrg();
    return s.itemType === "stock";
  });
}

/**
 * Purchase return (debit note): the returned units leave at the pool's weighted-average cost, like
 * every outflow — the perpetual WAC policy has one exit price, so the units that stay keep their
 * average whatever the supplier credits. The credit itself (`value`, the line's share of the note's
 * net at the purchase order's stored rate) is recorded at what it is: the caller debits AP for the
 * whole note. The difference between the credit for the costed units and the cost relieved is the
 * return's price variance (positive: the supplier credited more than the units cost — credit 5000;
 * negative: debit 5000). The unit that empties the pool takes exactly what is left.
 *
 * Units with no cost basis (pre-ACC-01 stock) leave uncosted; their share of the credit relieves
 * 1200, where the pre-ACC-01 receipt put their cost. Returns the 1200 credit and the variance.
 */
export async function returnToSupplier(
  tx: Tx,
  ctx: InventoryContext,
  source: MovementSource,
  lines: (DocumentStockLine & { value: string })[],
) {
  const cur = ctx.baseCurrency;
  const { states, items } = await lockStockLines(tx, ctx.orgId, lines);
  const drafts: MovementDraft[] = [];
  let inventoryCredit = roundMoney(0, cur);
  let variance = roundMoney(0, cur);
  for (const { line, state, qty } of items) {
    const lineValue = roundMoney(line.value, cur);
    const out = takeOut(state, qty, cur);
    const valuedShare = out.valued === qty ? lineValue : roundMoney((Number(lineValue) * out.valued) / qty, cur);
    const unvaluedShare = sub(lineValue, valuedShare, cur);
    inventoryCredit = add(inventoryCredit, add(out.cost, unvaluedShare, cur), cur);
    variance = add(variance, sub(valuedShare, out.cost, cur), cur);
    drafts.push(...outflowDrafts("purchase_return", state.id, line.sourceLineId ?? null, out, cur));
  }
  await persist(tx, ctx, source, states, drafts);
  return { inventoryCredit, variance };
}

/**
 * Reverse every not-yet-reversed movement of `kinds` that a source document wrote — each exactly,
 * at its own stored quantity and cost. Returns the movements reversed and the signed cost put back
 * (positive when stock value returns to the pool). The caller has locked the source document, so
 * a second reversal of the same document finds nothing left to reverse.
 */
export async function reverseSourceMovements(
  tx: Tx,
  ctx: InventoryContext,
  source: MovementSource & { sourceId: number },
  kinds: InventoryMovementKind[],
) {
  const cur = ctx.baseCurrency;
  const originals = await tx.execute(sql`
    select m.id, m.product_id, m.quantity, m.total_cost::text as total_cost, m.source_line_id
      from inventory_movements m
     where m.org_id = ${ctx.orgId} and m.source_type = ${source.sourceType} and m.source_id = ${source.sourceId}
       and m.kind in (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})
       and not exists (select 1 from inventory_movements r where r.org_id = ${ctx.orgId} and r.reverses_movement_id = m.id and r.kind = 'reversal')
     order by m.id`);
  const rows = originals.rows as unknown as { id: number; product_id: number; quantity: number; total_cost: string | null; source_line_id: number | null }[];
  if (rows.length === 0) return { reversed: 0, cost: roundMoney(0, cur) };

  const states = await lockProducts(tx, ctx.orgId, rows.map((r) => Number(r.product_id)));
  const drafts: MovementDraft[] = [];
  let cost = roundMoney(0, cur);
  for (const r of rows) {
    const s = states.get(Number(r.product_id));
    if (!s) throw notInOrg();
    const qty = -Number(r.quantity);
    const back = r.total_cost === null ? null : neg(r.total_cost, cur);
    if (s.onHand + qty < 0) throw insufficient(s, -qty);
    s.onHand += qty;
    if (back !== null) {
      s.valuedQty += qty;
      s.value = add(s.value, back, cur);
      cost = add(cost, back, cur);
    }
    s.touched = true;
    drafts.push({ productId: s.id, kind: "reversal", quantity: qty, totalCost: back, sourceLineId: r.source_line_id, reversesMovementId: Number(r.id) });
  }
  await persist(tx, ctx, source, states, drafts);
  return { reversed: rows.length, cost };
}

/** True when a source document wrote any movement of `kinds` — i.e. it posted under ACC-01. */
export async function hasSourceMovements(tx: Tx, orgId: number, sourceType: string, sourceId: number, kinds: InventoryMovementKind[]) {
  const res = await tx.execute(sql`
    select 1 from inventory_movements
     where org_id = ${orgId} and source_type = ${sourceType} and source_id = ${sourceId}
       and kind in (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})
     limit 1`);
  return res.rows.length > 0;
}

/**
 * Undo the quantity effect of a document posted BEFORE ACC-01 (it has no movements to reverse):
 * the old code moved `trunc(quantity)` units of every product line, so the restore puts the same
 * units back on hand — as uncosted movements, because the original had no cost — for products that are
 * still stock items.
 */
export async function restorePreValuationQuantities(tx: Tx, ctx: InventoryContext, source: MovementSource, lines: DocumentStockLine[]) {
  const withProduct = lines.filter((l) => l.productId != null);
  const states = await lockProducts(tx, ctx.orgId, withProduct.map((l) => Number(l.productId)));
  const drafts: MovementDraft[] = [];
  for (const line of withProduct) {
    const s = states.get(Number(line.productId));
    if (!s || s.itemType !== "stock") continue;
    const qty = Math.trunc(Number(line.quantity));
    if (qty <= 0) continue;
    s.onHand += qty;
    s.touched = true;
    drafts.push({ productId: s.id, kind: "reversal", quantity: qty, totalCost: null, sourceLineId: line.sourceLineId ?? null });
  }
  await persist(tx, ctx, source, states, drafts);
}

// ---------------------------------------------------------------------------------------------
// Opening stock and adjustments — they post their own journal entries
// ---------------------------------------------------------------------------------------------

const costRequired = () =>
  new InventoryRefusal(
    "Enter the unit cost of the stock being added — stock is never valued without a cost.",
    "أدخل تكلفة الوحدة للكمية المضافة، فلا يُقيَّم المخزون دون تكلفة.",
  );

/** A unit cost the user entered: a finite number of zero or more; blank is "not given". */
export function parseUnitCost(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new InventoryRefusal("The unit cost must be a number of zero or more.", "يجب أن تكون تكلفة الوحدة رقمًا يساوي صفرًا أو أكثر.");
  }
  return n;
}

async function postEntry(
  tx: Tx,
  ctx: InventoryContext,
  head: { sourceType: string; sourceId: number; memo: string },
  lines: { accountId: number; debit: string; credit: string }[],
) {
  const [entry] = await tx
    .insert(journalEntriesTable)
    .values({ orgId: ctx.orgId, entryDate: ctx.date, memo: head.memo, sourceType: head.sourceType, sourceId: head.sourceId, createdById: ctx.userId })
    .returning({ id: journalEntriesTable.id });
  await tx.insert(journalLinesTable).values(lines.map((l) => ({ journalEntryId: entry.id, ...l })));
  return entry.id;
}

async function linkMovements(tx: Tx, orgId: number, ids: number[], journalEntryId: number) {
  if (ids.length === 0) return;
  await tx
    .update(inventoryMovementsTable)
    .set({ journalEntryId })
    .where(and(eq(inventoryMovementsTable.orgId, orgId), inArray(inventoryMovementsTable.id, ids)));
}

/**
 * Opening stock for a new product: `quantity` units at `unitCost`, Dr 1200 Inventory /
 * Cr 3000 Owner's Equity — the same offset a bank account's opening balance uses. The entry keys
 * off the movement: `(inventory_opening, <movement id>)`.
 */
export async function recordOpeningStock(tx: Tx, ctx: InventoryContext, args: { productId: number; quantity: number; unitCost: number | null }) {
  const states = await lockProducts(tx, ctx.orgId, [args.productId]);
  const s = states.get(args.productId);
  if (!s) throw notInOrg();
  if (s.itemType !== "stock") {
    throw new InventoryRefusal(`"${s.name}" is a service — services carry no stock.`, `"${s.name}" خدمة، والخدمات لا يُحتفظ لها بمخزون.`);
  }
  const qty = wholeUnits(s, args.quantity);
  if (qty === 0) return null;
  if (args.unitCost === null) throw costRequired();
  const cost = roundMoney(qty * args.unitCost, ctx.baseCurrency);
  putIn(s, qty, cost, ctx.baseCurrency);
  const memo = `Opening stock — ${s.name} (${s.sku}), ${qty} × ${roundMoney(args.unitCost, ctx.baseCurrency)}`;
  const [movementId] = await persist(tx, ctx, { sourceType: "product", sourceId: s.id, journalEntryId: null, memo }, states, [
    { productId: s.id, kind: "opening", quantity: qty, totalCost: cost, sourceLineId: null },
  ]);
  if (Number(cost) !== 0) {
    const acc = await inventoryAccounts(tx, ctx.orgId, [INVENTORY_ACCOUNT, OPENING_EQUITY_ACCOUNT]);
    const entryId = await postEntry(tx, ctx, { sourceType: "inventory_opening", sourceId: movementId, memo }, [
      { accountId: acc.get(INVENTORY_ACCOUNT)!, debit: cost, credit: "0" },
      { accountId: acc.get(OPENING_EQUITY_ACCOUNT)!, debit: "0", credit: cost },
    ]);
    await linkMovements(tx, ctx.orgId, [movementId], entryId);
  }
  return { movementId, cost };
}

/**
 * A manual stock adjustment. An increase needs the unit cost of what is added (Dr 1200 / Cr 5000);
 * a decrease leaves at the weighted average (Dr 5000 / Cr 1200), and any part of it with no cost
 * basis leaves uncosted with no entry. The entry keys off the first movement:
 * `(inventory_adjustment, <movement id>)`.
 */
export async function adjustStock(tx: Tx, ctx: InventoryContext, args: { productId: number; delta: number; unitCost: number | null; reason: string }) {
  const states = await lockProducts(tx, ctx.orgId, [args.productId]);
  const s = states.get(args.productId);
  if (!s) throw notInOrg();
  if (s.itemType !== "stock") {
    throw new InventoryRefusal(`"${s.name}" is a service — services carry no stock.`, `"${s.name}" خدمة، والخدمات لا يُحتفظ لها بمخزون.`);
  }
  if (!Number.isInteger(args.delta) || args.delta === 0) {
    throw new InventoryRefusal("Enter a whole, non-zero quantity to add or remove.", "أدخل كمية صحيحة غير صفرية للإضافة أو الخصم.");
  }
  const cur = ctx.baseCurrency;
  const memo = `Stock adjustment — ${s.name} (${s.sku}) ${args.delta > 0 ? "+" : ""}${args.delta}: ${args.reason}`;
  let drafts: MovementDraft[];
  let cost: string;
  if (args.delta > 0) {
    if (args.unitCost === null) throw costRequired();
    cost = roundMoney(args.delta * args.unitCost, cur);
    putIn(s, args.delta, cost, cur);
    drafts = [{ productId: s.id, kind: "adjustment", quantity: args.delta, totalCost: cost, sourceLineId: null }];
  } else {
    const out = takeOut(s, -args.delta, cur);
    cost = neg(out.cost, cur);
    drafts = outflowDrafts("adjustment", s.id, null, out, cur);
  }
  const ids = await persist(tx, ctx, { sourceType: "product", sourceId: s.id, journalEntryId: null, memo }, states, drafts);
  if (Number(cost) !== 0) {
    const acc = await inventoryAccounts(tx, ctx.orgId, [INVENTORY_ACCOUNT, COGS_ACCOUNT]);
    const amount = roundMoney(Math.abs(Number(cost)), cur);
    const up = Number(cost) > 0;
    const entryId = await postEntry(tx, ctx, { sourceType: "inventory_adjustment", sourceId: ids[0], memo }, [
      { accountId: acc.get(INVENTORY_ACCOUNT)!, debit: up ? amount : "0", credit: up ? "0" : amount },
      { accountId: acc.get(COGS_ACCOUNT)!, debit: up ? "0" : amount, credit: up ? amount : "0" },
    ]);
    await linkMovements(tx, ctx.orgId, ids, entryId);
  }
  return { cost };
}

/**
 * Whether a product's item type may change: only while it has no stock (counted or valued) and no
 * stock history, so no movement, valuation or open document ever straddles the two kinds.
 *
 * A service also stays a service while a posted document names it — a sent invoice, a received
 * purchase order or an issued debit note. Those posted no movement for it, so after the change their
 * void, a goods return against them or their reversal would read them as pre-ACC-01 documents and
 * move stock that never moved.
 */
export async function itemTypeChangeRefusal(tx: Tx, orgId: number, productId: number): Promise<InventoryRefusal | null> {
  const res = await tx.execute(sql`
    select p.item_type, p.quantity_on_hand, p.valued_quantity, p.stock_value::text as stock_value,
           exists (select 1 from inventory_movements m where m.org_id = ${orgId} and m.product_id = p.id) as has_movements,
           (exists (select 1 from sales_invoice_items i join sales_invoices v on v.id = i.invoice_id
                     where v.org_id = ${orgId} and i.product_id = p.id and v.status not in ('draft', 'void'))
            or exists (select 1 from purchase_order_items i join purchase_orders o on o.id = i.purchase_order_id
                        where o.org_id = ${orgId} and i.product_id = p.id and o.status = 'received')
            or exists (select 1 from debit_note_items i join debit_notes d on d.id = i.debit_note_id
                        where d.org_id = ${orgId} and i.product_id = p.id and d.status = 'issued')) as on_posted_document
      from products p where p.org_id = ${orgId} and p.id = ${productId} for update`);
  const r = (res.rows as unknown as {
    item_type: "stock" | "service"; quantity_on_hand: number; valued_quantity: number; stock_value: string; has_movements: boolean; on_posted_document: boolean;
  }[])[0];
  if (!r) return notInOrg();
  if (Number(r.quantity_on_hand) !== 0 || Number(r.valued_quantity) !== 0 || Number(r.stock_value) !== 0 || r.has_movements) {
    return new InventoryRefusal(
      "The item type can only change while the product has no stock and no stock history.",
      "لا يمكن تغيير نوع الصنف إلا إذا لم يكن له رصيد مخزون ولا حركات مخزون سابقة.",
    );
  }
  if (r.item_type === "service" && r.on_posted_document) {
    return new InventoryRefusal(
      "This service is on a sent invoice, a received purchase order or an issued debit note, so it cannot become a stock item: " +
        "those documents moved no stock for it, and voiding, returning or reversing them would move stock that never moved.",
      "هذه الخدمة واردة في فاتورة مرسلة أو أمر شراء مستلم أو إشعار مدين صادر، فلا يمكن تحويلها إلى صنف مخزني: " +
        "تلك المستندات لم تُحرّك لها مخزونًا، وإلغاؤها أو إرجاع بضاعتها أو عكسها سيحرّك مخزونًا لم يتحرك قط.",
    );
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Customer returns — a credit note's goods back into stock. They post their own journal entries,
// `(sales_return, <credit note id>)`.
// ---------------------------------------------------------------------------------------------

/** Goods a customer returned: `quantity` units of `productId`, from the credit note line `sourceLineId`. */
export type CustomerReturnLine = { productId: number; quantity: number | string; sourceLineId: number };

/** What is left of one stock issue to come back: units, and their cost (null when it had none). */
type ReturnableIssue = { issueId: number | null; units: number; cost: string | null };

const overReturn = (s: StockState, requested: number, left: number) =>
  new InventoryRefusal(
    `Cannot return ${requested} of "${s.name}" (${s.sku}) to stock: only ${left} of the units this invoice issued have not already come back. ` +
      "A return can never exceed what the sale took out of stock.",
    `لا يمكن إرجاع ${requested} من "${s.name}" (${s.sku}) إلى المخزون: لم يتبقَّ من الوحدات التي صرفتها هذه الفاتورة سوى ${left} لم تُرجَع بعد، ` +
      "ولا يمكن أن يتجاوز المرتجع ما صرفه البيع من المخزون.",
  );

const notBackInStock = (s: StockState, needed: number) =>
  new InventoryRefusal(
    `The goods this credit note returned are no longer all in stock: ${s.onHand} of "${s.name}" (${s.sku}) on hand, ${needed} to take back out. ` +
      "Adjust the stock first, then reverse the credit note.",
    `البضاعة التي أرجعها هذا الإشعار لم تعد كلها في المخزون: المتوفر من "${s.name}" (${s.sku}) ${s.onHand} والمطلوب إخراجه ${needed}. ` +
      "عدّل المخزون أولًا ثم اعكس إشعار الدائن.",
  );

/**
 * The invoice's stock issues of `productId` with what is left of each to come back — newest first —
 * net of every return that still stands (a reversed return gives its units back to the issue). An
 * issue the void reversed has nothing left. An invoice posted before ACC-01 has no issue rows: what
 * it sold (`trunc` of its lines, as the old decrement moved) is one uncosted remainder.
 */
async function returnableIssues(tx: Tx, orgId: number, invoiceId: number, productId: number, legacy: boolean, currency: string): Promise<ReturnableIssue[]> {
  if (legacy) {
    const res = await tx.execute(sql`
      select coalesce((select sum(trunc(i.quantity))::int from sales_invoice_items i join sales_invoices v on v.id = i.invoice_id
                        where v.org_id = ${orgId} and v.id = ${invoiceId} and i.product_id = ${productId}), 0) as sold,
             coalesce((select sum(r.quantity)::int from inventory_movements r join credit_notes c on c.id = r.source_id and c.org_id = r.org_id
                        where r.org_id = ${orgId} and r.kind = 'sales_return' and r.source_type = 'credit_note' and r.product_id = ${productId}
                          and c.source_invoice_id = ${invoiceId}
                          and not exists (select 1 from inventory_movements x where x.org_id = ${orgId} and x.kind = 'reversal' and x.reverses_movement_id = r.id)), 0) as returned`);
    const r = res.rows[0] as { sold: number; returned: number };
    return [{ issueId: null, units: Math.max(0, Number(r.sold) - Number(r.returned)), cost: null }];
  }
  const res = await tx.execute(sql`
    select m.id, -m.quantity as issued, m.total_cost::text as total_cost,
           coalesce(ret.qty, 0)::int as returned_qty, coalesce(ret.cost, 0)::text as returned_cost
      from inventory_movements m
      left join lateral (
        select sum(r.quantity) as qty, sum(r.total_cost) as cost
          from inventory_movements r
         where r.org_id = ${orgId} and r.kind = 'sales_return' and r.reverses_movement_id = m.id
           and not exists (select 1 from inventory_movements x where x.org_id = ${orgId} and x.kind = 'reversal' and x.reverses_movement_id = r.id)
      ) ret on true
     where m.org_id = ${orgId} and m.source_type = 'sales_invoice' and m.source_id = ${invoiceId}
       and m.product_id = ${productId} and m.kind = 'issue'
       and not exists (select 1 from inventory_movements x where x.org_id = ${orgId} and x.kind = 'reversal' and x.reverses_movement_id = m.id)
     order by m.id desc`);
  return (res.rows as unknown as { id: number; issued: number; total_cost: string | null; returned_qty: number; returned_cost: string }[]).map((r) => ({
    issueId: Number(r.id),
    units: Number(r.issued) - Number(r.returned_qty),
    cost: r.total_cost === null ? null : roundMoney(-Number(r.total_cost) - Number(r.returned_cost), currency),
  }));
}

/**
 * A customer's goods back into stock against a credit note — the return of a sale, so each unit comes
 * back at the cost the invoice ISSUED it at, never at today's average, and the COGS that sale
 * recognised for it is reversed: Dr 1200 / Cr 5000, `(sales_return, <credit note id>)`.
 *
 * Within a product, units come back in the reverse of the order the sale took them out — last out,
 * first back: units the sale issued with no cost basis come back first, still uncosted (a return
 * never invents a cost), then costed units at their own issue's cost, the last unit of an issue taking
 * exactly what is left of it. Each row points at the issue it came back from.
 *
 * An invoice posted before ACC-01 has no issue rows: its units come back uncosted, up to the quantity
 * it sold. More than the invoice issued, net of every return that still stands, is refused. The
 * caller holds the credit note's and the invoice's row locks; the products are locked here, before
 * anything is read, so two returns against the same sale queue and the second sees the first.
 */
export async function returnFromCustomer(
  tx: Tx,
  ctx: InventoryContext,
  source: MovementSource & { sourceId: number },
  args: { invoiceId: number; lines: CustomerReturnLine[] },
) {
  const cur = ctx.baseCurrency;
  const { states, items } = await lockStockLines(tx, ctx.orgId, args.lines);
  const legacy = !(await hasSourceMovements(tx, ctx.orgId, "sales_invoice", args.invoiceId, ["issue"]));
  const issues = new Map<number, ReturnableIssue[]>();
  const drafts: MovementDraft[] = [];
  let cost = roundMoney(0, cur);
  for (const { line, state, qty } of items) {
    if (!issues.has(state.id)) issues.set(state.id, await returnableIssues(tx, ctx.orgId, args.invoiceId, state.id, legacy, cur));
    const rows = issues.get(state.id)!;
    const left = rows.reduce((n, r) => n + r.units, 0);
    if (qty > left) throw overReturn(state, qty, left);
    let need = qty;
    for (const r of rows) {
      if (need === 0) break;
      const take = Math.min(need, r.units);
      if (take === 0) continue;
      let back: string | null = null;
      if (r.cost === null) {
        state.onHand += take;
        state.touched = true;
      } else {
        back = weightedAverageCost({ quantity: r.units, value: r.cost }, take, cur);
        r.cost = sub(r.cost, back, cur);
        putIn(state, take, back, cur);
        cost = add(cost, back, cur);
      }
      r.units -= take;
      need -= take;
      drafts.push({ productId: state.id, kind: "sales_return", quantity: take, totalCost: back, sourceLineId: Number(line.sourceLineId), reversesMovementId: r.issueId });
    }
  }
  const ids = await persist(tx, ctx, source, states, drafts);
  if (Number(cost) !== 0) {
    const acc = await inventoryAccounts(tx, ctx.orgId, [INVENTORY_ACCOUNT, COGS_ACCOUNT]);
    const entryId = await postEntry(tx, ctx, { sourceType: "sales_return", sourceId: source.sourceId, memo: source.memo }, [
      { accountId: acc.get(INVENTORY_ACCOUNT)!, debit: cost, credit: "0" },
      { accountId: acc.get(COGS_ACCOUNT)!, debit: "0", credit: cost },
    ]);
    await linkMovements(tx, ctx.orgId, ids, entryId);
  }
  return { cost, movementIds: ids };
}

/**
 * Take a credit note's returned goods back out of stock — the note is being reversed. Each of its
 * `sales_return` rows not yet reversed comes off exactly (the same units, at the same cost) when no
 * stock of that product has gone out since the return: the pool is then precisely what it would have
 * been without it. Once stock has gone out in between, the returned units are no longer separable
 * from the rest, and they leave like any outflow — at the weighted average, valued units first.
 * Refuses when they are no longer on hand. Dr 5000 / Cr 1200 for the cost taken out,
 * `(sales_return, <credit note id>)`. The caller holds the credit note's row lock.
 */
export async function reverseCustomerReturns(tx: Tx, ctx: InventoryContext, source: MovementSource & { sourceId: number }) {
  const cur = ctx.baseCurrency;
  const found = await tx.execute(sql`
    select m.id, m.product_id, m.quantity, m.total_cost::text as total_cost, m.source_line_id
      from inventory_movements m
     where m.org_id = ${ctx.orgId} and m.source_type = ${source.sourceType} and m.source_id = ${source.sourceId} and m.kind = 'sales_return'
       and not exists (select 1 from inventory_movements r where r.org_id = ${ctx.orgId} and r.reverses_movement_id = m.id and r.kind = 'reversal')
     order by m.id`);
  const rows = found.rows as unknown as { id: number; product_id: number; quantity: number; total_cost: string | null; source_line_id: number | null }[];
  if (rows.length === 0) return { reversed: 0, cost: roundMoney(0, cur), movementIds: [] as number[] };

  const states = await lockProducts(tx, ctx.orgId, rows.map((r) => Number(r.product_id)));
  // Read under the product locks: no other posting can add an outflow between this and the write.
  const since = await tx.execute(sql`
    select m.id, exists (select 1 from inventory_movements o where o.org_id = ${ctx.orgId} and o.product_id = m.product_id and o.id > m.id and o.quantity < 0) as moved
      from inventory_movements m where m.org_id = ${ctx.orgId} and m.id in (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)})`);
  const movedSince = new Map((since.rows as unknown as { id: number; moved: boolean }[]).map((r) => [Number(r.id), Boolean(r.moved)]));

  const drafts: MovementDraft[] = [];
  let cost = roundMoney(0, cur);
  for (const r of rows) {
    const s = states.get(Number(r.product_id));
    if (!s) throw notInOrg();
    const qty = Number(r.quantity);
    if (qty > s.onHand) throw notBackInStock(s, qty);
    const back = r.total_cost === null ? null : roundMoney(r.total_cost, cur);
    const exact = !movedSince.get(Number(r.id))
      && (back === null ? s.onHand - s.valuedQty >= qty : s.valuedQty >= qty && Number(s.value) >= Number(back));
    if (exact) {
      s.onHand -= qty;
      if (back !== null) {
        s.valuedQty -= qty;
        s.value = sub(s.value, back, cur);
        cost = add(cost, back, cur);
      }
      s.touched = true;
      drafts.push({ productId: s.id, kind: "reversal", quantity: -qty, totalCost: back === null ? null : neg(back, cur), sourceLineId: r.source_line_id, reversesMovementId: Number(r.id) });
    } else {
      const out = takeOut(s, qty, cur);
      cost = add(cost, out.cost, cur);
      drafts.push(...outflowDrafts("reversal", s.id, r.source_line_id, out, cur).map((d) => ({ ...d, reversesMovementId: Number(r.id) })));
    }
  }
  const ids = await persist(tx, ctx, source, states, drafts);
  if (Number(cost) !== 0) {
    const acc = await inventoryAccounts(tx, ctx.orgId, [INVENTORY_ACCOUNT, COGS_ACCOUNT]);
    const entryId = await postEntry(tx, ctx, { sourceType: "sales_return", sourceId: source.sourceId, memo: source.memo }, [
      { accountId: acc.get(COGS_ACCOUNT)!, debit: cost, credit: "0" },
      { accountId: acc.get(INVENTORY_ACCOUNT)!, debit: "0", credit: cost },
    ]);
    await linkMovements(tx, ctx.orgId, ids, entryId);
  }
  return { reversed: rows.length, cost, movementIds: ids };
}

/**
 * Units of `productId` the invoice issued that have not come back yet (net of returns that still
 * stand), and of those the units the credit note's line `lineId` has already returned — for the
 * return dialog. Read-only; the posting re-reads both under its locks.
 */
export async function returnableUnits(tx: Tx, orgId: number, args: { invoiceId: number; productId: number; creditNoteId: number; lineId: number; baseCurrency: string }) {
  const legacy = !(await hasSourceMovements(tx, orgId, "sales_invoice", args.invoiceId, ["issue"]));
  const rows = await returnableIssues(tx, orgId, args.invoiceId, args.productId, legacy, args.baseCurrency);
  const onLine = await tx.execute(sql`
    select coalesce(sum(m.quantity), 0)::int as n from inventory_movements m
     where m.org_id = ${orgId} and m.kind = 'sales_return' and m.source_type = 'credit_note' and m.source_id = ${args.creditNoteId}
       and m.source_line_id = ${args.lineId}
       and not exists (select 1 from inventory_movements r where r.org_id = ${orgId} and r.reverses_movement_id = m.id and r.kind = 'reversal')`);
  return { invoiceLeft: rows.reduce((n, r) => n + r.units, 0), returnedOnLine: Number((onLine.rows[0] as { n: number }).n) };
}
