/**
 * FX-7. Payment posting with currency capture — the realized-FX engine.
 *
 * The construction under test: Dr Bank at what the bank TRULY moved (payment-date value), Cr AR /
 * Dr AP at the document's BOOKED rate, and the difference to 4900 Exchange Gain/Loss as a DERIVED
 * line — so every entry balances by construction, bracketed by ledger-balance checks either side
 * of every posting event, per the standing rule.
 *
 * What each case is FOR:
 *
 *  - **Plain SAR payment maintains basePaidAmount** — the staleness bug fixed regardless of
 *    currency: before FX-7 nothing updated it, so it went stale on the FIRST payment even for a
 *    SAR org, and FX-8's aging math would have mixed a live paidAmount with a dead base twin.
 *  - **Foreign gain and loss, both sides of 4900** — receiving at 3.78 against a 3.75 booking is
 *    a credit (gain); closing at 3.70 is a debit (loss). Asserted line-by-line, not just "an FX
 *    line exists".
 *  - **The closing payment's applied figure is DERIVED (baseTotal − basePaidAmount), never
 *    converted again.** The three-partials case is built so the two methods VISIBLY differ
 *    (1251.70 derived vs 1251.69 converted): a fully paid invoice must land at exactly
 *    basePaidAmount === baseTotal. This is the assertion the mutation test breaks.
 *  - **PO out-direction mirror** — paying less base than booked is a GAIN (credit), with Dr AP at
 *    booked / Cr Bank at paid.
 *  - **Proforma advances have no booked rate** — both lines at the payment-date rate, NO FX line,
 *    and after conversion+send the invoice's basePaidAmount starts from the transferred payments'
 *    STORED baseAppliedAmount (the sendInvoiceAction flat-0 fix), identity for base currency.
 *  - **Deleting a payment un-pays from STORED figures** — basePaidAmount decrements by the
 *    payment's baseAppliedAmount (foreign) or stays paidAmount's identity mirror (base).
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const uniq = () => Math.random().toString(36).slice(2, 8);
const results = [];
const check = (name, cond, extra = "") => results.push([cond, name, extra]);
const num = (v) => Math.round(Number(v) * 1000); // integer thousandths — numeric(15,3) is exact here

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await assertFreshBuild(BASE);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
ctx.setDefaultTimeout(45000);
ctx.setDefaultNavigationTimeout(60000);
const page = await ctx.newPage();
const email = `pfx_${uniq()}@t.dev`;

await page.goto(`${BASE}/register`);
await page.fill('input[name="orgName"]', "Payment FX Co");
await page.fill('input[name="name"]', "Owner");
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', pass);
const cf = page.locator('input[name="confirmPassword"]');
if (await cf.count()) await cf.fill(pass);
await pickCountry(page);
await page.getByRole("button", { name: /register|create|sign up/i }).first().click();
await page.waitForURL(/\/dashboard/, { timeout: 40000 });

const u = (await db.query("select id, org_id from users where email=$1", [email])).rows[0];
const org = u.org_id;
const uid = u.id;
const cust = (await db.query("insert into customers (org_id,name) values ($1,'FX Payer') returning id", [org])).rows[0].id;
const vend = (await db.query("insert into vendors (org_id,name) values ($1,'FX Payee') returning id", [org])).rows[0].id;
const bank = (await db.query("select id, gl_account_id, name from bank_accounts where org_id=$1 limit 1", [org])).rows[0];
const acct = async (code) => (await db.query("select id from accounts where org_id=$1 and code=$2", [org, code])).rows[0]?.id;
const AR = await acct("1100"), AP = await acct("2000"), FX = await acct("4900"), ADV = await acct("2300");
check("the org has the 4900 Exchange Gain/Loss system account seeded", !!FX, String(FX));

const today = new Date().toISOString().slice(0, 10);
const setRate = async (cur, rate) => {
  await db.query(
    `insert into exchange_rates (org_id, from_currency, to_currency, rate, effective_date, source)
     values ($1,$2,'SAR',$3,current_date,'manual')
     on conflict (org_id, from_currency, to_currency, effective_date) do update set rate=$3, source='manual'`,
    [org, cur, rate]);
};

/** A sales invoice fabricated in its POSTED state: sent, base columns stored at the booked rate. */
const mkSentInvoice = async ({ currency, total, tax, rate }) => {
  const baseTotal = (Number(total) * Number(rate)).toFixed(2);
  const baseTax = (Number(tax) * Number(rate)).toFixed(2);
  return (await db.query(
    `insert into sales_invoices (org_id, invoice_number, customer_id, issue_date, due_date, subtotal, discount, tax_total, total,
                                 currency, status, exchange_rate, base_total, base_tax_amount, base_paid_amount, created_by_id)
     values ($1,$2,$3,$4,$4,$5,'0',$6,$7,$8,'sent',$9,$10,$11,'0',$12) returning id`,
    [org, `PFX-${uniq()}`, cust, today, total, tax, total, currency, rate, baseTotal, baseTax, uid])).rows[0].id;
};

