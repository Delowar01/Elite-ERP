// Run via `npm run verify:payment-reversal` — tsx with the react-server condition.

/**
 * Reversing a recorded payment, on a sales invoice and on a purchase order.
 *
 * ## What makes the assertions falsifiable
 *
 * Every fixture has TWO payments at DIFFERENT rates from the document's booked rate, so each
 * carries a realized FX line and the two lines have OPPOSITE signs. Reversing the second must leave
 * the first — its row, its stored figures, and its 4900 line — byte-identical. A fixture with one
 * payment, or with payments at the booked rate, could not fail.
 *
 * ## The signs, which a "the entry balances" check would not catch
 *
 * They invert between the receivable and the payable, and both are asserted as WHICH SIDE of 4900
 * carries the amount:
 *
 *   INV-0008 (receivable)   paid MORE base than booked -> gain, Cr 4900
 *                           paid LESS base than booked -> loss, Dr 4900
 *   PO-0004  (payable)      paid MORE base than booked -> LOSS, Dr 4900
 *                           paid LESS base than booked -> GAIN, Cr 4900
 *
 * ## Why there are FOUR fixtures rather than two
 *
 * Both supplied fixtures are internally exact: 575/300/275 x 3.75 divides cleanly, so payment 2's
 * DERIVED closing remainder (baseTotal - basePaidAmount) coincides with its proportional conversion
 * (amount x rate). A mutation that recomputes the reversal from the DOCUMENT's rate would therefore
 * pass on them, wrongly. The awkward-rate twins use 3.7513 against a non-dividing total so the two
 * genuinely diverge, and every mutation runs against all four.
 */
import { Pool } from "pg";
import { reversalRefusal, mirrorLines, paidAfterReversal, invoiceStatusAfter } from "../src/lib/payment-reversal";
import { roundMoney } from "../src/lib/currency/currencies";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uniq = () => Math.random().toString(36).slice(2, 8);
const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const mils = (v: string | number | null) => Math.round(Number(v ?? 0) * 1000);
const m3 = (v: number) => (v / 1000).toFixed(3);

const FIXTURE = "verifyrev_";
async function sweep() {
  await pool.query(`delete from journal_lines where journal_entry_id in
    (select e.id from journal_entries e join orgs o on o.id = e.org_id where o.name like $1)`, [`${FIXTURE}%`]);
  await pool.query("delete from journal_entries where org_id in (select id from orgs where name like $1)", [`${FIXTURE}%`]);
  await pool.query("delete from orgs where name like $1", [`${FIXTURE}%`]);
}
await sweep();

const org = (await pool.query("insert into orgs (name, currency, country) values ($1,'SAR','Saudi Arabia') returning id",
  [`${FIXTURE}${uniq()}`])).rows[0].id as number;
const user = (await pool.query(
  "insert into users (org_id,name,email,password_hash,role) values ($1,'R',$2,'x','owner') returning id",
  [org, `rev_${uniq()}@t.dev`])).rows[0].id as number;
for (const [code, name, type, nb] of [
  ["1000", "Cash", "asset", "debit"], ["1100", "Accounts Receivable", "asset", "debit"],
  ["2000", "Accounts Payable", "liability", "credit"], ["4000", "Sales Revenue", "revenue", "credit"],
  ["1200", "Inventory", "asset", "debit"], ["4900", "Exchange Gain/Loss", "revenue", "credit"],
] as const) {
  await pool.query("insert into accounts (org_id,code,name,type,normal_balance,is_system) values ($1,$2,$3,$4,$5,true)",
    [org, code, name, type, nb]);
}
const acc = new Map<string, number>(
  (await pool.query("select id, code from accounts where org_id=$1", [org])).rows.map((r) => [r.code, r.id]));
const bank = (await pool.query("insert into bank_accounts (org_id,name,gl_account_id) values ($1,'Bank',$2) returning id",
  [org, acc.get("1000")])).rows[0].id as number;
const cust = (await pool.query("insert into customers (org_id,name) values ($1,'Rev Client') returning id", [org])).rows[0].id;
const vend = (await pool.query("insert into vendors (org_id,name) values ($1,'Rev Vendor') returning id", [org])).rows[0].id;

const balanceOf = async (code: string) => (await pool.query(
  `select coalesce(sum(l.debit) - sum(l.credit),0)::text v from journal_lines l
     join journal_entries e on e.id = l.journal_entry_id
    where e.org_id=$1 and l.account_id=$2`, [org, acc.get(code)])).rows[0].v as string;
