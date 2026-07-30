// Live verification for Bank Account Selection in Documents (Issue #6).
// Registers an org, seeds two bank accounts, sets one as a Preset default, then:
//  - confirms the default auto-appears on a NEW quotation
//  - selects a second account, saves the quotation
//  - confirms both accounts (a SNAPSHOT) show on the detail page
//  - confirms editing the bank master record does NOT change the already-saved snapshot
//  - confirms tenant isolation (a second org sees none of org1's accounts)
//  - confirms selection posts NO payment / journal / balance change (display-only boundary)
// Run: node scripts/tests/bank-accounts-in-documents.verify.mjs   (production server on :3000)
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

async function register(page, tag) {
  const email = `${tag}_${uniq()}@test.dev`;
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await page.fill("#orgName", `${tag} Org ${uniq()}`);
  await page.fill("#name", `${tag} Owner`);
  await page.fill("#email", email);
  await page.fill("#password", `Zx9$mQ${uniq()}vK!ray`);
  await Promise.all([page.waitForURL(`${BASE}/dashboard`, { timeout: 20000 }), page.click('button[type="submit"]')]);
  const { rows } = await pool.query("select org_id from users where email=$1", [email]);
  return rows[0].org_id;
}

// Seed a bank account directly (its GL account is any of the org's seeded accounts).
async function seedBank(orgId, name, fields) {
  const { rows: gl } = await pool.query("select id from accounts where org_id=$1 order by code limit 1", [orgId]);
  const { rows } = await pool.query(
    `insert into bank_accounts (org_id, name, bank_name, account_number_masked, account_holder, iban, swift, currency, branch, gl_account_id, is_active)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true) returning id`,
    [orgId, name, fields.bankName, fields.accountNumberMasked, fields.accountHolder, fields.iban, fields.swift, fields.currency, fields.branch, gl[0].id],
  );
  return rows[0].id;
}

