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
 * Commit 5 scope (case F — refunds: accounting layer + the payment-history Refund button):
 *  - **F. refund posts Dr 2300 / Cr Bank at the advance's CARRIED value** — never AR, never
 *    revenue, no FX line (the liability leaves at exactly what it was booked at). Happy paths
 *    through the real Refund button + confirmation; server-side refusals via Next-Action replay
 *    with the genuine owner cookie (the UI guard is button absence, which proves nothing).
 *  - Double refund and refunding an APPLIED advance are refused; the §10 excess refunds cleanly
 *    (2300 to zero); a fully-refunded proforma converts to a plain draft; deleting a refunded
 *    receipt is refused while deleting the refund itself restores the advance.
 *
 * Commit 6 scope (§12/§16/§17/§18 — the figures reach the screens):
 *  - **§17** proforma totals read in advance terms (Advance Received / Advance Available);
 *  - **§18** a converted invoice breaks out Customer Advance Applied with Paid reduced to the
 *    direct payments — the same transferred advance never counted twice;
 *  - **§12** the statement page types advance rows distinctly and shows the Advance available
 *    tile (the deep statement arithmetic lives in verify-statements.mts §8);
 *  - **§16** this suite's org IS Saudi Arabia (pickCountry default), so every "two lines only —
 *    no VAT" assertion above doubles as the behavioural proof that advance VAT stays OFF for
 *    Saudi orgs; the static capability check lives in verify-registration-currency.mts.
 *
 * Mutation-proofed (per the review instruction): reverting the credit to 1100 must FAIL here
 * naming the wrong account — the suite asserts the new rule, it does not merely tolerate it.
 * Commit 3's mutation: suppressing the conversion-path posting must FAIL case D naming the
 * missing revenue. Commit 4's mutations: suppressing the application journals must FAIL C/D/E/H;
 * re-converting the closing application instead of deriving it must FAIL G naming both figures.
 */
import { readFile } from "fs/promises";
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
// Application journals are keyed by the ALLOCATION row now, not by the payment — one advance can
// settle several invoices, so the payment id stopped being unique per application. Resolving
// through advance_applications is what makes these assertions still mean "this advance's
// application lines".
const applicationLines = async (paymentId) => (await db.query(
  `select l.account_id, l.debit::text, l.credit::text from journal_lines l
     join journal_entries e on e.id = l.journal_entry_id
     join advance_applications a on a.id = e.source_id and a.org_id = e.org_id
    where e.org_id=$1 and e.source_type='advance_application' and a.advance_payment_id=$2
    order by a.id, l.id`, [org, paymentId])).rows;
const allocationsOf = async (paymentId) => (await db.query(
  `select id, sales_invoice_id, applied_amount::text, carried_base::text, ar_cleared::text, released_at
     from advance_applications where org_id=$1 and advance_payment_id=$2 order by id`, [org, paymentId])).rows;