const dialogs = () => page.getByRole("dialog");
async function recordPayment(url, amount) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Record Payment$/ }).click();
  await page.waitForTimeout(300);
  await page.locator("#pay-amount").fill(String(amount));
  await page.locator("#pay-bank-account").click();
  await page.waitForTimeout(150);
  await page.getByRole("option", { name: new RegExp(bank.name) }).first().click();
  await page.getByRole("button", { name: /^Save$/ }).click();
  await page.waitForTimeout(500);
  await dialogs().last().getByRole("button", { name: /^Record Payment$/ }).click();
  await page.waitForTimeout(1500);
}

const ledgerSums = async () => (await db.query(
  `select coalesce(sum(l.debit),0)::numeric(15,3)::text dr, coalesce(sum(l.credit),0)::numeric(15,3)::text cr
     from journal_lines l join journal_entries e on e.id = l.journal_entry_id where e.org_id = $1`, [org])).rows[0];
const balanced = async (label) => {
  const s = await ledgerSums();
  check(`LEDGER BALANCED ${label}`, s.dr === s.cr, `${s.dr} vs ${s.cr}`);
};
const linesOf = async (paymentId) => (await db.query(
  `select l.account_id, l.debit::text, l.credit::text
     from journal_lines l join journal_entries e on e.id = l.journal_entry_id
    where e.org_id=$1 and e.source_type='payment' and e.source_id=$2 order by l.id`, [org, paymentId])).rows;
const line = (ls, accountId) => ls.find((l) => l.account_id === accountId);
const paymentRow = async (where, val) => (await db.query(
  `select id, amount::text, currency, exchange_rate::text, base_amount::text, base_applied_amount::text, rate_source
     from payments where org_id=$1 and ${where}=$2 order by id`, [org, val])).rows;

// ================= A. plain SAR: basePaidAmount maintained (the staleness fix) =================
const invSar = await mkSentInvoice({ currency: null, total: "1150.00", tax: "150.00", rate: "1" });
await balanced("before SAR payment");
await recordPayment(`${BASE}/sales/invoices/${invSar}`, 500);
const aPay = (await paymentRow("sales_invoice_id", invSar))[0];
check("SAR payment row: identity capture", aPay && aPay.currency === null && Number(aPay.exchange_rate) === 1 && num(aPay.base_amount) === 500000 && num(aPay.base_applied_amount) === 500000, JSON.stringify(aPay));
check("…rateSource records the identity", aPay?.rate_source === "base currency", aPay?.rate_source);
const aInv = (await db.query("select paid_amount, base_paid_amount, status from sales_invoices where id=$1", [invSar])).rows[0];
check("STALENESS FIX: plain-SAR basePaidAmount moves with paidAmount", num(aInv.paid_amount) === 500000 && num(aInv.base_paid_amount) === 500000, JSON.stringify(aInv));
const aLines = await linesOf(aPay.id);
check("SAR entry: two lines, Dr bank 500 / Cr AR 500", aLines.length === 2 && num(line(aLines, bank.gl_account_id)?.debit) === 500000 && num(line(aLines, AR)?.credit) === 500000, JSON.stringify(aLines));
await balanced("after SAR payment");