const bracket = async () => ({
  bank: await balanceOf("1000"), ar: await balanceOf("1100"),
  ap: await balanceOf("2000"), fx: await balanceOf("4900"),
});
const orgBalanced = async () => {
  const r = (await pool.query(
    `select coalesce(sum(l.debit),0)::text dr, coalesce(sum(l.credit),0)::text cr from journal_lines l
       join journal_entries e on e.id=l.journal_entry_id where e.org_id=$1`, [org])).rows[0];
  return mils(r.dr) === mils(r.cr);
};
const post = async (date: string, memo: string, st: string, sid: number,
                    lines: { accountId: number; debit: string; credit: string }[]) => {
  const je = (await pool.query(
    `insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id)
     values ($1,$2,$3,$4,$5,$6) returning id`, [org, date, memo, st, sid, user])).rows[0].id as number;
  for (const l of lines) {
    await pool.query("insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,$3,$4)",
      [je, l.accountId, l.debit, l.credit]);
  }
  return je;
};
const linesOf = async (st: string, sid: number) => (await pool.query(
  `select l.account_id, l.debit::text d, l.credit::text c from journal_lines l
     join journal_entries e on e.id = l.journal_entry_id
    where e.org_id=$1 and e.source_type=$2 and e.source_id=$3 order by l.id`, [org, st, sid])).rows;

/**
 * The action's transaction, replayed against the database with the SAME lib functions the action
 * calls. A session cannot be reached from here, so the wiring — role gate, locks, revalidation — is
 * browser-tier; the arithmetic, the posting shape and the refusals are what this proves.
 */
async function reverse(paymentId: number, opts: { typeQualified?: boolean; recomputeFromDocRate?: boolean; dropFxLine?: boolean } = {}) {
  const p = (await pool.query(
    `select kind, sales_invoice_id, purchase_order_id, proforma_invoice_id, reversed_at,
            amount::text amount, base_applied_amount::text base_applied_amount
       from payments where id=$1`, [paymentId])).rows[0];
  const refusal = reversalRefusal({
    id: paymentId, kind: p.kind, salesInvoiceId: p.sales_invoice_id, purchaseOrderId: p.purchase_order_id,
    proformaInvoiceId: p.proforma_invoice_id, reversedAt: p.reversed_at,
  });
  if (refusal) return { error: refusal };

  const already = (await pool.query(
    opts.typeQualified === false
      ? "select 1 from journal_entries where org_id=$1 and source_id=$2 limit 1"
      : "select 1 from journal_entries where org_id=$1 and source_type='payment_reversal' and source_id=$2 limit 1",
    [org, paymentId])).rowCount;
  if (already) return { error: "This payment has already been reversed." };

  const orig = await linesOf("payment", paymentId);
  if (orig.length === 0) return { error: "This payment has no ledger posting to reverse." };
  let lines = mirrorLines(orig.map((l) => ({ accountId: l.account_id, debit: l.d, credit: l.c })));
  if (opts.dropFxLine) lines = lines.filter((l) => l.accountId !== acc.get("4900"));

  const isInv = p.sales_invoice_id !== null;
  const table = isInv ? "sales_invoices" : "purchase_orders";
  const doc = (await pool.query(
    `select currency, total::text total, paid_amount::text paid_amount, base_paid_amount::text base_paid_amount,
            status, exchange_rate::text exchange_rate from ${table} where id=$1`,
    [isInv ? p.sales_invoice_id : p.purchase_order_id])).rows[0];

  // MUTATION 1's shape: recompute the AR/AP restoration from the DOCUMENT's booked rate instead of
  // the payment's stored baseAppliedAmount.
  const paymentForPaid = opts.recomputeFromDocRate
    ? { amount: p.amount, baseAppliedAmount: roundMoney(Number(p.amount) * Number(doc.exchange_rate ?? 1), "SAR") }
    : { amount: p.amount, baseAppliedAmount: p.base_applied_amount };
  const paid = paidAfterReversal({
    doc: { currency: doc.currency, paidAmount: doc.paid_amount, basePaidAmount: doc.base_paid_amount },
    payment: paymentForPaid, baseCurrency: "SAR",
  });
  if (opts.recomputeFromDocRate) {
    const arLine = lines.find((l) => l.accountId === acc.get(isInv ? "1100" : "2000"));
    if (arLine) {
      if (isInv) arLine.debit = paymentForPaid.baseAppliedAmount!;
      else arLine.credit = paymentForPaid.baseAppliedAmount!;
    }
  }

  await post(new Date().toISOString().slice(0, 10), `Payment reversed`, "payment_reversal", paymentId, lines);
  if (isInv) {
    await pool.query("update sales_invoices set paid_amount=$1, base_paid_amount=$2, status=$3 where id=$4",
      [paid.paidAmount, paid.basePaidAmount, invoiceStatusAfter(paid.paidAmount, doc.total, doc.currency ?? "SAR"), p.sales_invoice_id]);
  } else {
    await pool.query("update purchase_orders set paid_amount=$1, base_paid_amount=$2 where id=$3",
      [paid.paidAmount, paid.basePaidAmount, p.purchase_order_id]);
  }
  await pool.query("update payments set reversed_at=now(), reversed_by_id=$1 where id=$2", [user, paymentId]);
  return {};
}

