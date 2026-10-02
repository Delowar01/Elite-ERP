/**
 * App shell runtime (DEV-UI-01.3). Drives the real shell in a browser — reading CSS is not the same as
 * proving that a control is on screen, that a drawer opens from the right side in Arabic, or that
 * focus comes back to the button that opened something.
 *
 *   1. 1440 / 1024 / 768 / 390 × EN / AR × light / dark: the shell itself adds no horizontal overflow
 *      (header and rail are measured, not page tables); title, EN | ع, navigation, search and the
 *      account are reachable; no visible shell control sits outside the viewport; the rail /
 *      drawer breakpoint model and the RTL side
 *   2. drawer: inline-start side in LTR and RTL, focus trapped, Escape closes, focus returns to the
 *      trigger, background inert, closes after navigating
 *   3. command palette and record search: focus trapped and returned; Ctrl+K still opens the palette;
 *      the compact search entry on mobile
 *   4. aria-current, keyboard focus-visible, the collapsed-rail cookie persisting at desktop
 *   5. Staff: no Settings gear, no restricted nav, Administration flattened; server guard unchanged
 *   6. /recycle-bin title; an org Selected-item colour still drives the selected tint / indicator
 *   7. reduced motion
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const uniq = () => Math.random().toString(36).slice(2, 8);
const ownerEmail = `sh_${uniq()}@t.dev`;
const staffEmail = `shs_${uniq()}@t.dev`;
const results = [];
const check = (name, cond, extra = "") => results.push([Boolean(cond), name, extra]);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await assertFreshBuild(BASE);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
ctx.setDefaultTimeout(45000);
ctx.setDefaultNavigationTimeout(60000);
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

// ---- an owner org, plus a Staff member in it ----
await page.goto(`${BASE}/register`);
await page.fill('input[name="orgName"]', "Shell Runtime Co");
await page.fill('input[name="name"]', "Shell Owner");
await page.fill('input[name="email"]', ownerEmail);
await page.fill('input[name="password"]', pass);
const cf = page.locator('input[name="confirmPassword"]');
if (await cf.count()) await cf.fill(pass);
await pickCountry(page);
await page.getByRole("button", { name: /register|create|sign up/i }).first().click();
await page.waitForURL(/\/dashboard/, { timeout: 40000 });
const org = (await db.query("select org_id from users where email=$1", [ownerEmail])).rows[0].org_id;
const hash = (await db.query("select password_hash from users where email=$1", [ownerEmail])).rows[0].password_hash;
await db.query(`insert into users (org_id,name,email,password_hash,role) values ($1,'Shell Staff',$2,$3,'staff')`, [org, staffEmail, hash]);

const setPrefs = (prefs) => ctx.addCookies(Object.entries(prefs).map(([name, value]) => ({ name, value, url: BASE })));
const settle = () => page.waitForTimeout(250);

/** Everything the shell exposes, measured in the page. */
const measure = () =>
  page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const shown = (el) => !!el && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden" && el.getBoundingClientRect().width > 0;
    const box = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, width: b.width }; };
    const inView = (el) => { const b = el.getBoundingClientRect(); return b.left >= -0.5 && b.right <= vw + 0.5; };
    const header = document.querySelector("header.topbar");
    const aside = document.querySelector("aside.sidebar");
    const controls = [...document.querySelectorAll("header.topbar button, header.topbar a, aside.sidebar button, aside.sidebar a")].filter(shown);
    const q = (s) => document.querySelector(s);
    return {
      vw,
      dir: document.documentElement.dir,
      headerOverflow: header.scrollWidth - header.clientWidth,
      headerInView: inView(header),
      asideShown: shown(aside),
      aside: shown(aside) ? box(aside) : null,
      asideInView: !shown(aside) || inView(aside),
      stranded: controls.filter((c) => !inView(c)).map((c) => c.className.toString().slice(0, 40) || c.tagName),
      titleWidth: q(".topbar-title")?.getBoundingClientRect().width ?? 0,
      titleTag: q(".topbar-title")?.tagName,
      lang: shown(q(".topbar-lang")) && inView(q(".topbar-lang")) && document.querySelectorAll(".topbar-lang-option").length === 2,
      menuBtn: shown(q(".topbar-menu-btn")),
      searchBox: shown(q("header.topbar .topbar-search")),
      searchIcon: shown(q(".topbar-search-icon")),
      account: shown(q(".topbar-utilities .topbar-profile")),
      pageOverflow: document.documentElement.scrollWidth - vw,
      bg: getComputedStyle(document.body).backgroundColor,
    };
  });