const availableOf = async (paymentId) => {
  const pay = (await db.query("select amount::text, base_applied_amount::text from payments where id=$1", [paymentId])).rows[0];
  // Applied MINUS live releases: a credit note can hand part of an allocation back, so the gross
  // applied figure would understate what is available.
  const alloc = (await db.query(
    `select coalesce(sum(a.applied_amount - coalesce((select sum(r.released_amount) from advance_application_releases r
                        where r.allocation_id = a.id and r.reversed_at is null), 0)),0)::text a,
            coalesce(sum(a.carried_base - coalesce((select sum(r.released_carried) from advance_application_releases r
                        where r.allocation_id = a.id and r.reversed_at is null), 0)),0)::text c
       from advance_applications a where a.org_id=$1 and a.advance_payment_id=$2 and a.released_at is null`, [org, paymentId])).rows[0];
  const ref = (await db.query(
    `select coalesce(sum(amount),0)::text a, coalesce(sum(base_applied_amount),0)::text c
       from payments where org_id=$1 and refunds_payment_id=$2`, [org, paymentId])).rows[0];
  return {
    doc: num(pay.amount) - num(alloc.a) - num(ref.a),
    carried: num(pay.base_applied_amount) - num(alloc.c) - num(ref.c),
  };
};
// Every AR movement belonging to ONE invoice: its own posting, the applications that settled it
// (keyed by allocation now), and any ordinary payments against it.
const arNetFor = async (invId) => Number((await db.query(
  `select coalesce(sum(l.debit),0) - coalesce(sum(l.credit),0) as net
     from journal_lines l join journal_entries e on e.id = l.journal_entry_id
    where e.org_id=$1 and l.account_id=$2
      and ((e.source_type='sales_invoice' and e.source_id=$3)
        or (e.source_type='advance_application'
            and e.source_id in (select id from advance_applications where org_id=$1 and sales_invoice_id=$3))
        or (e.source_type='payment' and e.source_id in (select id from payments where org_id=$1 and sales_invoice_id=$3)))`,
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
    where e.org_id=$1 and e.source_type='advance_application' and l.account_id=$3
      and e.source_id in (select id from advance_applications where org_id=$1 and advance_payment_id = any($2))`,
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
// Stated in ALLOCATION terms, not by the old marker: `salesInvoiceId is null` will be true of every
// advance receipt once the clearing migration runs, so it would keep passing while meaning nothing.
check("CASE E: the 2,000 excess payment was NEVER applied — no allocation row for it, still an advance receipt",
  ePays.length === 2 && num(ePays[1].amount) === 2000000 && ePays[1].kind === "advance_receipt"
    && (await db.query("select count(*)::int n from advance_applications where org_id=$1 and advance_payment_id=$2", [org, ePays[1].id])).rows[0].n === 0,
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

// ================= F. refund of an unused advance: Dr 2300 / Cr Bank, never AR, never revenue =================
// Happy paths run through the REAL UI (the payment-history Refund button + "Refund Advance"
// confirmation); the server-side refusals are exercised through Next-Action replay with the
// genuine owner cookie — the same protocol the staff-replay suite uses — because the UI's guard
// is button absence, and absence proves nothing about the server.
// The Refund button now opens a DIALOG (amount, and a payout figure for a foreign advance) before
// the confirmation. Passing no amount accepts the pre-fill, which is the whole available balance.
const refundViaUi = async (pfId, opts = {}) => {
  await page.goto(`${BASE}/sales/proforma/${pfId}`, { waitUntil: "networkidle" });
  await page.getByLabel("Refund").first().click();
  await page.waitForTimeout(400);
  if (opts.amount !== undefined) await page.locator("#refund-amount").fill(String(opts.amount));
  if (opts.paidOut !== undefined) await page.locator("#refund-base").fill(String(opts.paidOut));
  await page.waitForTimeout(200);
  await dialogs().last().getByRole("button", { name: /^Refund Advance$/ }).click();
  await page.waitForTimeout(400);
  await dialogs().last().getByRole("button", { name: /^Refund Advance$/ }).click();
  await page.waitForTimeout(1500);
};
const manifest = JSON.parse(await readFile(".next/server/server-reference-manifest.json", "utf8"));
const idFor = (name) => {
  for (const [id, entry] of Object.entries(manifest.node)) {
    for (const w of Object.values(entry.workers ?? {})) {
      if (w.exportedName === name) return id;
    }
  }
  return null;
};
const refundActionId = idFor("refundAdvanceAction");
check("found the Next-Action id for refundAdvanceAction", !!refundActionId, String(refundActionId));
const cookieHeader = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
const refund = async (args) => {
  const res = await fetch(`${BASE}/finance/payments`, {
    method: "POST",
    headers: { "Next-Action": refundActionId, "Content-Type": "text/plain;charset=UTF-8", Cookie: cookieHeader },
    body: JSON.stringify(args),
    redirect: "manual",
  });
  return { status: res.status, body: (await res.text()).replaceAll("<!-- -->", "") };
};
const refundRowFor = async (receiptId) => (await db.query(
  `select id, kind, direction, amount::text, currency, base_amount::text, refunds_payment_id
     from payments where org_id=$1 and refunds_payment_id=$2`, [org, receiptId])).rows;
const paymentEntryLines = async (paymentId) => (await db.query(
  `select l.account_id, l.debit::text, l.credit::text from journal_lines l
     join journal_entries e on e.id = l.journal_entry_id
    where e.org_id=$1 and e.source_type='payment' and e.source_id=$2 order by l.id`, [org, paymentId])).rows;
const revCrTotal = async () => num((await accountLines(REV)).cr);

const pfF = await mkProforma({ currency: null, total: "3000.00" });
await recordPayment(`${BASE}/sales/proforma/${pfF}`, 3000);
const fReceipt = (await db.query("select id from payments where org_id=$1 and proforma_invoice_id=$2", [org, pfF])).rows[0].id;
check("F fixture: 2300 now carries the excess 2,000 + the new 3,000 advance", (await advNet()) === 5000000);
const revBeforeF = await revCrTotal();
await balanced("before the refund");
await refundViaUi(pfF);
const fRefunds = await refundRowFor(fReceipt);
check("CASE F: the refund row exists — kind='advance_refund', direction out, linked by refundsPaymentId",
  fRefunds.length === 1 && fRefunds[0]?.kind === "advance_refund" && fRefunds[0]?.direction === "out"
    && num(fRefunds[0]?.amount) === 3000000, JSON.stringify(fRefunds));
const fLines = fRefunds.length ? await paymentEntryLines(fRefunds[0].id) : [];
check("CASE F: Dr 2300 Customer Advances 3,000 / Cr Bank 3,000 — two lines, nothing else",
  fLines.length === 2 && num(fLines.find((l) => l.account_id === ADV)?.debit) === 3000000
    && num(fLines.find((l) => l.account_id === bank.gl_account_id)?.credit) === 3000000, JSON.stringify(fLines));
check("CASE F: the refund touches NEITHER AR nor revenue",
  fLines.every((l) => l.account_id !== AR && l.account_id !== REV) && (await revCrTotal()) === revBeforeF);
check("CASE F: the liability is released (2300 back to the 2,000 excess only)", (await advNet()) === 2000000);
const pfFAfter = (await db.query("select paid_amount, base_paid_amount from proforma_invoices where id=$1", [pfF])).rows[0];
check("CASE F: the proforma's paid figures release the refunded advance (0 / 0)",
  num(pfFAfter.paid_amount) === 0 && num(pfFAfter.base_paid_amount) === 0, JSON.stringify(pfFAfter));
await balanced("after the refund");

// double refund is structurally impossible; applied advances refuse refund. UI-side the guard is
// button absence, so the SERVER guard is what replay attacks here.
check("the refunded receipt no longer offers a Refund button",
  (await page.goto(`${BASE}/sales/proforma/${pfF}`, { waitUntil: "networkidle" }), await page.getByLabel("Refund").count()) === 0);
const r2 = await refund([fReceipt, {}]);
check("a second refund of the same receipt is refused server-side, naming the reason",
  /already been refunded/.test(r2.body) && (await refundRowFor(fReceipt)).length === 1, r2.body.slice(0, 200));
const r3 = await refund([dPayId, {}]);
check("refunding an APPLIED advance is refused server-side — settled history stays settled",
  /has been applied/.test(r3.body) && (await refundRowFor(dPayId)).length === 0, r3.body.slice(0, 200));

// the §10 excess from case E is exactly what refunds are FOR — refundable through the UI even
// though the proforma is CONVERTED (read-only history, no delete): the excess is live liability.
await balanced("before refunding the excess advance");
await refundViaUi(pfE);
const eRefund = await refundRowFor(ePays[1].id);
const eRefLines = eRefund.length ? await paymentEntryLines(eRefund[0].id) : [];
check("the case-E excess refunds cleanly: Dr 2300 2,000 / Cr Bank 2,000",
  eRefLines.length === 2 && num(eRefLines.find((l) => l.account_id === ADV)?.debit) === 2000000
    && num(eRefLines.find((l) => l.account_id === bank.gl_account_id)?.credit) === 2000000, JSON.stringify(eRefLines));
check("…and 2300 nets to ZERO — every advance is now applied or refunded", (await advNet()) === 0);
await balanced("after refunding the excess advance");

// ---- PARTIAL refunds of a base-currency advance ----
// §10: what can be refunded is what is AVAILABLE, so an advance can go back in pieces, and an
// advance partly applied to an invoice can still refund its remainder.
const pfP = await mkProforma({ currency: null, total: "5000.00" });
await recordPayment(`${BASE}/sales/proforma/${pfP}`, 5000);
const pReceipt = (await db.query("select id from payments where org_id=$1 and proforma_invoice_id=$2", [org, pfP])).rows[0].id;
const advBeforeP = await advNet();
await balanced("before the partial refunds");
await refundViaUi(pfP, { amount: 1500 });
check("PARTIAL REFUND: 1,500 of a 5,000 advance goes back — the rest stays available",
  (await availableOf(pReceipt)).doc === 3500000 && (await advNet()) === advBeforeP - 1500000,
  JSON.stringify({ available: (await availableOf(pReceipt)).doc, adv: await advNet() }));
const pRefunds1 = await refundRowFor(pReceipt);
check("…as its own refund row for 1,500, leaving the receipt untouched at 5,000",
  pRefunds1.length === 1 && num(pRefunds1[0].amount) === 1500000
    && num((await db.query("select amount::text from payments where id=$1", [pReceipt])).rows[0].amount) === 5000000,
  JSON.stringify(pRefunds1));
await balanced("after the first partial refund");
await refundViaUi(pfP, { amount: 2000 });
check("a SECOND partial refund is allowed — the old one-refund-per-receipt rule was the whole-payment model's",
  (await refundRowFor(pReceipt)).length === 2 && (await availableOf(pReceipt)).doc === 1500000);
const rOver = await refund([pReceipt, { amount: "9999" }]);
check("refunding MORE than is available is refused server-side, naming what is left",
  /Only 1500\.00.*available to refund/.test(rOver.body) && (await refundRowFor(pReceipt)).length === 2,
  rOver.body.match(/[^"<]*available to refund[^"<]*/)?.[0] ?? rOver.body.slice(0, 160));
await refundViaUi(pfP);
check("the final refund empties the advance exactly — 2300 back to where it stood, nothing stranded",
  (await availableOf(pReceipt)).doc === 0 && (await availableOf(pReceipt)).carried === 0
    && (await advNet()) === advBeforeP - 5000000, JSON.stringify(await availableOf(pReceipt)));
await balanced("after the advance is fully refunded in three parts");

// ---- a FOREIGN refund is a real cash movement: Dr 2300 at CARRIED, Cr Bank at PAID OUT ----
const pfFx = await mkProforma({ currency: "USD", total: "200.00" });
await recordPayment(`${BASE}/sales/proforma/${pfFx}`, 200); // carried at 4.71 → 942.00
const fxReceipt = (await db.query("select id, base_amount::text from payments where org_id=$1 and proforma_invoice_id=$2", [org, pfFx])).rows[0];
check("foreign refund fixture: USD 200 advance carried at 4.71 = 942.00", num(fxReceipt.base_amount) === 942000, JSON.stringify(fxReceipt));
// Half of it, with the payout figure OVERRIDDEN — the bank statement is ground truth and the
// effective rate follows it, exactly as the received-amount field works for money coming in.
await refundViaUi(pfFx, { amount: 100, paidOut: 500 });
const fxPartial = await refundRowFor(fxReceipt.id);
const fxPartialLines = fxPartial.length ? await paymentEntryLines(fxPartial[0].id) : [];
check("foreign PARTIAL refund: Dr 2300 471.00 at the carried value / Cr Bank 500.00 as actually paid / Dr 4900 29.00 realized loss",
  fxPartialLines.length === 3
    && num(fxPartialLines.find((l) => l.account_id === ADV)?.debit) === 471000
    && num(fxPartialLines.find((l) => l.account_id === bank.gl_account_id)?.credit) === 500000
    && num(fxPartialLines.find((l) => l.account_id === FX)?.debit) === 29000, JSON.stringify(fxPartialLines));
check("…the refund row records the CASH in baseAmount and the LIABILITY in baseAppliedAmount — they differ by the FX",
  num((await db.query("select base_amount::text ba, base_applied_amount::text bap from payments where id=$1", [fxPartial[0].id])).rows[0].ba) === 500000
    && num((await db.query("select base_applied_amount::text bap from payments where id=$1", [fxPartial[0].id])).rows[0].bap) === 471000);
check("…and its rateSource is the PAYOUT's own provenance, not the receipt's copied label",
  (await db.query("select rate_source from payments where id=$1", [fxPartial[0].id])).rows[0].rate_source
    !== (await db.query("select rate_source from payments where id=$1", [fxReceipt.id])).rows[0].rate_source,
  `${(await db.query("select rate_source from payments where id=$1", [fxPartial[0].id])).rows[0].rate_source} vs receipt ${(await db.query("select rate_source from payments where id=$1", [fxReceipt.id])).rows[0].rate_source}`);
await balanced("after the foreign partial refund");
// The rest, at the payout DATE's rate (unchanged here), takes the carried RESIDUAL — 942 − 471.
await refundViaUi(pfFx);
const fxRefund = await refundRowFor(fxReceipt.id);
const fxLines2 = fxRefund.length === 2 ? await paymentEntryLines(fxRefund[1].id) : [];
check("the closing foreign refund takes the carried RESIDUAL 471.00, and 2300 gives up exactly the 942.00 it carried",
  num(fxLines2.find((l) => l.account_id === ADV)?.debit) === 471000
    && (await availableOf(fxReceipt.id)).carried === 0, JSON.stringify(fxLines2));
await balanced("after the foreign refund");

// a fully-refunded proforma converts to a plain DRAFT — refunded value is not transferable
const invF = await convertViaUi(pfF);
const fInv = (await db.query("select status, paid_amount::text from sales_invoices where id=$1", [invF])).rows[0];
check("converting a fully-refunded proforma yields a DRAFT (paid 0) — the refunded pair transfers nothing",
  fInv.status === "draft" && num(fInv.paid_amount) === 0, JSON.stringify(fInv));
check("…neither the receipt nor its refund produced an allocation — refunded value settles nothing",
  (await db.query(
    `select count(*)::int n from advance_applications a
      where a.org_id=$1 and a.advance_payment_id in (select id from payments where org_id=$1 and proforma_invoice_id=$2)`,
    [org, pfF])).rows[0].n === 0);
check("…and no journal posted at conversion", (await invoiceEntry(invF)).length === 0);

// deleting a REFUNDED receipt is refused; deleting a refund restores that much of the advance
await page.goto(`${BASE}/sales/proforma/${pfFx}`, { waitUntil: "networkidle" });
// History orders by date desc, id desc: rows 0 and 1 are the two refunds, row 2 the receipt.
await page.getByLabel("Delete").nth(2).click();
await page.waitForTimeout(400);
await dialogs().last().getByRole("button", { name: /^Delete Payment$/ }).click();
await page.waitForTimeout(1200);
check("deleting a REFUNDED receipt is refused — delete the refund first",
  (await dialogs().last().getByText(/Delete the refund first/).count()) >= 1
    && (await db.query("select count(*)::int n from payments where id=$1", [fxReceipt.id])).rows[0].n === 1);
await dialogs().last().getByRole("button", { name: /^Cancel$/ }).click();
await page.waitForTimeout(400);
await page.getByLabel("Delete").first().click();
await page.waitForTimeout(400);
await dialogs().last().getByRole("button", { name: /^Delete Payment$/ }).click();
await page.waitForTimeout(1200);
const pfFxAfter = (await db.query("select paid_amount, base_paid_amount from proforma_invoices where id=$1", [pfFx])).rows[0];
check("deleting the closing refund restores exactly ITS share: one refund left, 2300 back to 471.00, proforma re-paid 100/471.00",
  (await refundRowFor(fxReceipt.id)).length === 1 && (await advNet()) === 471000
    && num(pfFxAfter.paid_amount) === 100000 && num(pfFxAfter.base_paid_amount) === 471000, JSON.stringify(pfFxAfter));
check("…restored from the LIABILITY it released (471.00), never from the cash it cost (500.00) — the stored-figure rule",
  num(pfFxAfter.base_paid_amount) === 471000 && (await availableOf(fxReceipt.id)).carried === 471000);
await balanced("after deleting the refund");

// ================= the figures reach the screens (§17 proforma, §18 invoice, §12 statement) =================
await page.goto(`${BASE}/sales/proforma/${pfFx}`, { waitUntil: "networkidle" });
const pfxBody = (await page.locator("body").innerText()).replace(/\s+/g, " ");
check("§17: the proforma reads in ADVANCE terms — Advance Received and Advance Available shown (200 each)",
  /Advance Received/.test(pfxBody) && /Advance Available/.test(pfxBody) && /200\.00/.test(pfxBody),
  pfxBody.match(/Advance [\s\S]{0,40}/)?.[0] ?? "no match");
await page.goto(`${BASE}/sales/invoices/${invD}`, { waitUntil: "networkidle" });
const invDBody = (await page.locator("body").innerText()).replace(/\s+/g, " ");
check("§18: the converted invoice breaks out Customer Advance Applied (6,000) — never counted twice",
  /Customer Advance Applied/.test(invDBody) && /6,?000\.00/.test(invDBody),
  invDBody.match(/Customer Advance[\s\S]{0,40}/)?.[0] ?? "no match");
await page.goto(`${BASE}/finance/statements?kind=client&party=${cust}`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
const stmtBody = (await page.locator("body").innerText()).replace(/\s+/g, " ");
check("§12: the statement page types advance rows distinctly and shows the Advance available tile (942.00 held)",
  /Advance Received/.test(stmtBody) && /Advance available/i.test(stmtBody) && /942\.00/.test(stmtBody),
  stmtBody.match(/Advance available[\s\S]{0,30}/i)?.[0] ?? "no match");

// ================= §2/§3 PARTIAL DRAW: an advance larger than the invoice is split =================
// Spec case A. The old whole-payment model could not express this at all: a 10,000 advance against
// an 8,000 invoice did not fit, so NOTHING was applied and the invoice was born a draft with the
// customer's money sitting untouched in 2300. Now 8,000 is drawn and 2,000 stays available.
// (Recorded against a 10,000 proforma, whose total is then corrected down — the payment dialog
// caps a receipt at the proforma balance, so that is the only way this state arises.)
const pfPart = await mkProforma({ currency: null, total: "10000.00" });
await recordPayment(`${BASE}/sales/proforma/${pfPart}`, 10000);
const partPay = (await db.query("select id from payments where org_id=$1 and proforma_invoice_id=$2", [org, pfPart])).rows[0].id;
await db.query("update proforma_invoices set total='8000.00', subtotal='8000.00' where id=$1", [pfPart]);
await balanced("before the partial-draw conversion");
const invPart = await convertViaUi(pfPart);
const partInv = (await db.query("select status, paid_amount::text, base_paid_amount::text from sales_invoices where id=$1", [invPart])).rows[0];
check("CASE A: a 10,000 advance against an 8,000 invoice DRAWS 8,000 — the invoice is paid, not left a draft",
  partInv.status === "paid" && num(partInv.paid_amount) === 8000000 && num(partInv.base_paid_amount) === 8000000, JSON.stringify(partInv));
const partAllocs = await allocationsOf(partPay);
check("CASE A: exactly one allocation row for 8,000 against that invoice",
  partAllocs.length === 1 && num(partAllocs[0].applied_amount) === 8000000 && num(partAllocs[0].carried_base) === 8000000
    && num(partAllocs[0].ar_cleared) === 8000000 && partAllocs[0].sales_invoice_id === invPart, JSON.stringify(partAllocs));
const partAvail = await availableOf(partPay);
check("CASE A: 2,000 REMAINS available on the advance — receipt 10,000 minus the 8,000 drawn",
  partAvail.doc === 2000000 && partAvail.carried === 2000000, JSON.stringify(partAvail));
check("CASE A: the partially drawn receipt keeps salesInvoiceId NULL — it did not wholly settle that invoice",
  // Allocation terms: after the clearing migration every advance receipt has a null field, so the
  // claim "a partial draw does not re-point the receipt" has to be made about what DID happen.
  (await db.query("select count(*)::int n from advance_applications where org_id=$1 and advance_payment_id=$2 and applied_amount <> (select amount from payments where id=$2)", [org, partPay])).rows[0].n === 1);
check("CASE A: AR = 0 and the application posted Dr 2300 8,000 / Cr 1100 8,000",
  (await arNetFor(invPart)) === 0 && (await applicationLines(partPay)).length === 2);
await page.goto(`${BASE}/sales/proforma/${pfPart}`, { waitUntil: "networkidle" });
const partBody = (await page.locator("body").innerText()).replace(/\s+/g, " ");
check("CASE A: the proforma screen shows 2,000 still available, not 0 and not 10,000",
  /Advance Available/.test(partBody) && /2,?000\.00/.test(partBody),
  partBody.match(/Advance Available[\s\S]{0,40}/)?.[0] ?? "no match");
await balanced("after the partial-draw conversion");

// ================= the deterministic LOCK proof =================
// A race test can pass by luck; this cannot. A second connection holds the advance row, and the
// conversion must BLOCK on it rather than reading availability around it.
//
// Two things this proof got wrong before they were fixed, both of which made it pass while the
// lock was REMOVED:
//   1. it used a fully consumed advance — whose salesInvoiceId UPDATE blocks on the held row all
//      by itself, so the block proved nothing about the read. It now uses a PARTIAL draw, where
//      the availability read is the only statement that touches the row;
//   2. it drove the conversion through the UI, which spends ~3s on scripted waits before the
//      action is even issued — a 4s window that any conversion would "fail" to finish. It now
//      REPLAYS the action directly, so the request is in flight immediately and every millisecond
//      of delay is the lock.
const pfLock = await mkProforma({ currency: null, total: "500.00" });
await recordPayment(`${BASE}/sales/proforma/${pfLock}`, 500);
const lockPay = (await db.query("select id from payments where org_id=$1 and proforma_invoice_id=$2", [org, pfLock])).rows[0].id;
await db.query("update proforma_invoices set total='300.00', subtotal='300.00' where id=$1", [pfLock]);

const convertActionId = idFor("convertProformaToInvoiceAction");
check("found the Next-Action id for convertProformaToInvoiceAction", !!convertActionId, String(convertActionId));
const holder = new Client({ connectionString: process.env.DATABASE_URL });
await holder.connect();
await holder.query("begin");
await holder.query("select id from payments where id=$1 for update", [lockPay]);

let convSettled = false;
const convStarted = Date.now();
const convPromise = fetch(`${BASE}/sales/proforma/${pfLock}`, {
  method: "POST",
  headers: { "Next-Action": convertActionId, "Content-Type": "text/plain;charset=UTF-8", Cookie: cookieHeader },
  body: JSON.stringify([pfLock]),
  redirect: "manual",
}).then(async (r) => { await r.text(); convSettled = true; return r.status; });

await new Promise((r) => setTimeout(r, 3000));
const invDuringLock = (await db.query("select converted_invoice_id from proforma_invoices where id=$1", [pfLock])).rows[0].converted_invoice_id;
check("LOCK PROOF: with another transaction holding the advance row, the replayed conversion is STILL IN FLIGHT after 3s",
  convSettled === false && invDuringLock === null, `settled=${convSettled} converted=${invDuringLock}`);
// WHICH statement is waiting matters, and blocking alone does not answer it: inserting an
// advance_applications row takes an FK lock on the referenced payment, so a conversion with NO
// explicit lock ALSO blocks — just later, after it has already read availability, which is exactly
// the read that two concurrent allocators must not both perform. So the waiter's current query is
// what gets asserted: it must be the availability SELECT … FOR UPDATE, not the allocation INSERT.
const waiter = (await db.query(
  `select query, wait_event_type from pg_stat_activity
    where datname = current_database() and state = 'active' and wait_event_type = 'Lock'`)).rows;
check("LOCK PROOF: the statement waiting on the row is the availability read itself (SELECT … FOR UPDATE on payments), not a later insert",
  waiter.some((w) => /for update/i.test(w.query) && /from payments/i.test(w.query)),
  waiter.map((w) => `${w.wait_event_type}: ${String(w.query).replace(/\s+/g, " ").slice(0, 120)}`).join(" | ") || "(nothing waiting on a lock)");
await holder.query("rollback");
await holder.end();
await convPromise;
const heldFor = Date.now() - convStarted;
const invLock = (await db.query("select converted_invoice_id from proforma_invoices where id=$1", [pfLock])).rows[0].converted_invoice_id;
check("LOCK PROOF: releasing the row lets the SAME request finish — it was waiting on the lock, not failing",
  invLock > 0, `invoice=${invLock} after ${heldFor}ms`);
check("LOCK PROOF: and it was a PARTIAL draw — 300 of 500 — so only the locked read could have blocked it",
  (await allocationsOf(lockPay)).length === 1 && num((await allocationsOf(lockPay))[0].applied_amount) === 300000
    && (await db.query("select sales_invoice_id from payments where id=$1", [lockPay])).rows[0].sales_invoice_id === null,
  JSON.stringify(await allocationsOf(lockPay)));
await balanced("after the lock-proof conversion");

// ================= §3/§4 APPLY AN ADVANCE TO A LATER INVOICE (cases B, D, E) =================
// The other half of allocation: an advance that outlived its proforma settling a DIFFERENT invoice.
// Nothing holds by construction here — at conversion the invoice IS the proforma, so same-customer
// and same-currency are free; on this path both must be enforced.
const applyActionId = idFor("applyAdvanceToInvoiceAction");
check("found the Next-Action id for applyAdvanceToInvoiceAction", !!applyActionId, String(applyActionId));
const applyAdvance = async (invoiceId, paymentId, amount) => {
  const res = await fetch(`${BASE}/sales/invoices/${invoiceId}`, {
    method: "POST",
    headers: { "Next-Action": applyActionId, "Content-Type": "text/plain;charset=UTF-8", Cookie: cookieHeader },
    body: JSON.stringify([invoiceId, paymentId, String(amount)]),
    redirect: "manual",
  });
  return { status: res.status, body: (await res.text()).replace(/<!-- -->/g, "").replace(/\s+/g, " ") };
};
// A second, independent invoice for the SAME customer, posted through the normal Send path.
const mkSentInvoice = async (total) => {
  const inv = (await db.query(
    `insert into sales_invoices (org_id, invoice_number, customer_id, issue_date, status, subtotal, discount, tax_total, total, created_by_id)
     values ($1,$2,$3,$4,'draft',$5,'0','0',$5,$6) returning id`,
    [org, `INV-${uniq()}`, cust, today, total, u.id])).rows[0].id;
  await db.query(
    `insert into sales_invoice_items (invoice_id, description, quantity, unit_price, tax_rate_percent, line_total)
     values ($1,'Later work',1,$2,'0',$2)`, [inv, total]);
  await page.goto(`${BASE}/sales/invoices/${inv}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Send Invoice", exact: true }).click();
  await page.waitForTimeout(400);
  await dialogs().last().getByRole("button", { name: "Send Invoice", exact: true }).click();
  await page.waitForTimeout(1500);
  return inv;
};

// CASE B: one advance settles TWO invoices — 8,000 went to the first at conversion, 2,000 remains.
const invB2 = await mkSentInvoice("5000.00");
await balanced("before applying the remainder to a second invoice");
const rB = await applyAdvance(invB2, partPay, 2000);
const b2 = (await db.query("select status, paid_amount::text, base_paid_amount::text from sales_invoices where id=$1", [invB2])).rows[0];
check("CASE B: the SAME advance settles a second invoice — 2,000 applied, invoice partially paid",
  rB.status === 200 && num(b2.paid_amount) === 2000000 && num(b2.base_paid_amount) === 2000000 && b2.status === "partially_paid",
  JSON.stringify({ status: rB.status, ...b2 }));
const bAllocs = await allocationsOf(partPay);
check("CASE B: the advance now carries TWO allocations, 8,000 + 2,000, against two different invoices",
  bAllocs.length === 2 && num(bAllocs[0].applied_amount) === 8000000 && num(bAllocs[1].applied_amount) === 2000000
    && bAllocs[0].sales_invoice_id !== bAllocs[1].sales_invoice_id, JSON.stringify(bAllocs));
check("CASE B: each allocation has its OWN journal — keyed by allocation, so the second is not suppressed",
  (await db.query(
    `select count(*)::int n from journal_entries where org_id=$1 and source_type='advance_application'
      and source_id in (select id from advance_applications where org_id=$1 and advance_payment_id=$2)`,
    [org, partPay])).rows[0].n === 2);
check("CASE B: the advance is now fully consumed — nothing available", (await availableOf(partPay)).doc === 0);
await balanced("after applying the remainder to a second invoice");

// CASE E: a DIFFERENT customer's invoice is refused, with no mutation at all
const otherCust = (await db.query("insert into customers (org_id,name) values ($1,'Other Client') returning id", [org])).rows[0].id;
const invOther = (await db.query(
  `insert into sales_invoices (org_id, invoice_number, customer_id, issue_date, status, subtotal, discount, tax_total, total, base_total, exchange_rate, created_by_id)
   values ($1,$2,$3,$4,'sent','5000.00','0','0','5000.00','5000.00','1',$5) returning id`,
  [org, `INV-${uniq()}`, otherCust, today, u.id])).rows[0].id;
const pfSpare = await mkProforma({ currency: null, total: "3000.00" });
await recordPayment(`${BASE}/sales/proforma/${pfSpare}`, 3000);
const sparePay = (await db.query("select id from payments where org_id=$1 and proforma_invoice_id=$2", [org, pfSpare])).rows[0].id;
const entriesBeforeE = (await db.query("select count(*)::int n from journal_entries where org_id=$1", [org])).rows[0].n;
const rE = await applyAdvance(invOther, sparePay, 1000);
check("CASE E: applying one client's advance to ANOTHER client's invoice is REFUSED, naming the reason",
  /belongs to a different client/.test(rE.body), rE.body.match(/[^"<]*different client[^"<]*/)?.[0] ?? "(message not found)");
check("CASE E: and nothing moved — no allocation, no journal, the invoice untouched",
  (await allocationsOf(sparePay)).length === 0
    && (await db.query("select count(*)::int n from journal_entries where org_id=$1", [org])).rows[0].n === entriesBeforeE
    && num((await db.query("select paid_amount from sales_invoices where id=$1", [invOther])).rows[0].paid_amount) === 0);

// CASE D (same customer) is the happy path proven by CASE B above; here is its refusal twin for
// currency, which the UI must EXPLAIN rather than hide.
await db.query(
  `insert into exchange_rates (org_id, from_currency, to_currency, rate, effective_date, source)
   values ($1,'USD','SAR','3.90',current_date,'manual') on conflict do nothing`, [org]);
const pfUsdSpare = await mkProforma({ currency: "USD", total: "400.00" });
await recordPayment(`${BASE}/sales/proforma/${pfUsdSpare}`, 400);
const usdSparePay = (await db.query("select id from payments where org_id=$1 and proforma_invoice_id=$2", [org, pfUsdSpare])).rows[0].id;
const invSar = await mkSentInvoice("900.00");
const rCur = await applyAdvance(invSar, usdSparePay, 100);
check("cross-currency application is REFUSED server-side, naming BOTH currencies",
  /USD/.test(rCur.body) && /SAR/.test(rCur.body) && /same currency/.test(rCur.body),
  rCur.body.match(/[^"<]*same currency[^"<]*/)?.[0] ?? "(message not found)");
await page.goto(`${BASE}/sales/invoices/${invSar}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /^Apply Advance$/ }).first().click();
await page.waitForTimeout(500);
const blockedNote = await page.getByTestId("apply-advance-blocked").innerText().catch(() => "");
check("…and the DIALOG EXPLAINS it — the USD advance is listed with its reason, not silently hidden",
  /USD/.test(blockedNote) && /same currency/.test(blockedNote), blockedNote.replace(/\s+/g, " ").slice(0, 160) || "(no blocked note rendered)");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// ================= the NECESSITY proof the conversion path could not make =================
// Commit 3 showed the availability read TAKES the lock; it could not show the lock was NEEDED,
// because conversions serialise on their proforma row anyway. Here two DIFFERENT invoices draw on
// ONE advance at the same time, which is only safe because availability is computed under the lock.
const pfRace = await mkProforma({ currency: null, total: "1000.00" });
await recordPayment(`${BASE}/sales/proforma/${pfRace}`, 1000);
const racePay = (await db.query("select id from payments where org_id=$1 and proforma_invoice_id=$2", [org, pfRace])).rows[0].id;
const raceInvA = await mkSentInvoice("1000.00");
const raceInvB = await mkSentInvoice("1000.00");
await balanced("before the concurrent draws");
const [raceA, raceB] = await Promise.all([
  applyAdvance(raceInvA, racePay, 1000),
  applyAdvance(raceInvB, racePay, 1000),
]);
const raceAllocs = await allocationsOf(racePay);
const raceAvail = await availableOf(racePay);
check("CONCURRENCY: two invoices drawing the SAME 1,000 advance at once produce exactly ONE allocation",
  raceAllocs.length === 1 && num(raceAllocs[0].applied_amount) === 1000000, JSON.stringify(raceAllocs));
check("CONCURRENCY: the loser is REFUSED with the real reason — availability, not a generic error",
  /no available balance left|Only .* of this advance is still available/.test(raceA.body + raceB.body),
  (raceA.body + raceB.body).match(/[^"<]*available[^"<]*/)?.[0] ?? "(no availability message)");
check("CONCURRENCY: the advance is not oversubscribed — 0 available, never negative",
  raceAvail.doc === 0 && raceAvail.carried === 0, JSON.stringify(raceAvail));
check("CONCURRENCY: exactly one of the two invoices was settled",
  [(await db.query("select paid_amount::text p from sales_invoices where id=$1", [raceInvA])).rows[0].p,
   (await db.query("select paid_amount::text p from sales_invoices where id=$1", [raceInvB])).rows[0].p]
    .filter((v) => num(v) === 1000000).length === 1);
await balanced("after the concurrent draws");

// ============ credit notes against an advance-settled invoice (the negative-AR door) ============
// The arithmetic lives in verify-credit-note-release; what only THIS tier can prove is that the
// real action — session, cap, decision, release, paid figures — is wired together, driven through
// the actual Issue Credit Note button rather than a library call.
// `advNet()` (defined with the other account readers) returns 2300's net credit in mils.
const invCN = await mkSentInvoice("4000.00");
const pfCN = await mkProforma({ currency: null, total: "4000.00" });
await recordPayment(`${BASE}/sales/proforma/${pfCN}`, 4000);
const payCN = (await db.query("select id from payments where org_id=$1 and proforma_invoice_id=$2", [org, pfCN])).rows[0].id;
await applyAdvance(invCN, payCN, 4000);
const cnInvBefore = (await db.query("select status, paid_amount::text from sales_invoices where id=$1", [invCN])).rows[0];
check("CN fixture: a 4,000 advance settles a 4,000 invoice in full — AR on it is zero",
  cnInvBefore.status === "paid" && num(cnInvBefore.paid_amount) === 4000000, JSON.stringify(cnInvBefore));
const arBeforeCN = await accountLines(AR);
const advBeforeCN = await advNet();
await balanced("before the credit note");

/** Fill and submit the credit-note builder for an invoice — the real form, the real button. */
async function issueCreditNote(invoiceId, unitPrice) {
  await page.goto(`${BASE}/sales/credit-notes/new?invoice=${invoiceId}`, { waitUntil: "networkidle" });
  const row = page.locator(".doc-items-table tr.item-row").first();
  await row.locator("input, textarea").first().fill("Partial credit");
  const nums = row.locator('input[type="number"]');
  await nums.nth(0).fill("1");
  await nums.nth(1).fill(String(unitPrice));
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "Issue Credit Note", exact: true }).first().click();
  await page.waitForTimeout(2500);
}

await issueCreditNote(invCN, 1000);
const cn1 = (await db.query(
  "select id, status, total::text, base_total::text from credit_notes where org_id=$1 and source_invoice_id=$2 order by id desc limit 1", [org, invCN])).rows[0];
check("the credit note issued through the real builder", cn1?.status === "issued", JSON.stringify(cn1));
const rel1 = (await db.query(
  `select r.id, r.released_amount::text, r.released_ar_cleared::text, r.cause_type, r.cause_id, a.applied_amount::text applied, a.released_at
     from advance_application_releases r join advance_applications a on a.id = r.allocation_id
    where r.org_id=$1 and r.cause_type='credit_note' and r.cause_id=$2`, [org, cn1.id])).rows;
check("it released exactly its own total from the allocation — a PARTIAL release, the allocation still live",
  rel1.length === 1 && num(rel1[0].released_amount) === num(cn1.total) && num(rel1[0].applied) === 4000000 && rel1[0].released_at === null,
  JSON.stringify(rel1));
const arAfterCN = await accountLines(AR);
check("THE DEFECT IS CLOSED: AR is unmoved — the note's credit and the release's debit answer each other",
  num(arAfterCN.dr) - num(arAfterCN.cr) === num(arBeforeCN.dr) - num(arBeforeCN.cr),
  `${num(arAfterCN.dr) - num(arAfterCN.cr)} vs ${num(arBeforeCN.dr) - num(arBeforeCN.cr)}`);
check("2300 rose by exactly the note's value — the client holds that credit as an available advance",
  (await advNet()) - advBeforeCN === num(cn1.total), `${await advNet()} vs ${advBeforeCN}`);
const cnInvAfter = (await db.query("select paid_amount::text, base_paid_amount::text from sales_invoices where id=$1", [invCN])).rows[0];
check("the invoice's paid figures did NOT grow past its total — the release nets against the note",
  num(cnInvAfter.paid_amount) === 4000000 && num(cnInvAfter.base_paid_amount) === 4000000, JSON.stringify(cnInvAfter));
check("the advance is available again, by the note's value", (await availableOf(payCN)).doc === num(cn1.total));
await balanced("after the credit note released part of the allocation");

// ---- the cap: credit notes may not exceed the invoice they credit ----
const advBeforeCap = await advNet();
await issueCreditNote(invCN, 4000);
const capToast = (await page.locator("body").innerText()).replace(/\s+/g, " ");
const cnAll = (await db.query(
  "select id, status, total::text from credit_notes where org_id=$1 and source_invoice_id=$2 order by id", [org, invCN])).rows;
check("CAP: a note that would push the credited total past the invoice value is REFUSED server-side",
  cnAll.filter((c) => c.status === "issued").length === 1, JSON.stringify(cnAll));
check("…and the refusal reaches the user with the headroom named, rather than a silent draft",
  /already total|cannot exceed/i.test(capToast) && /draft/i.test(capToast), capToast.slice(0, 220));
check("…the refused note posted NOTHING — 2300 unmoved, no release row for it",
  (await advNet()) === advBeforeCap
    && (await db.query("select count(*)::int n from advance_application_releases where org_id=$1 and cause_id=$2",
      [org, cnAll[cnAll.length - 1].id])).rows[0].n === 0);
await balanced("after the refused credit note");

// ---- reversing the note re-applies what it released ----
await page.goto(`${BASE}/sales/credit-notes/${cn1.id}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Reverse Credit Note/ }).click();
await page.waitForTimeout(400);
await dialogs().last().getByRole("button", { name: /^Reverse$/ }).click();
await page.waitForTimeout(2000);
const cn1After = (await db.query("select status from credit_notes where id=$1", [cn1.id])).rows[0];
check("reversing the note re-applies the release — the advance is not left available AND settling the invoice",
  cn1After.status === "reversed" && (await availableOf(payCN)).doc === 0, JSON.stringify(cn1After));
check("2300 is back where it stood before the note", (await advNet()) === advBeforeCN, `${await advNet()} vs ${advBeforeCN}`);
check("AR is unmoved across the whole issue → reverse round trip",
  num((await accountLines(AR)).dr) - num((await accountLines(AR)).cr) === num(arBeforeCN.dr) - num(arBeforeCN.cr));
const cnInvReversed = (await db.query("select paid_amount::text from sales_invoices where id=$1", [invCN])).rows[0];
check("the invoice is settled again at exactly its total", num(cnInvReversed.paid_amount) === 4000000, JSON.stringify(cnInvReversed));
await balanced("after reversing the credit note");

// ================= L. GL 2300 = the carried value of every remaining available advance ==========
const gl2300 = async () => Number((await db.query(
  `select coalesce(sum(l.credit),0) - coalesce(sum(l.debit),0) as net
     from journal_lines l join journal_entries e on e.id = l.journal_entry_id
    where e.org_id=$1 and l.account_id=$2`, [org, ADV])).rows[0].net);
const availableCarriedTotal = async () => {
  const receipts = (await db.query(
    "select id from payments where org_id=$1 and kind='advance_receipt'", [org])).rows;
  let total = 0;
  for (const r of receipts) total += (await availableOf(r.id)).carried;
  return total / 1000;
};
const glAdv = await gl2300(), availAdv = await availableCarriedTotal();
check(`INVARIANT L: GL 2300 (${glAdv}) = carried value of all remaining available advances (${availAdv})`,
  Math.round(glAdv * 1000) === Math.round(availAdv * 1000), `${glAdv} vs ${availAdv}`);

// ============ the lifecycle around an invoice carrying allocations (§13, P, orphan check) ============
// Void is wired to release allocations, and that wiring is currently UNREACHABLE — deliberately.
// These assertions are what makes that a tested constraint rather than a claim in a comment: if
// the lifecycle ever admits voiding a settled invoice, they fail and point at the release path.
const voidActionId = idFor("voidInvoiceAction");
const updateInvoiceActionId = idFor("updateInvoiceAction");
const permDeleteId = idFor("permanentlyDeleteDocumentAction") ?? idFor("permanentDeleteDocumentAction");
check("found the Next-Action ids for the lifecycle actions", !!voidActionId && !!updateInvoiceActionId,
  `void=${voidActionId} update=${updateInvoiceActionId} permDelete=${permDeleteId}`);
const invoke = async (actionId, args, path) => {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Next-Action": actionId, "Content-Type": "text/plain;charset=UTF-8", Cookie: cookieHeader },
    body: JSON.stringify(args),
    redirect: "manual",
  });
  return { status: res.status, body: (await res.text()).replace(/<!-- -->/g, "").replace(/\s+/g, " ") };
};