// ── Fixture builders ──────────────────────────────────────────────────────────────────────────
const mkInvoice = async (num: string, total: string, tax: string, rate: string) => {
  const baseTotal = roundMoney(Number(total) * Number(rate), "SAR");
  const baseTax = roundMoney(Number(tax) * Number(rate), "SAR");
  const id = (await pool.query(
    `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,total,tax_total,paid_amount,
                                 base_paid_amount,currency,exchange_rate,base_total,base_tax_amount,created_by_id)
     values ($1,$2,$3,'2026-07-01','sent',$4,$5,'0','0','USD',$6,$7,$8,$9) returning id`,
    [org, num, cust, total, tax, rate, baseTotal, baseTax, user])).rows[0].id as number;
  await post("2026-07-01", `Invoice ${num} sent`, "sales_invoice", id, [
    { accountId: acc.get("1100")!, debit: baseTotal, credit: "0" },
    { accountId: acc.get("4000")!, debit: "0", credit: baseTotal },
  ]);
  return { id, baseTotal };
};
const mkPo = async (num: string, total: string, rate: string) => {
  const baseTotal = roundMoney(Number(total) * Number(rate), "SAR");
  const id = (await pool.query(
    `insert into purchase_orders (org_id,po_number,vendor_id,order_date,status,subtotal,tax_total,total,paid_amount,
                                  base_paid_amount,currency,exchange_rate,base_total,base_tax_amount,created_by_id)
     values ($1,$2,$3,'2026-07-01','received',$4,'0',$4,'0','0','USD',$5,$6,'0',$7) returning id`,
    [org, num, vend, total, rate, baseTotal, user])).rows[0].id as number;
  await post("2026-07-01", `Purchase order ${num} received`, "purchase_order", id, [
    { accountId: acc.get("1200")!, debit: baseTotal, credit: "0" },
    { accountId: acc.get("2000")!, debit: "0", credit: baseTotal },
  ]);
  return { id, baseTotal };
};

/** A payment against an invoice: Dr Bank baseAmount / Cr AR baseApplied / ±4900. */
const payInvoice = async (invId: number, amount: string, baseAmount: string, baseApplied: string, closing: boolean, total: string) => {
  const pid = (await pool.query(
    `insert into payments (org_id,direction,bank_account_id,amount,currency,exchange_rate,base_amount,
                           base_applied_amount,payment_date,method,reference,sales_invoice_id,created_by_id)
     values ($1,'in',$2,$3,'USD',$4,$5,$6,'2026-08-01','bank_transfer',$7,$8,$9) returning id`,
    [org, bank, amount, roundMoney(Number(baseAmount) / Number(amount), "SAR"), baseAmount, baseApplied,
     `PAY-${uniq()}`, invId, user])).rows[0].id as number;
  const diff = mils(baseAmount) - mils(baseApplied);
  await post("2026-08-01", `Payment received`, "payment", pid, [
    { accountId: acc.get("1000")!, debit: baseAmount, credit: "0" },
    { accountId: acc.get("1100")!, debit: "0", credit: baseApplied },
    // Receivable: bank took in MORE base than AR cleared -> realized GAIN, credit 4900.
    ...(diff !== 0 ? [{ accountId: acc.get("4900")!, debit: diff < 0 ? m3(-diff) : "0", credit: diff > 0 ? m3(diff) : "0" }] : []),
  ]);
  const inv = (await pool.query("select paid_amount::text p, base_paid_amount::text b from sales_invoices where id=$1", [invId])).rows[0];
  const newPaid = roundMoney(Number(inv.p) + Number(amount), "USD");
  await pool.query("update sales_invoices set paid_amount=$1, base_paid_amount=$2, status=$3 where id=$4",
    [newPaid, roundMoney(Number(inv.b) + Number(baseApplied), "SAR"), closing ? "paid" : "partially_paid", invId]);
  void total;
  return pid;
};

/** A payment against a PO: Dr AP baseApplied / Cr Bank baseAmount / ±4900. */
const payPo = async (poId: number, amount: string, baseAmount: string, baseApplied: string) => {
  const pid = (await pool.query(
    `insert into payments (org_id,direction,bank_account_id,amount,currency,exchange_rate,base_amount,
                           base_applied_amount,payment_date,method,reference,purchase_order_id,created_by_id)
     values ($1,'out',$2,$3,'USD',$4,$5,$6,'2026-08-01','bank_transfer',$7,$8,$9) returning id`,
    [org, bank, amount, roundMoney(Number(baseAmount) / Number(amount), "SAR"), baseAmount, baseApplied,
     `PAY-${uniq()}`, poId, user])).rows[0].id as number;
  const diff = mils(baseAmount) - mils(baseApplied);
  await post("2026-08-01", `Payment made`, "payment", pid, [
    { accountId: acc.get("2000")!, debit: baseApplied, credit: "0" },
    { accountId: acc.get("1000")!, debit: "0", credit: baseAmount },
    // Payable: bank paid out MORE base than AP cleared -> realized LOSS, debit 4900.
    ...(diff !== 0 ? [{ accountId: acc.get("4900")!, debit: diff > 0 ? m3(diff) : "0", credit: diff < 0 ? m3(-diff) : "0" }] : []),
  ]);
  const po = (await pool.query("select paid_amount::text p, base_paid_amount::text b from purchase_orders where id=$1", [poId])).rows[0];
  await pool.query("update purchase_orders set paid_amount=$1, base_paid_amount=$2 where id=$3",
    [roundMoney(Number(po.p) + Number(amount), "USD"), roundMoney(Number(po.b) + Number(baseApplied), "SAR"), poId]);
  return pid;
};