// ================= B. foreign GAIN: received at 3.78 against a 3.75 booking =================
const invUsd = await mkSentInvoice({ currency: "USD", total: "1150.00", tax: "150.00", rate: "3.75" });
await setRate("USD", "3.78");
await balanced("before USD gain payment");
await recordPayment(`${BASE}/sales/invoices/${invUsd}`, 400);
const bPay = (await paymentRow("sales_invoice_id", invUsd))[0];
check("USD payment: resolved payment-date rate, both base figures stored",
  bPay && bPay.currency === "USD" && Number(bPay.exchange_rate) === 3.78 && num(bPay.base_amount) === 1512000 && num(bPay.base_applied_amount) === 1500000, JSON.stringify(bPay));
check("…rateSource is the resolved row's own source", bPay?.rate_source === "manual", bPay?.rate_source);
const bLines = await linesOf(bPay.id);
check("GAIN: Dr bank 1512 (received) / Cr AR 1500 (booked) / Cr 4900 12",
  bLines.length === 3 && num(line(bLines, bank.gl_account_id)?.debit) === 1512000 && num(line(bLines, AR)?.credit) === 1500000 && num(line(bLines, FX)?.credit) === 12000,
  JSON.stringify(bLines));
const bInv = (await db.query("select paid_amount, base_paid_amount, status from sales_invoices where id=$1", [invUsd])).rows[0];
check("basePaidAmount accumulates the BOOKED-rate figure, not the received one", num(bInv.base_paid_amount) === 1500000 && bInv.status === "partially_paid", JSON.stringify(bInv));
await balanced("after USD gain payment");

// ================= C. foreign LOSS on the CLOSING payment: derived applied figure =================
await setRate("USD", "3.70");
await balanced("before USD closing payment");
await recordPayment(`${BASE}/sales/invoices/${invUsd}`, 750);
const cPay = (await paymentRow("sales_invoice_id", invUsd))[1];
check("closing payment: baseApplied DERIVED as baseTotal − basePaidAmount",
  cPay && num(cPay.base_amount) === 2775000 && num(cPay.base_applied_amount) === 2812500, JSON.stringify(cPay));
const cLines = await linesOf(cPay.id);
check("LOSS: Dr bank 2775 / Cr AR 2812.50 / Dr 4900 37.50 — the other side of the account",
  cLines.length === 3 && num(line(cLines, bank.gl_account_id)?.debit) === 2775000 && num(line(cLines, AR)?.credit) === 2812500 && num(line(cLines, FX)?.debit) === 37500,
  JSON.stringify(cLines));
const cInv = (await db.query("select paid_amount, base_paid_amount, base_total, status from sales_invoices where id=$1", [invUsd])).rows[0];
check("fully paid lands at basePaidAmount === baseTotal EXACTLY", cInv.status === "paid" && num(cInv.base_paid_amount) === num(cInv.base_total), JSON.stringify(cInv));
await balanced("after USD closing payment");

