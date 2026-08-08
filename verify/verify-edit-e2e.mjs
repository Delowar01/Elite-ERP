import { chromium } from "playwright";
import { Client } from "pg";

const OUT = "/tmp/claude-0/-home-user-Exhibition-Lead-Pro/762bdf67-a9fd-5562-88ca-0fa1fa890980/scratchpad";
const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const email = `ed_${Math.random().toString(36).slice(2, 8)}@t.dev`;

const results = [];
const check = (name, cond, extra = "") => results.push([cond, name, extra]);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

await page.goto(`${BASE}/register`);
await page.fill('input[name="orgName"]', "Edit Action Co");
await page.fill('input[name="name"]', "Owner");
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', pass);
const cf = page.locator('input[name="confirmPassword"]');
if (await cf.count()) await cf.fill(pass);
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard|settings/, { timeout: 30000 });

// ---- seed one editable (draft) and one non-editable document per type ----
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const org = (await db.query("select org_id from users where email=$1", [email])).rows[0].org_id;
const uid = (await db.query("select id from users where email=$1", [email])).rows[0].id;
const cust = (await db.query("insert into customers (org_id,name) values ($1,'Fair Organisers Ltd') returning id", [org])).rows[0].id;
const vend = (await db.query("insert into vendors (org_id,name) values ($1,'Steel Supply Co') returning id", [org])).rows[0].id;
const one = async (sql, p) => (await db.query(sql, p)).rows[0].id;

// posted/finalized parents the notes hang off
const postedInv = await one(
  `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,due_date,status,total,currency,created_by_id)
   values ($1,'INV-LOCKED',$2,'2026-02-01','2026-03-01','sent',5000,'SAR',$3) returning id`, [org, cust, uid]);
const receivedPo = await one(
  `insert into purchase_orders (org_id,po_number,vendor_id,order_date,status,total,currency,created_by_id)
   values ($1,'PO-LOCKED',$2,'2026-01-10','received',4000,'SAR',$3) returning id`, [org, vend, uid]);

