/**
 * Delete is REFUSED for the two populations Reverse covers — proven at the server, by replay.
 *
 * Not rendering a control is a display choice, and this project has twice established that a
 * display choice is a suggestion rather than a rule. So every assertion here invokes
 * `deletePaymentAction` directly: a raw POST carrying the Next-Action id and a genuine OWNER
 * cookie, with no page in between. Owner, deliberately — the role that IS permitted to delete, so
 * a refusal here is the population guard and cannot be the role guard wearing its coat.
 *
 * ## The control is the important part
 *
 * Two refusals on their own prove nothing: a broken harness — a wrong action id, a rejected cookie,
 * a malformed body — refuses everything, and both assertions pass while the protocol is dead. So a
 * PROFORMA ADVANCE RECEIPT is deleted through the identical call and must SUCCEED, end to end,
 * with its row and its journal entry actually gone from the database.
 *
 * That control carries a second meaning. Proforma advance receipts keep Delete on purpose: reversal
 * does not cover them, and `refundAdvanceAction` is not a substitute for removing a mistyped
 * receipt, because a refund books a real cash payout rather than correcting a movement that never
 * happened. An over-broad refusal is the plausible mistake in this change, and it would strand that
 * capability silently. This is the assertion that catches it.
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const email = `dr_${Math.random().toString(36).slice(2, 8)}@t.dev`;
const results = [];
const check = (name, cond, extra = "") => results.push([cond, name, extra]);
const uniq = () => Math.random().toString(36).slice(2, 8);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const manifest = JSON.parse(await readFile(".next/server/server-reference-manifest.json", "utf8"));
const idFor = (name) => {
  for (const [id, entry] of Object.entries(manifest.node)) {
    for (const w of Object.values(entry.workers ?? {})) {
      if (w.exportedName === name) return id;
    }
  }
  return null;
};
const deleteId = idFor("deletePaymentAction");
check("found the Next-Action id for deletePaymentAction", !!deleteId, String(deleteId));

await assertFreshBuild(BASE);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
await page.fill("#orgName", `DR Org ${uniq()}`); await page.fill("#name", "DR"); await page.fill("#email", email);
await page.fill("#password", pass);
await pickCountry(page);
await Promise.all([page.waitForURL(`${BASE}/dashboard`, { timeout: 40000 }), page.click('button[type="submit"]')]);

const cookieHeader = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
check("captured a genuine OWNER session cookie", /elite_erp_session/.test(cookieHeader));
const org = (await db.query("select org_id from users where email=$1", [email])).rows[0].org_id;
const uid = (await db.query("select id from users where email=$1", [email])).rows[0].id;
const acct = async (code) => (await db.query("select id from accounts where org_id=$1 and code=$2", [org, code])).rows[0].id;
const bankGl = await acct("1000");
const bank = (await db.query("insert into bank_accounts (org_id,name,gl_account_id) values ($1,'Bank',$2) returning id", [org, bankGl])).rows[0].id;
const cust = (await db.query("insert into customers (org_id,name) values ($1,'DR Client') returning id", [org])).rows[0].id;
const vend = (await db.query("insert into vendors (org_id,name) values ($1,'DR Vendor') returning id", [org])).rows[0].id;

const post = async (paymentId, lines) => {
  const je = (await db.query(
    `insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id)
     values ($1,'2026-08-01','p','payment',$2,$3) returning id`, [org, paymentId, uid])).rows[0].id;
  for (const [a, d, c] of lines) {
    await db.query("insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,$3,$4)", [je, a, d, c]);
  }
};
const del = async (paymentId) => {
  const res = await fetch(`${BASE}/finance/payments`, {
    method: "POST",
    headers: { "Next-Action": deleteId, "Content-Type": "text/plain;charset=UTF-8", Cookie: cookieHeader },
    body: JSON.stringify([paymentId]),
    redirect: "manual",
  });
  return { status: res.status, body: (await res.text()).replaceAll("<!-- -->", "") };
};
const stillThere = async (id) => (await db.query("select count(*)::int n from payments where id=$1", [id])).rows[0].n === 1;
const entriesFor = async (id) => (await db.query(
  "select count(*)::int n from journal_entries where org_id=$1 and source_type='payment' and source_id=$2", [org, id])).rows[0].n;

// ── 1. Ordinary SALES-INVOICE payment: refused ────────────────────────────────────────────────
const inv = (await db.query(
  `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,total,tax_total,paid_amount,base_paid_amount,created_by_id)
   values ($1,$2,$3,'2026-07-01','partially_paid','1000.00','0','300.00','300.00',$4) returning id`,
  [org, `DRINV-${uniq()}`, cust, uid])).rows[0].id;
const invPay = (await db.query(
  `insert into payments (org_id,direction,bank_account_id,amount,payment_date,method,reference,sales_invoice_id,created_by_id)
   values ($1,'in',$2,'300.00','2026-08-01','bank_transfer',$3,$4,$5) returning id`,
  [org, bank, `DRP-${uniq()}`, inv, uid])).rows[0].id;
await post(invPay, [[bankGl, "300.000", "0"], [await acct("1100"), "0", "300.000"]]);

const r1 = await del(invPay);
check("REPLAY: deleting an ordinary SALES-INVOICE payment is REFUSED at the server",
  /cannot be deleted/i.test(r1.body), r1.body.slice(0, 150));
check("…and the refusal NAMES Reverse Payment as the route",
  /Reverse Payment/.test(r1.body) && /keeps the payment on record/i.test(r1.body), r1.body.slice(0, 200));
check("…and the payment and its journal entry both survive",
  (await stillThere(invPay)) && (await entriesFor(invPay)) === 1);

// ── 2. Ordinary PURCHASE-ORDER payment: refused ───────────────────────────────────────────────
const po = (await db.query(
  `insert into purchase_orders (org_id,po_number,vendor_id,order_date,status,subtotal,tax_total,total,paid_amount,base_paid_amount,created_by_id)
   values ($1,$2,$3,'2026-07-01','received','1000.00','0','1000.00','300.00','300.00',$4) returning id`,
  [org, `DRPO-${uniq()}`, vend, uid])).rows[0].id;
const poPay = (await db.query(
  `insert into payments (org_id,direction,bank_account_id,amount,payment_date,method,reference,purchase_order_id,created_by_id)
   values ($1,'out',$2,'300.00','2026-08-01','bank_transfer',$3,$4,$5) returning id`,
  [org, bank, `DRP-${uniq()}`, po, uid])).rows[0].id;
await post(poPay, [[await acct("2000"), "300.000", "0"], [bankGl, "0", "300.000"]]);

const r2 = await del(poPay);
check("REPLAY: deleting an ordinary PURCHASE-ORDER payment is REFUSED at the server",
  /cannot be deleted/i.test(r2.body), r2.body.slice(0, 150));
check("…and names the document type correctly", /purchase order payment/i.test(r2.body), r2.body.slice(0, 150));
check("…and the payment and its journal entry both survive",
  (await stillThere(poPay)) && (await entriesFor(poPay)) === 1);

// ── 3. THE CONTROL: a proforma advance receipt still deletes, through the identical call ───────
// Without this, a dead harness would make both refusals above look like passes.
const pf = (await db.query(
  `insert into proforma_invoices (org_id,proforma_number,customer_id,status,issue_date,subtotal,tax_total,total,paid_amount,created_by_id)
   values ($1,$2,$3,'sent','2026-07-01','500.00','0','500.00','500.00',$4) returning id`,
  [org, `DRPF-${uniq()}`, cust, uid])).rows[0].id;
const advPay = (await db.query(
  `insert into payments (org_id,direction,bank_account_id,amount,payment_date,method,reference,kind,proforma_invoice_id,created_by_id)
   values ($1,'in',$2,'500.00','2026-08-01','bank_transfer',$3,'advance_receipt',$4,$5) returning id`,
  [org, bank, `DRA-${uniq()}`, pf, uid])).rows[0].id;
await post(advPay, [[bankGl, "500.000", "0"], [await acct("2300"), "0", "500.000"]]);

const r3 = await del(advPay);
check("CONTROL: the SAME call still deletes a proforma advance receipt — the harness is alive",
  !/cannot be deleted/i.test(r3.body), r3.body.slice(0, 150));
check("CONTROL: …the payment row is genuinely GONE from the database",
  !(await stillThere(advPay)), "still present");
check("CONTROL: …and so is its journal entry", (await entriesFor(advPay)) === 0);
check("CONTROL: …and the proforma's paidAmount was restored to 0",
  (await db.query("select paid_amount::text p from proforma_invoices where id=$1", [pf])).rows[0].p === "0.000",
  (await db.query("select paid_amount::text p from proforma_invoices where id=$1", [pf])).rows[0].p);

// ── 4. …and Delete is still RENDERED on a proforma, so the capability is reachable ─────────────
// A SECOND receipt is seeded first, because the one above was deleted by the control and a page
// with no payment rows has no Delete button for reasons that have nothing to do with this change.
// (The first draft of this block asserted `count() >= 0`, which is true of every number — an
// assertion that cannot fail, and exactly the species this repo catalogues.)
const advPay2 = (await db.query(
  `insert into payments (org_id,direction,bank_account_id,amount,payment_date,method,reference,kind,proforma_invoice_id,created_by_id)
   values ($1,'in',$2,'250.00','2026-08-02','bank_transfer',$3,'advance_receipt',$4,$5) returning id`,
  [org, bank, `DRA2-${uniq()}`, pf, uid])).rows[0].id;
await post(advPay2, [[bankGl, "250.000", "0"], [await acct("2300"), "0", "250.000"]]);
await db.query("update proforma_invoices set paid_amount='250.00' where id=$1", [pf]);

await page.goto(`${BASE}/sales/proforma/${pf}`, { waitUntil: "networkidle" });
check("the surviving receipt is listed on the proforma", (await page.locator("tr", { hasText: "250" }).count()) >= 1);
check("Delete IS still offered there — the refusal is narrow, not blanket",
  (await page.getByLabel("Delete").count()) >= 1, `${await page.getByLabel("Delete").count()} controls`);
check("…and Reverse is NOT offered — a proforma receipt is an advance, undone by release or refund",
  (await page.getByLabel("Reverse Payment").count()) === 0);
// End to end through the real UI, not just the replay: the capability is genuinely intact.
await page.getByLabel("Delete").first().click();
await page.waitForTimeout(400);
await page.locator('[role="dialog"]').last().getByRole("button", { name: /^Delete Payment$/ }).click();
await page.waitForTimeout(1500);
check("…and deleting it through the UI still works, end to end", !(await stillThere(advPay2)));

await db.end();
await browser.close();
console.log("\nDelete refusal — proven by replay on both populations, with a live control\n");
for (const [ok, name, extra] of results) console.log(`${ok ? "  ✓" : "  ✗ FAIL"} ${name}${extra ? `  << ${extra}` : ""}`);
const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks`);
console.log(failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
