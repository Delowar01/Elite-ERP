/**
 * DEV-UI-01.7 C0 — page-archetype runtime baseline.
 *
 *   node verify/verify-page-archetypes-runtime.mjs                   measure, compare with the baseline
 *   node verify/verify-page-archetypes-runtime.mjs --write-baseline  measure, write the baseline files
 *   flags: --skip-build (reuse .next — only when it was built from the current tree), --only=<route id>
 *
 * The 36 DEV-UI-01.7 pages, through 44 routes (detail, tab and report variants, an empty project, an
 * unknown id), served by a production build. For every route it records what the page is TODAY:
 *
 *   - status and final path (route behaviour), lang and dir;
 *   - the heading outline inside <main>, the number of h1s and heading-level skips;
 *   - page overflow, the overflowing elements, tables reaching past the viewport;
 *   - Arabic-Indic digits, controls without a name, clickable things the keyboard cannot reach,
 *     which side the Settings navigation sits on;
 *   - console and page errors, and React #418 (hydration) in particular;
 *   - formatDisplayDate (C0's date helper, no consumer yet): the same strings in Chromium, under four
 *     browser locales and zones, as on the server — what a client component needs to hydrate;
 *   - the action inventory — every link, button, tab, menu trigger and toggle in <main>: kind,
 *     visible name, target, type, disabled — for the owner (EN and AR at 1440, EN at 390) and for a
 *     Staff member (EN and AR at 1440), and where Staff end up on each route (permissions).
 *
 * The legacy defects the later stages fix (h3 page titles, overflow at 390, the kanban, Settings
 * direction, Arabic-Indic dates…) are recorded as they are. Each is a baseline value that may only
 * IMPROVE: overflow, overflowing elements, h1 distance from one, heading skips, tables past the
 * viewport, Arabic-Indic digits, unnamed controls, pointer-only clickables and error counts may never
 * grow. Route behaviour, direction, the heading outline and the action inventory must match exactly —
 * a stage that changes one on purpose re-baselines (--write-baseline) and its review reads the diff.
 * React #418 must be zero everywhere, whatever the baseline says.
 *
 * Browsers are realistic and adversarial: English in America/New_York (en-US), Arabic in Asia/Riyadh
 * (ar-SA), and a sweep at 1440 in Pacific/Pago_Pago, where the frozen instant is still the day before.
 *
 * TEST-ONLY, and it refuses rather than guesses: it needs UI_BASELINE_ADMIN_URL (a LOCAL role with
 * CREATEDB; tests/ui-baseline/isolation.mjs refuses any other host), serves only its own
 * `devui010_test_only_archetypes` copy of the synthetic seed, refuses to run where a .env exists,
 * binds the server to 127.0.0.1, aborts every browser request that is not to that server, freezes the
 * server and browser clocks at the harness instant, and runs the pinned Chromium build. It is not a
 * verify:browser suite (it starts its own server on its own port).
 * docs/ui/dev-ui-01-7/c0-foundations-and-guardrails.md
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";
import { chromium } from "playwright";
import ts from "typescript";
import { FROZEN_NOW, OWNER_EMAIL } from "../tests/ui-baseline/config.mjs";
import { STAFF_EMAIL } from "../tests/ui-baseline/shell-states.mjs";
import { DB_PREFIX, TEMPLATE_DB, adminUrl, dbUrl, describe, serverEnv } from "../tests/ui-baseline/isolation.mjs";
import { alignDatabaseTimestamps } from "../tests/ui-baseline/archetype-states.mjs";
import { assertFreshBuild } from "./assert-fresh-build.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
process.chdir(ROOT);
const PORT = 3170;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = `${DB_PREFIX}archetypes`;
const CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PASSWORD_FILE = join(ROOT, ".ui-baseline-work/owner-password");
const BASELINE_FILE = "verify/page-archetype-runtime-baseline.json";
const ACTIONS_FILE = "verify/page-archetype-actions.json";
const args = process.argv.slice(2);
const WRITE = args.includes("--write-baseline");
const ONLY = args.find((a) => a.startsWith("--only="))?.slice(7);

// [id, path, the DEV-UI-01.7 page it renders]
const ROUTES = [
  ["dashboard", "/dashboard", "dashboard"],
  ["clients", "/clients", "clients"], ["client-detail", "/clients/1", "clients/[id]"], ["client-new", "/clients/new", "clients/new"], ["client-bin", "/clients/recycle-bin", "clients/recycle-bin"],
  ["vendors", "/purchasing/vendors", "purchasing/vendors"], ["vendor-detail", "/purchasing/vendors/1", "purchasing/vendors/[id]"], ["vendor-new", "/purchasing/vendors/new", "purchasing/vendors/new"],
  ["vendor-bin", "/purchasing/vendors/recycle-bin", "purchasing/vendors/recycle-bin"],
  ["products", "/inventory/products", "inventory/products"], ["product-detail", "/inventory/products/1", "inventory/products/[id]"], ["product-new", "/inventory/products/new", "inventory/products/new"],
  ["product-bin", "/inventory/products/recycle-bin", "inventory/products/recycle-bin"],
  ["bank-accounts", "/finance/bank-accounts", "finance/bank-accounts"], ["coa", "/finance/chart-of-accounts", "finance/chart-of-accounts"], ["journal", "/finance/journal", "finance/journal"],
  ["ledger", "/finance/ledger", "finance/ledger"], ["payments", "/finance/payments", "finance/payments"],
  ["reports-pl", "/finance/reports", "finance/reports"], ["reports-tb", "/finance/reports?report=tb", "finance/reports"], ["reports-ar", "/finance/reports?report=ar", "finance/reports"],
  ["reports-gl", "/finance/reports?report=gl", "finance/reports"],
  ["statements", "/finance/statements", "finance/statements"], ["statement-client1", "/finance/statements?kind=client&party=1", "finance/statements"],
  ["hr-attendance", "/hr/attendance", "hr/attendance"], ["hr-departments", "/hr/departments", "hr/departments"], ["hr-employees", "/hr/employees", "hr/employees"],
  ["hr-employee-detail", "/hr/employees/1", "hr/employees/[id]"], ["hr-employee-new", "/hr/employees/new", "hr/employees/new"], ["hr-leave", "/hr/leave", "hr/leave"], ["hr-payroll", "/hr/payroll", "hr/payroll"],
  ["projects", "/projects", "projects"], ["project-detail", "/projects/1", "projects/[id]"], ["project-empty", "/projects/2", "projects/[id]"], ["project-new", "/projects/new", "projects/new"],
  ["recycle-bin", "/recycle-bin", "recycle-bin"],
  ["settings-org", "/settings/organization", "settings/organization"], ["settings-org-business", "/settings/organization?tab=business-details", "settings/organization"],
  ["settings-org-team", "/settings/organization?tab=team", "settings/organization"],
  ["settings-presets", "/settings/presets", "settings/presets"], ["settings-security", "/settings/security", "settings/security"], ["settings-compliance", "/settings/compliance", "settings/compliance"],
  ["settings-team", "/settings/team", "settings/team"],
  ["nf-client", "/clients/999999", "clients/[id]"],
].filter(([id]) => !ONLY || id.includes(ONLY));
const WIDTHS = [[1440, 900], [1024, 768], [768, 1024], [390, 844]];
// Realistic, adversarial browsers: the client renders in the user's zone and locale, the server in UTC.
const BROWSERS = { en: { locale: "en-US", timezoneId: "America/New_York" }, ar: { locale: "ar-SA", timezoneId: "Asia/Riyadh" } };
const SWEEP_ZONE = "Pacific/Pago_Pago"; // UTC−11: 09:00Z on the 15th is 22:00 on the 14th there

// ------------------------------------------------------------------------------------- isolation
function refuse(why) {
  console.error(`✗ refusing: ${why}`);
  process.exit(2);
}
if (existsSync(join(ROOT, ".env"))) refuse("a .env exists in this tree — run in an isolated worktree with no .env (the production configuration is never loaded)");
if (!existsSync(PASSWORD_FILE)) refuse("no synthetic seed password (.ui-baseline-work/owner-password) — run `node tests/ui-baseline/run.mjs prepare` first");
const env = serverEnv({ frozenNow: FROZEN_NOW, storageDir: join(ROOT, ".ui-baseline-work/storage-fake-archetypes") });
env.DATABASE_URL = dbUrl(DB); // devui010_test_only_* on a loopback host, or isolation.mjs throws
const target = new URL(env.DATABASE_URL);
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(target.hostname) || target.pathname !== `/${DB}` || !target.pathname.includes("test_only")) refuse("not the TEST-ONLY archetypes database");
if (process.env.DATABASE_URL) {
  try {
    const shell = new URL(process.env.DATABASE_URL);
    if (`${shell.hostname}:${shell.port || 5432}${shell.pathname}` === `${target.hostname}:${target.port || 5432}${target.pathname}`) refuse("the shell's DATABASE_URL is this database");
  } catch {
    /* not a URL: not this database */
  }
}

