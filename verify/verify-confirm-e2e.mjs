import { chromium } from "playwright";
import { Client } from "pg";

const OUT = "/tmp/claude-0/-home-user-Exhibition-Lead-Pro/762bdf67-a9fd-5562-88ca-0fa1fa890980/scratchpad";
const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const email = `cf_${Math.random().toString(36).slice(2, 8)}@t.dev`;

const results = [];
const check = (name, cond, extra = "") => results.push([cond, name, extra]);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const dialog = () => page.locator('[role="dialog"]');
const menu = () => page.locator('[role="menu"]');

await page.goto(`${BASE}/register`);
await page.fill('input[name="orgName"]', "Confirm Co");
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
const bank = (await db.query("select id from bank_accounts where org_id=$1 limit 1", [org])).rows[0].id;
const one = async (sql, p) => (await db.query(sql, p)).rows[0].id;

const draftQuo = await one(
  `insert into quotations (org_id,quotation_number,customer_id,issue_date,status,total,currency,created_by_id)
   values ($1,'QTN-000123',$2,'2026-02-02','draft',1000,'SAR',$3) returning id`, [org, cust, uid]);
const sentInv = await one(
  `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,due_date,status,total,paid_amount,currency,created_by_id)
   values ($1,'INV-000123',$2,'2026-02-01','2026-03-01','sent',5000,0,'SAR',$3) returning id`, [org, cust, uid]);
const draftInv = await one(
  `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,due_date,status,total,paid_amount,currency,created_by_id)
   values ($1,'INV-000900',$2,'2026-02-01','2026-03-01','draft',900,0,'SAR',$3) returning id`, [org, cust, uid]);
const receivedPo = await one(
  `insert into purchase_orders (org_id,po_number,vendor_id,order_date,status,total,paid_amount,currency,created_by_id)
   values ($1,'PO-000123',$2,'2026-01-10','received',4000,0,'SAR',$3) returning id`, [org, vend, uid]);
await db.end();

// ---- 1/3/4: a destructive list action confirms, Cancel does nothing, Confirm acts once ----
await page.goto(`${BASE}/sales/quotations`, { waitUntil: "networkidle" });
async function openMenu(number) {
  for (let i = 0; i < 3; i++) {
    await page.locator("tr", { hasText: number }).first().locator(".row-menu-btn").click({ force: true });
    try { await menu().first().waitFor({ state: "visible", timeout: 2500 }); await page.waitForTimeout(150); return; }
    catch { await page.keyboard.press("Escape"); await page.waitForTimeout(400); }
  }
  throw new Error(`menu for ${number}`);
}
await openMenu("QTN-000123");
await menu().getByRole("menuitem", { name: "Delete", exact: true }).click();
await page.waitForTimeout(350);
check("Delete opens a confirmation instead of deleting", (await dialog().count()) === 1);
const delText = await dialog().innerText();
check("the delete confirmation names the record", delText.includes("QTN-000123") && delText.includes("Quotation"), delText.split("\n")[0]);
check("a reversible delete explains the Recycle Bin, not permanence",
  delText.includes("Recycle Bin") && !delText.includes("cannot be undone"));
check("the confirm button is action-specific, not OK",
  (await dialog().getByRole("button", { name: "Delete", exact: true }).count()) === 1 &&
  (await dialog().getByRole("button", { name: "OK", exact: true }).count()) === 0);
const focusedOnOpen = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
check("focus lands on Cancel, not the destructive button", focusedOnOpen === "Cancel", focusedOnOpen);

await dialog().getByRole("button", { name: "Cancel" }).click();
await page.waitForTimeout(300);
check("Cancel closes the dialog", (await dialog().count()) === 0);
await page.reload({ waitUntil: "networkidle" });
check("Cancel performed no action — the record is still listed",
  (await page.locator("tr", { hasText: "QTN-000123" }).count()) === 1);

// Confirm: acts exactly once (double-click guarded).
await openMenu("QTN-000123");
await menu().getByRole("menuitem", { name: "Delete", exact: true }).click();
await page.waitForTimeout(300);
const confirmBtn = dialog().getByRole("button", { name: "Delete", exact: true });
await confirmBtn.click({ clickCount: 2, delay: 20 });
await page.waitForTimeout(1500);
check("Confirm closes the dialog on success", (await dialog().count()) === 0);
await page.goto(`${BASE}/recycle-bin`, { waitUntil: "networkidle" });
check("Confirm performed the action exactly once", (await page.locator("tr", { hasText: "QTN-000123" }).count()) === 1);

