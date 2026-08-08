import { chromium } from "playwright";
import { Client } from "pg";

const OUT = "/tmp/claude-0/-home-user-Exhibition-Lead-Pro/762bdf67-a9fd-5562-88ca-0fa1fa890980/scratchpad";
const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const email = `df_${Math.random().toString(36).slice(2, 8)}@t.dev`;

const results = [];
const check = (name, cond, extra = "") => results.push([cond, name, extra]);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
let page = await context.newPage();
const dialog = () => page.locator('[role="dialog"]');
// A native confirm() would mean window.confirm slipped back in. beforeunload prompts are expected
// (that is the browser's own leave-the-page protection) and must be ACCEPTED — dismissing one
// cancels the navigation the test is driving.
let nativePrompt = false;
page.on("dialog", async (d) => {
  if (d.type() !== "beforeunload") nativePrompt = true;
  await d.accept();
});

await page.goto(`${BASE}/register`);
await page.fill('input[name="orgName"]', "Dirty Form Co");
await page.fill('input[name="name"]', "Owner");
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', pass);
const cf = page.locator('input[name="confirmPassword"]');
if (await cf.count()) await cf.fill(pass);
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard|settings/, { timeout: 30000 });

// ---- fixtures ----
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const org = (await db.query("select org_id from users where email=$1", [email])).rows[0].org_id;
const uid = (await db.query("select id from users where email=$1", [email])).rows[0].id;
const cust = (await db.query("insert into customers (org_id,name) values ($1,'ABC Trading') returning id", [org])).rows[0].id;
const vend = (await db.query("insert into vendors (org_id,name) values ($1,'Steel Supply Co') returning id", [org])).rows[0].id;
const one = async (sql, p) => (await db.query(sql, p)).rows[0].id;
const postedInv = await one(
  `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,due_date,status,total,currency,created_by_id)
   values ($1,'INV-SRC',$2,'2026-02-01','2026-03-01','sent',5000,'SAR',$3) returning id`, [org, cust, uid]);
const receivedPo = await one(
  `insert into purchase_orders (org_id,po_number,vendor_id,order_date,status,total,currency,created_by_id)
   values ($1,'PO-SRC',$2,'2026-01-10','received',4000,'SAR',$3) returning id`, [org, vend, uid]);
await db.end();

const BUILDERS = [
  { key: "Quotation", url: "/sales/quotations/new" },
  { key: "Sales Order", url: "/sales/orders/new" },
  { key: "Proforma Invoice", url: "/sales/proforma/new" },
  { key: "Invoice", url: "/sales/invoices/new" },
  { key: "Delivery Challan", url: "/sales/delivery-challans/new" },
  { key: "Credit Note", url: `/sales/credit-notes/new?invoice=${postedInv}` },
  { key: "Purchase Order", url: "/purchasing/orders/new" },
  { key: "Debit Note", url: `/purchasing/debit-notes/new?po=${receivedPo}` },
];

/** Type into the first quantity cell of the line-items table — present in every builder and, unlike
 *  a placeholder, identical in English and Arabic. */
async function dirtyIt() {
  const qty = page.locator('.doc-items-table input[type="number"]').first();
  try {
    await qty.waitFor({ state: "visible", timeout: 20000 });
  } catch (err) {
    console.log("DIAG url:", page.url());
    console.log("DIAG body:", (await page.locator("body").innerText().catch(() => "")).slice(0, 200).replace(/\n/g, " | "));
    await page.screenshot({ path: `${OUT}/dirty-diag.png` }).catch(() => {});
    throw err;
  }
  const original = await qty.inputValue();
  await qty.fill("7");
  return { locator: qty, original };
}
const sidebarLink = () => page.locator('.sidebar a[href="/dashboard"], a[href="/dashboard"]').first();

