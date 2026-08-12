/**
 * Customer advances. Grows with the advances commits — this file is the spec's dedicated suite.
 *
 * The accounting model under test: money received against a proforma is a LIABILITY (2300
 * Customer Advances) — never AR (a proforma never created a receivable), never revenue (cash
 * receipt is not revenue recognition). Every posting event is bracketed by ledger-balance checks,
 * per the standing rule.
 *
 * Commit 2 scope (cases A and B of the spec):
 *  - **A. A proforma itself posts NOTHING** — created and sent, no journal entry of any kind.
 *  - **B. An advance receipt posts Dr Bank / Cr 2300** — through the REAL payment dialog, with
 *    1100 untouched (zero lines, so AR aging cannot go negative), revenue untouched, the payment
 *    row tagged kind='advance_receipt', and the FX-7 capture columns intact.
 *  - **A foreign advance** keeps the whole FX shape: both lines at the payment-date base value.
 *  - **Deleting an advance receipt** reverses cleanly: entry gone, 2300 back to zero, proforma
 *    un-paid — from stored figures, like every deletion.
 *
 * Commit 3 scope (cases D and I — the conversion revenue fix):
 *  - **D. A conversion born non-draft POSTS**: a fully-advanced proforma converts to a paid
 *    invoice whose revenue/AR entry exists (exactly once), whose stock decremented, and whose cash
 *    posted exactly once (the advance's own entry — conversion moves no money). The partial-advance
 *    case posts identically with status partially_paid.
 *  - **Advance-free conversions still post NOTHING at conversion** (control): a plain draft whose
 *    one posting moment stays at send — and send still posts, via the same extracted function.
 *  - **I. The P&L carries the converted revenue** — read from the real reports page, which is
 *    account-driven, so this is the ledger speaking.
 *  - **A missing conversion-date rate REFUSES the conversion** (FX-6 rule): no invoice, no
 *    journal, the confirm dialog offers "Fetch rate & retry"; after a rate exists the same
 *    conversion posts at the conversion-date rate while basePaidAmount keeps the advance's STORED
 *    payment-date base — never a fresh conversion.
 *
 * Commit 4 scope (cases C, E, G, H — the advance application):
 *  - **C/D applications**: each applied payment posts (advance_application, payment.id) —
 *    Dr 2300 at the advance's CARRIED base / Cr 1100 at the booked rate — so AR outstanding and
 *    2300 both land where the spec says (partial: AR 6,000 left; full: AR 0, 2300 0).
 *  - **G. multi-currency**: the USD advance applies with a legitimate 4900 line (carried 1,880 vs
 *    booked 1,900 → 20 realized loss), and a three-partial full advance proves the CLOSING
 *    application is DERIVED (1,569.832, not 1,570.131 re-converted) so basePaidAmount lands at
 *    baseTotal exactly.
 *  - **E. excess advance (§10 cap)**: whole payments apply in order up to the invoice total; the
 *    payment that does not fit keeps salesInvoiceId null and stays in 2300 as available advance.
 *  - **Applied advances refuse deletion** — the receipt stands behind a posted invoice.
 *  - **H. AR reconciliation**: GL 1100 equals the invoice subledger Σ(baseTotal − basePaidAmount),
 *    WITH a seeded-divergence control proving the check can fail.
 *
 * Mutation-proofed (per the review instruction): reverting the credit to 1100 must FAIL here
 * naming the wrong account — the suite asserts the new rule, it does not merely tolerate it.
 * Commit 3's mutation: suppressing the conversion-path posting must FAIL case D naming the
 * missing revenue. Commit 4's mutations: suppressing the application journals must FAIL C/D/E/H;
 * re-converting the closing application instead of deriving it must FAIL G naming both figures.
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
const num = (v) => Math.round(Number(v) * 1000);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await assertFreshBuild(BASE);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
ctx.setDefaultTimeout(45000);
ctx.setDefaultNavigationTimeout(60000);
const page = await ctx.newPage();
const email = `adv_${uniq()}@t.dev`;

await page.goto(`${BASE}/register`);
await page.fill('input[name="orgName"]', "Advances Co");
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
const cust = (await db.query("insert into customers (org_id,name) values ($1,'Adv Client') returning id", [org])).rows[0].id;
const bank = (await db.query("select id, gl_account_id, name from bank_accounts where org_id=$1 limit 1", [org])).rows[0];
const acct = async (code) => (await db.query("select id from accounts where org_id=$1 and code=$2", [org, code])).rows[0]?.id;
const AR = await acct("1100"), ADV = await acct("2300"), REV = await acct("4000"), FX = await acct("4900");
check("the org has the 2300 Customer Advances system account", !!ADV, String(ADV));

const today = new Date().toISOString().slice(0, 10);
const mkProforma = async ({ currency, total }) => {
  const id = (await db.query(
    `insert into proforma_invoices (org_id, proforma_number, customer_id, status, issue_date, subtotal, tax_total, total, currency, created_by_id)
     values ($1,$2,$3,'sent',$4,$5,'0',$5,$6,$7) returning id`,
    [org, `ADV-${uniq()}`, cust, today, total, currency, u.id])).rows[0].id;
  await db.query(
    `insert into proforma_invoice_items (proforma_invoice_id, description, quantity, unit_price, tax_rate_percent, line_total)
     values ($1,'Adv',1,$2,'0',$2)`, [id, total]);
  return id;
};

const ledgerSums = async () => (await db.query(
  `select coalesce(sum(l.debit),0)::numeric(15,3)::text dr, coalesce(sum(l.credit),0)::numeric(15,3)::text cr
     from journal_lines l join journal_entries e on e.id = l.journal_entry_id where e.org_id = $1`, [org])).rows[0];
const balanced = async (label) => {
  const s = await ledgerSums();
  check(`LEDGER BALANCED ${label}`, s.dr === s.cr, `${s.dr} vs ${s.cr}`);
};
const accountLines = async (accountId) => (await db.query(
  `select coalesce(sum(l.debit),0)::text dr, coalesce(sum(l.credit),0)::text cr, count(*)::int n
     from journal_lines l join journal_entries e on e.id = l.journal_entry_id
    where e.org_id=$1 and l.account_id=$2`, [org, accountId])).rows[0];
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

// ================= A. a proforma itself posts NOTHING =================
const pfA = await mkProforma({ currency: null, total: "10000.00" });
const entriesBefore = (await db.query("select count(*)::int n from journal_entries where org_id=$1", [org])).rows[0].n;
check("CASE A: a created+sent proforma produced no journal entry of any kind", entriesBefore === 0, `entries=${entriesBefore}`);
check("…no AR", num((await accountLines(AR)).dr) === 0 && num((await accountLines(AR)).cr) === 0);
check("…no revenue", num((await accountLines(REV)).cr) === 0);

// ================= B. advance receipt: Dr Bank / Cr 2300 — never AR, never revenue =================
await balanced("before the SAR advance");
await recordPayment(`${BASE}/sales/proforma/${pfA}`, 4000);
const pay = (await db.query(
  `select id, kind, amount::text, currency, exchange_rate::text, base_amount::text, base_applied_amount::text, rate_source
     from payments where org_id=$1 and proforma_invoice_id=$2`, [org, pfA])).rows[0];
check("CASE B: the payment row is tagged kind='advance_receipt'", pay?.kind === "advance_receipt", JSON.stringify(pay));
check("…FX capture intact (identity: rate 1, base 4000, source 'base currency')",
  Number(pay?.exchange_rate) === 1 && num(pay?.base_amount) === 4000000 && pay?.rate_source === "base currency", JSON.stringify(pay));
const lines = (await db.query(
  `select l.account_id, l.debit::text, l.credit::text from journal_lines l
     join journal_entries e on e.id = l.journal_entry_id
    where e.org_id=$1 and e.source_type='payment' and e.source_id=$2 order by l.id`, [org, pay.id])).rows;
check("Dr Bank 4,000 / Cr 2300 Customer Advances 4,000 — two lines, nothing else",
  lines.length === 2
    && num(lines.find((l) => l.account_id === bank.gl_account_id)?.debit) === 4000000
    && num(lines.find((l) => l.account_id === ADV)?.credit) === 4000000,
  JSON.stringify(lines));
const arAfter = await accountLines(AR);
check("1100 has ZERO lines — the advance cannot drive AR negative", arAfter.n === 0, JSON.stringify(arAfter));
check("revenue untouched — a cash receipt is not revenue recognition", num((await accountLines(REV)).cr) === 0);
const pfPaid = (await db.query("select paid_amount, base_paid_amount from proforma_invoices where id=$1", [pfA])).rows[0];
check("the proforma's paid figures track as before (4,000 / 4,000)",
  num(pfPaid.paid_amount) === 4000000 && num(pfPaid.base_paid_amount) === 4000000, JSON.stringify(pfPaid));
await balanced("after the SAR advance");

// ================= a FOREIGN advance keeps the whole FX shape =================
await db.query(
  `insert into exchange_rates (org_id, from_currency, to_currency, rate, effective_date, source)
   values ($1,'USD','SAR','3.76',current_date,'manual')`, [org]);
const pfU = await mkProforma({ currency: "USD", total: "1000.00" });
await balanced("before the USD advance");
await recordPayment(`${BASE}/sales/proforma/${pfU}`, 1000);
const payU = (await db.query(
  `select id, kind, currency, exchange_rate::text, base_amount::text, rate_source from payments where org_id=$1 and proforma_invoice_id=$2`,
  [org, pfU])).rows[0];
check("USD advance: kind + FX columns captured (3.76, base 3,760, source manual)",
  payU?.kind === "advance_receipt" && payU?.currency === "USD" && Number(payU?.exchange_rate) === 3.76
    && num(payU?.base_amount) === 3760000 && payU?.rate_source === "manual", JSON.stringify(payU));
const linesU = (await db.query(
  `select l.account_id, l.debit::text, l.credit::text from journal_lines l
     join journal_entries e on e.id = l.journal_entry_id
    where e.org_id=$1 and e.source_type='payment' and e.source_id=$2`, [org, payU.id])).rows;
check("…posted Dr Bank 3,760.00 / Cr 2300 3,760.00 at the payment-date base value",
  num(linesU.find((l) => l.account_id === bank.gl_account_id)?.debit) === 3760000
    && num(linesU.find((l) => l.account_id === ADV)?.credit) === 3760000,
  JSON.stringify(linesU));
await balanced("after the USD advance");

// ================= deleting an advance receipt reverses cleanly =================
await page.goto(`${BASE}/sales/proforma/${pfU}`, { waitUntil: "networkidle" });
await page.getByLabel("Delete").first().click();
await page.waitForTimeout(400);
await dialogs().last().getByRole("button", { name: /^Delete Payment$/ }).click();
await page.waitForTimeout(1500);
check("deleting the USD advance removed its journal entry",
  (await db.query("select count(*)::int n from journal_entries where org_id=$1 and source_type='payment' and source_id=$2", [org, payU.id])).rows[0].n === 0);
const advAfterDel = await accountLines(ADV);
check("…2300 back to the SAR advance only (Cr 4,000 net)", num(advAfterDel.cr) - num(advAfterDel.dr) === 4000000, JSON.stringify(advAfterDel));
const pfUAfter = (await db.query("select paid_amount, base_paid_amount from proforma_invoices where id=$1", [pfU])).rows[0];
check("…the proforma is un-paid from stored figures", num(pfUAfter.paid_amount) === 0 && num(pfUAfter.base_paid_amount) === 0, JSON.stringify(pfUAfter));
await balanced("after deleting the USD advance");

// ================= D. conversion born non-draft POSTS: full advance → paid invoice with revenue =================
const convertViaUi = async (pfId) => {
  await page.goto(`${BASE}/sales/proforma/${pfId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Convert to…$/ }).click();
  await page.waitForTimeout(400);
  await page.getByRole("menuitem", { name: /Invoice/ }).first().click();
  await page.waitForTimeout(500);
  await dialogs().last().getByRole("button", { name: /^Convert$/ }).click();
  await page.waitForURL(/\/sales\/invoices\/\d+$/, { timeout: 20000 });
  return Number(page.url().match(/\/(\d+)$/)[1]);
};
const invoiceEntry = async (invId) => (await db.query(
  "select id from journal_entries where org_id=$1 and source_type='sales_invoice' and source_id=$2", [org, invId])).rows;
const invoiceLines = async (invId) => (await db.query(
  `select l.account_id, l.debit::text, l.credit::text from journal_lines l
     join journal_entries e on e.id = l.journal_entry_id
    where e.org_id=$1 and e.source_type='sales_invoice' and e.source_id=$2 order by l.id`, [org, invId])).rows;
// Commit 4 helpers: the application entry keyed (advance_application, payment.id); the AR ledger
// position of one invoice (its posting Dr minus its applications' and payments' Cr); net 2300.
const applicationLines = async (paymentId) => (await db.query(
  `select l.account_id, l.debit::text, l.credit::text from journal_lines l
     join journal_entries e on e.id = l.journal_entry_id
    where e.org_id=$1 and e.source_type='advance_application' and e.source_id=$2 order by l.id`, [org, paymentId])).rows;
const arNetFor = async (invId) => Number((await db.query(
  `select coalesce(sum(l.debit),0) - coalesce(sum(l.credit),0) as net
     from journal_lines l join journal_entries e on e.id = l.journal_entry_id
    where e.org_id=$1 and l.account_id=$2
      and ((e.source_type='sales_invoice' and e.source_id=$3)
        or (e.source_type in ('advance_application','payment') and e.source_id in (select id from payments where sales_invoice_id=$3)))`,
  [org, AR, invId])).rows[0].net);
const advNet = async () => { const a = await accountLines(ADV); return num(a.cr) - num(a.dr); };

const prod = (await db.query(
  "insert into products (org_id, sku, name, quantity_on_hand) values ($1,'ADV-SKU','Adv Widget',50) returning id", [org])).rows[0].id;
const pfD = (await db.query(
  `insert into proforma_invoices (org_id, proforma_number, customer_id, status, issue_date, subtotal, tax_total, total, created_by_id)
   values ($1,$2,$3,'sent',$4,'6000.00','0','6000.00',$5) returning id`, [org, `ADV-${uniq()}`, cust, today, u.id])).rows[0].id;
await db.query(
  `insert into proforma_invoice_items (proforma_invoice_id, product_id, description, quantity, unit_price, tax_rate_percent, line_total)
   values ($1,$2,'Adv Widget',2,'3000.00','0','6000.00')`, [pfD, prod]);
await recordPayment(`${BASE}/sales/proforma/${pfD}`, 6000);
await balanced("before the fully-advanced conversion");
const cashEntriesBefore = (await db.query("select count(*)::int n from journal_entries where org_id=$1 and source_type='payment'", [org])).rows[0].n;
const invD = await convertViaUi(pfD);
const dInv = (await db.query(
  "select status, paid_amount::text, base_paid_amount::text, exchange_rate::text, base_total::text from sales_invoices where id=$1", [invD])).rows[0];
check("CASE D: fully-advanced proforma converts to a PAID invoice (6,000 / 6,000, identity FX)",
  dInv.status === "paid" && num(dInv.paid_amount) === 6000000 && num(dInv.base_paid_amount) === 6000000
    && Number(dInv.exchange_rate) === 1 && num(dInv.base_total) === 6000000, JSON.stringify(dInv));
check("CASE D: the invoice journal EXISTS exactly once — born-paid no longer skips posting", (await invoiceEntry(invD)).length === 1);
const dLines = await invoiceLines(invD);
check("CASE D: conversion posted REVENUE — Dr 1100 AR 6,000 / Cr 4000 Sales Revenue 6,000, two lines",
  dLines.length === 2 && num(dLines.find((l) => l.account_id === AR)?.debit) === 6000000
    && num(dLines.find((l) => l.account_id === REV)?.credit) === 6000000, JSON.stringify(dLines));
check("CASE D: cash posted exactly ONCE — conversion moved no money (payment entries unchanged)",
  (await db.query("select count(*)::int n from journal_entries where org_id=$1 and source_type='payment'", [org])).rows[0].n === cashEntriesBefore);
check("CASE D: stock decremented at conversion (50 − 2 = 48)",
  (await db.query("select quantity_on_hand from products where id=$1", [prod])).rows[0].quantity_on_hand === 48);
const dPayId = (await db.query("select id from payments where org_id=$1 and proforma_invoice_id=$2", [org, pfD])).rows[0].id;
const dApp = await applicationLines(dPayId);
check("CASE D: the advance APPLIED — (advance_application, payment.id) posts Dr 2300 6,000 / Cr 1100 6,000, two lines",
  dApp.length === 2 && num(dApp.find((l) => l.account_id === ADV)?.debit) === 6000000
    && num(dApp.find((l) => l.account_id === AR)?.credit) === 6000000, JSON.stringify(dApp));
check("CASE D: AR = 0 for the fully-advanced invoice — posted and cleared", (await arNetFor(invD)) === 0);
check("CASE D: 2300 zeroed for the applied amount (only pfA's 4,000 advance remains)", (await advNet()) === 4000000);
await balanced("after the fully-advanced conversion");

// ---- the partial-advance case posts identically, with status partially_paid ----
// pfA carries the 4,000 SAR advance against a 10,000 total from case B.
const invA = await convertViaUi(pfA);
const aInv = (await db.query("select status, paid_amount::text, base_paid_amount::text from sales_invoices where id=$1", [invA])).rows[0];
check("partial advance: born partially_paid (4,000 of 10,000) and posted",
  aInv.status === "partially_paid" && num(aInv.paid_amount) === 4000000 && num(aInv.base_paid_amount) === 4000000, JSON.stringify(aInv));
const aLines = await invoiceLines(invA);
check("partial advance: Dr 1100 AR 10,000 / Cr 4000 Revenue 10,000 — the FULL total, not the paid part",
  aLines.length === 2 && num(aLines.find((l) => l.account_id === AR)?.debit) === 10000000
    && num(aLines.find((l) => l.account_id === REV)?.credit) === 10000000, JSON.stringify(aLines));
const aPayId = (await db.query("select id from payments where org_id=$1 and proforma_invoice_id=$2", [org, pfA])).rows[0].id;
const aApp = await applicationLines(aPayId);
check("CASE C: partial application posts Dr 2300 4,000 / Cr 1100 4,000",
  aApp.length === 2 && num(aApp.find((l) => l.account_id === ADV)?.debit) === 4000000
    && num(aApp.find((l) => l.account_id === AR)?.credit) === 4000000, JSON.stringify(aApp));
check("CASE C: AR outstanding = 6,000 (10,000 posted − 4,000 applied)", (await arNetFor(invA)) === 6000);
check("CASE C: 2300 remaining for this advance = 0 — every received advance now applied", (await advNet()) === 0);
await balanced("after the partial-advance conversion");

// ================= I. the P&L carries the converted revenue (account-driven report) =================
await page.goto(`${BASE}/finance/reports?report=pl`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
const plBody = await page.locator("body").innerText();
check("CASE I: P&L page shows Total Revenue", /Total Revenue/.test(plBody));
check("CASE I: P&L revenue includes both conversions (6,000 + 10,000 = 16,000)", /16[,.]?000/.test(plBody),
  plBody.match(/Total Revenue[\s\S]{0,80}/)?.[0]?.replace(/\s+/g, " ") ?? "no match");

// ================= an advance-free conversion still posts NOTHING at conversion (control) =================
const pfN = await mkProforma({ currency: null, total: "800.00" });
const invN = await convertViaUi(pfN);
const nInv = (await db.query("select status, base_total from sales_invoices where id=$1", [invN])).rows[0];
check("advance-free conversion stays a plain DRAFT — one posting moment per path",
  nInv.status === "draft" && nInv.base_total === null, JSON.stringify(nInv));
check("…and posted no journal at conversion", (await invoiceEntry(invN)).length === 0);
// send still posts, through the same extracted function — the refactor left the send path whole
await page.goto(`${BASE}/sales/invoices/${invN}`, { waitUntil: "networkidle" });
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Send Invoice", exact: true }).click();
await page.waitForTimeout(400);
await dialogs().last().getByRole("button", { name: "Send Invoice", exact: true }).click();
await page.waitForTimeout(1500);
const nLines = await invoiceLines(invN);
check("…send then posts Dr AR 800 / Cr Revenue 800 exactly as before the extraction",
  nLines.length === 2 && num(nLines.find((l) => l.account_id === AR)?.debit) === 800000
    && num(nLines.find((l) => l.account_id === REV)?.credit) === 800000, JSON.stringify(nLines));
await balanced("after sending the advance-free conversion");

// ================= a missing conversion-date rate REFUSES the conversion =================
const pfU2 = await mkProforma({ currency: "USD", total: "2000.00" });
await recordPayment(`${BASE}/sales/proforma/${pfU2}`, 500); // captured at 3.76 → base 1,880
await db.query("delete from exchange_rates where org_id=$1 and from_currency='USD'", [org]);
const invCountBefore = (await db.query("select count(*)::int n from sales_invoices where org_id=$1", [org])).rows[0].n;
await page.goto(`${BASE}/sales/proforma/${pfU2}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /^Convert to…$/ }).click();
await page.waitForTimeout(400);
await page.getByRole("menuitem", { name: /Invoice/ }).first().click();
await page.waitForTimeout(500);
await dialogs().last().getByRole("button", { name: /^Convert$/ }).click();
await page.waitForTimeout(1500);
check("missing rate REFUSES the conversion — the dialog names the missing rate",
  (await dialogs().last().getByText(/No USD → SAR exchange rate/).count()) >= 1);
check("…and offers the one-click 'Fetch rate & retry' seam",
  (await dialogs().last().getByRole("button", { name: /Fetch rate & retry/ }).count()) === 1);
check("…no invoice was created and the proforma stays unconverted",
  (await db.query("select count(*)::int n from sales_invoices where org_id=$1", [org])).rows[0].n === invCountBefore
    && (await db.query("select converted_invoice_id from proforma_invoices where id=$1", [pfU2])).rows[0].converted_invoice_id === null);
await dialogs().last().getByRole("button", { name: /^Cancel$/ }).click();
await page.waitForTimeout(400);
// after a rate exists (deliberately DIFFERENT from the advance's 3.76), the same conversion posts
await db.query(
  `insert into exchange_rates (org_id, from_currency, to_currency, rate, effective_date, source)
   values ($1,'USD','SAR','3.80',current_date,'manual')`, [org]);
const invU2 = await convertViaUi(pfU2);
const u2Inv = (await db.query(
  "select status, exchange_rate::text, base_total::text, base_paid_amount::text from sales_invoices where id=$1", [invU2])).rows[0];
check("foreign conversion posts at the CONVERSION-date rate (3.80 → baseTotal 7,600)",
  u2Inv.status === "partially_paid" && Number(u2Inv.exchange_rate) === 3.8 && num(u2Inv.base_total) === 7600000, JSON.stringify(u2Inv));
// CASE G: the applied advance clears AR at the BOOKED rate (500 × 3.80 = 1,900) while 2300 gives
// up the advance's CARRIED payment-date base (1,880); the 20 between them is the realized FX loss,
// derived to 4900 — the exact FX-7 construction with 2300 standing where Bank stood. basePaidAmount
// is the sum of the AR-CLEARING figures, so document and ledger agree by construction.
check("CASE G: basePaidAmount is the AR-clearing figure at the booked rate (1,900, not the carried 1,880)",
  num(u2Inv.base_paid_amount) === 1900000, JSON.stringify(u2Inv));
const u2Lines = await invoiceLines(invU2);
check("…journal: Dr 1100 AR 7,600 / Cr 4000 Revenue 7,600",
  u2Lines.length === 2 && num(u2Lines.find((l) => l.account_id === AR)?.debit) === 7600000
    && num(u2Lines.find((l) => l.account_id === REV)?.credit) === 7600000, JSON.stringify(u2Lines));
const u2PayId = (await db.query("select id from payments where org_id=$1 and proforma_invoice_id=$2", [org, pfU2])).rows[0].id;
const u2App = await applicationLines(u2PayId);
check("CASE G: application Dr 2300 1,880 (carried) / Cr 1100 1,900 (booked) / Dr 4900 20 (realized loss) — three lines",
  u2App.length === 3 && num(u2App.find((l) => l.account_id === ADV)?.debit) === 1880000
    && num(u2App.find((l) => l.account_id === AR)?.credit) === 1900000
    && num(u2App.find((l) => l.account_id === FX)?.debit) === 20000, JSON.stringify(u2App));
check("CASE G: AR outstanding = 5,700 (7,600 − 1,900) and 2300 fully released", (await arNetFor(invU2)) === 5700 && (await advNet()) === 0);
await balanced("after the foreign conversion");

// ================= G (closing derivation): three partials, derived ≠ re-converted =================
// Advances at 3.80, carried at the SAR minor unit: 1,266.65 + 1,266.65 + 1,266.69 = 3,799.99.
// Converted at 4.71 (baseTotal 4,710.00). The first two applications clear AR at
// 333.33 × 4.71 = 1,569.9843 → 1,569.98; the CLOSING one is DERIVED:
// 4,710.00 − 3,139.96 = 1,570.04 — re-converting 333.34 would say 1,570.03 and strand
// basePaidAmount at 4,709.99 ≠ baseTotal.
const pfG = await mkProforma({ currency: "USD", total: "1000.00" });
await recordPayment(`${BASE}/sales/proforma/${pfG}`, 333.33);
await recordPayment(`${BASE}/sales/proforma/${pfG}`, 333.33);
await recordPayment(`${BASE}/sales/proforma/${pfG}`, 333.34);
const gCarried = (await db.query(
  "select coalesce(sum(base_applied_amount),0)::text s from payments where org_id=$1 and proforma_invoice_id=$2", [org, pfG])).rows[0].s;
check("G-closing fixture: three USD advances carried at 3.80 = 3,799.99 (per-payment minor-unit rounding)", num(gCarried) === 3799990, gCarried);
await db.query("delete from exchange_rates where org_id=$1 and from_currency='USD'", [org]);
await db.query(
  `insert into exchange_rates (org_id, from_currency, to_currency, rate, effective_date, source)
   values ($1,'USD','SAR','4.71',current_date,'manual')`, [org]);
await balanced("before the three-partial full-advance conversion");
const invG = await convertViaUi(pfG);
const gInv = (await db.query(
  "select status, base_total::text, base_paid_amount::text from sales_invoices where id=$1", [invG])).rows[0];
check("G-closing: fully-advanced foreign invoice lands basePaidAmount === baseTotal EXACTLY (4,710.000)",
  gInv.status === "paid" && num(gInv.base_total) === 4710000 && num(gInv.base_paid_amount) === num(gInv.base_total), JSON.stringify(gInv));
const gPays = (await db.query(
  "select id from payments where org_id=$1 and proforma_invoice_id=$2 order by id", [org, pfG])).rows;
const gApp3 = await applicationLines(gPays[2].id);
check("G-closing: the closing application's AR credit is the DERIVED 1,570.04 — re-converting would say 1,570.03",
  num(gApp3.find((l) => l.account_id === AR)?.credit) === 1570040, JSON.stringify(gApp3));
const gFx = (await db.query(
  `select coalesce(sum(l.debit),0)::text dr from journal_lines l join journal_entries e on e.id=l.journal_entry_id
    where e.org_id=$1 and e.source_type='advance_application' and e.source_id = any($2) and l.account_id=$3`,
  [org, gPays.map((r) => r.id), FX])).rows[0].dr;
check("G-closing: total realized loss across the three applications = 910.01 (4,710.00 booked − 3,799.99 carried)",
  num(gFx) === 910010, gFx);
check("G-closing: AR = 0 and 2300 released in full", (await arNetFor(invG)) === 0 && (await advNet()) === 0);
await balanced("after the three-partial full-advance conversion");

// ================= E. excess advance: the §10 cap in document currency =================
// Two advances (8,000 then 2,000) against a proforma whose total is then corrected DOWN to 8,000
// (the UI itself caps payments at the balance, so excess only ever arrives via edited data).
// Conversion applies whole payments in order up to the total: the 8,000 applies (and closes the
// invoice — AR 0), the 2,000 does not fit, keeps salesInvoiceId null, and REMAINS in 2300 as the
// customer's available advance.
const pfE = await mkProforma({ currency: null, total: "10000.00" });
await recordPayment(`${BASE}/sales/proforma/${pfE}`, 8000);
await recordPayment(`${BASE}/sales/proforma/${pfE}`, 2000);
await db.query("update proforma_invoices set total='8000.00', subtotal='8000.00' where id=$1", [pfE]);
await balanced("before the excess-advance conversion");
const invE = await convertViaUi(pfE);
const eInv = (await db.query("select status, paid_amount::text, base_paid_amount::text, total::text from sales_invoices where id=$1", [invE])).rows[0];
check("CASE E: invoice closes at its own total — paid 8,000 of 8,000, never over-applied",
  eInv.status === "paid" && num(eInv.paid_amount) === 8000000 && num(eInv.base_paid_amount) === 8000000, JSON.stringify(eInv));
check("CASE E: AR = 0 — the cap stops exactly at the invoice total", (await arNetFor(invE)) === 0);
const ePays = (await db.query(
  "select id, amount::text, sales_invoice_id, kind from payments where org_id=$1 and proforma_invoice_id=$2 order by id", [org, pfE])).rows;
check("CASE E: the 2,000 excess payment was NEVER applied — salesInvoiceId null, still an advance receipt",
  ePays.length === 2 && num(ePays[1].amount) === 2000000 && ePays[1].sales_invoice_id === null && ePays[1].kind === "advance_receipt",
  JSON.stringify(ePays));
check("CASE E: no application entry exists for the excess payment", (await applicationLines(ePays[1].id)).length === 0);
check("CASE E: 2,000 remains in 2300 as the customer's available advance", (await advNet()) === 2000000);
await balanced("after the excess-advance conversion");

// ================= applied advances refuse deletion =================
// The excess (unapplied) payment is filtered out of the invoice's history by salesInvoiceId, so
// the applied 8,000 is the only row here.
await page.goto(`${BASE}/sales/invoices/${invE}`, { waitUntil: "networkidle" });
await page.getByLabel("Delete").first().click();
await page.waitForTimeout(400);
await dialogs().last().getByRole("button", { name: /^Delete Payment$/ }).click();
await page.waitForTimeout(1200);
check("deleting an APPLIED advance is refused — the dialog explains why",
  (await dialogs().last().getByText(/applied to a sales invoice/).count()) >= 1);
check("…and nothing was deleted: payment, receipt entry and application entry all stand",
  (await db.query("select count(*)::int n from payments where id=$1", [ePays[0].id])).rows[0].n === 1
    && (await db.query("select count(*)::int n from journal_entries where org_id=$1 and source_type='payment' and source_id=$2", [org, ePays[0].id])).rows[0].n === 1
    && (await applicationLines(ePays[0].id)).length === 2);
await dialogs().last().getByRole("button", { name: /^Cancel$/ }).click();
await page.waitForTimeout(300);

// ================= H. AR reconciliation: GL 1100 = invoice subledger, with a divergence control =================
const gl1100 = async () => Number((await db.query(
  `select coalesce(sum(l.debit),0) - coalesce(sum(l.credit),0) as net
     from journal_lines l join journal_entries e on e.id = l.journal_entry_id
    where e.org_id=$1 and l.account_id=$2`, [org, AR])).rows[0].net);
const subledger = async () => Number((await db.query(
  `select coalesce(sum(base_total::numeric - base_paid_amount::numeric),0) as s
     from sales_invoices where org_id=$1 and status in ('sent','partially_paid','paid')`, [org])).rows[0].s);
const glH = await gl1100(), slH = await subledger();
check(`INVARIANT H: GL 1100 (${glH}) = AR subledger Σ(baseTotal − basePaidAmount) (${slH}) — advances never diverge them`,
  Math.round(glH * 1000) === Math.round(slH * 1000) && Math.round(glH * 1000) === 12500000, `${glH} vs ${slH}`);
// Divergence CONTROL: a rogue 1100 credit must break the equality — proving the invariant check
// can fail — and equality must return once it is removed.
const rogue = (await db.query(
  `insert into journal_entries (org_id, entry_date, memo, source_type, source_id, created_by_id)
   values ($1, current_date, 'rogue divergence control', 'verify_rogue', 0, $2) returning id`, [org, u.id])).rows[0].id;
await db.query("insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1,$2,'0','123.456')", [rogue, AR]);
check("H control: a seeded rogue AR credit makes the two sides DIVERGE (the check is falsifiable)",
  Math.round((await gl1100()) * 1000) !== Math.round((await subledger()) * 1000));
await db.query("delete from journal_lines where journal_entry_id=$1", [rogue]);
await db.query("delete from journal_entries where id=$1", [rogue]);
check("H control: equality restored once the rogue line is removed",
  Math.round((await gl1100()) * 1000) === Math.round((await subledger()) * 1000));

await db.end();
await browser.close();
let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "ADVANCES PASS" : "ADVANCES FAIL");
process.exit(ok ? 0 : 1);
