/**
 * N-1 — the Record Payment picker must offer what is genuinely COLLECTIBLE.
 *
 * The picker listed `total − paidAmount` and never subtracted `creditedAmount`, so an invoice
 * carrying a credit note was presented with an inflated balance at the one moment that figure is
 * acted on: when somebody is deciding how much money to ask for. The number also pre-fills the
 * amount field, so the overstatement is what a user accepts by default.
 *
 * This is asserted through the rendered dialog rather than against the page's data, because the
 * defect is in what a person is shown. The purchase-order row is asserted UNCHANGED in the same
 * run: purchase orders have no `creditedAmount` column, so `total − paidAmount` is the whole
 * identity there and "fixing" it symmetrically would have been wrong.
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { assertFreshBuild } from "./assert-fresh-build.mjs";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const uniq = () => Math.random().toString(36).slice(2, 8);
const email = `reg_${uniq()}@t.dev`;
const results = [];
const check = (name, cond, extra = "") => results.push([cond, name, extra]);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await assertFreshBuild(BASE);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
await page.fill("#orgName", `Reg ${uniq()}`); await page.fill("#name", "RG");
await page.fill("#email", email); await page.fill("#password", pass);
await page.locator("#country").click(); await page.waitForTimeout(300);
await page.keyboard.type("Saudi Arabi"); await page.waitForTimeout(500);
await page.getByRole("button", { name: /^Saudi Arabia ·/ }).first().click(); await page.waitForTimeout(400);
await Promise.all([page.waitForURL(`${BASE}/dashboard`, { timeout: 40000 }), page.click('button[type="submit"]')]);

const org = (await db.query("select org_id from users where email=$1", [email])).rows[0].org_id;
const uid = (await db.query("select id from users where email=$1", [email])).rows[0].id;
const acct = async (c) => (await db.query("select id from accounts where org_id=$1 and code=$2", [org, c])).rows[0]?.id;
await db.query("insert into bank_accounts (org_id,name,gl_account_id) values ($1,'Bank',$2)", [org, await acct("1000")]);
const cust = (await db.query("insert into customers (org_id,name) values ($1,'Credited Co') returning id", [org])).rows[0].id;
const vend = (await db.query("insert into vendors (org_id,name) values ($1,'Plain Vendor') returning id", [org])).rows[0].id;

// Invoice 1,000 · paid 200 · credited 300  ->  collectible 500, NOT 800.
const invNo = `NINV-${uniq()}`;
await db.query(
  `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,total,tax_total,
                               paid_amount,base_paid_amount,credited_amount,base_credited_amount,currency,created_by_id)
   values ($1,$2,$3,'2026-07-01','partially_paid','1000.000','0','200.000','200.000','300.000','300.000','SAR',$4)`,
  [org, invNo, cust, uid]);
// A second invoice with NO credit note, so the ordinary case is proven unchanged in the same run.
const plainNo = `PINV-${uniq()}`;
await db.query(
  `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,total,tax_total,
                               paid_amount,base_paid_amount,credited_amount,base_credited_amount,currency,created_by_id)
   values ($1,$2,$3,'2026-07-02','partially_paid','1000.000','0','200.000','200.000','0','0','SAR',$4)`,
  [org, plainNo, cust, uid]);
// A received PO: 1,000 total, 200 paid -> 800. Purchase orders carry no credited column.
const poNo = `NPO-${uniq()}`;
await db.query(
  `insert into purchase_orders (org_id,po_number,vendor_id,order_date,status,total,tax_total,
                                paid_amount,base_paid_amount,currency,created_by_id)
   values ($1,$2,$3,'2026-07-01','received','1000.000','0','200.000','200.000','SAR',$4)`,
  [org, poNo, vend, uid]);

/** The document options the picker actually renders, for one direction. */
const pickerOptions = async (direction) => {
  await page.goto(`${BASE}/finance/payments`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Record Payment$/ }).first().click();
  await page.waitForTimeout(400);
  if (direction === "out") {
    await page.locator("#pay-direction").click();
    await page.waitForTimeout(250);
    await page.getByRole("option", { name: /Paid to Vendor/i }).first().click();
    await page.waitForTimeout(350);
  }
  await page.locator("#pay-source").click();
  await page.waitForTimeout(400);
  const texts = await page.getByRole("option").allTextContents();
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  return texts;
};
/** The balance the picker shows for one document number. */
const shownBalance = (texts, number) => {
  const row = texts.find((t) => t.includes(number));
  if (!row) return null;
  const m = row.match(/([\d,]+\.\d{2})\s*$/) || row.match(/([\d,]+\.\d{2})/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
};

const inOpts = await pickerOptions("in");
check("the picker lists the credited invoice", inOpts.some((t) => t.includes(invNo)), inOpts.join(" | ").slice(0, 200));
const credited = shownBalance(inOpts, invNo);
check("N-1: a credited invoice offers total − paid − credited",
  credited === 500, `shown ${credited}, expected 500 (1,000 − 200 paid − 300 credited); the defect showed 800`);
const plain = shownBalance(inOpts, plainNo);
check("an UNCREDITED invoice is unchanged at total − paid",
  plain === 800, `shown ${plain}, expected 800`);

const outOpts = await pickerOptions("out");
check("the picker lists the purchase order", outOpts.some((t) => t.includes(poNo)), outOpts.join(" | ").slice(0, 200));
const po = shownBalance(outOpts, poNo);
check("PURCHASE ORDER behaviour is unchanged at total − paid (no credited column exists)",
  po === 800, `shown ${po}, expected 800`);

await browser.close();
await db.end();
const failed = results.filter(([ok]) => !ok);
for (const [ok, name, extra] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  << ${extra}` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} checks`);
process.exit(failed.length ? 1 : 0);
