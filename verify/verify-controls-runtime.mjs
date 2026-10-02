/**
 * Controls runtime (DEV-UI-01.4). Reading class strings is not the same as proving what a control
 * computes to after its transitions, that Arrow / Enter really move a combobox, or that the shell's
 * own menus still open after the shared menu CSS changed. Two halves:
 *
 *   A. the REAL primitives (src/components/ui/*), bundled with esbuild from the visual-baseline
 *      gallery (tests/ui-baseline/controls-gallery.tsx) and served by request interception on this
 *      server's origin, inside a page that links the app's own compiled stylesheets — no application
 *      route is added. EN / AR × light / dark (+ 390px for containment):
 *        Button sizes / variants / loading (disabled + aria-busy + spinner), computed keyboard focus
 *        (2px solid --focus, read after the transition settles), Input / Textarea invalid / disabled /
 *        read-only, Select 36px aligned with Input, the Arabic tick at the inline start, Select and
 *        SearchableSelect contained at 390px, SearchableSelect ARIA + ArrowDown / Enter / Escape,
 *        Checkbox Space + checked contrast, native Radio arrows, Tabs arrows + focus, row-menu focus
 *   B. the real app: Compliance Selects, the Reports compare Checkbox, the Client Type radios, and the
 *      shell's account / favorites / notifications menus + shell overflow (no regression).
 *
 * TEST-ONLY: refuses to start unless DATABASE_URL names a disposable test database.
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { build } from "esbuild";
import { join } from "node:path";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const dbName = (() => { try { return new URL(process.env.DATABASE_URL ?? "").pathname.slice(1); } catch { return ""; } })();
if (!/test/i.test(dbName)) {
  console.error("✗ refusing: DATABASE_URL does not name a disposable TEST database");
  process.exit(2);
}
const pass = "Qx7#vLm2$Rt9wZp4";
const uniq = () => Math.random().toString(36).slice(2, 8);
const ownerEmail = `ctl_${uniq()}@t.dev`;
const results = [];
const check = (name, cond, extra = "") => results.push([Boolean(cond), name, extra]);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await assertFreshBuild(BASE);

const gallery = (await build({
  entryPoints: [join(process.cwd(), "tests/ui-baseline/controls-gallery.tsx")],
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", target: "es2022",
  tsconfig: join(process.cwd(), "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' }, logLevel: "error", minify: true,
})).outputFiles[0].text;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
ctx.setDefaultTimeout(45000);
ctx.setDefaultNavigationTimeout(60000);
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

// ---- an owner org ----
await page.goto(`${BASE}/register`);
await page.fill('input[name="orgName"]', "Controls Runtime Co");
await page.fill('input[name="name"]', "Controls Owner");
await page.fill('input[name="email"]', ownerEmail);
await page.fill('input[name="password"]', pass);
const cf = page.locator('input[name="confirmPassword"]');
if (await cf.count()) await cf.fill(pass);
await pickCountry(page);
await page.getByRole("button", { name: /register|create|sign up/i }).first().click();
await page.waitForURL(/\/dashboard/, { timeout: 40000 });
await page.waitForLoadState("networkidle");
const org = (await db.query("select org_id from users where email=$1", [ownerEmail])).rows[0].org_id;
await db.query("insert into customers (org_id, name, email) values ($1, 'Erase Me Trading (Fictional)', 'erase@t.dev')", [org]);
const app = await page.evaluate(() => ({
  sheets: [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute("href")),
  htmlClass: document.documentElement.className,
}));
check("the app's compiled stylesheets were found for the gallery", app.sheets.length > 0);

const settle = (ms = 320) => page.waitForTimeout(ms); // > the 150ms colour / outline transition
const setPrefs = (prefs) => ctx.addCookies(Object.entries(prefs).map(([name, value]) => ({ name, value, url: BASE })));

// ============================================================ A. the primitives (gallery)
async function openGallery(group, locale, theme, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: theme });
  const dir = locale === "ar" ? "rtl" : "ltr";
  const html = `<!doctype html><html lang="${locale}" dir="${dir}" data-theme="${theme}" class="${app.htmlClass}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${app.sheets.map((h) => `<link rel="stylesheet" href="${h}">`).join("")}</head><body class="min-h-full bg-canvas text-ink"><div id="gallery-root"></div><script>window.__GALLERY__=${JSON.stringify({ group, locale })}</script><script>${gallery.replace(/<\/script/g, "<\\/script")}</script></body></html>`;
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route(`${BASE}/__verify-controls/**`, (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
  await page.mouse.move(0, 0); // never hover a control by accident (hover changes the border)
  await page.goto(`${BASE}/__verify-controls/${group}`, { waitUntil: "networkidle" });
  await page.locator("[data-gallery-group]").waitFor();
  await page.evaluate(() => document.fonts.ready);
}
/** A CSS colour expression resolved to rgb() in the current page / theme. */
const resolve = (expr) => page.evaluate((e) => { const d = document.createElement("div"); d.style.color = e; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; }, expr);
async function tabTo(selector, max = 80) {
  await page.evaluate(() => { document.activeElement?.blur(); window.getSelection()?.removeAllRanges(); });
  await page.locator("body").focus().catch(() => {});
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector)) return true;
  }
  return false;
}
const focusStyle = () => page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor, slot: document.activeElement.getAttribute("data-slot") }; });
async function expectFocus(tag, selector) {
  const reached = await tabTo(selector);
  await settle();
  const f = await focusStyle();
  const want = await resolve("var(--focus)");
  check(`${tag}: keyboard focus → 2px solid --focus (settled)`, reached && f.style === "solid" && f.width === "2px" && f.color === want, `${reached} ${JSON.stringify(f)} want ${want}`);
}
const rect = (sel) => page.locator(sel).first().evaluate((el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, width: b.width, height: b.height }; });