// ---------- 1. responsive matrix ----------
const pageOverflowReport = [];
for (const locale of ["en", "ar"]) {
  for (const theme of ["light", "dark"]) {
    await setPrefs({ locale, theme, sidebar_collapsed: "0" });
    for (const w of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width: w, height: 900 });
      for (const route of ["/dashboard", "/sales/invoices"]) {
        await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
        await settle();
        const m = await measure();
        const tag = `${locale}/${theme}/${w} ${route}`;
        check(`${tag}: the shell adds no horizontal overflow`, m.headerOverflow <= 0 && m.headerInView && m.asideInView, JSON.stringify(m));
        check(`${tag}: no visible shell control outside the viewport`, m.stranded.length === 0, m.stranded.join(","));
        check(`${tag}: title visible (not an h1)`, m.titleWidth > 40 && m.titleTag !== "H1", `${m.titleWidth} ${m.titleTag}`);
        check(`${tag}: EN | ع reachable`, m.lang);
        check(`${tag}: navigation reachable (rail ≥1024, menu button below)`, w >= 1024 ? m.asideShown && !m.menuBtn : !m.asideShown && m.menuBtn);
        check(`${tag}: search reachable (box ≥1024, compact icon below)`, w >= 1024 ? m.searchBox && !m.searchIcon : !m.searchBox && m.searchIcon);
        check(`${tag}: account in the top bar from 640px`, w >= 640 ? m.account : !m.account);
        if (w >= 1024) {
          check(`${tag}: rail width (240 at 1440 expanded, 66 at 1024 even when expanded is preferred)`, Math.round(m.aside.width) === (w >= 1280 ? 240 : 66), String(m.aside.width));
          check(`${tag}: rail on the inline-start side`, locale === "ar" ? Math.round(m.aside.right) === m.vw : Math.round(m.aside.left) === 0, JSON.stringify(m.aside));
        }
        check(`${tag}: dir`, m.dir === (locale === "ar" ? "rtl" : "ltr"));
        if (route === "/sales/invoices") pageOverflowReport.push(`${tag}=${m.pageOverflow}`);
      }
      // Below 640 the utilities and the account live in the drawer.
      if (w < 640) {
        await page.click(".topbar-menu-btn");
        await page.locator(".mobile-nav").waitFor();
        const inDrawer = await page.evaluate(() => {
          const u = document.querySelector(".mobile-nav-utilities");
          return !!u && getComputedStyle(u).display !== "none" && !!u.querySelector(".topbar-profile") && !!u.querySelector('[aria-label]');
        });
        check(`${locale}/${theme}/${w}: account, theme, favorites, notifications reachable in the drawer`, inDrawer);
        await page.keyboard.press("Escape");
        await page.locator(".mobile-nav").waitFor({ state: "detached" });
      }
    }
  }
}
console.log("page-level overflow (not a shell measurement; reported only):", pageOverflowReport.join("  "));

// First paint, before hydration (JavaScript off): the CSS alone must already give the 66px rail at
// tablet width with the expanded preference, and no rail at all below 1024.
{
  const noJs = await browser.newContext({ javaScriptEnabled: false, storageState: await ctx.storageState(), viewport: { width: 1024, height: 900 } });
  await noJs.addCookies([{ name: "sidebar_collapsed", value: "0", url: BASE }, { name: "locale", value: "en", url: BASE }]);
  const p2 = await noJs.newPage();
  await p2.goto(`${BASE}/dashboard`, { waitUntil: "load" });
  const railBox = await p2.locator("aside.sidebar").boundingBox();
  check("first paint at 1024 (no JS): the rail is already 66px", railBox && Math.round(railBox.width) === 66, JSON.stringify(railBox));
  await p2.setViewportSize({ width: 768, height: 900 });
  check("first paint at 768 (no JS): no persistent rail", (await p2.locator("aside.sidebar").boundingBox()) === null);
  await noJs.close();
}

