/**
 * Document / form shell runtime (DEV-UI-01.6). Static checks cannot prove that a header grid really
 * stacks at 390px, that focus lands on the new line after Add, that the item picker is operable by
 * keyboard, or that a link inserted from the rich-text Dialog wraps the text that was selected. This
 * suite drives the real editors and detail pages:
 *
 *   1. containment — page overflow 0 on the 8 create forms + 3 edit forms at 1440 / 1024 / 768 / 390,
 *      EN + AR; the line table scrolls inside its own box; detail pages + their actions inside 390
 *   2. names — every visible editor control has an accessible name; header labels bound to controls
 *   3. save state — Unsaved changes appears / disappears with the edit; a pending save marks only the
 *      pressed button aria-busy; a server error lands in a focused role=alert region (EN + AR)
 *   4. lines — Add / Remove are real buttons with row names; focus after Add / Remove
 *   5. item picker — combobox / listbox ARIA, ArrowDown / ArrowUp / Enter / Escape, Enter never submits,
 *      the keyboard pick fills the same price / VAT / unit as a mouse pick, the list stays in 390 (AR)
 *   6. Configure Columns — keyboard Move up / down, persistence, AR labels, renamed labels preserved
 *   7. terms — keyboard Move up / down keeps focus; the Settings master editor is unchanged
 *   8. rich text — named, toolbar, dir=auto, the link Dialog keeps the selection, bad protocol
 *      rejected, Cancel changes nothing
 *   9. numbers / RTL — editor numbers at the logical end in AR; status Selects named; lifecycle
 *      actions unchanged; subtotal / discount / VAT / total identical to the business formula
 *
 * TEST-ONLY: runs against the synthetic visual-baseline seed (DEV-UI-01.0) and refuses any database
 * whose name is not a disposable test database. Column configuration it changes is restored.
 */
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { assertFreshBuild } from "./assert-fresh-build.mjs";

const BASE = "http://localhost:3000";
const dbName = (() => { try { return new URL(process.env.DATABASE_URL ?? "").pathname.slice(1); } catch { return ""; } })();
if (!/test/i.test(dbName)) {
  console.error("✗ refusing: DATABASE_URL does not name a disposable TEST database");
  process.exit(2);
}
const OWNER_EMAIL = "owner@visual-baseline.test";
const PW_FILE = ".ui-baseline-work/owner-password";
if (!existsSync(PW_FILE)) {
  console.error("✗ this suite needs the synthetic visual-baseline seed (owner password file missing)");
  process.exit(2);
}
const results = [];
const check = (name, cond, extra = "") => results.push([Boolean(cond), name, extra]);
await assertFreshBuild(BASE);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
ctx.setDefaultTimeout(30000);
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("dialog", (d) => d.accept().catch(() => {})); // beforeunload on a dirty form
await page.goto(`${BASE}/login`);
await page.fill("#email", OWNER_EMAIL);
await page.fill("#password", readFileSync(PW_FILE, "utf8"));
await Promise.all([page.waitForURL(/\/dashboard/, { timeout: 40000 }), page.click('button[type="submit"]')]);
const setPrefs = (prefs) => ctx.addCookies(Object.entries(prefs).map(([name, value]) => ({ name, value, url: BASE })));
const settle = (ms = 300) => page.waitForTimeout(ms);
const layersClosed = () => page.waitForFunction(() => !document.querySelector("[data-radix-popper-content-wrapper], [role='menu'], [role='dialog']"), null, { timeout: 10000 }).catch(() => {});
async function go(path, locale = "en", w = 1440, h = 900) {
  await setPrefs({ locale, theme: "light" });
  await page.setViewportSize({ width: w, height: h });
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await settle(200);
}
const activeInfo = () => page.evaluate(() => {
  const a = document.activeElement;
  const row = a?.closest("tr[data-line-index]");
  return { tag: a?.tagName, name: a?.getAttribute("aria-label") ?? a?.textContent?.trim() ?? "", line: row ? Number(row.getAttribute("data-line-index")) : null,
    lineName: a?.hasAttribute("data-line-item-name") ?? false, add: a?.hasAttribute("data-line-add") ?? false };
});

// In-page accessible-name approximation shared by the checks (aria-label / labelledby / label[for] /
// wrapping label / text / title), the same rules the DEV-UI audits used.
const NAME_FN = `(el) => {
  if (el.getAttribute("aria-label")) return el.getAttribute("aria-label");
  const lb = el.getAttribute("aria-labelledby");
  if (lb) return lb.split(" ").map((i) => document.getElementById(i)?.textContent ?? "").join(" ");
  if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return l.textContent; }
  const wrap = el.closest("label");
  if (wrap) return wrap.textContent;
  if (el.tagName === "BUTTON" && el.textContent.trim()) return el.textContent;
  if (el.title) return el.title;
  return "";
}`;

const Q = "/sales/quotations/new";

