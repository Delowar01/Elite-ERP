/**
 * Platform Owner PO-02D3 — browser suite for the public invitation-acceptance page /register/accept: the production
 * build (`next build` first) served by `next start` on loopback, driven in Chromium.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *   PO02D3_SCREENSHOT_DIR=<optional output dir> npm run verify:platform-invitation-acceptance-browser
 *
 * Server A: CUSTOMER_INVITE_ACCEPTANCE_ENABLED=true; CUSTOMER_PUBLIC_ORIGIN is server A's own loopback origin (an http
 * origin is accepted only with PLATFORM_INVITATIONS_LOOPBACK_ORIGIN=true — a test-only approval); one trusted proxy
 * hop, and every browser context sends its own fictional X-Forwarded-For. The Platform Owner console flags stay OFF:
 * acceptance is independent of them. Server B: the same with acceptance OFF (the variable unset). One disposable
 * database (dropped at the end): the reviewed schema and the PO-02D1B Trial seed (guarded runner), with fictional
 * invitations written exactly as PO-02D2 writes them (token generator, sha256, terms row). TEST-ONLY secrets are
 * generated in memory and never printed; the tokens are held only to prove they appear nowhere they must not. Chromium
 * is the pre-installed build (PO01B_CHROMIUM, default /opt/pw-browsers/chromium) — nothing is downloaded.
 *
 * Categories B1 … B14 (docs/platform-owner/PO02D3_DEVELOPMENT.md §K): flag off; missing and malformed links; the
 * fragment (removal before any request, refresh, back / forward, a second link, back/forward-cache restore, leaving
 * the page); the offered terms from the invitation's own version; validation; a keyboard-only acceptance through to
 * the existing sign-in; refusal screens; failure and retry; one request per submit; the signed-in visitor; token
 * hygiene (URL, history, storage, cookies, console, requests, Referer, DOM, server output, every table); page
 * protections; EN / AR × light / dark × 1440 / 1024 / 768 / 390 / 360 with layout audits and screenshots; /register.
 */
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Page, Request as PwRequest } from "playwright";
import bcrypt from "bcryptjs";
import { createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { section, ok, summary, describeError } from "./platform/harness";
import { startServer, testSecrets, type Server } from "./platform/browser-env";
import { loadActionIds } from "./action-id.mjs";
import { pickCountry } from "./register-org.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");

const testDbName = disposableName("po02d3_browser");
const secrets = testSecrets();
const PORT_A = Number(process.env.PO02D3_PORT_A || 3457);
const PORT_B = Number(process.env.PO02D3_PORT_B || 3458);
process.env.DATABASE_URL = databaseUrlFor(testDbName);
Object.assign(process.env, secrets);

let created = false;
await createPlatformTestDatabase("po02d3_browser", testDbName);
created = true;
{
  const { runSeed } = await import("../scripts/platform/trial-seed");
  const seeded = await runSeed(process.env.DATABASE_URL);
  if (seeded.check.state !== "complete") throw new Error(`the Trial seed did not complete: ${seeded.check.state}`);
}

const { pool } = await import("../src/db");
const invitations = await import("../src/lib/platform/invitations");
const { formatPlatformDate, formatPlatformDateTime } = await import("../src/lib/platform/display");
const { riyadhBusinessDate } = await import("../src/lib/platform/invitation-acceptance");
pool.on("error", () => undefined);

const SHOTS = process.env.PO02D3_SCREENSHOT_DIR || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PASSWORD = "Harbor-Lattice-73!q";
const PASSWORD_2 = "Cedar-Window-41#z";
const secretsSeen: string[] = [PASSWORD, PASSWORD_2, ...Object.values(secrets)];
const tokensSeen: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const plain = (s: string) => s.replace(/[⁦-⁩]/g, "");
const q = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
const one = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await q<T>(text, values))[0];
const n = async (text: string, values: unknown[] = []) => Number((await one<{ n: number }>(text, values))?.n ?? 0);
const HOUR = 3_600_000;

let ipSeq = 0;
/** A fictional client address (TEST-NET-3) per context, so the durable per-IP throttle only fires where a check means it. */
const nextIp = () => {
  ipSeq += 1;
  return `203.0.113.${(ipSeq % 250) + 1}`;
};

// ---- fictional invitations ------------------------------------------------------------------------------------------
const admin = (
  await one<{ id: string }>(
    `insert into platform_admins (email_normalized, display_name, password_hash, mfa_secret_encrypted, mfa_enrolled_at) values ('operator@acceptance-browser.test', 'Fictional Operator', $1, 'v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB==:CCCCCCCC', now()) returning id`,
    [await bcrypt.hash("Fictional-Passw0rd!x", 4)],
  )
)!.id;
const trialV1 = (await one<{ id: string }>(`select v.id from subscription_package_versions v join subscription_packages p on p.id = v.package_id where p.is_default_trial and v.version_number = 1`))!.id;

type Fixture = { id: string; token: string; email: string; company: string; owner: string; reference: string; expiresAt: Date };
let seq = 0;
async function invitation(opts: { company?: string; owner?: string; email?: string; state?: "pending" | "expired" | "revoked" | "used"; versionId?: string } = {}): Promise<Fixture> {
  seq += 1;
  const { token, tokenHash } = invitations.newInvitationToken();
  tokensSeen.push(token);
  const state = opts.state ?? "pending";
  const email = opts.email ?? `owner${seq}@acceptance-browser.test`;
  const company = opts.company ?? `Fixture Company ${seq}`;
  const owner = opts.owner ?? "Fixture Invitee";
  const createdAt = new Date(Date.now() - (state === "expired" ? 80 * HOUR : HOUR));
  const expiresAt = new Date(createdAt.getTime() + 72 * HOUR);
  const usedOrg = state === "used" ? (await one<{ id: number }>(`insert into orgs (name, country, currency) values ($1, 'Saudi Arabia', 'SAR') returning id`, [company]))!.id : null;
  const row = await one<{ id: string }>(
    `insert into organization_invitations (company_name, industry, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash, expires_at,
       accepted_at, accepted_org_id, revoked_at, revoked_by_platform_admin_id, invited_by_platform_admin_id, created_at, updated_at)
     values ($1, 'Exhibitions', $2, 'Saudi Arabia', 'SAR', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) returning id`,
    [
      company,
      `office${seq}@acceptance-browser.test`,
      owner,
      email,
      tokenHash,
      expiresAt,
      usedOrg ? new Date(createdAt.getTime() + 60_000) : null,
      usedOrg,
      state === "revoked" ? new Date(createdAt.getTime() + 60_000) : null,
      state === "revoked" ? admin : null,
      admin,
      createdAt,
    ],
  );
  await q(`insert into organization_invitation_terms (invitation_id, initial_package_version_id, initial_is_trial, initial_cycle) values ($1, $2, true, 'trial')`, [row!.id, opts.versionId ?? trialV1]);
  return { id: row!.id, token, email, company, owner, reference: `INV-${row!.id.slice(0, 8).toUpperCase()}`, expiresAt };
}
const invRow = (id: string) => one<{ accepted_at: Date | null; accepted_org_id: number | null; revoked_at: Date | null }>(`select accepted_at, accepted_org_id, revoked_at from organization_invitations where id = $1`, [id]);
const lastStage = async (id: string) =>
  ((await one<{ s: string | null }>(`select after_safe->>'stage' as s from platform_audit_events where entity_type = 'organization_invitation' and entity_id = $1 order by id desc limit 1`, [id]))?.s ?? null);
const COUNTED_TABLES = ["orgs", "users", "sessions", "accounts", "tenant_access_controls", "tenant_primary_owners", "tenant_subscriptions", "subscription_events", "audit_logs", "security_events"] as const;
async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of COUNTED_TABLES) out[t] = await n(`select count(*)::int as n from ${t}`);
  out.accepted = await n(`select count(*)::int as n from organization_invitations where accepted_at is not null`);
  return out;
}
const same = (a: Record<string, number>, b: Record<string, number>) => JSON.stringify(a) === JSON.stringify(b);
const diff = (a: Record<string, number>, b: Record<string, number>) => Object.keys(b).filter((k) => a[k] !== b[k]).map((k) => `${k} ${a[k]}→${b[k]}`).join(", ") || "none";