async function admin(fn) {
  const c = new pg.Client({ connectionString: adminUrl().toString() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

// ------------------------------------------------------------------------------------- in-page measures
const MEASURE = () => {
  const vw = document.documentElement.clientWidth;
  const main = document.querySelector("main");
  if (!main) return { noMain: true, vw, dir: document.documentElement.getAttribute("dir"), lang: document.documentElement.lang, overflow: document.documentElement.scrollWidth - vw };
  const visible = (e) => {
    const cs = getComputedStyle(e);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const inScroll = (el) => {
    for (let p = el.parentElement; p && p !== main; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1) return true;
    }
    return false;
  };
  const off = [];
  for (const el of main.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if ((r.right > vw + 1 || r.left < -1) && !inScroll(el)) off.push(el);
  }
  const offenders = off.filter((e) => !off.includes(e.parentElement)).length;
  const heads = [...main.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]")].filter(visible).map((h) => ({
    lv: h.getAttribute("aria-level") ? Number(h.getAttribute("aria-level")) : Number(h.tagName[1]),
    t: h.textContent.trim().replace(/\s+/g, " ").slice(0, 48),
  }));
  let skips = 0;
  for (let i = 1; i < heads.length; i++) if (heads[i].lv > heads[i - 1].lv + 1) skips++;
  const tables = [...main.querySelectorAll("table")].filter(visible);
  const tablesBeyond = tables.filter((t) => {
    let box = null;
    for (let p = t.parentElement; p && p !== main; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) { box = p; break; }
    const r = (box ?? t).getBoundingClientRect();
    return r.right > vw + 1 || r.left < -1;
  }).length;
  const tw = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  let indic = 0;
  for (let n = tw.nextNode(); n; n = tw.nextNode()) if (/[٠-٩۰-۹]/.test(n.nodeValue) && n.parentElement && visible(n.parentElement)) indic++;
  const nameOf = (el) => {
    if (el.getAttribute("aria-label")) return el.getAttribute("aria-label");
    const lb = el.getAttribute("aria-labelledby");
    if (lb) return lb.split(" ").map((i) => document.getElementById(i)?.textContent ?? "").join(" ");
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return l.textContent;
    }
    const wrap = el.closest("label");
    if (wrap) return wrap.textContent;
    return el.title || "";
  };
  const ctrls = [...main.querySelectorAll("input:not([type=hidden]):not([type=file]),select,textarea,[role=textbox],[role=combobox],button,a[href]")].filter(visible);
  const unnamed = ctrls.filter((e) => (e.tagName === "BUTTON" || e.tagName === "A" ? !(nameOf(e).trim() || e.textContent.trim()) : !nameOf(e).trim())).length;
  const INTERACTIVE = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "LABEL", "SUMMARY", "OPTION"]);
  const ROLES = new Set(["button", "link", "tab", "option", "menuitem", "checkbox", "radio", "switch", "combobox", "row", "gridcell"]);
  const OWNERS = "a,button,label,summary,[role=button],[role=link],[role=tab],[role=option],[role=menuitem]";
  let pointerOnly = 0;
  for (const el of main.querySelectorAll("*")) {
    if (INTERACTIVE.has(el.tagName) || !visible(el) || getComputedStyle(el).cursor !== "pointer") continue;
    const owner = el.closest(OWNERS);
    if (owner && owner !== el) continue;
    if (el.parentElement && getComputedStyle(el.parentElement).cursor === "pointer" && !INTERACTIVE.has(el.parentElement.tagName)) continue;
    if (el.tabIndex >= 0 && ROLES.has(el.getAttribute("role"))) continue;
    pointerOnly++;
  }
  const sn = main.querySelector(".settings-nav");
  let navAtStart = null;
  if (sn && visible(sn)) {
    const r = sn.getBoundingClientRect(), m = main.getBoundingClientRect();
    navAtStart = document.documentElement.dir === "rtl" ? m.right - r.right <= r.left - m.left : r.left - m.left <= m.right - r.right;
  }
  return {
    vw, dir: document.documentElement.getAttribute("dir"), lang: document.documentElement.lang, overflow: Math.max(0, document.documentElement.scrollWidth - vw), offenders,
    outline: heads.map((h) => `h${h.lv} ${h.t}`), h1: heads.filter((h) => h.lv === 1).length, skips, tables: tables.length, tablesBeyond, indic, unnamed, pointerOnly, navAtStart,
  };
};

