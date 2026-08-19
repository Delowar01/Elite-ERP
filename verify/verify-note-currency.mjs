/**
 * A credit note renders in the currency of the invoice it reverses — screen AND printed PDF.
 *
 * The defect: CN-0002 against a USD invoice displayed "SAR 75" and "SAR 575" — the note's own USD
 * figures under the ORGANIZATION's base mark. The numbers were right and the symbol was not, which
 * is the worst combination: nothing looks broken, and a customer reads a 575-dollar credit as a
 * 575-riyal one.
 *
 * Cause, in both places: the invoice detail page wraps its figures in
 * `CurrencyProvider mark={docMoneyMark(org, invoice.currency)}` and the print route reassigns
 * `mark`/`numFmt` per document type. The note pages did neither, so they inherited the org base.
 * The DEBIT note had the identical defect and is fixed in the same change.
 *
 * Assertions are on the SAR asset's presence, not on the absence of the string "SAR": the riyal
 * renders as an <img>, and asserting a bare token would fire on incidental text elsewhere on the
 * page — the wrong-cause trap this repo catalogues.
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const results = [];
const check = (name, cond, extra = "") => results.push([cond, name, extra]);
const uniq = () => Math.random().toString(36).slice(2, 8);
const email = `nc_${uniq()}@t.dev`;

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await assertFreshBuild(BASE);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
await page.fill("#orgName", `NC Org ${uniq()}`); await page.fill("#name", "NC"); await page.fill("#email", email);
await page.fill("#password", `Zx9$mQ${uniq()}vK!ray`);
await pickCountry(page);
await Promise.all([page.waitForURL(`${BASE}/dashboard`, { timeout: 40000 }), page.click('button[type="submit"]')]);

const org = (await db.query("select org_id from users where email=$1", [email])).rows[0].org_id;
const uid = (await db.query("select id from users where email=$1", [email])).rows[0].id;
const orgCur = (await db.query("select currency from orgs where id=$1", [org])).rows[0].currency;
check("the org's base currency is SAR — so a USD note rendering in base is visibly wrong", orgCur === "SAR", orgCur);
const cust = (await db.query("insert into customers (org_id,name) values ($1,'NC Client') returning id", [org])).rows[0].id;
const vend = (await db.query("insert into vendors (org_id,name) values ($1,'NC Vendor') returning id", [org])).rows[0].id;

// INV-0007 from the report: USD 500 + 75 VAT = 575 at 3.75.
const inv = (await db.query(
  `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,subtotal,tax_total,total,paid_amount,
                               base_paid_amount,currency,exchange_rate,base_total,base_tax_amount,created_by_id)
   values ($1,'INV-0007',$2,'2026-07-01','sent','500.00','75.00','575.00','0','0','USD','3.75','2156.250','281.250',$3) returning id`,
  [org, cust, uid])).rows[0].id;
const cn = (await db.query(
  `insert into credit_notes (org_id,credit_note_number,customer_id,source_invoice_id,issue_date,status,
                             subtotal,tax_total,total,currency,exchange_rate,base_total,base_tax_amount,created_by_id)
   values ($1,'CN-0002',$2,$3,'2026-08-15','issued','500.00','75.00','575.00','USD','3.75','2156.250','281.250',$4) returning id`,
  [org, cust, inv, uid])).rows[0].id;
await db.query(
  `insert into credit_note_items (credit_note_id, description, quantity, unit_price, tax_rate_percent, line_total)
   values ($1,'Returned goods','1','500.00','15','500.00')`, [cn]);

const po = (await db.query(
  `insert into purchase_orders (org_id,po_number,vendor_id,order_date,status,subtotal,tax_total,total,paid_amount,
                                base_paid_amount,currency,exchange_rate,base_total,base_tax_amount,created_by_id)
   values ($1,'PO-0007',$2,'2026-07-01','received','500.00','75.00','575.00','0','0','USD','3.75','2156.250','281.250',$3) returning id`,
  [org, vend, uid])).rows[0].id;
const dn = (await db.query(
  `insert into debit_notes (org_id,debit_note_number,vendor_id,source_purchase_order_id,issue_date,status,
                            subtotal,tax_total,total,currency,exchange_rate,base_total,base_tax_amount,created_by_id)
   values ($1,'DN-0002',$2,$3,'2026-08-15','issued','500.00','75.00','575.00','USD','3.75','2156.250','281.250',$4) returning id`,
  [org, vend, po, uid])).rows[0].id;
await db.query(
  `insert into debit_note_items (debit_note_id, description, quantity, unit_cost, tax_rate_percent, line_total)
   values ($1,'Returned goods','1','500.00','15','500.00')`, [dn]);

/**
 * The riyal renders as an INLINE SVG on app pages (`<RiyalSymbol/>`, viewBox 1124.14 1256.39) and
 * as an <img> of the same vector in the printed PDF. Both forms are counted.
 *
 * The first draft matched only `img[src*="sar-symbol"]`. That selector matches nothing at all on an
 * app page, so every "no riyal mark" assertion passed 0 === 0 — vacuously, and would have kept
 * passing with the fix reverted. The NO-REGRESSION check below is what exposed it, by being the one
 * assertion that expected a riyal to be PRESENT. A suite that only ever asserts absence cannot tell
 * you its selector works.
 */
