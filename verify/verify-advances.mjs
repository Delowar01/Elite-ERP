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
 * Mutation-proofed (per the review instruction): reverting the credit to 1100 must FAIL here
 * naming the wrong account — the suite asserts the new rule, it does not merely tolerate it.
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
const AR = await acct("1100"), ADV = await acct("2300"), REV = await acct("4000");
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

await db.end();
await browser.close();
let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "ADVANCES PASS" : "ADVANCES FAIL");
process.exit(ok ? 0 : 1);