const TYPES = [
  { key: "quotation", list: "/sales/quotations", detail: "/sales/quotations", label: "Quotation",
    draft: () => one(`insert into quotations (org_id,quotation_number,customer_id,issue_date,status,total,currency,created_by_id) values ($1,'QTN-000123',$2,'2026-02-02','draft',1000,'SAR',$3) returning id`, [org, cust, uid]),
    lockedNumber: "QTN-LOCKED",
    locked: () => one(`insert into quotations (org_id,quotation_number,customer_id,issue_date,status,total,currency,created_by_id) values ($1,'QTN-LOCKED',$2,'2026-02-02','accepted',1000,'SAR',$3) returning id`, [org, cust, uid]),
    draftNumber: "QTN-000123" },
  { key: "sales_order", list: "/sales/orders", detail: "/sales/orders", label: "Sales Order",
    draft: () => one(`insert into sales_orders (org_id,so_number,customer_id,issue_date,status,total,currency,created_by_id) values ($1,'SO-000123',$2,'2026-02-02','draft',1000,'SAR',$3) returning id`, [org, cust, uid]),
    locked: () => one(`insert into sales_orders (org_id,so_number,customer_id,issue_date,status,total,currency,created_by_id) values ($1,'SO-LOCKED',$2,'2026-02-02','confirmed',1000,'SAR',$3) returning id`, [org, cust, uid]),
    draftNumber: "SO-000123", lockedNumber: "SO-LOCKED" },
  { key: "proforma_invoice", list: "/sales/proforma", detail: "/sales/proforma", label: "Proforma Invoice",
    draft: () => one(`insert into proforma_invoices (org_id,proforma_number,customer_id,issue_date,status,total,currency,created_by_id) values ($1,'PI-000123',$2,'2026-02-02','draft',1000,'SAR',$3) returning id`, [org, cust, uid]),
    locked: () => one(`insert into proforma_invoices (org_id,proforma_number,customer_id,issue_date,status,total,currency,created_by_id) values ($1,'PI-LOCKED',$2,'2026-02-02','sent',1000,'SAR',$3) returning id`, [org, cust, uid]),
    draftNumber: "PI-000123", lockedNumber: "PI-LOCKED" },
  { key: "sales_invoice", list: "/sales/invoices", detail: "/sales/invoices", label: "Invoice",
    draft: () => one(`insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,due_date,status,total,currency,created_by_id) values ($1,'INV-000123',$2,'2026-02-02','2026-03-02','draft',1000,'SAR',$3) returning id`, [org, cust, uid]),
    locked: async () => postedInv, draftNumber: "INV-000123", lockedNumber: "INV-LOCKED" },
  { key: "delivery_challan", list: "/sales/delivery-challans", detail: "/sales/delivery-challans", label: "Delivery Challan",
    draft: () => one(`insert into delivery_challans (org_id,dc_number,customer_id,status,dispatch_date,created_by_id) values ($1,'DC-000123',$2,'draft','2026-02-02',$3) returning id`, [org, cust, uid]),
    locked: () => one(`insert into delivery_challans (org_id,dc_number,customer_id,status,dispatch_date,created_by_id) values ($1,'DC-LOCKED',$2,'dispatched','2026-02-02',$3) returning id`, [org, cust, uid]),
    draftNumber: "DC-000123", lockedNumber: "DC-LOCKED" },
  { key: "credit_note", list: "/sales/credit-notes", detail: "/sales/credit-notes", label: "Credit Note",
    draft: () => one(`insert into credit_notes (org_id,credit_note_number,customer_id,source_invoice_id,issue_date,status,total,currency,created_by_id) values ($1,'CN-000123',$2,$3,'2026-02-02','draft',500,'SAR',$4) returning id`, [org, cust, postedInv, uid]),
    locked: () => one(`insert into credit_notes (org_id,credit_note_number,customer_id,source_invoice_id,issue_date,status,total,currency,created_by_id) values ($1,'CN-LOCKED',$2,$3,'2026-02-02','issued',500,'SAR',$4) returning id`, [org, cust, postedInv, uid]),
    draftNumber: "CN-000123", lockedNumber: "CN-LOCKED" },
  { key: "debit_note", list: "/purchasing/debit-notes", detail: "/purchasing/debit-notes", label: "Debit Note",
    draft: () => one(`insert into debit_notes (org_id,debit_note_number,vendor_id,source_purchase_order_id,issue_date,status,total,currency,created_by_id) values ($1,'DN-000123',$2,$3,'2026-02-02','draft',500,'SAR',$4) returning id`, [org, vend, receivedPo, uid]),
    locked: () => one(`insert into debit_notes (org_id,debit_note_number,vendor_id,source_purchase_order_id,issue_date,status,total,currency,created_by_id) values ($1,'DN-LOCKED',$2,$3,'2026-02-02','issued',500,'SAR',$4) returning id`, [org, vend, receivedPo, uid]),
    draftNumber: "DN-000123", lockedNumber: "DN-LOCKED" },
  { key: "purchase_order", list: "/purchasing/orders", detail: "/purchasing/orders", label: "Purchase Order",
    draft: () => one(`insert into purchase_orders (org_id,po_number,vendor_id,order_date,status,total,currency,created_by_id) values ($1,'PO-000123',$2,'2026-01-10','draft',1000,'SAR',$3) returning id`, [org, vend, uid]),
    locked: async () => receivedPo, draftNumber: "PO-000123", lockedNumber: "PO-LOCKED" },
];

for (const t of TYPES) {
  t.draftId = await t.draft();
  t.lockedId = await t.locked();
}
// a soft-deleted draft quotation, to prove the Recycle Bin blocks the direct edit URL
const binned = await one(
  `insert into quotations (org_id,quotation_number,customer_id,issue_date,status,total,currency,created_by_id,deleted_at)
   values ($1,'QTN-BINNED',$2,'2026-02-02','draft',1000,'SAR',$3, now()) returning id`, [org, cust, uid]);
await db.end();

// ---- helpers ----
async function openRowMenu(number) {
  // Radix restores focus to the trigger after a dialog closes; give it a beat, and retry once so a
  // transient focus hand-off cannot look like a missing menu item.
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = page.locator("tr", { hasText: number }).first();
    await row.locator(".row-menu-btn").click({ force: true });
    try {
      await page.locator('[role="menu"]').first().waitFor({ state: "visible", timeout: 2500 });
      await page.waitForTimeout(150);
      return;
    } catch {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
  }
  throw new Error(`could not open the row menu for ${number}`);
}
const menu = () => page.locator('[role="menu"]');
const dialog = () => page.locator('[role="dialog"]');

