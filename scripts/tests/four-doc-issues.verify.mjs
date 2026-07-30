// Live verification for the "Fix Four Document Issues" task.
//  1. VAT Settings opens the full form in an in-page popup (no redirect) and saves.
//  2. Removing a note also hides its editor + toolbar and restores "Add Note".
//  3. Currency selector shows the full catalog; selected currency persists after save + reload.
//  4. Valid Till remembers the days offset + auto-recalculates; Sales Invoice has no Due Date.
// Run: node scripts/tests/four-doc-issues.verify.mjs   (production server on :3000)
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
const addDays = (iso, d) => { const x = new Date(iso + "T00:00:00"); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };

async function main() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });

  const email = `fdi_${uniq()}@test.dev`;
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await page.fill("#orgName", `FDI Org ${uniq()}`);
  await page.fill("#name", "FDI Owner");
  await page.fill("#email", email);
  await page.fill("#password", `Zx9$mQ${uniq()}vK!ray`);
  await Promise.all([page.waitForURL(`${BASE}/dashboard`, { timeout: 20000 }), page.click('button[type="submit"]')]);
  const { rows: orgRows } = await pool.query("select org_id from users where email=$1", [email]);
  const orgId = orgRows[0].org_id;
  await pool.query("insert into customers (org_id, name, address) values ($1,$2,$3)", [orgId, "Acme Co", "1 King Rd"]);
  await pool.query("insert into products (org_id, name, sku, unit_price, tax_rate_percent) values ($1,$2,$3,$4,$5)", [orgId, "Widget", "W-1", "100", "15"]);

  console.log("\n== Quotation create page ==");
  await page.goto(`${BASE}/sales/quotations/new`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  // ---- Issue 4a: Valid Till auto-calc + remember days ----
  console.log("\n== Issue 4: Valid Till ==");
  const issueInput = page.locator('input[type="date"]').first();
  const validInput = page.locator('input[type="date"]').nth(1);
  const issue1 = await issueInput.inputValue();
  ok("Valid Till auto = Issue + 30 (default)", (await validInput.inputValue()) === addDays(issue1, 30));
  // open the Valid Till gear, set 15 days
  await page.locator(".doc-gear-btn").last().click();
  await page.waitForTimeout(200);
  await page.fill("#vd-days", "15");
  await page.getByRole("button", { name: /^Apply$/ }).click();
  await page.waitForTimeout(600);
  ok("Valid Till recomputed to Issue + 15 after Apply", (await validInput.inputValue()) === addDays(issue1, 15));
  const { rows: vd } = await pool.query("select default_validity_days from orgs where id=$1", [orgId]);
  ok("15 days remembered on the org", vd[0].default_validity_days === 15);
  // change the issue date → valid till recalculates from the remembered 15 days
  const newIssue = "2026-08-01";
  await issueInput.fill(newIssue);
  await page.waitForTimeout(300);
  ok("Valid Till recalculates when Issue Date changes", (await validInput.inputValue()) === addDays(newIssue, 15));

  // ---- Issue 1: VAT Settings popup (no redirect) ----
  console.log("\n== Issue 1: VAT Settings popup ==");
  await page.getByRole("button", { name: /VAT Settings/ }).first().click();
  await page.waitForTimeout(300);
  ok("VAT popup shows Registration Status", (await page.locator("#vat-status").count()) === 1);
  ok("VAT popup shows VAT Number field", (await page.locator("#vat-number").count()) === 1);
  ok("VAT popup shows Save Changes", (await page.getByRole("button", { name: /Save Changes/ }).count()) >= 1);
  ok("NO redirect — still on quotation create", page.url().includes("/sales/quotations/new"));
  await page.fill("#vat-number", "VAT-TEST-9911");
  await page.getByRole("button", { name: /Save Changes/ }).click();
  await page.waitForTimeout(900);
  ok("VAT popup closed after save", (await page.locator("#vat-number").count()) === 0);
  ok("still on quotation create after save (no redirect)", page.url().includes("/sales/quotations/new"));
  const { rows: vn } = await pool.query("select vat_number from orgs where id=$1", [orgId]);
  ok("VAT Number saved via the shared action", vn[0].vat_number === "VAT-TEST-9911");

  // ---- Issue 2: Note remove hides toolbar ----
  console.log("\n== Issue 2: Note remove ==");
  await page.getByRole("button", { name: /^Add Note$/ }).first().click(); // the "Add Note" tab
  await page.waitForTimeout(200);
  // empty state → the add-note button (a doc-pill-btn) opens the editor
  const addNoteBtn = page.locator("button.doc-pill-btn", { hasText: "Add Note" });
  ok("Add Note affordance shown (no editor yet)", (await addNoteBtn.count()) >= 1);
  await addNoteBtn.first().click();
  await page.waitForTimeout(200);
  ok("note editor + toolbar visible after Add Note", (await page.locator(".rte-toolbar").count()) >= 1);
  await page.locator(".rte-editable").first().fill("Payment due in 30 days");
  await page.waitForTimeout(150);
  // remove the note
  await page.getByRole("button", { name: "Remove note" }).click();
  await page.waitForTimeout(300);
  ok("toolbar hidden after removing note", (await page.locator(".rte-toolbar").count()) === 0);
  ok("Add Note affordance restored", (await page.locator("button.doc-pill-btn", { hasText: "Add Note" }).count()) >= 1);

  // ---- Issue 3: Currency selector (full catalog) + persistence ----
  console.log("\n== Issue 3: Currency ==");
  await page.getByRole("button", { name: /Currency/ }).first().click();
  await page.waitForTimeout(300);
  // open the searchable select inside the dialog
  await page.getByRole("button", { name: "Currency" }).click(); // the SearchableSelect trigger (aria-label Currency)
  await page.waitForTimeout(200);
  await page.getByPlaceholder(/Search country/).fill("United States");
  await page.waitForTimeout(300);
  ok("currency search finds USD (catalog beyond SAR)", (await page.getByRole("button", { name: /USD/ }).count()) >= 1);
  await page.getByRole("button", { name: /USD/ }).first().click();
  await page.waitForTimeout(400);
  ok("Currency pill now shows USD", (await page.getByText("USD", { exact: false }).count()) >= 1);

  // fill client + one line item, save draft
  await page.locator(".party-card-v2").getByRole("button", { name: "To Client" }).click();
  await page.getByRole("button", { name: /Acme Co/ }).click();
  const row = page.locator(".doc-items-table .item-row").first();
  await row.getByPlaceholder("Item name").fill("Widget");
  const nums = row.locator("input[type=number]");
  await nums.nth(1).fill("2");
  await nums.nth(2).fill("100");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /Save as Draft/i }).first().click();
  await page.waitForURL(/\/sales\/quotations\/\d+$/, { timeout: 20000 });
  const quoteId = Number(page.url().match(/\/(\d+)$/)[1]);
  const { rows: cur } = await pool.query("select currency, valid_until, issue_date from quotations where id=$1", [quoteId]);
  ok("selected currency saved with the document (USD)", cur[0].currency === "USD");
  ok("Valid Till saved = Issue + 15 days", cur[0].valid_until && cur[0].valid_until.toISOString().slice(0, 10) === addDays(cur[0].issue_date.toISOString().slice(0, 10), 15));
  // reload detail → currency persists. USD renders as its "$" symbol (the org base SAR is an SVG
  // asset with no "$"), so the presence of "$" proves the document's USD mark is applied.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const body = await page.locator("body").innerText();
  ok("detail page renders the USD ($) symbol after reload", body.includes("$"));

  // ---- Issue 4b: Sales Invoice has no Due Date ----
  console.log("\n== Issue 4: Sales Invoice — no Due Date ==");
  await page.goto(`${BASE}/sales/invoices/new`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  ok("Invoice create shows Issue Date", (await page.getByText("Issue Date", { exact: false }).count()) >= 1);
  ok("Invoice create has NO Due Date field", (await page.getByText("Due Date", { exact: false }).count()) === 0);

  await page.screenshot({ path: `${SHOT}/four_issues.png` });
  await browser.close();
  await pool.end();
  console.log(`\n${fail === 0 ? "ALL PASSED" : fail + " CHECK(S) FAILED"}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