// ---- browser plumbing: every request, console line and page error is recorded -------------------------------------
let browser!: Browser;
let A!: Server;
let B!: Server;
const contexts: BrowserContext[] = [];
type Prefs = { locale: "en" | "ar"; theme: "light" | "dark" };
type Seen = { id: number; url: string; method: string; headers: Record<string, string>; body: string; navigation: boolean; from: string };
const requests: Seen[] = [];
let reqSeq = 0;
// Requests that never left the browser (sent while offline): Chromium adds Origin and Referer only when it sends a
// request, so such a request shows only provisional headers. They are kept apart and checked on their own. (A request
// whose streamed answer is cut short by the next navigation fails as net::ERR_ABORTED — it was sent and answered.)
const idOf = new WeakMap<PwRequest, number>();
const unsentIds = new Set<number>();
const pendingRecords: Promise<void>[] = [];
const consoleLines: string[] = [];
const pageErrors: string[] = [];

// Runs before any page script: records WHEN the page rewrote its history entry and when it first called fetch, as
// booleans and times only (it never stores the URL or the fragment), so the order can be proven.
const ORDER_PROBE = `(() => {
  const rec = { replaced: [], fetches: [] };
  Object.defineProperty(window, "__po02d3", { value: rec });
  for (const m of ["replaceState", "pushState"]) {
    const orig = history[m].bind(history);
    history[m] = function (s, t, u) { const before = location.hash.length > 0; const r = orig(s, t, u); rec.replaced.push({ m, at: performance.now(), before, after: location.hash.length > 0 }); return r; };
  }
  const f = window.fetch.bind(window);
  window.fetch = function (...args) { rec.fetches.push({ at: performance.now(), fragment: location.hash.length > 0 }); return f(...args); };
})();`;

async function newContext(server: Server, prefs: Prefs = { locale: "en", theme: "light" }, ip = nextIp(), viewport = { width: 1440, height: 900 }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ baseURL: server.url, viewport, deviceScaleFactor: 1, reducedMotion: "reduce", extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.addInitScript(ORDER_PROBE);
  await setPrefs(ctx, server, prefs);
  ctx.on("page", (p) => watch(p));
  contexts.push(ctx);
  return ctx;
}
async function setPrefs(ctx: BrowserContext, server: Server, prefs: Prefs) {
  await ctx.addCookies([
    { name: "locale", value: prefs.locale, url: server.url },
    { name: "theme", value: prefs.theme, url: server.url },
  ]);
}
function watch(page: Page) {
  page.on("console", (m) => consoleLines.push(m.text()));
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("request", (r: PwRequest) => {
    // The sequence number is taken synchronously, in the order the browser issued the requests; the headers follow.
    const id = ++reqSeq;
    idOf.set(r, id);
    const from = page.url();
    pendingRecords.push(
      (async () => {
        const headers = await r.allHeaders().catch(() => ({}) as Record<string, string>);
        requests.push({ id, url: r.url(), method: r.method(), headers, body: r.postData() ?? "", navigation: r.isNavigationRequest(), from });
      })(),
    );
  });
  page.on("requestfailed", (r: PwRequest) => {
    const id = idOf.get(r);
    if (id && /INTERNET_DISCONNECTED/.test(r.failure()?.errorText ?? "")) unsentIds.add(id);
  });
}
const pathOf = (u: string | undefined) => {
  try {
    return new URL(u ?? "").pathname;
  } catch {
    return "<not a URL>";
  }
};
/** Requests issued after a mark (a sequence number), once every pending record has its headers. */
const after = (mark: number) => requests.filter((r) => r.id > mark);
const actionPosts = (mark: number) => after(mark).filter((r) => r.method === "POST" && "next-action" in r.headers);
const markNow = () => reqSeq;
const settleRecords = async () => {
  await Promise.all(pendingRecords.splice(0));
};

/** Open a link as a new document load (from about:blank, so a fragment-only change can never be a same-page step). */
async function open(page: Page, path: string) {
  await page.goto("about:blank");
  return page.goto(path);
}
const h1 = (page: Page) => page.locator("h1").first();
async function heading(page: Page, text: string, timeout = 20_000) {
  await page.locator("h1", { hasText: text }).first().waitFor({ state: "visible", timeout });
}
async function untilView(page: Page, texts: string[], timeout = 20_000): Promise<string> {
  const t0 = Date.now();
  for (;;) {
    const t = (await h1(page).innerText().catch(() => "")).trim();
    if (texts.includes(t)) return t;
    if (Date.now() - t0 > timeout) return t;
    await sleep(50);
  }
}
const FORM_H1 = "Accept your invitation";
async function openForm(page: Page, f: Fixture) {
  await open(page, `/register/accept#t=${f.token}`);
  await page.locator("#ownerName").waitFor({ state: "visible", timeout: 20_000 });
}
async function fillAndSubmit(page: Page, password: string, name?: string) {
  if (name !== undefined) await page.locator("#ownerName").fill(name);
  await page.locator("#password").fill(password);
  await page.locator("#confirm").fill(password);
  await page.locator("form button[type=submit]").click();
}
const tokenInDom = (page: Page, token: string) =>
  page.evaluate((t) => document.documentElement.outerHTML.includes(t) || [...document.querySelectorAll("input")].some((i) => (i as HTMLInputElement).value.includes(t)), token);
type HistoryWrite = { m: string; at: number; before: boolean; after: boolean };
const order = (page: Page) => page.evaluate(() => (window as unknown as { __po02d3: { replaced: HistoryWrite[]; fetches: { at: number; fragment: boolean }[] } }).__po02d3);

/** Browser-side stores: Web Storage, IndexedDB, the Cache API and the history entry. */
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
type AuditResult = { h1: number; lang: string; dir: string; theme: string | null; overflow: number; unnamed: string[]; unlabelled: string[]; orangeOffenders: string[]; storage: number; clipped: string[]; ltr: number };
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
  return { h1: document.querySelectorAll("h1").length, lang: document.documentElement.lang, dir: document.documentElement.dir, theme: document.documentElement.dataset.theme || null, overflow: document.documentElement.scrollWidth - window.innerWidth, unnamed, unlabelled, orangeOffenders: offenders, storage: localStorage.length + sessionStorage.length, clipped, ltr: document.querySelectorAll("main [dir=ltr]").length };
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
async function postAction(server: Server, name: string, input: unknown, origin: string | null = server.url, base = server.url): Promise<{ status: number; text: string }> {
  const id = actionIdOf(name);
  if (!id) throw new Error(`server action ${name} is not in the build manifest`);
  const headers: Record<string, string> = { "next-action": id, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", "x-forwarded-for": nextIp() };
  if (origin !== null) headers.origin = origin;
  const res = await fetch(`${base}/register/accept`, { method: "POST", headers, body: JSON.stringify([input]), redirect: "manual" });
  return { status: res.status, text: await res.text() };
}

async function failingTrigger(table: string, on: boolean) {
  if (on) {
    await q(`create or replace function po02d3_test_only_fail() returns trigger language plpgsql as $$ begin raise exception 'injected failure (test only)'; end $$`);
    await q(`create trigger po02d3_test_only_fail before insert on ${table} for each row execute function po02d3_test_only_fail()`);
  } else {
    await q(`drop trigger if exists po02d3_test_only_fail on ${table}`);
    await q(`drop function if exists po02d3_test_only_fail()`);
  }
}
const SEEDED = ["accounts", "document_sequences", "tax_presets", "payment_term_presets", "units", "bank_accounts", "departments", "product_categories", "leave_types", "expense_categories"];
async function seededCounts(orgId: number): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of SEEDED) out[t] = await n(`select count(*)::int as n from ${t} where org_id = $1`, [orgId]);
  return out;
}