for (const locale of ["en", "ar"]) {
  for (const theme of ["light", "dark"]) {
    const T = `${locale}/${theme}`;
    // ---- buttons ----
    await openGallery("buttons", locale, theme);
    const b = await page.evaluate(() => {
      const rows = {};
      for (const row of document.querySelectorAll("[data-gallery-row^='variant=']")) {
        const bs = [...row.querySelectorAll("button")];
        const cs = (el) => getComputedStyle(el);
        rows[row.dataset.galleryRow.slice(8)] = {
          h: bs.slice(0, 5).map((x) => [Math.round(x.getBoundingClientRect().width), Math.round(x.getBoundingClientRect().height)]),
          border: cs(bs[1]).borderTopColor, color: cs(bs[1]).color, weight: cs(bs[1]).fontWeight, size: cs(bs[1]).fontSize, radius: cs(bs[1]).borderTopLeftRadius,
          loading: [bs[6], bs[7]].map((x) => ({ disabled: x.disabled, busy: x.getAttribute("aria-busy"), spinner: !!x.querySelector("[data-slot=button-spinner]"), text: x.textContent.trim(), label: x.getAttribute("aria-label") })),
          disabledOpacity: cs(bs[5]).opacity,
        };
      }
      return rows;
    });
    const sized = Object.entries(b).filter(([v]) => v !== "link");
    const badSize = sized.filter(([, r]) => !(r.h[0][1] === 32 && r.h[1][1] === 36 && r.h[2][1] === 40 && r.h[3][0] === 36 && r.h[3][1] === 36 && r.h[4][0] === 32 && r.h[4][1] === 32)).map(([v, r]) => `${v}:${JSON.stringify(r.h)}`);
    check(`${T}: Button sm 32 / default 36 / lg 40 / icon 36² / icon-sm 32² for every variant`, badSize.length === 0, badSize.join(" "));
    check(`${T}: Button label 13px / 500 / radius 6`, sized.every(([, r]) => r.size === "13px" && r.weight === "500" && r.radius === "6px"), JSON.stringify(sized.map(([v, r]) => [v, r.size, r.weight, r.radius])));
    const transparent = (c) => c === "rgba(0, 0, 0, 0)" || /,\s*0\)$/.test(c);
    check(`${T}: ghost / destructive-ghost / primary borders are transparent; outline / secondary are not`,
      transparent(b.ghost.border) && transparent(b["destructive-ghost"].border) && transparent(b.primary.border) && !transparent(b.outline.border) && !transparent(b.secondary.border),
      JSON.stringify([b.ghost.border, b["destructive-ghost"].border, b.primary.border, b.outline.border, b.secondary.border]));
    check(`${T}: destructive-ghost text is --danger`, b["destructive-ghost"].color === (await resolve("var(--danger)")), b["destructive-ghost"].color);
    check(`${T}: glass renders exactly like secondary`, b.glass.border === b.secondary.border && b.glass.color === b.secondary.color);
    const badLoading = Object.entries(b).filter(([, r]) => !r.loading.every((l) => l.disabled && l.busy === "true" && l.spinner)).map(([v]) => v);
    check(`${T}: loading → disabled + aria-busy + spinner (all variants)`, badLoading.length === 0, badLoading.join(","));
    check(`${T}: loading keeps the label; icon-only keeps its accessible name`, Object.values(b).every((r) => r.loading[0].text.length > 0 && !!r.loading[1].label));
    check(`${T}: disabled buttons at 50% opacity`, Object.values(b).every((r) => r.disabledOpacity === "0.5"));
    if (theme === "light") {
      await expectFocus(`${T} Button`, "[data-slot=button]");
      await expectFocus(`${T} legacy .btn`, "button.btn");
      await expectFocus(`${T} .doc-pill-btn`, "button.doc-pill-btn");
    } else await expectFocus(`${T} Button`, "[data-slot=button]");

    // ---- fields ----
    await openGallery("fields", locale, theme);
    const f = await page.evaluate(() => {
      const cs = (id) => getComputedStyle(document.getElementById(id));
      return {
        inH: document.getElementById("g-in1").getBoundingClientRect().height,
        inBorder: cs("g-in1").borderTopColor, invalidBorder: cs("g-in5").borderTopColor, roBg: cs("g-in4").backgroundColor, inBg: cs("g-in1").backgroundColor,
        disBg: cs("g-in3").backgroundColor, taInvalid: cs("g-ta3").borderTopColor, taDisabled: document.getElementById("g-ta2").disabled, taDisBg: cs("g-ta2").backgroundColor,
        taRadius: cs("g-ta1").borderTopLeftRadius, taSize: cs("g-ta1").fontSize, label: [cs("g-in1").fontSize, getComputedStyle(document.querySelector("label[for=g-in1]")).fontSize, getComputedStyle(document.querySelector("label[for=g-in1]")).fontWeight],
      };
    });
    const danger = await resolve("var(--danger)");
    const disabledBg = await resolve("var(--disabled-background)");
    check(`${T}: Input 36px, control border (not the pale default)`, f.inH === 36 && f.inBorder === (await resolve("var(--border-control)")), `${f.inH} ${f.inBorder}`);
    check(`${T}: Input / Textarea invalid border = --danger`, f.invalidBorder === danger && f.taInvalid === danger, `${f.invalidBorder} ${f.taInvalid}`);
    check(`${T}: Input / Textarea disabled = --disabled-background`, f.disBg === disabledBg && f.taDisabled && f.taDisBg === disabledBg, `${f.disBg} ${f.taDisBg}`);
    check(`${T}: Input read-only is visibly distinct from editable`, f.roBg !== f.inBg, `${f.roBg} vs ${f.inBg}`);
    check(`${T}: Textarea on the Input foundation (6px, 13px)`, f.taRadius === "6px" && f.taSize === "13px");
    check(`${T}: field 13px, Label 12px / 500`, f.label[0] === "13px" && f.label[1] === "12px" && f.label[2] === "500", f.label.join(","));
    await expectFocus(`${T} Input`, "[data-slot=input]");
    await expectFocus(`${T} Textarea`, "textarea");

    // ---- selects ----
    for (const width of [1440, 390]) {
      await openGallery("selects", locale, theme, width);
      if (width === 1440) {
        const [s, i] = [await rect("[data-gallery=select-main]"), await rect("#g-in-al")];
        check(`${T}: Select trigger 36px and aligned with the Input beside it`, s.height === 36 && i.height === 36 && Math.abs(s.top - i.top) < 0.5, `${s.height}/${i.height} Δtop ${s.top - i.top}`);
        check(`${T}: Select invalid border = --danger`, (await page.locator("#g-se4").evaluate((e) => getComputedStyle(e).borderTopColor)) === danger);
        await expectFocus(`${T} SelectTrigger`, "[data-gallery=select-main]");
      }
      await page.click("[data-gallery=select-main]");
      const lb = page.locator('[role="listbox"]');
      await lb.waitFor();
      await settle();
      const geo = await page.evaluate(() => {
        const box = document.querySelector('[role="listbox"]').closest("[data-radix-popper-content-wrapper]") ?? document.querySelector('[role="listbox"]');
        const b = box.getBoundingClientRect();
        const item = document.querySelector('[role="option"][data-state="checked"]');
        const tick = item.querySelector(":scope > span:first-child svg").getBoundingClientRect();
        const text = item.querySelector(":scope > span:last-child").getBoundingClientRect();
        return { direction: getComputedStyle(item).direction, left: b.left, right: b.right, vw: document.documentElement.clientWidth, tickX: tick.left + tick.width / 2, textX: text.left + text.width / 2, bg: getComputedStyle(item).backgroundColor, weight: getComputedStyle(item).fontWeight };
      });
      check(`${T}@${width}: Select content inside the viewport`, geo.left >= -0.5 && geo.right <= geo.vw + 0.5, `${geo.left}..${geo.right} / ${geo.vw}`);
      if (width === 1440) {
        check(`${T}: Select list laid out in the document direction (${locale === "ar" ? "rtl" : "ltr"})`, geo.direction === (locale === "ar" ? "rtl" : "ltr"), geo.direction);
        check(`${T}: Select tick at the inline START (${locale === "ar" ? "right" : "left"} of the label)`, locale === "ar" ? geo.tickX > geo.textX : geo.tickX < geo.textX, `${geo.tickX} vs ${geo.textX}`);
        check(`${T}: Select selected item = accent tint, 600`, geo.bg === (await resolve("var(--accent-tint)")) && geo.weight === "600", `${geo.bg} ${geo.weight}`);
        // keyboard: next option + Enter selects it, Escape-free close
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
        await settle();
        const val = await page.locator("[data-gallery=select-main]").innerText();
        check(`${T}: Select keyboard ArrowDown + Enter selects the next option (Radix behaviour kept)`, (await lb.count()) === 0 && /Part time|دوام جزئي/.test(val), val);
      } else await page.keyboard.press("Escape");
    }

    // ---- searchable ----
    for (const width of [1440, 390]) {
      await openGallery("searchables", locale, theme, width);
      await page.click("#g-ss1");
      await page.locator('[role="listbox"]').waitFor();
      await settle();
      const s = await page.evaluate(() => {
        const cb = document.querySelector('[role="combobox"][aria-controls]');
        const lb = document.getElementById(cb.getAttribute("aria-controls"));
        const ad = cb.getAttribute("aria-activedescendant");
        const pop = lb.closest("[data-radix-popper-content-wrapper]") ?? lb;
        const b = pop.getBoundingClientRect();
        return { focused: document.activeElement === cb, expanded: cb.getAttribute("aria-expanded"), lbRole: lb?.getAttribute("role"), ad, adRole: document.getElementById(ad)?.getAttribute("role"),
          adSelected: document.getElementById(ad)?.getAttribute("aria-selected"), options: lb.querySelectorAll('[role="option"]').length, direction: getComputedStyle(lb).direction, left: b.left, right: b.right, vw: document.documentElement.clientWidth };
      });
      check(`${T}@${width}: SearchableSelect popover inside the viewport`, s.left >= -0.5 && s.right <= s.vw + 0.5, `${s.left}..${s.right} / ${s.vw}`);
      if (width !== 1440) { await page.keyboard.press("Escape"); continue; }
      check(`${T}: SearchableSelect combobox → listbox (aria-controls), expanded, focus in the filter`, s.focused && s.expanded === "true" && s.lbRole === "listbox" && s.options === 4, JSON.stringify(s));
      check(`${T}: SearchableSelect list in the document direction`, s.direction === (locale === "ar" ? "rtl" : "ltr"), s.direction);
      check(`${T}: SearchableSelect aria-activedescendant starts on the selected option`, s.adRole === "option" && s.adSelected === "true", JSON.stringify(s));
      await page.keyboard.press("ArrowDown");
      const ad2 = await page.evaluate(() => { const cb = document.querySelector('[role="combobox"][aria-controls]'); const o = document.getElementById(cb.getAttribute("aria-activedescendant")); return { active: o?.hasAttribute("data-active"), text: o?.textContent }; });
      check(`${T}: ArrowDown moves the active option`, ad2.active && /Cedar|الأرز/.test(ad2.text ?? ""), JSON.stringify(ad2));
      await page.keyboard.press("Enter");
      await settle();
      const after = { open: await page.locator('[role="listbox"]').count(), label: await page.locator("#g-ss1").innerText() };
      check(`${T}: Enter selects the active option and closes`, after.open === 0 && /Cedar|الأرز/.test(after.label), JSON.stringify(after));
      await page.click("#g-ss1");
      await page.locator('[role="listbox"]').waitFor();
      await page.keyboard.type(locale === "ar" ? "الميناء" : "harbor");
      check(`${T}: filtering unchanged (one match)`, (await page.locator('[role="option"]').count()) === 1);
      await page.keyboard.press("Escape");
      await settle();
      check(`${T}: Escape closes and returns focus to the trigger`, (await page.locator('[role="listbox"]').count()) === 0 && (await page.evaluate(() => document.activeElement?.id)) === "g-ss1");
      if (locale === "en" && theme === "light") await expectFocus(`${T} SearchableSelect`, "#g-ss1");
    }

    // ---- checks ----
    await openGallery("checks", locale, theme);
    await expectFocus(`${T} Checkbox`, "[data-slot=checkbox]");
    const cb = page.locator("[data-gallery=cb-1]");
    await page.keyboard.press("Space");
    await settle();
    check(`${T}: Checkbox toggles with Space`, (await cb.getAttribute("data-state")) === "checked");
    const cc = await cb.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, tick: getComputedStyle(el.querySelector("svg")).color }));
    const lum = (c) => { const [r, g, bl] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
    const ratio = (a, c) => { const [x, y] = [lum(a), lum(c)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    check(`${T}: checked tick vs fill ≥ 4.5`, ratio(cc.bg, cc.tick) >= 4.5, `${cc.bg} / ${cc.tick} = ${ratio(cc.bg, cc.tick).toFixed(2)}`);
    check(`${T}: checked fill = --primary`, cc.bg === (await resolve("var(--primary)")), cc.bg);
    await expectFocus(`${T} Radio`, "[data-slot=radio]:checked");
    await page.keyboard.press("ArrowDown"); // company → (government disabled, skipped) → individual
    await settle();
    const r = await page.evaluate(() => ({ checked: document.querySelector("[data-slot=radio]:checked")?.value, focused: document.activeElement?.value }));
    check(`${T}: native radio: arrow key moves selection, disabled option skipped`, r.checked === "individual" && r.focused === "individual", JSON.stringify(r));
    check(`${T}: radio group is one Tab stop`, await page.evaluate(() => { const el = document.activeElement; return el.name === "g-radio"; }) && !(await (async () => { await page.keyboard.press("Tab"); return page.evaluate(() => document.activeElement?.getAttribute("data-slot") === "radio"); })()));

    // ---- tabs + row menu ----
    await openGallery("tabs", locale, theme);
    await expectFocus(`${T} Tab`, '[role="tab"]');
    await page.keyboard.press(locale === "ar" ? "ArrowLeft" : "ArrowRight");
    await settle();
    const tb = await page.evaluate(() => ({ focused: document.activeElement?.textContent, active: document.querySelector('[role="tab"][data-state="active"]')?.textContent, weight: getComputedStyle(document.querySelector('[role="tab"][data-state="active"]')).fontWeight, size: getComputedStyle(document.activeElement).fontSize }));
    check(`${T}: Tabs arrow key moves to and activates the next tab`, tb.focused === tb.active && /Logo|الشعار/.test(tb.active ?? ""), JSON.stringify(tb));
    check(`${T}: Tabs 12px, active 600`, tb.size === "12px" && tb.weight === "600", JSON.stringify(tb));
    await expectFocus(`${T} row-menu button`, ".row-menu-btn");
    await page.keyboard.press("Enter");
    await page.locator('[role="menu"]').waitFor();
    const mi = await page.locator('[role="menuitem"]').first().evaluate((e) => getComputedStyle(e).fontSize);
    await page.keyboard.press("Escape");
    await settle();
    check(`${T}: row menu opens from the keyboard, items 13px, Escape returns focus`, mi === "13px" && (await page.evaluate(() => document.activeElement?.classList.contains("row-menu-btn"))), mi);
  }
}
await page.unrouteAll({ behavior: "ignoreErrors" });
await page.emulateMedia({ colorScheme: "light" });

// ============================================================ B. the real app
await page.setViewportSize({ width: 1440, height: 900 });
await setPrefs({ locale: "en", theme: "light" });
// Compliance: the two former native selects
await page.goto(`${BASE}/settings/compliance`, { waitUntil: "networkidle" });
const comp = await page.evaluate(() => ({ natives: document.querySelectorAll("main select").length, triggers: ["erase-customer", "consent-subject"].map((id) => { const el = document.getElementById(id); return el ? [el.getAttribute("role"), Math.round(el.getBoundingClientRect().height), !!document.querySelector(`label[for=${id}]`)] : null; }) }));
check("compliance: no native <select>; both are 36px combobox triggers with a <label for>", comp.natives === 0 && comp.triggers.every((t) => t && t[0] === "combobox" && t[1] === 36 && t[2]), JSON.stringify(comp));
await page.focus("#consent-subject");
await page.keyboard.press("Enter");
await page.locator('[role="listbox"]').waitFor();
await page.keyboard.press("ArrowDown");
await page.keyboard.press("Enter");
await settle();
check("compliance: consent subject chosen with the keyboard", (await page.locator('[role="listbox"]').count()) === 0 && (await page.locator("#consent-subject").innerText()).trim().length > 0);
await page.click("#erase-customer");
await page.locator('[role="listbox"]').waitFor();
const opts = await page.locator('[role="option"]').count();
if (opts) await page.locator('[role="option"]').first().click();
await settle();
check("compliance: erase-customer lists customers and takes a choice (placeholder before)", opts >= 1 && !/Select a customer/.test(await page.locator("#erase-customer").innerText()), String(opts));

// Reports: compare toggle is the Checkbox primitive and still drives the URL
await page.goto(`${BASE}/finance/reports`, { waitUntil: "networkidle" });
const rcb = page.locator("main [data-slot=checkbox]").first();
check("reports: compare toggle is the Checkbox primitive (no native checkbox)", (await rcb.count()) === 1 && (await page.locator('main input[type="checkbox"]').count()) === 0);
await rcb.click();
await page.waitForURL(/compare=1/, { timeout: 15000 }).catch(() => {});
check("reports: checking compare sets compare=1", /compare=1/.test(page.url()) && (await page.locator("main [data-slot=checkbox]").first().getAttribute("data-state")) === "checked", page.url());
await page.locator("main [data-slot=checkbox]").first().click();
await page.waitForURL((u) => !/compare=1/.test(String(u)), { timeout: 15000 }).catch(() => {});
check("reports: unchecking removes it", !/compare=1/.test(page.url()), page.url());

// Client Type radios (native) keep feeding the form's hidden clientType
await page.goto(`${BASE}/clients/new`, { waitUntil: "networkidle" });
const before = await page.locator('input[type="hidden"][name="clientType"]').inputValue();
await page.locator("[data-slot=radio]:checked").focus();
await page.keyboard.press("ArrowDown");
await settle();
const afterType = await page.locator('input[type="hidden"][name="clientType"]').inputValue();
check("client type: native radios, arrow key switches, hidden clientType follows", (await page.locator('[role="radiogroup"] [data-slot=radio]').count()) === 2 && before !== afterType && ["individual", "company"].includes(afterType), `${before}→${afterType}`);

// Shell menus (frozen shell, shared menu CSS changed) + no new shell overflow
for (const locale of ["en", "ar"]) {
  for (const theme of ["light", "dark"]) {
    await setPrefs({ locale, theme });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    const T = `shell ${locale}/${theme}`;
    // Account, favorites and notifications: every menu trigger in the top bar (Radix sets aria-haspopup).
    const triggers = page.locator('header.topbar [aria-haspopup="menu"]');
    const n = await triggers.count();
    check(`${T}: account + favorites + notifications menu triggers present`, n >= 3, String(n));
    for (let i = 0; i < n; i++) {
      const trig = triggers.nth(i);
      const name = (await trig.getAttribute("aria-label")) ?? `trigger ${i}`;
      await trig.click();
      const menu = page.locator('[role="menu"]');
      const opened = await menu.first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
      const m = opened ? await menu.first().evaluate((el) => { const b = el.getBoundingClientRect(); const it = el.querySelector('[role="menuitem"]'); return { left: b.left, right: b.right, vw: document.documentElement.clientWidth, item: it ? getComputedStyle(it).fontSize : null }; }) : null;
      await page.keyboard.press("Escape");
      await settle();
      const closed = (await page.locator('[role="menu"]').count()) === 0;
      const back = await trig.evaluate((el) => document.activeElement === el);
      check(`${T}: "${name}" menu opens inside the viewport, Escape closes and returns focus`, opened && m.left >= -0.5 && m.right <= m.vw + 0.5 && closed && back, JSON.stringify({ opened, m, closed, back }));
    }
    for (const w of [1440, 390]) {
      await page.setViewportSize({ width: w, height: 900 });
      await settle();
      const o = await page.evaluate(() => { const h = document.querySelector("header.topbar"); return { header: h.scrollWidth - h.clientWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
      check(`${T}@${w}: no shell / page horizontal overflow`, o.header <= 0 && o.page <= 0, JSON.stringify(o));
    }
  }
}

check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
await browser.close();
await db.end();
let ok = true;
for (const [cond, name, extra] of results) { if (!cond) ok = false; if (!cond || process.env.VERBOSE) console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra && !cond ? "  << " + extra : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "CONTROLS RUNTIME VERIFICATION PASS" : "CONTROLS RUNTIME VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
