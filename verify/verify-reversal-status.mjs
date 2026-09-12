/**
 * F-1 — the invoice status written by reversePaymentAction must be the CANONICAL settlement status.
 *
 * ## Why this suite exists alongside verify-payment-reversal
 *
 * verify-payment-reversal passes 55/55 with this defect live, and structurally cannot catch it: at
 * line 162 it SIMULATES the action, writing the invoice row itself with its own status call. A
 * suite that reimplements the thing it is testing agrees with itself no matter what production
 * does. The defect lives in the action's own SQL — its `SELECT … FOR UPDATE` never fetched
 * `credited_amount`, so the value was not even available to the branch that computed status.
 *
 * So this suite simulates nothing. It drives the real `recordPaymentAction` and the real
 * `reversePaymentAction` over HTTP with a genuine owner session, then reads the PERSISTED status
 * straight out of the database and compares it with `settlementOf` — the same canonical helper the
 * invoice page, the credit-note action and the advance allocation all settle through.
 *
 * ## The invariant
 *
 *     persisted status after reversal  ==  settlementOf({ total, paid, credited }).status
 *
 * Each fixture names the status that identity produces for its own figures. That is NOT a second
 * copy of the formula — the formula lives in `settlementOf` and `verify:settlement` pins its
 * behaviour at 29/29 on the server tier. What this suite adds is the half that tier cannot reach:
 * whether the ACTION fetches `credited_amount` at all and settles through that helper. A fixture
 * naming its own expected outcome is what lets the assertion fail when the action quietly uses a
 * different rule, which is exactly what it was doing.
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { assertFreshBuild } from "./assert-fresh-build.mjs";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const uniq = () => Math.random().toString(36).slice(2, 8);
const email = `revst_${uniq()}@t.dev`;
const results = [];
const check = (name, cond, extra = "") => results.push([cond, name, extra]);

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
check("found both Next-Action ids", !!recordId && !!reverseId);

// Refuse to run against a stale build — this suite drove one during development and
// reported a plausible, wrong number. The guard is a precondition, not a post-mortem.
await assertFreshBuild(BASE);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
await page.fill("#orgName", `RevSt ${uniq()}`); await page.fill("#name", "RS");
await page.fill("#email", email); await page.fill("#password", pass);
await page.locator("#country").click(); await page.waitForTimeout(300);
await page.keyboard.type("Saudi Arabi"); await page.waitForTimeout(500);
await page.getByRole("button", { name: /^Saudi Arabia ·/ }).first().click(); await page.waitForTimeout(400);
await Promise.all([page.waitForURL(`${BASE}/dashboard`, { timeout: 40000 }), page.click('button[type="submit"]')]);
const cookieHeader = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
await browser.close();

const org = (await db.query("select org_id from users where email=$1", [email])).rows[0].org_id;
const uid = (await db.query("select id from users where email=$1", [email])).rows[0].id;
const acct = async (c) => (await db.query("select id from accounts where org_id=$1 and code=$2", [org, c])).rows[0]?.id;
const bank = (await db.query("insert into bank_accounts (org_id,name,gl_account_id) values ($1,'Bank',$2) returning id",
  [org, await acct("1000")])).rows[0].id;
const cust = (await db.query("insert into customers (org_id,name) values ($1,'Status Client') returning id", [org])).rows[0].id;

const recordPayment = async (invoiceId, amount) => {
  const fd = new FormData();
  fd.set("direction", "in"); fd.set("sourceType", "invoice"); fd.set("sourceId", String(invoiceId));
  fd.set("bankAccountId", String(bank)); fd.set("amount", String(amount)); fd.set("paymentDate", "2026-08-05");
  fd.set("method", "bank_transfer"); fd.set("reference", `RS-${uniq()}`);
  fd.set(`$ACTION_ID_${recordId}`, "");
  const r = await fetch(`${BASE}/finance/payments`, { method: "POST", headers: { Cookie: cookieHeader }, body: fd, redirect: "manual" });
  return r.status;
};
const reversePayment = async (paymentId) => (await fetch(`${BASE}/finance/payments`, {
  method: "POST",
  headers: { "Next-Action": reverseId, "Content-Type": "text/plain;charset=UTF-8", Cookie: cookieHeader },
  body: JSON.stringify([paymentId]), redirect: "manual",
})).status;
const lastPaymentId = async () => (await db.query("select id from payments where org_id=$1 order by id desc limit 1", [org])).rows[0].id;
const paymentCount = async () => Number((await db.query("select count(*)::int n from payments where org_id=$1", [org])).rows[0].n);

/**
 * An invoice at `total` carrying `credited` of credit-note value. The credit note itself is seeded
 * rather than issued — its own correctness is verify-credit-note-release's job, and what is under
 * test here is whether the REVERSAL path reads the figure at all.
 */