/** Every action in <main>, outermost interactive element only: kind | name | target | type | state. */
const ACTIONS = () => {
  const main = document.querySelector("main");
  if (!main) return [];
  const visible = (e) => {
    const cs = getComputedStyle(e);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const nameOf = (el) => {
    if (el.getAttribute("aria-label")) return norm(el.getAttribute("aria-label"));
    const lb = el.getAttribute("aria-labelledby");
    if (lb) return norm(lb.split(" ").map((i) => document.getElementById(i)?.textContent ?? "").join(" "));
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return norm(l.textContent);
    }
    return norm(el.textContent) || norm(el.title) || norm(el.querySelector("img[alt]")?.alt);
  };
  const SEL = "a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],[role=switch],[role=checkbox],[role=radio],[role=combobox],select,input[type=checkbox],input[type=radio],input[type=submit],input[type=button]";
  const out = [];
  for (const el of main.querySelectorAll(SEL)) {
    if (!visible(el)) continue;
    const outer = el.parentElement?.closest(SEL);
    if (outer && main.contains(outer)) continue;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role");
    const kind = role ?? (tag === "a" ? "link" : tag === "input" ? `input:${el.type}` : tag);
    let href = "";
    if (tag === "a") {
      const u = new URL(el.getAttribute("href"), location.href);
      href = u.origin === location.origin ? u.pathname + u.search + u.hash : u.href;
    }
    const type = tag === "button" ? `type=${el.getAttribute("type") ?? "submit"}` : "";
    const state = [
      el.disabled || el.getAttribute("aria-disabled") === "true" ? "disabled" : "",
      el.getAttribute("aria-haspopup") ? `popup=${el.getAttribute("aria-haspopup")}` : "",
      role === "tab" && el.getAttribute("aria-selected") === "true" ? "selected" : "",
      (role === "checkbox" || role === "switch" || el.type === "checkbox") && (el.checked || el.getAttribute("aria-checked") === "true") ? "checked" : "",
    ].filter(Boolean).join(",");
    out.push([kind, nameOf(el), href, type, state].join("|"));
  }
  return out.sort();
};