// invD is the fully-advanced invoice from CASE D — status paid, carrying an allocation.
const rVoid = await invoke(voidActionId, [invD], `/sales/invoices/${invD}`);
const dAfterVoid = (await db.query("select status from sales_invoices where id=$1", [invD])).rows[0];
check("VOID of an invoice carrying allocations is REFUSED by the lifecycle — a Credit Note is the correction path",
  /settled invoice cannot be voided|Credit Note/i.test(rVoid.body) && dAfterVoid.status === "paid",
  `${dAfterVoid.status} — ${rVoid.body.match(/[^"<]*cannot be voided[^"<]*/)?.[0] ?? "(message not found)"}`);
// Scoped to THIS invoice's allocations. The clause used to count release entries across the whole
// org, which was zero only while nothing could release at all; the credit-note section above now
// releases legitimately in the same org, so an org-wide count would fail for a reason that has
// nothing to do with void — the catalogued "asserts on a total wider than its own fixture" trap.
check("…so its allocations are untouched — the release wiring in void is unreachable, not silently firing",
  (await allocationsOf(dPayId)).every((a) => a.released_at === null)
    && (await db.query(
      `select count(*)::int n from advance_application_releases r
         join advance_applications a on a.id = r.allocation_id
        where a.org_id=$1 and a.sales_invoice_id=$2`, [org, invD])).rows[0].n === 0);