const mkInvoice = async (total) => {
  const id = (await db.query(
    `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,total,tax_total,
                                 paid_amount,base_paid_amount,credited_amount,base_credited_amount,currency,created_by_id)
     values ($1,$2,$3,'2026-07-01','sent',$4,'0','0','0','0','0','SAR',$5) returning id`,
    [org, `STINV-${uniq()}`, cust, total, uid])).rows[0].id;
  const je = (await db.query(
    `insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id)
     values ($1,'2026-07-01','inv','sales_invoice',$2,$3) returning id`, [org, id, uid])).rows[0].id;
  await db.query("insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,$3,'0'),($1,$4,'0',$3)",
    [je, await acct("1100"), total, await acct("4000")]);
  return id;
};

const readInvoice = async (id) => (await db.query(
  "select total::text total, paid_amount::text paid, credited_amount::text credited, currency, status from sales_invoices where id=$1", [id])).rows[0];

/** Drive a real payment + a real reversal, then assert the PERSISTED status against settlementOf. */
async function scenario(label, { total, credited, payments, reverseIndex, expectStatus }) {
  const inv = await mkInvoice(total);
  const ids = [];
  for (const amt of payments) {
    const before = await paymentCount();
    const st = await recordPayment(inv, amt);
    // A server action answers 200 even when it RETURNS an error object, so the status code alone
    // proves nothing. An earlier draft of this suite checked only the code, a payment was silently
    // refused as an over-settlement, and `lastPaymentId()` then handed back the PREVIOUS scenario's
    // payment — a fixture that looked fine and tested the wrong row. Count the rows instead.
    check(`${label}: recordPaymentAction actually created a payment of ${amt}`,
      st === 200 && (await paymentCount()) === before + 1, `http=${st}`);
    ids.push(await lastPaymentId());
  }
  // The credit note lands AFTER the cash, which is both the realistic order and the only one the
  // over-settlement guard allows: crediting an invoice in full first leaves nothing payable.
  if (Number(credited) > 0) {
    await db.query("update sales_invoices set credited_amount=$1, base_credited_amount=$1 where id=$2", [credited, inv]);
  }
  const st = await reversePayment(ids[reverseIndex]);
  check(`${label}: reversePaymentAction accepted`, st === 200, String(st));

  const row = await readInvoice(inv);
  check(
    `${label}: persisted status is the canonical settlement status`,
    row.status === expectStatus,
    `total=${row.total} paid=${row.paid} credited=${row.credited} -> persisted "${row.status}", expected "${expectStatus}"`,
  );
  return row;
}

// 1,000 invoice, 600 credited, one 400 payment reversed -> 600 of 1,000 still settled by credit.
// settled = 0 paid + 600 credited, of 1,000 -> partially settled.
await scenario("part-credited", { total: "1000.000", credited: "600.000", payments: [400], reverseIndex: 0, expectStatus: "partially_paid" });

// 1,000 invoice credited in full, its payment reversed -> the credit alone still settles it.
// settled = 0 paid + 1,000 credited -> the credit alone settles it in full.
await scenario("fully-credited", { total: "1000.000", credited: "1000.000", payments: [400], reverseIndex: 0, expectStatus: "paid" });

// No credit note at all — the ordinary case, which must behave exactly as before.
const plain = await scenario("uncredited", { total: "1000.000", credited: "0", payments: [400], reverseIndex: 0, expectStatus: "sent" });
check("uncredited: an invoice with nothing settled returns to `sent`", plain.status === "sent", plain.status);

// Two payments, one reversed — the remaining payment must still hold it partially paid.
const partial = await scenario("partial-remains", { total: "1000.000", credited: "0", payments: [400, 300], reverseIndex: 0, expectStatus: "partially_paid" });
check("partial-remains: the surviving payment keeps it `partially_paid`", partial.status === "partially_paid", partial.status);

await db.end();
const failed = results.filter(([ok]) => !ok);
for (const [ok, name, extra] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  << ${extra}` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} checks`);
process.exit(failed.length ? 1 : 0);