// ══════════════════════════════════════════════════════════════════════════════════════════════
// FIXTURE A — INV-0008, verbatim. USD 575 @ 3.75 -> AR 2,156.25
//   P1  USD 300 @ 3.80 -> Bank 1,140.00 / AR 1,125.00 / GAIN 15.00 (Cr 4900)
//   P2  USD 275 @ 3.70 -> Bank 1,017.50 / AR 1,031.25 / LOSS 13.75 (Dr 4900)
// ══════════════════════════════════════════════════════════════════════════════════════════════
console.log("");
const invA = await mkInvoice("INV-0008", "575.00", "0", "3.75000000");
check("A fixture: AR booked at 2,156.25", mils(invA.baseTotal) === 2_156_250, invA.baseTotal);
const a1 = await payInvoice(invA.id, "300.00", "1140.00", "1125.00", false, "575.00");
const a2 = await payInvoice(invA.id, "275.00", "1017.50", "1031.25", true, "575.00");

const a1Lines = await linesOf("payment", a1);
const a2Lines = await linesOf("payment", a2);
const fxOf = (rows: typeof a1Lines) => rows.find((l) => l.account_id === acc.get("4900"));
check("A/SIGN P1 paid MORE base than booked -> realized GAIN, CREDIT 4900 15.00",
  mils(fxOf(a1Lines)!.c) === 15_000 && mils(fxOf(a1Lines)!.d) === 0, JSON.stringify(fxOf(a1Lines)));
check("A/SIGN P2 paid LESS base than booked -> realized LOSS, DEBIT 4900 13.75",
  mils(fxOf(a2Lines)!.d) === 13_750 && mils(fxOf(a2Lines)!.c) === 0, JSON.stringify(fxOf(a2Lines)));

const aBefore = await bracket();
const aInvBefore = (await pool.query("select paid_amount::text p, base_paid_amount::text b, status from sales_invoices where id=$1", [invA.id])).rows[0];
check("A BRACKET before reversal", mils(aInvBefore.p) === 575_000 && aInvBefore.status === "paid",
  `AR ${aBefore.ar} / bank ${aBefore.bank} / 4900 ${aBefore.fx} | paid ${aInvBefore.p} base ${aInvBefore.b} ${aInvBefore.status}`);

const aRev = await reverse(a2);
check("A reversing payment 2 succeeds", !("error" in aRev && aRev.error), JSON.stringify(aRev));
const aAfter = await bracket();
const aInvAfter = (await pool.query("select paid_amount::text p, base_paid_amount::text b, status from sales_invoices where id=$1", [invA.id])).rows[0];
check("A BRACKET after reversal", true,
  `AR ${aBefore.ar}->${aAfter.ar} / bank ${aBefore.bank}->${aAfter.bank} / 4900 ${aBefore.fx}->${aAfter.fx}`);

check("A invoice returns to partially_paid", aInvAfter.status === "partially_paid", aInvAfter.status);
check("A outstanding back to USD 275 (paidAmount 300)", mils(aInvAfter.p) === 300_000, aInvAfter.p);
check("A AR restored by EXACTLY 1,031.25", mils(aAfter.ar) - mils(aBefore.ar) === 1_031_250, m3(mils(aAfter.ar) - mils(aBefore.ar)));
check("A AR is now exactly the pre-payment-2 figure, 1,031.25 outstanding", mils(aAfter.ar) === 1_031_250, aAfter.ar);
check("A basePaidAmount back to exactly 1,125.00", mils(aInvAfter.b) === 1_125_000, aInvAfter.b);
check("A bank receipt of 1,017.50 reversed", mils(aBefore.bank) - mils(aAfter.bank) === 1_017_500, m3(mils(aBefore.bank) - mils(aAfter.bank)));
check("A the 13.75 LOSS reversed — 4900 nets to P1's gain alone, -15.00", mils(aAfter.fx) === -15_000, aAfter.fx);