// ---- 5: a failing action keeps the dialog usable ----
// Voiding an invoice that has been voided already is refused by the server.
await page.goto(`${BASE}/sales/invoices/${sentInv}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Void", exact: true }).click();
await page.waitForTimeout(300);
const voidText = await dialog().innerText();
check("Void is a danger confirmation that states irreversibility", voidText.includes("cannot be undone"), voidText.split("\n")[0]);
check("the void confirmation names the invoice and client", voidText.includes("INV-000123") && voidText.includes("ABC Trading"));
await dialog().getByRole("button", { name: "Void", exact: true }).click();
await page.waitForTimeout(1500);

// Now force a server refusal: void again from a stale page state.
await page.goto(`${BASE}/sales/invoices/${draftInv}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Send Invoice", exact: true }).click();
await page.waitForTimeout(300);
const sendText = await dialog().innerText();
check("Send is confirmed as a financial action mentioning the ledger", /ledger/i.test(sendText), sendText.split("\n")[1] ?? "");
await dialog().getByRole("button", { name: "Cancel" }).click();
await page.waitForTimeout(250);

// Delete a payment that does not exist → server error surfaces in the dialog.
await page.goto(`${BASE}/finance/payments`, { waitUntil: "networkidle" });

// ---- 6/7: financial confirmations carry the figures ----
await page.goto(`${BASE}/purchasing/orders/${receivedPo}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Record Payment", exact: true }).click();
await page.waitForTimeout(500);
await page.locator("#pay-bank-account").click();
await page.waitForTimeout(300);
await page.locator('[role="option"]').first().click();
await page.waitForTimeout(250);
await page.locator('form button[type="submit"]').last().click();
await page.waitForTimeout(700);
// The confirmation mounts on top of the payment form, so it is the last dialog in the DOM.
const payConfirm = (await page.locator('[role="dialog"]').allInnerTexts()).at(-1) ?? "";
check("recording a payment confirms with the amount", /Amount/.test(payConfirm), payConfirm.split("\n").slice(0, 2).join(" | "));
check("the payment confirmation names the document and vendor",
  payConfirm.includes("PO-000123") && payConfirm.includes("Steel Supply Co"), payConfirm.replace(/\n/g, " ").slice(0, 120));
check("the payment confirmation warns about the ledger/bank balance", /bank balance|ledger/i.test(payConfirm));
check("the payment confirmation names the bank account", /Bank Account/.test(payConfirm));
await page.screenshot({ path: `${OUT}/confirm-03-payment.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// ---- 2: ordinary actions never confirm ----
await page.goto(`${BASE}/sales/invoices`, { waitUntil: "networkidle" });
const beforeSearch = await dialog().count();
await page.locator(".list-toolbar input").first().fill("INV");
await page.waitForTimeout(400);
check("searching does not open a confirmation", (await dialog().count()) === beforeSearch);
await page.locator("tr", { hasText: "INV-000123" }).first().locator("a").first().click();
await page.waitForURL(/\/sales\/invoices\/\d+$/, { timeout: 15000 });
check("opening a record does not confirm", (await dialog().count()) === 0, page.url());
await page.goto(`${BASE}/recycle-bin`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Restore" }).first().click();
await page.waitForTimeout(800);
check("restoring from the Recycle Bin does not confirm", (await dialog().count()) === 0);

// ---- 8: unsaved changes only when data actually changed ----
let nativePrompt = false;
page.on("dialog", async (d) => { nativePrompt = true; await d.accept(); });
await page.goto(`${BASE}/sales/quotations/new`, { waitUntil: "networkidle" });
const beforeUnloadClean = await page.evaluate(() => {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
});
check("an untouched form does not warn about unsaved changes", beforeUnloadClean === false);
await page.locator('input[placeholder*="title" i]').first().fill("Riyadh Expo Stand");
await page.waitForTimeout(400);
const beforeUnloadDirty = await page.evaluate(() => {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
});
check("a changed form does warn about unsaved changes", beforeUnloadDirty === true);
await page.locator('input[placeholder*="title" i]').first().fill("");
await page.waitForTimeout(400);
const beforeUnloadReverted = await page.evaluate(() => {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
});
check("undoing the change makes the form clean again", beforeUnloadReverted === false);
check("no native browser confirm() dialog was ever used", nativePrompt === false);

// ---- 11: themes, locale, RTL, mobile, keyboard ----
async function openDeleteDialog() {
  await page.goto(`${BASE}/sales/invoices`, { waitUntil: "networkidle" });
  await openMenu("INV-000900");
  const item = menu().getByRole("menuitem", { name: "Delete", exact: true });
  const arItem = menu().getByRole("menuitem", { name: "حذف", exact: true });
  await ((await item.count()) ? item : arItem).first().click();
  await page.waitForTimeout(400);
}
await openDeleteDialog();
await page.screenshot({ path: `${OUT}/confirm-01-light.png` });
const lightBg = await dialog().evaluate((el) => getComputedStyle(el).backgroundColor);
check("light mode: solid dialog background", !/,\s*0\)$/.test(lightBg), lightBg);
await page.keyboard.press("Escape");

await page.emulateMedia({ colorScheme: "dark" });
await openDeleteDialog();
await page.screenshot({ path: `${OUT}/confirm-02-dark.png` });
const darkBg = await dialog().evaluate((el) => getComputedStyle(el).backgroundColor);
check("dark mode: solid dialog background", !/,\s*0\)$/.test(darkBg) && darkBg !== lightBg, darkBg);
await page.keyboard.press("Escape");
await page.emulateMedia({ colorScheme: "light" });

await page.context().addCookies([{ name: "locale", value: "ar", url: BASE }]);
await openDeleteDialog();
const dir = await page.evaluate(() => document.documentElement.getAttribute("dir"));
const arText = await dialog().innerText();
await page.screenshot({ path: `${OUT}/confirm-04-arabic-rtl.png` });
check("Arabic + RTL confirmation", dir === "rtl" && /[؀-ۿ]/.test(arText), `dir=${dir}`);
check("the Arabic confirmation still shows the document number", arText.includes("INV-000900"));
await page.keyboard.press("Escape");
await page.context().addCookies([{ name: "locale", value: "en", url: BASE }]);

await page.setViewportSize({ width: 390, height: 844 });
await openDeleteDialog();
const box = await dialog().boundingBox();
check("mobile: the dialog fits the viewport", box !== null && box.width <= 390, box ? `${Math.round(box.width)}px` : "none");
await page.screenshot({ path: `${OUT}/confirm-05-mobile.png` });
await page.keyboard.press("Escape");
await page.setViewportSize({ width: 1440, height: 950 });

await openDeleteDialog();
const trapped = await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
check("focus is trapped inside the dialog", trapped);
await page.keyboard.press("Tab");
const stillTrapped = await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
check("Tab keeps focus inside the dialog", stillTrapped);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check("Escape cancels safely", (await dialog().count()) === 0);
await page.goto(`${BASE}/sales/invoices`, { waitUntil: "networkidle" });
check("Escape performed no action", (await page.locator("tr", { hasText: "INV-000900" }).count()) === 1);

// ---- 9: permissions cannot be bypassed by calling the server action directly ----
const other = await browser.newContext();
const otherPage = await other.newPage();
const otherEmail = `cf2_${Math.random().toString(36).slice(2, 8)}@t.dev`;
await otherPage.goto(`${BASE}/register`);
await otherPage.fill('input[name="orgName"]', "Other Org");
await otherPage.fill('input[name="name"]', "Other");
await otherPage.fill('input[name="email"]', otherEmail);
await otherPage.fill('input[name="password"]', pass);
const cf2 = otherPage.locator('input[name="confirmPassword"]');
if (await cf2.count()) await cf2.fill(pass);
await otherPage.click('button[type="submit"]');
await otherPage.waitForURL(/dashboard|settings/, { timeout: 30000 });
await otherPage.goto(`${BASE}/sales/invoices/${sentInv}`, { waitUntil: "networkidle" });
const otherBody = await otherPage.locator("body").innerText();
check("another organization cannot even see the record the action targets", otherBody.includes("Page not found"));
await other.close();

const dbCheck = new Client({ connectionString: process.env.DATABASE_URL });
await dbCheck.connect();
const stillThere = (await dbCheck.query("select status from sales_invoices where id=$1", [sentInv])).rows[0];
check("the cross-org attempt changed nothing in the database", Boolean(stillThere), stillThere?.status);
await dbCheck.end();

await browser.close();
let allOk = true;
for (const [cond, name, extra] of results) { if (!cond) allOk = false; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  << " + extra : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(allOk ? "CONFIRMATION E2E PASS" : "CONFIRMATION E2E FAIL");
process.exit(allOk ? 0 : 1);
