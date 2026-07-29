// Live verification for Number Format (Issue #5). Registers a fresh org, configures Number Format
// via Business Settings (Indian grouping, 3 decimals, round quantities, custom symbol), seeds an
// invoice with fractional line values, then checks the detail page + print page render the numbers
// with the chosen format — and that the STORED database values are unchanged. Screenshots included.
// Run: node scripts/tests/number-format.verify.mjs   (production server must be on :3000)
import { chromium } from "playwright";
import { Pool } from "pg";
import { readFileSync } from "fs";

const BASE = "http://localhost:3000";
const SHOT = "/tmp/claude-0/-home-user-Exhibition-Lead-Pro/762bdf67-a9fd-5562-88ca-0fa1fa890980/scratchpad";
const DBURL = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL=")).slice("DATABASE_URL=".length).trim();
const pool = new Pool({ connectionString: DBURL });
let fail = 0;
const ok = (n, c) => { console.log(`${c ? "  ✓" : "  ✗ FAIL"} ${n}`); if (!c) fail++; };
const uniq = () => Math.random().toString(36).slice(2, 8);

async function main() {
  const email = `nf_${uniq()}@test.dev`;
  const pw = `Zx9$mQ${uniq()}vK!ray`;
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await page.fill("#orgName", `NF Org ${uniq()}`);
  await page.fill("#name", "NF Owner");
  await page.fill("#email", email);
  await page.fill("#password", pw);
  await Promise.all([page.waitForURL(`${BASE}/dashboard`, { timeout: 20000 }), page.click('button[type="submit"]')]);

  const { rows: orgRows } = await pool.query("select org_id from users where email=$1", [email]);
  const orgId = orgRows[0].org_id;

  // ---- 1. Configure Number Format via the Business Settings popup ----
  console.log("\n== Number Format settings ==");
  await page.goto(`${BASE}/settings/organization?tab=number-format`, { waitUntil: "networkidle" });
  ok("Number Format panel visible", (await page.locator("#nf-grouping").count()) === 1);
  ok("live preview present", (await page.getByText("Live Preview").count()) >= 1);
  // grouping → Indian
  await page.locator("#nf-grouping").click();
  await page.getByRole("option", { name: /Indian/ }).click();
  // decimals → 3
  await page.locator("#nf-decimals").click();
  await page.getByRole("option", { name: "3", exact: true }).click();
  // round quantities on
  await page.getByText("Round quantities to whole numbers").click();
  // custom symbol
  await page.fill("#nf-symbol", "৳x");
  await page.waitForTimeout(150);
  // preview should now show Indian grouping + custom symbol
  ok("live preview shows Indian grouping (1,23,45,679)", /1,23,45,6/.test(await page.locator("body").innerText()));
  await page.screenshot({ path: `${SHOT}/nf_settings.png` });
  await page.getByRole("button", { name: /Save Changes/ }).click();
  await page.waitForTimeout(600);

  const { rows: cfgRows } = await pool.query(
    "select number_digit_grouping, number_decimal_places, round_quantities, round_rates, custom_currency_symbol from orgs where id=$1",
    [orgId],
  );
  const cfg = cfgRows[0];
  ok("saved: grouping=indian", cfg.number_digit_grouping === "indian");
  ok("saved: decimals=3", cfg.number_decimal_places === 3);
  ok("saved: round_quantities=true", cfg.round_quantities === true);
  ok("saved: custom symbol persisted", cfg.custom_currency_symbol === "৳x");

  // ---- 2. Seed a client + invoice with fractional line values ----
  const { rows: uRows } = await pool.query("select id from users where email=$1", [email]);
  const userId = uRows[0].id;
  const { rows: cust } = await pool.query("insert into customers (org_id, name) values ($1,$2) returning id", [orgId, "NF Client"]);
  const custId = cust[0].id;
  // Line: qty 12.5 @ 987654.321 → amount 12,345,679.0125 ; vat 15% ; keep simple stored numbers.
  const qty = "12.5", rate = "987654.321";
  const amount = 12.5 * 987654.321;                 // 12,345,679.0125
  const taxTotal = amount * 0.15;
  const total = amount + taxTotal;
  const { rows: inv } = await pool.query(
    `insert into sales_invoices (org_id, invoice_number, customer_id, created_by_id, status, issue_date, subtotal, tax_total, total, discount, paid_amount)
     values ($1,$2,$3,$4,'sent',current_date,$5,$6,$7,'0','0') returning id`,
    [orgId, `NF-INV-${uniq()}`, custId, userId, String(amount), String(taxTotal), String(total)],
  );
  const invId = inv[0].id;
  await pool.query(
    `insert into sales_invoice_items (invoice_id, description, quantity, unit_price, tax_rate_percent, line_total)
     values ($1,$2,$3,$4,'15',$5)`,
    [invId, "Widget", qty, rate, String(amount)],
  );

  // ---- 3. Detail page reflects the format ----
  console.log("\n== Invoice detail display ==");
  await page.goto(`${BASE}/sales/invoices/${invId}`, { waitUntil: "networkidle" });
  const body = await page.locator("body").innerText();
  ok("detail: custom symbol ৳x shown", body.includes("৳x"));
  ok("detail: Indian-grouped 3-decimal total (1,23,45,679.xxx)", /1,23,45,679\.\d{3}/.test(body) || /1,42,04,\d{2}\.\d{3}/.test(body));
  ok("detail: quantity rounded to 13 (from 12.5)", /(^|\D)13(\D|$)/.test(body));
  // unit_price column is numeric(_,2) so 987654.321 stores as 987654.32; displayed at 3 decimals.
  ok("detail: rate uses Indian grouping + 3 decimals", /9,87,654\.32\d/.test(body));
  await page.screenshot({ path: `${SHOT}/nf_detail.png`, fullPage: true });

  // ---- 4. Print page reflects the format ----
  console.log("\n== Print display ==");
  await page.goto(`${BASE}/print/invoice/${invId}`, { waitUntil: "networkidle" });
  const pbody = await page.locator("body").innerText();
  ok("print: custom symbol ৳x shown", pbody.includes("৳x"));
  ok("print: rate Indian-grouped 3-decimal (9,87,654.32x)", /9,87,654\.32\d/.test(pbody));
  ok("print: quantity rounded to 13", /(^|\D)13(\D|$)/.test(pbody));
  await page.screenshot({ path: `${SHOT}/nf_print.png`, fullPage: true });

  // ---- 5. Stored DB values are UNCHANGED (display-only rounding/format) ----
  console.log("\n== Database values unchanged ==");
  // The key guarantee: display rounding (round quantities) NEVER mutates stored values. Quantity is
  // stored to full precision (12.5, not 13). Rate/total keep the column's own numeric(_,2) precision
  // — the Number Format setting neither changed them nor recalculated them.
  const { rows: itemRows } = await pool.query("select quantity, unit_price, line_total from sales_invoice_items where invoice_id=$1", [invId]);
  ok("stored quantity still 12.5 (not rounded by display setting)", Number(itemRows[0].quantity) === 12.5);
  ok("stored unit_price unchanged (column precision)", Number(itemRows[0].unit_price) === Number(Number(rate).toFixed(2)));
  const { rows: invRows } = await pool.query("select total from sales_invoices where id=$1", [invId]);
  ok("stored total unchanged", Number(invRows[0].total) === Number(total.toFixed(2)));

  await browser.close();
  await pool.end();
  console.log(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