// ---- 1/2/3/4/5/11: the core flow, on every builder ----
for (const b of BUILDERS) {
  await page.goto(`${BASE}${b.url}`, { waitUntil: "networkidle" });

  // 1. untouched form navigates freely
  await sidebarLink().click();
  await page.waitForTimeout(700);
  check(`${b.key}: an untouched form navigates without asking`,
    (await dialog().count()) === 0 && page.url().includes("/dashboard"), page.url());

  await page.goto(`${BASE}${b.url}`, { waitUntil: "networkidle" });
  const field = await dirtyIt();
  await page.waitForTimeout(300);

  // 2/11. sidebar navigation is protected
  await sidebarLink().click();
  await page.waitForTimeout(500);
  const text = (await dialog().innerText().catch(() => "")) || "";
  check(`${b.key}: changing a field makes sidebar navigation ask first`,
    (await dialog().count()) === 1 && text.includes("Discard unsaved changes?"), text.split("\n")[0]);
  check(`${b.key}: the popup offers Keep Editing | Discard Changes`,
    (await dialog().getByRole("button", { name: "Keep Editing" }).count()) === 1 &&
    (await dialog().getByRole("button", { name: "Discard Changes" }).count()) === 1);

  // 3. Keep Editing stays put and preserves the data
  await dialog().getByRole("button", { name: "Keep Editing" }).click();
  await page.waitForTimeout(400);
  check(`${b.key}: Keep Editing stays on the form`, page.url().includes(b.url.split("?")[0]), page.url());
  check(`${b.key}: Keep Editing preserves what was typed`, (await field.locator.inputValue()).length > 0);

  // 5. reverting the change clears the dirty state
  await field.locator.fill(field.original);
  await page.waitForTimeout(400);
  await sidebarLink().click();
  await page.waitForTimeout(700);
  check(`${b.key}: reverting the change removes the warning`,
    (await dialog().count()) === 0 && page.url().includes("/dashboard"), page.url());

  // 4. Discard Changes continues to the requested destination
  await page.goto(`${BASE}${b.url}`, { waitUntil: "networkidle" });
  await dirtyIt();
  await page.waitForTimeout(300);
  await sidebarLink().click();
  await page.waitForTimeout(500);
  await dialog().getByRole("button", { name: "Discard Changes" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  check(`${b.key}: Discard Changes continues to the destination`, page.url().includes("/dashboard"), page.url());
  check(`${b.key}: no second popup during that navigation`, (await dialog().count()) === 0);
}

// ---- 6/7: line items and rich-text/notes count as changes ----
await page.goto(`${BASE}/sales/quotations/new`, { waitUntil: "networkidle" });
await page.locator("text=Add New Item").first().click();
await page.waitForTimeout(400);
await sidebarLink().click();
await page.waitForTimeout(500);
check("adding a line item marks the form dirty", (await dialog().count()) === 1);
await dialog().getByRole("button", { name: "Keep Editing" }).click();
await page.waitForTimeout(300);

await page.goto(`${BASE}/sales/quotations/new`, { waitUntil: "networkidle" });
const noteTab = page.locator('text=Add Note').first();
if (await noteTab.count()) {
  await noteTab.click();
  await page.waitForTimeout(400);
  const editor = page.locator('[contenteditable="true"], textarea').first();
  if (await editor.count()) {
    await editor.click();
    await page.keyboard.type("Payment within 30 days.");
    await page.waitForTimeout(400);
    await sidebarLink().click();
    await page.waitForTimeout(500);
    check("editing the notes/rich-text field marks the form dirty", (await dialog().count()) === 1);
    await dialog().getByRole("button", { name: "Keep Editing" }).click();
    await page.waitForTimeout(300);
  }
}

// ---- 12: an internal link inside the page (not the sidebar) is protected too ----
await page.goto(`${BASE}/sales/quotations/new`, { waitUntil: "networkidle" });
await dirtyIt();
await page.waitForTimeout(300);
await page.locator('.topbar a[href], header a[href]').first().click().catch(async () => {
  await page.locator('a[href="/sales/quotations"]').first().click();
});
await page.waitForTimeout(500);
check("an in-page internal link is protected as well", (await dialog().count()) === 1);
await dialog().getByRole("button", { name: "Keep Editing" }).click();
await page.waitForTimeout(300);

// ---- 14: refresh / tab close warns only when dirty ----
await page.goto(`${BASE}/sales/quotations/new`, { waitUntil: "networkidle" });
const cleanUnload = await page.evaluate(() => {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
});
check("a clean form does not block refresh/tab close", cleanUnload === false);
await dirtyIt();
await page.waitForTimeout(300);
const dirtyUnload = await page.evaluate(() => {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
});
check("a dirty form blocks refresh/tab close", dirtyUnload === true);

// ---- 8/9/10: save behaviour ----
// A failed save (no client selected) keeps the form dirty.
await page.goto(`${BASE}/sales/quotations/new`, { waitUntil: "networkidle" });
await page.locator('input[placeholder*="Item name" i]').first().fill("Booth package");
await page.waitForTimeout(300);
await page.getByRole("button", { name: "Save as Draft" }).first().click();
await page.waitForTimeout(2000);
check("a failed save keeps the user on the form", page.url().includes("/new"), page.url());
await sidebarLink().click();
await page.waitForTimeout(600);
check("a failed save leaves the form dirty", (await dialog().count()) === 1);
await dialog().getByRole("button", { name: "Keep Editing" }).click();
await page.waitForTimeout(400);

// A successful save must not ask to discard afterwards.
// Pick the client through the party card's own SearchableSelect. That control is a Radix
// Popover: the trigger is the card's only aria-expanded button, and each option is a plain
// button inside the popper — so this stays language-independent.
// `.w-full` is what separates the select's trigger from the card's pencil button (which is a
// Dialog trigger and also carries aria-expanded).
await page.locator('.party-card-v2 button[aria-expanded].w-full').first().click();
await page.waitForTimeout(500);
await page.locator('[data-radix-popper-content-wrapper] button').first().click();
await page.waitForTimeout(500);
await page.locator('.doc-items-table input[type="text"], .doc-items-table input:not([type])').first().fill("Booth package");
await page.locator('.doc-items-table input[type="number"]').last().fill("1000").catch(() => {});
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Save as Draft" }).first().click();
await page.waitForURL(/\/sales\/quotations\/\d+$/, { timeout: 25000 }).catch(() => {});
check("a successful Save as Draft navigates to the saved document without asking",
  /\/sales\/quotations\/\d+$/.test(page.url()) && (await dialog().count()) === 0, page.url());
check("no discard popup appeared after saving", (await dialog().count()) === 0);


await browser.close();
report();

function report() {
let allOk = true;
for (const [cond, name, extra] of results) { if (!cond) allOk = false; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  << " + extra : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(allOk ? "PASS" : "FAIL");
process.exit(allOk ? 0 : 1);
}

process.on("uncaughtException", (err) => {
  console.log("CRASHED:", err instanceof Error ? err.message.split("\n")[0] : String(err));
  report();
});