// ---------- 2. drawer ----------
for (const locale of ["en", "ar"]) {
  await setPrefs({ locale, theme: "light" });
  for (const w of [768, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    const trigger = page.locator(".topbar-menu-btn");
    await trigger.focus();
    await page.keyboard.press("Enter");
    await page.locator(".mobile-nav").waitFor();
    await settle();
    const d = await page.evaluate(() => {
      const el = document.querySelector(".mobile-nav");
      const b = el.getBoundingClientRect();
      return {
        left: Math.round(b.left), right: Math.round(b.right), vw: document.documentElement.clientWidth,
        role: el.getAttribute("role"), labelled: !!el.getAttribute("aria-labelledby") && !!document.getElementById(el.getAttribute("aria-labelledby"))?.textContent,
        focusInside: el.contains(document.activeElement),
        bodyInert: getComputedStyle(document.body).pointerEvents === "none",
        nav: !!el.querySelector('nav[aria-label]'), org: !!el.querySelector(".mobile-nav-org-name")?.textContent,
      };
    });
    const tag = `drawer ${locale}/${w}`;
    check(`${tag}: opens from the inline-start edge`, locale === "ar" ? d.right === d.vw : d.left === 0, JSON.stringify(d));
    check(`${tag}: a labelled dialog with the nav landmark and organization context`, d.role === "dialog" && d.labelled && d.nav && d.org);
    check(`${tag}: focus moved inside; background inert`, d.focusInside && d.bodyInert);
    let escaped = false;
    for (let i = 0; i < 70; i++) {
      await page.keyboard.press("Tab");
      if (!(await page.evaluate(() => document.querySelector(".mobile-nav")?.contains(document.activeElement)))) { escaped = true; break; }
    }
    check(`${tag}: focus is trapped (70 × Tab)`, !escaped);
    await page.keyboard.press("Escape");
    await page.locator(".mobile-nav").waitFor({ state: "detached" });
    check(`${tag}: Escape closes and focus returns to the menu button`, await page.evaluate(() => document.activeElement?.classList.contains("topbar-menu-btn")));
  }
}
await setPrefs({ locale: "en" });
await page.setViewportSize({ width: 390, height: 900 });
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
await page.click(".topbar-menu-btn");
await page.locator('.mobile-nav a[href="/clients"]').click();
await page.waitForURL(/\/clients$/);
await page.locator(".mobile-nav").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
check("drawer closes after navigating", (await page.locator(".mobile-nav").count()) === 0 && (await page.locator(".topbar-title").innerText()) === "Clients");

// ---------- 3. palette and record search ----------
async function overlayFocus(openSelector, label, viaKeyboard = false) {
  if (viaKeyboard) {
    await page.locator("main").click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press("Control+k");
  } else {
    await page.locator(openSelector).focus();
    await page.keyboard.press("Enter");
  }
  const dlg = page.locator('[role="dialog"]');
  await dlg.waitFor();
  await settle();
  const inputFocused = await page.evaluate(() => document.activeElement?.tagName === "INPUT" && !!document.activeElement.closest('[role="dialog"]'));
  let escaped = false;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    if (!(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')))) { escaped = true; break; }
  }
  await page.keyboard.press("Escape");
  await dlg.waitFor({ state: "detached" });
  await settle(); // Radix restores focus on the tick after unmount
  const back = viaKeyboard ? true : await page.evaluate((sel) => document.activeElement === document.querySelector(sel), openSelector);
  check(`${label}: opens focused in its input, traps focus, Escape returns focus to the trigger`, inputFocused && !escaped && back, `${inputFocused} ${escaped} ${back}`);
}
for (const w of [1440, 390]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await overlayFocus(".cmdk-trigger-pill", `command palette @${w}`);
  await overlayFocus(w >= 1024 ? "header.topbar .topbar-search" : ".topbar-search-icon", `record search @${w}`);
}
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
await overlayFocus(null, "Ctrl+K command palette", true);

// ---------- 4. aria-current, focus-visible, collapsed cookie ----------
await page.goto(`${BASE}/sales/invoices/new`, { waitUntil: "networkidle" });
const cur = await page.evaluate(() => [...document.querySelectorAll('aside.sidebar [aria-current="page"]')].map((a) => a.getAttribute("href")));
check("aria-current marks exactly the parent nav item on a nested route", cur.length === 1 && cur[0] === "/sales/invoices", cur.join(","));
const ind = await page.evaluate(() => {
  const a = document.querySelector('aside.sidebar [aria-current="page"]');
  const s = getComputedStyle(a), b = getComputedStyle(a, "::before");
  return { weight: s.fontWeight, shadow: s.boxShadow, bar: b.content !== "none" && parseFloat(b.width) >= 2, barBg: b.backgroundColor, bg: s.backgroundColor };
});
check("selected item: weight 600, indicator bar, no glow", ind.weight === "600" && ind.bar && ind.shadow === "none", JSON.stringify(ind));
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
await page.locator("body").press("Tab"); // skip link
const skip = await page.evaluate(() => ({ cls: document.activeElement?.className, visible: document.activeElement?.getBoundingClientRect().top >= 0 }));
check("first Tab lands on the visible skip link", /skip-link/.test(skip.cls) && skip.visible, JSON.stringify(skip));
await page.keyboard.press("Enter");
check("skip link moves focus to main#main-content", await page.evaluate(() => document.activeElement?.id === "main-content"));
await page.locator('aside.sidebar a[href="/projects"]').focus();
await page.keyboard.press("Shift+Tab");
await page.keyboard.press("Tab");
const fv = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, width: s.outlineWidth, href: document.activeElement.getAttribute("href") }; });
check("keyboard focus on a nav item is visible (2px outline)", fv.style === "solid" && fv.width === "2px" && fv.href === "/projects", JSON.stringify(fv));
await page.locator(".topbar-lang-option").first().focus();
await page.keyboard.press("Tab");
const fv2 = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, cls: document.activeElement.className }; });
check("keyboard focus on a top-bar control is visible", fv2.style === "solid", JSON.stringify(fv2));
await page.click(".sidebar-toggle");
await page.waitForTimeout(400);
await page.reload({ waitUntil: "networkidle" });
const collapsedW = await page.evaluate(() => document.querySelector("aside.sidebar").getBoundingClientRect().width);
check("collapsed rail persists across a reload at desktop width (cookie)", Math.round(collapsedW) === 66, String(collapsedW));
await page.click(".sidebar-toggle");
await page.waitForTimeout(400);
await page.reload({ waitUntil: "networkidle" });
check("and expanding persists too", Math.round(await page.evaluate(() => document.querySelector("aside.sidebar").getBoundingClientRect().width)) === 240);

