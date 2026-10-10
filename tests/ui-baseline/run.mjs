/**
 * DEV-UI-01.0 — visual baseline harness.
 *
 *   node tests/ui-baseline/run.mjs prepare            create + seed the TEST-ONLY template database
 *   node tests/ui-baseline/run.mjs capture [--out=D]  build, serve a TEST-ONLY copy, capture the matrix
 *   node tests/ui-baseline/run.mjs compare A B        pixel-compare two capture directories
 *   node tests/ui-baseline/run.mjs check              capture, then compare against the committed baseline
 *   node tests/ui-baseline/run.mjs capture-shell [--out=D]  the DEV-UI-01.3 app-shell states (shell-states.mjs)
 *   node tests/ui-baseline/run.mjs capture-controls [--out=D]  the DEV-UI-01.4 control gallery (controls-states.mjs)
 *   node tests/ui-baseline/run.mjs capture-lists [--out=D]  the DEV-UI-01.5 list / data-table states (list-states.mjs)
 *   node tests/ui-baseline/run.mjs capture-documents [--out=D]  the DEV-UI-01.6 document editor / detail states (document-states.mjs)
 *   node tests/ui-baseline/run.mjs capture-archetypes [--out=D]  the DEV-UI-01.7 page-archetype states (archetype-states.mjs)
 *
 * Flags: --skip-build (reuse .next — only when it was built from the current tree), --only=<substr>.
 *
 * The harness changes nothing under src/. It needs UI_BASELINE_ADMIN_URL (a LOCAL role with
 * CREATEDB) and refuses to run without it — see isolation.mjs for every refusal.
 *
 * What it captures is TODAY's behaviour. Nothing here hides, fixes or masks a defect: there is no
 * element masking and no CSS injected into the page. Animations are settled with Playwright's own
 * `animations: "disabled"` (finite animations fast-forwarded, infinite ones cancelled) and the text
 * caret is hidden, because neither is a property of the layout.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";
import { chromium } from "playwright";
import { BASE, FROZEN_NOW, OWNER_EMAIL, PORT, matrix } from "./config.mjs";
import { STAFF_EMAIL, shellMatrix } from "./shell-states.mjs";
import { controlsMatrix } from "./controls-states.mjs";
import { listMatrix, SAVED_VIEW_FIXTURE } from "./list-states.mjs";
import { documentMatrix, DOC_ACTIONS } from "./document-states.mjs";
import { archetypeMatrix, ARCH_ACTIONS, alignDatabaseTimestamps } from "./archetype-states.mjs";
import { IsolationError, RUN_DB, TEMPLATE_DB, adminUrl, dbUrl, describe, serverEnv } from "./isolation.mjs";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
process.chdir(ROOT);
const WORK = join(ROOT, ".ui-baseline-work");
const BASELINE_DIR = join(ROOT, "tests/ui-baseline/baseline");
const PASSWORD_FILE = join(WORK, "owner-password");
const CHROMIUM = process.env.UI_BASELINE_CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (n) => args.includes(`--${n}`);
const value = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const positional = args.slice(1).filter((a) => !a.startsWith("--"));

function sh(command, argv, env, label) {
  const r = spawnSync(command, argv, { env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) {
    console.error(`\n✗ ${label} failed (exit ${r.status})\n${(r.stdout ?? "").slice(-4000)}${(r.stderr ?? "").slice(-4000)}`);
    process.exit(2);
  }
  return r.stdout ?? "";
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

async function recreate(name, template) {
  dbUrl(name); // name guard
  await admin(async (c) => {
    await c.query(`drop database if exists ${name} with (force)`);
    await c.query(`create database ${name}${template ? ` template ${template}` : ""}`);
    await c.query(`comment on database ${name} is 'DEV-UI-01.0 TEST-ONLY disposable visual-baseline database. Synthetic data only.'`);
  });
}

// ------------------------------------------------------------------------------------- prepare
async function prepare() {
  mkdirSync(WORK, { recursive: true });
  const url = dbUrl(TEMPLATE_DB);
  console.log(`• template database: ${describe(url)} (TEST-ONLY)`);
  await recreate(TEMPLATE_DB);

  // The schema exactly as the application defines it today (the `db:push` shape the app runs on).
  const env = { ...process.env, DATABASE_URL: url };
  delete env.UI_BASELINE_ADMIN_URL;
  console.log("• schema: drizzle-kit push");
  sh("npx", ["drizzle-kit", "push", "--force"], env, "drizzle-kit push");
  console.log("• schema: db hardening triggers");
  sh("npx", ["tsx", "scripts/apply-db-hardening.ts"], env, "apply-db-hardening");
  const tables = await (async () => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    const n = (await c.query("select count(*)::int n from information_schema.tables where table_schema='public'")).rows[0].n;
    await c.end();
    return n;
  })();
  if (tables < 50) {
    console.error(`✗ push produced only ${tables} tables — refusing to seed a partial schema`);
    process.exit(2);
  }
  console.log(`  ${tables} tables`);

  const password = `${randomBytes(18).toString("base64url")}Aa1!`;
  writeFileSync(PASSWORD_FILE, password, { mode: 0o600 });
  chmodSync(PASSWORD_FILE, 0o600);
  console.log("• seed: synthetic data");
  const out = sh(
    "npx",
    ["tsx", "--conditions=react-server", "tests/ui-baseline/seed.mts"],
    { ...env, UI_BASELINE_OWNER_PASSWORD: password, TZ: "UTC" },
    "seed",
  );
  console.log(`  ${out.trim().split("\n").at(-1)}`);
}

// ------------------------------------------------------------------------------------- server
async function answers() {
  try {
    const r = await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(3000) });
    return r.status < 500;
  } catch {
    return false;
  }
}

async function startServer(env) {
  if (await answers()) {
    console.error(`✗ something is already listening on ${BASE} — refusing to capture against an unknown server`);
    process.exit(2);
  }
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "127.0.0.1"], {
    env: { ...env, NODE_OPTIONS: `--require ${join(ROOT, "tests/ui-baseline/freeze-time.cjs")}` },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 90; i++) {
    if (await answers()) return { server, log: () => log };
    if (server.exitCode !== null) {
      console.error(`✗ server exited (${server.exitCode}) before answering:\n${log.slice(-3000)}`);
      process.exit(2);
    }
    await sleep(1000);
  }
  console.error(`✗ server never answered:\n${log.slice(-3000)}`);
  process.kill(-server.pid, "SIGTERM");
  process.exit(2);
}

// ------------------------------------------------------------------------------------- shell
/** Steps for shell states (DEV-UI-01.3). Keyboard focus is reached with Tab, so :focus-visible shows. */
/** DEV-UI-01.5 list states (list-states.mjs): one deterministic step each, after the page settled. */
const listWrap = (page) => page.locator("main .data-table-wrap").first();
const LIST_ACTIONS = {
  search: async (page) => {
    await page.locator('main [data-slot="list-search"] input').fill("Cedar");
  },
  "no-results": async (page) => {
    await page.locator('main [data-slot="list-search"] input').fill("zzzz-no-match");
  },
  "filters-open": async (page) => {
    await page.locator("main [data-list-filters]").click();
    await page.locator("[data-radix-popper-content-wrapper]").waitFor();
  },
  "filters-active": async (page) => {
    // Status = the "Sent" stat card's own (localized) label, and a from-date: two active filters.
    const sent = (await page.locator('main [data-status="sent"] .kpi-label').first().textContent()).trim();
    await LIST_ACTIONS["filters-open"](page);
    await page.locator("[data-radix-popper-content-wrapper] button[role='combobox']").first().click();
    await page.locator('[role="option"]').filter({ hasText: new RegExp(`^${sent}$`) }).click();
    await page.locator("[data-radix-popper-content-wrapper] input[type='date']").first().fill("2026-05-01");
    await page.keyboard.press("Escape");
    await page.locator("[data-filter-count]").waitFor();
  },
  "views-menu": async (page) => {
    await page.locator("main [data-list-views]").click();
    await page.locator('[role="menu"]').waitFor();
  },
  "views-manage": async (page) => {
    await LIST_ACTIONS["views-menu"](page);
    await page.locator('[role="menu"] [role="menuitem"]').last().click();
    await page.locator('[data-saved-view-dialog="manage"]').waitFor();
  },
  "row-menu": async (page) => {
    await page.locator("main tbody tr:nth-child(2) .row-menu-btn").click();
    await page.locator('[role="menu"]').waitFor();
  },
  convert: async (page) => {
    await LIST_ACTIONS["row-menu"](page);
    await page.locator('[role="menu"] .row-menu-item.has-submenu').click();
    await page.locator(".row-menu-submenu.open").waitFor();
  },
  "scroll-end": async (page) => {
    await listWrap(page).evaluate((w) => {
      const max = w.scrollWidth - w.clientWidth;
      w.scrollLeft = getComputedStyle(w).direction === "rtl" ? -max : max;
    });
  },
  "filter-panel": async (page) => {
    await page.locator("main [data-list-filters]").click();
    await page.locator("[data-radix-popper-content-wrapper]").waitFor();
  },
  "record-menu": async (page) => {
    await page.locator('main tbody tr:first-child td[data-cell="action"] button').click();
    await page.locator('[role="menu"]').waitFor();
  },
  "scroll-table": async (page) => {
    await page.locator('main table.data-table[data-density="compact"]').evaluate((t) => t.scrollIntoView({ block: "center" }));
  },
};

