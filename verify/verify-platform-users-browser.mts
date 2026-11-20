/**
 * Platform Owner PO-03B — browser suite: the console's user directory, the user page and its controls (disable / enable,
 * sign out everywhere) — the production build (`next build` first) served by `next start` on loopback, driven in
 * Chromium — plus the customer Team tab's payload in this branch's build (the TFX allowlist, carried).
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://…/<admin db with _test_only_> \
 *   PO03B_SCREENSHOT_DIR=<optional output dir> npm run verify:platform-users-browser
 *
 * One disposable database (dropped at the end): the reviewed schema and the PO-02D1B Trial seed; a Trial company with a
 * mapped primary owner, a legacy company and a bulk company, all fictional. Distinctive CANARY values are stored in the
 * authentication columns (password hashes, MFA and recovery envelopes) and the session rows (token hash, user agent):
 * none may appear in any page the browser receives. TEST-ONLY secrets are generated in memory and never printed.
 * Chromium is the pre-installed build (PO01B_CHROMIUM, default /opt/pw-browsers/chromium) — nothing is downloaded.
 *
 * Categories (docs/platform-owner/PO03B_DEVELOPMENT.md §F): U1 directory · U2 search / filters / sort / pages · U3 the
 * real server-to-client payloads hold no secret (directory, user page, Team tab) · U4 user page · U5 sign out everywhere
 * (validation, wrong code, success; the customer's browser is signed out) · U6 disable (the customer can no longer sign
 * in) · U7 enable · U8 the primary owner is protected (control disabled; a direct server-action POST refused) · U9 a stale
 * page is told to refresh · U10 English / Arabic × light / dark × 1440 / 1024 / 768 / 390 / 360 with layout audits ·
 * U11 the company detail links to its users · U12 direct POSTs without a platform session are refused.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import bcrypt from "bcryptjs";
import { createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { section, ok, summary, describeError } from "./platform/harness";
import { startServer, testSecrets, type Server } from "./platform/browser-env";
import { loadActionIds } from "./action-id.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");

const testDbName = disposableName("po03b_browser");
const secrets = testSecrets();
const PORT = Number(process.env.PO03B_PORT || 3463);
const SHOTS = process.env.PO03B_SCREENSHOT_DIR || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
process.env.DATABASE_URL = databaseUrlFor(testDbName);
Object.assign(process.env, secrets);
process.env.PLATFORM_CONSOLE_ENABLED = "true";
process.env.PLATFORM_TRUSTED_PROXY_HOPS = "1";

let created = false;
await createPlatformTestDatabase("po03b_browser", testDbName);
created = true;
{
  const { runSeed } = await import("../scripts/platform/trial-seed");
  const seeded = await runSeed(process.env.DATABASE_URL);
  if (seeded.check.state !== "complete") throw new Error(`the Trial seed did not complete: ${seeded.check.state}`);
}

const { db, pool, platformAdminsTable } = await import("../src/db");
const auth = await import("../src/lib/platform/auth");
const mfa = await import("../src/lib/platform/mfa");
const totp = await import("../src/lib/platform/totp");
const console_ = await import("../src/lib/platform/console");
const controls = await import("../src/lib/platform/customer-user-actions");
pool.on("error", () => undefined);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const q = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
const one = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await q<T>(text, values))[0];
const plain = (s: string) => s.replace(/[⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
const PLATFORM_COOKIE = "__Host-elite_erp_platform";
const PASSWORD = "Fjord-Lantern-58!q";
const OPERATOR_PASSWORD = "Juniper-Compass-62!k";
let ipSeq = 0;
const nextIp = () => `198.51.100.${(++ipSeq % 200) + 20}`;
const REASON = "Fixture: the company asked us to review this account";

// ---- canaries (stored in authentication columns; never allowed in a page) -----------------------------------------------
const bcryptPad = (stem: string) => "$2b$10$" + (stem + "Q".repeat(53)).slice(0, 53);
const CANARY = {
  hash: bcryptPad("CanaryUsersBrowserHashK4"),
  mfa: "v1:CANARY_USERS_BROWSER_MFA_ENVELOPE_K4",
  rec: "v1:CANARY_USERS_BROWSER_RECOVERY_ENVELOPE_K4",
  agent: "CanaryUsersBrowserAgent/4.4",
  tokenHash: createHash("sha256").update(`canary-session-${randomBytes(8).toString("hex")}`).digest("hex"),
};

// ---- fixtures -----------------------------------------------------------------------------------------------------------
type Admin = { id: string; email: string; secret: string; lastStep: number };
async function createAdmin(label: string): Promise<Admin> {
  const email = `${label}.${Date.now().toString(36)}@users-browser.test`;
  const { secret } = mfa.createTotpEnrollment(email);
  const { hashes } = await mfa.createRecoveryCodeSet();
  const at = new Date();
  const [row] = await db
    .insert(platformAdminsTable)
    .values({ emailNormalized: email, displayName: `Fictional ${label}`, passwordHash: await auth.hashPlatformPassword(OPERATOR_PASSWORD), isActive: true, mfaSecretEncrypted: mfa.encryptTotpSecret(secret), mfaRecoveryHashes: hashes, mfaEnrolledAt: at, passwordChangedAt: at, createdAt: at, updatedAt: at })
    .returning({ id: platformAdminsTable.id });
  return { id: row.id, email, secret, lastStep: 0 };
}
/** A code for a time step this operator has not used yet (the server accepts the current step and the next one). */
async function freshCode(a: Admin): Promise<string> {
  for (;;) {
    const cur = totp.totpStepAt(new Date());
    const step = Math.max(cur, a.lastStep + 1);
    if (step <= cur + 1) {
      a.lastStep = step;
      return totp.hotpCode(a.secret, step);
    }
    await sleep((cur + 1) * 30_000 - Date.now() + 750);
  }
}
async function newOrg(name: string): Promise<number> {
  return Number((await one<{ id: number }>(`insert into orgs (name, country, currency) values ($1, 'Saudi Arabia', 'SAR') returning id`, [name]))!.id);
}
const realHash = await bcrypt.hash(PASSWORD, 4);
async function addUser(orgId: number, name: string, email: string, role: string, opts: { active?: boolean; mfa?: boolean; canHash?: boolean; lastLogin?: Date } = {}): Promise<number> {
  return Number(
    (await one<{ id: number }>(
      `insert into users (org_id, email, password_hash, name, role, is_active, mfa_enabled, mfa_secret, mfa_recovery_codes, last_login_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [orgId, email, opts.canHash ? realHash : CANARY.hash, name, role, opts.active ?? true, opts.mfa ?? false, CANARY.mfa, CANARY.rec, opts.lastLogin ?? null],
    ))!.id,
  );
}

// ---- browser helpers --------------------------------------------------------------------------------------------------
let browser!: Browser;
let A!: Server;
type Prefs = { locale: "en" | "ar"; theme: "light" | "dark" };
async function newContext(prefs: Prefs = { locale: "en", theme: "light" }, viewport = { width: 1440, height: 900 }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ baseURL: A.url, viewport, deviceScaleFactor: 1, reducedMotion: "reduce", extraHTTPHeaders: { "x-forwarded-for": nextIp() } });
  await setPrefs(ctx, prefs);
  return ctx;
}
async function setPrefs(ctx: BrowserContext, prefs: Prefs) {
  await ctx.addCookies([
    { name: "locale", value: prefs.locale, url: A.url },
    { name: "theme", value: prefs.theme, url: A.url },
  ]);
}
async function go(page: Page, path: string) {
  const res = await page.goto(path);
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 20_000 });
  return res;
}
async function platformSignIn(ctx: BrowserContext, a: Admin): Promise<Page> {
  const page = await ctx.newPage();
  await go(page, "/platform/login");
  await page.getByLabel("Email", { exact: true }).fill(a.email);
  await page.getByLabel("Password", { exact: true }).fill(OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Verification code", { exact: true }).fill(await freshCode(a));
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await page.waitForURL("**/platform/dashboard", { timeout: 25_000 });
  return page;
}
async function customerSignIn(ctx: BrowserContext, email: string): Promise<{ page: Page; ok: boolean }> {
  const page = await ctx.newPage();
  await go(page, "/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("form button[type=submit]").click();
  const okNav = await page.waitForURL("**/dashboard", { timeout: 15_000 }).then(() => true, () => false);
  return { page, ok: okNav };
}

// ---- the real server-to-client payloads ---------------------------------------------------------------------------------
async function payloads(page: Page, path: string): Promise<{ html: string; rsc: string }> {
  const url = new URL(path, A.url).toString();
  const doc = page.waitForResponse((r) => r.url() === url && r.request().resourceType() === "document");
  await page.goto(path, { waitUntil: "networkidle" });
  const html = await (await doc).text();
  const rsc = await page.evaluate(async (u) => (await fetch(u, { headers: { RSC: "1" }, credentials: "same-origin" })).text(), url);
  return { html, rsc };
}
const BCRYPT = /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/;
function leaksIn(text: string): string[] {
  const found = Object.entries(CANARY).filter(([, v]) => text.includes(v)).map(([k]) => k);
  if (BCRYPT.test(text)) found.push("bcrypt-shaped");
  for (const key of ["passwordHash", "mfaSecret", "mfaRecoveryCodes", "tokenHash", "password_hash", "mfa_secret", "token_hash"]) if (text.includes(key)) found.push(key);
  return found;
}

// ---- layout audit (the PO-01B … PO-03A rules) -----------------------------------------------------------------------------
type AuditResult = { h1: number; lang: string; dir: string; theme: string | null; overflow: number; unnamed: string[]; unlabelled: string[]; orangeOffenders: string[]; clipped: string[] };
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
  const scope = document.querySelector("main");
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    const text = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || "").trim());
    if (text && orange(bgOf(el)) && getComputedStyle(el).color !== "rgb(255, 255, 255)") offenders.push(el.tagName.toLowerCase() + "." + String(el.className).slice(0, 40) + " " + getComputedStyle(el).color);
    if (text && scope && scope.contains(el) && !el.classList.contains("sr-only") && el.scrollWidth > el.clientWidth + 1 && !["auto", "scroll", "hidden"].includes(getComputedStyle(el).overflowX) && !["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(el.tagName)) clipped.push(el.tagName + ": " + (el.textContent || "").trim().slice(0, 40));
  }
  return { h1: document.querySelectorAll("h1").length, lang: document.documentElement.lang, dir: document.documentElement.dir, theme: document.documentElement.dataset.theme || null, overflow: document.documentElement.scrollWidth - window.innerWidth, unnamed, unlabelled, orangeOffenders: offenders, clipped };
})()`;
const audit = async (page: Page) => (await page.evaluate(AUDIT_SCRIPT)) as AuditResult;
const auditOk = (a: AuditResult) => a.h1 === 1 && a.overflow <= 1 && a.unnamed.length === 0 && a.unlabelled.length === 0 && a.orangeOffenders.length === 0 && a.clipped.length === 0;
const auditText = (a: AuditResult) => JSON.stringify({ ...a, unnamed: a.unnamed.slice(0, 2), unlabelled: a.unlabelled.slice(0, 2), orangeOffenders: a.orangeOffenders.slice(0, 2), clipped: a.clipped.slice(0, 3) });
const shots: string[] = [];
/** Full-page by default; `viewport` for an open dialog (a full-page capture re-lays fixed layers out of place) and long phone lists. */
async function shot(page: Page, name: string, mode: "full" | "viewport" = "full") {
  if (!SHOTS) return;
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await sleep(150);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: mode === "full" });
  shots.push(name);
}
/** Whether keyboard focus is inside the open dialog (Radix moves it there and keeps it there). */
const focusInDialog = (page: Page) => page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"));

// ---- direct POSTs to the build's own server actions (ids from its manifest) -----------------------------------------------
const actionIdOf = await loadActionIds();
async function postAction(path: string, name: string, args: unknown[], cookie: string, origin = A.url): Promise<{ status: number; text: string }> {
  const id = actionIdOf(name);
  if (!id) throw new Error(`server action ${name} is not in the build manifest`);
  const res = await fetch(`${A.url}${path}`, {
    method: "POST",
    headers: { "next-action": id, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", origin, cookie, "x-forwarded-for": nextIp() },
    body: JSON.stringify(args),
    redirect: "manual",
  });
  return { status: res.status, text: await res.text() };
}

async function main() {
  browser = await chromium.launch({ executablePath: process.env.PO01B_CHROMIUM || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  A = await startServer(PORT, { ...secrets, DATABASE_URL: process.env.DATABASE_URL, PLATFORM_CONSOLE_ENABLED: "true", PLATFORM_TRUSTED_PROXY_HOPS: "1", PLATFORM_INVITATIONS_ENABLED: undefined, CUSTOMER_INVITE_ACCEPTANCE_ENABLED: undefined, TENANT_ACCESS_ENFORCEMENT: "enabled" });

  const operator = await createAdmin("operator");
  const second = await createAdmin("second");
  // A Trial company (3 seats) with a mapped primary owner.
  const T = await newOrg("Al-Waha Fictional Trading");
  const fatimah = await addUser(T, "Fatimah Fictional", "fatimah.owner@alwaha-fixture.test", "owner", { canHash: true, lastLogin: new Date(Date.now() - 86_400_000) });
  const noura = await addUser(T, "Noura Fictional", "noura.owner@alwaha-fixture.test", "owner");
  const omar = await addUser(T, "Omar Fictional", "omar.admin@alwaha-fixture.test", "admin", { mfa: true, lastLogin: new Date(Date.now() - 2 * 86_400_000) });
  const khalid = await addUser(T, "Khalid Fictional", "khalid.staff@alwaha-fixture.test", "staff", { canHash: true });
  await addUser(T, "Layla Fictional", "layla.staff@alwaha-fixture.test", "staff", { active: false });
  await q(`insert into tenant_primary_owners (org_id, user_id) values ($1, $2)`, [T, fatimah]);
  const v1 = (await one<{ id: string }>(`select v.id from subscription_package_versions v join subscription_packages p on p.id = v.package_id where p.is_default_trial and v.version_number = 1`))!.id;
  await q(
    `insert into tenant_subscriptions (org_id, package_version_id, version_state, is_trial, cycle, lifecycle_state, start_date, end_date, price_snapshot_sar, seats_snapshot, storage_snapshot_gb, module_groups_snapshot, assignment_source)
     values ($1, $2, 'published', true, 'trial', 'trialing', current_date, current_date + 13, 0, 3, 5, '[]'::jsonb, 'invitation_acceptance')`,
    [T, v1],
  );
  // A legacy company and a bulk company (for pages).
  const L = await newOrg("Fictional Legacy Supplies");
  await addUser(L, "Huda Fictional", "huda.owner@legacy-fixture.test", "owner");
  await addUser(L, "Sara Fictional", "sara.staff@legacy-fixture.test", "staff");
  const B = await newOrg("Bulk Fictional Services");
  for (let i = 1; i <= 24; i++) await addUser(B, `Bulk Fixture ${String(i).padStart(2, "0")}`, `bulk${String(i).padStart(2, "0")}@bulk-fixture.test`, i === 1 ? "owner" : "staff");
  // A session row with canary token hash and user agent (must never reach any page).
  await q(`insert into sessions (org_id, user_id, token_hash, user_agent, ip_address, expires_at) values ($1, $2, $3, $4, '192.0.2.44', now() + interval '30 days')`, [T, omar, CANARY.tokenHash, CANARY.agent]);
  const total = Number((await one<{ n: number }>(`select count(*)::int as n from users`))!.n);

  const ctx = await newContext();
  const page = await platformSignIn(ctx, operator);
  const platformCookie = (await ctx.cookies()).find((c) => c.name === PLATFORM_COOKIE)!;

  // ============================================================================================================
  section("U1 The directory");
  await go(page, "/platform/users?size=50");
  const tiles = plain(await page.locator(".platform-stat-grid").innerText());
  ok("U1 the page is the operational directory (no preview badge or notice) with live figures: users, active, disabled, two-factor", !(await page.getByText("This section is a preview").count()) && tiles.includes(String(total)) && /Users/.test(tiles) && /Active/.test(tiles) && /Disabled/.test(tiles) && /Two-factor on/.test(tiles), tiles);
  const fRow = page.getByTestId(`user-row-${fatimah}`);
  const fText = plain(await fRow.innerText());
  ok("U1 …a row shows the name, e-mail, company, role, status, two-factor, last sign-in, creation date and the company's seats (5 of 3, over by 2)", /Fatimah Fictional/.test(fText) && /fatimah\.owner@alwaha-fixture\.test/.test(fText) && /Al-Waha Fictional Trading/.test(fText) && /Owner/.test(fText) && /Active/.test(fText) && /5 of 3/.test(fText) && /Over by 2/.test(fText), fText);
  ok("U1 …the mapped primary owner carries the Primary owner tag; nobody else does", (await fRow.getByText("Primary owner", { exact: true }).count()) === 1 && (await page.getByTestId(`user-row-${noura}`).getByText("Primary owner", { exact: true }).count()) === 0);
  await shot(page, "20-users-directory-en-light-1440");

  // ============================================================================================================
  section("U2 Search, filters, sorting and pages");
  await page.locator("#users-q").fill("khalid");
  await page.getByRole("button", { name: "Apply" }).click();
  await page.waitForURL(/q=khalid/);
  ok("U2 search narrows to the matching user (name / e-mail / company)", (await page.getByTestId(/^user-row-/).count()) === 1 && (await page.getByTestId(`user-row-${khalid}`).count()) === 1);
  await go(page, "/platform/users?status=disabled");
  ok("U2 the Disabled filter lists only disabled accounts", (await page.getByTestId(/^user-row-/).count()) === 1 && /Layla Fictional/.test(await page.getByTestId("users-table").innerText()));
  await go(page, "/platform/users?size=10&sort=name");
  const p1 = await page.getByTestId(/^user-row-/).allInnerTexts();
  await page.getByRole("link", { name: "Next" }).click();
  await page.waitForURL(/page=2/);
  const p2 = await page.getByTestId(/^user-row-/).allInnerTexts();
  const pagerText = plain(await page.locator(".platform-pager-summary").innerText());
  ok("U2 pages of 10, sorted by name: page 2 continues page 1 without overlap, and the pager says where you are", p1.length === 10 && p2.length === 10 && !p1.some((r) => p2.includes(r)) && new RegExp(`Page 2 of ${Math.ceil(total / 10)}`).test(pagerText), pagerText);
  await go(page, "/platform/users?q=%25");
  ok("U2 no match → the empty state with a hint", /No users match these filters/.test(await page.locator("main").innerText()));
  await go(page, "/platform/users?size=99");
  ok("U2 a malformed query → a clear message and a way to start over (no data, no error page)", /can't be used/.test(await page.locator("main").innerText()) && (await page.getByRole("link", { name: "Start over" }).count()) === 1);

  // ============================================================================================================
  section("U3 Nothing sensitive reaches the browser (2, 18)");
  const dir = await payloads(page, "/platform/users?size=50");
  const det = await payloads(page, `/platform/users/${omar}`);
  ok("U3 the directory's HTML and RSC payloads hold no password hash, MFA or recovery envelope, session hash or user agent (canaries) and no bcrypt-shaped string", leaksIn(dir.html).length === 0 && leaksIn(dir.rsc).length === 0 && /Omar Fictional/.test(dir.html), [...leaksIn(dir.html), ...leaksIn(dir.rsc)].join(","));
  ok("U3 …nor does the user page's (it shows the session COUNT, never a session)", leaksIn(det.html).length === 0 && leaksIn(det.rsc).length === 0 && /Omar Fictional/.test(det.html), [...leaksIn(det.html), ...leaksIn(det.rsc)].join(","));
  const cctx = await newContext();
  const fat = await customerSignIn(cctx, "fatimah.owner@alwaha-fixture.test");
  const team = fat.ok ? await payloads(fat.page, "/settings/organization?tab=team") : { html: "", rsc: "" };
  ok("U3 the customer Team tab of this branch's build sends only the five member fields (no canary, no authentication key)", fat.ok && /Omar Fictional/.test(team.html) && leaksIn(team.html).length === 0 && leaksIn(team.rsc).length === 0, [...leaksIn(team.html), ...leaksIn(team.rsc)].join(","));
  await cctx.close();

  // ============================================================================================================
  section("U4–U7 A user's page and its controls");
  const kctx = await newContext();
  const kh = await customerSignIn(kctx, "khalid.staff@alwaha-fixture.test");
  await go(page, `/platform/users/${khalid}`);
  const kText = plain(await page.locator("main").innerText());
  ok("U4 the user page: account details, Active, one active session, the company's seats, the controls and the audited-view note", kh.ok && /Khalid Fictional/.test(kText) && /khalid\.staff@alwaha-fixture\.test/.test(kText) && /Active sessions 1/.test(kText) && /Company seats/.test(kText) && /Opening this page is recorded/.test(kText), kText.slice(0, 400));
  await shot(page, "21-user-page-en-light-1440");
  // U5 — sign out everywhere: validation, a wrong code, success.
  await page.getByTestId("user-revoke-control").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Active sessions right now: 1").waitFor({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "End sessions" }).click();
  ok("U5 submitting empty shows the reason and code errors (nothing is sent)", /Enter a reason of 10 to 500 characters/.test(await dialog.innerText()) && /Enter the 6-digit code/.test(await dialog.innerText()));
  await dialog.getByLabel("Reason").fill(REASON);
  await dialog.getByLabel("Verification code").fill("000000");
  await dialog.getByRole("button", { name: "End sessions" }).click();
  await dialog.getByText(/incorrect or has already been used/).waitFor({ timeout: 15_000 });
  ok("U5 a wrong code is refused with a clear message, the code field is cleared, and nothing changed", (await dialog.getByLabel("Verification code").inputValue()) === "" && Number((await one<{ n: number }>(`select count(*)::int as n from sessions where user_id = $1 and revoked_at is null`, [khalid]))!.n) === 1);
  await shot(page, "22-revoke-dialog-en-light-1440", "viewport");
  await dialog.getByLabel("Verification code").fill(await freshCode(operator));
  await dialog.getByRole("button", { name: "End sessions" }).click();
  await dialog.getByText("Sessions ended: 1. The account stays active.").waitFor({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.getByText("This user has no active sessions.").waitFor({ timeout: 15_000 });
  await kh.page.goto("/dashboard");
  ok("U5 …success: the result is reported, the page refreshes (0 sessions) and the customer's own browser is signed out", /\/login/.test(kh.page.url()), kh.page.url());
  // U6 — disable.
  await page.getByTestId("user-status-control").click();
  await dialog.getByLabel("Reason").waitFor({ timeout: 15_000 });
  ok("U6 the disable dialog explains the effects (signed out, no sign-in, data kept, seat still occupied, recorded) and holds the keyboard focus", /can't sign in until the account is enabled again/.test(await dialog.innerText()) && /kept unchanged/.test(await dialog.innerText()) && /still occupies a company seat/.test(await dialog.innerText()) && (await focusInDialog(page)));
  await shot(page, "23-disable-dialog-en-light-1440", "viewport");
  await dialog.getByLabel("Reason").fill(REASON);
  await dialog.getByLabel("Verification code").fill(await freshCode(operator));
  await dialog.getByRole("button", { name: "Disable user" }).click();
  await dialog.getByText(/The account is disabled\. Sessions ended: 0\./).waitFor({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.getByTestId("user-status-control").getByText("Enable user").waitFor({ timeout: 15_000 });
  const kctx2 = await newContext();
  const refused = await customerSignIn(kctx2, "khalid.staff@alwaha-fixture.test");
  ok("U6 …the page now shows Disabled with Enable user, and the customer can no longer sign in", /Disabled/.test(plain(await page.locator("main").innerText())) && !refused.ok);
  await shot(page, "24-user-disabled-en-light-1440");
  // U7 — enable.
  await page.getByTestId("user-status-control").click();
  await dialog.getByLabel("Reason").fill(REASON);
  await dialog.getByLabel("Verification code").fill(await freshCode(operator));
  await dialog.getByRole("button", { name: "Enable user" }).click();
  await dialog.getByText("The account is enabled. The user can sign in again.").waitFor({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.getByTestId("user-status-control").getByText("Disable user").waitFor({ timeout: 15_000 });
  const kctx3 = await newContext();
  const back = await customerSignIn(kctx3, "khalid.staff@alwaha-fixture.test");
  ok("U7 enabling restores sign-in (the customer signs in again)", back.ok);
  const events = (await q<{ action: string }>(`select action from platform_audit_events where entity_type = 'customer_user' and entity_id = $1 and result = 'success' and action <> 'customer_user.viewed' order by id`, [String(khalid)])).map((r) => r.action);
  ok("U7 …the platform audit trail holds the three changes in order (sessions revoked, disabled, enabled)", JSON.stringify(events) === JSON.stringify(["customer_user.sessions_revoked", "customer_user.disabled", "customer_user.enabled"]), events.join(","));
  await page.reload();
  await page.locator("h1").waitFor();
  ok("U7 …and the page's activity table lists them in the operator's language", /Ended the user's sessions/.test(await page.locator("main").innerText()) && /Disabled the account/.test(await page.locator("main").innerText()) && /Enabled the account/.test(await page.locator("main").innerText()));

  // ============================================================================================================
  section("U8 The primary owner is protected");
  await go(page, `/platform/users/${fatimah}`);
  const control = page.getByTestId("user-status-control");
  ok("U8 the primary owner's Disable control is disabled and says why (the note is visible)", (await control.isDisabled()) && /primary owner can't be disabled/.test((await control.getAttribute("aria-label")) ?? "") && (await page.getByTestId("user-protection-note").isVisible()));
  await shot(page, "25-primary-owner-protected-en-light-1440");
  const cookie = `${PLATFORM_COOKIE}=${platformCookie.value}`;
  const state = await postAction(`/platform/users/${fatimah}`, "readCustomerUserStateAction", [String(fatimah)], cookie);
  const version = /"version":"([0-9T:.\-]+)"/.exec(state.text)?.[1] ?? "";
  const forced = await postAction(`/platform/users/${fatimah}`, "changeCustomerUserStatusAction", [{ userId: String(fatimah), target: "disabled", reason: REASON, totpCode: await freshCode(operator), version }], cookie);
  const fRowDb = await one<{ is_active: boolean }>(`select is_active from users where id = $1`, [fatimah]);
  ok("U8 a direct server-action POST to disable the primary owner is refused by the server (LAST_PRIMARY_OWNER) and nothing changes", version !== "" && forced.text.includes("LAST_PRIMARY_OWNER") && fRowDb?.is_active === true, `${forced.status}`);

  // ============================================================================================================
  section("U9 A stale page is told to refresh");
  await go(page, `/platform/users/${omar}`);
  const r2 = await console_.signInCore({ email: second.email, password: OPERATOR_PASSWORD, totpCode: await freshCode(second) }, { headers: new Headers({ host: new URL(A.url).host, origin: A.url, "sec-fetch-site": "same-origin", "user-agent": "verify-users-browser", "x-forwarded-for": nextIp() }) });
  const headers2 = () => new Headers({ host: new URL(A.url).host, origin: A.url, "sec-fetch-site": "same-origin", "user-agent": "verify-users-browser", "x-forwarded-for": nextIp() });
  const token2 = r2.ok ? r2.token : "";
  const st = await controls.readCustomerUserStateCore({ headers: headers2(), token: token2 }, String(omar));
  const d1 = st.ok ? await controls.setCustomerUserStatusCore({ headers: headers2(), token: token2 }, { userId: String(omar), target: "disabled", reason: REASON, totpCode: await freshCode(second), version: st.state.version }) : st;
  await page.getByTestId("user-status-control").click();
  await dialog.getByText(/This account changed after this page was loaded/).waitFor({ timeout: 15_000 });
  ok("U9 another operator changed the account after this page loaded: the dialog says so and offers Refresh (no form, no code asked)", d1.ok && (await dialog.getByLabel("Verification code").count()) === 0);
  await dialog.getByRole("button", { name: "Refresh" }).click();
  await page.getByTestId("user-status-control").getByText("Enable user").waitFor({ timeout: 15_000 });
  ok("U9 …after Refresh the page shows the newer decision (Disabled, Enable user)", /Disabled/.test(plain(await page.locator("main").innerText())));

  // ============================================================================================================
  section("U10 English / Arabic × light / dark × 1440 / 1024 / 768 / 390 / 360");
  const widths = [1440, 1024, 768, 390, 360];
  const matrix: string[] = [];
  for (const locale of ["en", "ar"] as const) {
    for (const theme of ["light", "dark"] as const) {
      await setPrefs(ctx, { locale, theme });
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        for (const path of ["/platform/users", `/platform/users/${khalid}`]) {
          await go(page, path);
          const a = await audit(page);
          const good = auditOk(a) && a.lang === locale && a.dir === (locale === "ar" ? "rtl" : "ltr") && a.theme === theme;
          if (!good) matrix.push(`${locale}/${theme}/${width} ${path}: ${auditText(a)}`);
        }
        const tablet = width === 768 && ((locale === "en" && theme === "light") || (locale === "ar" && theme === "dark"));
        if (((width === 1440 || width === 390) && !(locale === "en" && theme === "light" && width === 1440)) || tablet) {
          await go(page, "/platform/users");
          await shot(page, `30-users-${locale}-${theme}-${width}`, width === 390 ? "viewport" : "full");
          await go(page, `/platform/users/${khalid}`);
          await shot(page, `31-user-${locale}-${theme}-${width}`);
        }
      }
    }
  }
  ok("U10 every combination: one h1, no horizontal overflow, every control named, every field labelled, white text on orange, nothing clipped; lang / dir / theme as chosen", matrix.length === 0, matrix.slice(0, 3).join(" | "));
  await setPrefs(ctx, { locale: "ar", theme: "dark" });
  await page.setViewportSize({ width: 390, height: 860 });
  await go(page, `/platform/users/${khalid}`);
  await page.getByTestId("user-status-control").click();
  const arDialog = page.getByRole("dialog");
  await arDialog.getByLabel("السبب").waitFor({ timeout: 15_000 });
  const arText = await arDialog.innerText();
  ok("U10 the Arabic disable dialog on a phone (bottom sheet, dark): Arabic text, the reason and code fields labelled, focus inside the dialog", /هل تريد تعطيل/.test(arText) && /ما الذي سيحدث/.test(arText) && (await arDialog.getByLabel("رمز التحقق").count()) === 1 && (await focusInDialog(page)));
  await shot(page, "32-disable-dialog-ar-dark-390", "viewport");
  await page.keyboard.press("Escape");
  await arDialog.waitFor({ state: "hidden", timeout: 10_000 });
  ok("U10 Escape closes the dialog and focus returns to its trigger", await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "user-status-control"));
  await go(page, "/platform/users");
  const ltrDigits = await page.evaluate(() => [...document.querySelectorAll("bdi[dir=ltr]")].some((el) => /\d/.test(el.textContent ?? "")));
  const arMain = await page.locator("main").innerText();
  ok("U10 Arabic directory: right-to-left, Arabic labels, numbers and e-mails kept left-to-right (Western digits)", (await page.evaluate(() => document.documentElement.dir)) === "rtl" && /المستخدمون/.test(arMain) && ltrDigits && !/[٠-٩]/.test(arMain));
  await setPrefs(ctx, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });

  // ============================================================================================================
  section("U11 The company detail links to its users");
  await go(page, `/platform/companies/${T}?tab=users`);
  await page.getByRole("link", { name: "Manage users" }).click();
  await page.waitForURL(new RegExp(`/platform/users\\?org=${T}`));
  await page.locator("h1").waitFor();
  const filtered = plain(await page.locator("main").innerText());
  ok("U11 Manage users opens the directory filtered to that company (with a way back to every company)", /Showing the users of Al-Waha Fictional Trading/.test(filtered) && (await page.getByTestId(/^user-row-/).count()) === 5 && (await page.getByRole("link", { name: "Show every company" }).count()) === 1, filtered.slice(0, 200));
  await shot(page, "26-users-filtered-by-company-en-light-1440");

  // ============================================================================================================
  section("U12 Direct POSTs without a usable platform session are refused");
  const anon = await postAction(`/platform/users/${khalid}`, "revokeCustomerUserSessionsAction", [{ userId: String(khalid), reason: REASON, totpCode: "123456" }], "");
  const cross = await postAction(`/platform/users/${khalid}`, "revokeCustomerUserSessionsAction", [{ userId: String(khalid), reason: REASON, totpCode: await freshCode(operator) }], cookie, "https://evil.example");
  const extra = await postAction(`/platform/users/${khalid}`, "revokeCustomerUserSessionsAction", [{ userId: String(khalid), reason: REASON, totpCode: "123456", role: "owner" }], cookie);
  const khalidLive = Number((await one<{ n: number }>(`select count(*)::int as n from platform_audit_events where entity_id = $1 and action = 'customer_user.sessions_revoked'`, [String(khalid)]))!.n);
  ok("U12 no platform cookie → redirected to sign-in; a cross-site POST → refused (FORBIDDEN or Next's own origin check); an unexpected field → VALIDATION_FAILED; no extra revocation recorded",
    (anon.status === 303 || /\/platform\/login/.test(anon.text)) && (cross.status >= 400 || /FORBIDDEN/.test(cross.text)) && /VALIDATION_FAILED/.test(extra.text) && khalidLive === 1, `${anon.status} ${cross.status} ${extra.status}`);

  await ctx.close();
  for (const c of [kctx, kctx2, kctx3]) await c.close().catch(() => undefined);
  if (SHOTS) console.log(`screenshots: ${shots.length}`);
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-users-browser");
} catch (e) {
  ok("suite ran to completion", false, describeError(e));
  exitCode = summary("verify:platform-users-browser");
} finally {
  await browser?.close().catch(() => undefined);
  await A?.stop().catch(() => undefined);
  await pool.end().catch(() => undefined);
  if (created && !process.env.PLATFORM_TEST_KEEP_DATABASES) await dropDisposableDatabase(testDbName).catch(() => undefined);
}
process.exit(exitCode);