// ---------- 1. containment ----------
try {
const CREATE = ["/sales/quotations/new", "/sales/orders/new", "/sales/proforma/new", "/sales/invoices/new", "/sales/delivery-challans/new", "/sales/credit-notes/new", "/purchasing/orders/new", "/purchasing/debit-notes/new"];
const EDIT = ["/sales/quotations/3/edit", "/sales/invoices/6/edit", "/purchasing/orders/3/edit"];
const DETAIL = ["/sales/invoices/3", "/sales/invoices/6", "/sales/quotations/1", "/purchasing/orders/1"];
const VPS = [[1440, 900], [1024, 768], [768, 1024], [390, 844]];
const unnamedAll = [];
const unboundAll = [];
const overlapAll = [];
for (const locale of ["en", "ar"]) for (const [w, h] of VPS) for (const path of [...CREATE, ...EDIT]) {
  await go(path, locale, w, h);
  const m = await page.evaluate((nameSrc) => {
    const nameOf = eval(nameSrc);
    const vw = document.documentElement.clientWidth;
    const main = document.querySelector("main");
    const scroll = main.querySelector(".doc-items-scroll");
    const sr = scroll?.getBoundingClientRect();
    const visible = (e) => e.offsetParent !== null || getComputedStyle(e).position === "fixed";
    const ctrls = [...main.querySelectorAll("input:not([type=hidden]),select,textarea,[role=textbox],[role=combobox],button")].filter(visible);
    const unnamed = ctrls.filter((e) => !nameOf(e).trim()).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]}`);
    // Every editable header field: its <label for> names the control inside the same field.
    const unbound = [...main.querySelectorAll('.doc-field[data-doc-field="control"]')].filter((f) => {
      const l = f.querySelector("label.doc-field-label");
      const target = l?.htmlFor ? document.getElementById(l.htmlFor) : null;
      return !target || !f.contains(target);
    }).map((f) => f.textContent.trim().slice(0, 24));
    return { vw, overflow: document.documentElement.scrollWidth - vw, scroll: scroll ? { ox: getComputedStyle(scroll).overflowX, l: sr.left, r: sr.right } : null, unnamed, unbound,
      thOverlap: [...main.querySelectorAll('.doc-items-table thead th')].filter((th) => th.scrollWidth > th.clientWidth + 1).map((th) => th.textContent.trim()),
      headCols: main.querySelector(".doc-header-grid, .doc-head-grid") ? getComputedStyle(main.querySelector(".doc-header-grid, .doc-head-grid")).gridTemplateColumns.split(" ").length : null };
  }, NAME_FN);
  if (m.thOverlap.length) overlapAll.push(`${path} ${locale}@${w}: ${m.thOverlap.join(",")}`);
  check(`${path} ${locale}@${w}: no page overflow; line table scrolls inside its own box`,
    m.overflow <= 0 && m.scroll && m.scroll.ox === "auto" && m.scroll.r <= m.vw + 0.5 && m.scroll.l >= -0.5, JSON.stringify({ overflow: m.overflow, scroll: m.scroll }));
  if (w === 390) check(`${path} ${locale}@390: header grid stacks to one column`, m.headCols === 1, String(m.headCols));
  if (m.unnamed.length) unnamedAll.push(`${path} ${locale}@${w}: ${m.unnamed.slice(0, 4).join(",")}`);
  if (m.unbound.length) unboundAll.push(`${path} ${locale}@${w}: ${m.unbound.slice(0, 3).join(",")}`);
}
check("every visible editor control has an accessible name (8 create + 3 edit forms, EN + AR, 4 widths)", unnamedAll.length === 0, unnamedAll.slice(0, 4).join(" | "));
check("line-table header labels fit their column (no header text running under the next column), EN + AR", overlapAll.length === 0, overlapAll.slice(0, 4).join(" | "));
check("every editable header field label is bound to the control in its field (DocFieldBox)", unboundAll.length === 0, unboundAll.slice(0, 4).join(" | "));
for (const locale of ["en", "ar"]) for (const path of DETAIL) {
  await go(path, locale, 390, 844);
  const m = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const acts = [...document.querySelectorAll("main .inv-head-actions button, main .inv-head-actions a")].filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; });
    return { vw, overflow: document.documentElement.scrollWidth - vw, acts };
  });
  check(`${path} ${locale}@390: no page overflow; every header action inside the viewport (the group wraps)`,
    m.overflow <= 0 && m.acts.length > 0 && m.acts.every(([l, r]) => l >= -0.5 && r <= m.vw + 0.5), JSON.stringify(m));
}
} catch (e) {
  check("section 1 (containment) ran to completion", false, String(e?.message ?? e).split("\n")[0].slice(0, 240));
  await page.keyboard.press("Escape").catch(() => {});
}

// ---------- 3. save state ----------
try {
for (const locale of ["en", "ar"]) {
  await go(Q, locale);
  const title = page.locator("main input[id$='-title']").first();
  const ind = page.locator("main .doc-dirty-indicator");
  const before = await ind.textContent();
  await title.fill("Runtime check title");
  await settle(150);
  const during = await ind.evaluate((e) => ({ text: e.textContent, role: e.getAttribute("role"), live: e.getAttribute("aria-live"), shown: getComputedStyle(e).display !== "none" }));
  await title.fill("");
  await settle(150);
  const after = await ind.evaluate((e) => ({ text: e.textContent, shown: getComputedStyle(e).display !== "none" }));
  const expect = locale === "ar" ? "تغييرات غير محفوظة" : "Unsaved changes";
  check(`${locale}: "Unsaved changes" appears on edit (polite status) and is removed on revert`,
    before === "" && during.text === expect && during.role === "status" && during.live === "polite" && during.shown && after.text === "" && !after.shown, JSON.stringify({ before, during, after }));
}
await go(Q);
await page.locator("main input[id$='-title']").first().fill("Guarded title");
const urlQ = page.url();
await page.locator('aside.sidebar a[href="/dashboard"]').click();
const guardShown = await page.locator("[role=alertdialog], [role=dialog]").first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
await page.keyboard.press("Escape");
await layersClosed();
check("dirty form: the existing navigation confirmation still intercepts a sidebar link (stays, edit kept)",
  guardShown && page.url() === urlQ && (await page.locator("main input[id$='-title']").first().inputValue()) === "Guarded title");
for (const [locale, which] of [["en", "draft"], ["ar", "draft"], ["en", "primary"]]) {
  await go(Q, locale);
  await page.locator("main input[id$='-title']").first().fill("Kept title");
  // Hold the server action for 1.5s so the pending state is observable deterministically.
  let held = 0;
  await page.route("**/sales/quotations/new", async (route) => {
    if (route.request().method() === "POST") { held++; await new Promise((r) => setTimeout(r, 1500)); }
    await route.continue();
  });
  const url = page.url();
  const pressedBtn = which === "draft" ? page.locator("main .doc-titlebar-actions button").first() : page.locator("main .doc-action-bar button").last();
  await pressedBtn.click();
  await settle(250);
  // Re-activating any save button while pending must not submit again (they are disabled).
  await page.evaluate(() => document.querySelectorAll("main .doc-titlebar-actions button, main .doc-action-bar button").forEach((b) => { if (!/Preview|معاينة/.test(b.textContent)) b.click(); }));
  const pending = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("main .doc-titlebar-actions button, main .doc-action-bar button")];
    return btns.map((b) => ({ busy: b.getAttribute("aria-busy"), disabled: b.disabled, top: !!b.closest(".doc-titlebar-actions"), i: [...b.parentElement.children].indexOf(b) }));
  });
  // The existing toast is read as soon as it appears, independently of the region below.
  const toastSeen = await page.locator("[data-sonner-toast]").filter({ hasText: "Choose a client." }).first().waitFor({ timeout: 10000 }).then(() => 1).catch(() => 0);
  const err = page.locator("main [data-doc-form-error]");
  await err.waitFor({ timeout: 10000 }).catch(() => {});
  await settle(200);
  const region = await page.evaluate(() => {
    const e = document.querySelector("main [data-doc-form-error]");
    return e ? { role: e.getAttribute("role"), tabindex: e.getAttribute("tabindex"), focused: document.activeElement === e, text: e.textContent.trim() } : null;
  });
  const busyNow = await page.evaluate(() => document.querySelectorAll("main [aria-busy=true]").length);
  await page.unroute("**/sales/quotations/new");
  const busy = pending.filter((p) => p.busy === "true");
  check(`${locale} ${which}: a pending save marks only the pressed button aria-busy, every save button disabled, one submission`,
    held === 1 && busy.length === 1 && busy[0].top === (which === "draft") && pending.filter((p) => p.disabled).length >= 3 && busyNow === 0, JSON.stringify({ held, pending }));
  // The toast is unchanged: it still shows the server's own (English) text; the region below translates it.
  check(`${locale} ${which}: the existing toast still appears and the typed form state remains`,
    toastSeen >= 1 && (await page.locator("main input[id$='-title']").first().inputValue()) === "Kept title");
  const msg = locale === "ar" ? "اختر العميل." : "Choose a client.";
  check(`${locale} ${which}: the server error lands in a focused role=alert region, translated (no redirect, nothing saved)`,
    region && region.role === "alert" && region.tabindex === "-1" && region.focused && region.text.includes(msg) && page.url() === url, JSON.stringify(region));
  // A new attempt clears the old message first (the region is re-announced, not stacked).
  await page.locator("main .doc-action-bar button").first().click();
  await settle(1200);
  check(`${locale} ${which}: a second failed save shows one error region, refocused`, (await page.locator("main [data-doc-form-error]").count()) === 1 &&
    (await page.evaluate(() => document.activeElement?.hasAttribute("data-doc-form-error"))));
}
} catch (e) {
  check("section 3 (save state) ran to completion", false, String(e?.message ?? e).split("\n")[0].slice(0, 240));
  await page.keyboard.press("Escape").catch(() => {});
}

// ---------- 4. lines ----------
try {
await go(Q);
const rowsCount = () => page.locator("main .doc-items-table tbody tr.item-row").count();
const add = page.locator("main [data-line-add]");
check("Add line item is a real button", (await add.evaluate((b) => b.tagName)) === "BUTTON" && (await add.getAttribute("type")) === "button");
await add.click();
await settle();
let a = await activeInfo();
check("after Add, focus is in the new row's item field", (await rowsCount()) === 2 && a.lineName && a.line === 1, JSON.stringify(a));
await page.keyboard.type("Row two");
await add.press("Enter");
await settle();
a = await activeInfo();
check("Add by keyboard (Enter) adds a row and focuses its item field", (await rowsCount()) === 3 && a.lineName && a.line === 2, JSON.stringify(a));
await page.keyboard.type("Row three");
const del2 = page.locator('main button[aria-label="Remove line item 2"]');
check("Remove is a real button with a row-specific name", (await del2.count()) === 1 && (await del2.evaluate((b) => b.tagName)) === "BUTTON");
await del2.focus();
await page.keyboard.press("Enter");
await settle();
a = await activeInfo();
const valNow = await page.locator("main tr[data-line-index='1'] [data-line-item-name]").inputValue();
check("after Remove, focus moves to the row now in that place (keyboard)", (await rowsCount()) === 2 && a.lineName && a.line === 1 && valNow === "Row three", JSON.stringify({ a, valNow }));
await page.locator('main button[aria-label="Remove line item 2"]').click();
await settle();
a = await activeInfo();
check("removing the last row moves focus to the previous row", (await rowsCount()) === 1 && a.lineName && a.line === 0, JSON.stringify(a));
const cellNames = await page.evaluate(() => [...document.querySelectorAll("main tr[data-line-index='0'] input:not([type=file]):not([type=hidden])")].map((i) => i.getAttribute("aria-label")));
check("every editable line cell carries a column + line name", cellNames.length >= 4 && cellNames.every((n) => n && / — Line 1$/.test(n)), JSON.stringify(cellNames));
await go(Q, "ar");
const arNames = await page.evaluate(() => [...document.querySelectorAll("main tr[data-line-index='0'] input:not([type=file]):not([type=hidden])")].map((i) => i.getAttribute("aria-label")));
check("line cell names localized (AR)", arNames.every((n) => n && / — البند 1$/.test(n)), JSON.stringify(arNames));
} catch (e) {
  check("section 4 (lines) ran to completion", false, String(e?.message ?? e).split("\n")[0].slice(0, 240));
  await page.keyboard.press("Escape").catch(() => {});
}

// ---------- 5. item picker ----------
try {
await go(Q);
const name0 = page.locator("main tr[data-line-index='0'] [data-line-item-name]");
await name0.click();
await name0.fill("Design");
await settle();
const listbox = () => page.locator("[data-item-picker]");
let st = await name0.evaluate((i) => ({ role: i.getAttribute("role"), auto: i.getAttribute("aria-autocomplete"), exp: i.getAttribute("aria-expanded"), ctl: i.getAttribute("aria-controls"), ad: i.getAttribute("aria-activedescendant"), name: i.getAttribute("aria-label") }));
const lb = await listbox().evaluate((l) => ({ id: l.id, role: l.getAttribute("role"), opts: [...l.querySelectorAll("[role=option]")].map((o) => ({ id: o.id, sel: o.getAttribute("aria-selected"), text: o.textContent.trim() })) })).catch(() => null);
check("item picker: combobox (autocomplete list, expanded, controls the listbox, named)",
  st.role === "combobox" && st.auto === "list" && st.exp === "true" && lb && st.ctl === lb.id && st.name === "Item — Line 1" && !st.ad, JSON.stringify({ st, lb }));
check("item picker: a listbox of options with aria-selected", lb?.role === "listbox" && lb.opts.length >= 2 && lb.opts.every((o) => o.sel === "false"), JSON.stringify(lb));
await page.keyboard.press("ArrowDown");
let ad1 = await name0.getAttribute("aria-activedescendant");
await page.keyboard.press("ArrowDown");
let ad2 = await name0.getAttribute("aria-activedescendant");
await page.keyboard.press("ArrowUp");
let ad3 = await name0.getAttribute("aria-activedescendant");
const sel3 = await page.evaluate((id) => document.getElementById(id)?.getAttribute("aria-selected"), ad3);
check("item picker: ArrowDown / ArrowUp move the active option (aria-activedescendant + aria-selected)", ad1 === lb?.opts[0]?.id && ad2 === lb?.opts[1]?.id && ad3 === ad1 && sel3 === "true", JSON.stringify({ ad1, ad2, ad3, sel3 }));
let posted = 0;
const onReq = (r) => { if (r.method() === "POST") posted++; };
page.on("request", onReq);
const urlBefore = page.url();
await page.keyboard.press("Enter");
await settle(600);
page.off("request", onReq);
const kb = await page.evaluate(() => {
  const r = document.querySelector("main tr[data-line-index='0']");
  const v = (n) => r.querySelector(`input[aria-label^="${n} — "]`)?.value;
  return { name: r.querySelector("[data-line-item-name]").value, price: v("Unit Price"), vat: v("VAT %"), unit: v("Unit"), open: !!document.querySelector("[data-item-picker]") };
});
check("item picker: Enter picks the active option and never submits the document", kb.name === "Design services" && !kb.open && posted === 0 && page.url() === urlBefore && (await page.locator("main [data-doc-form-error]").count()) === 0, JSON.stringify({ kb, posted }));
await name0.fill("Des");
await settle();
await page.keyboard.press("Escape");
await settle();
check("item picker: Escape closes the list (aria-expanded false)", (await listbox().count()) === 0 && (await name0.getAttribute("aria-expanded")) === "false");
await page.locator("main [data-line-add]").click();
await settle();
const name1 = page.locator("main tr[data-line-index='1'] [data-line-item-name]");
await name1.fill("Design");
await settle();
await listbox().locator("[role=option]").filter({ hasText: "Design services" }).click();
await settle(600);
const mouse = await page.evaluate(() => {
  const r = document.querySelector("main tr[data-line-index='1']");
  const v = (n) => r.querySelector(`input[aria-label^="${n} — "]`)?.value;
  return { name: r.querySelector("[data-line-item-name]").value, price: v("Unit Price"), vat: v("VAT %"), unit: v("Unit") };
});
check("item picker: the picked product's master price / VAT / unit (Design services: 350 / 15 / hr)", Number(kb.price) === 350 && Number(kb.vat) === 15 && kb.unit === "hr", JSON.stringify(kb));
check("item picker: a keyboard pick fills the same price / VAT / unit as a mouse pick", JSON.stringify(kb.name) === JSON.stringify(mouse.name) && kb.price === mouse.price && kb.vat === mouse.vat && kb.unit === mouse.unit && !!mouse.price,
  JSON.stringify({ kb, mouse }));
// Opening from empty with ArrowUp activates the last option; it must be scrolled into view.
const name2 = page.locator("main tr[data-line-index='1'] [data-line-item-name]");
await name2.fill("");
await page.keyboard.press("Escape");
await page.keyboard.press("ArrowUp");
await settle();
const vis = await page.evaluate(() => {
  const l = document.querySelector("[data-item-picker]");
  const id = document.activeElement?.getAttribute("aria-activedescendant");
  const o = id ? document.getElementById(id) : null;
  if (!l || !o) return null;
  const lr = l.getBoundingClientRect(), or = o.getBoundingClientRect();
  return { last: o === [...l.querySelectorAll("[role=option]")].at(-1), inView: or.top >= lr.top - 1 && or.bottom <= lr.bottom + 1, scrolled: l.scrollTop };
});
check("item picker: the active option is scrolled into view", vis && vis.last && vis.inView, JSON.stringify(vis));
await page.keyboard.press("Escape");
for (const locale of ["en", "ar"]) {
  await go(Q, locale, 390, 844);
  const n = page.locator("main tr[data-line-index='0'] [data-line-item-name]");
  await n.scrollIntoViewIfNeeded();
  await n.click();
  await settle();
  const pos = await page.evaluate(() => {
    const l = document.querySelector("[data-item-picker]"), i = document.activeElement;
    if (!l) return null;
    const lr = l.getBoundingClientRect(), ir = i.getBoundingClientRect();
    return { l: lr.left, r: lr.right, il: ir.left, ir: ir.right, vw: document.documentElement.clientWidth };
  });
  const startAligned = pos && (locale === "ar" ? Math.abs(pos.r - pos.ir) <= 1.5 : Math.abs(pos.l - pos.il) <= 1.5);
  check(`item picker ${locale}@390: the list opens at the field's inline start, inside the viewport`, pos && startAligned && pos.l >= -0.5 && pos.r <= pos.vw + 0.5, JSON.stringify(pos));
  await page.keyboard.press("Escape");
}
} catch (e) {
  check("section 5 (item picker) ran to completion", false, String(e?.message ?? e).split("\n")[0].slice(0, 240));
  await page.keyboard.press("Escape").catch(() => {});
}

