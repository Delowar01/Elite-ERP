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
 *   multi-currency · 17 concurrency · 18 tenant isolation and role gates · 19 supplier returns at the
 *   weighted average when the credit differs from it · 20 customer goods returns on credit notes ·
 *   21 return requests: each line once, each submission once — then mixed scenarios.
 *
 * Every expected figure is worked out by hand in the comments beside it, never read back from the
 * code under test.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { db, pool as appPool } from "../src/db";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../src/db/schema/accounting";
import { computeTotals } from "../src/app/(app)/sales/_shared/totals";
import { roundMoney } from "../src/lib/currency/currencies";
import { captureBaseAmounts } from "../src/lib/posting-currency";
import { creditNoteLines, noteBaseAmounts } from "../src/lib/reversal-currency";
import { returnCreditNoteGoods, reverseCreditNoteReturns } from "../src/lib/credit-note-returns";
import { prepareInvoicePosting, reverseInvoicePosting } from "../src/lib/invoice-posting";
import { postPurchaseReceipt, postPurchaseReturn, reversePurchaseReturn } from "../src/lib/purchase-posting";
import {
  adjustStock, allocateByWeight, isInventoryRefusal, itemTypeChangeRefusal, parseUnitCost, recordOpeningStock,
  returnFromCustomer, reverseSourceMovements, weightedAverageCost,
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
    `delete from credit_note_items where credit_note_id in (select id from credit_notes where org_id in ${orgs})`,
    `delete from credit_notes where org_id in ${orgs}`,
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

// ---- credit notes: the financial half as issueCreditNoteAction posts it; the goods half through the posting code ----
async function mkCn(o: Org, invoiceId: number, lines: DocLineIn[]) {
  const inv = (await pool.query("select customer_id, currency from sales_invoices where id=$1", [invoiceId])).rows[0];
  const cur = inv.currency ?? o.currency;
  const t = computeTotals(lines.map((l) => ({ quantity: l.qty, unitPrice: l.price, taxRatePercent: l.tax ?? "15" })), "0", cur);
  const id = (await pool.query(`insert into credit_notes (org_id,credit_note_number,customer_id,source_invoice_id,currency,issue_date,subtotal,tax_total,total,status,created_by_id)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10) returning id`,
    [o.id, `CN-${uniq()}`, inv.customer_id, invoiceId, inv.currency, TODAY, t.subtotal, t.taxTotal, t.total, o.user])).rows[0].id as number;
  const lineIds: number[] = [];
  for (const l of lines) {
    lineIds.push((await pool.query(`insert into credit_note_items (credit_note_id,product_id,description,quantity,unit_price,tax_rate_percent,line_total)
      values ($1,$2,'returned',$3,$4,$5,$6) returning id`, [id, l.productId, l.qty, l.price, l.tax ?? "15", roundMoney(Number(l.qty) * Number(l.price), cur)])).rows[0].id as number);
  }
  return { id, lines: lineIds };
}
/** Issue: Dr 4000 / Dr 2100 / Cr 1100 at the invoice's stored rate — the credit note's financial half, no stock. */
async function issueCn(o: Org, cnId: number) {
  const cn = (await pool.query("select credit_note_number, source_invoice_id, currency, total::text total, tax_total::text tax_total from credit_notes where id=$1", [cnId])).rows[0];
  const inv = (await pool.query("select currency, exchange_rate::text exchange_rate, total::text total, base_total::text base_total, base_tax_amount::text base_tax_amount from sales_invoices where id=$1", [cn.source_invoice_id])).rows[0];
  const captured = noteBaseAmounts({
    baseCurrency: o.currency,
    source: { currency: inv.currency, exchangeRate: inv.exchange_rate, total: inv.total, baseTotal: inv.base_total, baseTaxAmount: inv.base_tax_amount },
    note: { currency: cn.currency, total: cn.total, taxTotal: cn.tax_total },
    priorNotes: { total: "0", baseTotal: "0", baseTaxAmount: "0" },
  });
  if (!captured.ok) throw new Error(captured.error);
  await db.transaction(async (tx) => {
    const e = (await tx.execute(sql`insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id)
      values (${o.id}, ${TODAY}, ${`Credit note ${cn.credit_note_number} issued`}, 'credit_note', ${cnId}, ${o.user}) returning id`)).rows[0] as { id: number };
    const lines = creditNoteLines({
      baseTotal: captured.baseTotal, baseRevenue: roundMoney(Number(captured.baseTotal) - Number(captured.baseTaxAmount), o.currency), baseTaxAmount: captured.baseTaxAmount,
      arAccountId: o.acc.get("1100")!, revenueAccountId: o.acc.get("4000")!, vatAccountId: o.acc.get("2100")!,
    });
    for (const l of lines) await tx.execute(sql`insert into journal_lines (journal_entry_id,account_id,debit,credit) values (${e.id}, ${l.accountId}, ${l.debit}, ${l.credit})`);
    await tx.execute(sql`update credit_notes set status = 'issued', exchange_rate = ${captured.exchangeRate}, base_total = ${captured.baseTotal}, base_tax_amount = ${captured.baseTaxAmount} where id = ${cnId}`);
  });
}
/** Goods back to stock against an issued note — the posting returnCreditNoteGoodsAction runs. Each call is a new
 *  submission (a fresh key, as each opening of the return dialog makes) unless a key is given to replay one. */
const returnGoods = (o: Org, cnId: number, request: { lineId: number; quantity: number | string }[], requestKey: string = randomUUID()) =>
  db.transaction((tx) => returnCreditNoteGoods(tx, { orgId: o.id, userId: o.user, baseCurrency: o.currency, date: TODAY, creditNoteId: cnId, requestKey, request }));
/** Reverse a note as reverseCreditNoteAction does: its row lock, its goods back out, the financial mirror, status reversed. */
async function reverseCn(o: Org, cnId: number) {
  const cn = (await pool.query("select credit_note_number from credit_notes where id=$1", [cnId])).rows[0];
  return db.transaction(async (tx) => {
    await tx.execute(sql`select status from credit_notes where id = ${cnId} and org_id = ${o.id} for update`);
    const goods = await reverseCreditNoteReturns(tx, { orgId: o.id, userId: o.user, baseCurrency: o.currency, date: TODAY, creditNote: { id: cnId, creditNoteNumber: cn.credit_note_number } });
    const posting = (await tx.execute(sql`select id from journal_entries where org_id = ${o.id} and source_type = 'credit_note' and source_id = ${cnId} order by id limit 1`)).rows[0] as { id: number };
    const e = (await tx.execute(sql`insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id)
      values (${o.id}, ${TODAY}, 'reversed', 'credit_note', ${cnId}, ${o.user}) returning id`)).rows[0] as { id: number };
    await tx.execute(sql`insert into journal_lines (journal_entry_id,account_id,debit,credit) select ${e.id}, account_id, credit, debit from journal_lines where journal_entry_id = ${posting.id}`);
    await tx.execute(sql`update credit_notes set status = 'reversed' where id = ${cnId}`);
    return goods;
  });
}
const returnEntries = async (o: Org, cnId: number) => (await pool.query(
  "select id from journal_entries where org_id=$1 and source_type='sales_return' and source_id=$2 order by id", [o.id, cnId])).rows.map((r) => r.id as number);

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
// Return 3 at 20.00: net 60.00 + VAT 9.00 = 69.00. The units leave at the average, 20.00 — here also the
// price credited, so no variance: pool 7 / 140.00.
const dnB = await mkDn(A, poB, [{ productId: pB, qty: "3", price: "20", tax: "15" }]);
const rB = await issueDn(A, dnB);
{
  const l = await entryLines(rB.entryId);
  check("purchase return: Dr 2000 69.00 / Cr 1200 60.00 / Cr 2100 9.00", eq(line(l, "2000")[0]?.debit, 69) && eq(line(l, "1200")[0]?.credit, 60) && eq(line(l, "2100")[0]?.credit, 9) && l.length === 3, JSON.stringify(l));
  check("purchase return: pool 7 units worth 140.00 (left at the average, 20.00, here the price credited)", JSON.stringify(await poolOf(pB)) === JSON.stringify({ onHand: 7, valued: 7, value: "140.000" }), JSON.stringify(await poolOf(pB)));
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
  // A service a posted document names stays a service: the document moved no stock for it, so after the change
  // its void, a goods return against it or its reversal would read it as pre-ACC-01 and move stock that never moved.
  const T = await mkOrg();
  const toStock = (p: number) => db.transaction((tx) => itemTypeChangeRefusal(tx, T.id, p));
  const svcI = await mkProduct(T, "SVC-I", { itemType: "service" });
  await send(T, await mkInvoice(T, [{ productId: svcI, qty: "2", price: "40" }]));
  const svcP = await mkProduct(T, "SVC-P", { itemType: "service" });
  await receive(T, await mkPo(T, [{ productId: svcP, qty: "1", price: "30" }]));
  const svcD = await mkProduct(T, "SVC-D", { itemType: "service" });
  const poFree = await mkPo(T, [{ productId: null, qty: "1", price: "100" }]);
  await receive(T, poFree);
  await issueDn(T, await mkDn(T, poFree, [{ productId: svcD, qty: "1", price: "10" }]));
  const svcDraft = await mkProduct(T, "SVC-DRAFT", { itemType: "service" });
  await mkInvoice(T, [{ productId: svcDraft, qty: "1", price: "5" }]);
  const onSent = await toStock(svcI);
  check("item type: a service on a sent invoice cannot become a stock item — its void or a goods return against it would put back units that never left stock",
    /cannot become a stock item/.test(onSent?.message ?? "") && /لا يمكن تحويلها إلى صنف مخزني/.test(onSent?.ar ?? ""), onSent?.message);
  check("…nor a service on a received purchase order, nor one on an issued debit note",
    /cannot become a stock item/.test((await toStock(svcP))?.message ?? "") && /cannot become a stock item/.test((await toStock(svcD))?.message ?? ""));
  check("…while a service named only on a draft invoice can (its posting reads the type the product has then)", (await toStock(svcDraft)) === null);
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
  check("foreign return: credited at the PO's rate (10 USD × 3.75 = 37.50 SAR); the unit leaves at the average, here also 37.50", eq(rd.inventoryCredit, 37.5) && eq((await poolOf(p2)).value, 112.5), JSON.stringify(await poolOf(p2)));
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

section("19. supplier returns at the weighted average — a credit that differs from it");
{
  const W = await mkOrg("SAR");
  const pw = await mkProduct(W, "WAC-RET");
  // Two receipts at different prices (VAT 15%): 10 × 20.00 = 200.00 and 10 × 26.00 = 260.00 → 20 / 460.00, average 23.00.
  const po1 = await mkPo(W, [{ productId: pw, qty: "10", price: "20", tax: "15" }]);
  await receive(W, po1);
  const po2 = await mkPo(W, [{ productId: pw, qty: "10", price: "26", tax: "15" }]);
  await receive(W, po2);
  check("multiple purchase prices: 20 units worth 460.00 — average 23.00", JSON.stringify(await poolOf(pw)) === JSON.stringify({ onHand: 20, valued: 20, value: "460.000" }), JSON.stringify(await poolOf(pw)));
  // Return 4 of the dearer receipt: the supplier credits 4 × 26.00 = 104.00 + VAT 15.60 = 119.60. The 4 units
  // leave at the average, 4 × 23.00 = 92.00; the 12.00 the credit exceeds that by is the price variance.
  const dn1 = await mkDn(W, po2, [{ productId: pw, qty: "4", price: "26", tax: "15" }]);
  const r1 = await issueDn(W, dn1);
  const l1 = await entryLines(r1.entryId);
  check("partial return credited above the average: Dr 2000 119.60 / Cr 1200 92.00 (4 × 23.00) · Cr 2100 15.60 · Cr 5000 12.00",
    eq(line(l1, "2000")[0]?.debit, 119.6) && eq(line(l1, "1200")[0]?.credit, 92) && eq(line(l1, "2100")[0]?.credit, 15.6) && eq(line(l1, "5000")[0]?.credit, 12) && l1.length === 4, JSON.stringify(l1));
  check("…the supplier's credit recorded at what it is (AP 119.60) and the 16 units left keep their average: 16 / 368.00, 23.00 each",
    eq(r1.variance, 12) && JSON.stringify(await poolOf(pw)) === JSON.stringify({ onHand: 16, valued: 16, value: "368.000" }), JSON.stringify(await poolOf(pw)));
  const m1 = await movements(W, "debit_note", dn1);
  check("…the purchase_return movement leaves at the average: −4 at −92.00, linked to the entry",
    m1.length === 1 && m1[0].kind === "purchase_return" && m1[0].quantity === -4 && eq(m1[0].total_cost, -92) && m1[0].journal_entry_id === r1.entryId, JSON.stringify(m1));
  // Return 2 of the cheaper receipt: credited 2 × 20.00 = 40.00 + VAT 6.00; the units cost 46.00 at the average — 6.00 short.
  const dn2 = await mkDn(W, po1, [{ productId: pw, qty: "2", price: "20", tax: "15" }]);
  const r2 = await issueDn(W, dn2);
  const l2 = await entryLines(r2.entryId);
  check("partial return credited below the average: Dr 2000 46.00 · Dr 5000 6.00 / Cr 1200 46.00 (2 × 23.00) · Cr 2100 6.00",
    eq(line(l2, "2000")[0]?.debit, 46) && eq(line(l2, "5000")[0]?.debit, 6) && eq(line(l2, "1200")[0]?.credit, 46) && eq(line(l2, "2100")[0]?.credit, 6) && l2.length === 4, JSON.stringify(l2));
  check("…14 / 322.00 left, still 23.00 each", JSON.stringify(await poolOf(pw)) === JSON.stringify({ onHand: 14, valued: 14, value: "322.000" }), JSON.stringify(await poolOf(pw)));
  // Reverse the first return: the units come back at the 92.00 they left at, and the whole entry is mirrored — variance too.
  const before5000 = await gl(W, "5000");
  await reverseDn(W, dn1);
  check("supplier-return reversal: 18 / 414.00 — the units back at exactly the cost they left at",
    JSON.stringify(await poolOf(pw)) === JSON.stringify({ onHand: 18, valued: 18, value: "414.000" }), JSON.stringify(await poolOf(pw)));
  check("…and its mirror takes the 12.00 variance back out of cost of sales", mils(await gl(W, "5000")) - mils(before5000) === 12000, `${before5000} → ${await gl(W, "5000")}`);

  // Rounding, then a full return: 2 × 10.00 + 1 × 10.01 → 3 / 30.01 (average 10.0033…).
  const pf = await mkProduct(W, "WAC-FULL");
  const poA = await mkPo(W, [{ productId: pf, qty: "2", price: "10" }]);
  await receive(W, poA);
  const poB = await mkPo(W, [{ productId: pf, qty: "1", price: "10.01" }]);
  await receive(W, poB);
  const rb = await issueDn(W, await mkDn(W, poB, [{ productId: pf, qty: "1", price: "10.01" }]));
  check("rounding: 1 of 3 worth 30.01 leaves at 10.00 (the minor unit); the 0.01 credited above it is variance",
    eq(rb.inventoryCredit, 10) && eq(rb.variance, 0.01) && JSON.stringify(await poolOf(pf)) === JSON.stringify({ onHand: 2, valued: 2, value: "20.010" }), JSON.stringify(await poolOf(pf)));
  const ra = await issueDn(W, await mkDn(W, poA, [{ productId: pf, qty: "2", price: "10" }]));
  check("full return: the last 2 relieve exactly the 20.01 left — nothing stranded on zero units; the 0.01 the credit falls short is variance",
    eq(ra.inventoryCredit, 20.01) && eq(ra.variance, -0.01) && JSON.stringify(await poolOf(pf)) === JSON.stringify({ onHand: 0, valued: 0, value: "0.000" }), JSON.stringify(await poolOf(pf)));

  // Multi-currency: 5 × 10.00 USD and 2 × 10.04 USD at 3.75 → 187.50 + 75.30 = 262.80 SAR for 7 (average 37.542857…).
  await pool.query("insert into exchange_rates (org_id,from_currency,to_currency,rate,effective_date,source) values ($1,'USD','SAR','3.75000000',$2,'manual')", [W.id, TODAY]);
  const pu = await mkProduct(W, "WAC-USD");
  const pu1 = await mkPo(W, [{ productId: pu, qty: "5", price: "10" }], { currency: "USD" });
  await receive(W, pu1);
  const pu2 = await mkPo(W, [{ productId: pu, qty: "2", price: "10.04" }], { currency: "USD" });
  await receive(W, pu2);
  // Return the 2: credited 20.08 USD at the PO's rate = 75.30 SAR; they leave at 262.80 × 2 / 7 = 75.0857… → 75.09.
  const ru2 = await issueDn(W, await mkDn(W, pu2, [{ productId: pu, qty: "2", price: "10.04" }]));
  check("USD return: credited 2 × 10.04 USD × 3.75 = 75.30 SAR (the PO's rate); the units leave at the average, 75.09; variance 0.21",
    eq(ru2.inventoryCredit, 75.09) && eq(ru2.variance, 0.21) && eq((await poolOf(pu)).value, 187.71), JSON.stringify(await poolOf(pu)));
  const ru1 = await issueDn(W, await mkDn(W, pu1, [{ productId: pu, qty: "5", price: "10" }]));
  check("USD full return: credited 187.50; the last 5 relieve exactly the 187.71 left (−0.21 variance) — the two variances net to zero",
    eq(ru1.inventoryCredit, 187.71) && eq(ru1.variance, -0.21) && JSON.stringify(await poolOf(pu)) === JSON.stringify({ onHand: 0, valued: 0, value: "0.000" }), JSON.stringify(await poolOf(pu)));

  // A debit note in another organization naming this one's product is refused.
  const X = await mkOrg("SAR");
  const px = await mkProduct(X, "X-OWN");
  const pox = await mkPo(X, [{ productId: px, qty: "1", price: "5" }]);
  await receive(X, pox);
  const foreign = await refusalOf(() => mkDn(X, pox, [{ productId: pw, qty: "1", price: "5" }]).then((dn) => issueDn(X, dn)));
  check("tenant isolation: a debit note in another organization naming this one's product is refused, its stock untouched",
    !!foreign && /does not exist in this organization/.test(foreign.message) && (await poolOf(pw)).onHand === 18, foreign?.message ?? "no refusal");
  const recW = await getInventoryReconciliation(W.id, W.currency);
  check("supplier returns: GL 1200 = valuation, integrity holds, nothing unattributed; every entry balances",
    recW.integrityOk && recW.reconciled && (await unbalancedEntries(W)) === 0, JSON.stringify(recW));
}

section("20. customer goods returns on credit notes");
const R = await mkOrg("SAR");
const g = await mkProduct(R, "RET-G");
// Two receipts: 4 × 10.00 and 4 × 14.00 → 8 / 96.00, average 12.00. Sell 5 at 30.00: COGS 60.00; 3 / 36.00 left.
await receive(R, await mkPo(R, [{ productId: g, qty: "4", price: "10" }]));
await receive(R, await mkPo(R, [{ productId: g, qty: "4", price: "14" }]));
const invG = await mkInvoice(R, [{ productId: g, qty: "5", price: "30" }]);
await send(R, invG);
const issueG = (await movements(R, "sales_invoice", invG))[0];
const poolIs = async (p: number, onHand: number, valued: number, value: string) => JSON.stringify(await poolOf(p)) === JSON.stringify({ onHand, valued, value });
const cnB = await mkCn(R, invG, [{ productId: g, qty: "3", price: "30" }]);
{
  const g1200 = await gl(R, "1200");
  const g5000 = await gl(R, "5000");
  // A — financial only: a credit note for 1 unit is issued and nothing comes back.
  const cnA = await mkCn(R, invG, [{ productId: g, qty: "1", price: "30" }]);
  await issueCn(R, cnA.id);
  check("credit note without returned goods: no movement and no stock entry; stock 3 / 36.00; GL 1200 and 5000 unchanged (revenue, VAT and AR only)",
    (await movements(R, "credit_note", cnA.id)).length === 0 && (await returnEntries(R, cnA.id)).length === 0 && await poolIs(g, 3, 3, "36.000")
      && (await gl(R, "1200")) === g1200 && (await gl(R, "5000")) === g5000, JSON.stringify(await poolOf(g)));

  // B — 3 credited: 2 come back now, 1 later. The invoice issued them at 12.00 each (60.00 for 5).
  await issueCn(R, cnB.id);
  const rB = await returnGoods(R, cnB.id, [{ lineId: cnB.lines[0], quantity: 2 }]);
  const eB = await returnEntries(R, cnB.id);
  const lB = eB.length ? await entryLines(eB[0]) : [];
  check("partial return: 2 units back at the cost the invoice issued them at — Dr 1200 24.00 / Cr 5000 24.00, keyed (sales_return, the note)",
    eq(rB.cost, 24) && eB.length === 1 && eq(line(lB, "1200")[0]?.debit, 24) && eq(line(lB, "5000")[0]?.credit, 24) && lB.length === 2, JSON.stringify(lB));
  const mB = await movements(R, "credit_note", cnB.id);
  const lineOf = Number((await pool.query("select source_line_id from inventory_movements where id=$1", [mB[0]?.id])).rows[0]?.source_line_id);
  check("…a sales_return movement +2 at 24.00, linked to the invoice's stock issue, the note's line and the entry",
    mB.length === 1 && mB[0].kind === "sales_return" && mB[0].quantity === 2 && eq(mB[0].total_cost, 24) && mB[0].reverses_movement_id === issueG.id
      && lineOf === cnB.lines[0] && mB[0].journal_entry_id === eB[0], JSON.stringify(mB));
  check("…stock 5 / 60.00 — the average is still 12.00", await poolIs(g, 5, 5, "60.000"), JSON.stringify(await poolOf(g)));
  const rB2 = await returnGoods(R, cnB.id, [{ lineId: cnB.lines[0], quantity: "1" }]);
  check("a second part on the same note: 1 more at 12.00 — stock 6 / 72.00", eq(rB2.cost, 12) && await poolIs(g, 6, 6, "72.000"), JSON.stringify(await poolOf(g)));
  const dupB = await refusalOf(() => returnGoods(R, cnB.id, [{ lineId: cnB.lines[0], quantity: 1 }]));
  check("duplicate restocking refused: the note credits 3 and all 3 came back — nothing written",
    !!dupB && /credits 3, of which 3 already came back/.test(dupB.message) && (await movements(R, "credit_note", cnB.id)).length === 2, dupB?.message ?? "no refusal");

  // C — another note against the same invoice returns the last 2 of the 5 issued: exactly what is left of the 60.00.
  const cnC = await mkCn(R, invG, [{ productId: g, qty: "2", price: "30" }]);
  await issueCn(R, cnC.id);
  const rC = await returnGoods(R, cnC.id, [{ lineId: cnC.lines[0], quantity: 2 }]);
  check("multiple credit notes against one invoice: the last 2 of the 5 come back at exactly the 24.00 left of the issue — 8 / 96.00",
    eq(rC.cost, 24) && await poolIs(g, 8, 8, "96.000"), JSON.stringify(await poolOf(g)));
  check("…the whole sale returned: GL 1200 back to 96.00, 5000 back to 0.00", eq(await gl(R, "1200"), 96) && eq(await gl(R, "5000"), 0), `${await gl(R, "1200")} / ${await gl(R, "5000")}`);
  // D — the invoice has nothing left to give back.
  const cnD = await mkCn(R, invG, [{ productId: g, qty: "1", price: "30" }]);
  await issueCn(R, cnD.id);
  const overD = await refusalOf(() => returnGoods(R, cnD.id, [{ lineId: cnD.lines[0], quantity: 1 }]));
  check("over-return refused: never more than the invoice issued (5 issued, 5 back) — nothing written",
    !!overD && /only 0 of the units this invoice issued/.test(overD.message) && (await movements(R, "credit_note", cnD.id)).length === 0, overD?.message ?? "no refusal");
  const overLine = await refusalOf(() => returnGoods(R, cnD.id, [{ lineId: cnD.lines[0], quantity: 2 }]));
  check("…nor more than the note's line credits (1 credited, 2 asked)", !!overLine && /credits 1, of which 0 already came back/.test(overLine.message), overLine?.message ?? "no refusal");

  // Reverse C: nothing has left stock since its return, so it comes off exactly.
  const revC = await reverseCn(R, cnC.id);
  const eC = await returnEntries(R, cnC.id);
  const lC = eC.length > 1 ? await entryLines(eC[1]) : [];
  check("customer-return reversal: the 2 go back out exactly as they came in — Dr 5000 24.00 / Cr 1200 24.00; stock 6 / 72.00",
    eq(revC.cost, 24) && eC.length === 2 && eq(line(lC, "5000")[0]?.debit, 24) && eq(line(lC, "1200")[0]?.credit, 24) && await poolIs(g, 6, 6, "72.000"), JSON.stringify(lC));
  const mC = await movements(R, "credit_note", cnC.id);
  check("…a reversal movement points at the return it undoes",
    mC.length === 2 && mC[1].kind === "reversal" && mC[1].reverses_movement_id === mC[0].id && mC[1].quantity === -2 && eq(mC[1].total_cost, -24), JSON.stringify(mC));
  const againC = await db.transaction((tx) => reverseCreditNoteReturns(tx, { orgId: R.id, userId: R.user, baseCurrency: R.currency, date: TODAY, creditNote: { id: cnC.id, creditNoteNumber: "again" } }));
  check("…a second reversal finds nothing to take out (no double reversal)", againC.reversed === 0 && await poolIs(g, 6, 6, "72.000"));
  const rD = await returnGoods(R, cnD.id, [{ lineId: cnD.lines[0], quantity: 1 }]);
  check("…which gives the 2 back to the invoice's issue: D now returns 1 at 12.00 — stock 7 / 84.00", eq(rD.cost, 12) && await poolIs(g, 7, 7, "84.000"), JSON.stringify(await poolOf(g)));
  check("a reversed credit note returns nothing", /issued credit note/.test((await refusalOf(() => returnGoods(R, cnC.id, [{ lineId: cnC.lines[0], quantity: 1 }])))?.message ?? ""));
  const cnDraft = await mkCn(R, invG, [{ productId: g, qty: "1", price: "30" }]);
  check("a draft credit note returns nothing", /issued credit note/.test((await refusalOf(() => returnGoods(R, cnDraft.id, [{ lineId: cnDraft.lines[0], quantity: 1 }])))?.message ?? ""));
  check("a fractional quantity is refused", /whole quantities/.test((await refusalOf(() => returnGoods(R, cnD.id, [{ lineId: cnD.lines[0], quantity: "0.5" }])))?.message ?? ""));
}
{
  // A note with a stock line, a service line and a free-text line: only the stock line can come back.
  const sv = await mkProduct(R, "RET-SVC", { itemType: "service" });
  const s2 = await mkProduct(R, "RET-S2");
  await receive(R, await mkPo(R, [{ productId: s2, qty: "3", price: "7" }]));
  const inv = await mkInvoice(R, [{ productId: s2, qty: "3", price: "12" }, { productId: sv, qty: "1", price: "100" }, { productId: null, qty: "1", price: "20" }]);
  await send(R, inv);
  const cn = await mkCn(R, inv, [{ productId: s2, qty: "2", price: "12" }, { productId: sv, qty: "1", price: "100" }, { productId: null, qty: "1", price: "20" }]);
  await issueCn(R, cn.id);
  check("mixed note: a service line has no stock to return", /not a stock item/.test((await refusalOf(() => returnGoods(R, cn.id, [{ lineId: cn.lines[1], quantity: 1 }])))?.message ?? ""));
  check("mixed note: a free-text line has no stock to return", /not a stock item/.test((await refusalOf(() => returnGoods(R, cn.id, [{ lineId: cn.lines[2], quantity: 1 }])))?.message ?? ""));
  const r = await returnGoods(R, cn.id, [{ lineId: cn.lines[0], quantity: 2 }, { lineId: cn.lines[1], quantity: 0 }]);
  check("mixed note: the stock line's 2 come back at 14.00 (2 × 7.00); zero lines are ignored", eq(r.cost, 14) && await poolIs(s2, 2, 2, "14.000"), JSON.stringify(await poolOf(s2)));
}
{
  // An exact reversal is not the average: 2 sold at 10.00 come back into a pool now averaging 16.00 (blended to 13.00);
  // reversed before anything leaves, they go back out at their own 20.00 and the pool is again 2 / 32.00 at 16.00.
  const h = await mkProduct(R, "RET-H");
  await receive(R, await mkPo(R, [{ productId: h, qty: "2", price: "10" }]));
  const invH = await mkInvoice(R, [{ productId: h, qty: "2", price: "25" }]);
  await send(R, invH);                                                              // COGS 20.00; 0 / 0
  await receive(R, await mkPo(R, [{ productId: h, qty: "2", price: "16" }]));      // 2 / 32.00
  const cnH = await mkCn(R, invH, [{ productId: h, qty: "2", price: "25" }]);
  await issueCn(R, cnH.id);
  const rH = await returnGoods(R, cnH.id, [{ lineId: cnH.lines[0], quantity: 2 }]);
  check("a return comes back at its sale's cost (20.00), not today's average (16.00): 4 / 52.00", eq(rH.cost, 20) && await poolIs(h, 4, 4, "52.000"), JSON.stringify(await poolOf(h)));
  const revH = await reverseCn(R, cnH.id);
  check("…reversed with no stock gone out since: back out at exactly 20.00 — the pool is precisely 2 / 32.00 again (average 16.00, not 13.00)",
    eq(revH.cost, 20) && await poolIs(h, 2, 2, "32.000"), JSON.stringify(await poolOf(h)));
}
{
  // Reversal after stock went out in between: the returned units are no longer separable — they leave at the average.
  const k = await mkProduct(R, "RET-K");
  await receive(R, await mkPo(R, [{ productId: k, qty: "2", price: "10" }]));
  const invK = await mkInvoice(R, [{ productId: k, qty: "2", price: "25" }]);
  await send(R, invK);
  const cnK = await mkCn(R, invK, [{ productId: k, qty: "2", price: "25" }]);
  await issueCn(R, cnK.id);
  await returnGoods(R, cnK.id, [{ lineId: cnK.lines[0], quantity: 2 }]);          // 2 / 20.00
  await receive(R, await mkPo(R, [{ productId: k, qty: "2", price: "16" }]));      // 4 / 52.00, average 13.00
  await send(R, await mkInvoice(R, [{ productId: k, qty: "1", price: "25" }]));    // COGS 13.00; 3 / 39.00
  const revK = await reverseCn(R, cnK.id);
  check("reversal after stock went out in between: the 2 leave at the average, 2 × 13.00 = 26.00 — 1 / 13.00 left, its average unchanged",
    eq(revK.cost, 26) && await poolIs(k, 1, 1, "13.000"), JSON.stringify(await poolOf(k)));
  // The returned goods sold again: the reversal cannot take them back out, and writes nothing.
  const q = await mkProduct(R, "RET-Q");
  await receive(R, await mkPo(R, [{ productId: q, qty: "1", price: "5" }]));
  const invQ = await mkInvoice(R, [{ productId: q, qty: "1", price: "9" }]);
  await send(R, invQ);
  const cnQ = await mkCn(R, invQ, [{ productId: q, qty: "1", price: "9" }]);
  await issueCn(R, cnQ.id);
  await returnGoods(R, cnQ.id, [{ lineId: cnQ.lines[0], quantity: 1 }]);
  await send(R, await mkInvoice(R, [{ productId: q, qty: "1", price: "9" }]));
  const refusedQ = await refusalOf(() => reverseCn(R, cnQ.id));
  const stQ = (await pool.query("select status from credit_notes where id=$1", [cnQ.id])).rows[0].status;
  check("reversal refused when the returned goods are gone — nothing written, the note stays issued",
    !!refusedQ && /no longer all in stock/.test(refusedQ.message) && stQ === "issued" && (await movements(R, "credit_note", cnQ.id)).length === 1 && await poolIs(q, 0, 0, "0.000"), refusedQ?.message ?? "no refusal");
}
{
  // The void guard: a zero-value note (goods back for an exchange) leaves the invoice unsettled, so void stays open.
  const v = await mkProduct(R, "RET-VOID");
  await receive(R, await mkPo(R, [{ productId: v, qty: "2", price: "10" }]));
  const invV = await mkInvoice(R, [{ productId: v, qty: "2", price: "15" }]);
  await send(R, invV);
  const cnV = await mkCn(R, invV, [{ productId: v, qty: "1", price: "0" }]);
  await issueCn(R, cnV.id);
  await returnGoods(R, cnV.id, [{ lineId: cnV.lines[0], quantity: 1 }]);
  const blocked = await refusalOf(() => voidInv(R, invV));
  check("void refused while a credit note's returned goods stand against the sale (the same units would come back twice)",
    !!blocked && /Reverse those credit notes/.test(blocked.message) && await poolIs(v, 1, 1, "10.000"), blocked?.message ?? "no refusal");
  await reverseCn(R, cnV.id);
  await voidInv(R, invV);
  check("…once the note is reversed the void goes through: both units back, 2 / 20.00", await poolIs(v, 2, 2, "20.000"), JSON.stringify(await poolOf(v)));
}
{
  // Multi-currency: a USD invoice in a SAR organization — COGS and its return are BASE, whatever the documents' currency.
  await pool.query("insert into exchange_rates (org_id,from_currency,to_currency,rate,effective_date,source) values ($1,'USD','SAR','3.75000000',$2,'manual')", [R.id, TODAY]);
  const u = await mkProduct(R, "RET-USD");
  await db.transaction((tx) => recordOpeningStock(tx, ctx(R), { productId: u, quantity: 3, unitCost: 33.33 }));   // 99.99 SAR
  const invU = await mkInvoice(R, [{ productId: u, qty: "3", price: "20" }], { currency: "USD" });
  await send(R, invU);                                                                                                // COGS 99.99 SAR
  const cnU = await mkCn(R, invU, [{ productId: u, qty: "3", price: "20" }]);
  await issueCn(R, cnU.id);
  const a = await returnGoods(R, cnU.id, [{ lineId: cnU.lines[0], quantity: 1 }]);
  const b = await returnGoods(R, cnU.id, [{ lineId: cnU.lines[0], quantity: 2 }]);
  check("USD credit note: 1 of 3 back at 33.33 SAR, the last 2 at exactly the 66.66 left — 99.99 restored in base, independent of the note's currency",
    eq(a.cost, 33.33) && eq(b.cost, 66.66) && await poolIs(u, 3, 3, "99.990"), `${a.cost} + ${b.cost}`);
  const K = await mkOrg("KWD");
  const pk = await mkProduct(K, "RET-KWD");
  await db.transaction((tx) => recordOpeningStock(tx, ctx(K), { productId: pk, quantity: 3, unitCost: 0.3333 }));  // 1.000 KWD
  const invK = await mkInvoice(K, [{ productId: pk, qty: "3", price: "1" }]);
  await send(K, invK);
  const cnK = await mkCn(K, invK, [{ productId: pk, qty: "3", price: "1" }]);
  await issueCn(K, cnK.id);
  const ka = await returnGoods(K, cnK.id, [{ lineId: cnK.lines[0], quantity: 1 }]);
  const kb = await returnGoods(K, cnK.id, [{ lineId: cnK.lines[0], quantity: 2 }]);
  check("KWD rounding: 1 of 3 back at 0.333, the last 2 at exactly the 0.667 left — 1.000 restored, 5000 back to 0.000",
    eq(ka.cost, 0.333) && eq(kb.cost, 0.667) && await poolIs(pk, 3, 3, "1.000") && eq(await gl(K, "5000"), 0), `${ka.cost} + ${kb.cost}`);
}
{
  // Concurrency: two notes racing for a sale's last unit, and two separate submissions on one note racing for its last
  // unit (a double click — one submission sent twice — is section 21's).
  const c = await mkProduct(R, "RET-CONC");
  await receive(R, await mkPo(R, [{ productId: c, qty: "2", price: "8" }]));
  const invC = await mkInvoice(R, [{ productId: c, qty: "1", price: "12" }]);
  await send(R, invC);
  const n1 = await mkCn(R, invC, [{ productId: c, qty: "1", price: "12" }]);
  await issueCn(R, n1.id);
  const n2 = await mkCn(R, invC, [{ productId: c, qty: "1", price: "12" }]);
  await issueCn(R, n2.id);
  const race = await Promise.allSettled([returnGoods(R, n1.id, [{ lineId: n1.lines[0], quantity: 1 }]), returnGoods(R, n2.id, [{ lineId: n2.lines[0], quantity: 1 }])]);
  check("two credit notes racing for the sale's last unit: one returns it, the other is refused",
    race.filter((o) => o.status === "fulfilled").length === 1 && race.filter((o) => o.status === "rejected" && isInventoryRefusal(o.reason)).length === 1 && await poolIs(c, 2, 2, "16.000"),
    JSON.stringify(race.map((o) => o.status)));
  const invC2 = await mkInvoice(R, [{ productId: c, qty: "2", price: "12" }]);
  await send(R, invC2);
  const n3 = await mkCn(R, invC2, [{ productId: c, qty: "1", price: "12" }]);
  await issueCn(R, n3.id);
  const dbl = await Promise.allSettled([returnGoods(R, n3.id, [{ lineId: n3.lines[0], quantity: 1 }]), returnGoods(R, n3.id, [{ lineId: n3.lines[0], quantity: 1 }])]);
  check("two submissions on one note racing for its last unit: one return, the second refused by the line's cap (the note's row lock)",
    dbl.filter((o) => o.status === "fulfilled").length === 1 && dbl.filter((o) => o.status === "rejected" && isInventoryRefusal(o.reason)).length === 1 && await poolIs(c, 1, 1, "8.000"),
    JSON.stringify(dbl.map((o) => o.status)));
}
{
  // Tenant isolation: another organization can neither return against nor reverse this one's note.
  const X = await mkOrg("SAR");
  const before = await poolOf(g);
  const r = await refusalOf(() => returnGoods(X, cnB.id, [{ lineId: cnB.lines[0], quantity: 1 }]));
  check("another organization cannot return goods against this one's credit note — not found, nothing written",
    !!r && /not found/.test(r.message) && JSON.stringify(await poolOf(g)) === JSON.stringify(before), r?.message ?? "no refusal");
  const rx = await db.transaction((tx) => reverseCreditNoteReturns(tx, { orgId: X.id, userId: X.user, baseCurrency: X.currency, date: TODAY, creditNote: { id: cnB.id, creditNoteNumber: "x" } }));
  check("…nor take its returned goods back out: the query is scoped to the organization and finds nothing",
    rx.reversed === 0 && JSON.stringify(await poolOf(g)) === JSON.stringify(before));
  const src = readFileSync(path.join(ROOT, "src/app/(app)/sales/credit-notes/actions.ts"), "utf8");
  const fnBody = (name: string) => src.slice(src.indexOf(`export async function ${name}(`), src.indexOf("\n}\n", src.indexOf(`export async function ${name}(`)));
  check("role gates: returning goods takes the gate issuing and reversing a credit note take (a session first), and the reversal re-checks its status under the note's row lock",
    ["issueCreditNoteAction", "reverseCreditNoteAction", "returnCreditNoteGoodsAction"].every((n) => /^[^\n]*\n\s*const session = await requireSession\(\);/.test(fnBody(n)))
      && /select status from credit_notes where id = \$\{cn\.id\} and org_id = \$\{session\.orgId\} for update/.test(fnBody("reverseCreditNoteAction")));
}
{
  // Uncosted stock: units a sale issued with no cost basis come back first — still uncosted. A cost is never invented.
  const U = await mkOrg("SAR");
  const u = await mkProduct(U, "RET-UNC", { legacyQty: 3 });
  await db.transaction((tx) => recordOpeningStock(tx, ctx(U), { productId: u, quantity: 2, unitCost: 10 }));    // 5 on hand, 2 / 20.00
  const invU = await mkInvoice(U, [{ productId: u, qty: "4", price: "15" }]);
  await send(U, invU);                                                                                         // 2 costed (20.00) + 2 uncosted
  const recBefore = await getInventoryReconciliation(U.id, U.currency);
  const cnU = await mkCn(U, invU, [{ productId: u, qty: "3", price: "15" }]);
  await issueCn(U, cnU.id);
  const rU = await returnGoods(U, cnU.id, [{ lineId: cnU.lines[0], quantity: 3 }]);
  const mU = await movements(U, "credit_note", cnU.id);
  check("uncosted units come back first, still uncosted (last out, first back), then 1 costed unit at its issue's cost 10.00 — no cost invented",
    eq(rU.cost, 10) && mU.length === 2 && mU[0].total_cost === null && mU[0].quantity === 2 && eq(mU[1].total_cost, 10) && mU[1].quantity === 1, JSON.stringify(mU));
  check("…stock 4 on hand, 1 / 10.00 valued — the 3 without a cost basis stay without one", await poolIs(u, 4, 1, "10.000"), JSON.stringify(await poolOf(u)));
  const recAfter = await getInventoryReconciliation(U.id, U.currency);
  check("…the sale's missing COGS (2 uncosted units) is gone once they came back; GL 1200 = valuation",
    recBefore.uncostedIssues.quantity === 2 && recAfter.uncostedIssues.quantity === 0 && recAfter.integrityOk && recAfter.reconciled, JSON.stringify(recAfter.uncostedIssues));
  // A pre-ACC-01 invoice (the old decrement, no movements): its units come back uncosted, up to what it sold.
  const p = await mkProduct(U, "RET-OLD", { legacyQty: 8 });
  const inv = await mkInvoice(U, [{ productId: p, qty: "3", price: "10" }]);
  const old = (await pool.query("insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id) values ($1,$2,'old','sales_invoice',$3,$4) returning id", [U.id, TODAY, inv, U.user])).rows[0].id;
  await pool.query("insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,'34.50','0'),($1,$3,'0','30.00'),($1,$4,'0','4.50')", [old, U.acc.get("1100"), U.acc.get("4000"), U.acc.get("2100")]);
  await pool.query("update products set quantity_on_hand = quantity_on_hand - 3 where id=$1", [p]);
  await pool.query("update sales_invoices set status='sent', exchange_rate='1', base_total=total, base_tax_amount=tax_total where id=$1", [inv]);
  const c1 = await mkCn(U, inv, [{ productId: p, qty: "2", price: "10" }]);
  await issueCn(U, c1.id);
  const r1 = await returnGoods(U, c1.id, [{ lineId: c1.lines[0], quantity: 2 }]);
  const m1 = await movements(U, "credit_note", c1.id);
  check("pre-ACC-01 invoice: 2 units come back uncosted, with no entry — no cost invented",
    eq(r1.cost, 0) && await poolIs(p, 7, 0, "0.000") && (await returnEntries(U, c1.id)).length === 0 && m1.length === 1 && m1[0].total_cost === null && m1[0].reverses_movement_id === null, JSON.stringify(m1));
  const c2 = await mkCn(U, inv, [{ productId: p, qty: "2", price: "10" }]);
  await issueCn(U, c2.id);
  const over = await refusalOf(() => returnGoods(U, c2.id, [{ lineId: c2.lines[0], quantity: 2 }]));
  check("…and never more than it sold: 3 sold, 2 back, 2 more refused (1 left)", !!over && /only 1 of the units/.test(over.message), over?.message ?? "no refusal");
}
{
  const recR = await getInventoryReconciliation(R.id, R.currency);
  check("customer returns and their reversals: GL 1200 = valuation, integrity holds, nothing unattributed", recR.integrityOk && recR.reconciled, JSON.stringify(recR));
  check("…every entry the organization posted balances", (await unbalancedEntries(R)) === 0);
}

section("21. return requests: each line once, each submission once");
type ReturnResult = Awaited<ReturnType<typeof returnGoods>>;
const Q = await mkOrg("SAR");
const pd = await mkProduct(Q, "REQ-D");
const pr = await mkProduct(Q, "REQ-R");
// Each sale issues 5 at a cost the pool no longer carries, so a return at the wrong cost shows: REQ-D 5 × 10.00 and
// REQ-R 5 × 12.00 are received and sold (COGS 50.00 + 60.00); then 2 × 16.00 and 2 × 20.00 arrive, so the pools stand at
// 2 / 32.00 (average 16.00) and 2 / 40.00 (average 20.00). GL 1200 = 72.00, 5000 = 110.00.
await receive(Q, await mkPo(Q, [{ productId: pd, qty: "5", price: "10" }, { productId: pr, qty: "5", price: "12" }]));
const invQD = await mkInvoice(Q, [{ productId: pd, qty: "5", price: "30" }]);
await send(Q, invQD);
const invQR = await mkInvoice(Q, [{ productId: pr, qty: "5", price: "30" }]);
await send(Q, invQR);
await receive(Q, await mkPo(Q, [{ productId: pd, qty: "2", price: "16" }, { productId: pr, qty: "2", price: "20" }]));
const cnQR = await mkCn(Q, invQR, [{ productId: pr, qty: "3", price: "30" }]);
const K1 = randomUUID();
{
  // D — the note credits 2 on one line; the request names that line twice, 2 each. Restocking 4 would over-return.
  const cnD = await mkCn(Q, invQD, [{ productId: pd, qty: "2", price: "30" }]);
  await issueCn(Q, cnD.id);
  const lineD = cnD.lines[0];
  const before = JSON.stringify({ pool: await poolOf(pd), g1200: await gl(Q, "1200"), g5000: await gl(Q, "5000") });
  const now = async () => JSON.stringify({ pool: await poolOf(pd), g1200: await gl(Q, "1200"), g5000: await gl(Q, "5000") });
  const dup = await refusalOf(() => returnGoods(Q, cnD.id, [{ lineId: lineD, quantity: 2 }, { lineId: lineD, quantity: 2 }]));
  check("one line named twice in one request (2 + 2 on a line crediting 2) is refused — not 4 restocked; no movement, no entry, pool and GL unchanged",
    !!dup && /more than once/.test(dup.message) && /أكثر من مرة/.test(dup.ar) && (await movements(Q, "credit_note", cnD.id)).length === 0
      && (await returnEntries(Q, cnD.id)).length === 0 && (await now()) === before,
    dup?.message ?? `no refusal — ${await now()}`);
  const split = await refusalOf(() => returnGoods(Q, cnD.id, [{ lineId: lineD, quantity: 1 }, { lineId: String(lineD) as unknown as number, quantity: 1 }]));
  check("…also when the two parts would fit the line together (1 + 1, the id once as text): each line is named once — nothing written",
    !!split && /more than once/.test(split.message) && (await movements(Q, "credit_note", cnD.id)).length === 0 && (await now()) === before,
    split?.message ?? `no refusal — ${await now()}`);
  const okD = await returnGoods(Q, cnD.id, [{ lineId: lineD, quantity: 2 }]);
  check("…the line named once: 2 back at the 10.00 the sale issued them at, not today's 16.00 — Dr 1200 20.00 / Cr 5000 20.00; REQ-D 4 / 52.00",
    !okD.replayed && okD.units === 2 && eq(okD.cost, 20) && await poolIs(pd, 4, 4, "52.000"), JSON.stringify({ okD, pool: await poolOf(pd) }));

  // E — two lines of REQ-D in one note, 2 each; 3 of the sale's 5 are left to come back.
  const cnE = await mkCn(Q, invQD, [{ productId: pd, qty: "2", price: "30" }, { productId: pd, qty: "2", price: "30" }]);
  await issueCn(Q, cnE.id);
  const overE = await refusalOf(() => returnGoods(Q, cnE.id, [{ lineId: cnE.lines[0], quantity: 2 }, { lineId: cnE.lines[1], quantity: 2 }]));
  check("invoice limit over the complete request: two lines asking 2 + 2 of a product when 3 of the sale's 5 are left is refused as a whole — neither line written",
    !!overE && /asks for 4 of "Item REQ-D" \(REQ-D\) across its lines, but only 3/.test(overE.message) && (await movements(Q, "credit_note", cnE.id)).length === 0
      && await poolIs(pd, 4, 4, "52.000"), overE?.message ?? "no refusal");
  const okE = await returnGoods(Q, cnE.id, [{ lineId: cnE.lines[0], quantity: 2 }, { lineId: cnE.lines[1], quantity: 1 }]);
  check("…2 + 1 fits: the sale's last 3 come back at exactly the 30.00 left of its 50.00 — REQ-D 7 / 82.00",
    eq(okE.cost, 30) && okE.units === 3 && await poolIs(pd, 7, 7, "82.000"), JSON.stringify(await poolOf(pd)));
  // The engine's own sale limit stays beneath the request checks (which now refuse first): called directly, as no
  // action does, a 6th unit of the 5-unit sale is still refused.
  const engine = await refusalOf(() => db.transaction((tx) => returnFromCustomer(tx, ctx(Q),
    { sourceType: "credit_note", sourceId: cnE.id, journalEntryId: null, memo: "direct", requestKey: randomUUID() },
    { invoiceId: invQD, lines: [{ productId: pd, quantity: 1, sourceLineId: cnE.lines[1] }] })));
  check("…and the engine's own sale limit holds beneath them: called directly, a 6th unit of the 5-unit sale is refused — nothing written",
    !!engine && /^Cannot return 1 of "Item REQ-D" \(REQ-D\) to stock: only 0 of the units this invoice issued/.test(engine.message)
      && (await movements(Q, "credit_note", cnE.id)).length === 2 && await poolIs(pd, 7, 7, "82.000"), engine?.message ?? "no refusal");
}
{
  // R — 3 credited on one line; the sale issued 5 at 12.00 each, and the pool now averages 20.00.
  await issueCn(Q, cnQR.id);
  const lineR = cnQR.lines[0];
  const first = await returnGoods(Q, cnQR.id, [{ lineId: lineR, quantity: 1 }], K1);
  check("a partial return: 1 unit back at the 12.00 the sale issued it at (today's average is 20.00) — REQ-R 3 / 52.00",
    !first.replayed && first.units === 1 && eq(first.cost, 12) && (await movements(Q, "credit_note", cnQR.id)).length === 1 && await poolIs(pr, 3, 3, "52.000"),
    JSON.stringify({ first, pool: await poolOf(pr) }));
  const again = await returnGoods(Q, cnQR.id, [{ lineId: lineR, quantity: "1" }], K1);
  check("the identical request submitted again (the same submission key): the same return, not a second one — nothing written, the first result returned",
    again.replayed && again.units === 1 && eq(again.cost, 12) && JSON.stringify(again.movementIds) === JSON.stringify(first.movementIds)
      && (await movements(Q, "credit_note", cnQR.id)).length === 1 && (await returnEntries(Q, cnQR.id)).length === 1 && await poolIs(pr, 3, 3, "52.000"),
    JSON.stringify({ again, pool: await poolOf(pr) }));
  const changed = await refusalOf(() => returnGoods(Q, cnQR.id, [{ lineId: lineR, quantity: 2 }], K1));
  check("…the same key with different quantities is refused, never merged or run again — nothing written",
    !!changed && /already recorded with different quantities/.test(changed.message) && (await movements(Q, "credit_note", cnQR.id)).length === 1,
    changed?.message ?? "no refusal");
  const noKey = await refusalOf(() => db.transaction((tx) => returnCreditNoteGoods(tx, {
    orgId: Q.id, userId: Q.user, baseCurrency: Q.currency, date: TODAY, creditNoteId: cnQR.id, requestKey: "", request: [{ lineId: lineR, quantity: 1 }],
  })));
  check("a request without a valid submission key is refused while the line still has room — nothing written",
    !!noKey && /submission key/.test(noKey.message) && (await movements(Q, "credit_note", cnQR.id)).length === 1, noKey?.message ?? "no refusal");

  // Concurrent duplicate submissions: one key, two requests at once.
  const K2 = randomUUID();
  const both = await Promise.allSettled([1, 2].map(() => returnGoods(Q, cnQR.id, [{ lineId: lineR, quantity: 1 }], K2)));
  const answered = both.filter((o): o is PromiseFulfilledResult<ReturnResult> => o.status === "fulfilled").map((o) => o.value);
  check("concurrent duplicate submissions (one key, two requests at once): both answer, exactly one return is recorded — the note's row lock queues the second, which finds the first",
    answered.length === 2 && answered.filter((r) => r.replayed).length === 1 && (await movements(Q, "credit_note", cnQR.id)).length === 2
      && (await returnEntries(Q, cnQR.id)).length === 2 && await poolIs(pr, 4, 4, "64.000"),
    JSON.stringify(both.map((o) => (o.status === "fulfilled" ? { replayed: o.value.replayed, units: o.value.units } : String(o.reason)))));

  // A later, deliberate delivery is a new submission.
  const later = await returnGoods(Q, cnQR.id, [{ lineId: lineR, quantity: 1 }], randomUUID());
  check("a later partial delivery is a new submission (a new key) and is recorded: the 3rd unit at 12.00 — REQ-R 5 / 76.00",
    !later.replayed && eq(later.cost, 12) && (await returnEntries(Q, cnQR.id)).length === 3 && await poolIs(pr, 5, 5, "76.000"), JSON.stringify(await poolOf(pr)));
  const fourth = await refusalOf(() => returnGoods(Q, cnQR.id, [{ lineId: lineR, quantity: 1 }], randomUUID()));
  check("…and the line limit holds across submissions: a 4th unit on a line crediting 3 is refused", !!fourth && /credits 3, of which 3 already came back/.test(fourth.message),
    fourth?.message ?? "no refusal");
  const keys = (await pool.query("select request_key, count(*)::int n from inventory_movements where org_id=$1 and source_type='credit_note' and source_id=$2 group by 1 order by 1",
    [Q.id, cnQR.id])).rows as { request_key: string | null; n: number }[];
  check("…each recorded return carries the key it was submitted under — 3 keys, one movement each, none without a key",
    keys.length === 3 && keys.every((k) => k.request_key !== null && k.n === 1) && keys.some((k) => k.request_key === K1) && keys.some((k) => k.request_key === K2), JSON.stringify(keys));
}
{
  check("COGS reversed exactly: 5000 = 50.00 + 60.00 − 20.00 − 30.00 − 3 × 12.00 = 24.00; GL 1200 = 82.00 + 76.00 = 158.00",
    eq(await gl(Q, "5000"), 24) && eq(await gl(Q, "1200"), 158), `${await gl(Q, "5000")} / ${await gl(Q, "1200")}`);
  const recQ = await getInventoryReconciliation(Q.id, Q.currency);
  check("…GL 1200 = valuation, integrity holds, nothing unattributed; every entry balances",
    recQ.integrityOk && recQ.reconciled && (await unbalancedEntries(Q)) === 0, JSON.stringify(recQ));

  // Tenant isolation: another organization's own return under the same key is its own; it cannot touch this one's.
  const Z = await mkOrg("SAR");
  const pz = await mkProduct(Z, "REQ-Z");
  await receive(Z, await mkPo(Z, [{ productId: pz, qty: "2", price: "7" }]));
  const invZ = await mkInvoice(Z, [{ productId: pz, qty: "2", price: "9" }]);
  await send(Z, invZ);
  const cnZ = await mkCn(Z, invZ, [{ productId: pz, qty: "1", price: "9" }]);
  await issueCn(Z, cnZ.id);
  const zr = await returnGoods(Z, cnZ.id, [{ lineId: cnZ.lines[0], quantity: 1 }], K1);
  check("tenant isolation: another organization's return under the same key is its own submission — recorded at its own cost, not taken for this one's",
    !zr.replayed && eq(zr.cost, 7) && await poolIs(pz, 1, 1, "7.000"), JSON.stringify(zr));
  const cross = await refusalOf(() => returnGoods(Z, cnQR.id, [{ lineId: cnQR.lines[0], quantity: 1 }], K1));
  check("…and it can neither replay nor read this one's: the note is not found in its organization — nothing written",
    !!cross && /Credit note not found/.test(cross.message) && (await movements(Q, "credit_note", cnQR.id)).length === 3 && await poolIs(pr, 5, 5, "76.000"),
    cross?.message ?? "no refusal");

  // The wiring the browser cannot force: one key per opening of the dialog, sent with every submit of that
  // opening; the action hands it to the posting and logs a return once, not on its replay.
  const dialog = readFileSync(path.join(ROOT, "src/app/(app)/sales/credit-notes/cn-detail-actions.tsx"), "utf8");
  const action = readFileSync(path.join(ROOT, "src/app/(app)/sales/credit-notes/actions.ts"), "utf8");
  const actionBody = action.slice(action.indexOf("export async function returnCreditNoteGoodsAction("));
  check("the return dialog makes a new submission key each time it opens and sends it with the request; the action passes it to the posting and logs only a first submission",
    /onOpenChange=\{\(o\) => \{ setOpen\(o\); if \(o\) setRequestKey\(submissionKey\(\)\);/.test(dialog)
      && /returnCreditNoteGoodsAction\(creditNoteId, request, requestKey\)/.test(dialog) && /crypto\.getRandomValues/.test(dialog)
      && /creditNoteId, requestKey, request,/.test(actionBody) && /if \(!result\.replayed\) \{\n\s*await logActivity\(/.test(actionBody));
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