// ------------------------------------------------------------------------------------- run
const pinned = WRITE ? null : JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
const pinnedActions = WRITE ? null : JSON.parse(readFileSync(ACTIONS_FILE, "utf8"));

console.log(`• database: ${describe(env.DATABASE_URL)} (TEST-ONLY, fresh copy of ${TEMPLATE_DB})`);
await admin(async (c) => {
  await c.query(`drop database if exists ${DB} with (force)`);
  await c.query(`create database ${DB} template ${TEMPLATE_DB}`);
  await c.query(`comment on database ${DB} is 'DEV-UI-01.7 TEST-ONLY page-archetype runtime database. Synthetic data only.'`);
});
{
  // A Staff member for the permission pass (this run's copy only, never the template).
  const c = new pg.Client({ connectionString: env.DATABASE_URL });
  await c.connect();
  await c.query(`insert into users (org_id, name, email, password_hash, role) select org_id, 'Baseline Staff', $1, password_hash, 'staff' from users where email = $2`, [STAFF_EMAIL, OWNER_EMAIL]);
  await c.end();
}
if (!args.includes("--skip-build")) {
  console.log("• building (test environment)…");
  const b = spawnSync("npm", ["run", "build"], { env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (b.status !== 0) refuse(`build failed\n${(b.stdout ?? "").slice(-3000)}${(b.stderr ?? "").slice(-3000)}`);
}
if (!existsSync(".next/BUILD_ID")) refuse("no build (.next/BUILD_ID)");
try {
  await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(2000) });
  refuse(`something is already listening on ${BASE}`);
} catch {
  /* free */
}
mkdirSync(env.STORAGE_FAKE_DIR, { recursive: true });
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "127.0.0.1"], {
  env: { ...env, NODE_OPTIONS: `--require ${join(ROOT, "tests/ui-baseline/freeze-time.cjs")}` },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
async function stop() {
  for (const sig of ["SIGTERM", "SIGKILL"]) {
    try {
      process.kill(-server.pid, sig);
    } catch {
      return; // gone
    }
    for (let i = 0; i < 40; i++) {
      try {
        process.kill(server.pid, 0);
      } catch {
        return;
      }
      await sleep(250);
    }
  }
}
let up = false;
for (let i = 0; i < 90 && !up; i++) {
  try {
    up = (await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(3000) })).status < 500;
  } catch {
    if (server.exitCode !== null) break;
    await sleep(1000);
  }
}
if (!up) {
  await stop();
  refuse(`server did not answer:\n${serverLog.slice(-2000)}`);
}
await assertFreshBuild(BASE).catch(async (e) => {
  await stop();
  refuse(e.message);
});
const buildId = readFileSync(".next/BUILD_ID", "utf8").trim();
console.log(`• server ${BASE} (loopback), build ${buildId}, clock frozen at ${FROZEN_NOW}`);