// ---------- 6. Configure Columns ----------
try {
const headers = () => page.evaluate(() => [...document.querySelectorAll("main .doc-items-table thead th")].map((th) => th.textContent.trim()));
async function openColumns() {
  await page.locator("main button.doc-pill-btn").filter({ hasText: /Edit Columns|تعديل الأعمدة/ }).click();
  await page.getByRole("dialog").waitFor();
  await settle();
}
const dialogRows = () => page.evaluate(() => [...document.querySelectorAll("[role=dialog] [data-cc-key]")].map((r) => r.getAttribute("data-cc-key")));
await go(Q);
const h0 = await headers();
await openColumns();
const keys0 = await dialogRows();
const ccNamed = await page.evaluate((nameSrc) => {
  const nameOf = eval(nameSrc);
  const d = document.querySelector("[role=dialog]");
  const c = [...d.querySelectorAll("input,button,[role=combobox],textarea")].filter((e) => e.offsetParent !== null);
  return { total: c.length, unnamed: c.filter((e) => !nameOf(e).trim()).map((e) => e.outerHTML.slice(0, 60)) };
}, NAME_FN);
check("Configure Columns: every control in the dialog is named", ccNamed.total > 20 && ccNamed.unnamed.length === 0, JSON.stringify(ccNamed.unnamed.slice(0, 3)));
const firstRow = page.locator(`[role=dialog] [data-cc-key="${keys0[0]}"]`);
const lastRow = page.locator(`[role=dialog] [data-cc-key="${keys0.at(-1)}"]`);
check("Configure Columns: first Move up and last Move down disabled; Actions locked last (not movable)",
  (await firstRow.locator('[data-cc-move="up"]').isDisabled()) && (await lastRow.locator('[data-cc-move="down"]').isDisabled()) && !keys0.includes("actions"), JSON.stringify(keys0));
await firstRow.locator('[data-cc-move="down"]').focus();
await page.keyboard.press("Enter");
await settle();
const keys1 = await dialogRows();
const focusKey = await page.evaluate(() => document.activeElement?.closest("[data-cc-key]")?.getAttribute("data-cc-key") + ":" + document.activeElement?.getAttribute("data-cc-move"));
check("Configure Columns: keyboard Move down reorders and keeps focus on the moved column's control",
  keys1[0] === keys0[1] && keys1[1] === keys0[0] && focusKey === `${keys0[0]}:down`, JSON.stringify({ keys1: keys1.slice(0, 3), focusKey }));
await page.keyboard.press("Enter"); // moved row is now at index 1 → index 2
await settle();
const upBtn = page.locator(`[role=dialog] [data-cc-key="${keys0[0]}"] [data-cc-move="up"]`);
await upBtn.focus();
await page.keyboard.press("Enter");
await settle();
const keys2 = await dialogRows();
check("Configure Columns: keyboard Move up reorders back", keys2[1] === keys0[0] && keys2[0] === keys0[1], JSON.stringify(keys2.slice(0, 3)));
// Rename the Qty column, save (persistence), reload.
const qtyLabel = page.locator('[role=dialog] [data-cc-key="quantity"] input').first();
await qtyLabel.fill("Pieces");
await page.getByRole("dialog").getByRole("button", { name: "Save Configuration" }).click();
await layersClosed();
await page.waitForLoadState("networkidle");
await go(Q);
const h1 = await headers();
check("Configure Columns: the new order and the renamed label persist after reload",
  h1.indexOf("Pieces") >= 0 && h1[0] === h0[1] && h1[1] === h0[0], JSON.stringify({ h0: h0.slice(0, 4), h1: h1.slice(0, 4) }));
await go(Q, "ar");
const hAr = await headers();
check("Configure Columns AR: built-in labels translated in the table, the user's renamed label kept as typed",
  hAr.includes("Pieces") && !hAr.includes("Unit Price") && !hAr.includes("Item Description") && hAr.some((x) => /[؀-ۿ]/.test(x)), JSON.stringify(hAr));
await openColumns();
const arLabels = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[role=dialog] [data-cc-key]")].map((r) => [r.getAttribute("data-cc-key"), r.querySelector("input")?.value])));
check("Configure Columns AR: the dialog shows translated built-in labels and the renamed one as stored",
  arLabels.quantity === "Pieces" && /[؀-ۿ]/.test(arLabels.unitPrice ?? "") && /[؀-ۿ]/.test(arLabels.description ?? ""), JSON.stringify(arLabels));
await page.keyboard.press("Escape");
await layersClosed();
// Restore: original order and the English default label (stored labels equal the defaults again).
await go(Q);
await openColumns();
await page.locator('[role=dialog] [data-cc-key="quantity"] input').first().fill("Qty");
await page.locator(`[role=dialog] [data-cc-key="${keys0[0]}"] [data-cc-move="up"]`).click();
await settle();
await page.getByRole("dialog").getByRole("button", { name: "Save Configuration" }).click();
await layersClosed();
await page.waitForLoadState("networkidle");
await go(Q);
check("Configure Columns: configuration restored (order and labels back to the defaults)", JSON.stringify(await headers()) === JSON.stringify(h0), JSON.stringify(await headers()));
} catch (e) {
  check("section 6 (Configure Columns) ran to completion", false, String(e?.message ?? e).split("\n")[0].slice(0, 240));
  await page.keyboard.press("Escape").catch(() => {});
}