// Payment 1 completely untouched — the property mirroring gives by construction.
const a1LinesAfter = await linesOf("payment", a1);
check("A payment 1's journal lines are byte-identical", JSON.stringify(a1Lines) === JSON.stringify(a1LinesAfter));
const a1Row = (await pool.query("select amount::text a, base_amount::text ba, base_applied_amount::text bap, reversed_at from payments where id=$1", [a1])).rows[0];
check("A payment 1's stored figures untouched and it is NOT marked reversed",
  mils(a1Row.ba) === 1_140_000 && mils(a1Row.bap) === 1_125_000 && a1Row.reversed_at === null, JSON.stringify(a1Row));
check("A the reversal MIRRORS — same three accounts, debit/credit swapped",
  JSON.stringify((await linesOf("payment_reversal", a2)).map((l) => [l.account_id, l.d, l.c]))
    === JSON.stringify(a2Lines.map((l) => [l.account_id, l.c, l.d])));
check("A org ledger still balances", await orgBalanced());
check("A payment 2 is marked reversed, not deleted",
  (await pool.query("select reversed_at, reversed_by_id from payments where id=$1", [a2])).rows[0].reversed_at !== null);

// Round trip: a new payment closes the invoice to EXACTLY baseTotal again.
const a3 = await payInvoice(invA.id, "275.00", "1000.00", "1031.25", true, "575.00");
const aRt = (await pool.query("select base_paid_amount::text b, status from sales_invoices where id=$1", [invA.id])).rows[0];
check("A ROUND TRIP: a fresh closing payment brings basePaidAmount to exactly baseTotal 2,156.25",
  mils(aRt.b) === mils(invA.baseTotal) && aRt.status === "paid", `${aRt.b} vs ${invA.baseTotal}`);
void a3;

// ══════════════════════════════════════════════════════════════════════════════════════════════
// FIXTURE B — PO-0004, verbatim. USD 575 @ 3.75 -> AP 2,156.25
//   P1  USD 300, paid 1,140.00 @ 3.80 -> AP 1,125.00 / LOSS 15.00 (Dr 4900)
//   P2  USD 275, paid 1,017.50 @ 3.70 -> AP 1,031.25 / GAIN 13.75 (Cr 4900)
// ══════════════════════════════════════════════════════════════════════════════════════════════
const poB = await mkPo("PO-0004", "575.00", "3.75000000");
const b1 = await payPo(poB.id, "300.00", "1140.00", "1125.00");
const b2 = await payPo(poB.id, "275.00", "1017.50", "1031.25");
const b1Lines = await linesOf("payment", b1);
const b2Lines = await linesOf("payment", b2);
check("B/SIGN P1 paid MORE base than booked -> realized LOSS, DEBIT 4900 15.00 (inverted from the receivable)",
  mils(fxOf(b1Lines)!.d) === 15_000 && mils(fxOf(b1Lines)!.c) === 0, JSON.stringify(fxOf(b1Lines)));
check("B/SIGN P2 paid LESS base than booked -> realized GAIN, CREDIT 4900 13.75",
  mils(fxOf(b2Lines)!.c) === 13_750 && mils(fxOf(b2Lines)!.d) === 0, JSON.stringify(fxOf(b2Lines)));

const bBefore = await bracket();
const bPoBefore = (await pool.query("select paid_amount::text p, base_paid_amount::text b, status from purchase_orders where id=$1", [poB.id])).rows[0];
check("B BRACKET before reversal", mils(bPoBefore.p) === 575_000,
  `AP ${bBefore.ap} / bank ${bBefore.bank} / 4900 ${bBefore.fx} | paid ${bPoBefore.p} base ${bPoBefore.b} ${bPoBefore.status}`);

await reverse(b2);
const bAfter = await bracket();
const bPoAfter = (await pool.query("select paid_amount::text p, base_paid_amount::text b, status from purchase_orders where id=$1", [poB.id])).rows[0];
check("B BRACKET after reversal", true,
  `AP ${bBefore.ap}->${bAfter.ap} / bank ${bBefore.bank}->${bAfter.bank} / 4900 ${bBefore.fx}->${bAfter.fx}`);
check("B balance back to USD 275 (paidAmount 300)", mils(bPoAfter.p) === 300_000, bPoAfter.p);
check("B AP restored by EXACTLY 1,031.25", mils(bBefore.ap) - mils(bAfter.ap) === 1_031_250, m3(mils(bBefore.ap) - mils(bAfter.ap)));
check("B basePaidAmount back to exactly 1,125.00", mils(bPoAfter.b) === 1_125_000, bPoAfter.b);
check("B the 1,017.50 bank payment reversed", mils(bAfter.bank) - mils(bBefore.bank) === 1_017_500, m3(mils(bAfter.bank) - mils(bBefore.bank)));
// 4900 is shared by every fixture in this org, so its ABSOLUTE balance is contaminated by A.
// The delta across B's own reversal is the figure that means anything: undoing a 13.75 CREDIT adds
// a 13.75 debit, so the balance rises by exactly that.
check("B the 13.75 GAIN reversed — 4900 moves by exactly +13.75, the credit undone",
  mils(bAfter.fx) - mils(bBefore.fx) === 13_750, `${bBefore.fx} -> ${bAfter.fx} (delta ${m3(mils(bAfter.fx) - mils(bBefore.fx))})`);
