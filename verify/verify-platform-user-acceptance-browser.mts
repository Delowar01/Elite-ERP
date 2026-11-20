/**
 * Platform Owner PO-03D — browser suite for the public USER-invitation acceptance page /join/accept: the production
 * build (`next build` first) served by `next start` on loopback, driven in Chromium.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *   PO03D_SCREENSHOT_DIR=<optional output dir> npm run verify:platform-user-acceptance-browser
 *
 * Server A: CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED=true and CUSTOMER_SEAT_ENFORCEMENT_ENABLED=true; CUSTOMER_PUBLIC_ORIGIN
 * is server A's own loopback origin (an http origin is accepted only with PLATFORM_INVITATIONS_LOOPBACK_ORIGIN=true — a
 * test-only approval); one trusted proxy hop, and every browser context sends its own fictional X-Forwarded-For. The
 * Platform Owner console flags stay OFF: acceptance is independent of them. Server B: acceptance OFF (the variable
 * unset). One disposable database (dropped at the end): the reviewed schema, the PO-02D1B Trial seed and the staged
 * PO-03C user_invitations SQL, with fictional companies and invitations written as PO-03C writes them (32 random bytes,
 * base64url; only sha256 stored). TEST-ONLY secrets are generated in memory and never printed; the tokens are held only
 * to prove they appear nowhere they must not. Chromium is the pre-installed build (PO01B_CHROMIUM, default
 * /opt/pw-browsers/chromium) — nothing is downloaded.
 *
 * Categories J1 … J13 (docs/platform-owner/PO03D_DEVELOPMENT.md §L): switched off; missing, malformed and unknown links;
 * the fragment (removed before any request; refresh, back, a second link, a cached restore, leaving the page); what the
 * invitee reviews (company, e-mail, role, expiry, plan, seats — the reserved seat counted, enforced); validation; a
 * keyboard-only acceptance, no session, then the existing sign-in; refusal screens (expired, withdrawn, used, a full
 * company) with retry only where it can help; one request per submit; a signed-in visitor; token hygiene (URL, history,
 * storage, cookies, console, requests, Referer, DOM, server output, every table); page protections; EN / AR × light /
 * dark × 1440 / 1024 / 768 / 390 / 360 with layout audits and screenshots.
 */
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Page, Request as PwRequest } from "playwright";
import bcrypt from "bcryptjs";
import { connectDisposable, createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { section, ok, summary, describeError } from "./platform/harness";
import { startServer, testSecrets, type Server } from "./platform/browser-env";
import { loadActionIds } from "./action-id.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");

const ROOT = process.cwd();
const testDbName = disposableName("po03d_uaccept_browser");
const secrets = testSecrets();
const PORT_A = Number(process.env.PO03D_PORT_A || 3471);
const PORT_B = Number(process.env.PO03D_PORT_B || 3472);
process.env.DATABASE_URL = databaseUrlFor(testDbName);
Object.assign(process.env, secrets);

let created = false;
await createPlatformTestDatabase("po03d_uaccept_browser", testDbName);
created = true;
{
  const { runSeed } = await import("../scripts/platform/trial-seed");
  const seeded = await runSeed(process.env.DATABASE_URL);
  if (seeded.check.state !== "complete") throw new Error(`the Trial seed did not complete: ${seeded.check.state}`);
}
{
  const c = await connectDisposable(process.env.DATABASE_URL!);
  try {
    await c.query(readFileSync(join(ROOT, "drizzle/platform/PO03C_user_invitations.sql"), "utf8"));
  } finally {
    await c.end();
  }
}

const { pool } = await import("../src/db");
pool.on("error", () => undefined);

