/**
 * Platform Owner PO-03C, sub-batch A — browser suite: the user page's Change role control and the company page's
 * primary-owner transfer — the production build (`next build` first) served by `next start` on loopback, driven in
 * Chromium.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://…/<admin db with _test_only_> \
 *   PO03C_SCREENSHOT_DIR=<optional output dir> npm run verify:platform-roles-browser
 *
 * One disposable database (dropped at the end): the reviewed schema and the PO-02D1B Trial seed; a Trial company with a
 * mapped primary owner and a legacy company (no mapping), all fictional. Distinctive CANARY values are stored in the
 * authentication columns and a session row: none may appear in any page or server-action response the browser receives.
 * TEST-ONLY secrets are generated in memory and never printed. Chromium is the pre-installed build (PO01B_CHROMIUM,
 * default /opt/pw-browsers/chromium) — nothing is downloaded.
 *
 * Categories (docs/platform-owner/PO03C_DEVELOPMENT.md §J): R1 change a role (validation, wrong code, success; the
 * customer's browser is signed out; audited and listed) · R2 protected owners (the primary owner and a legacy company's
 * last owner: control disabled with the reason; a direct server-action POST refused) · R3 a stale user page is told to
 * refresh · R4 transfer the primary ownership (both owners shown; the effects; success; BOTH customers' browsers signed
 * out; mapping, roles and activity) · R5 a legacy company is "Not designated" (control disabled; a direct POST refused) ·
 * R6 a stale company page is told to refresh · R7 English / Arabic × light / dark × 1440 / 1024 / 768 / 390 / 360 with
 * layout audits and both dialogs in Arabic on a phone · R8 payloads hold no secret; direct POSTs without a session,
 * cross-site or with unexpected fields are refused.
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

const testDbName = disposableName("po03c_roles_browser");
const secrets = testSecrets();
const PORT = Number(process.env.PO03C_PORT || 3467);
const SHOTS = process.env.PO03C_SCREENSHOT_DIR || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
process.env.DATABASE_URL = databaseUrlFor(testDbName);
Object.assign(process.env, secrets);
process.env.PLATFORM_CONSOLE_ENABLED = "true";
process.env.PLATFORM_TRUSTED_PROXY_HOPS = "1";

let created = false;
await createPlatformTestDatabase("po03c_roles_browser", testDbName);
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
const PASSWORD = "Saffron-Harbor-41!t";
const OPERATOR_PASSWORD = "Meadow-Beacon-27!w";
let ipSeq = 0;
const nextIp = () => `198.51.100.${(++ipSeq % 200) + 20}`;
const REASON = "Fixture: the company asked us in writing to change this";

// ---- canaries (stored in authentication columns; never allowed in a page or an action response) ---------------------
const bcryptPad = (stem: string) => "$2b$10$" + (stem + "Q".repeat(53)).slice(0, 53);
const CANARY = {
  hash: bcryptPad("CanaryRolesBrowserHashM7"),
  mfa: "v1:CANARY_ROLES_BROWSER_MFA_ENVELOPE_M7",
  rec: "v1:CANARY_ROLES_BROWSER_RECOVERY_ENVELOPE_M7",
  agent: "CanaryRolesBrowserAgent/7.7",
  tokenHash: createHash("sha256").update(`canary-roles-session-${randomBytes(8).toString("hex")}`).digest("hex"),
};

// ---- fixtures -----------------------------------------------------------------------------------------------------------
type Admin = { id: string; email: string; secret: string; lastStep: number };
async function createAdmin(label: string): Promise<Admin> {
  const email = `${label}.${Date.now().toString(36)}@roles-browser.test`;
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
async function addUser(orgId: number, name: string, email: string, role: string, opts: { active?: boolean; canHash?: boolean } = {}): Promise<number> {
  return Number(
    (await one<{ id: number }>(
      `insert into users (org_id, email, password_hash, name, role, is_active, mfa_secret, mfa_recovery_codes) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [orgId, email, opts.canHash ? realHash : CANARY.hash, name, role, opts.active ?? true, CANARY.mfa, CANARY.rec],
    ))!.id,
  );
}
const roleOf = async (id: number) => (await one<{ role: string }>(`select role from users where id = $1`, [id]))!.role;
const mappedOf = async (orgId: number) => (await one<{ user_id: number }>(`select user_id from tenant_primary_owners where org_id = $1`, [orgId]))?.user_id ?? null;

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
/** Whether the customer's browser is still signed in (an ended session lands on /login). */
async function stillSignedIn(page: Page): Promise<boolean> {
  await page.goto("/dashboard");
  return !/\/login/.test(page.url());
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

// ---- layout audit (the PO-01B … PO-03B rules) -----------------------------------------------------------------------------
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
    if (text && scope && scope.contains(el) && !el.classList.contains("sr-only") && el.scrollWidth > el.clientWidth + 1 && !["auto", "scroll", "hidden"].includes(getComputedStyle(el).overflowX) && !["INPUT", "SELECT", "TEXTAREA", "BUTTON", "OPTION"].includes(el.tagName)) clipped.push(el.tagName + ": " + (el.textContent || "").trim().slice(0, 40));
  }
  return { h1: document.querySelectorAll("h1").length, lang: document.documentElement.lang, dir: document.documentElement.dir, theme: document.documentElement.dataset.theme || null, overflow: document.documentElement.scrollWidth - window.innerWidth, unnamed, unlabelled, orangeOffenders: offenders, clipped };
})()`;
const audit = async (page: Page) => (await page.evaluate(AUDIT_SCRIPT)) as AuditResult;
const auditOk = (a: AuditResult) => a.h1 === 1 && a.overflow <= 1 && a.unnamed.length === 0 && a.unlabelled.length === 0 && a.orangeOffenders.length === 0 && a.clipped.length === 0;
const auditText = (a: AuditResult) => JSON.stringify({ ...a, unnamed: a.unnamed.slice(0, 2), unlabelled: a.unlabelled.slice(0, 2), orangeOffenders: a.orangeOffenders.slice(0, 2), clipped: a.clipped.slice(0, 3) });
/** The same audit inside an open dialog (it is portalled outside main, so its own overflow and labels are checked). */
const DIALOG_AUDIT = `(() => {
  const d = document.querySelector("[role=dialog]");
  if (!d) return { found: false };
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const labelled = (el) => (el.labels && el.labels.length) || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
  const unlabelled = [...d.querySelectorAll("input:not([type=hidden]), select, textarea")].filter((el) => visible(el) && !labelled(el)).length;
  const r = d.getBoundingClientRect();
  return { found: true, unlabelled, inside: r.left >= -1 && r.right <= window.innerWidth + 1, overflow: document.documentElement.scrollWidth - window.innerWidth };
})()`;
const dialogAudit = async (page: Page) => (await page.evaluate(DIALOG_AUDIT)) as { found: boolean; unlabelled?: number; inside?: boolean; overflow?: number };
const shots: string[] = [];
/** Full-page by default; `viewport` for an open dialog (a full-page capture re-lays fixed layers out of place). */
async function shot(page: Page, name: string, mode: "full" | "viewport" = "full") {
  if (!SHOTS) return;
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await sleep(150);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: mode === "full" });
  shots.push(name);
}
const focusInDialog = (page: Page) => page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"));

// ---- direct POSTs to the build's own server actions (ids from its manifest) -----------------------------------------------
const actionIdOf = await loadActionIds();
async function postAction(path: string, name: string, args: unknown[], cookie: string, origin = A.url): Promise<{ status: number; text: string; location: string }> {
  const id = actionIdOf(name);
  if (!id) throw new Error(`server action ${name} is not in the build manifest`);
  const res = await fetch(`${A.url}${path}`, {
    method: "POST",
    headers: { "next-action": id, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", origin, cookie, "x-forwarded-for": nextIp() },
    body: JSON.stringify(args),
    redirect: "manual",
  });
  return { status: res.status, text: await res.text(), location: res.headers.get("location") ?? "" };
}
/** A request without a usable platform session ends at the sign-in page (the proxy's redirect or the action's own). */
const toSignIn = (r: { status: number; text: string; location: string }) => (r.status >= 300 && r.status < 400 && /\/platform\/login/.test(r.location)) || /\/platform\/login/.test(r.text);
/** Polls a condition (a refreshed server component settles asynchronously). */
async function eventually(cond: () => Promise<boolean>, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond().catch(() => false)) return true;
    await sleep(200);
  }
  return false;
}
const versionIn = (text: string) => /"version":"([0-9T:.\-]+)"/.exec(text)?.[1] ?? "";

async function main() {
  browser = await chromium.launch({ executablePath: process.env.PO01B_CHROMIUM || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  A = await startServer(PORT, { ...secrets, DATABASE_URL: process.env.DATABASE_URL, PLATFORM_CONSOLE_ENABLED: "true", PLATFORM_TRUSTED_PROXY_HOPS: "1", PLATFORM_INVITATIONS_ENABLED: undefined, CUSTOMER_INVITE_ACCEPTANCE_ENABLED: undefined, TENANT_ACCESS_ENFORCEMENT: "enabled" });

  const operator = await createAdmin("operator");
  const second = await createAdmin("second");
  // A company with a mapped primary owner, a second owner, an admin, a staff member and a disabled member.
  const T = await newOrg("Al-Noor Fictional Logistics");
  const fatimah = await addUser(T, "Fatimah Fictional", "fatimah.owner@alnoor-fixture.test", "owner", { canHash: true });
  const noura = await addUser(T, "Noura Fictional", "noura.owner@alnoor-fixture.test", "owner");
  const omar = await addUser(T, "Omar Fictional", "omar.admin@alnoor-fixture.test", "admin");
  const khalid = await addUser(T, "Khalid Fictional", "khalid.staff@alnoor-fixture.test", "staff", { canHash: true });
  const layla = await addUser(T, "Layla Fictional", "layla.staff@alnoor-fixture.test", "staff", { active: false });
  await q(`insert into tenant_primary_owners (org_id, user_id) values ($1, $2)`, [T, fatimah]);
  // A legacy company (no mapping): its single owner is the last active owner.
  const L = await newOrg("Fictional Heritage Traders");
  const huda = await addUser(L, "Huda Fictional", "huda.owner@heritage-fixture.test", "owner");
  const sara = await addUser(L, "Sara Fictional", "sara.staff@heritage-fixture.test", "staff");
  // A session row with a canary token hash and user agent (must never reach any page).
  await q(`insert into sessions (org_id, user_id, token_hash, user_agent, ip_address, expires_at) values ($1, $2, $3, $4, '192.0.2.71', now() + interval '30 days')`, [T, omar, CANARY.tokenHash, CANARY.agent]);

  const ctx = await newContext();
  const page = await platformSignIn(ctx, operator);
  const platformCookie = (await ctx.cookies()).find((c) => c.name === PLATFORM_COOKIE)!;
  const cookie = `${PLATFORM_COOKIE}=${platformCookie.value}`;
  const dialog = page.getByRole("dialog");
  const consoleHeaders = () => new Headers({ host: new URL(A.url).host, origin: A.url, "sec-fetch-site": "same-origin", "user-agent": "verify-roles-browser", "x-forwarded-for": nextIp() });
  const r2 = await console_.signInCore({ email: second.email, password: OPERATOR_PASSWORD, totpCode: await freshCode(second) }, { headers: consoleHeaders() });
  const secondReq = () => ({ headers: consoleHeaders(), token: r2.ok ? r2.token : "" });

  // ============================================================================================================
  section("R1 Change a role");
  const kctx = await newContext();
  const kh = await customerSignIn(kctx, "khalid.staff@alnoor-fixture.test");
  await go(page, `/platform/users/${khalid}`);
  const roleControl = page.getByTestId("user-role-control");
  ok("R1 a staff member's page offers Change role next to the account controls (enabled, no protection note)", kh.ok && (await roleControl.isEnabled()) && (await page.getByTestId("user-role-note").count()) === 0 && (await page.getByTestId("user-status-control").count()) === 1);
  await roleControl.click();
  await dialog.getByLabel("Reason").waitFor({ timeout: 15_000 });
  // The form is enabled once the dialog has re-read the account's current state.
  const formReady = await eventually(() => dialog.getByLabel("Reason").isEnabled());
  const options = dialog.getByTestId("user-role-options");
  const staffRadio = options.getByRole("radio", { name: "Staff (current)" });
  ok("R1 the dialog lists exactly the three ERP roles; the current one is marked and cannot be chosen; focus is inside the dialog", formReady && (await options.getByRole("radio").count()) === 3 && (await staffRadio.isDisabled()) && (await options.getByRole("radio", { name: "Owner", exact: true }).isEnabled()) && (await options.getByRole("radio", { name: "Admin", exact: true }).isEnabled()) && (await focusInDialog(page)));
  ok("R1 …before a role is chosen the effects say so, and say the sessions end and the primary owner doesn't change", /Choose the new role to see exactly what changes/.test(await dialog.innerText()) && /sessions end at once/.test(await dialog.innerText()) && /primary-owner designation doesn't change/.test(await dialog.innerText()));
  await dialog.getByRole("button", { name: "Change role" }).click();
  const emptyText = await dialog.innerText();
  ok("R1 submitting empty shows the role, reason and code errors (nothing is sent)", /Choose a role other than the current one/.test(emptyText) && /Enter a reason of 10 to 500 characters/.test(emptyText) && /Enter the 6-digit code/.test(emptyText));
  await options.getByRole("radio", { name: "Admin", exact: true }).check();
  ok("R1 …choosing Admin states the exact change (Staff → Admin)", /The role changes from Staff to Admin\./.test(await dialog.innerText()));
  await dialog.getByLabel("Reason").fill(REASON);
  await dialog.getByLabel("Verification code").fill("000000");
  await dialog.getByRole("button", { name: "Change role" }).click();
  await dialog.getByText(/incorrect or has already been used/).waitFor({ timeout: 15_000 });
  ok("R1 a wrong code is refused with a clear message, the code field is cleared, and the role is unchanged", (await dialog.getByLabel("Verification code").inputValue()) === "" && (await roleOf(khalid)) === "staff");
  await shot(page, "40-role-dialog-en-light-1440", "viewport");
  await dialog.getByLabel("Verification code").fill(await freshCode(operator));
  await dialog.getByRole("button", { name: "Change role" }).click();
  await dialog.getByText(/The role is now Admin\. Sessions ended: 1\./).waitFor({ timeout: 15_000 });
  await shot(page, "41-role-dialog-done-en-light-1440", "viewport");
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.getByText("This user has no active sessions.").waitFor({ timeout: 15_000 });
  ok("R1 …success: the result is reported, the page refreshes (role Admin) and the customer's own browser is signed out", (await roleOf(khalid)) === "admin" && /Role Admin/.test(plain(await page.locator("main").innerText())) && !(await stillSignedIn(kh.page)));
  const roleEvents = (await q<{ action: string; after_safe: Record<string, unknown> }>(`select action, after_safe from platform_audit_events where entity_type = 'customer_user' and entity_id = $1 and result = 'success' and action <> 'customer_user.viewed' order by id`, [String(khalid)])).map((r) => `${r.action}:${r.after_safe?.role}`);
  await page.reload();
  await page.locator("h1").waitFor();
  ok("R1 …the platform audit holds customer_user.role_changed (to admin) and the page's activity lists it in the operator's language", JSON.stringify(roleEvents) === JSON.stringify(["customer_user.role_changed:admin"]) && /Changed the role/.test(await page.locator("main").innerText()), roleEvents.join(","));

  // ============================================================================================================
  section("R2 Protected owners");
  await go(page, `/platform/users/${fatimah}`);
  const fControl = page.getByTestId("user-role-control");
  ok("R2 the primary owner's Change role is disabled and says why (transfer first); the note is visible", (await fControl.isDisabled()) && /keeps the owner role/.test((await fControl.getAttribute("aria-label")) ?? "") && (await page.getByTestId("user-role-note").isVisible()));
  await shot(page, "42-primary-owner-role-protected-en-light-1440");
  const fState = await postAction(`/platform/users/${fatimah}`, "readCustomerUserRoleStateAction", [String(fatimah)], cookie);
  const forced = await postAction(`/platform/users/${fatimah}`, "changeCustomerUserRoleAction", [{ userId: String(fatimah), orgId: String(T), role: "admin", reason: REASON, totpCode: await freshCode(operator), version: versionIn(fState.text) }], cookie);
  ok("R2 a direct server-action POST demoting the primary owner is refused by the server (LAST_PRIMARY_OWNER); the role is unchanged", versionIn(fState.text) !== "" && forced.text.includes("LAST_PRIMARY_OWNER") && (await roleOf(fatimah)) === "owner", `${forced.status}`);
  await go(page, `/platform/users/${huda}`);
  const hControl = page.getByTestId("user-role-control");
  ok("R2 a legacy company's last active owner: Change role is disabled and says why", (await hControl.isDisabled()) && /last active owner/.test((await hControl.getAttribute("aria-label")) ?? "") && (await page.getByTestId("user-role-note").isVisible()));

  // ============================================================================================================
  section("R3 A stale user page is told to refresh");
  await go(page, `/platform/users/${omar}`);
  const st = await controls.readCustomerUserRoleStateCore(secondReq(), String(omar));
  const changedElsewhere = st.ok ? await controls.changeCustomerUserRoleCore(secondReq(), { userId: String(omar), orgId: String(T), role: "staff", reason: REASON, totpCode: await freshCode(second), version: st.state.version }) : st;
  await page.getByTestId("user-role-control").click();
  await dialog.getByText(/This account changed after this page was loaded/).waitFor({ timeout: 15_000 });
  ok("R3 another operator changed the account after this page loaded: the dialog says so and offers Refresh (no form, no code asked)", changedElsewhere.ok && (await dialog.getByLabel("Verification code").count()) === 0);
  await dialog.getByRole("button", { name: "Refresh" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
  ok("R3 …after Refresh the page shows the newer role (Staff)", await eventually(async () => /Role Staff/.test(plain(await page.locator("main").innerText()))));

  // ============================================================================================================
  section("R4 Transfer the primary ownership");
  const fctx = await newContext();
  const fat = await customerSignIn(fctx, "fatimah.owner@alnoor-fixture.test");
  const kctx2 = await newContext();
  const kh2 = await customerSignIn(kctx2, "khalid.staff@alnoor-fixture.test");
  await go(page, `/platform/companies/${T}?tab=users`);
  const panel = page.getByTestId("company-primary-owner");
  ok("R4 the company's Users tab has a Primary owner panel with an enabled Transfer primary ownership control and its explanation", fat.ok && kh2.ok && (await panel.getByTestId("company-transfer-control").isEnabled()) && /can't be disabled or lose the owner role/.test(await panel.innerText()));
  await shot(page, "43-company-primary-owner-en-light-1440");
  await panel.getByTestId("company-transfer-control").click();
  await dialog.getByTestId("transfer-current-owner").waitFor({ timeout: 15_000 });
  const current = plain(await dialog.getByTestId("transfer-current-owner").innerText());
  const optionTexts = (await dialog.getByTestId("transfer-target").locator("option").allInnerTexts()).map(plain);
  ok("R4 the dialog shows the CURRENT primary owner (name, e-mail, role) before anything else", /Fatimah Fictional/.test(current) && /fatimah\.owner@alnoor-fixture\.test/.test(current) && /Owner/.test(current), current);
  ok("R4 …the candidates are the company's ACTIVE users other than the primary owner (Noura, Omar, Khalid — never the disabled Layla or another company's user)", optionTexts.length === 4 && optionTexts.slice(1).every((t) => /Noura|Omar|Khalid/.test(t)) && !optionTexts.some((t) => /Layla|Huda|Sara|Fatimah/.test(t)), optionTexts.join(" | "));
  ok("R4 …before choosing, the effects ask for a choice and state both accounts sign in again and nothing else changes", /Choose the new primary owner to see exactly what changes/.test(await dialog.innerText()) && /Both accounts are signed out everywhere/.test(await dialog.innerText()) && /No other user, no subscription and no business record changes/.test(await dialog.innerText()));
  await dialog.getByRole("button", { name: "Transfer ownership" }).click();
  ok("R4 submitting empty shows the choice, reason and code errors (nothing is sent)", /Choose the user who becomes the primary owner/.test(await dialog.innerText()) && /Enter a reason of 10 to 500 characters/.test(await dialog.innerText()) && (await mappedOf(T)) === fatimah);
  await dialog.getByTestId("transfer-target").selectOption(String(khalid));
  const effects = plain(await dialog.getByTestId("transfer-effects").innerText());
  ok("R4 …choosing Khalid states exactly what changes: Khalid becomes the primary owner (owner role); Fatimah becomes an admin", /Khalid Fictional becomes the company's primary owner, with the owner role/.test(effects) && /Fatimah Fictional becomes an admin/.test(effects), effects);
  await dialog.getByLabel("Reason").fill(REASON);
  await dialog.getByLabel("Verification code").fill(await freshCode(operator));
  ok("R4 …each field's error goes as soon as that field is corrected (no stale error beside a valid value)", !/Choose the user who becomes the primary owner|Enter a reason of 10 to 500 characters|Enter the 6-digit code/.test(await dialog.innerText()));
  await shot(page, "44-transfer-dialog-en-light-1440", "viewport");
  await dialog.getByRole("button", { name: "Transfer ownership" }).click();
  await dialog.getByText(/is now the primary owner\. Sessions ended: 2\./).waitFor({ timeout: 15_000 });
  await shot(page, "45-transfer-done-en-light-1440", "viewport");
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.getByTestId("company-primary-owner").waitFor();
  ok("R4 …success: the mapping names Khalid, who is an owner; Fatimah is an admin; Noura (another owner) is unchanged", (await mappedOf(T)) === khalid && (await roleOf(khalid)) === "owner" && (await roleOf(fatimah)) === "admin" && (await roleOf(noura)) === "owner");
  ok("R4 …BOTH customers' own browsers are signed out (they must sign in again)", !(await stillSignedIn(fat.page)) && !(await stillSignedIn(kh2.page)));
  await go(page, `/platform/companies/${T}?tab=users`);
  const seatsText = plain(await page.getByTestId("company-seats").innerText());
  await go(page, `/platform/companies/${T}?tab=activity`);
  ok("R4 …the Users & seats panel names the new primary owner and the company's activity lists the transfer", /Khalid Fictional/.test(seatsText) && /Transferred primary ownership/.test(await page.locator("main").innerText()), seatsText.slice(0, 200));
  await go(page, `/platform/users?org=${T}`);
  ok("R4 …the user directory moves the Primary owner tag to Khalid", (await page.getByTestId(`user-row-${khalid}`).getByText("Primary owner", { exact: true }).count()) === 1 && (await page.getByTestId(`user-row-${fatimah}`).getByText("Primary owner", { exact: true }).count()) === 0);

  // ============================================================================================================
  section("R5 A legacy company is Not designated");
  await go(page, `/platform/companies/${L}?tab=users`);
  const lPanel = page.getByTestId("company-primary-owner");
  const lControl = lPanel.getByTestId("company-transfer-control");
  ok("R5 the transfer control is disabled and the panel says Not designated (nothing inferred or assigned)", (await lControl.isDisabled()) && /Not designated/.test(await lPanel.innerText()) && /Nothing is inferred or assigned automatically/.test(await lPanel.innerText()));
  await shot(page, "46-legacy-not-designated-en-light-1440");
  const lForced = await postAction(`/platform/companies/${L}`, "transferPrimaryOwnerAction", [{ orgId: String(L), fromUserId: String(huda), toUserId: String(sara), fromVersion: "2026-01-01T00:00:00.000000", toVersion: "2026-01-01T00:00:00.000000", reason: REASON, totpCode: await freshCode(operator) }], cookie);
  ok("R5 a direct server-action POST transferring a legacy company is refused (OWNER_NOT_DESIGNATED); no mapping is created and no role changes", lForced.text.includes("OWNER_NOT_DESIGNATED") && (await mappedOf(L)) === null && (await roleOf(sara)) === "staff" && (await roleOf(huda)) === "owner", `${lForced.status}`);

  // ============================================================================================================
  section("R6 A stale company page is told to refresh");
  await go(page, `/platform/companies/${T}?tab=users`);
  const opts = await controls.readPrimaryOwnerTransferOptionsCore(secondReq(), String(T));
  const target = opts.ok ? opts.options.candidates.find((c) => c.userId === noura) : undefined;
  const moved = opts.ok && opts.options.primaryOwner && target
    ? await controls.transferPrimaryOwnerCore(secondReq(), { orgId: String(T), fromUserId: String(opts.options.primaryOwner.userId), toUserId: String(noura), fromVersion: opts.options.primaryOwner.version, toVersion: target.version, reason: REASON, totpCode: await freshCode(second) })
    : { ok: false as const, code: "SETUP" };
  await page.getByTestId("company-transfer-control").click();
  await dialog.getByText(/The company's owners changed after this page was loaded/).waitFor({ timeout: 15_000 });
  ok("R6 another operator transferred the ownership after this page loaded: the dialog says so and offers Refresh (no form, no code asked)", moved.ok && (await dialog.getByLabel("Verification code").count()) === 0);
  await dialog.getByRole("button", { name: "Refresh" }).click();
  await page.getByTestId("company-seats").getByText("Noura Fictional").waitFor({ timeout: 15_000 });
  ok("R6 …after Refresh the page names the newer primary owner (Noura)", (await mappedOf(T)) === noura);

  // ============================================================================================================
  section("R7 English / Arabic × light / dark × 1440 / 1024 / 768 / 390 / 360");
  const widths = [1440, 1024, 768, 390, 360];
  const matrix: string[] = [];
  for (const locale of ["en", "ar"] as const) {
    for (const theme of ["light", "dark"] as const) {
      await setPrefs(ctx, { locale, theme });
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        for (const path of [`/platform/users/${omar}`, `/platform/companies/${T}?tab=users`]) {
          await go(page, path);
          const a = await audit(page);
          const good = auditOk(a) && a.lang === locale && a.dir === (locale === "ar" ? "rtl" : "ltr") && a.theme === theme;
          if (!good) matrix.push(`${locale}/${theme}/${width} ${path}: ${auditText(a)}`);
        }
        if ((width === 1440 || width === 390) && !(locale === "en" && theme === "light" && width === 1440)) {
          // On a phone the panels sit below the fold: scroll the one shown into view for a viewport capture.
          await go(page, `/platform/users/${omar}`);
          if (width === 390) await page.getByTestId("user-controls").scrollIntoViewIfNeeded();
          await shot(page, `50-user-controls-${locale}-${theme}-${width}`, width === 390 ? "viewport" : "full");
          await go(page, `/platform/companies/${T}?tab=users`);
          if (width === 390) await page.getByTestId("company-primary-owner").scrollIntoViewIfNeeded();
          await shot(page, `51-company-primary-owner-${locale}-${theme}-${width}`, width === 390 ? "viewport" : "full");
        }
      }
    }
  }
  ok("R7 every combination: one h1, no horizontal overflow, every control named, every field labelled, white text on orange, nothing clipped; lang / dir / theme as chosen", matrix.length === 0, matrix.slice(0, 3).join(" | "));
  await setPrefs(ctx, { locale: "ar", theme: "dark" });
  await page.setViewportSize({ width: 390, height: 860 });
  await go(page, `/platform/users/${omar}`);
  await page.getByTestId("user-role-control").click();
  await dialog.getByLabel("السبب").waitFor({ timeout: 15_000 });
  const arRole = await dialog.innerText();
  const arRoleAudit = await dialogAudit(page);
  ok("R7 the Arabic role dialog on a phone (bottom sheet, dark): Arabic text and role names, fields labelled, inside the screen, focus inside", /تغيير دور/.test(arRole) && /الدور الجديد/.test(arRole) && /موظف \(الحالي\)/.test(arRole) && arRoleAudit.found && arRoleAudit.unlabelled === 0 && arRoleAudit.inside === true && (arRoleAudit.overflow ?? 9) <= 1 && (await focusInDialog(page)), JSON.stringify(arRoleAudit));
  await shot(page, "52-role-dialog-ar-dark-390", "viewport");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
  ok("R7 Escape closes the dialog and focus returns to Change role", await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "user-role-control"));
  await go(page, `/platform/companies/${T}?tab=users`);
  await page.getByTestId("company-transfer-control").click();
  await dialog.getByTestId("transfer-current-owner").waitFor({ timeout: 15_000 });
  await dialog.getByTestId("transfer-target").selectOption(String(omar));
  const arTransfer = await dialog.innerText();
  const arTransferAudit = await dialogAudit(page);
  ok("R7 the Arabic transfer dialog on a phone: current and new owner, the effects in Arabic, fields labelled, inside the screen", /نقل الملكية الرئيسية/.test(arTransfer) && /المالك الرئيسي الحالي/.test(arTransfer) && /يصبح/.test(arTransfer) && /يُسجَّل خروج الحسابين/.test(arTransfer) && arTransferAudit.found && arTransferAudit.unlabelled === 0 && arTransferAudit.inside === true && (arTransferAudit.overflow ?? 9) <= 1, JSON.stringify(arTransferAudit));
  await shot(page, "53-transfer-dialog-ar-dark-390", "viewport");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
  await setPrefs(ctx, { locale: "ar", theme: "light" });
  await page.setViewportSize({ width: 360, height: 800 });
  await go(page, `/platform/companies/${L}?tab=users`);
  ok("R7 the Arabic legacy company at 360: غير معيّن, the control disabled", /غير معيّن/.test(await page.getByTestId("company-primary-owner").innerText()) && (await page.getByTestId("company-transfer-control").isDisabled()));
  await page.getByTestId("company-primary-owner").scrollIntoViewIfNeeded();
  await shot(page, "54-legacy-not-designated-ar-light-360", "viewport");
  await setPrefs(ctx, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });

  // ============================================================================================================
  section("R8 Payloads hold no secret; direct POSTs are authorized on their own");
  const userPage = await payloads(page, `/platform/users/${omar}`);
  const companyPage = await payloads(page, `/platform/companies/${T}?tab=users`);
  const optionsPost = await postAction(`/platform/companies/${T}`, "readPrimaryOwnerTransferOptionsAction", [String(T)], cookie);
  const statePost = await postAction(`/platform/users/${omar}`, "readCustomerUserRoleStateAction", [String(omar)], cookie);
  ok("R8 the user page, the company page and both dialog reads hold no password hash, MFA or recovery envelope, session hash or user agent (canaries) and no bcrypt-shaped string",
    [userPage.html, userPage.rsc, companyPage.html, companyPage.rsc, optionsPost.text, statePost.text].every((t) => leaksIn(t).length === 0) && /Omar Fictional/.test(userPage.html) && /Khalid Fictional/.test(optionsPost.text),
    [userPage.html, userPage.rsc, companyPage.html, companyPage.rsc, optionsPost.text, statePost.text].flatMap(leaksIn).join(","));
  ok("R8 …the transfer options carry only id, name, e-mail, role and change marker per user (no status flag, session or MFA field)", !/"isActive"|"mfaEnabled"|"liveSessions"|"lastLoginAt"/.test(optionsPost.text) && /"version":"/.test(optionsPost.text));
  const anon = await postAction(`/platform/users/${khalid}`, "changeCustomerUserRoleAction", [{ userId: String(khalid), orgId: String(T), role: "staff", reason: REASON, totpCode: "123456", version: "2026-01-01T00:00:00.000000" }], "");
  const cross = await postAction(`/platform/users/${khalid}`, "changeCustomerUserRoleAction", [{ userId: String(khalid), orgId: String(T), role: "staff", reason: REASON, totpCode: await freshCode(operator), version: "2026-01-01T00:00:00.000000" }], cookie, "https://evil.example");
  const extra = await postAction(`/platform/users/${khalid}`, "changeCustomerUserRoleAction", [{ userId: String(khalid), orgId: String(T), role: "staff", reason: REASON, totpCode: "123456", version: "2026-01-01T00:00:00.000000", isActive: false }], cookie);
  const badRole = await postAction(`/platform/users/${khalid}`, "changeCustomerUserRoleAction", [{ userId: String(khalid), orgId: String(T), role: "superadmin", reason: REASON, totpCode: "123456", version: "2026-01-01T00:00:00.000000" }], cookie);
  const anonTransfer = await postAction(`/platform/companies/${T}`, "transferPrimaryOwnerAction", [{ orgId: String(T), fromUserId: String(noura), toUserId: String(omar), fromVersion: "x", toVersion: "x", reason: REASON, totpCode: "123456" }], "");
  // (Khalid is an admin here: R6 moved the primary ownership from him to Noura, and a previous primary owner becomes admin.)
  ok("R8 no platform cookie → sent to sign-in; a cross-site POST → refused; an unexpected field or an unknown role → VALIDATION_FAILED; nothing changed",
    toSignIn(anon) && toSignIn(anonTransfer) && (cross.status >= 400 || /FORBIDDEN/.test(cross.text)) && /VALIDATION_FAILED/.test(extra.text) && /VALIDATION_FAILED/.test(badRole.text) && (await roleOf(khalid)) === "admin" && (await mappedOf(T)) === noura,
    `${anon.status}→${anon.location.replace(/^https?:\/\/[^/]+/, "")} ${anonTransfer.status} ${cross.status} ${extra.status}:${/VALIDATION_FAILED/.test(extra.text)} ${badRole.status}:${/VALIDATION_FAILED/.test(badRole.text)}`);
  void layla;

  await ctx.close();
  for (const c of [kctx, kctx2, fctx]) await c.close().catch(() => undefined);
  if (SHOTS) console.log(`screenshots: ${shots.length}`);
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-roles-browser");
} catch (e) {
  ok("suite ran to completion", false, describeError(e));
  exitCode = summary("verify:platform-roles-browser");
} finally {
  await browser?.close().catch(() => undefined);
  await A?.stop().catch(() => undefined);
  await pool.end().catch(() => undefined);
  if (created && !process.env.PLATFORM_TEST_KEEP_DATABASES) await dropDisposableDatabase(testDbName).catch(() => undefined);
}
process.exit(exitCode);