// Loopback only: every request that is not to a loopback address goes to a proxy that does not
// exist (port 9, discard) and fails; loopback bypasses it. Counted below. (Request interception
// would do the same but stalls Next's link prefetches mid-navigation.)
const browser = await chromium.launch({ executablePath: CHROMIUM, proxy: { server: "http://127.0.0.1:9", bypass: "127.0.0.1,localhost,::1" } });
let blocked = 0;
async function context(opts) {
  const ctx = await browser.newContext({ reducedMotion: "reduce", colorScheme: "light", deviceScaleFactor: 1, ...opts });
  ctx.setDefaultTimeout(60000);
  ctx.on("requestfailed", (r) => {
    if (!r.url().startsWith(`${BASE}/`)) blocked++;
  });
  return ctx;
}
async function login(email) {
  const ctx = await context({ timezoneId: "UTC" });
  const p = await ctx.newPage();
  await p.clock.setFixedTime(new Date(FROZEN_NOW));
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await p.fill("#email", email);
  await p.fill("#password", readFileSync(PASSWORD_FILE, "utf8"));
  await Promise.all([p.waitForURL(`${BASE}/dashboard`, { timeout: 40000 }), p.click('button[type="submit"]')]);
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}
const is418 = (s) => /#418\b|errors\/418|hydrat/i.test(s);