// ---- 1..6, 10: the flow, per document type, from the LIST menu ----
for (const t of TYPES) {
  await page.goto(`${BASE}${t.list}`, { waitUntil: "networkidle" });

  await openRowMenu(t.draftNumber);
  const editItems = menu().getByRole("menuitem", { name: "Edit", exact: true });
  check(`${t.key}: Edit appears in the three-dot menu for a draft`, (await editItems.count()) === 1, `${await editItems.count()} item(s)`);
  check(`${t.key}: no duplicate Edit action in the menu`, (await editItems.count()) <= 1);

  await editItems.first().click();
  await page.waitForTimeout(350);
  check(`${t.key}: clicking Edit opens the confirmation dialog (no navigation)`,
    (await dialog().count()) === 1 && page.url().includes(t.list) && !page.url().includes("/edit"), page.url());
  const title = await dialog().locator("h2, [id]").first().innerText().catch(() => "");
  const dlgText = await dialog().innerText();
  check(`${t.key}: the dialog names the document type and number`,
    dlgText.includes(t.draftNumber) && dlgText.includes(t.label), title);

  // Cancel keeps the user where they were, and changes nothing.
  await dialog().getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(250);
  check(`${t.key}: Cancel closes the dialog and stays on the list`,
    (await dialog().count()) === 0 && page.url().includes(t.list) && !page.url().includes("/edit"), page.url());

  // Escape also closes it.
  await openRowMenu(t.draftNumber);
  await menu().getByRole("menuitem", { name: "Edit", exact: true }).first().click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  check(`${t.key}: Escape closes the dialog`, (await dialog().count()) === 0);

  // Continue to Edit opens the existing edit page, in the same tab.
  const tabsBefore = page.context().pages().length;
  await openRowMenu(t.draftNumber);
  await menu().getByRole("menuitem", { name: "Edit", exact: true }).first().click();
  await page.waitForTimeout(300);
  await dialog().getByRole("button", { name: "Continue to Edit" }).click();
  await page.waitForURL(new RegExp(`${t.list.replace(/\//g, "\\/")}\\/${t.draftId}\\/edit`), { timeout: 15000 });
  check(`${t.key}: Continue to Edit opens the existing edit page`, page.url().endsWith(`${t.list}/${t.draftId}/edit`), page.url());
  check(`${t.key}: navigation stays in the same tab`, page.context().pages().length === tabsBefore);

  // 7/8: a locked (non-draft) document offers no Edit anywhere.
  await page.goto(`${BASE}${t.list}`, { waitUntil: "networkidle" });
  await openRowMenu(t.lockedNumber);
  const lockedEdit = menu().getByRole("menuitem", { name: "Edit", exact: true });
  check(`${t.key}: a locked document has no Edit in the menu`, (await lockedEdit.count()) === 0, `${await lockedEdit.count()}`);
  await page.keyboard.press("Escape");
}

// ---- 2: Edit in the document Preview, per type ----
for (const t of TYPES) {
  await page.goto(`${BASE}${t.detail}/${t.draftId}`, { waitUntil: "networkidle" });
  const btn = page.getByRole("button", { name: "Edit", exact: true });
  check(`${t.key}: Preview shows exactly one Edit action`, (await btn.count()) === 1, `${await btn.count()}`);
  await btn.first().click();
  await page.waitForTimeout(300);
  const dlgText = await dialog().innerText();
  check(`${t.key}: Preview Edit opens the same confirmation with the document number`,
    (await dialog().count()) === 1 && dlgText.includes(t.draftNumber));
  await dialog().getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(250);
  check(`${t.key}: Preview Cancel stays on the Preview`,
    page.url().endsWith(`${t.detail}/${t.draftId}`) && (await dialog().count()) === 0, page.url());

  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.waitForTimeout(300);
  await dialog().getByRole("button", { name: "Continue to Edit" }).click();
  await page.waitForURL(new RegExp(`${t.detail.replace(/\//g, "\\/")}\\/${t.draftId}\\/edit`), { timeout: 15000 });
  check(`${t.key}: Preview Continue to Edit opens the existing edit page`, page.url().endsWith(`${t.detail}/${t.draftId}/edit`));

  // locked document Preview offers no Edit — same rule as the menu
  await page.goto(`${BASE}${t.detail}/${t.lockedId}`, { waitUntil: "networkidle" });
  check(`${t.key}: a locked document's Preview has no Edit`, (await page.getByRole("button", { name: "Edit", exact: true }).count()) === 0);
}

// ---- 9: direct edit URLs stay protected ----
for (const t of TYPES) {
  await page.goto(`${BASE}${t.detail}/${t.lockedId}/edit`, { waitUntil: "networkidle" });
  check(`${t.key}: a direct edit URL for a locked document redirects to the Preview`,
    page.url().endsWith(`${t.detail}/${t.lockedId}`), page.url());
}
await page.goto(`${BASE}/sales/quotations/${binned}/edit`, { waitUntil: "networkidle" });
check("a soft-deleted document's direct edit URL is refused", !page.url().includes("/edit"), page.url());

// unauthenticated access
const anon = await browser.newContext();
const anonPage = await anon.newPage();
await anonPage.goto(`${BASE}/sales/quotations/${TYPES[0].draftId}/edit`, { waitUntil: "networkidle" });
check("an unauthenticated user cannot reach an edit page", anonPage.url().includes("/login"), anonPage.url());
await anon.close();