// §13 / case P: a POSTED invoice is immutable, enforced by the SERVER not just the edit page.
const rEdit = await invoke(updateInvoiceActionId, [invD, {
  title: "Rewritten", customerId: String(cust), issueDate: today, discount: "0", notes: "",
  items: [{ productId: "", description: "Rewritten line", quantity: "1", unitPrice: "999999", taxRatePercent: "0" }],
}], `/sales/invoices/${invD}`);
const dAfterEdit = (await db.query("select total::text, title from sales_invoices where id=$1", [invD])).rows[0];
check("§13/P: editing a POSTED invoice is refused by the server, with the totals untouched",
  /Only draft invoices can be edited/.test(rEdit.body) && num(dAfterEdit.total) === 6000000,
  `${dAfterEdit.title ?? "(no title)"} / ${dAfterEdit.total} — ${rEdit.body.match(/[^"<]*can be edited[^"<]*/)?.[0] ?? "(message not found)"}`);

// Orphan check: allocations reference sales_invoices, so a hard delete would orphan them. The
// lifecycle already prevents it — permanent delete is a draft-only, Recycle-Bin-only action — so
// this asserts the existing rule rather than adding a guard.
check("ORPHAN CHECK: the lifecycle allows permanent_delete ONLY for a draft, so a posted invoice carrying allocations can never be hard-deleted",
  (await db.query(
    `select count(*)::int n from advance_applications a
       join sales_invoices i on i.id = a.sales_invoice_id
      where a.org_id=$1 and i.status='draft'`, [org])).rows[0].n === 0);

// ================= H. AR reconciliation: GL 1100 = invoice subledger, with a divergence control =================
const gl1100 = async () => Number((await db.query(
  `select coalesce(sum(l.debit),0) - coalesce(sum(l.credit),0) as net
     from journal_lines l join journal_entries e on e.id = l.journal_entry_id
    where e.org_id=$1 and l.account_id=$2`, [org, AR])).rows[0].net);
const subledger = async () => Number((await db.query(
  `select coalesce(sum(base_total::numeric - base_paid_amount::numeric),0) as s
     from sales_invoices where org_id=$1 and status in ('sent','partially_paid','paid')`, [org])).rows[0].s);
const glH = await gl1100(), slH = await subledger();
// The claim is the EQUALITY, not any particular total: pinning an absolute figure here made the
// check fail the moment later cases added invoices, while the invariant itself was intact. The
// non-zero guard keeps it from passing trivially on an empty ledger, and the seeded-divergence
// control below proves it can still fail.
check(`INVARIANT H: GL 1100 (${glH}) = AR subledger Σ(baseTotal − basePaidAmount) (${slH}) — advances never diverge them`,
  Math.round(glH * 1000) === Math.round(slH * 1000) && Math.round(glH * 1000) > 0, `${glH} vs ${slH}`);
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