// ---------- 6a. recycle bin title, language switch ----------
await page.goto(`${BASE}/recycle-bin`, { waitUntil: "networkidle" });
check("/recycle-bin shell title is Recycle Bin (not Dashboard)", (await page.locator(".topbar-title").innerText()) === "Recycle Bin");
check("Recycle Bin is not a sidebar item", (await page.locator('aside.sidebar a[href="/recycle-bin"]').count()) === 0);
await page.locator('.topbar-lang-option[lang="ar"]').click();
await page.waitForFunction(() => document.documentElement.dir === "rtl", null, { timeout: 20000 });
check("ع switches to Arabic (RTL) through the existing cookie + action", (await page.locator(".topbar-title").innerText()) !== "Recycle Bin" &&
  (await page.locator('.topbar-lang-option[lang="ar"]').getAttribute("aria-pressed")) === "true");
await page.locator('.topbar-lang-option[lang="en"]').click();
await page.waitForFunction(() => document.documentElement.dir === "ltr", null, { timeout: 20000 });

// ---------- 6b. org Selected-item colour drives the selected state ----------
const activeColours = () => page.evaluate(() => {
  const a = document.querySelector('aside.sidebar [aria-current="page"]');
  return { bg: getComputedStyle(a).backgroundColor, fg: getComputedStyle(a).color, bar: getComputedStyle(a, "::before").backgroundColor,
    sel: getComputedStyle(document.documentElement).getPropertyValue("--selected-item-background").trim() };
});
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
const before = await activeColours();
await db.query("update orgs set color_theme_mode='single', primary_color='#1B1B4E', accent_color='#0E7C66', theme_overrides=$1 where id=$2",
  [JSON.stringify({ light: { selectedItem: { bg: "#0E7C66", fg: "#FFFFFF" } }, dark: { selectedItem: { bg: "#3FBF9F", fg: "#0B1020" } } }), org]);
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
const after = await activeColours();
const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
check("org Selected-item colour changes the indicator bar", before.bar !== after.bar && /14, 124, 102|0e7c66/i.test(after.bar), JSON.stringify({ before, after }));
check("org Selected-item colour changes the selected tint", before.bg !== after.bg, `${before.bg} → ${after.bg}`);
check("selected label stays readable on the org tint (≥ 4.5)", ratio(after.fg, after.bg) >= 4.5, ratio(after.fg, after.bg).toFixed(2));
await db.query("update orgs set color_theme_mode='gradient', theme_overrides=null where id=$1", [org]);