check("B …and P1's 15.00 loss is still standing in 4900 — only P2's line was undone",
  mils(fxOf(await linesOf("payment", b1))!.d) === 15_000);
check("B PO STATUS UNCHANGED at `received` throughout — purchase orders have no paid status",
  bPoBefore.status === "received" && bPoAfter.status === "received", `${bPoBefore.status} -> ${bPoAfter.status}`);
check("B payment 1's journal lines are byte-identical", JSON.stringify(b1Lines) === JSON.stringify(await linesOf("payment", b1)));
check("B payment 1 is NOT marked reversed",
  (await pool.query("select reversed_at from payments where id=$1", [b1])).rows[0].reversed_at === null);
check("B org ledger still balances", await orgBalanced());

// ══════════════════════════════════════════════════════════════════════════════════════════════
// FIXTURES C and D — the AWKWARD-RATE TWINS.
//
// A and B divide cleanly, so payment 2's derived closing remainder equals its proportional
// conversion and a mutation recomputing from the DOCUMENT's rate passes on them wrongly. Here the
// rate is 3.7513 against 333.33, so the two genuinely diverge — which is what gives mutation 1 a
// case it cannot survive.
// ══════════════════════════════════════════════════════════════════════════════════════════════
const AWK = "3.75130000";
const T_AWK = "552.28", P1_AWK = "179.64", P2_AWK = "372.64";
const invC = await mkInvoice("INV-AWK", T_AWK, "0", AWK);              // baseTotal 2,071.77
const c1Base = roundMoney(Number(P1_AWK) * Number(AWK), "SAR");        // 673.88
const c1 = await payInvoice(invC.id, P1_AWK, "700.00", c1Base, false, T_AWK);
const cRemainder = roundMoney(Number(invC.baseTotal) - Number(c1Base), "SAR");   // 1,397.89
const cProportional = roundMoney(Number(P2_AWK) * Number(AWK), "SAR");           // 1,397.88
check("C the derived remainder and the proportional conversion DIVERGE — the twin does its job",
  mils(cRemainder) !== mils(cProportional), `remainder ${cRemainder} vs proportional ${cProportional}`);
const c2 = await payInvoice(invC.id, P2_AWK, "1400.00", cRemainder, true, T_AWK);

const poD = await mkPo("PO-AWK", T_AWK, AWK);
const d1 = await payPo(poD.id, P1_AWK, "700.00", c1Base);
const d2 = await payPo(poD.id, P2_AWK, "1400.00", cRemainder);
void c1; void d1;

// ══════════════════════════════════════════════════════════════════════════════════════════════
// REFUSALS
// ══════════════════════════════════════════════════════════════════════════════════════════════
check("REFUSE: a payment already reversed", (await reverse(a2)).error === "This payment has already been reversed.",
  JSON.stringify(await reverse(a2)));
const advId = (await pool.query(
  `insert into payments (org_id,direction,bank_account_id,amount,payment_date,kind,created_by_id)
   values ($1,'in',$2,'100','2026-08-01','advance_receipt',$3) returning id`, [org, bank, user])).rows[0].id;
check("REFUSE: an advance receipt names the allocation/refund route",
  /advance/i.test((await reverse(advId)).error ?? ""), (await reverse(advId)).error ?? "");
const refId = (await pool.query(
  `insert into payments (org_id,direction,bank_account_id,amount,payment_date,kind,created_by_id)
   values ($1,'out',$2,'100','2026-08-01','advance_refund',$3) returning id`, [org, bank, user])).rows[0].id;
check("REFUSE: an advance refund", /refund cannot be reversed/i.test((await reverse(refId)).error ?? ""), (await reverse(refId)).error ?? "");
const pfOnly = (await pool.query(
  `insert into payments (org_id,direction,bank_account_id,amount,payment_date,created_by_id)
   values ($1,'in',$2,'100','2026-08-01',$3) returning id`, [org, bank, user])).rows[0].id;
check("REFUSE: an ordinary payment linked to no invoice or PO", /not linked/i.test((await reverse(pfOnly)).error ?? ""), (await reverse(pfOnly)).error ?? "");
const noPosting = (await pool.query(
  `insert into payments (org_id,direction,bank_account_id,amount,payment_date,sales_invoice_id,created_by_id)
   values ($1,'in',$2,'100','2026-08-01',$3,$4) returning id`, [org, bank, invA.id, user])).rows[0].id;