async function main() {
  browser = await chromium.launch({ executablePath: process.env.PO01B_CHROMIUM || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const common = { ...secrets, DATABASE_URL: process.env.DATABASE_URL, PLATFORM_TRUSTED_PROXY_HOPS: "1", PLATFORM_CONSOLE_ENABLED: undefined, PLATFORM_INVITATIONS_ENABLED: undefined, PLATFORM_INVITATIONS_LOOPBACK_ORIGIN: "true" };
  A = await startServer(PORT_A, { ...common, CUSTOMER_INVITE_ACCEPTANCE_ENABLED: "true", CUSTOMER_PUBLIC_ORIGIN: `http://localhost:${PORT_A}` });
  B = await startServer(PORT_B, { ...common, CUSTOMER_INVITE_ACCEPTANCE_ENABLED: undefined, CUSTOMER_PUBLIC_ORIGIN: `http://localhost:${PORT_B}` });
  const foreignHosts = () => [...new Set(requests.map((r) => new URL(r.url).hostname).filter((h) => h !== "localhost" && h !== "127.0.0.1" && h !== ""))];

  // ==============================================================================================================
  section("B1. Acceptance OFF (CUSTOMER_INVITE_ACCEPTANCE_ENABLED unset): no form, no invitation data, no request; the actions refuse");
  {
    const f = await invitation({ company: "Nakheel Fixture Trading", owner: "Nora Fixture" });
    const ctx = await newContext(B);
    const page = await ctx.newPage();
    const mark = markNow();
    await open(page, `/register/accept#t=${f.token}`);
    await heading(page, "Invitation acceptance isn't available");
    await settleRecords();
    ok("B1 the page says acceptance isn't available (one h1) and names no company", (await page.locator("h1").count()) === 1 && !(await page.content()).includes("Nakheel"));
    ok("B1 …the fragment is removed from the address bar all the same", !page.url().includes("#"), page.url().replace(/#.*/, "#…"));
    ok("B1 …and the page calls no server action (no POST at all)", actionPosts(mark).length === 0 && after(mark).every((r) => r.method !== "POST"));
    const before = await counts();
    const c1 = await postAction(B, "checkInvitationLinkAction", { token: f.token });
    const c2 = await postAction(B, "acceptInvitationAction", { token: f.token, ownerName: "Nora Fixture", password: PASSWORD, confirm: PASSWORD });
    ok("B1 a direct same-origin POST of either action (the build's own ids) is refused 'disabled' — no invitation data in the answer", c1.text.includes('"reason":"disabled"') && c2.text.includes('"reason":"disabled"') && !c1.text.includes("Nakheel") && !c2.text.includes("Nakheel"), `${c1.status}/${c2.status}`);
    ok("B1 …nothing is created and the invitation stays pending", same(before, await counts()) && (await invRow(f.id))?.accepted_at === null, diff(before, await counts()));
    await shot(page, "00-disabled-en-light-1440");
    await ctx.close();
  }

  // ==============================================================================================================
  section("B2. Missing, malformed and unknown links");
  {
    const ctx = await newContext(A);
    const page = await ctx.newPage();
    let mark = markNow();
    await open(page, "/register/accept");
    await heading(page, "No invitation found in this link");
    await settleRecords();
    ok("B2 no fragment → 'No invitation found in this link', and no server action is called", actionPosts(mark).length === 0);
    await shot(page, "01-missing-en-light-1440");
    mark = markNow();
    await open(page, "/register/accept#t=not*a+valid/token");
    await heading(page, "No invitation found in this link");
    await settleRecords();
    ok("B2 a fragment that is not a link token → the same screen, no request, and the fragment is removed", actionPosts(mark).length === 0 && !page.url().includes("#"));
    mark = markNow();
    const decoy = randomBytes(32).toString("base64url");
    await open(page, `/register/accept?t=${decoy}`);
    await heading(page, "No invitation found in this link");
    await settleRecords();
    ok("B2 a token in the QUERY string is never read (only the fragment is) → 'No invitation found', no request", actionPosts(mark).length === 0);
    const attempts0 = await n(`select count(*)::int as n from platform_login_attempts`);
    const audits0 = await n(`select count(*)::int as n from platform_audit_events`);
    mark = markNow();
    const unknown = randomBytes(32).toString("base64url");
    tokensSeen.push(unknown);
    await open(page, `/register/accept#t=${unknown}`);
    await heading(page, "This invitation link can't be used");
    await settleRecords();
    ok("B2 a well-formed but unknown token → 'This invitation link can't be used' after exactly one same-origin POST, with no Try again", actionPosts(mark).length === 1 && (await page.getByRole("button", { name: "Try again" }).count()) === 0);
    ok("B2 …it counts against the client IP only (one keyed-digest row, no e-mail key) and leaves no audit record (nothing to attach it to)",
      (await n(`select count(*)::int as n from platform_login_attempts`)) === attempts0 + 1 && (await n(`select count(*)::int as n from platform_login_attempts where email_hash is null and ip_hash is not null`)) >= 1 && (await n(`select count(*)::int as n from platform_audit_events`)) === audits0);
    await shot(page, "02-invalid-en-light-1440");
    await ctx.close();
  }

  // ==============================================================================================================
  section("B3. The fragment: removed before any request; refresh, back / forward, a second link, a cached restore, leaving the page");
  {
    const f = await invitation({ company: "Sahil Fixture Logistics", owner: "Salma Fixture" });
    const ctx = await newContext(A);
    const page = await ctx.newPage();
    await openForm(page, f);
    const o = await order(page);
    const removal = o.replaced.findIndex((w) => w.before && !w.after);
    ok("B3 the fragment was removed from the history entry by one write, and NO later history write (the page's or Next.js's router's) put it back",
      removal >= 0 && o.replaced.slice(removal).every((w) => !w.after), JSON.stringify(o.replaced.map((w) => `${w.m}:${w.before ? 1 : 0}${w.after ? 1 : 0}`)));
    ok("B3 …and it was removed BEFORE the first request: no fetch ever ran with the fragment in the address", o.fetches.length >= 1 && o.fetches.every((x) => !x.fragment) && removal >= 0 && o.fetches[0].at >= o.replaced[removal].at, JSON.stringify(o.fetches.slice(0, 3)));
    // Next.js's router keeps its own copy of the address (its canonical URL, read from location.href at start-up) and
    // writes it back to history whenever its state changes; a refresh forces such a write. It must not hold the link.
    await page.evaluate(() => (window as unknown as { next: { router: { refresh(): void } } }).next.router.refresh());
    await sleep(1_500);
    const o2 = await order(page);
    ok("B3 after a router state change (router.refresh) the address still has no fragment: the router itself never held the link",
      !page.url().includes("#") && o2.replaced.slice(removal).every((w) => !w.after) && (await page.locator("#ownerName").isVisible()), JSON.stringify(o2.replaced.map((w) => `${w.m}:${w.before ? 1 : 0}${w.after ? 1 : 0}`)));
    ok("B3 the token is nowhere in the document (no text, attribute or field holds it)", !(await tokenInDom(page, f.token)));
    const st = await stores(page);
    ok("B3 the address and the history entry hold no fragment and no token", !st.url.includes("#") && !st.url.includes(f.token) && !st.historyState.includes(f.token), st.url.replace(/#.*/, "#…"));
    ok("B3 nothing in Web Storage, IndexedDB or the Cache API, and no cookie holds the token", st.web === 0 && st.idb === 0 && st.caches === 0 && !(await ctx.cookies()).some((c) => c.value.includes(f.token)), JSON.stringify({ web: st.web, idb: st.idb, caches: st.caches }));
    let mark = markNow();
    await page.reload();
    await heading(page, "No invitation found in this link");
    await settleRecords();
    ok("B3 a refresh cannot bring the link back: 'No invitation found', no request", actionPosts(mark).length === 0 && !page.url().includes("#"));
    await openForm(page, f);
    await page.goto("/login");
    await heading(page, "Welcome back");
    mark = markNow();
    await page.goBack();
    await heading(page, "No invitation found in this link");
    await settleRecords();
    ok("B3 navigating away and pressing Back: the entry holds no fragment → 'No invitation found' (no form, no request)", actionPosts(mark).length === 0 && !page.url().includes("#") && (await page.locator("#ownerName").count()) === 0);
    await page.goForward();
    await heading(page, "Welcome back");
    ok("B3 …and Forward returns to the sign-in page", page.url().endsWith("/login"));
    // A second link pasted into the open tab changes only the fragment: the page reloads and handles it like the first.
    await open(page, "/register/accept");
    await heading(page, "No invitation found in this link");
    await page.evaluate((t) => {
      window.location.hash = `t=${t}`;
    }, f.token);
    await page.locator("#ownerName").waitFor({ state: "visible", timeout: 20_000 });
    ok("B3 a second link opened in the same tab (a fragment-only step) reloads and shows its invitation; its fragment is removed too", !page.url().includes("#") && (await page.locator("h2", { hasText: "Sahil Fixture Logistics" }).count()) === 1);
    // A restore from the back/forward cache (simulated: the page receives pageshow with persisted = true) reloads.
    await openForm(page, f);
    await Promise.all([page.waitForEvent("load"), page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }))).catch(() => undefined)]);
    await heading(page, "No invitation found in this link");
    ok("B3 a page restored from the back/forward cache reloads → 'No invitation found' (no live form, no link in memory)", (await page.locator("#ownerName").count()) === 0);
    // Leaving the page (pagehide) drops the link from memory: the form left behind can no longer accept.
    await openForm(page, f);
    const before = await counts();
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
    await fillAndSubmit(page, PASSWORD);
    await heading(page, "This invitation link can't be used");
    ok("B3 after pagehide the link is gone from memory: a submit is refused as an invalid link and nothing is created", same(before, await counts()) && (await invRow(f.id))?.accepted_at === null);
    await ctx.close();
  }

  // ==============================================================================================================
  section("B4. What the invitee reviews: the invitation's details and the Trial terms of ITS version");
  const pending = await invitation({ company: "Rawabi Fixture Events", owner: "Rami Fixture", email: "rami.owner@acceptance-browser.test" });
  {
    // A newer Trial version (30 days, 7 users) is published AFTER the invitation was written: the page must still show v1.
    await q(
      `insert into subscription_package_versions (package_id, version_number, publish_state, is_trial, monthly_price, annual_price, included_seats, storage_allowance_gb, module_groups, trial_days, published_at)
       select package_id, 2, 'published', true, 0, 0, 7, 9, '["Dashboard","Sales"]'::jsonb, 30, now() from subscription_package_versions where id = $1`,
      [trialV1],
    );
    const ctx = await newContext(A);
    const page = await ctx.newPage();
    await openForm(page, pending);
    const text = plain(await page.locator("main").innerText());
    ok("B4 the company and its details from the invitation: name, country, base currency, owner e-mail, reference, expiry (Riyadh time)",
      text.includes("Rawabi Fixture Events") && /Country\s*Saudi Arabia/.test(text) && /Base currency\s*SAR/.test(text) && text.includes("rami.owner@acceptance-browser.test") && text.includes(pending.reference) && text.includes(formatPlatformDateTime(pending.expiresAt, "en")), text.slice(0, 500));
    ok("B4 the offered Trial from the invitation's OWN version (v1), not the newer v2: 14 days, 3 users, 5 GB, all 9 module groups, SAR 0.00, free",
      /Version 1/.test(text) && /Length\s*14 days/.test(text) && /Users included\s*3/.test(text) && /Storage\s*5 GB/.test(text) && text.includes("All 9 module groups") && text.includes("SAR 0.00") && text.includes("Free — no payment required") && !text.includes("30 days") && !/Users included\s*7/.test(text), text.slice(text.indexOf("Your free Trial"), text.indexOf("Your free Trial") + 400));
    ok("B4 the allowances are described as information only, and there is no payment field (three inputs: name, password, confirmation)",
      text.includes("nothing is restricted during the Trial") && (await page.locator("main input").count()) === 3 && !/card|payment details|billing address/i.test(text.replace("no payment required", "")));
    ok("B4 the name field starts with the invitation's owner name (to confirm or correct)", (await page.locator("#ownerName").inputValue()) === "Rami Fixture");
    const a = await audit(page);
    ok("B4 layout audit (EN, light, 1440)", auditOk(a) && a.lang === "en" && a.dir === "ltr", auditText(a));
    await shot(page, "10-form-en-light-1440");
    await ctx.close();
  }

  // ==============================================================================================================
  section("B5. Validation: in the browser without a request, and the server's own policy");
  {
    const ctx = await newContext(A);
    const page = await ctx.newPage();
    await openForm(page, pending);
    await settleRecords();
    let mark = markNow();
    await page.locator("#ownerName").fill("   ");
    await page.locator("form button[type=submit]").click();
    await sleep(300);
    await settleRecords();
    const t1 = await page.locator("form").innerText();
    ok("B5 an empty name and password: each field's error is shown and NO request is sent", t1.includes("Enter your name (up to 200 characters).") && t1.includes("Enter a password.") && actionPosts(mark).length === 0);
    ok("B5 …each invalid field is aria-invalid and points at its error (role=alert)",
      (await page.locator("#password").getAttribute("aria-invalid")) === "true" && (await page.locator("#password").getAttribute("aria-describedby")) === "password-error" && (await page.locator("#password-error").getAttribute("role")) === "alert");
    await shot(page, "11-validation-en-light-1440");
    await page.locator("#ownerName").fill("Rami Fixture");
    for (const [pw, msg] of [["short1!", "Must be at least 8 characters."], ["lowercase-only-1!", "Must include an uppercase letter."], ["NoDigits-Here!", "Must include a number."], ["NoSymbols123", "Must include a special character."]] as const) {
      await page.locator("#password").fill(pw);
      await page.locator("#confirm").fill(pw);
      await page.locator("form button[type=submit]").click();
      await page.locator("#password-error", { hasText: msg }).waitFor({ timeout: 5_000 });
    }
    await settleRecords();
    ok("B5 the /register policy, mirrored: length, upper case, digit and symbol rules shown in the browser, still no request", actionPosts(mark).length === 0);
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#confirm").fill(PASSWORD_2);
    await page.locator("form button[type=submit]").click();
    await page.locator("#confirm-error", { hasText: "The passwords do not match." }).waitFor({ timeout: 5_000 });
    await settleRecords();
    ok("B5 a confirmation that differs → 'The passwords do not match.' on the confirmation field, no request", actionPosts(mark).length === 0);
    // A password the browser mirror accepts but the server's common-password check refuses: the server's word counts.
    mark = markNow();
    const before = await counts();
    await page.locator("#password").fill("Welcome2026!");
    await page.locator("#confirm").fill("Welcome2026!");
    await page.locator("form button[type=submit]").click();
    await page.locator("#password-error", { hasText: "This password is too common." }).waitFor({ timeout: 20_000 });
    await settleRecords();
    ok("B5 the SERVER enforces the policy too: a common password is refused on its field after one request; nothing is created; the form stays usable",
      actionPosts(mark).length === 1 && same(before, await counts()) && (await page.locator("#ownerName").isVisible()) && (await invRow(pending.id))?.accepted_at === null, diff(before, await counts()));
    await ctx.close();
  }

  // ==============================================================================================================
  section("B6. A keyboard-only acceptance, then the existing sign-in");
  let signedIn!: { ctx: BrowserContext; page: Page; orgId: number; userId: number; email: string };
  {
    const ctx = await newContext(A);
    const page = await ctx.newPage();
    const before = await counts();
    const mark = markNow();
    await openForm(page, pending);
    ok("B6 when the form appears, focus is on its heading", await page.evaluate(() => document.activeElement?.tagName === "H1" && (document.activeElement?.textContent ?? "").trim() === "Accept your invitation"));
    const order1: string[] = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      order1.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute("type") || document.activeElement?.tagName || ""));
    }
    ok("B6 Tab order from the heading: name → password → confirmation → submit", JSON.stringify(order1) === JSON.stringify(["ownerName", "password", "confirm", "submit"]), JSON.stringify(order1));
    await page.locator("#ownerName").focus();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Rami Al-Fixture");
    await page.keyboard.press("Tab");
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press("Tab");
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press("Enter");
    await heading(page, "Your company is ready", 30_000);
    await settleRecords();
    ok("B6 Enter submits; 'Your company is ready' — focus moves to that heading", await page.evaluate(() => document.activeElement?.tagName === "H1" && (document.activeElement?.textContent ?? "").includes("Your company is ready")));
    const org = await one<{ id: number; name: string; country: string; currency: string; confirmed: boolean; industry: string | null; email: string | null }>(
      `select id, name, country, currency, base_currency_confirmed_at is not null as confirmed, industry, email from orgs where id = (select accepted_org_id from organization_invitations where id = $1)`, [pending.id]);
    const user = await one<{ id: number; email: string; name: string; role: string; password_hash: string; mfa_enabled: boolean }>(`select id, email, name, role, password_hash, mfa_enabled from users where org_id = $1`, [org?.id]);
    const sub = await one<{ v: string; start: string; end: string; seats: number; storage: number; mods: string[]; price: string; cycle: string; trial: boolean }>(
      `select package_version_id as v, start_date::text as start, end_date::text as end, seats_snapshot as seats, storage_snapshot_gb as storage, module_groups_snapshot as mods, price_snapshot_sar::text as price, cycle, is_trial as trial from tenant_subscriptions where org_id = $1`, [org?.id]);
    const acceptedAt = (await invRow(pending.id))?.accepted_at;
    ok("B6 the organization from the invitation (name, country, base currency confirmed, industry, company e-mail) and its owner (confirmed name, e-mail, role owner)",
      !!org && org.name === "Rawabi Fixture Events" && org.country === "Saudi Arabia" && org.currency === "SAR" && org.confirmed && org.industry === "Exhibitions" && !!org.email && user?.email === "rami.owner@acceptance-browser.test" && user?.name === "Rami Al-Fixture" && user?.role === "owner");
    ok("B6 the owner's password is the one typed (bcrypt), never stored in clear", !!user && (await bcrypt.compare(PASSWORD, user.password_hash)) && !user.password_hash.includes(PASSWORD));
    const expectedStart = acceptedAt ? riyadhBusinessDate(acceptedAt) : "";
    const endDate = new Date(`${expectedStart}T00:00:00Z`);
    endDate.setUTCDate(endDate.getUTCDate() + 13);
    ok("B6 exactly one Trial: v1's snapshots (3 users, 5 GB, 9 module groups, SAR 0.00, cycle trial), starting on the Riyadh business day of acceptance, inclusive end = start + 13",
      !!sub && sub.v === trialV1 && sub.seats === 3 && sub.storage === 5 && sub.mods.length === 9 && Number(sub.price) === 0 && sub.cycle === "trial" && sub.trial && sub.start === expectedStart && sub.end === endDate.toISOString().slice(0, 10) && (await n(`select count(*)::int as n from tenant_subscriptions where org_id = $1`, [org?.id])) === 1, JSON.stringify(sub));
    const afterCounts = await counts();
    ok("B6 one of each: organization, owner, access row (active), primary owner, subscription, event, accepted invitation, customer audit and security event — and NO session",
      afterCounts.orgs === before.orgs + 1 && afterCounts.users === before.users + 1 && afterCounts.tenant_access_controls === before.tenant_access_controls + 1 && afterCounts.tenant_primary_owners === before.tenant_primary_owners + 1 &&
        afterCounts.tenant_subscriptions === before.tenant_subscriptions + 1 && afterCounts.subscription_events === before.subscription_events + 1 && afterCounts.accepted === before.accepted + 1 &&
        afterCounts.audit_logs === before.audit_logs + 1 && afterCounts.security_events === before.security_events + 1 && afterCounts.sessions === before.sessions && (await n(`select count(*)::int as n from tenant_access_controls where org_id = $1 and access_status = 'active'`, [org?.id])) === 1,
      diff(before, afterCounts));
    ok("B6 …and no session cookie was set by the acceptance (the visitor is not signed in)", !(await ctx.cookies()).some((c) => /session/i.test(c.name)));
    const doneText = plain(await page.locator("main").innerText());
    const day = (iso: string, l: "en" | "ar") => formatPlatformDate(new Date(`${iso}T12:00:00+03:00`), l);
    ok("B6 the done screen names the sign-in e-mail (its own left-to-right line) and the Trial's dates (Riyadh business days)",
      doneText.includes("Sign in with this e-mail and the password you just chose:") && (await page.locator("main bdi[dir=ltr]", { hasText: "rami.owner@acceptance-browser.test" }).count()) === 1 && !!sub && doneText.includes(`Your free Trial runs from ${day(sub.start, "en")} to ${day(sub.end, "en")}.`), doneText.slice(0, 300));
    ok("B6 exactly two same-origin POSTs to /register/accept carried the token (check, accept) — no other request did", (() => {
      const posts = actionPosts(mark);
      const carrying = after(mark).filter((r) => r.body.includes(pending.token) || r.url.includes(pending.token));
      return posts.length === 2 && carrying.length === 2 && carrying.every((r) => r.method === "POST" && r.url === `${A.url}/register/accept` && "next-action" in r.headers);
    })());
    const a = await audit(page);
    ok("B6 layout audit of the done screen (EN, light, 1440)", auditOk(a), auditText(a));
    await shot(page, "12-done-en-light-1440");
    await page.getByRole("link", { name: "Sign in" }).click();
    await heading(page, "Welcome back");
    await page.getByLabel("Email", { exact: true }).fill("rami.owner@acceptance-browser.test");
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard", { timeout: 30_000 });
    ok("B6 the existing /login signs the new owner in → /dashboard (no MFA enrolment demanded at creation, exactly as after /register)", page.url().endsWith("/dashboard") && user?.mfa_enabled === false);
    ok("B6 …the session exists only now, after sign-in", (await n(`select count(*)::int as n from sessions where user_id = $1`, [user?.id])) === 1);
    signedIn = { ctx, page, orgId: org!.id, userId: user!.id, email: user!.email };
  }

  // ==============================================================================================================
  section("B7. Refusal screens: expired, revoked, already used, a neutral 'unavailable', too many attempts");
  {
    const ctx = await newContext(A);
    const page = await ctx.newPage();
    const expired = await invitation({ state: "expired" });
    await open(page, `/register/accept#t=${expired.token}`);
    await heading(page, "This invitation has expired");
    ok("B7 expired → 'This invitation has expired' (72 hours, ask for a new one), no form, no Try again; audited stage expired",
      (await page.locator("main").innerText()).includes("Invitations are valid for 72 hours.") && (await page.locator("#ownerName").count()) === 0 && (await page.getByRole("button", { name: "Try again" }).count()) === 0 && (await lastStage(expired.id)) === "expired");
    await shot(page, "20-expired-en-light-1440");
    const revoked = await invitation({ state: "revoked" });
    await open(page, `/register/accept#t=${revoked.token}`);
    await heading(page, "This invitation link can't be used");
    ok("B7 revoked → the same neutral 'can't be used' screen as an unknown link (no hint that it existed); audited stage revoked", (await lastStage(revoked.id)) === "revoked" && (await page.locator("#ownerName").count()) === 0);
    await open(page, `/register/accept#t=${pending.token}`);
    await heading(page, "This invitation has already been used");
    ok("B7 the accepted link (B6) → 'already been used' with a Sign in link to /login; audited stage used", (await page.getByRole("link", { name: "Sign in" }).getAttribute("href")) === "/login" && (await lastStage(pending.id)) === "used");
    await shot(page, "21-used-en-light-1440");
    // An e-mail a customer account already holds (another letter case): the form is shown, the acceptance is refused in neutral terms.
    const [holder] = await q<{ id: number }>("insert into orgs (name, country, currency) values ('Existing Fixture Holding', 'Saudi Arabia', 'SAR') returning id");
    await q("insert into users (org_id, email, password_hash, name, role) values ($1, 'Existing.Owner@Acceptance-Browser.test', '$2a$10$abcdefghijklmnopqrstuuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZa', 'Existing Owner', 'owner')", [holder.id]);
    const conflict = await invitation({ email: "existing.owner@acceptance-browser.test" });
    const before = await counts();
    await openForm(page, conflict);
    await fillAndSubmit(page, PASSWORD);
    await heading(page, "We couldn't complete this invitation");
    const t = await page.locator("main").innerText();
    ok("B7 an owner e-mail that already has an account → 'We couldn't complete this invitation — Nothing was created', with Try again; the page never says an account exists",
      t.includes("Nothing was created.") && (await page.getByRole("button", { name: "Try again" }).count()) === 1 && !/already (has|exists)|account (exists|already)|in use/i.test(t) && !t.includes("existing.owner"));
    ok("B7 …nothing is created; the invitation stays pending; audited stage email_conflict", same(before, await counts()) && (await invRow(conflict.id))?.accepted_at === null && (await lastStage(conflict.id)) === "email_conflict", diff(before, await counts()));
    await shot(page, "22-unavailable-en-light-1440");
    // Too many attempts: ten failed links from one client address block it for 15 minutes (durable, in PostgreSQL).
    const tctx = await newContext(A, { locale: "en", theme: "light" }, "198.51.100.77");
    const tpage = await tctx.newPage();
    const screens: string[] = [];
    for (let i = 0; i < 11; i++) {
      const bad = randomBytes(32).toString("base64url");
      tokensSeen.push(bad);
      await open(tpage, `/register/accept#t=${bad}`);
      screens.push(await untilView(tpage, ["This invitation link can't be used", "Too many attempts"]));
    }
    ok("B7 ten unknown links from one address are 'can't be used'; the eleventh is 'Too many attempts' (15-minute block)", screens.slice(0, 10).every((s) => s === "This invitation link can't be used") && screens[10] === "Too many attempts", JSON.stringify(screens.slice(8)));
    const rows0 = await n(`select count(*)::int as n from platform_login_attempts`);
    await open(tpage, `/register/accept#t=${pending.token}`);
    const blockedValid = await untilView(tpage, ["Too many attempts", "This invitation has already been used"]);
    ok("B7 …while blocked even a real link from that address is refused before any lookup, and nothing is written", blockedValid === "Too many attempts" && (await n(`select count(*)::int as n from platform_login_attempts`)) === rows0);
    ok("B7 …the throttled screen offers Try again (the link is kept in memory for when the block ends)", (await tpage.getByRole("button", { name: "Try again" }).count()) === 1);
    await shot(tpage, "23-throttled-en-light-1440");
    await tctx.close();
    await ctx.close();
  }

  // ==============================================================================================================
  section("B8. A failure leaves nothing behind; Try again keeps the link; a lost connection is handled");
  {
    const f = await invitation({ company: "Qimma Fixture Retail", owner: "Qasim Fixture" });
    const ctx = await newContext(A);
    const page = await ctx.newPage();
    await openForm(page, f);
    await failingTrigger("tenant_subscriptions", true);
    const before = await counts();
    await fillAndSubmit(page, PASSWORD);
    await heading(page, "We couldn't complete this invitation");
    await failingTrigger("tenant_subscriptions", false);
    ok("B8 a database failure inside the transaction (at the subscription) → 'We couldn't complete this invitation — Nothing was created'", (await page.locator("main").innerText()).includes("Nothing was created."));
    ok("B8 …and truly nothing was: no company, owner, defaults, access row, subscription, event, success audit; the invitation is still pending (audited stage subscription)",
      same(before, await counts()) && (await invRow(f.id))?.accepted_at === null && (await n(`select count(*)::int as n from orgs where name = 'Qimma Fixture Retail'`)) === 0 && (await lastStage(f.id)) === "subscription", diff(before, await counts()));
    await page.getByRole("button", { name: "Try again" }).click();
    await page.locator("#ownerName").waitFor({ state: "visible", timeout: 20_000 });
    ok("B8 Try again re-checks the SAME link (kept in memory, not in the URL) and shows the form again, password fields empty", !page.url().includes("#") && (await page.locator("#password").inputValue()) === "" && (await page.locator("h2", { hasText: "Qimma Fixture Retail" }).count()) === 1);
    await fillAndSubmit(page, PASSWORD);
    await heading(page, "Your company is ready", 30_000);
    ok("B8 …and the retried acceptance succeeds once (one organization)", (await n(`select count(*)::int as n from orgs where name = 'Qimma Fixture Retail'`)) === 1);
    const g = await invitation({ company: "Waha Fixture Services" });
    await openForm(page, g);
    await ctx.setOffline(true);
    await fillAndSubmit(page, PASSWORD);
    await heading(page, "We couldn't complete this invitation");
    await ctx.setOffline(false);
    ok("B8 a lost connection while submitting → the same neutral screen with Try again; nothing was created", (await page.getByRole("button", { name: "Try again" }).count()) === 1 && (await invRow(g.id))?.accepted_at === null);
    await page.getByRole("button", { name: "Try again" }).click();
    await page.locator("#ownerName").waitFor({ state: "visible", timeout: 20_000 });
    ok("B8 …once back online, Try again returns to the form", (await page.locator("h2", { hasText: "Waha Fixture Services" }).count()) === 1);
    await ctx.close();
  }

  // ==============================================================================================================
  section("B9. One request per acceptance, even for two submits in the same instant");
  {
    const f = await invitation({ company: "Lulu Fixture Exhibitions" });
    const ctx = await newContext(A);
    const page = await ctx.newPage();
    await openForm(page, f);
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#confirm").fill(PASSWORD);
    await settleRecords();
    const mark = markNow();
    await page.evaluate(() => {
      const form = document.querySelector("main form") as HTMLFormElement;
      form.requestSubmit();
      form.requestSubmit();
    });
    await heading(page, "Your company is ready", 30_000);
    await sleep(500);
    await settleRecords();
    ok("B9 two submits in one instant (a double Enter) send ONE acceptance request and create one company; the screen shows success",
      actionPosts(mark).length === 1 && (await n(`select count(*)::int as n from orgs where name = 'Lulu Fixture Exhibitions'`)) === 1, String(actionPosts(mark).length));
    ok("B9 …and no 'used' refusal was recorded for it (no second attempt reached the server)", (await lastStage(f.id)) === null);
    await ctx.close();
  }

  // ==============================================================================================================
  section("B10. A visitor already signed in to Elite ERP");
  {
    const f = await invitation({ company: "Faisal Fixture Group" });
    const { ctx, page } = signedIn;
    const mark = markNow();
    await open(page, `/register/accept#t=${f.token}`);
    await heading(page, "You're signed in to Elite ERP");
    await settleRecords();
    ok("B10 a signed-in customer sees 'You're signed in' (sign out first) — the link is not checked, no request; the fragment is removed", actionPosts(mark).length === 0 && !page.url().includes("#") && (await page.locator("#ownerName").count()) === 0);
    ok("B10 …nothing about the invitation is shown", !(await page.locator("main").innerText()).includes("Faisal"));
    const a = await audit(page);
    ok("B10 layout audit (EN, light, 1440)", auditOk(a), auditText(a));
    await shot(page, "30-signed-in-en-light-1440");
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("**/login", { timeout: 20_000 });
    ok("B10 Sign out ends the session (revoked) and goes to /login", (await n(`select count(*)::int as n from sessions where user_id = $1 and revoked_at is null`, [signedIn.userId])) === 0);
    await openForm(page, f);
    ok("B10 …then the same link opens the form; it was never consumed", (await invRow(f.id))?.accepted_at === null && (await page.locator("h2", { hasText: "Faisal Fixture Group" }).count()) === 1);
    await ctx.close();
  }

  // ==============================================================================================================
  section("B11. Language: switched on the page (no request, the link kept); the whole acceptance in Arabic on a phone, dark");
  {
    const f = await invitation({ company: "شركة الريادة للمعارض", owner: "سارة العتيبي", email: "sara.owner@acceptance-browser.test" });
    const ctx = await newContext(A, { locale: "en", theme: "light" });
    const page = await ctx.newPage();
    await openForm(page, f);
    await settleRecords();
    const mark = markNow();
    await page.getByRole("button", { name: "العربية" }).click();
    await heading(page, "قبول دعوتك");
    const ar = await page.locator("main").innerText();
    await page.getByRole("button", { name: "English" }).click();
    await heading(page, FORM_H1);
    await page.getByRole("button", { name: "العربية" }).click();
    await heading(page, "قبول دعوتك");
    await settleRecords();
    ok("B11 the language switch is on the page: Arabic, right to left, and back, without any request (nothing re-mounts, the link stays in memory)",
      (await page.evaluate(() => document.documentElement.lang + "/" + document.documentElement.dir)) === "ar/rtl" && after(mark).length === 0 && ar.includes("تجربتك المجانية"));
    ok("B11 …the choice is remembered for the next page (locale cookie)", (await ctx.cookies()).some((c) => c.name === "locale" && c.value === "ar"));
    ok("B11 Arabic terms: 14 يومًا، 5 جيجابايت، مجانية — لا يلزم أي دفع; Latin values isolated left-to-right", ar.includes("14 يومًا") && ar.includes("5 جيجابايت") && ar.includes("مجانية — لا يلزم أي دفع") && (await page.locator("main [dir=ltr]").count()) >= 5);
    // A string, not a function: the test runner's transform would put helpers into a serialized function.
    const bidi = (await page.evaluate(`(() => {
      const row = (label) => { const dt = [...document.querySelectorAll("main dt")].find((d) => (d.textContent || "").trim() === label); return dt ? dt.nextElementSibling : null; };
      const inLtr = (el) => !!el && (el.matches("[dir=ltr]") || !!el.querySelector("[dir=ltr]") || !!el.closest("[dir=ltr]"));
      return { expiry: inLtr(row("صالحة حتى")), version: inLtr(row("الباقة")), email: inLtr(row("بريدك الإلكتروني")), reference: inLtr(row("مرجع الدعوة")), currency: inLtr(row("العملة الأساسية")) };
    })()`)) as { expiry: boolean; version: boolean; email: boolean; reference: boolean; currency: boolean };
    ok("B11 the Arabic expiry date (Arabic month name) and the version read right to left — never forced into a left-to-right box; the e-mail, reference and currency code are left-to-right isolates",
      !bidi.expiry && !bidi.version && bidi.email && bidi.reference && bidi.currency, JSON.stringify(bidi));
    await fillAndSubmit(page, PASSWORD);
    await heading(page, "شركتك جاهزة", 30_000);
    const sub = await one<{ start: string; end: string }>(`select start_date::text as start, end_date::text as end from tenant_subscriptions where org_id = (select accepted_org_id from organization_invitations where id = $1)`, [f.id]);
    const done = plain(await page.locator("main").innerText());
    const day = (iso: string) => formatPlatformDate(new Date(`${iso}T12:00:00+03:00`), "ar");
    ok("B11 after switching back and forth the same link accepts (it was never lost); the done screen is Arabic with Arabic dates",
      !!sub && done.includes("سجّل الدخول بهذا البريد الإلكتروني وكلمة المرور التي اخترتها للتو:") && (await page.locator("main bdi[dir=ltr]", { hasText: "sara.owner@acceptance-browser.test" }).count()) === 1 && done.includes(`تجربتك المجانية من ${day(sub.start)} إلى ${day(sub.end)}.`), done.slice(0, 300));
    ok("B11 …the Arabic company name and owner name are stored as given", (await n(`select count(*)::int as n from users u join orgs o on o.id = u.org_id where o.name = 'شركة الريادة للمعارض' and u.name = 'سارة العتيبي'`)) === 1);
    await shot(page, "13-done-ar-light-1440");
    await ctx.close();

    const g = await invitation({ company: "مؤسسة النخيل للمعارض", owner: "نورة القحطاني", email: "noura.owner@acceptance-browser.test" });
    const pctx = await newContext(A, { locale: "ar", theme: "dark" }, nextIp(), { width: 390, height: 844 });
    const phone = await pctx.newPage();
    await openForm(phone, g);
    const fa = await audit(phone);
    ok("B11 the Arabic form on a phone, dark (390): one h1, labelled fields, no overflow or clipping, white on orange, RTL", auditOk(fa) && fa.dir === "rtl" && fa.lang === "ar" && fa.theme === "dark", auditText(fa));
    await shot(phone, "14-form-ar-dark-390");
    await fillAndSubmit(phone, PASSWORD);
    await heading(phone, "شركتك جاهزة", 30_000);
    const da = await audit(phone);
    ok("B11 …the Arabic done screen on the phone, dark", auditOk(da) && da.dir === "rtl", auditText(da));
    await shot(phone, "15-done-ar-dark-390");
    await pctx.close();
  }

  // ==============================================================================================================
  section("B12. Page protections: not cached, not indexed, no referrer, nothing in the HTML, cross-origin posts refused");
  {
    const ctx = await newContext(A);
    const page = await ctx.newPage();
    await page.goto("about:blank");
    const probeToken = randomBytes(32).toString("base64url");
    tokensSeen.push(probeToken);
    const res = await page.goto(`/register/accept#t=${probeToken}`);
    await untilView(page, ["This invitation link can't be used"]);
    ok("B12 the page response is not stored by any cache (Cache-Control: no-store)", /no-store/.test(res?.headers()["cache-control"] ?? ""), res?.headers()["cache-control"]);
    const meta = await page.evaluate(() => ({ robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "", referrer: document.querySelector('meta[name="referrer"]')?.getAttribute("content") ?? "" }));
    ok("B12 not indexed (robots: noindex, nofollow) and no referrer is sent from it (referrer: no-referrer)", /noindex/.test(meta.robots) && /nofollow/.test(meta.robots) && meta.referrer === "no-referrer", JSON.stringify(meta));
    const html = await (await fetch(`${A.url}/register/accept`, { headers: { "x-forwarded-for": nextIp() } })).text();
    ok("B12 the server-rendered HTML holds no invitation data and no token (the server never sees the fragment)", !html.includes("Rawabi") && !html.includes("Qimma") && !html.includes("#t=") && tokensSeen.every((t) => !html.includes(t)));
    const f = await invitation({ company: "Cross Origin Fixture" });
    const before = await counts();
    const evil = await postAction(A, "acceptInvitationAction", { token: f.token, ownerName: "Cross Origin", password: PASSWORD, confirm: PASSWORD }, "https://elsewhere.test");
    const noOrigin = await postAction(A, "acceptInvitationAction", { token: f.token, ownerName: "Cross Origin", password: PASSWORD, confirm: PASSWORD }, null);
    // Same-origin for Next.js (Host and Origin both 127.0.0.1) but not the canonical CUSTOMER_PUBLIC_ORIGIN (localhost):
    // refused by the acceptance core's own origin rule.
    const otherHost = await postAction(A, "acceptInvitationAction", { token: f.token, ownerName: "Cross Origin", password: PASSWORD, confirm: PASSWORD }, `http://127.0.0.1:${PORT_A}`, `http://127.0.0.1:${PORT_A}`);
    ok("B12 …the non-canonical origin (same-origin for Next.js) is refused by the acceptance core itself, in neutral terms", otherHost.text.includes('"reason":"unavailable"'), String(otherHost.status));
    ok("B12 a POST from another origin, without an Origin, or from a non-canonical origin is refused; nothing is created; the invitation stays pending",
      ![evil, noOrigin, otherHost].some((r) => r.text.includes('"ok":true')) && same(before, await counts()) && (await invRow(f.id))?.accepted_at === null, `${evil.status}/${noOrigin.status}/${otherHost.status}`);
    const valid = await postAction(A, "checkInvitationLinkAction", { token: f.token });
    ok("B12 …while the same check from the canonical origin works (the refusals above are the origin rules, not a broken request)", valid.text.includes('"ok":true') && valid.text.includes("Cross Origin Fixture"));
    await ctx.close();
  }

  // ==============================================================================================================
  section("B13. EN / AR × light / dark × 1440 / 1024 / 768 / 390 / 360: the form and every screen");
  {
    const widths = [[1440, 900], [1024, 768], [768, 1024], [390, 844], [360, 780]] as const;
    const formFixture = await invitation({ company: "Nakheel Fixture Trading", owner: "Nora Fixture", email: "nora.owner@acceptance-browser.test" });
    let allOk = true;
    const failures: string[] = [];
    let combos = 0;
    for (const locale of ["en", "ar"] as const) {
      for (const theme of ["light", "dark"] as const) {
        const ctx = await newContext(A, { locale, theme });
        const page = await ctx.newPage();
        for (const [w, h] of widths) {
          await page.setViewportSize({ width: w, height: h });
          const ar = locale === "ar";
          const screens: [string, () => Promise<boolean>][] = [
            ["form", async () => {
              await openForm(page, formFixture);
              return true;
            }],
            ["expired", async () => {
              const title = ar ? "انتهت صلاحية هذه الدعوة" : "This invitation has expired";
              await open(page, `/register/accept#t=${(await invitation({ state: "expired" })).token}`);
              return (await untilView(page, [title])) === title;
            }],
            ["used", async () => {
              const title = ar ? "سبق استخدام هذه الدعوة" : "This invitation has already been used";
              await open(page, `/register/accept#t=${(await invitation({ state: "used" })).token}`);
              return (await untilView(page, [title])) === title;
            }],
            ["missing", async () => {
              const title = ar ? "لا توجد دعوة في هذا الرابط" : "No invitation found in this link";
              await open(page, "/register/accept");
              return (await untilView(page, [title])) === title;
            }],
          ];
          for (const [name, go] of screens) {
            if (name !== "form" && (w === 1024 || w === 768)) continue;
            const shown = await go();
            const a = await audit(page);
            combos += 1;
            const good = shown && auditOk(a) && a.lang === locale && a.dir === (ar ? "rtl" : "ltr") && a.theme === theme && (name !== "form" || a.ltr >= 5);
            if (!good) {
              allOk = false;
              failures.push(`${name}-${locale}-${theme}-${w}: shown=${shown} ${auditText(a)}`);
            }
            await shot(page, `4${["form", "expired", "used", "missing"].indexOf(name)}-${name}-${locale}-${theme}-${w}`);
          }
        }
        await ctx.close();
      }
    }
    ok(`B13 ${combos} screens (form at 5 widths; expired, used, missing at 1440 / 390 / 360) × EN / AR × light / dark: one h1, named controls, labelled fields, no horizontal scroll, no clipping, white on orange, lang / dir / theme applied, Latin values left-to-right`, allOk, failures.slice(0, 3).join(" | "));
    const ctx = await newContext(B, { locale: "ar", theme: "dark" }, nextIp(), { width: 360, height: 780 });
    const page = await ctx.newPage();
    await open(page, "/register/accept");
    await heading(page, "قبول الدعوات غير متاح");
    const a = await audit(page);
    ok("B13 the switched-off screen in Arabic, dark, 360", auditOk(a) && a.dir === "rtl", auditText(a));
    await shot(page, "50-disabled-ar-dark-360");
    await ctx.close();
    const mctx = await newContext(A, { locale: "ar", theme: "light" }, nextIp(), { width: 360, height: 780 });
    const mpage = await mctx.newPage();
    const f = await invitation({ company: "مؤسسة الواحة للتجارة", owner: "خالد الحربي" });
    await openForm(mpage, f);
    await fillAndSubmit(mpage, PASSWORD);
    await heading(mpage, "شركتك جاهزة", 30_000);
    const da = await audit(mpage);
    ok("B13 the done screen in Arabic at 360 (the e-mail stays left-to-right inside the Arabic sentence)", auditOk(da) && da.dir === "rtl", auditText(da));
    await shot(mpage, "51-done-ar-light-360");
    await mctx.close();
  }

  // ==============================================================================================================
  section("B14. /register is unchanged (acceptance ON in this server)");
  {
    const ctx = await newContext(A);
    const page = await ctx.newPage();
    await open(page, "/register");
    await heading(page, "Create your organization");
    const before = await counts();
    await page.fill('input[name="orgName"]', "Dana Fixture Trading");
    await page.fill('input[name="name"]', "Dana Fixture");
    await page.fill('input[name="email"]', "  Dana.Owner@Register-Browser.TEST ");
    await page.fill('input[name="password"]', PASSWORD);
    await pickCountry(page);
    await page.getByRole("button", { name: /create account/i }).click();
    await page.waitForURL("**/dashboard", { timeout: 30_000 });
    const afterCounts = await counts();
    const org = await one<{ id: number; currency: string; confirmed: boolean }>(`select id, currency, base_currency_confirmed_at is not null as confirmed from orgs where name = 'Dana Fixture Trading'`);
    const user = await one<{ id: number; email: string; role: string }>(`select id, email, role from users where org_id = $1`, [org?.id]);
    ok("B14 /register still signs the new owner straight in (→ /dashboard, one session), e-mail trimmed and lower-cased, currency confirmed",
      page.url().endsWith("/dashboard") && user?.email === "dana.owner@register-browser.test" && user?.role === "owner" && org?.currency === "SAR" && !!org?.confirmed && afterCounts.sessions === before.sessions + 1);
    ok("B14 …it creates NO platform rows (no access row, primary owner, subscription or event) — exactly as before PO-02D3",
      afterCounts.tenant_access_controls === before.tenant_access_controls && afterCounts.tenant_primary_owners === before.tenant_primary_owners && afterCounts.tenant_subscriptions === before.tenant_subscriptions && afterCounts.subscription_events === before.subscription_events, diff(before, afterCounts));
    const ev = await one<{ a: Record<string, unknown> | null; s: string | null }>(
      `select (select new_value from audit_logs where org_id = $1 and action = 'org.registered') as a, (select detail from security_events where org_id = $1 and type = 'account.created') as s`, [org?.id]);
    ok("B14 …its evidence is unchanged: org.registered {orgName, ownerEmail, country, currency} (no invitation source) and account.created 'organization owner'",
      !!ev?.a && JSON.stringify(Object.keys(ev.a).sort()) === JSON.stringify(["country", "currency", "orgName", "ownerEmail"]) && ev?.s === "organization owner", JSON.stringify(ev));
    const viaInvitation = (await one<{ id: number }>(`select accepted_org_id as id from organization_invitations where id = $1`, [pending.id]))!.id;
    const s1 = await seededCounts(org!.id);
    const s2 = await seededCounts(viaInvitation);
    ok("B14 the shared bootstrap seeds both paths identically (same country): accounts, sequences, tax and payment presets, units, bank, departments, categories, leave types", JSON.stringify(s1) === JSON.stringify(s2) && s1.accounts > 0, JSON.stringify({ register: s1, invitation: s2 }));
    const ctx2 = await newContext(A);
    const p2 = await ctx2.newPage();
    await open(p2, "/register");
    await heading(p2, "Create your organization");
    await p2.fill('input[name="orgName"]', "Second Fixture Holding");
    await p2.fill('input[name="name"]', "Second Fixture");
    await p2.fill('input[name="email"]', "RAMI.owner@acceptance-browser.test");
    await p2.fill('input[name="password"]', PASSWORD);
    await pickCountry(p2);
    await p2.getByRole("button", { name: /create account/i }).click();
    await p2.getByText("An account with this email already exists.").waitFor({ timeout: 20_000 });
    ok("B14 /register refuses the e-mail of an owner created by an invitation (any letter case) with its existing message — one e-mail, one account", (await n(`select count(*)::int as n from orgs where name = 'Second Fixture Holding'`)) === 0);
    await ctx2.close();
    await ctx.close();
  }

  // ==============================================================================================================
  section("B15. Token hygiene: nowhere but the same-origin POST bodies");
  {
    await settleRecords();
    const out = A.output() + B.output();
    ok(`B15 the server output holds none of the ${tokensSeen.length} tokens, no fragment, no password and no secret`, tokensSeen.length >= 40 && tokensSeen.every((t) => !out.includes(t)) && !out.includes("#t=") && secretsSeen.every((s) => !out.includes(s)));
    const logs = consoleLines.join("\n") + pageErrors.join("\n");
    ok(`B15 the browser console (${consoleLines.length} lines) and page errors hold no token and no password`, tokensSeen.every((t) => !logs.includes(t)) && !logs.includes(PASSWORD));
    ok("B15 no uncaught error on any page", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
    const inUrl = requests.filter((r) => tokensSeen.some((t) => r.url.includes(t)));
    const inHeader = requests.filter((r) => Object.values(r.headers).some((v) => tokensSeen.some((t) => v.includes(t)) || v.includes("#t=")));
    ok(`B15 of ${requests.length} browser requests, none carried a token in its URL or any header (Referer included)`, inUrl.length === 0 && inHeader.length === 0, `${inUrl.length}/${inHeader.length}`);
    const sent = requests.filter((r) => !unsentIds.has(r.id));
    const unsent = requests.filter((r) => unsentIds.has(r.id) && tokensSeen.some((t) => r.body.includes(t)));
    ok(`B15 the ${unsent.length} token-carrying request(s) that never left the browser are the acceptance submitted while offline (B8): a server-action POST to /register/accept`,
      unsent.length === 1 && unsent.every((r) => r.method === "POST" && "next-action" in r.headers && r.url === `${A.url}/register/accept`), String(unsent.length));
    const inBody = sent.filter((r) => tokensSeen.some((t) => r.body.includes(t)));
    const bodyOk = (r: Seen) => r.method === "POST" && "next-action" in r.headers && (r.url === `${A.url}/register/accept` || r.url === `${B.url}/register/accept`) && r.headers.origin === new URL(r.url).origin;
    const describe = (r: Seen) => `${r.method} ${pathOf(r.url)} action=${"next-action" in r.headers} origin=${r.headers.origin ?? "-"} headers=${Object.keys(r.headers).length} from=${pathOf(r.from)}`;
    ok(`B15 the ${inBody.length} requests that carried a token did so only in the body of a same-origin server-action POST to /register/accept`,
      inBody.length > 0 && inBody.every(bodyOk), inBody.filter((r) => !bodyOk(r)).slice(0, 3).map(describe).join(" | "));
    const fromAccept = sent.filter((r) => pathOf(r.from) === "/register/accept" && (r.method === "POST" || (r.navigation && r.url.endsWith("/login"))));
    ok(`B15 the ${fromAccept.length} server-action POSTs and sign-in navigations made from the acceptance page sent no Referer at all`, fromAccept.length > 0 && fromAccept.every((r) => !("referer" in r.headers)),
      fromAccept.filter((r) => "referer" in r.headers).slice(0, 3).map((r) => `${describe(r)} nav=${r.navigation} referer=${pathOf(r.headers.referer)}`).join(" | "));
    ok("B15 the browser never contacted any host but the loopback servers (no delivery, no analytics)", foreignHosts().length === 0, foreignHosts().join(", "));
    const allAudit = (await q<{ x: string }>(`select coalesce(after_safe::text, '') || coalesce(before_safe::text, '') || coalesce(reason, '') as x from platform_audit_events`)).map((r) => r.x).join("\n");
    ok("B15 no platform audit record holds a token or a link", tokensSeen.every((t) => !allAudit.includes(t)) && !allAudit.includes("#t="));
    const tables = await q<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`);
    let hit = "";
    for (const { table_name } of tables) {
      const rows = await q<{ t: string }>(`select t::text as t from "${table_name}" t`);
      const text = rows.map((r) => r.t).join("\n");
      if (tokensSeen.some((t) => text.includes(t)) || text.includes(PASSWORD) || text.includes(PASSWORD_2)) {
        hit = table_name;
        break;
      }
    }
    ok(`B15 a text scan of all ${tables.length} tables finds no plaintext token and no plaintext password`, hit === "", hit);
    if (SHOTS) ok(`screenshots written (${shots.length})`, shots.length >= 50, String(shots.length));
  }
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-invitation-acceptance-browser");
} catch (err) {
  console.error(`verify:platform-invitation-acceptance-browser aborted: ${describeError(err)}`);
  exitCode = 1;
} finally {
  for (const c of contexts) await c.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await A?.stop().catch(() => undefined);
  await B?.stop().catch(() => undefined);
  await pool.end().catch(() => undefined);
  if (created && process.env.PLATFORM_TEST_KEEP_DATABASES !== "1") await dropDisposableDatabase(testDbName).catch(() => undefined);
}
process.exit(exitCode);
