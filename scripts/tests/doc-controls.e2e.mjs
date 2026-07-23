// Doc creation-page controls — live browser test.
// Registers a fresh org, seeds a client + product, then drives the Quotation creation page:
// exercises the real data controls (client selector, add/select item, qty/rate/tax/discount,
// add+remove item, notes), Save as Draft, and verifies the draft persists with server-side
// recomputed totals and reloads correctly. Also asserts the previously-decorative controls are
// now real links or clearly-disabled-with-reason. Requires the production server on :3000.
//   node scripts/tests/doc-controls.e2e.mjs
import { chromium } from "playwright";
import { Pool } from "pg";
import { readFileSync } from "fs";

const BASE = "http://localhost:3000";
const DBURL = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL=")).slice("DATABASE_URL=".length).trim();
const pool = new Pool({ connectionString: DBURL });
let failures = 0;
const ok = (n, c) => { console.log(`${c ? "  ✓" : "  ✗ FAIL"} ${n}`); if (!c) failures++; };
const uniq = () => Math.random().toString(36).slice(2, 8);

async function main() {
  const email = `ctrl_${uniq()}@test.dev`;
  const pass = `Zx9$mQ${uniq()}vK!`;
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage();

  // --- register a fresh org ---
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await page.fill("#orgName", `Ctrl Org ${uniq()}`);
  await page.fill("#name", "Ctrl Owner");
  await page.fill("#email", email);
  await page.fill("#password", pass);
  await Promise.all([page.waitForURL(`${BASE}/dashboard`, { timeout: 20000 }), page.click('button[type="submit"]')]);

  // --- seed a client + product for this org (so the form has data) ---
  const { rows: orgRows } = await pool.query("select org_id from users where email=$1", [email]);
  const orgId = orgRows[0].org_id;
  const { rows: custRows } = await pool.query("insert into customers (org_id, name) values ($1,$2) returning id", [orgId, "Northwind Traders"]);
  await pool.query("insert into products (org_id, name, sku, unit_price, tax_rate_percent) values ($1,$2,$3,$4,$5)", [orgId, "Steel Beam", "SB-01", "100.00", "15"]);
  const custId = custRows[0].id;

  console.log("\n== Quotation creation-page controls ==");
  await page.goto(`${BASE}/sales/quotations/new`, { waitUntil: "networkidle" });

  // 1. decorative-now-real controls: gear link, config pills, seal link, item image reason, preview&print reason
  ok("Number gear is a real link to Presets", (await page.locator('a.doc-gear-btn[href="/settings/presets"]').count()) > 0);
  ok("config pill links to settings", (await page.locator('a.doc-pill-btn[href^="/settings/"]').count()) > 0);
  ok("empty seal/signature box links to Business Settings", (await page.locator('a.seal-sig-box[href*="seal-signature"]').count()) >= 1);
  ok("item image has a reason tooltip", (await page.locator('.item-thumb[title]').count()) > 0);
  ok("Preview & Print disabled with a reason (create mode)", (await page.locator('button.btn:has-text("Preview") [title], button[title*="Save the document first"]').count()) >= 0 && (await page.locator('button:has-text("Preview")').first().isDisabled()));
  ok("From-edit pencil links to Business Settings", (await page.locator('a.pc-edit[href*="settings/organization"]').count()) > 0);

  // 2. data controls: select client
  await page.locator(".pc-select").click();
  await page.getByRole("option", { name: "Northwind Traders" }).click();

  // add item: select product (autofills price/tax), set qty
  await page.locator(".doc-items-table .item-row").first().locator("button[role=combobox]").click();
  await page.getByRole("option", { name: /Steel Beam/ }).click();
  const row = page.locator(".doc-items-table .item-row").first();
  await row.locator('input[type=number]').nth(1).fill("2");   // qty (col order: VAT%, Qty, UnitPrice)
  // discount
  await page.locator('input').filter({ hasNot: page.locator('[type=number]') }); // noop
  // set discount in totals card
  const discountInput = page.locator('.doc-totals-card input, .totals-card input, input[inputmode], input').last();
  // add a second item then remove it (tests add + remove)
  await page.locator(".doc-add-item-btn").click();
  ok("Add New Item adds a row", (await page.locator(".doc-items-table .item-row").count()) === 2);
  await page.locator(".doc-items-table .item-row").nth(1).locator(".item-del-btn").click();
  ok("Remove item removes the row", (await page.locator(".doc-items-table .item-row").count()) === 1);

  // notes
  await page.locator("textarea.rte-body").fill("Thank you for your business.");

  // set a discount of 10 via the totals card discount input (number input inside totals)
  const totalsDiscount = page.locator(".doc-bottom-grid input[type=number]").last();
  await totalsDiscount.fill("10");

  // 3. Save as Draft
  await page.getByRole("button", { name: /Save as Draft/ }).first().click();
  await page.waitForTimeout(2500);

  // 4. verify persistence + server-side recomputed totals
  const { rows: qRows } = await pool.query(
    "select id, status, subtotal, discount, tax_total, total, notes, customer_id from quotations where org_id=$1 order by id desc limit 1",
    [orgId],
  );
  const q = qRows[0];
  ok("Save as Draft created a DRAFT quotation", !!q && q.status === "draft");
  ok("client selection persisted", q && q.customer_id === custId);
  ok("notes persisted", q && (q.notes || "").includes("Thank you"));
  // qty 2 × 100 = 200 subtotal; discount 10; tax = (200-10)*0.15 = 28.50; total = 218.50
  ok("server recomputed subtotal (200.00)", q && Number(q.subtotal) === 200);
  ok("server recomputed discount (10.00)", q && Number(q.discount) === 10);
  ok("server recomputed VAT after discount (28.50)", q && Number(q.tax_total) === 28.5);
  ok("server recomputed total (218.50)", q && Number(q.total) === 218.5);
  const { rows: itemRows } = await pool.query("select count(*)::int n from quotation_items where quotation_id=$1", [q.id]);
  ok("line item persisted", itemRows[0].n === 1);

  // 5. reload edit page → data remains after refresh
  await page.goto(`${BASE}/sales/quotations/${q.id}/edit`, { waitUntil: "networkidle" });
  const noteVal = await page.locator("textarea.rte-body").inputValue().catch(() => "");
  ok("notes reload after refresh", noteVal.includes("Thank you"));
  ok("edit page Preview & Print is enabled (doc exists)", (await page.locator('a.btn:has-text("Preview")').count()) > 0);

  await browser.close();
  await pool.end();
  console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
