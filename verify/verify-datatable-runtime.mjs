/**
 * Data tables + list workspace runtime (DEV-UI-01.5). Static checks cannot prove that a sticky column is
 * on screen at 390px, that numbers really sit at the inline end in Arabic, or that a live filter still
 * narrows the same rows. This suite drives the real lists:
 *
 *   1. containment — page overflow 0 and the table scrolling inside its own wrapper on 10 lists at
 *      1440 / 1024 / 768 / 390, EN + AR; /clients included (its header actions wrap)
 *   2. sticky actions — the row-action column stays inside the viewport at 390 EN / AR, even with the
 *      table scrolled to either end
 *   3. density — comfortable 40 / 48 and compact 36 / 40 header / row heights (±1px border)
 *   4. numbers — amount text at the logical inline end, EN and AR
 *   5. RowMenu — localized row-specific name, 36px, keyboard open, disabled placeholders skipped,
 *      convert submenu, Escape returns focus
 *   6. workspace — labelled filter fields, LIVE filtering (same rows as before), active count, Clear,
 *      live search, the no-results row + polite result count, clear-search
 *   7. saved views — Escape / outside / apply keep the menu's focus return; Save + Manage hand focus into their
 *      Dialog (focusin log: the trigger never retakes it; immediate typing keeps the full name); save (≤ 60) /
 *      current / manage → rename (no limit: 69 chars, persisted, reloaded, applied) / delete
 *   8. master data — Enter → ?q= server search unchanged; FilterPanel Apply → ?lowStock=1; the chip
 *   9. payroll keyboard selection; shell account menu unaffected
 *
 * TEST-ONLY: runs against the synthetic visual-baseline seed (DEV-UI-01.0) and refuses any database
 * whose name is not a disposable test database.
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
await page.goto(`${BASE}/login`);
await page.fill("#email", OWNER_EMAIL);
await page.fill("#password", readFileSync(PW_FILE, "utf8"));
await Promise.all([page.waitForURL(/\/dashboard/, { timeout: 40000 }), page.click('button[type="submit"]')]);
// Wait until no popover / menu / dialog layer remains (Radix closes them asynchronously).
const layersClosed = () => page.waitForFunction(() => !document.querySelector("[data-radix-popper-content-wrapper], [role='menu'], [role='dialog']"), null, { timeout: 10000 }).catch(() => {});
const setPrefs = (prefs) => ctx.addCookies(Object.entries(prefs).map(([name, value]) => ({ name, value, url: BASE })));
const settle = (ms = 300) => page.waitForTimeout(ms);
async function go(path, locale = "en", w = 1440, h = 900) {
  await setPrefs({ locale, theme: "light" });
  await page.setViewportSize({ width: w, height: h });
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await settle(200);
}

// ---------- 1 + 2. containment and sticky actions ----------
const LISTS = ["/sales/invoices", "/sales/quotations", "/purchasing/orders", "/clients", "/inventory/products", "/purchasing/vendors", "/finance/payments", "/projects", "/hr/attendance", "/finance/journal"];
const VPS = [[1440, 900], [1024, 768], [768, 1024], [390, 844]];
for (const locale of ["en", "ar"]) for (const [w, h] of VPS) for (const path of LISTS) {
  await go(path, locale, w, h);
  const m = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const wrap = document.querySelector("main .data-table-wrap");
    const r = wrap?.getBoundingClientRect();
    return { vw, overflow: document.documentElement.scrollWidth - vw, wrap: wrap ? { ox: getComputedStyle(wrap).overflowX, left: r.left, right: r.right } : null };
  });
  check(`${path} ${locale}@${w}: no page overflow; table scroll contained in its wrapper`, m.overflow <= 0 && m.wrap && m.wrap.ox === "auto" && m.wrap.right <= m.vw + 0.5 && m.wrap.left >= -0.5, JSON.stringify(m));
}
for (const locale of ["en", "ar"]) for (const path of ["/sales/invoices", "/clients", "/projects", "/finance/payments"]) {
  await go(path, locale, 390, 844);
  const reach = [];
  for (const end of ["start", "end"]) {
    reach.push(await page.evaluate((e) => {
      const wrap = document.querySelector("main .data-table-wrap");
      const max = wrap.scrollWidth - wrap.clientWidth;
      const rtl = getComputedStyle(wrap).direction === "rtl";
      wrap.scrollLeft = e === "start" ? 0 : rtl ? -max : max;
      const cell = document.querySelector('main tbody td[data-cell="action"]');
      const btn = cell?.querySelector("button");
      const c = cell.getBoundingClientRect(), wr = wrap.getBoundingClientRect(), b = btn.getBoundingClientRect();
      return { scrollable: max > 0, inWrap: c.left >= wr.left - 0.5 && c.right <= wr.right + 0.5, inViewport: b.left >= 0 && b.right <= document.documentElement.clientWidth, sticky: getComputedStyle(cell).position, bg: getComputedStyle(cell).backgroundColor };
    }, end));
  }
  check(`${path} ${locale}@390: sticky action column visible with the table scrolled to either end`, reach.every((r) => r.sticky === "sticky" && r.inWrap && r.inViewport && r.bg !== "rgba(0, 0, 0, 0)") && reach[0].scrollable, JSON.stringify(reach));
}

// ---------- 3 + 4. density and numeric alignment ----------
for (const locale of ["en", "ar"]) {
  await go("/sales/invoices", locale);
  const d = await page.evaluate(() => {
    const th = document.querySelector("main table.data-table thead th").getBoundingClientRect().height;
    const rows = [...document.querySelectorAll("main table.data-table tbody tr:not([data-empty-row])")].map((r) => r.getBoundingClientRect().height);
    const cell = document.querySelector('main td[data-cell="numeric"]');
    const span = cell.firstElementChild.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    const cs = getComputedStyle(cell);
    const head = document.querySelector('main th[data-cell="numeric"]');
    return { th, rows, align: cs.textAlign, headAlign: getComputedStyle(head).textAlign, endGap: getComputedStyle(cell).direction === "rtl" ? span.left - (c.left + parseFloat(cs.paddingLeft)) : c.right - parseFloat(cs.paddingRight) - span.right };
  });
  check(`${locale}: comfortable density — header 40, every row 48 (±1)`, Math.abs(d.th - 40) <= 1 && d.rows.length >= 3 && d.rows.every((r) => Math.abs(r - 48) <= 1), JSON.stringify({ th: d.th, rows: d.rows }));
  check(`${locale}: amounts sit at the logical inline END (header too)`, d.align === "end" && d.headAlign === "end" && Math.abs(d.endGap) <= 1.5, JSON.stringify(d));
}
await go("/finance/journal");
const compact = await page.evaluate(() => {
  // The journal page also renders the entry form's line table first; the recent-entries table is the dense one.
  const t = document.querySelector('main table.data-table[data-density="compact"]');
  if (!t) return { density: null, th: 0, rows: [] };
  return { density: t.dataset.density, th: t.querySelector("thead th").getBoundingClientRect().height, rows: [...t.querySelectorAll("tbody tr")].map((r) => r.getBoundingClientRect().height) };
});
check("compact density (journal) — header 36, rows 40 (±1)", compact.density === "compact" && Math.abs(compact.th - 36) <= 1 && compact.rows.every((r) => Math.abs(r - 40) <= 1), JSON.stringify(compact));

// ---------- 5. RowMenu ----------
for (const locale of ["en", "ar"]) {
  await go("/sales/invoices", locale);
  const trig = page.locator("main tbody tr").first().locator(".row-menu-btn");
  const t = await trig.evaluate((b) => ({ name: b.getAttribute("aria-label"), w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height, slot: b.dataset.slot }));
  check(`${locale}: RowMenu trigger = 36px Button, localized row-specific name`, t.slot === "button" && t.w === 36 && t.h === 36 && (locale === "en" ? /^Actions for INV-\d{4}$/.test(t.name) : /^إجراءات INV-\d{4}$/.test(t.name)), JSON.stringify(t));
  await trig.focus();
  await page.keyboard.press("Enter");
  await page.locator('[role="menu"]').waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "menuitem");
  const visited = [];
  for (let i = 0; i < 12; i++) {
    visited.push(await page.evaluate(() => ({ text: document.activeElement?.textContent?.trim(), disabled: document.activeElement?.getAttribute("aria-disabled"), sub: document.activeElement?.classList.contains("has-submenu") })));
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(80); // Radix moves roving focus asynchronously
  }
  const disabledItems = await page.evaluate(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"][aria-disabled="true"]')].map((e) => e.textContent.trim()));
  check(`${locale}: placeholder actions are aria-disabled and the keyboard skips them`, disabledItems.length >= 2 && visited.every((v) => v.disabled !== "true"), JSON.stringify({ disabledItems, visited: visited.map((v) => v.text) }));
  await page.keyboard.press("Escape");
  await settle();
  // convert submenu: the first row whose menu offers "Convert to…" (a void invoice has none)
  const rowCount = await page.locator("main tbody tr").count();
  let found = false;
  for (let r = 0; r < rowCount && !found; r++) {
    const tr = page.locator("main tbody tr").nth(r).locator(".row-menu-btn");
    await tr.focus();
    await page.keyboard.press("Enter");
    await page.locator('[role="menu"]').waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "menuitem");
    found = (await page.locator('[role="menu"] .row-menu-item.has-submenu').count()) > 0;
    if (!found) { await page.keyboard.press("Escape"); await settle(150); }
  }
  for (let i = 0; i < 12 && found; i++) {
    if (await page.evaluate(() => document.activeElement?.classList.contains("has-submenu"))) break;
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(80);
  }
  if (found) await page.keyboard.press("Enter");
  const convert = await page.locator(".row-menu-submenu.open").waitFor({ timeout: 4000 }).then(() => true).catch(() => false);
  const expanded = await page.evaluate(() => document.querySelector(".row-menu-item.has-submenu")?.getAttribute("aria-expanded"));
  await page.keyboard.press("Escape");
  await settle();
  const back = await page.evaluate(() => document.activeElement?.classList.contains("row-menu-btn"));
  check(`${locale}: convert submenu opens from the keyboard (aria-expanded); Escape closes and returns focus`, convert && expanded === "true" && back, JSON.stringify({ convert, expanded, back }));
}
// the expanded menu stays inside a short viewport (it scrolls instead of running off-screen)
{
  await go("/sales/invoices", "en", 1024, 768);
  const out = [];
  const n = await page.locator("main tbody tr").count();
  for (let r = 0; r < n; r++) {
    await page.locator("main tbody tr").nth(r).locator(".row-menu-btn").click();
    const menu = page.locator('[role="menu"]');
    await menu.waitFor();
    const conv = menu.locator(".row-menu-item.has-submenu");
    if (await conv.count()) {
      await conv.click();
      await page.locator(".row-menu-submenu.open").waitFor({ timeout: 4000 }).catch(() => {});
      await settle(150);
      out.push(await menu.evaluate((m) => { const b = m.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), vh: innerHeight }; }));
    }
    await page.keyboard.press("Escape");
    await layersClosed();
  }
  check("row menu with Convert expanded stays inside a 1024×768 viewport (every row)", out.length > 0 && out.every((b) => b.top >= 0 && b.bottom <= b.vh), JSON.stringify(out));
}

// ---------- 6. workspace filters + search ----------
await go("/sales/invoices");
const statuses = () => page.evaluate(() => [...document.querySelectorAll("main tbody tr:not([data-empty-row])")].map((r) => r.querySelector('[data-slot="status-badge"], .status-tag, [data-status]')?.textContent?.trim() ?? r.textContent));
const total = (await statuses()).length;
await page.locator("main [data-list-filters]").click();
const fields = await page.evaluate(() => {
  const pop = document.querySelector("[data-radix-popper-content-wrapper]");
  return [...pop.querySelectorAll('input, button[role="combobox"]')].map((el) => ({ id: el.id, labelled: !!(el.labels?.length || document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) }));
});
check("workspace filters: 5 fields (status, from, to, party, archived), every one labelled", fields.length === 5 && fields.every((f) => f.labelled), JSON.stringify(fields));
// live: choose a status with the keyboard, the table narrows immediately (no Apply)
const statusTrigger = page.locator("[data-radix-popper-content-wrapper] button[role='combobox']").first();
await statusTrigger.focus();
await page.keyboard.press("Enter");
await page.locator('[role="listbox"]').waitFor();
const option = page.locator('[role="option"]').filter({ hasText: /^Sent$/ });
await option.click();
await settle();
const afterStatus = await page.evaluate(() => ({ rows: document.querySelectorAll("main tbody tr:not([data-empty-row])").length, count: document.querySelector("[data-filter-count]")?.textContent?.trim(), allSent: [...document.querySelectorAll("main tbody tr:not([data-empty-row])")].every((r) => /Sent/.test(r.textContent)) }));
check("workspace filters apply LIVE: status=Sent narrows to the Sent rows, count shows 1", afterStatus.allSent && afterStatus.rows === 3 && afterStatus.rows < total && afterStatus.count === "1", JSON.stringify({ total, ...afterStatus }));
await page.locator("[data-radix-popper-content-wrapper] input[type='date']").first().fill("2026-05-01");
await settle();
const afterDate = await page.evaluate(() => ({ rows: document.querySelectorAll("main tbody tr:not([data-empty-row])").length, count: document.querySelector("[data-filter-count]")?.textContent?.trim() }));
check("date range counts as one more filter (count 2) and narrows live", afterDate.count === "2" && afterDate.rows <= afterStatus.rows, JSON.stringify(afterDate));
await page.locator("[data-radix-popper-content-wrapper] button", { hasText: /Clear filters/ }).click();
await settle();
const cleared = await page.evaluate(() => ({ rows: document.querySelectorAll("main tbody tr:not([data-empty-row])").length, count: document.querySelector("[data-filter-count]") }));
check("Clear filters resets to all rows, no count", cleared.rows === total && cleared.count === null, JSON.stringify({ total, rows: cleared.rows }));
await page.keyboard.press("Escape");
await layersClosed();
// search: live, no-results row + polite status, clear-search
const search = page.locator('main [data-slot="list-search"] input');
check("workspace search is labelled", Boolean(await search.getAttribute("aria-label")));
await search.fill("INV-0003");
await settle();
const one = await page.evaluate(() => ({ rows: document.querySelectorAll("main tbody tr:not([data-empty-row])").length, status: document.querySelector('main [role="status"][aria-live="polite"]')?.textContent?.trim() }));
check("live search narrows immediately; the polite status line reports it", one.rows === 1 && /Showing 1 of/.test(one.status ?? ""), JSON.stringify(one));
await search.fill("zzzz-no-match");
await settle();
const none = await page.evaluate(() => ({ empty: document.querySelector("main tr[data-empty-row]")?.textContent?.trim(), rows: document.querySelectorAll("main tbody tr:not([data-empty-row])").length }));
check("no results: a message row (not an empty <tbody>)", none.rows === 0 && /No records match/.test(none.empty ?? ""), JSON.stringify(none));
await page.locator('main [data-slot="list-search"] button[aria-label]').click();
await settle();
check("clear-search empties only the search", (await search.inputValue()) === "" && (await page.locator("main tbody tr:not([data-empty-row])").count()) === total);

// ---------- 7. saved views by keyboard ----------
// Open the Views menu; a click that lands while a previous layer is still closing is retried (Radix closes
// layers asynchronously), so a flaky open never masquerades as a missing view.
async function openViews() {
  for (let i = 0; i < 3; i++) {
    await layersClosed();
    await page.locator("main [data-list-views]").click();
    if (await page.locator('[role="menu"] [role="menuitem"]').first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false)) { await settle(150); return; }
    await page.keyboard.press("Escape");
  }
}
// Focus recorder for the menu → Dialog handoff. focusin is logged as trigger / menu / dialog:<kind> / tag, and
// focusout as "out:<from>><to>" with its relatedTarget. The regression (measured): ~100 ms after the Dialog
// focuses its control, the closing menu moves focus to the Views trigger — the control blurs with
// relatedTarget = trigger and the Dialog's focus trap pulls focus straight back, so the trigger never even
// logs a focusin. Keystrokes in that gap are lost. Hence focusout is what must be watched.
const startFocusLog = () => page.evaluate(() => {
  window.__focusLog = [];
  if (!window.__focusLogOn) {
    window.__focusLogOn = true;
    const name = (t) => {
      if (!t) return "null";
      const d = t.closest?.("[data-saved-view-dialog]");
      return t.closest?.("[data-list-views]") ? "trigger" : d ? `dialog:${d.dataset.savedViewDialog}` : t.closest?.('[role="menu"]') ? "menu" : String(t.tagName).toLowerCase();
    };
    document.addEventListener("focusin", (e) => window.__focusLog.push(name(e.target)), true);
    document.addEventListener("focusout", (e) => window.__focusLog.push(`out:${name(e.target)}>${name(e.relatedTarget)}`), true);
  }
});
const focusLog = () => page.evaluate(() => window.__focusLog ?? []);
// the regression: once a Dialog holds focus, focus is sent to the Views trigger (focusin on it, or a blur
// whose relatedTarget is the trigger) or the Dialog loses focus at all before the user is done
const triggerStoleFocus = (log) => {
  const i = log.findIndex((x) => x.startsWith("dialog:"));
  return i >= 0 && log.slice(i).some((x) => x === "trigger" || x.endsWith(">trigger") || (x.startsWith("out:dialog:") && !x.split(">")[1].startsWith("dialog:")));
};
const observe = () => settle(400); // an observation window AFTER the interaction (no delay before typing)
const triggerFocused = () => page.waitForFunction(() => document.activeElement?.matches?.("[data-list-views]"), null, { timeout: 3000 }).then(() => true).catch(() => false);
// Ordinary close: open by keyboard, Escape → focus back on the Views trigger (Radix default, not suppressed).
async function escapeRestoresTrigger() {
  await layersClosed();
  await page.locator("main [data-list-views]").focus();
  await page.keyboard.press("Enter");
  await page.locator('[role="menu"]').waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "menuitem");
  await page.keyboard.press("Escape");
  await layersClosed();
  return triggerFocused();
}
try {
check("views menu: Escape closes it and returns focus to the Views trigger (before any dialog handoff)", await escapeRestoresTrigger());
const viewName = `Sent view ${Math.random().toString(36).slice(2, 6)}`;
await page.locator("main [data-list-filters]").click();
await page.locator("[data-radix-popper-content-wrapper] button[role='combobox']").first().click();
await page.locator('[role="option"]').filter({ hasText: /^Sent$/ }).click();
await page.keyboard.press("Escape");
await layersClosed();
// Save current view: menu → Dialog handoff, then IMMEDIATE typing (no settling wait)
await page.locator("main [data-list-views]").focus();
await page.keyboard.press("Enter");
await page.locator('[role="menu"]').waitFor();
await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "menuitem");
await startFocusLog();
await page.keyboard.press("Enter"); // "Save current view" is the first item
const saveInput = page.locator('[data-saved-view-dialog="save"] input');
await saveInput.waitFor();
await page.waitForFunction(() => document.activeElement?.matches?.('[data-saved-view-dialog="save"] input'), null, { timeout: 5000 });
await page.keyboard.type(viewName);
await observe();
const saveState = await saveInput.evaluate((i) => ({ max: i.maxLength, value: i.value, focused: document.activeElement === i }));
const saveLog = await focusLog();
check("save dialog: the name field keeps the 60-character maximum (saveViewAction's limit)", saveState.max === 60, String(saveState.max));
check("save handoff: the Dialog input takes focus, the Views trigger never regains it, and immediate typing keeps the full name",
  saveState.value === viewName && saveState.focused && !triggerStoleFocus(saveLog), JSON.stringify({ value: saveState.value, focused: saveState.focused, log: saveLog }));
await page.keyboard.press("Enter");
await page.locator('[data-saved-view-dialog="save"]').waitFor({ state: "detached", timeout: 15000 });
await page.waitForLoadState("networkidle");
await settle(600);
await openViews();
// router.refresh() after the save lands asynchronously; wait for the new view (≤ 10 s) before counting it
await page.locator('[role="menuitem"]').filter({ hasText: viewName }).waitFor({ timeout: 10000 }).catch(() => {});
const current = await page.locator('[role="menuitem"][aria-current="true"]').filter({ hasText: viewName }).count();
const exact = (await page.locator('[role="menuitem"]').allTextContents()).map((x) => x.trim()).includes(viewName);
check("save succeeds: the view is stored under its full name, listed and marked current", current === 1 && exact);
await page.keyboard.press("Escape");
await layersClosed();
check("no handoff leak: after the Save handoff, Escape on the Views menu again returns focus to the trigger", await escapeRestoresTrigger());
// outside close: the menu closes, nothing opens, and the next ordinary close still restores focus
await openViews();
{ // a raw pointer click on a blank spot of the page (a modal menu blocks pointer events, so no locator click)
  const box = await page.locator("main").boundingBox();
  await page.mouse.click(box.x + box.width - 8, box.y + 8);
}
await layersClosed();
const outsideClosed = (await page.locator('[role="menu"], [role="dialog"]').count()) === 0;
check("outside click closes the Views menu (no dialog); the next Escape close still restores focus to the trigger", outsideClosed && (await escapeRestoresTrigger()));
await page.locator("main [data-list-filters]").click();
await page.locator("[data-radix-popper-content-wrapper] button", { hasText: /Clear filters/ }).click();
await page.keyboard.press("Escape");
await layersClosed();
// apply an existing view: filters apply, the menu closes with Radix's normal focus return (no suppression)
await openViews();
await page.locator('[role="menuitem"]').filter({ hasText: viewName }).click();
await layersClosed();
const applyFocus = await triggerFocused();
await settle();
check("applying the saved view restores its filters (live) and returns focus to the Views trigger (no handoff suppression)",
  (await page.locator("main tbody tr:not([data-empty-row])").count()) === 3 && (await page.locator("[data-filter-count]").textContent()) === "1" && applyFocus);
// Manage saved views: menu → Dialog handoff
await openViews();
await startFocusLog();
await page.locator('[role="menuitem"]').filter({ hasText: /Manage saved views/ }).click();
await page.locator('[data-saved-view-dialog="manage"]').waitFor();
await page.waitForFunction(() => !!document.activeElement?.closest?.('[data-saved-view-dialog="manage"]'), null, { timeout: 5000 });
await observe();
const manageLog = await focusLog();
const manageInside = await page.evaluate(() => !!document.activeElement?.closest?.('[data-saved-view-dialog="manage"]'));
check("manage handoff: focus moves into the Manage dialog and the Views trigger does not take it back", manageInside && !triggerStoleFocus(manageLog), JSON.stringify({ manageInside, log: manageLog }));
await page.locator('[data-saved-view-dialog="manage"] button[aria-label^="Rename"]').filter({ has: page.locator("svg") }).last().click();
await page.locator('[data-saved-view-dialog="rename"]').waitFor();
// Rename has no length limit (renameViewAction, and the window.prompt it replaced): a deterministic 69-character name.
const LONG_NAME = "Sent invoices since May 2026 — renamed beyond the sixty-character cap";
const renameInput = page.locator('[data-saved-view-dialog="rename"] input');
await page.waitForFunction(() => document.activeElement?.matches?.('[data-saved-view-dialog="rename"] input'), null, { timeout: 5000 });
await page.keyboard.press("ControlOrMeta+a");
await page.keyboard.type(LONG_NAME);
const typed = await renameInput.evaluate((i) => ({ max: i.maxLength, value: i.value }));
const storedName = typed.value.trim(); // what the server receives (truncated only if a limit wrongly applies)
check("rename dialog: no 60-character maximum — a 69-character name is accepted as typed", LONG_NAME.length > 60 && typed.max === -1 && typed.value === LONG_NAME, JSON.stringify({ max: typed.max, len: typed.value.length }));
await page.keyboard.press("Enter");
await page.locator('[data-saved-view-dialog="rename"]').waitFor({ state: "detached", timeout: 15000 });
await page.waitForLoadState("networkidle");
await settle(600);
// after a full reload the long name comes back from the TEST-ONLY database and still applies its filters
await page.reload({ waitUntil: "networkidle" });
await settle(300);
await openViews();
const longItem = page.locator('[role="menuitem"]').filter({ hasText: storedName });
const listed = await longItem.count();
const listedText = listed ? (await longItem.first().textContent()).trim() : "";
if (listed) await longItem.first().click();
else await page.keyboard.press("Escape");
await layersClosed();
await settle();
const applied = (await page.locator("main tbody tr:not([data-empty-row])").count()) === 3 && (await page.locator("[data-filter-count]").textContent()) === "1";
check("rename to > 60 characters succeeds (server) and the renamed view is listed after reload and applies", listed === 1 && listedText === LONG_NAME && applied, JSON.stringify({ listed, applied }));
await openViews();
await page.locator('[role="menuitem"]').filter({ hasText: /Manage saved views/ }).click();
await page.locator('[data-saved-view-dialog="manage"]').waitFor();
await page.locator(`[data-saved-view-dialog="manage"] button[aria-label="Delete ${storedName}"]`).click();
await page.getByRole("alertdialog").or(page.getByRole("dialog").last()).getByRole("button", { name: /^Delete$/ }).click();
await page.waitForLoadState("networkidle");
await settle(800);
await page.keyboard.press("Escape");
await layersClosed();
await openViews();
check("delete through the existing confirmation", (await page.locator('[role="menuitem"]').filter({ hasText: storedName }).count()) === 0 && (await page.locator('[role="menuitem"]').filter({ hasText: viewName }).count()) === 0);
await page.keyboard.press("Escape");
} catch (e) {
  check("saved-view flow ran to completion (no step stuck)", false, String(e?.message ?? e).split("\n").filter((l) => /Timeout|waiting for/.test(l)).join(" ").slice(0, 300));
  await page.keyboard.press("Escape").catch(() => {});
}

// ---------- 8. master data: server search + FilterPanel unchanged ----------
await go("/clients");
const cs = page.locator('main [data-slot="list-search"] input');
check("clients search labelled (localized)", (await cs.getAttribute("aria-label")) === "Search clients…");
await cs.fill("Noor");
await page.keyboard.press("Enter");
await page.waitForURL(/\/clients\?q=Noor$/);
await page.waitForLoadState("networkidle");
check("clients: Enter → ?q=Noor → server search (1 row)", (await page.locator("main tbody tr").count()) === 1, page.url());
await go("/inventory/products");
await page.locator("main [data-list-filters]").click();
await page.locator("#low-stock").click();
await page.getByRole("button", { name: "Apply Filters" }).click();
await page.waitForURL(/lowStock=1/);
await page.waitForLoadState("networkidle");
const chip = page.locator('[data-filter-chip="low-stock"]');
check("products: FilterPanel Apply → ?lowStock=1; the active count and a real chip button", (await chip.evaluate((b) => b.tagName)) === "BUTTON" && /Remove filter/.test((await chip.getAttribute("aria-label")) ?? "") &&
  (await page.locator("[data-filter-count]").textContent()) === "1");
await chip.click();
await page.waitForURL((u) => !/lowStock/.test(String(u)));
check("products: the chip removes the filter (URL)", !/lowStock/.test(page.url()));
for (const [path, h1, create] of [["/clients", "العملاء", "عميل جديد"], ["/purchasing/vendors", "الموردون", "مورّد جديد"], ["/inventory/products", "المنتجات", "منتج جديد"]]) {
  await go(path, "ar");
  const head = await page.evaluate(() => ({ h1: document.querySelector("main h1")?.textContent?.trim(), links: [...document.querySelectorAll("main a")].map((a) => a.textContent.trim()) }));
  check(`${path} ar: page header, Recycle Bin and create action translated`, head.h1 === h1 && head.links.includes(create) && head.links.includes("سلة المحذوفات"), JSON.stringify({ h1: head.h1 }));
}

// ---------- 9. payroll keyboard selection; shell menu ----------
await go("/hr/payroll");
const rows = page.locator("main tr[data-payroll-row]");
if ((await rows.count()) >= 2) {
  await rows.nth(1).focus();
  const ring = await rows.nth(1).evaluate((r) => getComputedStyle(r).outlineStyle);
  await page.keyboard.press("Enter");
  await settle();
  const sel = await page.evaluate(() => [...document.querySelectorAll("main tr[data-payroll-row]")].map((r) => r.getAttribute("aria-selected")));
  check("payroll: a row is keyboard-focusable (visible focus) and Enter selects it (aria-selected)", ring !== "none" && sel[1] === "true" && sel.filter((s) => s === "true").length === 1, JSON.stringify({ ring, sel }));
} else check("payroll has rows to select", false, "no payroll rows in the seed");
for (const locale of ["en", "ar"]) {
  await go("/dashboard", locale);
  await page.locator("header.topbar .topbar-profile").click();
  const opened = await page.locator('[role="menu"]').waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  await page.keyboard.press("Escape");
  check(`shell account menu unaffected (${locale})`, opened && (await page.locator('[role="menu"]').count()) === 0);
}

check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
await browser.close();
let ok = true;
for (const [cond, name, extra] of results) { if (!cond) ok = false; if (!cond || process.env.VERBOSE) console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra && !cond ? "  << " + extra : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "DATATABLE RUNTIME VERIFICATION PASS" : "DATATABLE RUNTIME VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