// cross-organization access
const other = await browser.newContext();
const otherPage = await other.newPage();
const otherEmail = `ed2_${Math.random().toString(36).slice(2, 8)}@t.dev`;
await otherPage.goto(`${BASE}/register`);
await otherPage.fill('input[name="orgName"]', "Other Org");
await otherPage.fill('input[name="name"]', "Other");
await otherPage.fill('input[name="email"]', otherEmail);
await otherPage.fill('input[name="password"]', pass);
const cf2 = otherPage.locator('input[name="confirmPassword"]');
if (await cf2.count()) await cf2.fill(pass);
await otherPage.click('button[type="submit"]');
await otherPage.waitForURL(/dashboard|settings/, { timeout: 30000 });
await otherPage.goto(`${BASE}/sales/quotations/${TYPES[0].draftId}/edit`, { waitUntil: "networkidle" });
// The org-scoped lookup fails, so the route renders the app's not-found page instead of the form.
// (That page is served with a 200 in this app — pre-existing behaviour for every not-found route —
// so assert on what the user actually gets, not on the status code.)
const otherBody = await otherPage.locator("body").innerText();
check("another organization cannot open this org's edit page",
  otherBody.includes("Page not found") && !otherBody.includes("Edit Quotation"), otherBody.slice(0, 60).replace(/\n/g, " "));
await other.close();

// ---- 11: themes, locales, RTL, mobile ----
await page.goto(`${BASE}/sales/quotations`, { waitUntil: "networkidle" });
async function shotDialog(name) {
  await openRowMenu(TYPES[0].draftNumber);
  const editItem = menu().getByRole("menuitem", { name: "Edit", exact: true });
  const arEditItem = menu().getByRole("menuitem", { name: "تعديل", exact: true });
  await ((await editItem.count()) ? editItem : arEditItem).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const ok = (await dialog().count()) === 1;
  const bg = await dialog().evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  return { ok, bg };
}
const light = await shotDialog("edit-01-light");
check("dialog renders in light mode with a solid (non-transparent) background",
  light.ok && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(light.bg) && !/,\s*0\)$/.test(light.bg), light.bg);

await page.emulateMedia({ colorScheme: "dark" });
await page.reload({ waitUntil: "networkidle" });
const dark = await shotDialog("edit-02-dark");
check("dialog renders in dark mode with a solid background", dark.ok && !/,\s*0\)$/.test(dark.bg), dark.bg);
await page.emulateMedia({ colorScheme: "light" });

await page.context().addCookies([{ name: "locale", value: "ar", url: BASE }]);
await page.goto(`${BASE}/sales/quotations`, { waitUntil: "networkidle" });
const dir = await page.evaluate(() => document.documentElement.getAttribute("dir"));
await openRowMenu(TYPES[0].draftNumber);
const arMenuText = await menu().innerText();
check("Arabic menu shows a translated Edit label", arMenuText.includes("تعديل"), arMenuText.split("\n")[1] ?? "");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
const ar = await shotDialog("edit-03-arabic-rtl");
check("dialog works in Arabic with RTL layout", ar.ok && dir === "rtl", `dir=${dir}`);
await page.context().addCookies([{ name: "locale", value: "en", url: BASE }]);

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/sales/quotations`, { waitUntil: "networkidle" });
const mobile = await shotDialog("edit-04-mobile");
check("dialog works at a 390px mobile viewport", mobile.ok);
await page.setViewportSize({ width: 1440, height: 950 });

// keyboard: reach and activate Edit without a mouse
await page.goto(`${BASE}/sales/quotations`, { waitUntil: "networkidle" });
const row = page.locator("tr", { hasText: TYPES[0].draftNumber }).first();
await row.locator(".row-menu-btn").focus();
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
let focused = "";
for (let i = 0; i < 8 && focused !== "Edit"; i++) {
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(120);
  focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
}
check("the menu is keyboard navigable to Edit", focused === "Edit", focused);
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
check("Enter on Edit opens the confirmation dialog", (await dialog().count()) === 1);
const inDialog = await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
check("focus moves into the dialog", inDialog);
await page.keyboard.press("Escape");
await page.waitForTimeout(250);
check("Escape closes the dialog from the keyboard", (await dialog().count()) === 0);

await browser.close();
let allOk = true;
for (const [cond, name, extra] of results) { if (!cond) allOk = false; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  << " + extra : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(allOk ? "EDIT ACTION E2E PASS" : "EDIT ACTION E2E FAIL");
process.exit(allOk ? 0 : 1);