// ---------- 7. terms ----------
try {
await go(Q);
await page.getByRole("tab", { name: /Terms & Conditions/ }).click();
await settle();
const addTerm = page.locator("main button").filter({ hasText: "Add Individual Term" });
for (const text of ["Alpha term", "Beta term", "Gamma term"]) {
  await addTerm.click();
  await settle(150);
  await page.locator("main [data-term-index]").last().locator("textarea").fill(text);
}
const terms = () => page.evaluate(() => [...document.querySelectorAll("main [data-term-index] textarea")].map((t) => t.value));
const tNames = await page.evaluate(() => [...document.querySelectorAll("main [data-term-index] textarea")].map((t) => [t.getAttribute("aria-label"), t.getAttribute("dir")]));
check("document terms: each term textarea named (Term N) with dir=auto", tNames.length === 3 && tNames.every(([n, d], i) => n === `Term ${i + 1}` && d === "auto"), JSON.stringify(tNames));
await page.locator("main [data-term-index='0'] [data-term-move='down']").focus();
await page.keyboard.press("Enter");
await settle();
const t1 = await terms();
const tf = await page.evaluate(() => document.activeElement?.closest("[data-term-index]")?.getAttribute("data-term-index") + ":" + document.activeElement?.getAttribute("data-term-move"));
check("document terms: keyboard Move down reorders and keeps focus on the moved term", JSON.stringify(t1) === JSON.stringify(["Beta term", "Alpha term", "Gamma term"]) && tf === "1:down", JSON.stringify({ t1, tf }));
await page.locator("main [data-term-index='2'] [data-term-move='up']").focus();
await page.keyboard.press("Enter");
await settle();
const t2 = await terms();
check("document terms: keyboard Move up; first Up / last Down disabled",
  JSON.stringify(t2) === JSON.stringify(["Beta term", "Gamma term", "Alpha term"]) && (await page.locator("main [data-term-index='0'] [data-term-move='up']").isDisabled()) &&
  (await page.locator("main [data-term-index='2'] [data-term-move='down']").isDisabled()), JSON.stringify(t2));
await go("/settings/presets");
await page.getByRole("tab", { name: "Terms & Conditions Groups" }).click();
await settle();
const editGroup = page.locator('main [role=tabpanel][data-state="active"] .add-row-btn'); // "Add Terms Group"
let master = null;
if (await editGroup.count()) {
  await editGroup.click();
  await page.getByRole("dialog").waitFor();
  await settle();
  const addMaster = page.getByRole("dialog").locator("button.doc-pill-btn").last();
  await addMaster.click().catch(() => {});
  await settle();
  master = await page.evaluate(() => {
    const d = document.querySelector("[role=dialog]");
    const pill = [...d.querySelectorAll("button.doc-pill-btn")].at(-1);
    return { moves: d.querySelectorAll("[data-term-move]").length, docInputs: d.querySelectorAll(".doc-term-input").length, textareas: d.querySelectorAll("textarea").length,
      pillH: pill ? getComputedStyle(pill).height : null, pillFont: pill ? getComputedStyle(pill).fontSize : null, compact: pill?.classList.contains("compact") };
  });
  await page.keyboard.press("Escape");
}
check("Settings master terms editor unchanged (no document move controls, original Add button 30px / 11.5px)",
  master && master.moves === 0 && master.docInputs === 0 && master.textareas >= 1 && master.pillH === "30px" && master.pillFont === "11.5px" && !master.compact, JSON.stringify(master));
} catch (e) {
  check("section 7 (terms) ran to completion", false, String(e?.message ?? e).split("\n")[0].slice(0, 240));
  await page.keyboard.press("Escape").catch(() => {});
}