check("REFUSE: a payment with no ledger posting", /no ledger posting/i.test((await reverse(noPosting)).error ?? ""), (await reverse(noPosting)).error ?? "");
// A NULL-safe kind check: an ordinary payment carries kind = NULL, and `kind <> 'x'` is NULL for it.
check("the allowlist admits kind = NULL (the ordinary case) rather than dropping it",
  reversalRefusal({ id: 1, kind: null, salesInvoiceId: 1, purchaseOrderId: null, proformaInvoiceId: null, reversedAt: null }) === null);
check("REVERSALS ARE NOT REVERSIBLE: the reversal is an entry, not a payment row, so there is nothing to reverse",
  (await pool.query("select count(*)::int n from payments where org_id=$1 and reference like 'REV-%'", [org])).rows[0].n === 0);

// ══════════════════════════════════════════════════════════════════════════════════════════════
// MUTATIONS — run against all four fixtures
// ══════════════════════════════════════════════════════════════════════════════════════════════
// M1 — recompute the AR/AP restoration from the DOCUMENT's booked rate instead of mirroring the
// payment's stored line. On A and B the two coincide (575/300/275 x 3.75 divides cleanly), which is
// exactly why the awkward twins exist: on C and D the stored remainder is 1,397.89 and the
// proportional conversion is 1,397.88, so the mutation MUST produce a different figure there.
//
// Each fixture is snapshotted and restored around its own run rather than reset to hardcoded
// figures — a restore that assumed the wrong numbers would make the mutation look effective when it
// was the restore that moved the balance.
const m1: string[] = [];
for (const [label, pid, docId, isInv] of [
  ["A INV-0008 p2", a2, invA.id, true],
  ["B PO-0004  p2", b2, poB.id, false],
  ["C INV-AWK  p2", c2, invC.id, true],
  ["D PO-AWK   p2", d2, poD.id, false],
] as const) {
  const table = isInv ? "sales_invoices" : "purchase_orders";
  const snapDoc = (await pool.query(`select paid_amount::text p, base_paid_amount::text b, status from ${table} where id=$1`, [docId])).rows[0];
  const snapRev = (await pool.query("select reversed_at from payments where id=$1", [pid])).rows[0].reversed_at;

  // Honest reversal first, to learn the figure mirroring produces.
  await pool.query("update payments set reversed_at=null where id=$1", [pid]);
  await pool.query(`delete from journal_lines where journal_entry_id in
    (select id from journal_entries where org_id=$1 and source_type='payment_reversal' and source_id=$2)`, [org, pid]);
  await pool.query("delete from journal_entries where org_id=$1 and source_type='payment_reversal' and source_id=$2", [org, pid]);
  await pool.query(`update ${table} set paid_amount=$1, base_paid_amount=$2 where id=$3`, [snapDoc.p, snapDoc.b, docId]);
  await reverse(pid);
  const honest = (await pool.query(`select base_paid_amount::text b from ${table} where id=$1`, [docId])).rows[0].b;

  // Then the mutated one, from the same starting state.
  await pool.query("update payments set reversed_at=null where id=$1", [pid]);
  await pool.query(`delete from journal_lines where journal_entry_id in
    (select id from journal_entries where org_id=$1 and source_type='payment_reversal' and source_id=$2)`, [org, pid]);
  await pool.query("delete from journal_entries where org_id=$1 and source_type='payment_reversal' and source_id=$2", [org, pid]);
  await pool.query(`update ${table} set paid_amount=$1, base_paid_amount=$2 where id=$3`, [snapDoc.p, snapDoc.b, docId]);
  await reverse(pid, { recomputeFromDocRate: true });
  const mutated = (await pool.query(`select base_paid_amount::text b from ${table} where id=$1`, [docId])).rows[0].b;

  if (mils(honest) === mils(mutated)) m1.push(`${label}: SURVIVED — both ${honest}`);
  else m1.push(`${label}: caught — mirrored ${honest} vs recomputed ${mutated}`);

  // Restore for the assertions that follow.
  await pool.query(`update ${table} set paid_amount=$1, base_paid_amount=$2 where id=$3`, [snapDoc.p, snapDoc.b, docId]);
  await pool.query("update payments set reversed_at=$1 where id=$2", [snapRev, pid]);
}
const m1Survived = m1.filter((x) => x.includes("SURVIVED"));
// A and B CANNOT catch this mutation — their figures coincide — and saying so is the point of the
// twins. The assertion is that the twins catch it; A and B are reported for the record.
check("MUTATION 1: the AWKWARD twins catch a recompute-from-document-rate",
  m1Survived.length === 2 && m1Survived.every((x) => x.startsWith("A ") || x.startsWith("B ")),
  m1.join("\n      "));

