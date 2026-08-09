/**
 * Task 6 — in-document vendor creation.
 *
 * The whole value of this feature is that you do NOT lose the document you were building. So the
 * assertions are built around unsaved parent state: type real line items and a title FIRST, then
 * open the popup, and check that everything survives.
 *
 * The riskiest path is the discard confirmation, because two dirty-state trackers are live at once
 * — the document's and the popup's. Discarding a half-typed vendor must not touch the document's
 * line items or its already-selected vendor. That is asserted twice: from the empty state, and
 * again with a vendor already chosen.
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const email = `vi_${Math.random().toString(36).slice(2, 8)}@t.dev`;
const results = [];
const check = (name, cond, extra = "") => results.push([cond, name, extra]);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

// Refuse to run against a build other than the one on disk — see assert-fresh-build.mjs.
await assertFreshBuild(BASE);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
ctx.setDefaultTimeout(45000);
ctx.setDefaultNavigationTimeout(60000);
const page = await ctx.newPage();
page.on("dialog", (d) => d.accept());

// A full page reload is what would destroy unsaved document state, so measure that directly with a
// sentinel on window: it survives Next's soft router refresh (which revalidatePath triggers, and
// which preserves client state) and dies on a real document load. Counting `framenavigated` would
// conflate the two and fail on the harmless one.
let navigations = 0;
page.on("framenavigated", (f) => { if (f === page.mainFrame()) navigations++; });
const plantSentinel = () => page.evaluate(() => { window.__noReload = "alive"; });
const sentinelAlive = () => page.evaluate(() => window.__noReload === "alive");

await page.goto(`${BASE}/register`);
await page.fill('input[name="orgName"]', "Vendor Inline Co");
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
// An existing vendor, so the selector is not empty and "auto-selected" means something specific.
await db.query(`insert into vendors (org_id,name,email) values ($1,'Northbound Steel Ltd','ns@x.dev')`, [org]);
await db.query(`insert into products (org_id,name,sku,unit_price,quantity_on_hand) values ($1,'Steel Coil','SC-1','750','40')`, [org]);

const ITEM_TEXT = "Galvanised sheet — 3mm";
const TITLE_TEXT = "Annual steel supply";
const NEW_VENDOR = `Aurora Metals ${Math.random().toString(36).slice(2, 6)}`;

async function openPoBuilder() {
  await page.goto(`${BASE}/purchasing/orders/new`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
}

// Types a title + a line item so the document has real unsaved content to lose. The title lives in
// the .doc-field whose <label> reads "Purchase Order Title" (po-form.tsx) — targeted by that label
// rather than by input index, which picks up the date fields.
async function fillDocument() {
  await page.getByPlaceholder("Write purchase order title here…").first().fill(TITLE_TEXT);
  // First line item's name cell (item-entry-cell.tsx, placeholder "Item name"). The items table's
  // literal first <input> is a hidden file input for the item image, so target by placeholder.
  await page.getByPlaceholder("Item name").first().fill(ITEM_TEXT);
  await page.waitForTimeout(500);
}

async function documentStillHas() {
  const main = await page.locator("main").innerText();
  const inputs = await page.locator("input").evaluateAll((els) => els.map((e) => e.value).join(""));
  const html = main + "" + inputs;
  return { item: html.includes(ITEM_TEXT), title: html.includes(TITLE_TEXT) };
}


// Opens the vendor popup from whichever affordance is currently available: the empty-state button
// when no vendor is chosen, or the selector's "Add New Vendor" row once one is. Both must work.
async function openVendorPopup() {
  // Radix leaves its overlay mounted briefly after close; clicking through it silently fails.
  await page.locator('[role="dialog"]').last().waitFor({ state: "detached" }).catch(() => {});
  await page.waitForTimeout(500);
  const emptyStateBtn = page.getByRole("button", { name: "Add New Vendor", exact: true });
  if (await emptyStateBtn.count()) {
    await emptyStateBtn.first().click();
  } else {
    await page.locator(".party-card-v2").last().locator("button").first().click();
    await page.waitForTimeout(400);
    await page.getByRole("option", { name: /Add New Vendor/i })
      .or(page.getByRole("button", { name: /Add New Vendor/i })).first().click();
  }
  await page.waitForTimeout(900);
  return page.locator('[role="dialog"]').last();
}

// ---------- 1. the affordance exists at all ----------
await openPoBuilder();
const preText = await page.locator("main").innerText();
check("vendor party card offers Add New Vendor", /Add New Vendor/i.test(preText), preText.match(/Add New \w+/)?.[0] ?? "");

await fillDocument();
const beforeOpen = await documentStillHas();
check("document has unsaved line item text before the popup opens", beforeOpen.item);
await plantSentinel();
check("sentinel planted on the live page", await sentinelAlive());

let dlg; // reused across every popup open below

// ---------- 2. create path — FIRST, from a clean open — vendor saved, merged, auto-selected, no reload ----------
const navBeforeCreate = navigations;
dlg = await openVendorPopup();
await dlg.locator('input[name="name"]').fill(NEW_VENDOR);
await dlg.locator('input[name="email"]').fill("ops@aurora.dev");
await dlg.locator('input[name="vatNumber"]').fill("310000000000003");
await dlg.getByRole("button", { name: /Save Vendor/i }).first().click();
await page.waitForTimeout(2500);

const row = (await db.query(`select id, org_id, email, vat_number from vendors where name=$1`, [NEW_VENDOR])).rows[0];
check("the vendor was actually created", !!row);
check("the vendor is scoped to this org", row?.org_id === org, `${row?.org_id} vs ${org}`);
check("the full form's fields were saved, not just the name", row?.email === "ops@aurora.dev" && row?.vat_number === "310000000000003", JSON.stringify(row));

check("creating the vendor never reloaded the page — unsaved document state was never at risk",
  await sentinelAlive(), `soft navs ${navBeforeCreate} -> ${navigations}`);
const afterCreate = await documentStillHas();
check("the unsaved line item survived vendor creation", afterCreate.item);
check("the unsaved document title survived vendor creation", afterCreate.title);

// If the action redirected, we are no longer on the builder at all — report that as the failed
// property rather than letting the missing selector throw an unnamed timeout.
const stillOnBuilder = new URL(page.url()).pathname === "/purchasing/orders/new";
check("still on the document builder after creating the vendor", stillOnBuilder, page.url());
if (!stillOnBuilder) {
  console.log("DIAG  the action navigated away from the builder; every remaining check assumes it, so stopping here.");
  await report();
}
const cardText = await page.locator(".party-card-v2").last().innerText();
check("the new vendor is auto-selected in the party card", cardText.includes(NEW_VENDOR), cardText.slice(0, 80));
check("the new vendor's details render on the card", /ops@aurora\.dev/.test(cardText), cardText.slice(0, 120));

// It must be in the selector list too, not just displayed as the current value.
await page.locator(".party-card-v2").last().locator("button").first().click();
await page.waitForTimeout(500);
const listText = await page.locator("body").innerText();
check("the new vendor is merged into the selector's options",
  listText.includes(NEW_VENDOR) && listText.includes("Northbound Steel Ltd"), "");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// ---------- 3. discard path — popup dirty, document must survive ----------
const navBeforeDiscard = navigations;
dlg = await openVendorPopup();
check("the vendor popup opens", await dlg.isVisible().catch(() => false));
check("the popup reuses the full vendor form, not a reduced quick-create",
  (await dlg.locator('input[name="name"]').count()) === 1 &&
  (await dlg.locator('input[name="email"]').count()) === 1 &&
  (await dlg.locator('input[name="vatNumber"]').count()) === 1 &&
  (await dlg.locator('input[name="taxId"]').count()) === 1 &&
  (await dlg.locator('input[name="notes"]').count()) === 1);

// Type a partial vendor, then Cancel — the confirmation must appear rather than closing silently.
await dlg.locator('input[name="name"]').fill("Half-typed vendor");
await page.waitForTimeout(300);
await dlg.getByRole("button", { name: /^cancel$/i }).first().click();
await page.waitForTimeout(500);
dlg = page.locator('[role="dialog"]').last();
const confirmText = await dlg.innerText().catch(() => "");
check("cancelling with unsaved vendor input asks before discarding", /Discard unsaved vendor details\?/i.test(confirmText), confirmText.slice(0, 60));
check("the confirmation offers Keep editing", /Keep editing/i.test(confirmText));

// Keep editing must NOT close the popup — otherwise the button lies.
await dlg.getByRole("button", { name: /Keep editing/i }).first().click();
await page.waitForTimeout(500);
check("Keep editing leaves the popup open with the typed input intact",
  (await page.locator('[role="dialog"]').last().locator('input[name="name"]').inputValue().catch(() => "")) === "Half-typed vendor");

// Now actually discard.
await page.locator('[role="dialog"]').last().getByRole("button", { name: /^cancel$/i }).first().click();
await page.waitForTimeout(400);
await page.locator('[role="dialog"]').last().getByRole("button", { name: /^Discard$/i }).first().click();
await page.waitForTimeout(900);
check("discarding closes the popup", (await page.locator('[role="dialog"]').count()) === 0 || !(await page.locator('[role="dialog"]').last().isVisible().catch(() => false)));

const afterDiscard = await documentStillHas();
check("discarding an unsaved vendor leaves the document's line items untouched", afterDiscard.item);
check("discarding an unsaved vendor never reloaded the page", await sentinelAlive(), `soft navs ${navBeforeDiscard} -> ${navigations}`);
const discardedVendor = (await db.query(`select count(*)::int n from vendors where org_id=$1 and name='Half-typed vendor'`, [org])).rows[0].n;
check("the discarded vendor was never written to the database", discardedVendor === 0, `n=${discardedVendor}`);

// ---------- 4. discard again, this time with a vendor ALREADY selected ----------
// Two dirty trackers live at once; discarding the popup must not clear the document's selection.
const navBeforeSecond = navigations;
dlg = await openVendorPopup();
await dlg.locator('input[name="name"]').fill("Another half-typed one");
await page.waitForTimeout(300);
await dlg.getByRole("button", { name: /^cancel$/i }).first().click();
await page.waitForTimeout(400);
await page.locator('[role="dialog"]').last().getByRole("button", { name: /^Discard$/i }).first().click();
await page.waitForTimeout(1000);

const cardAfter = await page.locator(".party-card-v2").last().innerText();
check("discarding with a vendor already selected keeps that selection", cardAfter.includes(NEW_VENDOR), cardAfter.slice(0, 80));
const afterSecond = await documentStillHas();
check("discarding with a vendor already selected keeps the line items", afterSecond.item);
check("the second discard never reloaded the page", await sentinelAlive(), `soft navs ${navBeforeSecond} -> ${navigations}`);

// ---------- 5. the document still saves, with the popup-created vendor attached ----------
await page.getByRole("button", { name: /Save as Draft/i }).first().click();
await page.waitForTimeout(3000);
const po = (await db.query(
  `select po.id, po.vendor_id, po.title from purchase_orders po where po.org_id=$1 order by po.id desc limit 1`, [org])).rows[0];
check("the purchase order saved", !!po);
check("it saved against the vendor created in the popup", po?.vendor_id === row?.id, `${po?.vendor_id} vs ${row?.id}`);
const poItems = (await db.query(`select description from purchase_order_items where purchase_order_id=$1`, [po?.id])).rows;
check("the line item typed before the popup made it into the saved document",
  poItems.some((r) => (r.description ?? "").includes("Galvanised")), JSON.stringify(poItems).slice(0, 100));

// ---------- 6. the inline action returns rather than redirects ----------
// The dynamic checks above only catch a redirecting action on the popup's FIRST open; a later
// open remounts the form and masks it. Assert the contract directly so the ordering above cannot
// silently stop protecting it.
{
  const { readFile } = await import("node:fs/promises");
  const src = await readFile("src/app/(app)/purchasing/vendors/actions.ts", "utf8");
  const inline = src.slice(src.indexOf("export async function createVendorInlineAction"));
  const body = inline.slice(0, inline.indexOf("\nexport "));
  check("createVendorInlineAction returns the vendor and never redirects",
    /return \{ vendor \}/.test(body) && !/redirect\(/.test(body), body.match(/redirect\([^)]*\)/)?.[0] ?? "");
  check("the full-page create action still redirects (the two entry points stay different)",
    /redirect\(/.test(src.slice(src.indexOf("export async function createVendorAction"), src.indexOf("export async function createVendorInlineAction"))));
}

// ---------- 7. clients still work (the shared card was edited) ----------
await page.goto(`${BASE}/sales/quotations/new`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const quoText = await page.locator("main").innerText();
check("the client side still offers Add New Client, not Add New Vendor",
  /Add New Client/i.test(quoText) && !/Add New Vendor/i.test(quoText), quoText.match(/Add New \w+/g)?.join(",") ?? "");

async function report() {
  await db.end().catch(() => {});
  await browser.close().catch(() => {});
  let ok = true;
  for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
  console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
  console.log(ok ? "VENDOR INLINE VERIFICATION PASS" : "VENDOR INLINE VERIFICATION FAIL");
  process.exit(ok ? 0 : 1);
}
await report();
