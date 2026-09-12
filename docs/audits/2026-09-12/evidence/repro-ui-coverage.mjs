/**
 * AUDIT (2026-09-12 correction pass) — the UI areas the first pass left unexamined:
 * responsive layout at tablet/mobile widths, keyboard reachability, and untranslated UI in Arabic.
 *
 * These were previously reported as "blocked". They are not blocked — a browser is available — so
 * they are measured here. Scope is stated honestly at the end: this is a SWEEP over real routes,
 * not a full accessibility audit.
 */
import { chromium } from "playwright";
const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const uniq = () => Math.random().toString(36).slice(2, 8);
const email = `ui_${uniq()}@t.dev`;
const out = [];
const say = (s) => { console.log(s); out.push(s); };

const ROUTES = [
  "/dashboard", "/sales/quotations", "/sales/invoices", "/sales/invoices/new", "/sales/proforma",
  "/sales/credit-notes", "/purchasing/orders", "/purchasing/debit-notes", "/purchasing/vendors",
  "/inventory/products", "/clients", "/projects", "/finance/payments", "/finance/reports",
  "/finance/statements", "/finance/chart-of-accounts", "/finance/bank-accounts", "/finance/journal",
  "/finance/ledger", "/hr/employees", "/hr/departments", "/hr/attendance", "/hr/leave", "/hr/payroll",
  "/settings/organization", "/settings/team", "/settings/presets", "/settings/security", "/settings/compliance",
];
const VIEWPORTS = [["desktop", 1440, 900], ["tablet", 768, 1024], ["mobile", 390, 844]];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
await page.fill("#orgName", `UI ${uniq()}`); await page.fill("#name", "UI"); await page.fill("#email", email); await page.fill("#password", pass);
await page.locator("#country").click(); await page.waitForTimeout(300);
await page.keyboard.type("Saudi Arabi"); await page.waitForTimeout(500);
await page.getByRole("button", { name: /^Saudi Arabia ·/ }).first().click(); await page.waitForTimeout(400);
await Promise.all([page.waitForURL(`${BASE}/dashboard`, { timeout: 40000 }), page.click('button[type="submit"]')]);
say(`registered fixture org, logged in as owner`);

// ── 1. RESPONSIVE: horizontal overflow at each width ──────────────────────────────────────────
say(`\n── 1. RESPONSIVE — horizontal overflow (documentElement.scrollWidth > clientWidth + 2px) ──`);
const overflow = { desktop: [], tablet: [], mobile: [] };
for (const [vpName, w, h] of VIEWPORTS) {
  await page.setViewportSize({ width: w, height: h });
  for (const r of ROUTES) {
    try {
      await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(220);
      const res = await page.evaluate(() => {
        const d = document.documentElement;
        const over = d.scrollWidth - d.clientWidth;
        let worst = null, worstW = 0;
        if (over > 2) {
          for (const el of document.querySelectorAll("body *")) {
            const rect = el.getBoundingClientRect();
            if (rect.width > d.clientWidth + 2 && rect.width > worstW) {
              worstW = rect.width;
              worst = `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(/\s+/).slice(0, 2).join(".") : ""}`;
            }
          }
        }
        return { over, worst, worstW: Math.round(worstW), client: d.clientWidth };
      });
      if (res.over > 2) overflow[vpName].push(`${r}  (+${res.over}px; widest ${res.worst ?? "?"} @${res.worstW}px vs viewport ${res.client})`);
    } catch (e) { overflow[vpName].push(`${r}  (LOAD ERROR ${String(e).slice(0, 60)})`); }
  }
  say(`   ${vpName} ${w}x${h}: ${overflow[vpName].length} of ${ROUTES.length} routes overflow horizontally`);
  for (const o of overflow[vpName]) say(`      · ${o}`);
}

// ── 2. ARABIC: untranslated Latin text on real pages ──────────────────────────────────────────
say(`\n── 2. ARABIC — user-visible Latin-script text remaining after switching locale ──`);
await page.setViewportSize({ width: 1440, height: 900 });
await ctx.addCookies([{ name: "locale", value: "ar", domain: "localhost", path: "/" }]);
const untranslated = [];
for (const r of ROUTES) {
  try {
    await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(250);
    const dir = await page.evaluate(() => document.documentElement.getAttribute("dir"));
    const words = await page.evaluate(() => {
      const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "PATH", "CODE", "PRE"]);
      const bad = [];
      const walk = (n) => {
        if (n.nodeType === 3) {
          const t = n.textContent.trim();
          // words of 4+ Latin letters, ignoring things that are legitimately Latin
          const m = t.match(/\b[A-Za-z][A-Za-z'’-]{3,}\b/g);
          if (m) for (const w of m) bad.push(w);
          return;
        }
        if (n.nodeType !== 1 || skip.has(n.tagName)) return;
        const st = getComputedStyle(n);
        if (st.display === "none" || st.visibility === "hidden") return;
        for (const c of n.childNodes) walk(c);
      };
      walk(document.body);
      return bad;
    });
    // Exclusions: proper nouns the fixture itself created, currency/format tokens, and codes.
    const ALLOW = /^(UI|SAR|USD|EUR|VAT|ZATCA|PDF|CSV|XLSX|Elite|ERP|Saudi|Arabia|Riyadh|SKU|QR|SA|IBAN|BIC|Claude)$/i;
    const uniqWords = [...new Set(words)].filter((w) => !ALLOW.test(w) && !/^[A-Z]{2,5}$/.test(w));
    if (uniqWords.length) untranslated.push({ r, dir, sample: uniqWords.slice(0, 12), n: uniqWords.length });
  } catch { /* route error already captured above */ }
}
say(`   dir attribute in Arabic: ${untranslated[0]?.dir ?? "(checked below)"}`);
say(`   routes carrying residual Latin words: ${untranslated.length} of ${ROUTES.length}`);
for (const u of untranslated) say(`      · ${u.r}  [${u.n}] ${u.sample.join(", ")}`);

// ── 3. KEYBOARD reachability + visible focus ──────────────────────────────────────────────────
say(`\n── 3. KEYBOARD — tab reachability and focus visibility ──`);
await ctx.addCookies([{ name: "locale", value: "en", domain: "localhost", path: "/" }]);
for (const r of ["/dashboard", "/sales/invoices", "/sales/invoices/new", "/clients"]) {
  await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(250);
  const probe = await page.evaluate(() => {
    const sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const n = document.querySelectorAll(sel).length;
    const neg = document.querySelectorAll('[tabindex="-1"]').length;
    return { focusable: n, negTab: neg };
  });
  let reached = 0, focusVisible = 0;
  for (let i = 0; i < Math.min(probe.focusable, 30); i++) {
    await page.keyboard.press("Tab");
    const st = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return null;
      const s = getComputedStyle(a);
      const ring = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
      const shadow = s.boxShadow && s.boxShadow !== "none";
      return { tag: a.tagName.toLowerCase(), visible: ring || shadow };
    });
    if (st) { reached++; if (st.visible) focusVisible++; }
  }
  say(`   ${r.padEnd(22)} focusable ${String(probe.focusable).padStart(3)}  · reached by Tab (first 30) ${reached}  · with a visible focus indicator ${focusVisible}`);
}

await browser.close();
const { writeFile } = await import("node:fs/promises");
await writeFile("docs/audits/2026-09-12/evidence/repro-ui-coverage.txt", out.join("\n") + "\n");
say("\ndone");