const now = { frozenNow: FROZEN_NOW, chromium: browser.version(), states: {}, staff: {}, sweep: {} };
const prompts = {};
let fdNode = {};
const fdBrowsers = [];
const acts = { owner: {}, staff: {} };
try {
  const ownerState = await login(OWNER_EMAIL);
  const staffState = await login(STAFF_EMAIL);
  // Audit stamps the database wrote with its own clock (these logins' sessions and events, the
  // seeded defaults, the owner's password date): moved to the frozen instant in this TEST-ONLY copy
  // (archetype-states.mjs), as the archetype screenshots do.
  await alignDatabaseTimestamps(env.DATABASE_URL);
  async function pass(label, storageState, locale, zone, widths, onState) {
    const ctx = await context({ storageState, locale: BROWSERS[locale].locale, timezoneId: zone ?? BROWSERS[locale].timezoneId });
    await ctx.addCookies([{ name: "locale", value: locale, url: BASE }, { name: "theme", value: "light", url: BASE }]);
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date(FROZEN_NOW));
    let errors = [];
    let current = null;
    page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text().slice(0, 160)}`));
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e.message).slice(0, 160)}`));
    // An "unsaved changes" prompt when leaving a page nobody typed into is a defect of the page left
    // behind: counted against it, then accepted so the navigation goes on.
    page.on("dialog", (d) => {
      if (current) prompts[current] = (prompts[current] ?? 0) + 1;
      (d.type() === "beforeunload" ? d.accept() : d.dismiss()).catch(() => {});
    });
    for (const [id, path] of ROUTES)
      for (const [w, h] of widths) {
        errors = [];
        await page.setViewportSize({ width: w, height: h });
        const resp = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 60000 });
        await page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
        await page.waitForTimeout(250);
        const u = new URL(page.url());
        current = `${label}|${id}|${w}`;
        await onState({ id, path, w, page, status: resp?.status() ?? null, finalPath: u.pathname + u.search, errors: [...errors] });
      }
    await ctx.close();
    console.log(`  ${label} done`);
  }
  const errFacts = (errors) => ({
    consoleErrors: errors.filter((e) => e.startsWith("console:")).length,
    pageErrors: errors.filter((e) => e.startsWith("pageerror:")).length,
    r418: errors.filter(is418).length,
    ...(errors.length ? { errorSample: [...new Set(errors)].slice(0, 3) } : {}),
  });

  for (const locale of ["en", "ar"]) {
    await pass(`owner ${locale}`, ownerState, locale, null, WIDTHS, async ({ id, w, page, status, finalPath, errors }) => {
      now.states[`${id}|${locale}|${w}`] = { status, finalPath, ...(await page.evaluate(MEASURE)), ...errFacts(errors) };
      if (w === 1440 || (w === 390 && locale === "en")) acts.owner[`${id}|${locale}|${w}`] = await page.evaluate(ACTIONS);
    });
    await pass(`staff ${locale}`, staffState, locale, null, [[1440, 900]], async ({ id, page, status, finalPath, errors }) => {
      now.staff[`${id}|${locale}`] = { status, finalPath, ...errFacts(errors) };
      acts.staff[`${id}|${locale}|1440`] = await page.evaluate(ACTIONS);
    });
    await pass(`sweep ${locale} (${SWEEP_ZONE})`, ownerState, locale, SWEEP_ZONE, [[1440, 900]], async ({ id, status, finalPath, errors }) => {
      now.sweep[`${id}|${locale}`] = { status, finalPath, ...errFacts(errors) };
    });
  }
  // formatDisplayDate in the browser: identical to Node whatever the browser's locale and zone. (A
  // tree without the helper — main before C0 — has nothing to compare; the check below says so.)
  const fdSource = existsSync("src/lib/i18n/format-date.ts") ? readFileSync("src/lib/i18n/format-date.ts", "utf8") : "exports.formatDisplayDate = () => undefined;";
  const fdJs = ts.transpileModule(fdSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const fdInstants = ["2026-06-15T09:00:00Z", "2026-10-08T23:30:00Z", "2026-10-09T00:30:00Z", "2026-12-31T23:59:59Z", "2027-01-01T00:00:00Z", "2026-03-08T06:45:00Z"];
  const fdRun = (js, instants) => {
    const m = { exports: {} };
    new Function("module", "exports", "require", js)(m, m.exports, (spec) => {
      throw new Error(`format-date.ts imports ${spec}`);
    });
    const out = {};
    for (const i of instants) for (const l of ["en", "ar"]) for (const st of ["date", "dateTime", "monthYear"]) out[`${i}|${l}|${st}`] = m.exports.formatDisplayDate(i, l, st);
    return out;
  };
  fdNode = fdRun(fdJs, fdInstants);
  for (const [locale, timezoneId] of [["en-US", "America/New_York"], ["ar-SA", "Asia/Riyadh"], ["ar-EG", "Pacific/Pago_Pago"], ["fr-FR", "Pacific/Kiritimati"]]) {
    const c = await browser.newContext({ locale, timezoneId });
    const p = await c.newPage(); // about:blank — Intl is the browser's own, independent of any page
    const out = await p.evaluate(`(${fdRun.toString()})(${JSON.stringify(fdJs)}, ${JSON.stringify(fdInstants)})`);
    fdBrowsers.push({ locale, timezoneId, diff: Object.keys(fdNode).filter((k) => out[k] !== fdNode[k]).map((k) => `${k}: node "${fdNode[k]}" chromium "${out[k]}"`) });
    await c.close();
  }
} finally {
  await browser.close();
  await stop();
}
for (const [k, n] of Object.entries(prompts)) {
  const [label, id, w] = k.split("|");
  const [role, locale] = label.split(" ");
  if (role === "owner") now.states[`${id}|${locale}|${w}`].unloadPrompt = n;
}
const after = readFileSync(".next/BUILD_ID", "utf8").trim();
if (after !== buildId) refuse(`.next/BUILD_ID changed during the run (${buildId} → ${after})`);

if (WRITE) {
  writeFileSync(BASELINE_FILE, JSON.stringify({ ...now, blockedRequests: blocked }, null, 1) + "\n");
  writeFileSync(ACTIONS_FILE, JSON.stringify(acts, null, 1) + "\n");
  console.log(`• wrote ${BASELINE_FILE} (${Object.keys(now.states).length} owner states, ${Object.keys(now.staff).length} staff, ${Object.keys(now.sweep).length} sweep) and ${ACTIONS_FILE}`);
}

// ------------------------------------------------------------------------------------- checks
const base = WRITE ? { ...now } : pinned;
const baseActs = WRITE ? acts : pinnedActions;
const results = [];
const check = (name, cond, extra = "") => results.push([Boolean(cond), name, extra]);
const keys = Object.keys(now.states);
const list = (xs) => (xs.length ? `${xs.length}: ${xs.slice(0, 6).join(" · ")}${xs.length > 6 ? " …" : ""}` : "");
const scoped = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !ONLY || k.split("|")[0].includes(ONLY)));

