/**
 * Task 5. Two things have to be true at once, and the second is the one that could quietly break:
 *
 *   1. The bank block is gone from the delivery challan's create form, edit form, preview and PDF.
 *   2. A challan saved BEFORE this change — one that still carries a bank_accounts snapshot in the
 *      column — still renders everywhere instead of erroring. The column was kept and neither write
 *      path clears it, so this seeds a row with a real snapshot and then loads every surface.
 *
 * Plus a regression side: the other seven types must still show their bank block, since they share
 * the helper modules the challan stopped importing.
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const email = `dc_${Math.random().toString(36).slice(2, 8)}@t.dev`;
const results = [];
const check = (name, cond, extra = "") => results.push([cond, name, extra]);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

// Refuse to run against a build other than the one on disk — see assert-fresh-build.mjs.
await assertFreshBuild(BASE);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
ctx.setDefaultTimeout(45000);
ctx.setDefaultNavigationTimeout(60000);
const page = await ctx.newPage();
page.on("dialog", (d) => d.accept());

await page.goto(`${BASE}/register`);
await page.fill('input[name="orgName"]', "Challan Co");
await page.fill('input[name="name"]', "Owner");
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', pass);
const cf = page.locator('input[name="confirmPassword"]');
if (await cf.count()) await cf.fill(pass);
// Registration requires a country as of FX-1a; the currency follows it.
await pickCountry(page);
await page.getByRole("button", { name: /register|create|sign up/i }).first().click();
await page.waitForURL(/\/dashboard/, { timeout: 40000 });

const org = (await db.query("select org_id from users where email=$1", [email])).rows[0].org_id;
const uid = (await db.query("select id from users where email=$1", [email])).rows[0].id;
const cust = (await db.query("insert into customers (org_id,name) values ($1,'ABC Trading') returning id", [org])).rows[0].id;
const prod = (await db.query(
  `insert into products (org_id,name,sku,unit_price,quantity_on_hand) values ($1,'LED Panel','LED-1','500','20') returning id`, [org])).rows[0].id;

// A bank account exists in the org, so "no block" cannot pass merely because there is nothing to show.
const gl = (await db.query(`select id from accounts where org_id=$1 and code='1000'`, [org])).rows[0].id;
await db.query(
  `insert into bank_accounts (org_id,name,bank_name,account_number_masked,gl_account_id,opening_balance,iban,swift)
   values ($1,'Operating Account','Al Rajhi Bank','****4417',$2,'0','SA0380000000608010167519','RJHISARI')`, [org, gl]);
const bankCount = (await db.query(`select count(*)::int n from bank_accounts where org_id=$1`, [org])).rows[0].n;
check("the org HAS a bank account, so an empty block would be a real removal not an empty state", bankCount > 0, `n=${bankCount}`);

const BANK_RX = /Bank Account|Al Rajhi|4417/i;

// ---- 1. CREATE form ----
await page.goto(`${BASE}/sales/delivery-challans/new`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
const createText = await page.locator("main").innerText();
check("create form shows no bank block", !BANK_RX.test(createText), createText.match(BANK_RX)?.[0] ?? "");

// The preview is generated from the same form state, so it is a separate surface worth asserting.
const previewBtn = page.getByRole("button", { name: /^preview$/i }).first();
if (await previewBtn.count()) {
  await previewBtn.click();
  await page.waitForTimeout(900);
  const dlg = page.locator('[role="dialog"]').last();
  const previewText = await dlg.innerText().catch(() => "");
  check("preview dialog shows no bank block", !BANK_RX.test(previewText), previewText.match(BANK_RX)?.[0] ?? "");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
} else {
  check("preview dialog shows no bank block", false, "Preview button not found");
}

// ---- 2. A challan saved BEFORE this change, snapshot still in the column ----
const legacySnapshot = JSON.stringify([
  { name: "Operating Account", bankName: "Al Rajhi Bank", accountNumberMasked: "****4417", iban: "SA0380000000608010167519", swift: "RJHISARI" },
]);
const oldDc = (await db.query(
  `insert into delivery_challans (org_id,dc_number,customer_id,status,dispatch_date,carrier,vehicle_no,bank_accounts,created_by_id)
   values ($1,'DC-LEGACY',$2,'draft','2026-01-05','Aramex','ABC-1234',$3::jsonb,$4) returning id`,
  [org, cust, legacySnapshot, uid])).rows[0].id;
await db.query(
  `insert into delivery_challan_items (delivery_challan_id,product_id,description,quantity) values ($1,$2,'LED Panel','3')`,
  [oldDc, prod]);

const stored = (await db.query(`select bank_accounts from delivery_challans where id=$1`, [oldDc])).rows[0].bank_accounts;
check("seeded a legacy challan that really does carry a stored bank snapshot", Array.isArray(stored) && stored.length === 1, JSON.stringify(stored)?.slice(0, 60));

const detailRes = await page.goto(`${BASE}/sales/delivery-challans/${oldDc}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(900);
check("legacy challan's detail page still renders (HTTP 200, no crash)", detailRes.status() === 200, `HTTP ${detailRes.status()}`);
const detailText = await page.locator("main").innerText();
check("legacy challan's detail page shows its number, so it really rendered", detailText.includes("DC-LEGACY"));
check("legacy challan's detail page does NOT show the stored bank block", !BANK_RX.test(detailText), detailText.match(BANK_RX)?.[0] ?? "");

// ---- 3. EDIT form for that same legacy challan ----
const editRes = await page.goto(`${BASE}/sales/delivery-challans/${oldDc}/edit`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
check("legacy challan's edit form still opens", editRes.status() === 200 && /\/edit$/.test(new URL(page.url()).pathname), `HTTP ${editRes.status()} ${page.url()}`);
const editText = await page.locator("main").innerText();
check("edit form shows no bank block", !BANK_RX.test(editText), editText.match(BANK_RX)?.[0] ?? "");

// Saving the edit must not destroy the stored snapshot — the column is left alone, not nulled.
await page.getByRole("button", { name: /save/i }).first().click();
await page.waitForTimeout(2500);
const afterEdit = (await db.query(`select bank_accounts, carrier from delivery_challans where id=$1`, [oldDc])).rows[0];
check("editing a legacy challan leaves its stored snapshot intact rather than wiping it",
  Array.isArray(afterEdit.bank_accounts) && afterEdit.bank_accounts.length === 1, JSON.stringify(afterEdit.bank_accounts)?.slice(0, 60));

// ---- 4. PDF ----
const pdfRes = await page.goto(`${BASE}/print/delivery-challan/${oldDc}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
check("legacy challan's PDF view still renders", pdfRes.status() === 200, `HTTP ${pdfRes.status()}`);
const pdfText = await page.locator("body").innerText();
check("PDF shows the challan number, so it really rendered", pdfText.includes("DC-LEGACY"));
check("PDF shows no bank block", !BANK_RX.test(pdfText), pdfText.match(BANK_RX)?.[0] ?? "");

// ---- 5. A newly created challan stores no snapshot at all ----
const freshDc = (await db.query(
  `insert into delivery_challans (org_id,dc_number,customer_id,status,dispatch_date,created_by_id)
   values ($1,'DC-FRESH',$2,'draft','2026-01-06',$3) returning id`, [org, cust, uid])).rows[0].id;
await db.query(`insert into delivery_challan_items (delivery_challan_id,product_id,description,quantity) values ($1,$2,'LED Panel','1')`, [freshDc, prod]);
// Duplicate the legacy one: the copy must not inherit the snapshot either.
await page.goto(`${BASE}/sales/delivery-challans?record=all`, { waitUntil: "domcontentloaded" });
await page.locator("table").first().waitFor();
const dupRow = page.locator("tr", { hasText: "DC-LEGACY" }).first();
await dupRow.locator("button.row-menu-btn, [aria-haspopup='menu']").last().click();
await page.waitForTimeout(400);
const dupItem = page.getByRole("menuitem", { name: "Duplicate", exact: true });
if (await dupItem.count()) {
  await dupItem.click();
  await page.waitForTimeout(600);
  const confirmDlg = page.locator('[role="dialog"]').last();
  if (await confirmDlg.count()) await confirmDlg.getByRole("button", { name: /duplicate/i }).last().click();
  await page.waitForTimeout(2500);
  const copies = (await db.query(
    `select bank_accounts from delivery_challans where org_id=$1 and id not in ($2,$3)`, [org, oldDc, freshDc])).rows;
  check("duplicating a legacy challan does not carry its bank snapshot into the copy",
    copies.length > 0 && copies.every((r) => r.bank_accounts === null || (Array.isArray(r.bank_accounts) && r.bank_accounts.length === 0)),
    `copies=${copies.length} ${JSON.stringify(copies[0]?.bank_accounts)}`);
} else {
  check("duplicating a legacy challan does not carry its bank snapshot into the copy", false, "Duplicate menu item not found");
}

// ---- 6. Regression: the other seven types still have their bank block ----
for (const [label, path] of [
  ["Quotation", "/sales/quotations/new"],
  ["Sales Order", "/sales/orders/new"],
  ["Proforma", "/sales/proforma/new"],
  ["Invoice", "/sales/invoices/new"],
  ["Credit Note", "/sales/credit-notes/new"],
  ["Purchase Order", "/purchasing/orders/new"],
  ["Debit Note", "/purchasing/debit-notes/new"],
]) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const txt = await page.locator("main").innerText();
  check(`${label} still offers bank account selection`, /Bank Account/i.test(txt), path);
}

await db.end();
await browser.close();
let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "DC BANK REMOVAL VERIFICATION PASS" : "DC BANK REMOVAL VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