async function main() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });

  console.log("\n== Setup org1 + two bank accounts ==");
  const org1 = await register(page, "bank1");
  await pool.query("insert into customers (org_id, name, address) values ($1,$2,$3)", [org1, "Acme Client", "1 King Rd, Riyadh"]);
  await pool.query("insert into products (org_id, name, sku, unit_price, tax_rate_percent) values ($1,$2,$3,$4,$5)", [org1, "Widget", "W-1", "100", "15"]);
  const bankA = await seedBank(org1, "Operating Account", { bankName: "Al Rajhi Bank", accountNumberMasked: "****1234", accountHolder: "Elite Innovation", iban: "SA0380000000608010167519", swift: "RJHISARI", currency: "SAR", branch: "Olaya" });
  const bankB = await seedBank(org1, "Payroll Account", { bankName: "Saudi National Bank", accountNumberMasked: "****5678", accountHolder: "Elite Innovation", iban: "SA1010000000700000012345", swift: "NCBKSAJE", currency: "SAR", branch: "Riyadh" });

  // ---- Preset Management: set default bank accounts ----
  console.log("\n== Preset Management → Default Bank Accounts ==");
  await page.goto(`${BASE}/settings/presets`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /Default Bank Accounts/i }).click();
  await page.waitForTimeout(300);
  ok("Default Bank Accounts panel visible", (await page.getByText(/These accounts appear automatically on new documents/i).count()) >= 1);
  // add "Operating Account" as default via the add-select
  await page.locator('.doc-note-box').getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Operating Account" }).click();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: /Save Changes/i }).click();
  await page.waitForTimeout(800);
  const { rows: defRows } = await pool.query("select default_bank_account_ids from orgs where id=$1", [org1]);
  ok("preset default persisted (Operating Account)", Array.isArray(defRows[0].default_bank_account_ids) && defRows[0].default_bank_account_ids.includes(bankA));

  // ---- New Quotation: default auto-appears; add second account; save ----
  console.log("\n== New Quotation: default + multi-select ==");
  await page.goto(`${BASE}/sales/quotations/new`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const bankBox = page.locator('.doc-note-box').filter({ hasText: "Bank Accounts" });
  ok("Bank Accounts section renders on create page", (await bankBox.count()) >= 1);
  ok("display-only boundary hint shown", (await page.getByText(/does not record a payment or change any balance/i).count()) >= 1);
  ok("default account auto-appears (Operating Account)", (await page.getByText("Operating Account").count()) >= 1);
  // add the second account
  await bankBox.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Payroll Account" }).click();
  await page.waitForTimeout(300);
  ok("second account added (Payroll Account)", (await page.getByText("Payroll Account").count()) >= 1);
  await page.screenshot({ path: `${SHOT}/bank_create.png` });

  // fill the required doc fields: client (SearchableSelect) + valid-till + one line item
  await page.locator(".party-card-v2").getByRole("button", { name: "To Client" }).click();
  await page.getByRole("button", { name: /Acme Client/ }).click();
  await page.fill('input[type="date"] >> nth=1', "2026-12-31");
  const row = page.locator(".doc-items-table .item-row").first();
  await row.getByPlaceholder("Item name").fill("Widget");
  const nums = row.locator('input[type=number]');
  await nums.nth(1).fill("2");
  await nums.nth(2).fill("100");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(300);
  // Save as Draft
  await page.getByRole("button", { name: /Save as Draft/i }).first().click();
  await page.waitForURL(/\/sales\/quotations\/\d+$/, { timeout: 20000 });
  const quoteId = Number(page.url().match(/\/(\d+)$/)[1]);
  ok("quotation saved (redirect to detail)", Number.isInteger(quoteId));

  // ---- Detail page: both accounts as a stored snapshot, ordered ----
  console.log("\n== Detail page snapshot ==");
  await page.waitForTimeout(400);
  ok("detail shows Bank Details header", (await page.getByText(/Bank Details/i).count()) >= 1);
  ok("detail shows Operating Account", (await page.getByText("Operating Account").count()) >= 1);
  ok("detail shows Payroll Account", (await page.getByText("Payroll Account").count()) >= 1);
  ok("detail shows an IBAN value", (await page.getByText(/SA0380000000608010167519/).count()) >= 1);

  const { rows: snapRows } = await pool.query("select bank_accounts from quotations where id=$1", [quoteId]);
  const snap = snapRows[0].bank_accounts;
  ok("stored jsonb snapshot has 2 accounts in order", Array.isArray(snap) && snap.length === 2 && snap[0].id === bankA && snap[1].id === bankB);
  ok("snapshot captured full fields (swift/branch)", snap[0].swift === "RJHISARI" && snap[1].branch === "Riyadh");

  // ---- Immutability: edit the live bank master → saved doc snapshot unchanged ----
  console.log("\n== Immutability of saved snapshot ==");
  await pool.query("update bank_accounts set name=$1, bank_name=$2 where id=$3", ["RENAMED Operating", "RENAMED BANK", bankA]);
  const { rows: snap2 } = await pool.query("select bank_accounts from quotations where id=$1", [quoteId]);
  ok("saved snapshot NOT changed by editing the bank master", snap2[0].bank_accounts[0].name === "Operating Account" && snap2[0].bank_accounts[0].bankName === "Al Rajhi Bank");

  // ---- Boundary: no payment / no journal entry / no balance change from selecting ----
  console.log("\n== Display-only boundary ==");
  const { rows: pay } = await pool.query("select count(*)::int n from payments where org_id=$1", [org1]);
  ok("no payment rows created", pay[0].n === 0);
  const { rows: je } = await pool.query("select count(*)::int n from journal_entries where org_id=$1 and source_type='payment'", [org1]);
  ok("no payment journal entries created", je[0].n === 0);

  // ---- Tenant isolation: a second org cannot see org1's bank accounts ----
  console.log("\n== Tenant isolation ==");
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page2 = await ctx2.newPage();
  await register(page2, "bank2");
  await page2.goto(`${BASE}/sales/quotations/new`, { waitUntil: "networkidle" });
  await page2.waitForTimeout(400);
  const box2 = page2.locator('.doc-note-box').filter({ hasText: "Bank Accounts" });
  await box2.getByRole("combobox").first().click();
  await page2.waitForTimeout(200);
  ok("org2 does NOT see org1's Operating Account", (await page2.getByRole("option", { name: /Operating Account/ }).count()) === 0);
  ok("org2 does NOT see org1's Payroll Account", (await page2.getByRole("option", { name: /Payroll Account/ }).count()) === 0);

  await ctx2.close();
  await browser.close();
  await pool.end();
  console.log(`\n${fail === 0 ? "ALL PASSED" : fail + " CHECK(S) FAILED"}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