// ---------- 8. rich text ----------
try {
for (const locale of ["en", "ar"]) {
  await go(Q, locale);
  await page.getByRole("tab").nth(1).click();
  await settle();
  if ((await page.locator("main .rte-editable").count()) === 0) {
    await page.locator("main [role=tabpanel] button.doc-pill-btn").last().click();
    await settle();
  }
  const ed = page.locator("main .rte-editable").first();
  const info = await ed.evaluate((e) => ({ role: e.getAttribute("role"), name: e.getAttribute("aria-label"), dir: e.getAttribute("dir"), ml: e.getAttribute("aria-multiline"),
    tb: e.closest(".doc-note-box")?.querySelector("[role=toolbar]")?.getAttribute("aria-label") }));
  const expName = locale === "ar" ? "ملاحظة" : "Note";
  check(`${locale}: rich text named (${expName}), multiline textbox, dir=auto, inside a named toolbar group`,
    info.role === "textbox" && info.name === expName && info.dir === "auto" && info.ml === "true" && info.tb && info.tb.endsWith(expName), JSON.stringify(info));
}
await go(Q);
await page.getByRole("tab").nth(1).click();
await settle();
if ((await page.locator("main .rte-editable").count()) === 0) { await page.locator("main [role=tabpanel] button.doc-pill-btn").last().click(); await settle(); }
const ed = page.locator("main .rte-editable").first();
await ed.click();
await page.keyboard.type("hello world");
const selectWorld = () => ed.evaluate((e) => {
  const node = [...e.childNodes].find((n) => n.nodeType === 3 && n.textContent.includes("world")) ?? e.firstChild;
  const i = node.textContent.indexOf("world");
  const r = document.createRange();
  r.setStart(node, i); r.setEnd(node, i + 5);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
});
await selectWorld();
const htmlBefore = await ed.innerHTML();
await page.locator("main [data-rte-link]").click();
await page.locator("[data-rte-link-dialog]").waitFor();
await page.locator("[data-rte-link-dialog] input").fill("https://cancel.example");
await page.locator("[data-rte-link-dialog]").getByRole("button", { name: "Cancel" }).click();
await layersClosed();
await settle();
check("rich text: Cancel in the link Dialog changes nothing", (await ed.innerHTML()) === htmlBefore, await ed.innerHTML());
await selectWorld();
await page.locator("main [data-rte-link]").click();
await page.locator("[data-rte-link-dialog]").waitFor();
await page.locator("[data-rte-link-dialog] input").fill("javascript:alert(1)");
await page.keyboard.press("Enter");
await settle();
const rejected = await page.evaluate(() => ({ open: !!document.querySelector("[data-rte-link-dialog]"), alert: document.querySelector("[data-rte-link-dialog] [role=alert]")?.textContent ?? null,
  invalid: document.querySelector("[data-rte-link-dialog] input")?.getAttribute("aria-invalid") }));
check("rich text: an invalid protocol is rejected in the Dialog (role=alert, aria-invalid, stays open)", rejected.open && !!rejected.alert && rejected.invalid === "true", JSON.stringify(rejected));
await page.locator("[data-rte-link-dialog] input").fill("https://example.com/docs");
await page.keyboard.press("Enter");
await layersClosed();
await settle(300);
const linked = await ed.evaluate((e) => ({ html: e.innerHTML, focused: document.activeElement === e, a: [...e.querySelectorAll("a")].map((x) => [x.getAttribute("href"), x.textContent]) }));
check("rich text: the link wraps exactly the selected text and focus returns to the editor", linked.a.length === 1 && linked.a[0][0] === "https://example.com/docs" && linked.a[0][1] === "world" && linked.focused, JSON.stringify(linked));
} catch (e) {
  check("section 8 (rich text) ran to completion", false, String(e?.message ?? e).split("\n")[0].slice(0, 240));
  await page.keyboard.press("Escape").catch(() => {});
}

