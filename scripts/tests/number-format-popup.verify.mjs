// Live verification for the in-document Number Format popup (Issue: full popup in document creation).
// Registers an org, opens a Quotation create page, enters unsaved data (client + line item), opens
// the Number Format pill → full form appears in-place (no "Open Full Settings" link), changes the
// format, saves; the popup closes, displayed amounts reformat immediately, and the unsaved line item
// is preserved. Persistence is re-checked after a reload.
// Run: node scripts/tests/number-format-popup.verify.mjs   (production server on :3000)
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
  const email = `nfp_${uniq()}@test.dev`;
  const pw = `Zx9$mQ${uniq()}vK!ray`;
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });

  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await page.fill("#orgName", `NFP Org ${uniq()}`);
  await page.fill("#name", "NFP Owner");
  await page.fill("#email", email);
  await page.fill("#password", pw);
  await Promise.all([page.waitForURL(`${BASE}/dashboard`, { timeout: 20000 }), page.click('button[type="submit"]')]);

  const { rows: orgRows } = await pool.query("select org_id from users where email=$1", [email]);
  const orgId = orgRows[0].org_id;
  await pool.query("insert into customers (org_id, name) values ($1,$2)", [orgId, "Popup Client"]);
  await pool.query("insert into products (org_id, name, sku, unit_price, tax_rate_percent) values ($1,$2,$3,$4,$5)", [orgId, "Big Widget", "BW-1", "4111111.11", "15"]);

  // ---- open Quotation create, enter unsaved data (type directly into the line-item row) ----
  console.log("\n== Document create page ==");
  await page.goto(`${BASE}/sales/quotations/new`, { waitUntil: "networkidle" });
  const row = page.locator(".doc-items-table .item-row").first();
  await row.getByPlaceholder("Item name").fill("Big Widget"); // item name (text input)
  const nums = row.locator('input[type=number]');
  await nums.nth(1).fill("3"); // qty  (order in full row: VAT%, Qty, UnitPrice)
  await nums.nth(2).fill("4111111"); // unit price
  await page.keyboard.press("Tab");
  await page.waitForTimeout(300);
  const itemNameBefore = await row.getByPlaceholder("Item name").inputValue();
  ok("unsaved line item entered (Big Widget)", /Big Widget/i.test(itemNameBefore));

  // ---- open the Number Format pill → full form appears in-place ----
  console.log("\n== Number Format popup ==");
  await page.getByRole("button", { name: /Number Format/ }).first().click();
  await page.waitForTimeout(300);
  ok("popup shows Digit Grouping select", (await page.locator("#nf-grouping").count()) === 1);
  ok("popup shows Decimal Places select", (await page.locator("#nf-decimals").count()) === 1);
  ok("popup shows custom symbol field", (await page.locator("#nf-symbol").count()) === 1);
  ok("popup shows Live Preview", (await page.getByText("Live Preview").count()) >= 1);
  ok("popup shows Save Changes", (await page.getByRole("button", { name: /Save Changes/ }).count()) >= 1);
  ok("popup shows Cancel", (await page.getByRole("button", { name: /^Cancel$/ }).count()) >= 1);
  ok("NO 'Open Full Settings' link in popup", (await page.getByText(/Open Full Settings/i).count()) === 0);

  // ---- change format + save ----
  await page.locator("#nf-grouping").click();
  await page.getByRole("option", { name: /Indian/ }).click();
  await page.locator("#nf-decimals").click();
  await page.getByRole("option", { name: "0", exact: true }).click();
  await page.fill("#nf-symbol", "€€");
  await page.screenshot({ path: `${SHOT}/nfp_popup.png` });
  await page.getByRole("button", { name: /Save Changes/ }).click();
  await page.waitForTimeout(1200);

  ok("popup closed after save", (await page.locator("#nf-grouping").count()) === 0);

  // ---- displayed amounts reformat immediately + unsaved data preserved ----
  const body = await page.locator("body").innerText();
  ok("displayed amounts use custom symbol €€", body.includes("€€"));
  ok("displayed amounts use Indian grouping + 0 decimals (1,23,33,333)", /1,23,33,333(\D|$)/.test(body));
  const itemNameAfter = await page.locator(".doc-items-table .item-row").first().getByPlaceholder("Item name").inputValue();
  ok("unsaved line item preserved after save", /Big Widget/i.test(itemNameAfter));
  const qtyAfter = await page.locator(".doc-items-table .item-row").first().locator('input[type=number]').nth(1).inputValue();
  ok("unsaved quantity preserved (3)", qtyAfter === "3");
  await page.screenshot({ path: `${SHOT}/nfp_after.png`, fullPage: true });

  // ---- persisted in DB + after reload ----
  console.log("\n== Persistence ==");
  const { rows: cfg } = await pool.query(
    "select number_digit_grouping, number_decimal_places, custom_currency_symbol from orgs where id=$1",
    [orgId],
  );
  ok("saved grouping=indian", cfg[0].number_digit_grouping === "indian");
  ok("saved decimals=0", cfg[0].number_decimal_places === 0);
  ok("saved custom symbol €€", cfg[0].custom_currency_symbol === "€€");

  await page.goto(`${BASE}/sales/quotations/new`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Number Format/ }).first().click();
  await page.waitForTimeout(300);
  const grpVal = await page.locator("#nf-grouping").innerText().catch(() => "");
  ok("reload: popup reflects persisted grouping (Indian)", /Indian/i.test(grpVal));
  const symVal = await page.locator("#nf-symbol").inputValue();
  ok("reload: popup reflects persisted custom symbol", symVal === "€€");

  await browser.close();
  await pool.end();
  console.log(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