// M2 — drop `sourceType` from the idempotency check.
//
// THE STRONGEST VERSION OF THIS TEST AVAILABLE IN THIS CODEBASE, and it needs no decoy. The
// original entry is `(payment, <this exact id>)` — same table, same integer, different type. So an
// id-only check finds the REAL original and concludes the reversal is already posted. Every other
// place this hazard appears had to have a collision seeded for it; here the collision is the
// feature's own data, guaranteed present for every payment that has ever posted.
{
  const fresh = await mkInvoice("INV-M2", "100.00", "0", "3.75000000");
  const fp = await payInvoice(fresh.id, "100.00", "380.00", "375.00", true, "100.00");
  const original = await linesOf("payment", fp);
  const qualified = await reverse(fp, { typeQualified: true });
  check("M2 CONTROL: with the type, the reversal posts against a live `payment` entry at the same id",
    !("error" in qualified && qualified.error) && original.length > 0, JSON.stringify(qualified));

  const fresh2 = await mkInvoice("INV-M2B", "100.00", "0", "3.75000000");
  const fp2 = await payInvoice(fresh2.id, "100.00", "380.00", "375.00", true, "100.00");
  const idOnly = await reverse(fp2, { typeQualified: false });
  check("MUTATION 2: an id-only check finds the payment's OWN original entry and refuses to reverse",
    "error" in idOnly && /already been reversed/.test(idOnly.error ?? ""), JSON.stringify(idOnly));
  check("…and nothing was posted — the reversal was silently skipped, not errored",
    (await linesOf("payment_reversal", fp2)).length === 0);
}

// M3 — omit the FX line from the mirrored entry.
{
  const fresh = await mkInvoice("INV-M3", "100.00", "0", "3.75000000");
  const fp = await payInvoice(fresh.id, "100.00", "380.00", "375.00", true, "100.00");
  const fxBefore = mils(await balanceOf("4900"));
  await reverse(fp, { dropFxLine: true });
  const fxAfter = mils(await balanceOf("4900"));
  check("MUTATION 3: omitting the FX line leaves the 5.00 gain stranded in 4900",
    fxAfter === fxBefore, `4900 ${m3(fxBefore)} -> ${m3(fxAfter)} — unchanged means the gain was never undone`);
  check("…and the entry no longer balances, which is the loud half of the same defect",
    !(await orgBalanced()));
  // Clean up by DELETING the mutated entry rather than posting a correcting one: the imbalance is
  // one-sided by exactly the omitted line, and no balanced entry can offset a one-sided gap — the
  // first attempt at a repair here posted a self-balancing pair and left the org still 5.00 out.
  await pool.query(`delete from journal_lines where journal_entry_id in
    (select id from journal_entries where org_id=$1 and source_type='payment_reversal' and source_id=$2)`, [org, fp]);
  await pool.query("delete from journal_entries where org_id=$1 and source_type='payment_reversal' and source_id=$2", [org, fp]);
  check("…removing the mutated entry restores the balance, confirming it was the only thing wrong",
    await orgBalanced());
}

// M4 — the lock. Two reversals of the SAME payment, genuinely concurrent, on two connections.
//
// The action locks the payment row `for update` before re-reading `reversed_at`. Without it both
// transactions read reversed_at = null, both pass, and paidAmount is double-subtracted. This drives
// the real lock rather than the harness's.
{
  const fresh = await mkInvoice("INV-M4", "500.00", "0", "3.75000000");
  const fp = await payInvoice(fresh.id, "200.00", "760.00", "750.00", false, "500.00");
  const before = (await pool.query("select paid_amount::text p from sales_invoices where id=$1", [fresh.id])).rows[0].p;

  const cA = await pool.connect();
  const cB = await pool.connect();
  await cA.query("begin"); await cB.query("begin");
  await cA.query("select reversed_at from payments where id=$1 for update", [fp]);
  // B blocks here until A commits — that is the lock doing its job.
  const bWaits = cB.query("select reversed_at from payments where id=$1 for update", [fp]);
  await cA.query("update payments set reversed_at = now() where id=$1", [fp]);
  await cA.query("update sales_invoices set paid_amount = (paid_amount - 200) where id=$1", [fresh.id]);
  await cA.query("commit");
  const seenByB = (await bWaits).rows[0].reversed_at;
  check("M4: the second transaction BLOCKS on the row lock and then sees reversed_at set",
    seenByB !== null, `B saw ${seenByB === null ? "null — it would double-subtract" : "a timestamp"}`);
  await cB.query("rollback");
  cA.release(); cB.release();
  const after = (await pool.query("select paid_amount::text p from sales_invoices where id=$1", [fresh.id])).rows[0].p;
  check("M4: paidAmount moved by exactly one payment, not two",
    mils(before) - mils(after) === 200_000, `${before} -> ${after}`);
}

await sweep();
await pool.end();
console.log("\nPayment reversal — mirroring, signs, refusals, and the four fixtures\n");
for (const [ok, name, extra] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  << ${extra}` : ""}`);
const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks`);
console.log(failed === 0 ? "PAYMENT REVERSAL PASS" : `PAYMENT REVERSAL FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