// ================= D. the derivation is OBSERVABLE: three partials where derived ≠ converted =================
// 1000 USD at booked 3.755; payments at the same 3.755. Two partials of 333.33 each round to
// 1251.65; the closing 333.34 CONVERTED would be 1251.69, but the derived figure is
// 3755.00 − 2503.30 = 1251.70 — the two methods differ by a visible cent, and only the derived
// one sums back to baseTotal. THIS is the check the mutation test must break.
const invDrift = await mkSentInvoice({ currency: "USD", total: "1000.00", tax: "0", rate: "3.755" });
await setRate("USD", "3.755");
await recordPayment(`${BASE}/sales/invoices/${invDrift}`, 333.33);
await recordPayment(`${BASE}/sales/invoices/${invDrift}`, 333.33);
await balanced("before drift-case closing payment");
await recordPayment(`${BASE}/sales/invoices/${invDrift}`, 333.34);
const dPays = await paymentRow("sales_invoice_id", invDrift);
check("two partials each applied 1251.65 at the booked rate", dPays.length === 3 && num(dPays[0].base_applied_amount) === 1251650 && num(dPays[1].base_applied_amount) === 1251650, JSON.stringify(dPays.map((p) => p.base_applied_amount)));
check("the closing partial applied the DERIVED 1251.70 — converting again would say 1251.69", num(dPays[2].base_applied_amount) === 1251700, dPays[2].base_applied_amount);
const dInv = (await db.query("select base_paid_amount, base_total, status from sales_invoices where id=$1", [invDrift])).rows[0];
check("DERIVED-BY-CONSTRUCTION: basePaidAmount === baseTotal with zero rounding drift", dInv.status === "paid" && num(dInv.base_paid_amount) === num(dInv.base_total) && num(dInv.base_total) === 3755000, JSON.stringify(dInv));
const dLines = await linesOf(dPays[2].id);
check("…and the cent shows up honestly as a 0.01 FX loss line, keeping the entry balanced",
  num(line(dLines, FX)?.debit ?? 0) === 10 && num(line(dLines, bank.gl_account_id)?.debit) === 1251690, JSON.stringify(dLines));
await balanced("after drift-case closing payment");

// ================= E. PO out-direction: paying LESS base than booked is a GAIN =================
const po = (await db.query(
  `insert into purchase_orders (org_id, po_number, vendor_id, order_date, subtotal, discount, tax_total, total,
                                currency, status, exchange_rate, base_total, base_tax_amount, base_paid_amount, created_by_id)
   values ($1,$2,$3,$4,'2000.00','0','300.00','2300.00','GBP','received','4.71','10833.00','1413.00','0',$5) returning id`,
  [org, `PFXPO-${uniq()}`, vend, today, uid])).rows[0].id;
await setRate("GBP", "4.68");
await balanced("before PO payment");
await recordPayment(`${BASE}/purchasing/orders/${po}`, 2300);
const ePay = (await paymentRow("purchase_order_id", po))[0];
const eLines = await linesOf(ePay.id);
check("PO mirror: Dr AP 10833 (booked, derived closing) / Cr bank 10764 (paid) / Cr 4900 69 (gain)",
  eLines.length === 3 && num(line(eLines, AP)?.debit) === 10833000 && num(line(eLines, bank.gl_account_id)?.credit) === 10764000 && num(line(eLines, FX)?.credit) === 69000,
  JSON.stringify(eLines));
const ePo = (await db.query("select paid_amount, base_paid_amount, base_total from purchase_orders where id=$1", [po])).rows[0];
check("PO basePaidAmount lands at baseTotal exactly", num(ePo.base_paid_amount) === num(ePo.base_total), JSON.stringify(ePo));
await balanced("after PO payment");

// ================= F. proforma advance: no booked rate, both lines at payment-date, NO FX line =================
await setRate("EUR", "4.05");
const pf = (await db.query(
  `insert into proforma_invoices (org_id, proforma_number, customer_id, status, issue_date, subtotal, tax_total, total, currency, created_by_id)
   values ($1,$2,$3,'sent',$4,'1000.00','0','1000.00','EUR',$5) returning id`,
  [org, `PFXPI-${uniq()}`, cust, today, uid])).rows[0].id;
await db.query(
  `insert into proforma_invoice_items (proforma_invoice_id, description, quantity, unit_price, tax_rate_percent, line_total)
   values ($1,'Adv',1,'1000.00','0','1000.00')`, [pf]);