const SHELL_ACTIONS = {
  drawer: async (page) => {
    await page.click(".topbar-menu-btn");
    await page.locator(".mobile-nav").waitFor();
  },
  palette: async (page) => {
    await page.click(".cmdk-trigger-pill");
    await page.locator('[role="dialog"]').waitFor();
  },
  search: async (page, s) => {
    await page.click(s.viewport.width >= 1024 ? "header.topbar .topbar-search" : ".topbar-search-icon");
    await page.locator('[role="dialog"]').waitFor();
  },
  account: async (page, s) => {
    if (s.viewport.width < 640) {
      await SHELL_ACTIONS.drawer(page);
      await page.click(".mobile-nav-utilities .topbar-profile");
    } else await page.click(".topbar-utilities .topbar-profile");
    await page.locator('[role="menu"]').waitFor();
  },
  notifications: async (page) => {
    await page.click('.topbar-utilities [aria-haspopup="menu"]:has(.lucide-bell)');
    await page.locator('[role="menu"]').waitFor();
  },
  language: async (page) => {
    await page.locator('.topbar-lang-option[lang="en"]').focus();
    await page.keyboard.press("Tab");
  },
  "focus-nav": async (page) => {
    await page.locator('aside.sidebar a[href="/dashboard"]').focus();
    await page.keyboard.press("Tab");
  },
  "focus-topbar": async (page) => {
    await page.locator('.topbar-lang-option[lang="en"]').focus();
    await page.keyboard.press("Shift+Tab");
  },
};