check(`isolation: TEST-ONLY loopback database, no .env, server on 127.0.0.1, browser confined to loopback (${blocked} other requests refused)`, target.pathname === `/${DB}` && !existsSync(join(ROOT, ".env")));
check(`pinned Chromium (${now.chromium})`, now.chromium === base.chromium, `baseline ${base.chromium}`);
const pages = new Set(ROUTES.map((r) => r[2]));
check(`the routes exercise all 36 DEV-UI-01.7 pages (${ROUTES.length} routes)`, ONLY || (pages.size === 36 && ROUTES.length === 44), [...pages].length);
check(`measured ${keys.length} owner states (${ROUTES.length} routes × EN/AR × 4 widths), ${Object.keys(now.staff).length} staff, ${Object.keys(now.sweep).length} sweep`,
  keys.length === ROUTES.length * 8 && Object.keys(now.staff).length === ROUTES.length * 2 && Object.keys(now.sweep).length === ROUTES.length * 2);
const B = scoped(base.states);
const missing = Object.keys(B).filter((k) => !now.states[k]);
check("every baseline state was measured", missing.length === 0, list(missing));
const exact = (field) => keys.filter((k) => B[k] && JSON.stringify(now.states[k][field]) !== JSON.stringify(B[k][field])).map((k) => `${k} ${JSON.stringify(B[k][field])}→${JSON.stringify(now.states[k][field])}`);
check("route behaviour: status and final path as the baseline", exact("status").length + exact("finalPath").length === 0, list([...exact("status"), ...exact("finalPath")]));
check("direction: lang / dir as the baseline (ar → rtl, en → ltr)", exact("lang").length + exact("dir").length === 0 && keys.every((k) => now.states[k].dir === (k.includes("|ar|") ? "rtl" : "ltr")), list([...exact("lang"), ...exact("dir")]));
check("heading outline inside <main> as the baseline", exact("outline").length === 0, list(exact("outline")));
const worse = (f, better = (n, b) => n <= b) => keys.filter((k) => B[k] && !better(now.states[k][f] ?? 0, B[k][f] ?? 0)).map((k) => `${k} ${B[k][f]}→${now.states[k][f]}`);
const atBase = (f, bad = (v) => v > 0) => Object.keys(B).filter((k) => bad(B[k][f] ?? 0)).length;
check(`page overflow never worse (baseline: ${atBase("overflow")} states overflow)`, worse("overflow").length === 0, list(worse("overflow")));
check(`overflowing elements never more (baseline: ${atBase("offenders")} states)`, worse("offenders").length === 0, list(worse("offenders")));
check(`one h1 per page: distance from 1 never grows (baseline: ${atBase("h1", (v) => v !== 1)} states without exactly one h1)`, worse("h1", (n, b) => Math.abs(n - 1) <= Math.abs(b - 1)).length === 0, list(worse("h1", (n, b) => Math.abs(n - 1) <= Math.abs(b - 1))));
check(`heading-level skips never more (baseline: ${atBase("skips")} states)`, worse("skips").length === 0, list(worse("skips")));
check(`tables past the viewport never more (baseline: ${atBase("tablesBeyond")} states)`, worse("tablesBeyond").length === 0, list(worse("tablesBeyond")));
check(`Arabic-Indic digits never more (baseline: ${atBase("indic")} states)`, worse("indic").length === 0, list(worse("indic")));
check(`unnamed controls never more (baseline: ${atBase("unnamed")} states)`, worse("unnamed").length === 0, list(worse("unnamed")));
check(`pointer-only clickables never more (baseline: ${atBase("pointerOnly")} states)`, worse("pointerOnly").length === 0, list(worse("pointerOnly")));
const navLost = keys.filter((k) => B[k]?.navAtStart === true && now.states[k].navAtStart !== true);
check(`Settings navigation at the inline start never lost (baseline: ${Object.keys(B).filter((k) => B[k].navAtStart === false).length} states with it at the end)`, navLost.length === 0, list(navLost));
check(`"unsaved changes" prompts on pages nobody typed into never more (baseline: ${atBase("unloadPrompt")} states)`, worse("unloadPrompt").length === 0, list(worse("unloadPrompt")));
check("console errors never more", worse("consoleErrors").length === 0, list(worse("consoleErrors")));
check("page errors never more", worse("pageErrors").length === 0, list(worse("pageErrors")));
const r418 = [...Object.entries(now.states), ...Object.entries(now.staff).map(([k, v]) => [`staff ${k}`, v]), ...Object.entries(now.sweep).map(([k, v]) => [`${SWEEP_ZONE} ${k}`, v])].filter(([, v]) => v.r418 > 0).map(([k]) => k);
check(`zero React #418 across all ${keys.length + Object.keys(now.staff).length + Object.keys(now.sweep).length} measured states (owner, staff, ${SWEEP_ZONE} sweep)`, r418.length === 0, list(r418));
const BS = scoped(base.staff);
const perm = Object.keys(now.staff).filter((k) => !BS[k] || BS[k].status !== now.staff[k].status || BS[k].finalPath !== now.staff[k].finalPath).map((k) => `${k} ${BS[k]?.finalPath}→${now.staff[k].finalPath}`);
check("permissions: where Staff land on every route, as the baseline", perm.length === 0, list(perm));
const ownerOnly = ["hr-payroll", "settings-org", "settings-org-business", "settings-org-team", "settings-presets", "settings-compliance", "settings-team"];
const staffRedirects = Object.entries(now.staff).filter(([k]) => ownerOnly.includes(k.split("|")[0]));
check("Staff are sent to /dashboard from Payroll, Business Settings, Presets and Compliance (and /settings/team)",
  staffRedirects.every(([, v]) => v.finalPath === "/dashboard") && (ONLY || staffRedirects.length === ownerOnly.length * 2), list(staffRedirects.filter(([, v]) => v.finalPath !== "/dashboard").map(([k, v]) => `${k}→${v.finalPath}`)));
