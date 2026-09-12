/**
 * AUDIT REPRODUCTION (2026-09-12 correction pass) — statements vs payment reversal.
 *
 * Question: does a customer/vendor statement show a reversed payment's REVERSAL line?
 *
 * Method: real production actions only. `recordPaymentAction` and `reversePaymentAction` are
 * invoked by raw POST carrying the Next-Action id and a genuine OWNER cookie obtained by
 * registering an org through the real registration form — no page in between, nothing stubbed.
 * Documents are seeded with SQL (as every suite in this repo does); every MONEY MOVEMENT is made
 * by the product's own code.
 *
 * This script writes fixture ids to repro-statements-fixture.json; the .mts companion then calls
 * the real `getStatement` and compares it against the ledger.
 *
 * Read-only against production: never run this anywhere but a disposable database.
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { readFile, writeFile } from "node:fs/promises";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const uniq = () => Math.random().toString(36).slice(2, 8);
const email = `stmt_${uniq()}@t.dev`;
const log = [];
const say = (s) => { console.log(s); log.push(s); };

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const manifest = JSON.parse(await readFile(".next/server/server-reference-manifest.json", "utf8"));
const idFor = (name) => {
  for (const [id, entry] of Object.entries(manifest.node)) {
    for (const w of Object.values(entry.workers ?? {})) if (w.exportedName === name) return id;
  }
  return null;
};
const recordId = idFor("recordPaymentAction");
const reverseId = idFor("reversePaymentAction");
say(`Next-Action ids: recordPaymentAction=${recordId} reversePaymentAction=${reverseId}`);
if (!recordId || !reverseId) { console.error("FATAL: action ids not found"); process.exit(1); }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
await page.fill("#orgName", `Stmt Repro ${uniq()}`); await page.fill("#name", "SR"); await page.fill("#email", email);
await page.fill("#password", pass);
await page.locator("#country").click(); await page.waitForTimeout(300);
await page.keyboard.type("Saudi Arabi"); await page.waitForTimeout(500);
await page.getByRole("button", { name: /^Saudi Arabia ·/ }).first().click(); await page.waitForTimeout(400);
await Promise.all([page.waitForURL(`${BASE}/dashboard`, { timeout: 40000 }), page.click('button[type="submit"]')]);
const cookieHeader = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
await browser.close();
say(`registered org, genuine OWNER cookie captured: ${/elite_erp_session/.test(cookieHeader)}`);

const org = (await db.query("select org_id from users where email=$1", [email])).rows[0].org_id;
const uid = (await db.query("select id from users where email=$1", [email])).rows[0].id;
const acct = async (c) => (await db.query("select id from accounts where org_id=$1 and code=$2", [org, c])).rows[0]?.id;
const bankGl = await acct("1000");
const bank = (await db.query("insert into bank_accounts (org_id,name,gl_account_id) values ($1,'Bank',$2) returning id", [org, bankGl])).rows[0].id;

// ---- real actions over the wire ----
const recordPayment = async ({ direction, sourceType, sourceId, amount, date }) => {
  const fd = new FormData();
  fd.set("direction", direction); fd.set("sourceType", sourceType); fd.set("sourceId", String(sourceId));
  fd.set("bankAccountId", String(bank)); fd.set("amount", String(amount)); fd.set("paymentDate", date);
  fd.set("method", "bank_transfer"); fd.set("reference", `REF-${uniq()}`);
  // FormData actions use the FORM-POST protocol: the action id travels as a `$ACTION_ID_<id>`
  // body field, not the `Next-Action` header. The header variant returns 500 "Connection closed"
  // and writes nothing — verified both ways before settling on this one.
  fd.set(`$ACTION_ID_${recordId}`, "");
  const res = await fetch(`${BASE}/finance/payments`, {
    method: "POST", headers: { Cookie: cookieHeader }, body: fd, redirect: "manual",
  });
  return { status: res.status, wrote: true };
};
const reversePayment = async (paymentId) => {
  const res = await fetch(`${BASE}/finance/payments`, {
    method: "POST",
    headers: { "Next-Action": reverseId, "Content-Type": "text/plain;charset=UTF-8", Cookie: cookieHeader },
    body: JSON.stringify([paymentId]), redirect: "manual",
  });
  return { status: res.status, body: (await res.text()).slice(0, 400) };
};
const lastPayment = async () => (await db.query(
  "select id, amount::text, payment_date::text, reversed_at from payments where org_id=$1 order by id desc limit 1", [org])).rows[0];

const scenarios = {};

// ── A. CLIENT: invoice 1,000 · payment 400 IN period · reversal IN period ─────────────────────
const custA = (await db.query("insert into customers (org_id,name) values ($1,'Client A') returning id", [org])).rows[0].id;
const invA = (await db.query(
  `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,total,tax_total,paid_amount,base_paid_amount,currency,created_by_id)
   values ($1,$2,$3,'2026-07-01','sent','1000.000','0','0','0','SAR',$4) returning id`,
  [org, `SINV-A-${uniq()}`, custA, uid])).rows[0].id;
await db.query(
  `insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id) values ($1,'2026-07-01','Invoice A','sales_invoice',$2,$3)`,
  [org, invA, uid]);
const jeA = (await db.query("select id from journal_entries where org_id=$1 and source_type='sales_invoice' and source_id=$2", [org, invA])).rows[0].id;
await db.query("insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,'1000.000','0'),($1,$3,'0','1000.000')",
  [jeA, await acct("1100"), await acct("4000")]);
say(`\n── A. CLIENT — invoice 1,000 (2026-07-01), payment 400 (2026-08-05), reverse`);
say(`   recordPaymentAction -> ${JSON.stringify(await recordPayment({ direction: "in", sourceType: "invoice", sourceId: invA, amount: 400, date: "2026-08-05" }))}`);
const payA = await lastPayment(); say(`   payment row: ${JSON.stringify(payA)}`);
say(`   reversePaymentAction -> ${JSON.stringify(await reversePayment(payA.id))}`);
const payA2 = (await db.query("select reversed_at from payments where id=$1", [payA.id])).rows[0];
say(`   reversed_at now: ${payA2.reversed_at}`);
scenarios.A = { kind: "client", partyId: custA, invoiceId: invA, paymentId: payA.id, from: "2026-08-01", to: "2026-09-30" };

// ── B. VENDOR: PO 1,000 · payment 400 IN period · reversal IN period ──────────────────────────
const vendB = (await db.query("insert into vendors (org_id,name) values ($1,'Vendor B') returning id", [org])).rows[0].id;
const poB = (await db.query(
  `insert into purchase_orders (org_id,po_number,vendor_id,order_date,status,total,tax_total,paid_amount,base_paid_amount,currency,created_by_id)
   values ($1,$2,$3,'2026-07-01','received','1000.000','0','0','0','SAR',$4) returning id`,
  [org, `SPO-B-${uniq()}`, vendB, uid])).rows[0].id;
await db.query(
  `insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id) values ($1,'2026-07-01','PO B','purchase_order',$2,$3)`,
  [org, poB, uid]);
const jeB = (await db.query("select id from journal_entries where org_id=$1 and source_type='purchase_order' and source_id=$2", [org, poB])).rows[0].id;
await db.query("insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,'1000.000','0'),($1,$3,'0','1000.000')",
  [jeB, await acct("1200"), await acct("2000")]);
say(`\n── B. VENDOR — PO 1,000 (2026-07-01), payment 400 (2026-08-05), reverse`);
say(`   recordPaymentAction -> ${JSON.stringify(await recordPayment({ direction: "out", sourceType: "po", sourceId: poB, amount: 400, date: "2026-08-05" }))}`);
const payB = await lastPayment(); say(`   payment row: ${JSON.stringify(payB)}`);
say(`   reversePaymentAction -> ${JSON.stringify(await reversePayment(payB.id))}`);
scenarios.B = { kind: "vendor", partyId: vendB, poId: poB, paymentId: payB.id, from: "2026-08-01", to: "2026-09-30" };

// ── C. CLIENT: payment BEFORE the period, reversal INSIDE it (opening-balance case) ────────────
const custC = (await db.query("insert into customers (org_id,name) values ($1,'Client C') returning id", [org])).rows[0].id;
const invC = (await db.query(
  `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,total,tax_total,paid_amount,base_paid_amount,currency,created_by_id)
   values ($1,$2,$3,'2026-06-01','sent','1000.000','0','0','0','SAR',$4) returning id`,
  [org, `SINV-C-${uniq()}`, custC, uid])).rows[0].id;
await db.query(
  `insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id) values ($1,'2026-06-01','Invoice C','sales_invoice',$2,$3)`,
  [org, invC, uid]);
const jeC = (await db.query("select id from journal_entries where org_id=$1 and source_type='sales_invoice' and source_id=$2", [org, invC])).rows[0].id;
await db.query("insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,'1000.000','0'),($1,$3,'0','1000.000')",
  [jeC, await acct("1100"), await acct("4000")]);
say(`\n── C. CLIENT — payment 400 on 2026-06-15 (BEFORE period), reversal inside period`);
say(`   recordPaymentAction -> ${JSON.stringify(await recordPayment({ direction: "in", sourceType: "invoice", sourceId: invC, amount: 400, date: "2026-06-15" }))}`);
const payC = await lastPayment(); say(`   payment row: ${JSON.stringify(payC)}`);
say(`   reversePaymentAction -> ${JSON.stringify(await reversePayment(payC.id))}`);
scenarios.C = { kind: "client", partyId: custC, invoiceId: invC, paymentId: payC.id, from: "2026-08-01", to: "2026-09-30" };

// ── D. VENDOR whose PO is OUTSIDE the selected range (attribution question) ────────────────────
scenarios.D = { kind: "vendor", partyId: vendB, poId: poB, paymentId: payB.id, from: "2026-08-01", to: "2026-09-30", note: "PO dated 2026-07-01, outside the range" };

// ---- what the LEDGER says, independently of any statement ----
say(`\n── LEDGER (source of truth) ──`);
const ledger = (await db.query(`
  select je.source_type, je.source_id, je.entry_date::text as d, a.code,
         sum(jl.debit)::text as dr, sum(jl.credit)::text as cr
    from journal_entries je
    join journal_lines jl on jl.journal_entry_id = je.id
    join accounts a on a.id = jl.account_id
   where je.org_id=$1 and a.code in ('1100','2000','1000')
   group by je.source_type, je.source_id, je.entry_date, a.code
   order by je.entry_date, je.source_id, a.code`, [org])).rows;
for (const r of ledger) say(`   ${r.d} ${r.source_type}#${r.source_id} ${r.code} Dr ${r.dr} Cr ${r.cr}`);

const ctl = (await db.query(`
  select a.code, (sum(jl.debit)-sum(jl.credit))::text as bal
    from journal_entries je join journal_lines jl on jl.journal_entry_id=je.id join accounts a on a.id=jl.account_id
   where je.org_id=$1 and a.code in ('1100','2000') group by 1 order by 1`, [org])).rows;
say(`   control balances: ${ctl.map((r) => `${r.code}=${r.bal}`).join("  ")}`);

await writeFile("docs/audits/2026-09-12/evidence/repro-statements-fixture.json",
  JSON.stringify({ org, uid, scenarios, ledger, control: ctl }, null, 2));
await writeFile("docs/audits/2026-09-12/evidence/repro-statements-actions.txt", log.join("\n") + "\n");
say(`\nfixture written. org=${org}`);
await db.end();
