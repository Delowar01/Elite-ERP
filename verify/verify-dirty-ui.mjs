import { chromium } from "playwright";
import { Client } from "pg";

const OUT = "/tmp/claude-0/-home-user-Exhibition-Lead-Pro/762bdf67-a9fd-5562-88ca-0fa1fa890980/scratchpad";
const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const email = `du_${Math.random().toString(36).slice(2, 8)}@t.dev`;

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

// ---- 16: light, dark, Arabic RTL, mobile ----
// A fresh page in the same (logged-in) context, so theme/locale switching starts from a known state
// instead of inheriting whatever the save-behaviour block left open.
async function openDiscard() {
  // Land somewhere neutral first so the previous page's dirty state cannot interfere.
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.goto(`${BASE}/sales/quotations/new`, { waitUntil: "networkidle" });
  await dirtyIt();
  await page.waitForTimeout(350);
  await sidebarLink().click();
  await page.waitForTimeout(600);
}
await openDiscard();
await page.screenshot({ path: `${OUT}/dirty-01-light.png` });
const lightBg = await dialog().evaluate((el) => getComputedStyle(el).backgroundColor);
check("light mode: solid popup background", !/,\s*0\)$/.test(lightBg), lightBg);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check("Escape keeps editing (stays on the form)", page.url().includes("/new") && (await dialog().count()) === 0, page.url());

await page.emulateMedia({ colorScheme: "dark" });
await openDiscard();
await page.screenshot({ path: `${OUT}/dirty-02-dark.png` });
const darkBg = await dialog().evaluate((el) => getComputedStyle(el).backgroundColor);
check("dark mode: solid popup background", !/,\s*0\)$/.test(darkBg) && darkBg !== lightBg, darkBg);
await page.keyboard.press("Escape");
await page.emulateMedia({ colorScheme: "light" });

await page.context().addCookies([{ name: "locale", value: "ar", url: BASE }]);
await openDiscard();
const dir = await page.evaluate(() => document.documentElement.getAttribute("dir"));
const arText = await dialog().innerText();
await page.screenshot({ path: `${OUT}/dirty-03-arabic-rtl.png` });
check("Arabic + RTL discard popup", dir === "rtl" && /[؀-ۿ]/.test(arText), `dir=${dir}`);
await page.keyboard.press("Escape");
await page.context().addCookies([{ name: "locale", value: "en", url: BASE }]);

await page.setViewportSize({ width: 390, height: 844 });
await openDiscard();
const box = await dialog().boundingBox();
check("mobile: the popup fits a 390px viewport", box !== null && box.width <= 390, box ? `${Math.round(box.width)}px` : "none");
await page.screenshot({ path: `${OUT}/dirty-04-mobile.png` });
const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
check("focus lands on Keep Editing, the safe option", focused === "Keep Editing", focused);
await page.keyboard.press("Tab");
const trapped = await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
check("focus is trapped in the popup", trapped);
await page.keyboard.press("Escape");
await page.setViewportSize({ width: 1440, height: 950 });

check("no native browser confirm() was ever used", nativePrompt === false);

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
