/**
 * FX-8, the dashboard's data-quality banner — the browser half of verify-fx-reporting.mts (which
 * proves the query figures against hand-computed values; this file proves the WARNING is really
 * visible and actionable, and really absent when the data is clean).
 *
 *  - A seeded null-base posted invoice + PO make the banner render, naming the total count and
 *    linking each family to its list page — an actionable warning, never a total quietly short.
 *  - A DRAFT with null base columns does not move the count (by design, not bad data).
 *  - A clean org shows no banner at all.
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

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await assertFreshBuild(BASE);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
ctx.setDefaultTimeout(45000);
ctx.setDefaultNavigationTimeout(60000);
const page = await ctx.newPage();
const email = `fxd_${uniq()}@t.dev`;

await page.goto(`${BASE}/register`);
await page.fill('input[name="orgName"]', "FX Dashboard Co");
await page.fill('input[name="name"]', "Owner");
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', pass);
const cf = page.locator('input[name="confirmPassword"]');
if (await cf.count()) await cf.fill(pass);
await pickCountry(page);
await page.getByRole("button", { name: /register|create|sign up/i }).first().click();
await page.waitForURL(/\/dashboard/, { timeout: 40000 });
const u = (await db.query("select id, org_id from users where email=$1", [email])).rows[0];
const cust = (await db.query("insert into customers (org_id,name) values ($1,'C') returning id", [u.org_id])).rows[0].id;
const vend = (await db.query("insert into vendors (org_id,name) values ($1,'V') returning id", [u.org_id])).rows[0].id;

// ---- clean org: no banner ----
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
check("a clean org shows NO data-quality banner", (await page.getByTestId("base-data-quality").count()) === 0);

// ---- seed the bad rows (posted foreign, no stored conversion) plus a draft that must not count ----
const today = new Date().toISOString().slice(0, 10);
await db.query(
  `insert into sales_invoices (org_id, invoice_number, customer_id, issue_date, due_date, subtotal, discount, tax_total, total, currency, status, created_by_id)
   values ($1,$2,$3,$4,$4,'800','0','0','800','USD','sent',$5), ($1,$6,$3,$4,$4,'999','0','0','999','USD','draft',$5)`,
  [u.org_id, `FXD-${uniq()}`, cust, today, u.id, `FXD-${uniq()}`]);
await db.query(
  `insert into purchase_orders (org_id, po_number, vendor_id, order_date, subtotal, discount, tax_total, total, currency, status, created_by_id)
   values ($1,$2,$3,$4,'600','0','0','600','GBP','received',$5)`, [u.org_id, `FXDP-${uniq()}`, vend, today, u.id]);

await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
const banner = page.getByTestId("base-data-quality");
check("the banner renders for seeded null-base rows", (await banner.count()) === 1);
const text = (await banner.innerText().catch(() => "")).replace(/\s+/g, " ");
check("…naming the TOTAL count (2), the draft not among them", /\b2\b.*missing exchange rate/i.test(text), text);
check("…with an actionable link to the 1 invoice", (await banner.getByRole("link", { name: /1 invoices/ }).count()) === 1);
check("…and to the 1 purchase order", (await banner.getByRole("link", { name: /1 purchase orders/ }).count()) === 1);
check("the invoice link goes to the invoices list",
  (await banner.getByRole("link", { name: /1 invoices/ }).getAttribute("href")) === "/sales/invoices");

await db.end();
await browser.close();
let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "FX DASHBOARD PASS" : "FX DASHBOARD FAIL");
process.exit(ok ? 0 : 1);