await balanced("before proforma advance");
await recordPayment(`${BASE}/sales/proforma/${pf}`, 200);
const fPay = (await paymentRow("proforma_invoice_id", pf))[0];
check("advance: applied figure IS the received figure (no booked rate exists)",
  fPay && num(fPay.base_amount) === 810000 && num(fPay.base_applied_amount) === 810000 && fPay.currency === "EUR", JSON.stringify(fPay));
const fLines = await linesOf(fPay.id);
// Advances model: the receipt credits 2300 Customer Advances, never AR.
check("…two lines only — no FX line on an advance, credited to 2300", fLines.length === 2 && num(line(fLines, bank.gl_account_id)?.debit) === 810000 && num(line(fLines, ADV)?.credit) === 810000, JSON.stringify(fLines));
check("proforma basePaidAmount accumulates the payment-date base value",
  num((await db.query("select base_paid_amount from proforma_invoices where id=$1", [pf])).rows[0].base_paid_amount) === 810000);
await balanced("after proforma advance");

// ---- conversion: an invoice BORN with advances (it never passes through send) starts its
// basePaidAmount from the transferred payments' STORED baseAppliedAmount, not null and not 0 ----
await page.goto(`${BASE}/sales/proforma/${pf}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /^Convert to…$/ }).click();
await page.waitForTimeout(400);
await page.getByRole("menuitem", { name: /Invoice/ }).first().click();
await page.waitForTimeout(500);
await dialogs().last().getByRole("button", { name: /^Convert$/ }).click();
await page.waitForURL(/\/sales\/invoices\/\d+$/, { timeout: 20000 });
const convInv = Number(page.url().match(/\/(\d+)$/)[1]);
const gInv = (await db.query("select status, paid_amount, base_paid_amount from sales_invoices where id=$1", [convInv])).rows[0];
check("CONVERSION-INIT FIX: born-partially-paid foreign invoice starts basePaidAmount at the stored 810, not null/0",
  gInv.status === "partially_paid" && num(gInv.paid_amount) === 200000 && num(gInv.base_paid_amount) === 810000, JSON.stringify(gInv));
await balanced("after conversion (transfer moves no money)");

// ================= G. deletion un-pays from STORED figures =================
await balanced("before deleting the USD partial");
await page.goto(`${BASE}/sales/invoices/${invUsd}`, { waitUntil: "networkidle" });
// Target the 400-USD partial's own row — history order is not part of this suite's contract.
await page.locator("tr", { hasText: "400.00" }).getByLabel("Delete").first().click();
await page.waitForTimeout(400);
await dialogs().last().getByRole("button", { name: /^Delete Payment$/ }).click();
await page.waitForTimeout(1500);
const gUsd = (await db.query("select paid_amount, base_paid_amount, status from sales_invoices where id=$1", [invUsd])).rows[0];
check("deleting the 400-USD partial removes its STORED baseApplied 1500: 4312.50 → 2812.50",
  num(gUsd.paid_amount) === 750000 && num(gUsd.base_paid_amount) === 2812500 && gUsd.status === "partially_paid", JSON.stringify(gUsd));
check("…and its journal entry is gone", (await linesOf(bPay.id)).length === 0);
await balanced("after deleting the USD partial");

await page.goto(`${BASE}/sales/invoices/${invSar}`, { waitUntil: "networkidle" });
await page.getByLabel("Delete").first().click();
await page.waitForTimeout(400);
await dialogs().last().getByRole("button", { name: /^Delete Payment$/ }).click();
await page.waitForTimeout(1500);
const gSar = (await db.query("select paid_amount, base_paid_amount, status from sales_invoices where id=$1", [invSar])).rows[0];
check("deleting the SAR payment keeps the identity: basePaidAmount back to 0 with paidAmount",
  num(gSar.paid_amount) === 0 && num(gSar.base_paid_amount) === 0 && gSar.status === "sent", JSON.stringify(gSar));
await balanced("after deleting the SAR payment");

await db.end();
await browser.close();
let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "PAYMENT FX PASS" : "PAYMENT FX FAIL");
process.exit(ok ? 0 : 1);