// ------------------------------------------------------------------------------------- capture
async function capture(outDir, shell = false, lists = false, docs = false, arch = false) {
  if (!existsSync(PASSWORD_FILE)) {
    console.error("✗ no seeded template — run `prepare` first");
    process.exit(2);
  }
  const storageDir = join(WORK, "storage-fake");
  rmSync(storageDir, { recursive: true, force: true });
  mkdirSync(storageDir, { recursive: true });
  const env = serverEnv({ frozenNow: FROZEN_NOW, storageDir });
  console.log(`• run database: ${describe(env.DATABASE_URL)} (TEST-ONLY, fresh copy of ${TEMPLATE_DB})`);
  await recreate(RUN_DB, TEMPLATE_DB);

  if (!flag("skip-build")) {
    console.log("• building (test environment)…");
    const b = spawnSync("npm", ["run", "build"], { env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (b.status !== 0) {
      console.error(`✗ build failed\n${(b.stdout ?? "").slice(-3000)}${(b.stderr ?? "").slice(-3000)}`);
      process.exit(2);
    }
  }
  const buildId = readFileSync(".next/BUILD_ID", "utf8").trim();
  const { server, log } = await startServer(env);
  console.log(`• server on ${BASE}, build ${buildId}, clock frozen at ${FROZEN_NOW}`);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--font-render-hinting=none", "--disable-skia-runtime-opts", "--force-color-profile=srgb", "--disable-gpu", "--disable-partial-raster", "--disable-lcd-text"] });
  const manifest = { frozenNow: FROZEN_NOW, buildId, chromium: browser.version(), playwright: JSON.parse(readFileSync("node_modules/playwright/package.json", "utf8")).version, node: process.version, states: {} };
  try {
    // One login; every context reuses the session cookie.
    const loginCtx = await browser.newContext({ timezoneId: "UTC" });
    const lp = await loginCtx.newPage();
    await lp.clock.setFixedTime(new Date(FROZEN_NOW));
    await lp.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await lp.fill("#email", OWNER_EMAIL);
    await lp.fill("#password", readFileSync(PASSWORD_FILE, "utf8"));
    await Promise.all([lp.waitForURL(`${BASE}/dashboard`, { timeout: 30000 }), lp.click('button[type="submit"]')]);
    const storageState = await loginCtx.storageState();
    await loginCtx.close();
    // Audit stamps the database wrote with its own clock (this login's session and event, the seeded
    // defaults, the owner's password date) are moved to the frozen instant in this run's TEST-ONLY
    // copy — the Security page prints some of them (archetype-states.mjs).
    if (arch) await alignDatabaseTimestamps(env.DATABASE_URL);

    // Shell states also need a Staff session: a Staff member is added to this run's TEST-ONLY copy
    // (never the template), sharing the owner's synthetic password.
    let staffState = null;
    if (shell) {
      const c = new pg.Client({ connectionString: env.DATABASE_URL });
      await c.connect();
      await c.query(
        `insert into users (org_id, name, email, password_hash, role)
         select org_id, 'Baseline Staff', $1, password_hash, 'staff' from users where email = $2`,
        [STAFF_EMAIL, OWNER_EMAIL],
      );
      // Deterministic notification fixtures (the seed has an empty activity feed): two unread, one
      // read, at fixed offsets from the frozen clock — synthetic text only.
      const now = new Date(FROZEN_NOW).getTime();
      const feed = [
        ["created", "Project created: Riyadh Expo Stand (Fictional)", "project", 1, 3 * 24 * 3600e3],
        ["created", "Client added: Sara Sample (Fictional)", "customer", 1, 2 * 3600e3],
        ["created", "Invoice created: INV-0006 · Omar Example (Fictional)", null, null, 5 * 60e3],
      ];
      const ids = [];
      for (const [type, description, entityType, entityId, ago] of feed) {
        const r = await c.query(
          `insert into activity_logs (org_id, type, description, entity_type, entity_id, user_id, user_name, created_at)
           select org_id, $1, $2, $3, $4, id, name, $5 from users where email = $6 returning id`,
          [type, description, entityType, entityId, new Date(now - ago), OWNER_EMAIL],
        );
        ids.push(r.rows[0].id);
      }
      await c.query(
        `insert into notification_reads (org_id, user_id, activity_id, created_at) select org_id, id, $1, $2 from users where email = $3`,
        [ids[0], new Date(now - 3600e3), OWNER_EMAIL],
      );
      await c.end();
      const sc = await browser.newContext({ timezoneId: "UTC" });
      const sp = await sc.newPage();
      await sp.clock.setFixedTime(new Date(FROZEN_NOW));
      await sp.goto(`${BASE}/login`, { waitUntil: "networkidle" });
      await sp.fill("#email", STAFF_EMAIL);
      await sp.fill("#password", readFileSync(PASSWORD_FILE, "utf8"));
      await Promise.all([sp.waitForURL(`${BASE}/dashboard`, { timeout: 30000 }), sp.click('button[type="submit"]')]);
      staffState = await sc.storageState();
      await sc.close();
    }

    // List states need one saved view so the Views menu / manage dialog have content (run copy only).
    if (lists) {
      const c = new pg.Client({ connectionString: env.DATABASE_URL });
      await c.connect();
      await c.query(
        `insert into saved_views (org_id, user_id, module, name, config, created_at, updated_at)
         select org_id, id, $1, $2, $3, $4, $4 from users where email = $5`,
        [SAVED_VIEW_FIXTURE.module, SAVED_VIEW_FIXTURE.name, JSON.stringify(SAVED_VIEW_FIXTURE.config), new Date(FROZEN_NOW), OWNER_EMAIL],
      );
      await c.end();
    }

    const only = value("only");
    const states = (arch ? archetypeMatrix() : docs ? documentMatrix() : lists ? listMatrix() : shell ? shellMatrix() : matrix()).filter((s) => !only || s.id.includes(only));
    let n = 0;
    for (const s of states) {
      n++;
      const ctx = await browser.newContext({
        viewport: { width: s.viewport.width, height: s.viewport.height },
        deviceScaleFactor: 1,
        colorScheme: s.theme,
        reducedMotion: "reduce",
        timezoneId: "UTC",
        locale: s.locale === "ar" ? "ar-SA" : "en-US",
        storageState: s.route.auth === false ? undefined : s.role === "staff" ? staffState : storageState,
      });
      await ctx.addCookies([
        { name: "locale", value: s.locale, url: BASE },
        { name: "theme", value: s.theme, url: BASE },
        ...Object.entries(s.cookies ?? {}).map(([name, v]) => ({ name, value: v, url: BASE })),
      ]);
      const page = await ctx.newPage();
      await page.clock.setFixedTime(new Date(FROZEN_NOW));
      const consoleErrors = [];
      page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 200)));
      page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 200)}`));
      const resp = await page.goto(`${BASE}${s.route.path}`, { waitUntil: "networkidle", timeout: 60000 });
      await page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
      const facts = await page.evaluate(() => {
        const de = document.documentElement;
        return {
          lang: de.getAttribute("lang"),
          dir: de.getAttribute("dir"),
          dataTheme: de.getAttribute("data-theme"),
          scrollWidth: de.scrollWidth,
          clientWidth: de.clientWidth,
          scrollHeight: de.scrollHeight,
          fontsLoaded: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family).sort().filter((v, i, a) => a.indexOf(v) === i),
          title: document.title,
        };
      });
      if (s.action) {
        await (arch ? ARCH_ACTIONS : docs ? DOC_ACTIONS : lists ? LIST_ACTIONS : SHELL_ACTIONS)[s.action](page, s);
        if (lists || docs || arch) await page.waitForTimeout(250); // let Radix settle (transitions are reduced)
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      }
      const file = join(outDir, `${s.id}.png`);
      await page.screenshot({ path: file, fullPage: docs || arch ? s.full : !shell && !lists, animations: "disabled", caret: "hide", scale: "css" });
      const png = readFileSync(file);
      manifest.states[s.id] = {
        route: s.route.path,
        area: s.route.area,
        ...(shell || lists || docs || arch ? { action: s.action, role: s.role, cookies: s.cookies } : {}),
        ...(docs || arch ? { fullPage: s.full } : {}),
        locale: s.locale,
        theme: s.theme,
        viewport: `${s.viewport.width}x${s.viewport.height}`,
        status: resp?.status() ?? null,
        finalPath: new URL(page.url()).pathname,
        redirected: new URL(page.url()).pathname !== s.route.path.split("?")[0], // archetype routes carry a query
        horizontalOverflowPx: Math.max(0, facts.scrollWidth - facts.clientWidth),
        ...facts,
        consoleErrors,
        sha256: createHash("sha256").update(png).digest("hex"),
        bytes: png.length,
      };
      await ctx.close();
      if (n % 16 === 0 || n === states.length) console.log(`  ${n}/${states.length}`);
    }
  } finally {
    await browser.close();
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  const after = readFileSync(".next/BUILD_ID", "utf8").trim();
  if (after !== buildId) {
    console.error(`✗ .next/BUILD_ID changed during the run (${buildId} → ${after}) — captures are not from one build`);
    process.exit(2);
  }
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  // Server stdout/stderr for this capture, so any HTTP 500 recorded in the manifest can be traced
  // to its server-side cause. Git-ignored working state; it is not part of the baseline.
  writeFileSync(join(WORK, "server-last-capture.log"), log());
  console.log(`• captured ${Object.keys(manifest.states).length} states → ${outDir}`);
}

// ------------------------------------------------------------------------------------- controls
/**
 * DEV-UI-01.4 control gallery. The real primitives (tests/ui-baseline/controls-gallery.tsx) are
 * bundled with esbuild and served ONLY through Playwright request interception on the baseline
 * server's origin — no application route exists for it — inside a page that links the app's own
 * compiled stylesheets and carries the root layout's font classes, so the controls render exactly
 * as in the app. The server is still needed for those stylesheets and the self-hosted fonts.
 */
const CONTROL_ACTIONS = {
  "select-open": async (page) => {
    await page.click("[data-gallery=select-main]");
    await page.locator('[role="listbox"]').waitFor();
  },
  "searchable-open": async (page) => {
    await page.click("#g-ss1");
    await page.locator('[role="listbox"]').waitFor();
  },
  "searchable-filter": async (page, s) => {
    await CONTROL_ACTIONS["searchable-open"](page);
    await page.keyboard.type(s.locale === "ar" ? "الميناء" : "har");
  },
  "searchable-active": async (page) => {
    await CONTROL_ACTIONS["searchable-open"](page);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
  },
  "focus-radio": async (page) => {
    await tabTo(page, "[data-slot=radio]:checked");
  },
  "menu-row-open": async (page) => {
    await page.click(".row-menu-btn");
    await page.locator('[role="menu"]').waitFor();
    await page.locator('[role="menu"] .row-menu-item.has-submenu').click();
    await page.locator(".row-menu-submenu.open").waitFor();
  },
  "menu-sub-open": async (page) => {
    await tabTo(page, "[data-gallery=sub-trigger]");
    await page.keyboard.press("Enter");
    await page.locator('[role="menu"]').waitFor();
    // Radix moves focus into the menu asynchronously; key presses before that are lost.
    await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "menuitem");
    await page.keyboard.press("ArrowDown"); // Duplicate → Export (the sub trigger)
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-gallery") === "sub");
    await page.keyboard.press(page.__dir === "rtl" ? "ArrowLeft" : "ArrowRight");
    await page.locator('[role="menu"]').nth(1).waitFor();
  },
  "focus-tab": async (page) => {
    await tabTo(page, '[role="tab"]');
    await page.keyboard.press(page.__dir === "rtl" ? "ArrowLeft" : "ArrowRight");
  },
};
/** Reach a control with the keyboard (Tab), so :focus-visible matches as it would for a user. */
async function tabTo(page, selector) {
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate((sel) => document.activeElement?.matches(sel) ?? false, selector)) return;
  }
  throw new Error(`keyboard focus never reached ${selector}`);
}

async function captureControls(outDir) {
  if (!existsSync(PASSWORD_FILE)) {
    console.error("✗ no seeded template — run `prepare` first");
    process.exit(2);
  }
  const storageDir = join(WORK, "storage-fake");
  rmSync(storageDir, { recursive: true, force: true });
  mkdirSync(storageDir, { recursive: true });
  const env = serverEnv({ frozenNow: FROZEN_NOW, storageDir });
  console.log(`• run database: ${describe(env.DATABASE_URL)} (TEST-ONLY, fresh copy of ${TEMPLATE_DB})`);
  await recreate(RUN_DB, TEMPLATE_DB);
  if (!flag("skip-build")) {
    console.log("• building (test environment)…");
    const b = spawnSync("npm", ["run", "build"], { env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (b.status !== 0) {
      console.error(`✗ build failed\n${(b.stdout ?? "").slice(-3000)}${(b.stderr ?? "").slice(-3000)}`);
      process.exit(2);
    }
  }
  const { build } = await import("esbuild");
  const bundle = await build({
    entryPoints: [join(ROOT, "tests/ui-baseline/controls-gallery.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", target: "es2022",
    tsconfig: join(ROOT, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' }, logLevel: "error", minify: true, alias: { "next/link": join(ROOT, "tests/ui-baseline/gallery-link-stub.tsx") },
  });
  const galleryJs = bundle.outputFiles[0].text;
  const buildId = readFileSync(".next/BUILD_ID", "utf8").trim();
  const { server, log } = await startServer(env);
  console.log(`• server on ${BASE}, build ${buildId}`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--font-render-hinting=none", "--disable-skia-runtime-opts", "--force-color-profile=srgb", "--disable-gpu", "--disable-partial-raster", "--disable-lcd-text"] });
  const manifest = { frozenNow: FROZEN_NOW, buildId, chromium: browser.version(), galleryBytes: galleryJs.length, states: {} };
  try {
    // The app's own stylesheets and font classes, read from a real authenticated page.
    const lc = await browser.newContext({ timezoneId: "UTC" });
    const lp = await lc.newPage();
    await lp.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await lp.fill("#email", OWNER_EMAIL);
    await lp.fill("#password", readFileSync(PASSWORD_FILE, "utf8"));
    await Promise.all([lp.waitForURL(`${BASE}/dashboard`, { timeout: 30000 }), lp.click('button[type="submit"]')]);
    const shellInfo = await lp.evaluate(() => ({
      sheets: [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute("href")),
      htmlClass: document.documentElement.className,
    }));
    await lc.close();
    if (!shellInfo.sheets.length) throw new Error("no application stylesheets found");
    const only = value("only");
    const states = controlsMatrix().filter((s) => !only || s.id.includes(only));
    let n = 0;
    for (const s of states) {
      n++;
      const ctx = await browser.newContext({ viewport: { width: s.viewport.width, height: s.viewport.height }, deviceScaleFactor: 1, colorScheme: s.theme, reducedMotion: "reduce", timezoneId: "UTC", locale: s.locale === "ar" ? "ar-SA" : "en-US" });
      const page = await ctx.newPage();
      const consoleErrors = [];
      page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 200)));
      page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 200)}`));
      const dir = s.locale === "ar" ? "rtl" : "ltr";
      const html = `<!doctype html><html lang="${s.locale}" dir="${dir}" data-theme="${s.theme}" class="${shellInfo.htmlClass}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${shellInfo.sheets.map((h) => `<link rel="stylesheet" href="${h}">`).join("")}</head><body class="min-h-full bg-canvas text-ink"><div id="gallery-root"></div><script>window.__GALLERY__=${JSON.stringify({ group: s.group, locale: s.locale })}</script><script>${galleryJs.replace(/<\/script/g, "<\\/script")}</script></body></html>`;
      await page.route(`${BASE}/__ui-baseline/controls/**`, (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
      const resp = await page.goto(`${BASE}${s.route.path}`, { waitUntil: "networkidle" });
      await page.locator("[data-gallery-group]").waitFor();
      await page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
      page.__dir = dir;
      if (s.action) {
        if (s.action.startsWith("focus:")) await tabTo(page, s.action.slice(6));
        else await CONTROL_ACTIONS[s.action](page, s);
        await page.waitForTimeout(250); // transitions are reduced, but let Radix settle
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      }
      const facts = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, scrollHeight: document.documentElement.scrollHeight, fontsLoaded: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family).sort().filter((v, i, a) => a.indexOf(v) === i), active: document.activeElement?.getAttribute("data-slot") || document.activeElement?.getAttribute("role") || document.activeElement?.tagName }));
      const file = join(outDir, `${s.id}.png`);
      await page.screenshot({ path: file, fullPage: true, animations: "disabled", caret: "hide", scale: "css" });
      const png = readFileSync(file);
      manifest.states[s.id] = { route: s.route.path, area: s.route.area, group: s.group, action: s.action, locale: s.locale, theme: s.theme, viewport: `${s.viewport.width}x${s.viewport.height}`, status: resp?.status() ?? null, horizontalOverflowPx: Math.max(0, facts.scrollWidth - facts.clientWidth), ...facts, consoleErrors, sha256: createHash("sha256").update(png).digest("hex"), bytes: png.length };
      await ctx.close();
      if (n % 16 === 0 || n === states.length) console.log(`  ${n}/${states.length}`);
    }
  } finally {
    await browser.close();
    try { process.kill(-server.pid, "SIGTERM"); } catch { /* already gone */ }
  }
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(WORK, "server-last-capture.log"), log());
  console.log(`• captured ${Object.keys(manifest.states).length} states → ${outDir}`);
}