const sarMarks = async () =>
  (await page.locator('svg[viewBox="0 0 1124.14 1256.39"]').count()) +
  (await page.locator('img[src*="sar-symbol"]').count());
const bodyText = async () => (await page.locator("body").innerText());

for (const [label, url] of [
  ["CREDIT NOTE detail", `${BASE}/sales/credit-notes/${cn}`],
  ["DEBIT NOTE detail", `${BASE}/purchasing/debit-notes/${dn}`],
  ["CREDIT NOTE pdf", `${BASE}/print/credit-note/${cn}`],
  ["DEBIT NOTE pdf", `${BASE}/print/debit-note/${dn}`],
]) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const text = await bodyText();
  const sar = await sarMarks();
  check(`${label}: renders the SOURCE document's currency — a dollar sign is present`,
    text.includes("$"), text.replace(/\n/g, " ").slice(0, 120));
  check(`${label}: …and NO riyal mark anywhere — the figures are not the org's base currency`,
    sar === 0, `${sar} SAR symbol asset(s)`);
  check(`${label}: the figures themselves are the note's own 575 / 75`,
    /575/.test(text) && /75/.test(text), text.replace(/\n/g, " ").slice(0, 120));
}

// ARABIC — the same page rendered for real, not an assertion made against an English render.
await ctx.addCookies([{ name: "locale", value: "ar", url: BASE }]);
for (const [label, url] of [
  ["CREDIT NOTE detail (ar)", `${BASE}/sales/credit-notes/${cn}`],
  ["DEBIT NOTE detail (ar)", `${BASE}/purchasing/debit-notes/${dn}`],
]) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const text = await bodyText();
  check(`${label}: is actually Arabic, not an English fallback`, /[؀-ۿ]/.test(text), text.slice(0, 60));
  check(`${label}: still renders the source currency, not the org base`,
    text.includes("$") && (await sarMarks()) === 0, `${await sarMarks()} riyal marks`);
}
await ctx.addCookies([{ name: "locale", value: "en", url: BASE }]);

// A BASE-CURRENCY note must be unaffected — the riyal is correct there and must still appear.
const invSar = (await db.query(
  `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,subtotal,tax_total,total,paid_amount,
                               base_paid_amount,created_by_id)
   values ($1,'INV-SAR',$2,'2026-07-01','sent','500.00','75.00','575.00','0','0',$3) returning id`,
  [org, cust, uid])).rows[0].id;
const cnSar = (await db.query(
  `insert into credit_notes (org_id,credit_note_number,customer_id,source_invoice_id,issue_date,status,
                             subtotal,tax_total,total,created_by_id)
   values ($1,'CN-SAR',$2,$3,'2026-08-15','issued','500.00','75.00','575.00',$4) returning id`,
  [org, cust, invSar, uid])).rows[0].id;
await db.query(
  `insert into credit_note_items (credit_note_id, description, quantity, unit_price, tax_rate_percent, line_total)
   values ($1,'Returned goods','1','500.00','15','500.00')`, [cnSar]);
await page.goto(`${BASE}/sales/credit-notes/${cnSar}`, { waitUntil: "networkidle" });
await page.waitForTimeout(400);
check("NO REGRESSION: a base-currency credit note still renders the riyal", (await sarMarks()) > 0,
  `${await sarMarks()} riyal marks`);
check("…and shows no dollar sign", !(await bodyText()).includes("$"));

await db.end();
await browser.close();
console.log("\nCredit / debit notes render in the SOURCE document's currency\n");
for (const [ok, name, extra] of results) console.log(`${ok ? "  ✓" : "  ✗ FAIL"} ${name}${extra ? `  << ${extra}` : ""}`);
const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks`);
console.log(failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