// ---------- 9. numbers / RTL, status, lifecycle, business parity ----------
try {
await go(Q, "ar");
const align = await page.evaluate(() => {
  const ta = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).textAlign : null; };
  const td = [...document.querySelectorAll("main .doc-items-table tbody td.num")].find((x) => x.querySelector(".cellval") || x.classList.contains("cellval"));
  const span = td?.querySelector(".cellval") ?? null;
  let endSide = null;
  if (td && span) { const a = td.getBoundingClientRect(), b = span.getBoundingClientRect(); endSide = b.left - a.left < a.right - b.right; } // RTL: inline end = left
  return { th: ta("main .doc-items-table thead th.num"), td: ta("main .doc-items-table td.num"), input: ta("main .item-cell-input"), disc: ta("main .doc-totals-card .t-row.discount .v input"), endSide,
    pcEdit: (() => { const e = document.querySelector("main .party-card-v2 .pc-edit"); const c = e?.closest(".party-card-v2"); if (!e || !c) return null; return e.getBoundingClientRect().left - c.getBoundingClientRect().left < 40; })() };
});
check("AR: editor numbers at the logical end (th, computed cells, line inputs, discount) and the computed values sit on the left",
  align.th === "end" && align.td === "end" && align.input === "end" && align.disc === "end" && align.endSide === true, JSON.stringify(align));