const SHOTS = process.env.PO03D_SCREENSHOT_DIR || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PASSWORD = "Harbor-Quill-74!z";
const MEMBER_PASSWORD = "Cedar-Lantern-38#w";
const secretsSeen: string[] = [PASSWORD, MEMBER_PASSWORD, ...Object.values(secrets)];
const tokensSeen: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const plain = (s: string) => s.replace(/[⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
const q = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
const one = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await q<T>(text, values))[0];
const n = async (text: string, values: unknown[] = []) => Number((await one<{ n: number }>(text, values))?.n ?? 0);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const HOUR = 3_600_000;

let ipSeq = 0;
const nextIp = () => {
  ipSeq += 1;
  return `203.0.113.${(ipSeq % 250) + 1}`;
};

// ---- fictional companies and invitations ------------------------------------------------------------------------------
const admin = (
  await one<{ id: string }>(
    `insert into platform_admins (email_normalized, display_name, password_hash, mfa_secret_encrypted, mfa_enrolled_at) values ('operator@join-browser.test', 'Fictional Operator', $1, 'v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB==:CCCCCCCC', now()) returning id`,
    [await bcrypt.hash("Fictional-Passw0rd!x", 4)],
  )
)!.id;
const trialV1 = (await one<{ id: string }>(`select v.id from subscription_package_versions v join subscription_packages p on p.id = v.package_id where p.is_default_trial and v.version_number = 1`))!.id;
let seq = 0;
async function company(name: string, seats: number | null, users = 1): Promise<{ orgId: number; ownerEmail: string }> {
  const orgId = Number((await one<{ id: number }>(`insert into orgs (name, country, currency) values ($1, 'Saudi Arabia', 'SAR') returning id`, [name]))!.id);
  const hash = await bcrypt.hash(PASSWORD, 4);
  const ownerEmail = `owner.${orgId}@join-browser.test`;
  await q(`insert into users (org_id, email, password_hash, name, role) values ($1, $2, $3, 'Fixture Owner', 'owner')`, [orgId, ownerEmail, hash]);
  for (let i = 1; i < users; i++) await q(`insert into users (org_id, email, password_hash, name, role) values ($1, $2, $3, 'Fixture Staff', 'staff')`, [orgId, `staff.${orgId}.${i}@join-browser.test`, hash]);
  if (seats !== null) {
    await q(
      `insert into tenant_subscriptions (org_id, package_version_id, version_state, is_trial, cycle, lifecycle_state, start_date, end_date, price_snapshot_sar, seats_snapshot, storage_snapshot_gb, module_groups_snapshot, assignment_source)
       values ($1, $2, 'published', true, 'trial', 'trialing', current_date, current_date + 13, 0, $3, 5, '[]'::jsonb, 'invitation_acceptance')`,
      [orgId, trialV1, seats],
    );
  }
  return { orgId, ownerEmail };
}
type Fixture = { id: string; token: string; email: string; name: string; reference: string; expiresAt: Date };
async function invitation(orgId: number, opts: { name?: string; email?: string; role?: "admin" | "staff"; state?: "pending" | "expired" | "revoked" } = {}): Promise<Fixture> {
  seq += 1;
  const token = randomBytes(32).toString("base64url");
  tokensSeen.push(token);
  const state = opts.state ?? "pending";
  const email = opts.email ?? `invitee${seq}@join-browser.test`;
  const name = opts.name ?? "Fixture Invitee";
  const createdAt = new Date(Date.now() - (state === "expired" ? 80 * HOUR : HOUR));
  const expiresAt = new Date(createdAt.getTime() + 72 * HOUR);
  const row = await one<{ id: string }>(
    `insert into user_invitations (org_id, name, email_normalized, requested_role, token_hash, expires_at, invited_by_platform_admin_id, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [orgId, name, email, opts.role ?? "staff", sha256(token), expiresAt, admin, createdAt],
  );
  if (state === "revoked") await q(`update user_invitations set revoked_at = greatest(now(), created_at), revoked_by_platform_admin_id = $2 where id = $1`, [row!.id, admin]);
  return { id: row!.id, token, email, name, reference: `UIN-${row!.id.slice(0, 8).toUpperCase()}`, expiresAt };
}
const invRow = (id: string) => one<{ accepted_at: Date | null; accepted_user_id: number | null }>(`select accepted_at, accepted_user_id from user_invitations where id = $1`, [id]);
const userCount = () => n(`select count(*)::int as n from users`);

// ---- browser plumbing: every request, console line and page error is recorded ---------------------------------------
let browser!: Browser;
let A!: Server;
let B!: Server;
type Prefs = { locale: "en" | "ar"; theme: "light" | "dark" };
type Seen = { id: number; url: string; method: string; headers: Record<string, string>; body: string; from: string };
const requests: Seen[] = [];
let reqSeq = 0;
const pendingRecords: Promise<void>[] = [];
const consoleLines: string[] = [];
const pageErrors: string[] = [];
const ORDER_PROBE = `(() => {
  const rec = { replaced: [], fetches: [] };
  Object.defineProperty(window, "__po03d", { value: rec });
  for (const m of ["replaceState", "pushState"]) {
    const orig = history[m].bind(history);
    history[m] = function (s, t, u) { const before = location.hash.length > 0; const r = orig(s, t, u); rec.replaced.push({ m, at: performance.now(), before, after: location.hash.length > 0 }); return r; };
  }
  const f = window.fetch.bind(window);
  window.fetch = function (...args) { rec.fetches.push({ at: performance.now(), fragment: location.hash.length > 0 }); return f(...args); };
})();`;
async function newContext(server: Server, prefs: Prefs = { locale: "en", theme: "light" }, viewport = { width: 1440, height: 900 }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ baseURL: server.url, viewport, deviceScaleFactor: 1, reducedMotion: "reduce", extraHTTPHeaders: { "x-forwarded-for": nextIp() } });
  await ctx.addInitScript(ORDER_PROBE);
  await ctx.addCookies([
    { name: "locale", value: prefs.locale, url: server.url },
    { name: "theme", value: prefs.theme, url: server.url },
  ]);
  ctx.on("page", (p) => watch(p));
  return ctx;
}
function watch(page: Page) {
  page.on("console", (m) => consoleLines.push(m.text()));
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("request", (r: PwRequest) => {
    const id = ++reqSeq;
    const from = page.url();
    pendingRecords.push(
      (async () => {
        const headers = await r.allHeaders().catch(() => ({}) as Record<string, string>);
        requests.push({ id, url: r.url(), method: r.method(), headers, body: r.postData() ?? "", from });
      })(),
    );
  });
}
const markNow = () => reqSeq;
const after = (mark: number) => requests.filter((r) => r.id > mark);
const actionPosts = (mark: number) => after(mark).filter((r) => r.method === "POST" && "next-action" in r.headers);
const settleRecords = async () => {
  await Promise.all(pendingRecords.splice(0));
};
async function open(page: Page, path: string) {
  await page.goto("about:blank");
  return page.goto(path);
}
async function heading(page: Page, text: string, timeout = 20_000) {
  await page.locator("h1", { hasText: text }).first().waitFor({ state: "visible", timeout });
}
async function openForm(page: Page, f: Fixture) {
  await open(page, `/join/accept#t=${f.token}`);
  await page.locator("#password").waitFor({ state: "visible", timeout: 20_000 });
}
async function fillAndSubmit(page: Page, password: string, confirm = password) {
  await page.locator("#password").fill(password);
  await page.locator("#confirm").fill(confirm);
  await page.locator("form button[type=submit]").click();
}
const tokenInDom = (page: Page, token: string) =>
  page.evaluate((t) => document.documentElement.outerHTML.includes(t) || [...document.querySelectorAll("input")].some((i) => (i as HTMLInputElement).value.includes(t)), token);
type HistoryWrite = { m: string; at: number; before: boolean; after: boolean };
const order = (page: Page) => page.evaluate(() => (window as unknown as { __po03d: { replaced: HistoryWrite[]; fetches: { at: number; fragment: boolean }[] } }).__po03d);
async function stores(page: Page) {
  return page.evaluate(async () => ({
    web: localStorage.length + sessionStorage.length,
    idb: typeof indexedDB.databases === "function" ? (await indexedDB.databases()).length : 0,
    caches: typeof caches !== "undefined" ? (await caches.keys()).length : 0,
    historyState: JSON.stringify(history.state ?? null),
    url: location.href,
  }));
}

// ---- layout audit (the PO-01B / PO-02 rules) --------------------------------------------------------------------------
type AuditResult = { h1: number; lang: string; dir: string; overflow: number; unnamed: string[]; unlabelled: string[]; orangeOffenders: string[]; storage: number; clipped: string[] };
const AUDIT_SCRIPT = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const name = (el) => (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").trim();
  const unnamed = [...document.querySelectorAll("button, a[href]")].filter((el) => visible(el) && !name(el)).map((el) => el.outerHTML.slice(0, 80));
  const labelled = (el) => (el.labels && el.labels.length) || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
  const unlabelled = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter((el) => visible(el) && !labelled(el)).map((el) => el.outerHTML.slice(0, 80));
  const rgb = (c) => (c.match(/rgba?\\(([\\d.]+), ([\\d.]+), ([\\d.]+)(?:, ([\\d.]+))?\\)/) || []).slice(1).map((x) => (x === undefined ? undefined : Number(x)));
  const orange = (c) => { const [r, g, b, a] = rgb(c); return (a === undefined ? 1 : a) > 0.9 && r >= 220 && g >= 80 && g <= 135 && b <= 50; };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const bg = getComputedStyle(e).backgroundColor; const a = rgb(bg)[3]; if (bg && bg !== "transparent" && (a === undefined || a > 0.05)) return bg; } return "rgb(255, 255, 255)"; };
  const offenders = [];
  const clipped = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    const text = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || "").trim());
    if (text && orange(bgOf(el)) && getComputedStyle(el).color !== "rgb(255, 255, 255)") offenders.push(el.tagName.toLowerCase() + "." + String(el.className).slice(0, 40) + " " + getComputedStyle(el).color);
    if (text && el.closest("main") && !el.classList.contains("sr-only") && el.scrollWidth > el.clientWidth + 1 && !["auto", "scroll"].includes(getComputedStyle(el).overflowX) && !["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(el.tagName)) clipped.push(el.tagName.toLowerCase() + "." + String(el.className).slice(0, 40));
  }
  return { h1: document.querySelectorAll("h1").length, lang: document.documentElement.lang, dir: document.documentElement.dir, overflow: document.documentElement.scrollWidth - window.innerWidth, unnamed, unlabelled, orangeOffenders: offenders, storage: localStorage.length + sessionStorage.length, clipped };
})()`;
const audit = async (page: Page) => (await page.evaluate(AUDIT_SCRIPT)) as AuditResult;
const auditOk = (a: AuditResult) => a.h1 === 1 && a.overflow <= 1 && a.unnamed.length === 0 && a.unlabelled.length === 0 && a.orangeOffenders.length === 0 && a.storage === 0 && a.clipped.length === 0;
const auditText = (a: AuditResult) => JSON.stringify({ ...a, unnamed: a.unnamed.slice(0, 2), unlabelled: a.unlabelled.slice(0, 2), orangeOffenders: a.orangeOffenders.slice(0, 2), clipped: a.clipped.slice(0, 3) });
const shots: string[] = [];
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await sleep(150);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
  shots.push(name);
}

// ---- direct POSTs to the build's own server actions (ids from its manifest) -------------------------------------------
const actionIdOf = await loadActionIds();
async function postAction(server: Server, name: string, input: unknown): Promise<{ status: number; text: string }> {
  const id = actionIdOf(name);
  if (!id) throw new Error(`server action ${name} is not in the build manifest`);
  const res = await fetch(`${server.url}/join/accept`, { method: "POST", headers: { "next-action": id, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", origin: server.url, "x-forwarded-for": nextIp() }, body: JSON.stringify([input]), redirect: "manual" });
  return { status: res.status, text: await res.text() };
}

async function main() {
  browser = await chromium.launch({ executablePath: process.env.PO01B_CHROMIUM || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const common = { ...secrets, DATABASE_URL: process.env.DATABASE_URL, PLATFORM_TRUSTED_PROXY_HOPS: "1", PLATFORM_CONSOLE_ENABLED: undefined, PLATFORM_USER_INVITATIONS_ENABLED: undefined, PLATFORM_INVITATIONS_ENABLED: undefined, CUSTOMER_INVITE_ACCEPTANCE_ENABLED: undefined, PLATFORM_INVITATIONS_LOOPBACK_ORIGIN: "true" };
  A = await startServer(PORT_A, { ...common, CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED: "true", CUSTOMER_SEAT_ENFORCEMENT_ENABLED: "true", CUSTOMER_PUBLIC_ORIGIN: `http://localhost:${PORT_A}` });
  B = await startServer(PORT_B, { ...common, CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED: undefined, CUSTOMER_SEAT_ENFORCEMENT_ENABLED: undefined, CUSTOMER_PUBLIC_ORIGIN: `http://localhost:${PORT_B}` });
  const foreignHosts = () => [...new Set(requests.map((r) => new URL(r.url).hostname).filter((h) => h !== "localhost" && h !== "127.0.0.1" && h !== ""))];
  // Many sections leave their invitations pending (each reserves a seat); 30 seats keep this company from filling up —
  // with enforcement on, a full company refuses the link (J7 shows that on purpose, with a company of its own).
  const alpha = await company("Qamar Fixture Exhibitions", 30, 2);

  // ==============================================================================================================
  section("J1. Acceptance OFF (CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED unset): no form, no invitation data, no request; the actions refuse");
  {
    const f = await invitation(alpha.orgId, { name: "Noor Fixture" });
    const ctx = await newContext(B);
    const page = await ctx.newPage();
    const mark = markNow();
    await open(page, `/join/accept#t=${f.token}`);
    await heading(page, "Invitation acceptance isn't available");
    await settleRecords();
    ok("J1 the page says acceptance isn't available (one h1), names no company, removes the fragment and calls no server action",
      (await page.locator("h1").count()) === 1 && !(await page.content()).includes("Qamar") && !page.url().includes("#") && actionPosts(mark).length === 0);
    const before = await userCount();
    const c1 = await postAction(B, "checkJoinLinkAction", { token: f.token });
    const c2 = await postAction(B, "acceptJoinLinkAction", { token: f.token, name: "Noor Fixture", password: PASSWORD, confirm: PASSWORD });
    ok("J1 a direct same-origin POST of either action (the build's own ids) is refused 'disabled'; nothing is created",
      c1.text.includes('"reason":"disabled"') && c2.text.includes('"reason":"disabled"') && !c1.text.includes("Qamar") && (await userCount()) === before && (await invRow(f.id))?.accepted_at === null);
    await shot(page, "00-disabled-en-light-1440");
    await ctx.close();
  }

  // ==============================================================================================================
  section("J2. Missing, malformed and unknown links");
  {
    const ctx = await newContext(A);
    const page = await ctx.newPage();
    let mark = markNow();
    await open(page, "/join/accept");
    await heading(page, "No invitation found in this link");
    await settleRecords();
    ok("J2 no fragment → 'No invitation found in this link', no server action", actionPosts(mark).length === 0);
    await shot(page, "01-missing-en-light-1440");
    mark = markNow();
    await open(page, "/join/accept#t=not*a+valid/token");
    await heading(page, "No invitation found in this link");
    await settleRecords();
    ok("J2 a fragment that is not a link token → the same screen, no request, the fragment removed", actionPosts(mark).length === 0 && !page.url().includes("#"));
    mark = markNow();
    await open(page, `/join/accept?t=${randomBytes(32).toString("base64url")}`);
    await heading(page, "No invitation found in this link");
    await settleRecords();
    ok("J2 a token in the QUERY string is never read → 'No invitation found', no request", actionPosts(mark).length === 0);
    mark = markNow();
    const unknown = randomBytes(32).toString("base64url");
    tokensSeen.push(unknown);
    await open(page, `/join/accept#t=${unknown}`);
    await heading(page, "This invitation link can't be used");
    await settleRecords();
    ok("J2 an unknown token → 'This invitation link can't be used' after exactly one same-origin POST, with no Try again", actionPosts(mark).length === 1 && (await page.getByRole("button", { name: "Try again" }).count()) === 0);
    await shot(page, "02-invalid-en-light-1440");
    await ctx.close();
  }

  // ==============================================================================================================
  section("J3. The fragment: removed before any request; refresh, back, a second link, a cached restore, leaving the page");
  {
    const f = await invitation(alpha.orgId, { name: "Salma Fixture" });
    const ctx = await newContext(A);
    const page = await ctx.newPage();
    await openForm(page, f);
    const o = await order(page);
    const removal = o.replaced.findIndex((w) => w.before && !w.after);
    ok("J3 the fragment was removed from the history entry by one write, and no later history write put it back",
      removal >= 0 && o.replaced.slice(removal).every((w) => !w.after), JSON.stringify(o.replaced.map((w) => `${w.m}:${w.before ? 1 : 0}${w.after ? 1 : 0}`)));
    ok("J3 …and BEFORE the first request: no fetch ever ran with the fragment in the address", o.fetches.length >= 1 && o.fetches.every((x) => !x.fragment) && removal >= 0 && o.fetches[0].at >= o.replaced[removal].at);
    await page.evaluate(() => (window as unknown as { next: { router: { refresh(): void } } }).next.router.refresh());
    await sleep(1_500);
    const o2 = await order(page);
    ok("J3 after a router state change (router.refresh) the address still has no fragment: the router never held the link", !page.url().includes("#") && o2.replaced.slice(removal).every((w) => !w.after) && (await page.locator("#password").isVisible()));
    const st = await stores(page);
    ok("J3 the token is in no text, attribute or field, not in the address or the history entry, not in Web Storage, IndexedDB, the Cache API or a cookie",
      !(await tokenInDom(page, f.token)) && !st.url.includes("#") && !st.historyState.includes(f.token) && st.web === 0 && st.idb === 0 && st.caches === 0 && !(await ctx.cookies()).some((c) => c.value.includes(f.token)));
    let mark = markNow();
    await page.reload();
    await heading(page, "No invitation found in this link");
    await settleRecords();
    ok("J3 a refresh cannot bring the link back: 'No invitation found', no request", actionPosts(mark).length === 0 && !page.url().includes("#"));
    await openForm(page, f);
    await page.goto("/login");
    await heading(page, "Welcome back");
    mark = markNow();
    await page.goBack();
    await heading(page, "No invitation found in this link");
    await settleRecords();
    ok("J3 navigating away and pressing Back: no fragment, no form, no request", actionPosts(mark).length === 0 && (await page.locator("#password").count()) === 0);
    await open(page, "/join/accept");
    await heading(page, "No invitation found in this link");
    await page.evaluate((t) => {
      window.location.hash = `t=${t}`;
    }, f.token);
    await page.locator("#password").waitFor({ state: "visible", timeout: 20_000 });
    ok("J3 a second link opened in the same tab (a fragment-only step) reloads and shows its invitation; its fragment is removed too", !page.url().includes("#") && plain(await page.locator("main").innerText()).includes("Qamar Fixture Exhibitions"));
    await openForm(page, f);
    await Promise.all([page.waitForEvent("load"), page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }))).catch(() => undefined)]);
    await heading(page, "No invitation found in this link");
    ok("J3 a page restored from the back/forward cache reloads → 'No invitation found'", (await page.locator("#password").count()) === 0);
    await openForm(page, f);
    const before = await userCount();
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
    await fillAndSubmit(page, MEMBER_PASSWORD);
    await heading(page, "This invitation link can't be used");
    ok("J3 after pagehide the link is gone from memory: a submit is refused as an invalid link and nothing is created", (await userCount()) === before && (await invRow(f.id))?.accepted_at === null);
    await ctx.close();
  }

  // ==============================================================================================================
  section("J4. What the invitee reviews: company, e-mail, role, reference, expiry, plan, seats");
  {
    const c = await company("Rawda Fixture Trading", 3, 1);
    const f = await invitation(c.orgId, { name: "Reem Fixture", email: "reem.member@join-browser.test", role: "admin" });
    const ctx = await newContext(A);
    const page = await ctx.newPage();
    await openForm(page, f);
    const text = plain(await page.locator("main").innerText());
    ok("J4 the invitation's company, e-mail, role (Admin), reference and expiry are shown; the name is prefilled and editable",
      text.includes("Rawda Fixture Trading") && text.includes("reem.member@join-browser.test") && /Your role\s*Admin/.test(text) && text.includes(f.reference) && (await page.locator("#name").inputValue()) === "Reem Fixture" && (await page.locator("#name").isEditable()),
      text.slice(0, 400));
    ok("J4 the company's plan and seats: Trial v1, '2 of 3 in use, including the seat reserved for you', and the limit applies (enforced on server A)",
      /Plan\s*Trial · Version 1 · Trial/.test(text) && text.includes("2 of 3 in use, including the seat reserved for you") && text.includes("The company's user limit applies to this invitation."), text.slice(0, 600));
    ok("J4 the company, e-mail and role cannot be edited: the only inputs are name, password and confirmation (no role or e-mail control)", (await page.locator("main input").count()) === 3 && (await page.locator("main select, main [role=radiogroup]").count()) === 0);
    await shot(page, "03-review-en-light-1440");
    await ctx.close();
  }

  // ==============================================================================================================
  section("J5. Validation: the /register password policy, field by field; nothing is sent for a client-side error");
  {
    const f = await invitation(alpha.orgId);
    const ctx = await newContext(A);
    const page = await ctx.newPage();
    await openForm(page, f);
    let mark = markNow();
    await fillAndSubmit(page, "short");
    await page.locator("#password-error").waitFor({ state: "visible", timeout: 10_000 });
    await settleRecords();
    ok("J5 a short password: 'Must be at least 8 characters.' under the field, marked invalid, and no request", plain(await page.locator("#password-error").innerText()) === "Must be at least 8 characters." && (await page.locator("#password").getAttribute("aria-invalid")) === "true" && actionPosts(mark).length === 0);
    mark = markNow();
    await fillAndSubmit(page, MEMBER_PASSWORD, "Different-Pass-1!");
    await page.locator("#confirm-error").waitFor({ state: "visible", timeout: 10_000 });
    await settleRecords();
    ok("J5 a mismatched confirmation: 'The passwords do not match.', no request", plain(await page.locator("#confirm-error").innerText()) === "The passwords do not match." && actionPosts(mark).length === 0);
    mark = markNow();
    await fillAndSubmit(page, "Password1!");
    await page.locator("#password-error").waitFor({ state: "visible", timeout: 10_000 });
    await settleRecords();
    ok("J5 a common password passes the browser's checks but the server refuses it under the field ('too common'); the link stays usable", plain(await page.locator("#password-error").innerText()).includes("too common") && actionPosts(mark).length === 1 && (await page.locator("#password").isVisible()));
    await page.locator("#name").fill("");
    mark = markNow();
    await fillAndSubmit(page, MEMBER_PASSWORD);
    await page.locator("#name-error").waitFor({ state: "visible", timeout: 10_000 });
    await settleRecords();
    ok("J5 an empty name: 'Enter your name (up to 200 characters).', no request", plain(await page.locator("#name-error").innerText()) === "Enter your name (up to 200 characters)." && actionPosts(mark).length === 0);
    await shot(page, "04-validation-en-light-1440");
    await ctx.close();
  }

  // ==============================================================================================================
  section("J6. A keyboard-only acceptance, one request, no session — then the existing sign-in");
  {
    const f = await invitation(alpha.orgId, { name: "Huda Fixture", email: "huda.member@join-browser.test" });
    const ctx = await newContext(A);
    const page = await ctx.newPage();
    await openForm(page, f);
    await page.locator("#name").focus();
    await page.keyboard.press("Tab");
    const toPassword = await page.evaluate(() => document.activeElement?.id === "password");
    await page.keyboard.type(MEMBER_PASSWORD);
    await page.keyboard.press("Tab");
    const toConfirm = await page.evaluate(() => document.activeElement?.id === "confirm");
    ok("J6 Tab moves name → password → confirmation (labelled fields, in reading order; the hint between them is not a stop)", toPassword && toConfirm);
    await page.keyboard.type(MEMBER_PASSWORD);
    const mark = markNow();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await heading(page, "You've joined Qamar Fixture Exhibitions");
    await settleRecords();
    const accepts = actionPosts(mark).filter((r) => r.body.includes('"password"'));
    const text = plain(await page.locator("main").innerText());
    const user = await one<{ id: number; role: string; org_id: number }>(`select id, role, org_id from users where email = 'huda.member@join-browser.test'`);
    ok("J6 Enter submits; a second Enter in the same instant sends nothing more: exactly ONE acceptance request; the done screen names the company, the e-mail and the role",
      accepts.length === 1 && text.includes("huda.member@join-browser.test") && /Your role: Staff/.test(text) && !!user && user.org_id === alpha.orgId && user.role === "staff" && (await invRow(f.id))?.accepted_user_id === user.id);
    ok("J6 no session is issued: no customer session cookie, and the page links to /login", !(await ctx.cookies()).some((c) => /elite_erp_session/.test(c.name)) && (await page.locator('a[href="/login"]').count()) >= 1);
    ok("J6 the token is gone from the page after success (DOM, fields, address)", !(await tokenInDom(page, f.token)) && !page.url().includes(f.token));
    await shot(page, "05-done-en-light-1440");
    await page.locator('a[href="/login"]').first().click();
    await heading(page, "Welcome back");
    await page.locator("#email").fill("huda.member@join-browser.test");
    await page.locator("#password").fill(MEMBER_PASSWORD);
    await page.locator("form button[type=submit]").click();
    await page.waitForURL("**/dashboard", { timeout: 25_000 });
    ok("J6 the new member signs in with the e-mail and the password they chose (the existing sign-in, unchanged)", page.url().endsWith("/dashboard"));
    await ctx.close();
  }

  // ==============================================================================================================
  section("J7. Refusals: expired, withdrawn, already used, a full company — retry only where it can help");
  {
    const ctx = await newContext(A);
    const page = await ctx.newPage();
    const expired = await invitation(alpha.orgId, { state: "expired" });
    await open(page, `/join/accept#t=${expired.token}`);
    await heading(page, "This invitation has expired");
    ok("J7 an expired link: 'This invitation has expired' (72 hours), no Try again", (await page.getByRole("button", { name: "Try again" }).count()) === 0);
    await shot(page, "06-expired-en-light-1440");
    const revoked = await invitation(alpha.orgId, { state: "revoked" });
    await open(page, `/join/accept#t=${revoked.token}`);
    await heading(page, "This invitation link can't be used");
    ok("J7 a withdrawn link reads exactly like an unknown one ('can't be used'), no Try again", (await page.getByRole("button", { name: "Try again" }).count()) === 0);
    const used = await invitation(alpha.orgId);
    await q(`insert into users (org_id, email, password_hash, name, role) values ($1, $2, $3, 'Fixture Used', 'staff')`, [alpha.orgId, `used.holder.${used.id.slice(0, 6)}@join-browser.test`, await bcrypt.hash(PASSWORD, 4)]);
    const holder = (await one<{ id: number }>(`select id from users where email = $1`, [`used.holder.${used.id.slice(0, 6)}@join-browser.test`]))!.id;
    await q(`update user_invitations set accepted_at = greatest(now(), created_at), accepted_user_id = $2 where id = $1`, [used.id, holder]);
    await open(page, `/join/accept#t=${used.token}`);
    await heading(page, "This invitation has already been used");
    ok("J7 a used link: 'already been used' with a Sign in link (no form)", (await page.locator('main a[href="/login"]').count()) === 1 && (await page.locator("#password").count()) === 0);
    const full = await company("Sadeem Fixture Full", 2, 2);
    const fullInv = await invitation(full.orgId);
    await open(page, `/join/accept#t=${fullInv.token}`);
    await heading(page, "This company has no free user seat");
    ok("J7 a full company (enforced): 'no free user seat', nothing created, and Try again offered (a seat may be freed)", (await page.getByRole("button", { name: "Try again" }).count()) === 1 && (await invRow(fullInv.id))?.accepted_at === null);
    await shot(page, "07-seats-full-en-light-1440");
    await ctx.close();
  }

  // ==============================================================================================================
  section("J8. A signed-in visitor is asked to sign out first; the link is not sent");
  {
    const f = await invitation(alpha.orgId);
    const ctx = await newContext(A);
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.locator("#email").fill(alpha.ownerEmail);
    await page.locator("#password").fill(PASSWORD);
    await page.locator("form button[type=submit]").click();
    await page.waitForURL("**/dashboard", { timeout: 25_000 });
    const mark = markNow();
    await open(page, `/join/accept#t=${f.token}`);
    await heading(page, "You're signed in to Elite ERP");
    await settleRecords();
    ok("J8 'You're signed in' with a Sign out button; no server action carried the link; the fragment is removed", actionPosts(mark).every((r) => !r.body.includes(f.token)) && !page.url().includes("#") && (await page.getByRole("button", { name: "Sign out" }).count()) === 1);
    await shot(page, "08-signed-in-en-light-1440");
    await ctx.close();
  }

  // ==============================================================================================================
  section("J9. Page protections and token hygiene across everything above");
  {
    const res = await fetch(`${A.url}/join/accept`);
    const html = await res.text();
    ok("J9 the page response is not stored (Cache-Control: no-store), not indexed (noindex, nofollow) and sends no referrer",
      /no-store/.test(res.headers.get("cache-control") ?? "") && /<meta name="robots" content="[^"]*noindex[^"]*nofollow/.test(html) && /<meta name="referrer" content="no-referrer"/.test(html));
    await settleRecords();
    const leakedInUrl = requests.filter((r) => tokensSeen.some((t) => r.url.includes(t)));
    const leakedInHeaders = requests.filter((r) => tokensSeen.some((t) => Object.values(r.headers).some((v) => v.includes(t))));
    const withToken = requests.filter((r) => tokensSeen.some((t) => r.body.includes(t)));
    ok("J9 no request URL or header (Referer, Cookie included) ever carried a token; only the two server actions' POST bodies did",
      leakedInUrl.length === 0 && leakedInHeaders.length === 0 && withToken.length > 0 && withToken.every((r) => r.method === "POST" && "next-action" in r.headers && new URL(r.url).pathname === "/join/accept"), `${leakedInUrl.length} ${leakedInHeaders.length}`);
    ok("J9 no console line or page error holds a token or a password; nothing was requested from another host",
      !consoleLines.some((l) => [...tokensSeen, MEMBER_PASSWORD].some((t) => l.includes(t))) && pageErrors.length === 0 && foreignHosts().length === 0, `${pageErrors.slice(0, 2).join(" | ")} ${foreignHosts().join(",")}`);
    const out = A.output() + B.output();
    ok("J9 the servers' output holds no token, password or secret", ![...tokensSeen, ...secretsSeen].some((t) => t.length >= 6 && out.includes(t)) && !out.includes("#t="));
    const tables = (await q<{ t: string }>(`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`)).map((r) => r.t);
    let tableLeaks = 0;
    for (const t of tables) {
      const text = JSON.stringify(await q(`select * from "${t}"`));
      for (const s of [...tokensSeen, MEMBER_PASSWORD]) if (text.includes(s)) tableLeaks++;
    }
    ok("J9 a text scan of every table finds no token and no password (digests and bcrypt hashes only)", tableLeaks === 0, String(tableLeaks));
  }

  // ==============================================================================================================
  section("J10. EN / AR × light / dark × 1440 / 1024 / 768 / 390 / 360 — layout audits and screenshots");
  {
    const review = await invitation(alpha.orgId, { name: "Layla Fixture" });
    const widths = [1440, 1024, 768, 390, 360];
    const fails: string[] = [];
    let checked = 0;
    for (const locale of ["en", "ar"] as const) {
      for (const theme of ["light", "dark"] as const) {
        for (const w of widths) {
          const ctx = await newContext(A, { locale, theme }, { width: w, height: w < 500 ? 844 : 900 });
          const page = await ctx.newPage();
          await openForm(page, review);
          const a = await audit(page);
          checked++;
          const wantDir = locale === "ar" ? "rtl" : "ltr";
          if (!auditOk(a) || a.dir !== wantDir || a.lang !== locale) fails.push(`${locale}-${theme}-${w}: ${auditText(a)}`);
          await shot(page, `10-form-${locale}-${theme}-${w}`);
          await ctx.close();
        }
      }
    }
    ok("J10 the form in EN and AR, light and dark, at 1440 / 1024 / 768 / 390 / 360: one h1, lang and dir set (RTL in Arabic), no horizontal overflow, every control named and labelled, no non-white text on orange, nothing clipped, nothing stored", checked === 20 && fails.length === 0, fails.slice(0, 3).join(" || "));
    const arCtx = await newContext(A, { locale: "ar", theme: "light" }, { width: 390, height: 844 });
    const arPage = await arCtx.newPage();
    await openForm(arPage, review);
    const arText = plain(await arPage.locator("main").innerText());
    ok("J10 Arabic: the headings, labels and seat line are Saudi Arabic; numbers, e-mail and reference stay left-to-right", arText.includes("انضم إلى فريقك") && arText.includes("مقاعد المستخدمين") && arText.includes("قبول الدعوة والانضمام") && (await arPage.locator('span[dir="ltr"]').count()) >= 2);
    const doneInv = await invitation(alpha.orgId, { name: "Dana Fixture" });
    await openForm(arPage, doneInv);
    await fillAndSubmit(arPage, MEMBER_PASSWORD);
    await heading(arPage, "انضممت إلى Qamar Fixture Exhibitions");
    const ad = await audit(arPage);
    ok("J10 the Arabic done screen at 390 px passes the same audit", auditOk(ad) && ad.dir === "rtl", auditText(ad));
    await shot(arPage, "11-done-ar-light-390");
    await arCtx.close();
    for (const theme of ["light", "dark"] as const) {
      const ctx = await newContext(A, { locale: "en", theme }, { width: 360, height: 780 });
      const page = await ctx.newPage();
      const f = await invitation(alpha.orgId);
      await openForm(page, f);
      await fillAndSubmit(page, MEMBER_PASSWORD);
      await heading(page, "You've joined Qamar Fixture Exhibitions");
      await shot(page, `12-done-en-${theme}-360`);
      await ctx.close();
    }
    ok("J10 screenshots written (only when PO03D_SCREENSHOT_DIR is set)", !SHOTS || shots.length >= 30, String(shots.length));
  }
}

let crashed = false;
try {
  await main();
} catch (e) {
  crashed = true;
  ok("the suite ran to completion", false, describeError(e));
} finally {
  await browser?.close().catch(() => undefined);
  await A?.stop().catch(() => undefined);
  await B?.stop().catch(() => undefined);
  await pool.end().catch(() => undefined);
  if (created) await dropDisposableDatabase(testDbName).catch(() => undefined);
}
// A failed check fails the run (the exit code is what a runner reads), as does a crash.
if (summary("verify:platform-user-acceptance-browser") !== 0 || crashed) process.exitCode = 1;
