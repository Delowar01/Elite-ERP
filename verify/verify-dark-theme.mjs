import { chromium } from "playwright";
import { Pool } from "pg";
import { readFileSync } from "fs";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";
const BASE = "http://localhost:3000";
const DBURL = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim();
const pool = new Pool({ connectionString: DBURL });
const uniq = () => Math.random().toString(36).slice(2, 8);

const results = [];
const check = (name, cond, extra = "") => results.push([cond, name, extra]);

// --- contrast math evaluated in the page against COMPUTED styles ---
const CONTRAST_FN = `
(() => {
  function parse(c){ const m=c.match(/rgba?\\(([^)]+)\\)/); if(!m) return null;
    const p=m[1].split(",").map(s=>parseFloat(s.trim())); return {r:p[0],g:p[1],b:p[2],a:p[3]===undefined?1:p[3]}; }
  function lum({r,g,b}){ const f=v=>{v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); }
  // Walk up to find the first opaque backdrop, compositing translucent layers on the way.
  function effBg(el){
    let cur = el, stack = [];
    while (cur) {
      const bg = parse(getComputedStyle(cur).backgroundColor);
      if (bg && bg.a > 0) { stack.push(bg); if (bg.a >= 1) break; }
      cur = cur.parentElement;
    }
    if (!stack.length) return {r:255,g:255,b:255};
    let out = stack[stack.length-1];
    for (let i = stack.length-2; i >= 0; i--) {
      const t = stack[i];
      out = { r: t.r*t.a + out.r*(1-t.a), g: t.g*t.a + out.g*(1-t.a), b: t.b*t.a + out.b*(1-t.a), a:1 };
    }
    return out;
  }
  window.__contrast = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color); if (!fg) return null;
    const bgEl = effBg(el);
    // composite the (possibly translucent) text colour over its backdrop
    const f = { r: fg.r*fg.a + bgEl.r*(1-fg.a), g: fg.g*fg.a + bgEl.g*(1-fg.a), b: fg.b*fg.a + bgEl.b*(1-fg.a) };
    const l1 = lum(f), l2 = lum(bgEl);
    const ratio = (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
    return { ratio: Math.round(ratio*100)/100, color: cs.color, bg: \`rgb(\${Math.round(bgEl.r)}, \${Math.round(bgEl.g)}, \${Math.round(bgEl.b)})\`,
             fontSize: parseFloat(cs.fontSize), weight: cs.fontWeight };
  };
})()`;

// Refuse to run against a build other than the one on disk — see assert-fresh-build.mjs.
await assertFreshBuild(BASE);

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext();
const p = await ctx.newPage();
const email = `dt_${uniq()}@test.dev`;
await p.goto(`${BASE}/register`, { waitUntil: "networkidle" });
await p.fill("#orgName", `DT ${uniq()}`); await p.fill("#name", "DT");
await p.fill("#email", email); await p.fill("#password", `Zx9$mQ${uniq()}vK!ray`);
  // Registration requires a country as of FX-1a; the currency follows it.
  await pickCountry(p);
await Promise.all([p.waitForURL(`${BASE}/dashboard`, { timeout: 20000 }), p.click('button[type="submit"]')]);
const { rows: o } = await pool.query("select org_id from users where email=$1", [email]);
const orgId = o[0].org_id;

// Apply a deliberately hostile brand colour: near-black navy (invisible on a dark surface if raw).
await pool.query(
  "update orgs set color_theme_mode='single', primary_color=$1, accent_color=$2, theme_overrides=null where id=$3",
  ["#1B1B4E", "#2D0A4E", orgId],
);

// Targets: [selector, label, minimum ratio]. 4.5 for text, 3 for large/UI text.
const TARGETS = [
  ["body", "body text", 4.5],
  [".nav-item.active", "sidebar selected item", 4.5],
  [".topbar-greeting h3", "page title", 4.5],
  [".topbar-profile-role", "profile role (small muted)", 4.5],
];

async function measure(appearance) {
  await p.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  // Wait until the stylesheet is actually applied — otherwise we would measure unstyled defaults
  // (black on white) and report a meaningless pass/fail.
  await p.waitForFunction(
    () => getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() !== "",
    { timeout: 20000 },
  );
  await p.evaluate((mode) => document.documentElement.setAttribute("data-theme", mode), appearance);
  await p.waitForFunction(
    (mode) => {
      const bg = getComputedStyle(document.body).backgroundColor;
      const isDark = bg === "rgb(12, 11, 34)" || bg === "rgb(22, 21, 47)";
      return mode === "dark" ? isDark || bg.includes("12, 11, 34") : !isDark;
    },
    appearance,
    { timeout: 20000 },
  ).catch(() => {});
  await p.waitForTimeout(400);
  await p.evaluate(CONTRAST_FN);
  for (const [sel, label, min] of TARGETS) {
    const r = await p.evaluate((s) => window.__contrast(s), sel);
    if (!r) { check(`${appearance}: ${label} (element present)`, false, sel); continue; }
    check(`${appearance}: ${label} >= ${min}`, r.ratio >= min, `ratio=${r.ratio} fg=${r.color} bg=${r.bg}`);
  }
  // The injected theme must define a DIFFERENT badge/surface per mode.
  return p.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      badgeBg: cs.getPropertyValue("--badge-background").trim(),
      badgeText: cs.getPropertyValue("--badge-text").trim(),
      surface: cs.getPropertyValue("--surface").trim(),
      primaryText: cs.getPropertyValue("--primary-text").trim(),
      selectedBg: cs.getPropertyValue("--selected-item-background").trim(),
    };
  });
}

const light = await measure("light");
const dark = await measure("dark");
console.log("light tokens:", JSON.stringify(light));
console.log("dark  tokens:", JSON.stringify(dark));
check("badge background differs between modes", light.badgeBg !== dark.badgeBg, `${light.badgeBg} vs ${dark.badgeBg}`);
check("surface differs between modes", light.surface !== dark.surface, `${light.surface} vs ${dark.surface}`);
check("selected-item background adapts per mode", light.selectedBg !== dark.selectedBg, `${light.selectedBg} vs ${dark.selectedBg}`);

// Settings → Color Theme panel: both previews render, per-mode override isolation.
await p.goto(`${BASE}/settings/organization`, { waitUntil: "networkidle" });
await p.getByRole("tab", { name: /Color Theme/i }).click().catch(() => {});
await p.waitForTimeout(600);
const bodyTxt = await p.locator("body").innerText();
check("panel shows Light mode preview", bodyTxt.includes("Light mode"));
check("panel shows Dark mode preview", bodyTxt.includes("Dark mode"));
check("panel has Reset to Automatic", bodyTxt.includes("Reset to Automatic"));

await b.close(); await pool.end();
let ok = true;
for (const [cond, name, extra] of results) { if (!cond) ok = false; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  << " + extra : ""}`); }
console.log(ok ? "\nDARK THEME VERIFICATION PASS" : "\nDARK THEME VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