// ------------------------------------------------------------------------------------- compare
/**
 * Software rasterisation is not bit-exact between runs on this machine: a handful of anti-aliased
 * edge pixels can move by 1–6/255 with no change in the page (measured during DEV-UI-01.0: ≤107 px,
 * max delta 6, invisible). A state is therefore reported in one of four classes and the strict
 * classes are always shown, never folded away:
 *   IDENTICAL        png bytes equal
 *   PIXEL-IDENTICAL  bytes differ, every pixel equal
 *   AA-NOISE         every differing pixel within ±CHANNEL_TOLERANCE and at most MAX_NOISE_PIXELS
 *   DIFFERENT        anything else — a real change (fails the comparison)
 * A redesign change moves text, colour or layout by far more than 8/255 on far more than 500 px.
 */
const CHANNEL_TOLERANCE = 8;
const MAX_NOISE_PIXELS = 500;
async function decode(file) {
  const { PNG } = await import("pngjs");
  return PNG.sync.read(readFileSync(file));
}

async function compare(a, b) {
  const ma = JSON.parse(readFileSync(join(a, "manifest.json"), "utf8"));
  const mb = JSON.parse(readFileSync(join(b, "manifest.json"), "utf8"));
  const ids = [...new Set([...Object.keys(ma.states), ...Object.keys(mb.states)])].sort();
  const rows = [];
  for (const id of ids) {
    const sa = ma.states[id];
    const sb = mb.states[id];
    if (!sa || !sb) {
      rows.push({ id, result: "MISSING", detail: !sa ? `absent in ${a}` : `absent in ${b}` });
      continue;
    }
    if (sa.sha256 === sb.sha256) {
      rows.push({ id, result: "IDENTICAL" });
      continue;
    }
    const pa = await decode(join(a, `${id}.png`));
    const pb = await decode(join(b, `${id}.png`));
    if (pa.width !== pb.width || pa.height !== pb.height) {
      rows.push({ id, result: "DIFFERENT", detail: `size ${pa.width}x${pa.height} vs ${pb.width}x${pb.height}` });
      continue;
    }
    let diff = 0;
    let beyond = 0;
    let maxDelta = 0;
    for (let i = 0; i < pa.data.length; i += 4) {
      const d = Math.max(Math.abs(pa.data[i] - pb.data[i]), Math.abs(pa.data[i + 1] - pb.data[i + 1]), Math.abs(pa.data[i + 2] - pb.data[i + 2]), Math.abs(pa.data[i + 3] - pb.data[i + 3]));
      if (d > 0) diff++;
      if (d > CHANNEL_TOLERANCE) beyond++;
      if (d > maxDelta) maxDelta = d;
    }
    const result = diff === 0 ? "PIXEL-IDENTICAL" : beyond === 0 && diff <= MAX_NOISE_PIXELS ? "AA-NOISE" : "DIFFERENT";
    rows.push({ id, result, detail: diff === 0 ? "png bytes differ, pixels equal" : `${diff} px differ, max channel delta ${maxDelta}/255, ${beyond} px beyond ±${CHANNEL_TOLERANCE}` });
  }
  const bad = rows.filter((r) => r.result === "DIFFERENT" || r.result === "MISSING");
  const noise = rows.filter((r) => r.result === "AA-NOISE");
  for (const r of [...noise, ...bad]) console.log(`  ${r.result.padEnd(10)} ${r.id}  ${r.detail ?? ""}`);
  const identical = rows.filter((r) => r.result === "IDENTICAL").length;
  const pixelIdentical = rows.filter((r) => r.result === "PIXEL-IDENTICAL").length;
  console.log(
    `\n${rows.length} states: ${identical} byte-identical, ${pixelIdentical} pixel-identical, ` +
      `${noise.length} anti-aliasing noise only (every pixel within ±${CHANNEL_TOLERANCE}/255, ≤${MAX_NOISE_PIXELS} px), ${bad.length} different/missing`,
  );
  return bad.length;
}

