// Run via `npm run verify:inventory-costing` — tsx with the react-server condition, like every server suite.

/**
 * ACC-01 — weighted-average inventory costing, COGS, and the inventory-to-GL reconciliation.
 *
 * Exercises the posting code the server actions call (src/lib/inventory-costing.ts,
 * invoice-posting.ts, purchase-posting.ts) inside real transactions against the database, on
 * fixture organizations it creates and sweeps itself. A session cannot be reached from here, so the
 * action wiring (role gate, locks, revalidation) is covered by the browser tier; everything that
 * POSTS is covered here:
 *
 *   1 opening stock · 2 receipt cost · 3 WAC · 4 receipts at different costs · 5 partial delivery ·
 *   6 full delivery · 7 COGS posting · 8 repeated posting · 9 returns and cost reversal ·
 *   10 cancellation / reversal · 11 inventory-to-GL reconciliation · 12 P&L / Balance Sheet ·
 *   13 services / non-stock · 14 missing / invalid cost · 15 negative stock · 16 rounding and
 *   multi-currency · 17 concurrency · 18 tenant isolation and role gates — then mixed scenarios.
 *
 * Every expected figure is worked out by hand in the comments beside it, never read back from the
 * code under test.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { db, pool as appPool } from "../src/db";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../src/db/schema/accounting";
import { computeTotals } from "../src/app/(app)/sales/_shared/totals";
import { roundMoney } from "../src/lib/currency/currencies";
import { captureBaseAmounts } from "../src/lib/posting-currency";
import { noteBaseAmounts } from "../src/lib/reversal-currency";
import { prepareInvoicePosting, reverseInvoicePosting } from "../src/lib/invoice-posting";
import { postPurchaseReceipt, postPurchaseReturn, reversePurchaseReturn } from "../src/lib/purchase-posting";
import {
  adjustStock, allocateByWeight, isInventoryRefusal, itemTypeChangeRefusal, parseUnitCost, recordOpeningStock,
  reverseSourceMovements, weightedAverageCost,
} from "../src/lib/inventory-costing";
import { getInventoryReconciliation, getInventoryValuation } from "../src/lib/inventory-valuation";
import { getBalanceSheet, getProfitAndLoss } from "../src/lib/finance-reports";

const ROOT = path.resolve(import.meta.dirname, "..");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uniq = () => Math.random().toString(36).slice(2, 8);
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${!ok && detail ? `\n      ${detail}` : ""}`);
}
const section = (s: string) => console.log(`\n${s}`);
const mils = (v: string | number | null | undefined) => Math.round(Number(v ?? 0) * 1000);
const eq = (a: string | number | null | undefined, b: string | number) => mils(a) === mils(b);
const TODAY = new Date().toISOString().slice(0, 10);
const RANGE = { from: "2000-01-01", to: "2100-12-31" };

const FIXTURE = "verifyinvcost_";
async function sweep() {
  // Children before parents: the fixtures include a document in one org naming another org's
  // product (section 18), so no single cascade order removes everything.
  const orgs = `(select id from orgs where name like '${FIXTURE}%')`;
  for (const q of [
    `delete from inventory_movements where org_id in ${orgs}`,
    `delete from journal_lines where journal_entry_id in (select id from journal_entries where org_id in ${orgs})`,
    `delete from journal_entries where org_id in ${orgs}`,
    `delete from delivery_challan_items where delivery_challan_id in (select id from delivery_challans where org_id in ${orgs})`,
    `delete from delivery_challans where org_id in ${orgs}`,
    `delete from sales_invoice_items where invoice_id in (select id from sales_invoices where org_id in ${orgs})`,
    `delete from sales_invoices where org_id in ${orgs}`,
    `delete from debit_note_items where debit_note_id in (select id from debit_notes where org_id in ${orgs})`,
    `delete from debit_notes where org_id in ${orgs}`,
    `delete from purchase_order_items where purchase_order_id in (select id from purchase_orders where org_id in ${orgs})`,
    `delete from purchase_orders where org_id in ${orgs}`,
    `delete from orgs where id in ${orgs}`,
  ]) await pool.query(q);
}
await sweep();

type Org = { id: number; user: number; currency: string; acc: Map<string, number> };
async function mkOrg(currency = "SAR"): Promise<Org> {
  const id = (await pool.query("insert into orgs (name, currency, country) values ($1,$2,'Saudi Arabia') returning id",
    [`${FIXTURE}${uniq()}`, currency])).rows[0].id as number;
  const user = (await pool.query("insert into users (org_id,name,email,password_hash,role) values ($1,'Inv',$2,'x','owner') returning id",
    [id, `inv_${uniq()}@t.dev`])).rows[0].id as number;
  for (const a of DEFAULT_CHART_OF_ACCOUNTS) {
    await pool.query("insert into accounts (org_id,code,name,type,normal_balance,is_system) values ($1,$2,$3,$4,$5,$6)",
      [id, a.code, a.name, a.type, a.normalBalance, a.isSystem]);
  }
  const acc = new Map<string, number>((await pool.query("select id, code from accounts where org_id=$1", [id])).rows.map((r) => [r.code, r.id]));
  return { id, user, currency, acc };
}
const ctx = (o: Org, date = TODAY) => ({ orgId: o.id, userId: o.user, baseCurrency: o.currency, date });

async function mkProduct(o: Org, sku: string, opts: { itemType?: "stock" | "service"; legacyQty?: number } = {}) {
  return (await pool.query(
    "insert into products (org_id,sku,name,unit_price,item_type,quantity_on_hand) values ($1,$2,$3,'0',$4,$5) returning id",
    [o.id, sku, `Item ${sku}`, opts.itemType ?? "stock", opts.legacyQty ?? 0])).rows[0].id as number;
}
async function poolOf(productId: number) {
  const r = (await pool.query("select quantity_on_hand, valued_quantity, stock_value::text v from products where id=$1", [productId])).rows[0];
  return { onHand: Number(r.quantity_on_hand), valued: Number(r.valued_quantity), value: r.v as string };
}
async function gl(o: Org, code: string) {
  return (await pool.query(`select coalesce(sum(l.debit - l.credit),0)::text v from journal_lines l
    join journal_entries e on e.id = l.journal_entry_id where e.org_id=$1 and l.account_id=$2`, [o.id, o.acc.get(code)])).rows[0].v as string;
}
async function entryLines(entryId: number) {
  return (await pool.query(`select a.code, l.debit::text debit, l.credit::text credit from journal_lines l
    join accounts a on a.id = l.account_id where l.journal_entry_id=$1 order by a.code, l.id`, [entryId])).rows as { code: string; debit: string; credit: string }[];
}
const line = (lines: { code: string; debit: string; credit: string }[], code: string) => lines.filter((l) => l.code === code);
async function movements(o: Org, sourceType: string, sourceId: number) {
  return (await pool.query(`select id, product_id, kind, quantity, total_cost::text total_cost, journal_entry_id, reverses_movement_id
    from inventory_movements where org_id=$1 and source_type=$2 and source_id=$3 order by id`, [o.id, sourceType, sourceId])).rows as {
      id: number; product_id: number; kind: string; quantity: number; total_cost: string | null; journal_entry_id: number | null; reverses_movement_id: number | null;
    }[];
}
async function unbalancedEntries(o: Org) {
  return Number((await pool.query(`select count(*)::int n from (select e.id from journal_entries e join journal_lines l on l.journal_entry_id = e.id
    where e.org_id=$1 group by e.id having sum(l.debit) <> sum(l.credit)) x`, [o.id])).rows[0].n);
}
const refusalOf = async (fn: () => Promise<unknown>) => {
  try { await fn(); return null; } catch (e) { if (isInventoryRefusal(e)) return e; throw e; }
};

// ---- documents, written as the app writes them, posted through the code the actions call ----
type DocLineIn = { productId: number | null; qty: string; price: string; tax?: string };
async function mkPo(o: Org, lines: DocLineIn[], opts: { currency?: string | null; discount?: string; projectId?: number } = {}) {
  const cur = opts.currency ?? null;
  const t = computeTotals(lines.map((l) => ({ quantity: l.qty, unitPrice: l.price, taxRatePercent: l.tax ?? "0" })), opts.discount ?? "0", cur ?? o.currency);
  const vendor = (await pool.query("insert into vendors (org_id,name) values ($1,'V') returning id", [o.id])).rows[0].id;
  const po = (await pool.query(`insert into purchase_orders (org_id,po_number,vendor_id,order_date,status,subtotal,discount,tax_total,total,currency,created_by_id)
    values ($1,$2,$3,$4,'ordered',$5,$6,$7,$8,$9,$10) returning id`,
    [o.id, `PO-${uniq()}`, vendor, TODAY, t.subtotal, t.discount, t.taxTotal, t.total, cur, o.user])).rows[0].id as number;
  for (const l of lines) {
    await pool.query(`insert into purchase_order_items (purchase_order_id,product_id,description,quantity,unit_cost,tax_rate_percent,line_total)
      values ($1,$2,'line',$3,$4,$5,$6)`, [po, l.productId, l.qty, l.price, l.tax ?? "0", roundMoney(Number(l.qty) * Number(l.price), cur ?? o.currency)]);
  }
  return po;
}
async function receive(o: Org, poId: number) {
  const po = (await pool.query("select po_number, currency, total::text total, tax_total::text tax_total from purchase_orders where id=$1", [poId])).rows[0];
  const items = (await pool.query("select id, product_id, quantity::text quantity, line_total::text line_total from purchase_order_items where purchase_order_id=$1 order by id", [poId])).rows;
  const captured = await captureBaseAmounts({ orgId: o.id, baseCurrency: o.currency, docCurrency: po.currency, total: po.total, taxTotal: po.tax_total, date: TODAY });
  if (!captured.ok) throw new Error(captured.error);
  return db.transaction(async (tx) => {
    const r = await postPurchaseReceipt(tx, {
      orgId: o.id, userId: o.user, baseCurrency: o.currency,
      po: { id: poId, poNumber: po.po_number, orderDate: TODAY },
      items: items.map((i) => ({ id: i.id, productId: i.product_id, quantity: i.quantity, lineTotal: i.line_total })),
      captured, receiptDate: TODAY,
    });
    await tx.execute(sql`update purchase_orders set status = 'received', exchange_rate = ${captured.exchangeRate}, base_total = ${captured.baseTotal}, base_tax_amount = ${captured.baseTaxAmount} where id = ${poId}`);
    return r;
  });
}
async function mkDn(o: Org, poId: number, lines: DocLineIn[]) {
  const po = (await pool.query("select vendor_id, currency from purchase_orders where id=$1", [poId])).rows[0];
  const t = computeTotals(lines.map((l) => ({ quantity: l.qty, unitPrice: l.price, taxRatePercent: l.tax ?? "0" })), "0", po.currency ?? o.currency);
  const dn = (await pool.query(`insert into debit_notes (org_id,debit_note_number,vendor_id,source_purchase_order_id,currency,issue_date,subtotal,tax_total,total,status,created_by_id)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10) returning id`,
    [o.id, `DN-${uniq()}`, po.vendor_id, poId, po.currency, TODAY, t.subtotal, t.taxTotal, t.total, o.user])).rows[0].id as number;
  for (const l of lines) {
    await pool.query(`insert into debit_note_items (debit_note_id,product_id,description,quantity,unit_cost,tax_rate_percent,line_total)
      values ($1,$2,'ret',$3,$4,$5,$6)`, [dn, l.productId, l.qty, l.price, l.tax ?? "0", roundMoney(Number(l.qty) * Number(l.price), po.currency ?? o.currency)]);
  }
  return dn;
}
async function issueDn(o: Org, dnId: number) {
  const dn = (await pool.query("select debit_note_number, source_purchase_order_id, currency, total::text total, tax_total::text tax_total from debit_notes where id=$1", [dnId])).rows[0];
  const po = (await pool.query("select currency, exchange_rate::text exchange_rate, total::text total, base_total::text base_total, base_tax_amount::text base_tax_amount from purchase_orders where id=$1", [dn.source_purchase_order_id])).rows[0];
  const items = (await pool.query("select id, product_id, quantity::text quantity, line_total::text line_total from debit_note_items where debit_note_id=$1 order by id", [dnId])).rows;
  const captured = noteBaseAmounts({
    baseCurrency: o.currency,
    source: { currency: po.currency, exchangeRate: po.exchange_rate, total: po.total, baseTotal: po.base_total, baseTaxAmount: po.base_tax_amount },
    note: { currency: dn.currency, total: dn.total, taxTotal: dn.tax_total },
    priorNotes: { total: "0", baseTotal: "0", baseTaxAmount: "0" },
  });
  if (!captured.ok) throw new Error(captured.error);
  return db.transaction(async (tx) => {
    const r = await postPurchaseReturn(tx, {
      orgId: o.id, userId: o.user, baseCurrency: o.currency,
      dn: { id: dnId, debitNoteNumber: dn.debit_note_number, issueDate: TODAY },
      items: items.map((i) => ({ id: i.id, productId: i.product_id, quantity: i.quantity, lineTotal: i.line_total })),
      captured,
    });
    await tx.execute(sql`update debit_notes set status = 'issued', exchange_rate = ${captured.exchangeRate}, base_total = ${captured.baseTotal}, base_tax_amount = ${captured.baseTaxAmount} where id = ${dnId}`);
    return r;
  });
}
async function reverseDn(o: Org, dnId: number) {
  const dn = (await pool.query("select debit_note_number from debit_notes where id=$1", [dnId])).rows[0];
  const items = (await pool.query("select id, product_id, quantity::text quantity, line_total::text line_total from debit_note_items where debit_note_id=$1 order by id", [dnId])).rows;
  return db.transaction((tx) => reversePurchaseReturn(tx, {
    orgId: o.id, userId: o.user, baseCurrency: o.currency, dn: { id: dnId, debitNoteNumber: dn.debit_note_number },
    items: items.map((i) => ({ id: i.id, productId: i.product_id, quantity: i.quantity, lineTotal: i.line_total })), date: TODAY,
  }));
}
async function mkInvoice(o: Org, lines: DocLineIn[], opts: { currency?: string | null; discount?: string; issueDate?: string } = {}) {
  const cur = opts.currency ?? null;
  const t = computeTotals(lines.map((l) => ({ quantity: l.qty, unitPrice: l.price, taxRatePercent: l.tax ?? "15" })), opts.discount ?? "0", cur ?? o.currency);
  const cust = (await pool.query("insert into customers (org_id,name) values ($1,'C') returning id", [o.id])).rows[0].id;
  const inv = (await pool.query(`insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,due_date,subtotal,discount,tax_total,total,currency,status,created_by_id)
    values ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,'draft',$10) returning id`,
    [o.id, `INV-${uniq()}`, cust, opts.issueDate ?? TODAY, t.subtotal, t.discount, t.taxTotal, t.total, cur, o.user])).rows[0].id as number;
  for (const l of lines) {
    await pool.query(`insert into sales_invoice_items (invoice_id,product_id,description,quantity,unit_price,tax_rate_percent,line_total)
      values ($1,$2,'sale',$3,$4,$5,$6)`, [inv, l.productId, l.qty, l.price, l.tax ?? "15", roundMoney(Number(l.qty) * Number(l.price), cur ?? o.currency)]);
  }
  return inv;
}
async function send(o: Org, invoiceId: number) {
  const inv = (await pool.query("select currency, total::text total, tax_total::text tax_total, issue_date::text issue_date from sales_invoices where id=$1", [invoiceId])).rows[0];
  const items = (await pool.query("select id, product_id \"productId\", quantity::text quantity from sales_invoice_items where invoice_id=$1 order by id", [invoiceId])).rows;
  const prep = await prepareInvoicePosting({
    orgId: o.id, userId: o.user, baseCurrency: o.currency, docCurrency: inv.currency,
    total: inv.total, taxTotal: inv.tax_total, issueDate: inv.issue_date, items,
  });
  if (!prep.ok) throw new Error(prep.error);
  await db.transaction(async (tx) => {
    await prep.post(tx, { invoiceId, memo: "sent" });
    await tx.execute(sql`update sales_invoices set status = 'sent', exchange_rate = ${prep.captured.exchangeRate}, base_total = ${prep.captured.baseTotal}, base_tax_amount = ${prep.captured.baseTaxAmount} where id = ${invoiceId}`);
  });
  return prep;
}
async function voidInv(o: Org, invoiceId: number) {
  const inv = (await pool.query("select invoice_number from sales_invoices where id=$1", [invoiceId])).rows[0];
  const items = (await pool.query("select id, product_id \"productId\", quantity::text quantity from sales_invoice_items where invoice_id=$1 order by id", [invoiceId])).rows;
  return db.transaction(async (tx) => {
    const r = await reverseInvoicePosting(tx, { orgId: o.id, userId: o.user, baseCurrency: o.currency, invoice: { id: invoiceId, invoiceNumber: inv.invoice_number }, items, date: TODAY });
    await tx.execute(sql`update sales_invoices set status = 'void' where id = ${invoiceId}`);
    return r;
  });
}
const invoiceEntry = async (o: Org, invoiceId: number) => (await pool.query(
  "select id from journal_entries where org_id=$1 and source_type='sales_invoice' and source_id=$2 order by id", [o.id, invoiceId])).rows.map((r) => r.id as number);

console.log("ACC-01 — weighted-average inventory costing, COGS and reconciliation");

// ═════════════════════════════════════════════════════════════════════════════════════════════
const A = await mkOrg("SAR");
const pA = await mkProduct(A, "A");

section("0. arithmetic");
check("WAC: 3 units out of 10 worth 1000.00 cost 300.00", weightedAverageCost({ quantity: 10, value: "1000" }, 3, "SAR") === "300.00");
check("WAC: the units that empty the pool take exactly what is left (3 of 3 worth 100.01)", weightedAverageCost({ quantity: 3, value: "100.01" }, 3, "SAR") === "100.01");
check("WAC: 1 of 3 worth 100.00 is 33.33 (minor unit, SAR)", weightedAverageCost({ quantity: 3, value: "100" }, 1, "SAR") === "33.33");
check("WAC: 1 of 3 worth 100.000 is 33.333 in a 3-decimal currency (KWD)", weightedAverageCost({ quantity: 3, value: "100" }, 1, "KWD") === "33.333");
{
  let worst = 0;
  for (let i = 0; i < 2000; i++) {
    const n = 1 + Math.floor(Math.random() * 6);
    const weights = Array.from({ length: n }, () => Math.round(Math.random() * 100000) / 100);
    const total = (Math.round(Math.random() * 10_000_000) / 100).toFixed(2);
    const parts = allocateByWeight(total, weights, "SAR");
    worst = Math.max(worst, Math.abs(mils(parts.reduce((s, p) => s + Number(p), 0)) - mils(total)));
  }
  check("allocation: 2,000 random splits each sum to their total exactly (largest remainder)", worst === 0, `worst miss ${worst} mils`);
  const p = allocateByWeight("100.00", [1, 1, 1], "SAR");
  check("allocation: 100.00 over three equal lines is 33.34 / 33.33 / 33.33", p.join(" ") === "33.34 33.33 33.33", p.join(" "));
}
check("unit cost: blank is 'not given', negative and junk are refusals", parseUnitCost("") === null && parseUnitCost(null) === null
  && (() => { try { parseUnitCost("-1"); return false; } catch (e) { return isInventoryRefusal(e); } })()
  && (() => { try { parseUnitCost("abc"); return false; } catch (e) { return isInventoryRefusal(e); } })());

section("1. opening stock");
// 10 units at 25.50 = 255.00, Dr 1200 / Cr 3000.
const op = await db.transaction((tx) => recordOpeningStock(tx, ctx(A), { productId: pA, quantity: 10, unitCost: 25.5 }));
check("opening: the pool is 10 units worth 255.00", JSON.stringify(await poolOf(pA)) === JSON.stringify({ onHand: 10, valued: 10, value: "255.000" }), JSON.stringify(await poolOf(pA)));
const opEntry = (await pool.query("select id, source_type, source_id from journal_entries where org_id=$1 and source_type='inventory_opening'", [A.id])).rows;
check("opening: one entry keyed (inventory_opening, <movement id>)", opEntry.length === 1 && opEntry[0].source_id === op!.movementId, JSON.stringify(opEntry));
{
  const l = await entryLines(opEntry[0].id);
  check("opening: Dr 1200 Inventory 255.00 / Cr 3000 Owner's Equity 255.00", eq(line(l, "1200")[0]?.debit, 255) && eq(line(l, "3000")[0]?.credit, 255) && l.length === 2, JSON.stringify(l));
  const m = (await pool.query("select kind, quantity, total_cost::text c, journal_entry_id from inventory_movements where id=$1", [op!.movementId])).rows[0];
  check("opening: the movement is traceable — kind opening, +10, 255.00, linked to its entry", m.kind === "opening" && m.quantity === 10 && eq(m.c, 255) && m.journal_entry_id === opEntry[0].id, JSON.stringify(m));
}
{
  const pX = await mkProduct(A, "NOCOST");
  const r = await refusalOf(() => db.transaction((tx) => recordOpeningStock(tx, ctx(A), { productId: pX, quantity: 5, unitCost: null })));
  check("opening: a quantity without a unit cost is REFUSED — never valued at zero", !!r && /unit cost/.test(r.message) && /تكلفة/.test(r.ar), r?.message ?? "no refusal");
  check("opening: …and nothing was written", JSON.stringify(await poolOf(pX)) === JSON.stringify({ onHand: 0, valued: 0, value: "0.000" })
    && (await pool.query("select count(*)::int n from inventory_movements where product_id=$1", [pX])).rows[0].n === 0);
  const zero = await db.transaction((tx) => recordOpeningStock(tx, ctx(A), { productId: pX, quantity: 2, unitCost: 0 }));
  check("opening: an EXPLICIT zero cost is a cost — 2 units valued at 0.00, movement costed, no entry (nothing to post)",
    !!zero && eq(zero.cost, 0) && (await poolOf(pX)).valued === 2 && (await pool.query("select total_cost::text c from inventory_movements where id=$1", [zero.movementId])).rows[0].c === "0.000");
}

section("2. receipt cost (net of discount, VAT out, non-stock expensed)");
// PO: A 10 × 30 = 300 + free-text service 100 → subtotal 400, discount 40 → net 360, VAT 15% 54, total 414.
// Net spreads by line value: A 300/400 × 360 = 270.00, the service line 90.00.
const po1 = await mkPo(A, [{ productId: pA, qty: "10", price: "30", tax: "15" }, { productId: null, qty: "1", price: "100", tax: "15" }], { discount: "40" });
const r1 = await receive(A, po1);
{
  const l = await entryLines(r1.entryId);
  check("receipt: Dr 1200 270.00 (stock at net cost)", eq(line(l, "1200")[0]?.debit, 270), JSON.stringify(l));
  check("receipt: Dr 5100 90.00 (the non-stock line, expensed)", eq(line(l, "5100")[0]?.debit, 90), JSON.stringify(l));
  check("receipt: Dr 2100 54.00 (VAT is recoverable input tax, not cost)", eq(line(l, "2100")[0]?.debit, 54), JSON.stringify(l));
  check("receipt: Cr 2000 414.00 (AP carries the gross)", eq(line(l, "2000")[0]?.credit, 414) && l.length === 4, JSON.stringify(l));
  const m = await movements(A, "purchase_order", po1);
  check("receipt: one receipt movement, +10 at 270.00, linked to the entry", m.length === 1 && m[0].kind === "receipt" && m[0].quantity === 10 && eq(m[0].total_cost, 270) && m[0].journal_entry_id === r1.entryId, JSON.stringify(m));
}

section("3. weighted-average cost");
// Pool: 10 @ 255.00 + 10 @ 270.00 = 20 units, 525.00 → average 26.25.
check("WAC: 20 units worth 525.00 (average 26.25)", JSON.stringify(await poolOf(pA)) === JSON.stringify({ onHand: 20, valued: 20, value: "525.000" }), JSON.stringify(await poolOf(pA)));

section("4. multiple receipts at different costs");
// 5 × 40.00 = 200.00, no VAT → 25 units, 725.00 → average 29.00.
const po2 = await mkPo(A, [{ productId: pA, qty: "5", price: "40" }]);
await receive(A, po2);
check("WAC: after a dearer receipt, 25 units worth 725.00 (average 29.00)", JSON.stringify(await poolOf(pA)) === JSON.stringify({ onHand: 25, valued: 25, value: "725.000" }), JSON.stringify(await poolOf(pA)));

section("5–7. partial delivery, full delivery, COGS posting");
// Issue 7: 7 × 725 / 25 = 203.00 → pool 18 units, 522.00.
const inv1 = await mkInvoice(A, [{ productId: pA, qty: "7", price: "50" }]);
await send(A, inv1);
const inv1Entries = await invoiceEntry(A, inv1);
{
  const l = await entryLines(inv1Entries[0]);
  // Revenue 350.00 + VAT 52.50 = AR 402.50; COGS 203.00.
  check("COGS: the invoice's own entry carries Dr 5000 203.00 / Cr 1200 203.00", eq(line(l, "5000")[0]?.debit, 203) && eq(line(l, "1200")[0]?.credit, 203), JSON.stringify(l));
  check("COGS: …beside Dr 1100 402.50 / Cr 4000 350.00 / Cr 2100 52.50, balanced", eq(line(l, "1100")[0]?.debit, 402.5) && eq(line(l, "4000")[0]?.credit, 350) && eq(line(l, "2100")[0]?.credit, 52.5), JSON.stringify(l));
  check("partial: 18 units worth 522.00 remain", JSON.stringify(await poolOf(pA)) === JSON.stringify({ onHand: 18, valued: 18, value: "522.000" }), JSON.stringify(await poolOf(pA)));
  const m = await movements(A, "sales_invoice", inv1);
  check("issue: one costed movement, −7 at −203.00, linked to the invoice entry", m.length === 1 && m[0].kind === "issue" && m[0].quantity === -7 && eq(m[0].total_cost, -203) && m[0].journal_entry_id === inv1Entries[0], JSON.stringify(m));
}
// A delivery challan for part of the invoice moves nothing — the invoice already issued the stock.
{
  const dc = (await pool.query(`insert into delivery_challans (org_id,dc_number,customer_id,source_invoice_id,created_by_id)
    values ($1,$2,(select customer_id from sales_invoices where id=$3),$3,$4) returning id`, [A.id, `DC-${uniq()}`, inv1, A.user])).rows[0].id;
  await pool.query("insert into delivery_challan_items (delivery_challan_id,product_id,description,quantity) values ($1,$2,'part',3)", [dc, pA]);
  const n = (await pool.query("select count(*)::int n from inventory_movements where org_id=$1 and product_id=$2", [A.id, pA])).rows[0].n;
  check("partial delivery: a delivery challan adds no movement and no stock change (no double issue)", n === 4 && (await poolOf(pA)).onHand === 18, `movements ${n}`);
}
// Issue the remaining 18: the pool empties, so the issue takes exactly 522.00 — no residue on zero units.
const inv2 = await mkInvoice(A, [{ productId: pA, qty: "18", price: "50" }]);
await send(A, inv2);
{
  const l = await entryLines((await invoiceEntry(A, inv2))[0]);
  check("full delivery: the last 18 units cost exactly the remaining 522.00", eq(line(l, "5000")[0]?.debit, 522) && eq(line(l, "1200")[0]?.credit, 522), JSON.stringify(l));
  check("full delivery: the pool is exactly 0 units / 0.00", JSON.stringify(await poolOf(pA)) === JSON.stringify({ onHand: 0, valued: 0, value: "0.000" }), JSON.stringify(await poolOf(pA)));
}

section("8. repeated posting without duplication");
{
  const again = await send(A, inv2).then(() => "posted", (e) => (isInventoryRefusal(e) ? `refused: ${e.message}` : `error: ${e}`));
  check("re-posting a posted invoice is a no-op (idempotent by journal identity)", again === "posted"
    && (await invoiceEntry(A, inv2)).length === 1 && (await movements(A, "sales_invoice", inv2)).length === 1, again);
}

section("9–10. returns and cost reversal, cancellation / reversal");
// Product B: receipt 10 × 20.00 (VAT 15%: 30.00) — pool 10 / 200.00.
const pB = await mkProduct(A, "B");
const poB = await mkPo(A, [{ productId: pB, qty: "10", price: "20", tax: "15" }]);
await receive(A, poB);
// Return 3 at 20.00: net 60.00 + VAT 9.00 = 69.00. Relieved at the credited value: pool 7 / 140.00.
const dnB = await mkDn(A, poB, [{ productId: pB, qty: "3", price: "20", tax: "15" }]);
const rB = await issueDn(A, dnB);
{
  const l = await entryLines(rB.entryId);
  check("purchase return: Dr 2000 69.00 / Cr 1200 60.00 / Cr 2100 9.00", eq(line(l, "2000")[0]?.debit, 69) && eq(line(l, "1200")[0]?.credit, 60) && eq(line(l, "2100")[0]?.credit, 9) && l.length === 3, JSON.stringify(l));
  check("purchase return: pool 7 units worth 140.00 (cost reversed at the purchase price)", JSON.stringify(await poolOf(pB)) === JSON.stringify({ onHand: 7, valued: 7, value: "140.000" }), JSON.stringify(await poolOf(pB)));
}
await reverseDn(A, dnB);
{
  check("debit note reversed: pool back to exactly 10 / 200.00", JSON.stringify(await poolOf(pB)) === JSON.stringify({ onHand: 10, valued: 10, value: "200.000" }), JSON.stringify(await poolOf(pB)));
  const m = await movements(A, "debit_note", dnB);
  check("debit note reversed: a reversal movement points at the return it undoes", m.length === 2 && m[1].kind === "reversal" && m[1].reverses_movement_id === m[0].id && m[1].quantity === 3 && eq(m[1].total_cost, 60), JSON.stringify(m));
  const again = await db.transaction((tx) => reverseSourceMovements(tx, ctx(A), { sourceType: "debit_note", sourceId: dnB, journalEntryId: null, memo: "again" }, ["purchase_return"]));
  check("a second reversal finds nothing left to reverse (no double cost reversal)", again.reversed === 0 && (await poolOf(pB)).valued === 10);
}
// Sell 4 of B at WAC 20.00 → COGS 80.00, then void: the cost comes back exactly.
const invB = await mkInvoice(A, [{ productId: pB, qty: "4", price: "35" }]);
await send(A, invB);
const before5000 = await gl(A, "5000");
await voidInv(A, invB);
{
  const e = await invoiceEntry(A, invB);
  const rev = await entryLines(e[1]);
  check("void: the reversal mirrors the COGS lines — Dr 1200 80.00 / Cr 5000 80.00", eq(line(rev, "1200")[0]?.debit, 80) && eq(line(rev, "5000")[0]?.credit, 80), JSON.stringify(rev));
  check("void: 5000 falls by exactly 80.00", mils(before5000) - mils(await gl(A, "5000")) === 80000, `${before5000} → ${await gl(A, "5000")}`);
  check("void: pool back to 10 / 200.00", JSON.stringify(await poolOf(pB)) === JSON.stringify({ onHand: 10, valued: 10, value: "200.000" }), JSON.stringify(await poolOf(pB)));
  const m = await movements(A, "sales_invoice", invB);
  check("void: the reversal movement is linked to the reversal entry", m.length === 2 && m[1].reverses_movement_id === m[0].id && m[1].journal_entry_id === e[1], JSON.stringify(m));
}
{
  // A cancelled PO was never received: it carries no movement and no entry.
  const poC = await mkPo(A, [{ productId: pB, qty: "2", price: "20" }]);
  await pool.query("update purchase_orders set status='cancelled' where id=$1", [poC]);
  check("cancellation: a cancelled purchase order has no movement and no entry",
    (await movements(A, "purchase_order", poC)).length === 0 && (await pool.query("select count(*)::int n from journal_entries where source_type='purchase_order' and source_id=$1", [poC])).rows[0].n === 0);
}

section("11–12. inventory-to-GL reconciliation, P&L and Balance Sheet");
{
  const rec = await getInventoryReconciliation(A.id, A.currency);
  // Valued stock: A 0 + NOCOST 2 @ 0 + B 10 @ 200.00 = 200.00.
  check("reconciliation: GL 1200 = valued stock = Σ movements = 200.00", eq(rec.glInventory, 200) && eq(rec.valuedStock, 200) && eq(rec.movementValue, 200), JSON.stringify(rec));
  check("reconciliation: integrity holds and nothing is unattributed — the ledger IS the valuation", rec.integrityOk && rec.reconciled && rec.unattributed.length === 0, JSON.stringify(rec.unattributed));
  const val = await getInventoryValuation(A.id, A.currency);
  check("valuation report: total 200.00, B at average 20, no stock without a cost basis", eq(val.totalValue, 200) && Number(val.rows.find((r) => r.sku === "B")?.averageCost) === 20 && val.unvaluedProducts === 0, JSON.stringify(val.rows));
  check("every entry the org posted balances", (await unbalancedEntries(A)) === 0);

  const pnl = await getProfitAndLoss(A.id, RANGE);
  // Revenue 350 + 900 (+140 voided → net 0) = 1250.00; COGS 203 + 522 (+80 −80) = 725.00; opex 90.00.
  check("P&L: revenue 1,250.00", Math.round(pnl.revenueTotal * 100) === 125000, String(pnl.revenueTotal));
  check("P&L: cost of sales 725.00 — every unit sold, at weighted-average cost", Math.round(pnl.costOfSalesTotal * 100) === 72500, String(pnl.costOfSalesTotal));
  check("P&L: gross profit 525.00 = revenue − cost of sales", Math.round(pnl.grossProfit * 100) === 52500, String(pnl.grossProfit));
  check("P&L: operating expenses 90.00 (the expensed service line); net profit 435.00", Math.round(pnl.operatingExpensesTotal * 100) === 9000 && Math.round(pnl.netProfit * 100) === 43500, `${pnl.operatingExpensesTotal} / ${pnl.netProfit}`);
  const bs = await getBalanceSheet(A.id, RANGE);
  const invLine = bs.currentAssets.find((l) => l.code === "1200");
  check("Balance Sheet: Inventory 200.00 = the valuation", Math.round((invLine?.amount ?? 0) * 100) === 20000, JSON.stringify(invLine));
  check("Balance Sheet: balances, the current-period result = the P&L's net profit", bs.balanced && Math.round(bs.currentPeriodProfit * 100) === 43500, `${bs.balanced} ${bs.currentPeriodProfit}`);
}

section("13. services and non-stock lines");
{
  const svc = await mkProduct(A, "SVC", { itemType: "service" });
  const inv = await mkInvoice(A, [{ productId: svc, qty: "3", price: "100" }, { productId: null, qty: "1", price: "50" }]);
  await send(A, inv);
  const l = await entryLines((await invoiceEntry(A, inv))[0]);
  check("service sale: no movement, no COGS, no stock change", (await movements(A, "sales_invoice", inv)).length === 0 && line(l, "5000").length === 0
    && (await poolOf(svc)).onHand === 0, JSON.stringify(l));
  const poS = await mkPo(A, [{ productId: svc, qty: "2", price: "75", tax: "15" }]);
  const rs = await receive(A, poS);
  const lp = await entryLines(rs.entryId);
  check("service purchase: expensed to 5100 (150.00), VAT 22.50 to 2100, no inventory line, no movement",
    eq(line(lp, "5100")[0]?.debit, 150) && eq(line(lp, "2100")[0]?.debit, 22.5) && line(lp, "1200").length === 0 && (await movements(A, "purchase_order", poS)).length === 0, JSON.stringify(lp));
  const r = await refusalOf(() => db.transaction((tx) => recordOpeningStock(tx, ctx(A), { productId: svc, quantity: 1, unitCost: 10 })));
  check("service: opening stock is refused — services carry no stock", !!r && /service/.test(r.message));
  const change = await db.transaction((tx) => itemTypeChangeRefusal(tx, A.id, pB));
  check("item type: a product with stock history cannot change type", !!change);
  const fresh = await mkProduct(A, "FRESH");
  check("item type: a product with no stock and no history can", (await db.transaction((tx) => itemTypeChangeRefusal(tx, A.id, fresh))) === null);
}

section("14. missing or invalid cost; stock with no cost basis");
{
  const r = await refusalOf(() => db.transaction((tx) => adjustStock(tx, ctx(A), { productId: pB, delta: 5, unitCost: null, reason: "count" })));
  check("adjustment: adding stock without a unit cost is refused", !!r && /unit cost/.test(r.message));
  const r2 = await refusalOf(() => db.transaction((tx) => adjustStock(tx, ctx(A), { productId: pB, delta: 1, unitCost: parseUnitCost("-3"), reason: "x" })));
  check("adjustment: a negative unit cost is refused", !!r2 && /zero or more/.test(r2.message));
  // A pre-ACC-01 product: 6 units written straight into quantity_on_hand, no cost basis anywhere.
  const pL = await mkProduct(A, "LEGACY", { legacyQty: 6 });
  const inv = await mkInvoice(A, [{ productId: pL, qty: "2", price: "40" }]);
  await send(A, inv);
  const m = await movements(A, "sales_invoice", inv);
  const l = await entryLines((await invoiceEntry(A, inv))[0]);
  check("no cost basis: the sale posts, as an explicitly UNCOSTED movement (cost NULL, not 0.00)", m.length === 1 && m[0].total_cost === null && m[0].quantity === -2, JSON.stringify(m));
  check("no cost basis: no COGS line is invented", line(l, "5000").length === 0 && line(l, "1200").length === 0, JSON.stringify(l));
  const rec = await getInventoryReconciliation(A.id, A.currency);
  check("no cost basis: the reconciliation counts the uncosted issue (1 movement, 2 units)", rec.uncostedIssues.movements === 1 && rec.uncostedIssues.quantity === 2, JSON.stringify(rec.uncostedIssues));
  const val = await getInventoryValuation(A.id, A.currency);
  check("no cost basis: the valuation lists the 4 remaining units as having none", val.rows.find((r) => r.sku === "LEGACY")?.unvaluedQuantity === 4, JSON.stringify(val.rows.find((r) => r.sku === "LEGACY")));
  await voidInv(A, inv);
  check("no cost basis: voiding that sale puts the 2 units back, still uncosted", (await poolOf(pL)).onHand === 6 && (await poolOf(pL)).valued === 0
    && (await getInventoryReconciliation(A.id, A.currency)).uncostedIssues.movements === 0);
}

section("15. negative stock prevention");
{
  const before = await poolOf(pB);
  const inv = await mkInvoice(A, [{ productId: pB, qty: "11", price: "30" }]);
  const r = await refusalOf(() => send(A, inv));
  check("an invoice for 11 of 10 on hand is refused, naming the product and both counts", !!r && /10 on hand, 11 required/.test(r.message) && /المتوفر 10 والمطلوب 11/.test(r.ar), r?.message ?? "no refusal");
  check("…and nothing was written: no entry, no movement, stock unchanged", (await invoiceEntry(A, inv)).length === 0 && (await movements(A, "sales_invoice", inv)).length === 0
    && JSON.stringify(await poolOf(pB)) === JSON.stringify(before));
  const two = await mkInvoice(A, [{ productId: pB, qty: "6", price: "30" }, { productId: pB, qty: "5", price: "30" }]);
  check("two lines of the same product are summed: 6 + 5 of 10 is refused", !!(await refusalOf(() => send(A, two))));
  const r2 = await refusalOf(() => db.transaction((tx) => adjustStock(tx, ctx(A), { productId: pB, delta: -11, unitCost: null, reason: "x" })));
  check("an adjustment below zero is refused", !!r2);
  const frac = await mkInvoice(A, [{ productId: pB, qty: "2.5", price: "30" }]);
  const r3 = await refusalOf(() => send(A, frac));
  check("a fractional quantity of a stock item is refused (never truncated)", !!r3 && /whole units/.test(r3.message), r3?.message ?? "no refusal");
}

section("16. rounding and multi-currency");
{
  const U = await mkOrg("SAR");
  await pool.query("insert into exchange_rates (org_id,from_currency,to_currency,rate,effective_date,source) values ($1,'USD','SAR','3.75000000',$2,'manual')", [U.id, TODAY]);
  const p = await mkProduct(U, "USD-1");
  // 3 × 33.33 USD = 99.99 USD → × 3.75 = 374.9625 → 374.96 SAR.
  const po = await mkPo(U, [{ productId: p, qty: "3", price: "33.33" }], { currency: "USD" });
  const r = await receive(U, po);
  check("foreign receipt: 99.99 USD enters the pool at 374.96 SAR (receipt-date rate 3.75)", eq((await poolOf(p)).value, 374.96) && eq(r.inventory, 374.96), JSON.stringify(await poolOf(p)));
  // Sell 1 in USD: COGS is BASE — 374.96 / 3 = 124.9866… → 124.99, whatever the invoice currency.
  const inv = await mkInvoice(U, [{ productId: p, qty: "1", price: "50" }], { currency: "USD" });
  await send(U, inv);
  const l = await entryLines((await invoiceEntry(U, inv))[0]);
  check("foreign sale: COGS 124.99 SAR at the average, independent of the invoice's currency", eq(line(l, "5000")[0]?.debit, 124.99), JSON.stringify(l));
  const inv2 = await mkInvoice(U, [{ productId: p, qty: "2", price: "50" }]);
  await send(U, inv2);
  const l2 = await entryLines((await invoiceEntry(U, inv2))[0]);
  check("rounding: the last 2 units take exactly the remaining 249.97 — nothing stranded", eq(line(l2, "5000")[0]?.debit, 249.97) && JSON.stringify(await poolOf(p)) === JSON.stringify({ onHand: 0, valued: 0, value: "0.000" }), JSON.stringify(l2));
  // A debit note against the USD PO converts at the PO's stored rate — inherited, never looked up.
  const p2 = await mkProduct(U, "USD-2");
  const poR = await mkPo(U, [{ productId: p2, qty: "4", price: "10" }], { currency: "USD" });
  await receive(U, poR);
  const dn = await mkDn(U, poR, [{ productId: p2, qty: "1", price: "10" }]);
  const rd = await issueDn(U, dn);
  check("foreign return: relieved at the PO's rate — 10 USD × 3.75 = 37.50 SAR", eq(rd.inventoryCredit, 37.5) && eq((await poolOf(p2)).value, 112.5), JSON.stringify(await poolOf(p2)));
  check("every entry the USD org posted balances", (await unbalancedEntries(U)) === 0);

  const K = await mkOrg("KWD");
  const pk = await mkProduct(K, "KWD-1");
  await db.transaction((tx) => recordOpeningStock(tx, ctx(K), { productId: pk, quantity: 3, unitCost: 0.3333 }));
  // 3 × 0.3333 = 0.9999 → 1.000 KWD (3 decimals, half away from zero).
  check("KWD: opening value rounds to the fils (0.9999 → 1.000)", eq((await poolOf(pk)).value, 1), JSON.stringify(await poolOf(pk)));
  const invK = await mkInvoice(K, [{ productId: pk, qty: "1", price: "1" }]);
  await send(K, invK);
  const lk = await entryLines((await invoiceEntry(K, invK))[0]);
  check("KWD: one of three units costs 0.333 (third decimal kept)", eq(line(lk, "5000")[0]?.debit, 0.333), JSON.stringify(lk));
}

section("17. concurrency");
{
  const C = await mkOrg("SAR");
  const pc = await mkProduct(C, "CONC");
  await db.transaction((tx) => recordOpeningStock(tx, ctx(C), { productId: pc, quantity: 10, unitCost: 7 }));
  // Two invoices of 6 each against 10 on hand, posted at once: exactly one may succeed.
  const i1 = await mkInvoice(C, [{ productId: pc, qty: "6", price: "10" }]);
  const i2 = await mkInvoice(C, [{ productId: pc, qty: "6", price: "10" }]);
  const outcomes = await Promise.allSettled([send(C, i1), send(C, i2)]);
  const ok = outcomes.filter((o) => o.status === "fulfilled").length;
  const refused = outcomes.filter((o) => o.status === "rejected" && isInventoryRefusal(o.reason)).length;
  check("concurrent sales of 6 + 6 against 10: one posts, the other is refused — stock never negative", ok === 1 && refused === 1, JSON.stringify(outcomes.map((o) => o.status)));
  check("…the pool is 4 units worth 28.00", JSON.stringify(await poolOf(pc)) === JSON.stringify({ onHand: 4, valued: 4, value: "28.000" }), JSON.stringify(await poolOf(pc)));
  // The same invoice posted twice at once: one entry, one set of movements (the invoice row lock).
  const i3 = await mkInvoice(C, [{ productId: pc, qty: "1", price: "10" }]);
  await Promise.allSettled([send(C, i3), send(C, i3)]);
  check("the same invoice posted twice concurrently: one entry, one movement", (await invoiceEntry(C, i3)).length === 1 && (await movements(C, "sales_invoice", i3)).length === 1);
  // Five concurrent sales of 1 from 3 left: three post, two are refused, the pool empties exactly.
  const many = await Promise.all(Array.from({ length: 5 }, () => mkInvoice(C, [{ productId: pc, qty: "1", price: "10" }])));
  const res = await Promise.allSettled(many.map((i) => send(C, i)));
  check("five concurrent sales of 1 from 3: exactly three post", res.filter((o) => o.status === "fulfilled").length === 3, JSON.stringify(res.map((o) => o.status)));
  const rec = await getInventoryReconciliation(C.id, C.currency);
  check("…and the pool, the movements and GL 1200 all read 0.00", JSON.stringify(await poolOf(pc)) === JSON.stringify({ onHand: 0, valued: 0, value: "0.000" }) && rec.reconciled && eq(rec.glInventory, 0), JSON.stringify(rec));
}

section("18. tenant isolation and role gates");
{
  const B = await mkOrg("SAR");
  const before = await poolOf(pB);
  const inv = await mkInvoice(B, [{ productId: pB, qty: "1", price: "10" }]);
  const r = await refusalOf(() => send(B, inv));
  check("an invoice in org B naming org A's product is refused — never a silent skip", !!r && /does not exist in this organization/.test(r.message), r?.message ?? "no refusal");
  check("…and org A's stock is untouched", JSON.stringify(await poolOf(pB)) === JSON.stringify(before));
  const r2 = await refusalOf(() => db.transaction((tx) => adjustStock(tx, ctx(B), { productId: pB, delta: -1, unitCost: null, reason: "x" })));
  check("org B cannot adjust org A's product", !!r2);
  const recB = await getInventoryReconciliation(B.id, B.currency);
  const valB = await getInventoryValuation(B.id, B.currency);
  check("org B's valuation and reconciliation see none of org A's stock or ledger", valB.rows.length === 0 && eq(recB.glInventory, 0) && eq(recB.valuedStock, 0), JSON.stringify(recB));
  const src = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
  const PRODUCTS = "src/app/(app)/inventory/products/actions.ts";
  const fnBody = (s: string, name: string) => s.slice(s.indexOf(`export async function ${name}(`), s.indexOf("\n}\n", s.indexOf(`export async function ${name}(`)));
  check("role gates unchanged: create / update / adjust require a session first; permanent delete stays owner-only",
    ["createProductAction", "updateProductAction", "adjustStockAction"].every((n) => /^[^\n]*\n\s*const session = await requireSession\(\);/.test(fnBody(src(PRODUCTS), n)))
      && /const session = await requireRole\("owner"\);/.test(fnBody(src(PRODUCTS), "permanentlyDeleteProductAction")));
  const del = fnBody(src(PRODUCTS), "permanentlyDeleteProductAction");
  check("permanent delete refuses a product with stock history, before deleting anything (its movements are the ledger's audit trail)",
    /from\(inventoryMovementsTable\)[\s\S]*eq\(inventoryMovementsTable\.orgId, session\.orgId\)[\s\S]*if \(history\) return \{ error:/.test(del)
      && del.indexOf("if (history) return") < del.indexOf(".delete(productsTable)"));
  check("every stock query in the engine is scoped to the org (no product lock or movement read without org_id)",
    (src("src/lib/inventory-costing.ts").match(/from products\b[^`]*`/g) ?? []).every((q) => /org_id = \$\{/.test(q))
      && (src("src/lib/inventory-costing.ts").match(/from inventory_movements\b[^`]*`/g) ?? []).every((q) => /org_id = \$\{/.test(q)));
}

section("mixed scenarios");
{
  const M = await mkOrg("SAR");
  const s1 = await mkProduct(M, "S1");
  const s2 = await mkProduct(M, "S2", { legacyQty: 5 });
  const sv = await mkProduct(M, "SV", { itemType: "service" });
  await db.transaction((tx) => recordOpeningStock(tx, ctx(M), { productId: s1, quantity: 4, unitCost: 12.5 }));
  await db.transaction((tx) => recordOpeningStock(tx, ctx(M), { productId: s2, quantity: 2, unitCost: 30 }));
  // One invoice: 3 of S1 (valued: 37.50), 4 of S2 (2 valued at 60.00 + 2 with no cost basis), a service, a free-text line.
  const inv = await mkInvoice(M, [
    { productId: s1, qty: "3", price: "20" }, { productId: s2, qty: "4", price: "50" },
    { productId: sv, qty: "1", price: "500" }, { productId: null, qty: "1", price: "75" },
  ], { discount: "35" });
  await send(M, inv);
  const l = await entryLines((await invoiceEntry(M, inv))[0]);
  check("mixed invoice: COGS = 37.50 + 60.00 = 97.50 — valued units only, the uncosted 2 explicit", eq(line(l, "5000")[0]?.debit, 97.5), JSON.stringify(l));
  const m = await movements(M, "sales_invoice", inv);
  check("mixed invoice: S1 −3 costed; S2 −2 costed and −2 uncosted; nothing for the service or the free-text line",
    m.length === 3 && m.filter((x) => x.total_cost === null).length === 1 && m.every((x) => x.product_id !== sv), JSON.stringify(m));
  check("mixed invoice: the entry balances with its discount (revenue derived)", (await unbalancedEntries(M)) === 0);
  // A closing return at a credited value different from the carrying cost: the difference goes to 5000.
  const p3 = await mkProduct(M, "S3");
  const po = await mkPo(M, [{ productId: p3, qty: "4", price: "10" }]);
  await receive(M, po);
  const sale = await mkInvoice(M, [{ productId: p3, qty: "2", price: "15" }]);
  await send(M, sale);
  const dn = await mkDn(M, po, [{ productId: p3, qty: "2", price: "11" }]);
  const rd = await issueDn(M, dn);
  const ld = await entryLines(rd.entryId);
  check("closing return: the last 2 units relieve exactly the 20.00 left; the extra 2.00 credit reduces COGS",
    eq(rd.inventoryCredit, 20) && eq(rd.variance, 2) && eq(line(ld, "5000")[0]?.credit, 2) && JSON.stringify(await poolOf(p3)) === JSON.stringify({ onHand: 0, valued: 0, value: "0.000" }), JSON.stringify(ld));
  // A return of a product with mixed lines: VAT and the non-stock line go back where the receipt put them.
  const p4 = await mkProduct(M, "S4");
  const po4 = await mkPo(M, [{ productId: p4, qty: "5", price: "8", tax: "15" }, { productId: null, qty: "1", price: "60", tax: "15" }]);
  await receive(M, po4);
  const dn4 = await mkDn(M, po4, [{ productId: p4, qty: "1", price: "8", tax: "15" }, { productId: null, qty: "1", price: "60", tax: "15" }]);
  const r4 = await issueDn(M, dn4);
  const l4 = await entryLines(r4.entryId);
  check("mixed return: Cr 1200 8.00 · Cr 5100 60.00 · Cr 2100 10.20 against Dr 2000 78.20",
    eq(line(l4, "1200")[0]?.credit, 8) && eq(line(l4, "5100")[0]?.credit, 60) && eq(line(l4, "2100")[0]?.credit, 10.2) && eq(line(l4, "2000")[0]?.debit, 78.2), JSON.stringify(l4));
  const rec = await getInventoryReconciliation(M.id, M.currency);
  check("mixed org: integrity holds; GL 1200 = valuation; one uncosted issue reported", rec.integrityOk && rec.reconciled && rec.uncostedIssues.movements === 1, JSON.stringify(rec));
  check("mixed org: every entry balances", (await unbalancedEntries(M)) === 0);
}
{
  // Legacy (pre-ACC-01) data: a receipt capitalised gross with no movement, and an invoice posted
  // with the old decrement and no movement. The reconciliation isolates the first; the void of the
  // second restores its quantity without inventing a cost.
  const L = await mkOrg("SAR");
  const p = await mkProduct(L, "OLD", { legacyQty: 8 });
  const je = (await pool.query("insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id) values ($1,$2,'old receipt','purchase_order',999999,$3) returning id",
    [L.id, TODAY, L.user])).rows[0].id;
  await pool.query("insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,'115.00','0'),($1,$3,'0','115.00')", [je, L.acc.get("1200"), L.acc.get("2000")]);
  const rec = await getInventoryReconciliation(L.id, L.currency);
  check("legacy ledger: the pre-ACC-01 receipt is listed as unattributed purchase_order value (115.00), integrity still holds",
    rec.integrityOk && !rec.reconciled && rec.unattributed.length === 1 && rec.unattributed[0].sourceType === "purchase_order" && eq(rec.unattributed[0].amount, 115), JSON.stringify(rec.unattributed));
  const inv = await mkInvoice(L, [{ productId: p, qty: "3", price: "10" }]);
  const invNo = (await pool.query("select invoice_number from sales_invoices where id=$1", [inv])).rows[0].invoice_number;
  const old = (await pool.query("insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id) values ($1,$2,'old','sales_invoice',$3,$4) returning id", [L.id, TODAY, inv, L.user])).rows[0].id;
  await pool.query("insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,'34.50','0'),($1,$3,'0','30.00'),($1,$4,'0','4.50')", [old, L.acc.get("1100"), L.acc.get("4000"), L.acc.get("2100")]);
  await pool.query("update products set quantity_on_hand = quantity_on_hand - 3 where id=$1", [p]);
  await pool.query("update sales_invoices set status='sent' where id=$1", [inv]);
  await voidInv(L, inv);
  const m = await movements(L, "sales_invoice", inv);
  check(`legacy void (${invNo}): the old decrement is restored, 3 units, uncosted, no COGS reversal invented`,
    (await poolOf(p)).onHand === 8 && m.length === 1 && m[0].total_cost === null && m[0].quantity === 3 && eq(await gl(L, "5000"), 0), JSON.stringify(m));
}
{
  // The integrity check is not vacuous: tamper with one pool and it must fail.
  const T = await mkOrg("SAR");
  const p = await mkProduct(T, "TAMPER");
  await db.transaction((tx) => recordOpeningStock(tx, ctx(T), { productId: p, quantity: 2, unitCost: 5 }));
  await pool.query("update products set stock_value = stock_value + 1 where id=$1", [p]);
  const rec = await getInventoryReconciliation(T.id, T.currency);
  check("negative control: a tampered pool fails integrity and is named", !rec.integrityOk && rec.poolMismatches.length === 1 && rec.poolMismatches[0].sku === "TAMPER", JSON.stringify(rec.poolMismatches));
}

await sweep();
await pool.end();
await appPool.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