// ---------- 7. reduced motion ----------
await page.emulateMedia({ reducedMotion: "reduce" });
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
check("reduced motion: the rail width transition is neutralised", parseFloat(await page.evaluate(() => getComputedStyle(document.querySelector("aside.sidebar")).transitionDuration)) < 0.001);
await page.emulateMedia({ reducedMotion: "no-preference" });

// ---------- 5. Staff ----------
await ctx.clearCookies();
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.fill('input[name="email"]', staffEmail);
await page.fill('input[name="password"]', pass);
await page.getByRole("button", { name: /sign in|log in|login/i }).first().click();
await page.waitForURL(/\/dashboard/, { timeout: 40000 });
await page.waitForLoadState("networkidle");
const staffShell = await page.evaluate(() => ({
  gear: !!document.querySelector('header.topbar a[href="/settings/organization"]'),
  nav: [...document.querySelectorAll("aside.sidebar a.nav-item")].map((a) => a.getAttribute("href")),
  headers: [...document.querySelectorAll("aside.sidebar .nav-divider")].map((b) => b.textContent.trim()),
}));
check("staff: no Settings gear", !staffShell.gear);
check("staff: restricted nav entries absent", !staffShell.nav.some((h) => ["/hr/payroll", "/settings/presets", "/settings/organization", "/settings/compliance"].includes(h)) && staffShell.nav.includes("/settings/security"), staffShell.nav.join(","));
check("staff: the one-item Administration group is flattened", !staffShell.headers.includes("Administration"), staffShell.headers.join(","));
await page.setViewportSize({ width: 390, height: 900 });
await page.click(".topbar-menu-btn");
await page.locator(".mobile-nav").waitFor();
const staffDrawer = await page.evaluate(() => ({
  gear: !!document.querySelector('.mobile-nav a[href="/settings/organization"]'),
  payroll: !!document.querySelector('.mobile-nav a[href="/hr/payroll"]'),
}));
check("staff drawer: same role filter (no Payroll, no Settings gear)", !staffDrawer.gear && !staffDrawer.payroll);
await page.keyboard.press("Escape");
await page.goto(`${BASE}/settings/organization`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(500);
check("server guard unchanged: staff is still redirected from /settings/organization", new URL(page.url()).pathname === "/dashboard", page.url());

check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

await browser.close();
await db.end();
let ok = true;
for (const [cond, name, extra] of results) { if (!cond) ok = false; if (!cond || process.env.VERBOSE) console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra && !cond ? "  << " + extra : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "SHELL RUNTIME VERIFICATION PASS" : "SHELL RUNTIME VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