check("AR: the party card edit button sits at the inline end (left)", align.pcEdit === true, JSON.stringify(align.pcEdit));
for (const locale of ["en", "ar"]) {
  await go("/sales/quotations/1", locale);
  const nm = await page.locator("main [role=combobox]").first().getAttribute("aria-label");
  check(`${locale}: the detail status Select is named`, nm === (locale === "ar" ? "تغيير حالة عرض السعر" : "Change quotation status"), String(nm));
}
const BASE_ACTIONS = {
  "/sales/invoices/3|en": ["Download PDF", "Void", "Record Payment", "Convert to…"], "/sales/invoices/6|en": ["Edit", "Download PDF", "Send Invoice"],
  "/sales/quotations/1|en": ["Download PDF", "Accepted", "Convert to…"], "/purchasing/orders/1|en": ["Download PDF", "Convert to…"],
  "/sales/invoices/3|ar": ["تنزيل PDF", "إلغاء", "تسجيل دفعة", "تحويل إلى…"], "/sales/invoices/6|ar": ["تعديل", "تنزيل PDF", "إرسال الفاتورة"],
  "/sales/quotations/1|ar": ["تنزيل PDF", "مقبول", "تحويل إلى…"], "/purchasing/orders/1|ar": ["تنزيل PDF", "تحويل إلى…"],
};
for (const [key, expected] of Object.entries(BASE_ACTIONS)) {
  const [path, locale] = key.split("|");
  await go(path, locale);
  const got = await page.evaluate(() => [...document.querySelectorAll("main .inv-head-actions button, main .inv-head-actions a")].filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim().slice(0, 22)));
  check(`${path} ${locale}: lifecycle actions identical to the pre-change baseline`, JSON.stringify(got) === JSON.stringify(expected), JSON.stringify(got));
}
for (const locale of ["en", "ar"]) {
  await go(Q, locale);
  const ed2 = await page.evaluate(() => ["main .doc-items-table thead th.num", "main .doc-items-table td.num", "main .item-cell-input"].map((sel) => getComputedStyle(document.querySelector(sel)).textAlign));
  await go("/sales/invoices/3", locale);
  const det = await page.evaluate(() => [...document.querySelectorAll('main table.data-table [data-cell="numeric"]')].map((c) => getComputedStyle(c).textAlign));
  check(`${locale}: editor numeric cells and detail numeric Table cells end-align`, ed2.every((x) => x === "end") && det.length >= 4 && det.every((x) => x === "end"), JSON.stringify({ ed2, det }));
}
// Business parity: two lines + a discount, compared with the totals formula (discount before VAT).
await go(Q);
const fillLine = async (i, qty, price, vat) => {
  const r = page.locator(`main tr[data-line-index='${i}']`);
  await r.locator("[data-line-item-name]").fill(`Parity line ${i + 1}`);
  await page.keyboard.press("Escape");
  await r.locator('input[aria-label^="Qty — "]').fill(qty);
  await r.locator('input[aria-label^="Unit Price — "]').fill(price);
  await r.locator('input[aria-label^="VAT % — "]').fill(vat);
};
await fillLine(0, "3", "100.50", "15");
await page.locator("main [data-line-add]").click();
await settle();
await fillLine(1, "2", "49.75", "0");
await page.locator('main input[aria-label="Discount"]').fill("10");
await settle(300);
const shown = await page.evaluate(() => [...document.querySelectorAll("main .doc-totals-card .t-row")].map((r) => ((r.querySelector(".v")?.textContent ?? "").match(/\d[\d,]*\.\d+/)?.[0] ?? "").replace(/,/g, "")));
const items = [[3, 100.5, 15], [2, 49.75, 0]];
let sub = 0, tax = 0;
for (const [q, p, v] of items) { sub += q * p; tax += q * p * (v / 100); }
const disc = 10, taxable = sub - disc, adj = taxable * (tax / sub), total = taxable + adj;
const r2 = (n) => (Math.round(n * 100) / 100).toFixed(2);
const expected = [r2(sub), "", r2(adj), r2(total)];
check("business parity: subtotal / VAT / total equal the totals formula (discount before VAT)",
  shown[0] === expected[0] && shown[2] === expected[2] && shown[3] === expected[3], JSON.stringify({ shown, expected }));