const staffOpen = Object.entries(now.staff).filter(([k]) => !ownerOnly.includes(k.split("|")[0]) && k.split("|")[0] !== "nf-client");
check("Staff open every other 01.7 route where it is (session pages)", staffOpen.every(([k, v]) => v.status === 200 && v.finalPath === ROUTES.find((r) => r[0] === k.split("|")[0])[1]),
  list(staffOpen.filter(([k, v]) => v.status !== 200 || v.finalPath !== ROUTES.find((r) => r[0] === k.split("|")[0])[1]).map(([k, v]) => `${k} ${v.status} ${v.finalPath}`)));
const BSw = scoped(base.sweep);
const sweepWorse = Object.keys(now.sweep).filter((k) => BSw[k] && (now.sweep[k].consoleErrors > BSw[k].consoleErrors || now.sweep[k].finalPath !== BSw[k].finalPath));
check(`${SWEEP_ZONE} sweep: same routes, console errors never more`, sweepWorse.length === 0, list(sweepWorse));
function actionDelta(group) {
  const want = scoped(baseActs[group]);
  const got = acts[group];
  const out = [];
  for (const k of new Set([...Object.keys(want), ...Object.keys(got)])) {
    const w = [...(want[k] ?? [])];
    const extra = [];
    for (const g of got[k] ?? []) {
      const i = w.indexOf(g);
      if (i >= 0) w.splice(i, 1);
      else extra.push(g);
    }
    if (w.length || extra.length) out.push(`${k}: ${[...w.map((x) => `- ${x}`), ...extra.map((x) => `+ ${x}`)].slice(0, 4).join(" ; ")}`);
  }
  return out;
}
const nOwner = Object.values(acts.owner).reduce((n, a) => n + a.length, 0);
const nStaff = Object.values(acts.staff).reduce((n, a) => n + a.length, 0);
check(`owner action inventory unchanged — ${nOwner} actions (EN + AR at 1440, EN at 390): name, target, type, disabled`, actionDelta("owner").length === 0, list(actionDelta("owner")));
check(`Staff action inventory unchanged — ${nStaff} actions (EN + AR at 1440)`, actionDelta("staff").length === 0, list(actionDelta("staff")));
check(`formatDisplayDate: Chromium writes exactly the server's (Node's) strings — ${Object.keys(fdNode).length} per browser — under ${fdBrowsers.map((b) => `${b.locale}/${b.timezoneId}`).join(", ")}`,
  Object.keys(fdNode).length === 36 && Object.values(fdNode).every((v) => typeof v === "string" && v) && fdBrowsers.length === 4 && fdBrowsers.every((b) => b.diff.length === 0),
  fdBrowsers.flatMap((b) => b.diff).slice(0, 4).join(" · ") || "no formatDisplayDate in this tree");
check("server log has no unhandled error", !/unhandledRejection|Error: (?!connect ECONNREFUSED 127\.0\.0\.1:12750)/.test(serverLog), serverLog.match(/.*Error.*/)?.[0]?.slice(0, 200));

let ok = true;
for (const [cond, name, extra] of results) {
  if (!cond) ok = false;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra && !cond ? "  << " + extra : ""}`);
}
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "PAGE ARCHETYPES RUNTIME PASS" : "PAGE ARCHETYPES RUNTIME FAIL");
rmSync(env.STORAGE_FAKE_DIR, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
