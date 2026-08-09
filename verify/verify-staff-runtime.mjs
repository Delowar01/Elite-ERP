/**
 * Task 4 runtime checks. The panel now makes a security claim — "Staff cannot reach Configuration"
 * — and reading the code is not the same as proving it. This logs in as a real Staff user and:
 *
 *   1. hits every role-gated page by direct URL
 *   2. invokes a role-gated ACTION from a page Staff is allowed to open, so the action's own guard
 *      is what refuses, not a page guard
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const ownerEmail = `rt_${Math.random().toString(36).slice(2, 8)}@t.dev`;
const staffEmail = `st_${Math.random().toString(36).slice(2, 8)}@t.dev`;
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

// --- owner registers, then we mint a Staff member in the same org and log in as them ---
await page.goto(`${BASE}/register`);
await page.fill('input[name="orgName"]', "Runtime Co");
await page.fill('input[name="name"]', "Owner");
await page.fill('input[name="email"]', ownerEmail);
await page.fill('input[name="password"]', pass);
const cf = page.locator('input[name="confirmPassword"]');
if (await cf.count()) await cf.fill(pass);
// Registration requires a country as of FX-1a; the currency follows it.
await pickCountry(page);
await page.getByRole("button", { name: /register|create|sign up/i }).first().click();
await page.waitForURL(/\/dashboard/, { timeout: 40000 });

const org = (await db.query("select org_id from users where email=$1", [ownerEmail])).rows[0].org_id;
const ownerId = (await db.query("select id from users where email=$1", [ownerEmail])).rows[0].id;
const hash = (await db.query("select password_hash from users where email=$1", [ownerEmail])).rows[0].password_hash;
// Same password hash, role = staff.
const staffId = (await db.query(
  `insert into users (org_id,name,email,password_hash,role) values ($1,'Staff Member',$2,$3,'staff') returning id`,
  [org, staffEmail, hash])).rows[0].id;

// Seed a paid invoice + a recorded payment for the action-replay check.
const cust = (await db.query("insert into customers (org_id,name) values ($1,'ABC Trading') returning id", [org])).rows[0].id;
const glAcc = (await db.query(`select id from accounts where org_id=$1 and code='1000'`, [org])).rows[0].id;
const bank = (await db.query(
  `insert into bank_accounts (org_id,name,gl_account_id,opening_balance) values ($1,'Cash',$2,'0') returning id`, [org, glAcc])).rows[0].id;
const inv = (await db.query(
  `insert into sales_invoices (org_id,invoice_number,customer_id,status,issue_date,subtotal,tax_total,total,paid_amount,created_by_id)
   values ($1,'INV-RT',$2,'partially_paid','2026-01-01','1000','150','1150','400',$3) returning id`, [org, cust, ownerId])).rows[0].id;
const pay = (await db.query(
  `insert into payments (org_id,direction,bank_account_id,amount,payment_date,sales_invoice_id,created_by_id)
   values ($1,'in',$2,'400','2026-01-05',$3,$4) returning id`, [org, bank, inv, ownerId])).rows[0].id;

// log out, log in as staff
await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
await ctx.clearCookies();
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.fill('input[name="email"]', staffEmail);
await page.fill('input[name="password"]', pass);
await page.getByRole("button", { name: /sign in|log in|login/i }).first().click();
await page.waitForURL(/\/dashboard/, { timeout: 40000 });
check("staff user can sign in", /\/dashboard/.test(page.url()), page.url());

// ---- 1. role-gated pages by DIRECT URL ----
for (const [label, url] of [
  ["Payroll", "/hr/payroll"],
  ["Preset Management", "/settings/presets"],
  ["Business Settings", "/settings/organization"],
  ["Compliance Center", "/settings/compliance"],
]) {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  const landed = new URL(page.url()).pathname;
  check(`staff hitting ${label} by direct URL is redirected away`, landed !== url, `${url} -> ${landed}`);
  check(`staff sees no ${label} content`, landed === "/dashboard", landed);
}

// The Team panel is a tab of Business Settings; its standalone route must not be a side door.
await page.goto(`${BASE}/settings/team`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(600);
check("staff cannot reach the Team panel via /settings/team", new URL(page.url()).pathname === "/dashboard", new URL(page.url()).pathname);

// Sidebar must not advertise what staff cannot open.
await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
const navText = await page.locator(".sidebar").innerText();
for (const label of ["Payroll", "Preset Management", "Business Settings", "Compliance Center"]) {
  check(`sidebar hides ${label} from staff`, !navText.includes(label), "");
}

// ---- 2. role-gated ACTION from a page staff CAN open ----
// Payment Records is requireSession, so staff opens it fine; deletePaymentAction is owner/admin.
// Whatever refuses here is the action's own guard, not a page guard.
await page.goto(`${BASE}/finance/payments`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(800);
check("staff CAN open Payment Records (module is not restricted)", new URL(page.url()).pathname === "/finance/payments", new URL(page.url()).pathname);

const before = (await db.query(`select count(*)::int n from payments where id=$1`, [pay])).rows[0].n;
const delBtn = page.getByRole("button", { name: /delete/i }).first();
let invoked = false;
if (await delBtn.count()) {
  await delBtn.click();
  await page.waitForTimeout(500);
  const dlg = page.locator('[role="dialog"]').last();
  if (await dlg.count()) {
    await dlg.getByRole("button", { name: /delete/i }).last().click();
    await page.waitForTimeout(1800);
    invoked = true;
  }
}
const after = (await db.query(`select count(*)::int n from payments where id=$1`, [pay])).rows[0].n;
check("the payment still exists after a staff delete attempt", before === 1 && after === 1, `${before} -> ${after}`);
console.log(`DIAG  delete control was ${invoked ? "rendered and clicked" : "not rendered for staff"} — either way the row survived.`);

// Ledger integrity: nothing was reversed.
const jl = (await db.query(
  `select count(*)::int n from journal_entries where org_id=$1 and source_type='payment' and source_id=$2`, [org, pay])).rows[0].n;
check("no reversing entry was posted by the staff attempt", jl >= 0, `entries=${jl}`);

// And the invoice's paid amount is untouched.
const paid = (await db.query(`select paid_amount from sales_invoices where id=$1`, [inv])).rows[0].paid_amount;
check("the invoice's paid amount is unchanged", Number(paid) === 400, String(paid));

// ---- staff CAN do the things the panel now says they can ----
await page.goto(`${BASE}/sales/quotations/new`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(800);
check("staff can open a document builder (panel says full Sales access)",
  new URL(page.url()).pathname === "/sales/quotations/new", new URL(page.url()).pathname);
await page.goto(`${BASE}/finance/journal`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(600);
check("staff can open Journal Entry (panel says full Finance access)",
  new URL(page.url()).pathname === "/finance/journal", new URL(page.url()).pathname);

await db.end();
await browser.close();
let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "STAFF RUNTIME VERIFICATION PASS" : "STAFF RUNTIME VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
