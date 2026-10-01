/**
 * DEV-UI-01.0 — visual baseline harness.
 *
 *   node tests/ui-baseline/run.mjs prepare            create + seed the TEST-ONLY template database
 *   node tests/ui-baseline/run.mjs capture [--out=D]  build, serve a TEST-ONLY copy, capture the matrix
 *   node tests/ui-baseline/run.mjs compare A B        pixel-compare two capture directories
 *   node tests/ui-baseline/run.mjs check              capture, then compare against the committed baseline
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

// ------------------------------------------------------------------------------------- capture
async function capture(outDir) {
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

    const only = value("only");
    const states = matrix().filter((s) => !only || s.id.includes(only));
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
        storageState: s.route.auth === false ? undefined : storageState,
      });
      await ctx.addCookies([
        { name: "locale", value: s.locale, url: BASE },
        { name: "theme", value: s.theme, url: BASE },
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
      const file = join(outDir, `${s.id}.png`);
      await page.screenshot({ path: file, fullPage: true, animations: "disabled", caret: "hide", scale: "css" });
      const png = readFileSync(file);
      manifest.states[s.id] = {
        route: s.route.path,
        area: s.route.area,
        locale: s.locale,
        theme: s.theme,
        viewport: `${s.viewport.width}x${s.viewport.height}`,
        status: resp?.status() ?? null,
        finalPath: new URL(page.url()).pathname,
        redirected: new URL(page.url()).pathname !== s.route.path,
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
  else if (cmd === "compare") process.exit((await compare(resolve(positional[0]), resolve(positional[1]))) === 0 ? 0 : 1);
  else if (cmd === "check") {
    const out = join(WORK, "captures/check");
    await capture(out);
    process.exit((await compare(BASELINE_DIR, out)) === 0 ? 0 : 1);
  } else {
    console.error("usage: run.mjs prepare | capture [--out=DIR] | compare A B | check   [--skip-build] [--only=substr]");
    process.exit(2);
  }
} catch (e) {
  if (e instanceof IsolationError) {
    console.error(`✗ ISOLATION REFUSAL: ${e.message}`);
    process.exit(2);
  }
  throw e;
}