await go("/sales/quotations/3/edit");
const editTotals = await page.evaluate(() => [...document.querySelectorAll("main .doc-totals-card .t-row")].map((r) => (((r.querySelector(".v input")?.value ?? r.querySelector(".v")?.textContent) ?? "").match(/\d[\d,]*(\.\d+)?/)?.[0] ?? "").replace(/,/g, "")));
await page.locator("main .doc-action-bar button").filter({ hasText: "Save Changes" }).click();
await page.waitForURL((u) => /\/sales\/quotations\/3$/.test(u.pathname), { timeout: 30000 }).catch(() => {});
await page.waitForLoadState("networkidle");
const detTotals = await page.evaluate(() => ({
  first: (document.querySelector("main .totals-strip .t-row .v")?.textContent.match(/\d[\d,]*\.\d+/)?.[0] ?? "").replace(/,/g, ""),
  final: (document.querySelector("main .totals-strip .t-row.final .v")?.textContent.match(/\d[\d,]*\.\d+/)?.[0] ?? "").replace(/,/g, ""),
  all: [...document.querySelectorAll("main .totals-strip .t-row .v")].map((v) => (v.textContent.match(/\d[\d,]*\.\d+/)?.[0] ?? "").replace(/,/g, "")),
}));
const n = (x) => Number(x);
check("business parity: saving the TEST draft unchanged keeps subtotal / discount / VAT / total (editor = saved detail)",
  /\/sales\/quotations\/3$/.test(new URL(page.url()).pathname) && n(editTotals[0]) > 0 && n(detTotals.first) === n(editTotals[0]) && n(detTotals.final) === n(editTotals[3]) &&
  detTotals.all.some((v) => n(v) === n(editTotals[2])) && (n(editTotals[1]) === 0 || detTotals.all.some((v) => n(v) === n(editTotals[1]))), JSON.stringify({ editTotals, detTotals }));
} catch (e) {
  check("section 9 (numbers / RTL, status, lifecycle, business parity) ran to completion", false, String(e?.message ?? e).split("\n")[0].slice(0, 240));
  await page.keyboard.press("Escape").catch(() => {});
}

check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
await browser.close();
let ok = true;
for (const [cond, name, extra] of results) { if (!cond) ok = false; if (!cond || process.env.VERBOSE) console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra && !cond ? "  << " + extra : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "DOCUMENT FORM RUNTIME VERIFICATION PASS" : "DOCUMENT FORM RUNTIME VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