// ------------------------------------------------------------------------------------- main
try {
  if (cmd === "prepare") await prepare();
  else if (cmd === "capture") await capture(resolve(value("out") ?? join(WORK, "captures/latest")));
  else if (cmd === "capture-shell") await capture(resolve(value("out") ?? join(WORK, "captures/shell-latest")), true);
  else if (cmd === "capture-lists") await capture(resolve(value("out") ?? join(WORK, "captures/lists-latest")), false, true);
  else if (cmd === "capture-documents") await capture(resolve(value("out") ?? join(WORK, "captures/documents-latest")), false, false, true);
  else if (cmd === "capture-archetypes") await capture(resolve(value("out") ?? join(WORK, "captures/archetypes-latest")), false, false, false, true);
  else if (cmd === "capture-controls") await captureControls(resolve(value("out") ?? join(WORK, "captures/controls-latest")));
  else if (cmd === "compare") process.exit((await compare(resolve(positional[0]), resolve(positional[1]))) === 0 ? 0 : 1);
  else if (cmd === "check") {
    const out = join(WORK, "captures/check");
    await capture(out);
    process.exit((await compare(BASELINE_DIR, out)) === 0 ? 0 : 1);
  } else {
    console.error("usage: run.mjs prepare | capture [--out=DIR] | capture-shell [--out=DIR] | capture-controls [--out=DIR] | capture-lists [--out=DIR] | capture-documents [--out=DIR] | capture-archetypes [--out=DIR] | compare A B | check   [--skip-build] [--only=substr]");
    process.exit(2);
  }
} catch (e) {
  if (e instanceof IsolationError) {
    console.error(`✗ ISOLATION REFUSAL: ${e.message}`);
    process.exit(2);
  }
  throw e;
}
