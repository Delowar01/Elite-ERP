/**
 * Platform Owner PO-02C — browser and HTTP suite for company access: the production build (`next build`
 * first) served by `next start` on loopback, driven in Chromium and by raw HTTP requests.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *   PO02C_SCREENSHOT_DIR=<optional output dir> npm run verify:platform-company-access-browser
 *
 * Server A runs with PLATFORM_CONSOLE_ENABLED=true and TENANT_ACCESS_ENFORCEMENT=enabled, server B with
 * the console on and enforcement OFF. Both use the test-only fake storage driver (a temporary directory,
 * removed at the end). One disposable database (dropped at the end) holds fictional companies, users and
 * operators; TEST-ONLY secrets are generated in memory and never printed. Chromium is the pre-installed
 * build (PO01B_CHROMIUM, default /opt/pw-browsers/chromium) — nothing is downloaded.
 *
 * Proves, over real HTTP: customer sign-in (active, suspended — generic before the password, the neutral
 * message after it, no session issued, no recovery code spent — and unavailable); an open browser session
 * of a suspended company lands on the access-suspended screen; a captured server-action POST replayed after
 * the suspension changes nothing; exports, the import template, print and PDF are refused before any lookup;
 * uploads by session and by VALID signature are refused (expired and tampered signatures too) with the
 * cache headers checked; jti-less tokens cannot bypass it; reactivation needs a fresh sign-in; the Platform
 * Owner dialog (validation, success, audit outage, concurrent change, enforcement off, focus, mobile sheet);
 * and EN / AR × light / dark × 1440 / 1024 / 390 screenshots with layout audits.
 */
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, BrowserContext, Page, Request as PwRequest } from "playwright";
import { createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { section, ok, summary, describeError } from "./platform/harness";
import { startServer, testSecrets, type Server } from "./platform/browser-env";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");

const testDbName = disposableName("po02c_browser");
const secrets = testSecrets();
const STORAGE_DIR = mkdtempSync(join(tmpdir(), "po02c-test-only-storage-"));
process.env.DATABASE_URL = databaseUrlFor(testDbName);
Object.assign(process.env, secrets, { PLATFORM_CONSOLE_ENABLED: "true", PLATFORM_TRUSTED_PROXY_HOPS: "1", TENANT_ACCESS_ENFORCEMENT: "enabled", STORAGE_DRIVER: "fake", STORAGE_FAKE_DIR: STORAGE_DIR });

let created = false;
await createPlatformTestDatabase("po02c_browser", testDbName);
created = true;

const { db, pool, platformAdminsTable } = await import("../src/db");
const auth = await import("../src/lib/platform/auth");
const mfa = await import("../src/lib/platform/mfa");
const totp = await import("../src/lib/platform/totp");
const actions = await import("../src/lib/platform/company-access-actions");
const console_ = await import("../src/lib/platform/console");
const companies = await import("../src/lib/platform/companies");
const tenantAuth = await import("../src/lib/auth");
const { encryptField, decryptField } = await import("../src/lib/crypto/field-encryption");
const { signFileUrl } = await import("../src/lib/security/signed-url");
const { destinationStore } = await import("../src/lib/storage/blob-client");
const { seedOrgDefaults } = await import("../src/lib/seed-org");
const bcrypt = (await import("bcryptjs")).default;

const SHOTS = process.env.PO02C_SCREENSHOT_DIR || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PORT_A = Number(process.env.PO02C_PORT_A || 3437);
const PORT_B = Number(process.env.PO02C_PORT_B || 3438);
const PASSWORD = "Juniper-Compass-62!k";
const CUSTOMER_PASSWORD = "Saffron-Meadow-48!t";
const secretsSeen: string[] = [PASSWORD, CUSTOMER_PASSWORD, ...Object.values(secrets)];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Text as read, without the Unicode direction isolates the console puts around names and references. */
const plain = (s: string) => s.replace(/[\u2066-\u2069]/g, "");
const q = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
const CUSTOMER_COOKIE = "__Host-elite_erp_session";
const PLATFORM_COOKIE = "__Host-elite_erp_platform";

type Admin = { id: string; email: string; secret: string; lastStep: number; displayName: string };
async function createAdmin(email: string, displayName: string): Promise<Admin> {
  const { secret } = mfa.createTotpEnrollment(email);
  const { codes, hashes } = await mfa.createRecoveryCodeSet();
  const at = new Date();
  const [row] = await db
    .insert(platformAdminsTable)
    .values({ emailNormalized: email, displayName, passwordHash: await auth.hashPlatformPassword(PASSWORD), isActive: true, mfaSecretEncrypted: mfa.encryptTotpSecret(secret), mfaRecoveryHashes: hashes, mfaEnrolledAt: at, passwordChangedAt: at, createdAt: at, updatedAt: at })
    .returning({ id: platformAdminsTable.id });
  secretsSeen.push(secret, ...codes);
  return { id: row.id, email, secret, lastStep: 0, displayName };
}
/** A code for a time step this operator has not used yet (waits for the next step when needed — real time). */
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

let browser!: Browser;
let A!: Server;
let B!: Server;
const contexts: BrowserContext[] = [];
async function newContext(ip: string, server: Server, prefs: { locale: "en" | "ar"; theme: "light" | "dark" } = { locale: "en", theme: "light" }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ baseURL: server.url, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce", extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.addCookies([
    { name: "locale", value: prefs.locale, url: server.url },
    { name: "theme", value: prefs.theme, url: server.url },
  ]);
  contexts.push(ctx);
  return ctx;
}
async function setPrefs(ctx: BrowserContext, server: Server, prefs: { locale: "en" | "ar"; theme: "light" | "dark" }) {
  await ctx.addCookies([
    { name: "locale", value: prefs.locale, url: server.url },
    { name: "theme", value: prefs.theme, url: server.url },
  ]);
}
async function settled(page: Page) {
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 20_000 });
}
async function go(page: Page, path: string) {
  const res = await page.goto(path);
  await settled(page);
  return res;
}
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await sleep(150);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
}
async function platformSignIn(ctx: BrowserContext, a: Admin): Promise<Page> {
  const page = await ctx.newPage();
  await go(page, "/platform/login");
  await page.getByLabel("Email", { exact: true }).fill(a.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Verification code", { exact: true }).fill(await freshCode(a));
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await page.waitForURL("**/platform/dashboard", { timeout: 20_000 });
  const c = (await ctx.cookies()).find((x) => x.name === PLATFORM_COOKIE);
  if (c) secretsSeen.push(c.value);
  return page;
}
async function customerSignIn(ctx: BrowserContext, email: string, password = CUSTOMER_PASSWORD, mfaCode?: string): Promise<{ page: Page; error: string | null }> {
  const page = await ctx.newPage();
  await go(page, "/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator("form button[type=submit]").click();
  if (mfaCode) {
    await page.locator("#mfaCode").waitFor({ state: "visible", timeout: 15_000 });
    await page.locator("#mfaCode").fill(mfaCode);
    await page.locator("form button[type=submit]").click();
  }
  const outcome = await Promise.race([
    page.waitForURL("**/dashboard", { timeout: 20_000 }).then(() => "dashboard" as const),
    page.locator("form [role=alert], form .text-danger, form p.text-sm").first().waitFor({ state: "visible", timeout: 20_000 }).then(() => "error" as const),
  ]).catch(() => "timeout" as const);
  if (outcome === "dashboard") {
    const c = (await ctx.cookies()).find((x) => x.name === CUSTOMER_COOKIE);
    if (c) secretsSeen.push(c.value);
    return { page, error: null };
  }
  const text = (await page.locator("form").innerText().catch(() => "")).trim();
  return { page, error: text || outcome };
}
const customerCookie = async (ctx: BrowserContext) => (await ctx.cookies()).find((c) => c.name === CUSTOMER_COOKIE)?.value ?? null;
/** A raw HTTP GET (no redirect following) with an optional customer session cookie. */
async function get(path: string, cookie: string | null, server: Server = A) {
  const res = await fetch(`${server.url}${path}`, { redirect: "manual", headers: { ...(cookie ? { cookie: `${CUSTOMER_COOKIE}=${cookie}` } : {}), "x-forwarded-for": "198.51.100.90" } });
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, location: res.headers.get("location"), cacheControl: res.headers.get("cache-control"), contentType: res.headers.get("content-type"), body };
}

type AuditResult = { h1: number; lang: string; dir: string; theme: string | null; overflow: number; unnamed: string[]; unlabelled: string[]; storage: number };
const AUDIT_SCRIPT = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const name = (el) => (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").trim();
  const unnamed = [...document.querySelectorAll("button, a[href]")].filter((el) => visible(el) && !name(el)).map((el) => el.outerHTML.slice(0, 80));
  const labelled = (el) => (el.labels && el.labels.length) || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
  const unlabelled = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter((el) => visible(el) && !labelled(el)).map((el) => el.outerHTML.slice(0, 80));
  return { h1: document.querySelectorAll("h1").length, lang: document.documentElement.lang, dir: document.documentElement.dir, theme: document.documentElement.dataset.theme || null, overflow: document.documentElement.scrollWidth - window.innerWidth, unnamed, unlabelled, storage: localStorage.length + sessionStorage.length };
})()`;
const audit = async (page: Page) => (await page.evaluate(AUDIT_SCRIPT)) as AuditResult;
const auditOk = (a: AuditResult) => a.h1 === 1 && a.overflow <= 1 && a.unnamed.length === 0 && a.unlabelled.length === 0 && a.storage === 0;

async function auditOutage(on: boolean) {
  if (on) {
    await q(`create or replace function po02c_test_only_fail_audit() returns trigger language plpgsql as $$ begin raise exception 'injected audit outage (test only)'; end $$`);
    await q(`create trigger po02c_test_only_fail_audit before insert on platform_audit_events for each row execute function po02c_test_only_fail_audit()`);
  } else {
    await q(`drop trigger if exists po02c_test_only_fail_audit on platform_audit_events`);
    await q(`drop function if exists po02c_test_only_fail_audit()`);
  }
}

// ---- fictional customer companies -------------------------------------------------------------------
async function customerCompany(name: string): Promise<number> {
  const [o] = await q<{ id: number }>("insert into orgs (name, country, currency, base_currency_confirmed_at) values ($1, 'Saudi Arabia', 'SAR', now()) returning id", [name]);
  await db.transaction((tx) => seedOrgDefaults(tx, o.id, "Saudi Arabia"));
  return o.id;
}
async function customerUser(orgId: number, email: string, role = "owner", mfaSetup?: { secret: string; recovery: string[] }): Promise<number> {
  const hash = await tenantAuth.hashPassword(CUSTOMER_PASSWORD);
  const recovery = mfaSetup ? encryptField(JSON.stringify(await Promise.all(mfaSetup.recovery.map((c) => bcrypt.hash(c, 4))))) : null;
  const [u] = await q<{ id: number }>(
    "insert into users (org_id, email, password_hash, name, role, is_active, mfa_enabled, mfa_secret, mfa_recovery_codes) values ($1, $2, $3, $4, $5, true, $6, $7, $8) returning id",
    [orgId, email, hash, `Fixture ${email.split("@")[0]}`, role, !!mfaSetup, mfaSetup ? encryptField(mfaSetup.secret) : null, recovery],
  );
  return u.id;
}
const recoveryLeft = async (userId: number) => (JSON.parse(decryptField((await q<{ c: string }>("select mfa_recovery_codes as c from users where id = $1", [userId]))[0].c) ?? "[]") as string[]).length;
const clientsNamed = async (orgId: number, name: string) => Number((await q<{ n: number }>("select count(*)::int as n from customers where org_id = $1 and name = $2", [orgId, name]))[0].n);

async function main() {
  let signedInBystanderCookie: string | null = null;
  let bystanderCtx: BrowserContext | null = null;
  const owner = await createAdmin("owner@access-browser.test", "Test Operator");
  const ops = await createAdmin("ops@access-browser.test", "Background Operator");
  const STAMP = Date.now();
  const victim = await customerCompany("Saffron Fixture Trading Co");
  const vOwner = await customerUser(victim, "owner@saffron-fixture.test");
  const MFA_SECRET = "JBSWY3DPEHPK3PXP";
  const RECOVERY = ["RECOVER-ALPHA-11", "RECOVER-BRAVO-22"];
  secretsSeen.push(...RECOVERY);
  const vStaff = await customerUser(victim, "staff@saffron-fixture.test", "staff", { secret: MFA_SECRET, recovery: RECOVERY });
  const bystander = await customerCompany("Bystander Fixture Est");
  await customerUser(bystander, "owner@bystander-fixture.test");
  // Branding and attachment files in the (fake) private store.
  const store = destinationStore();
  const pngBytes = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
  const victimLogo = `organizations/${victim}/logos/${victim}-${STAMP}-${randomBytes(8).toString("hex")}.png`;
  const victimAttachment = `organizations/${victim}/attachments/${victim}-${STAMP}-${randomBytes(8).toString("hex")}.pdf`;
  const bystanderLogo = `organizations/${bystander}/logos/${bystander}-${STAMP}-${randomBytes(8).toString("hex")}.png`;
  await store.put(victimLogo, pngBytes, { contentType: "image/png" });
  await store.put(victimAttachment, Buffer.from("%PDF-1.4\n% fixture attachment (test only)\n"), { contentType: "application/pdf" });
  await store.put(bystanderLogo, pngBytes, { contentType: "image/png" });

  browser = await chromium.launch({ executablePath: process.env.PO01B_CHROMIUM || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const common = { ...secrets, DATABASE_URL: process.env.DATABASE_URL, PLATFORM_CONSOLE_ENABLED: "true", PLATFORM_TRUSTED_PROXY_HOPS: "1", STORAGE_DRIVER: "fake", STORAGE_FAKE_DIR: STORAGE_DIR };
  A = await startServer(PORT_A, { ...common, TENANT_ACCESS_ENFORCEMENT: "enabled" });
  B = await startServer(PORT_B, { ...common, TENANT_ACCESS_ENFORCEMENT: undefined });

  // Background changes are made through the same core as the console (with its own operator).
  let opsToken = "";
  const opsReq = () => ({ headers: new Headers({ host: "localhost", origin: "http://localhost", "sec-fetch-site": "same-origin", "user-agent": "po02c-browser-ops", "x-forwarded-for": "198.51.100.77" }), token: opsToken });
  const opsSignIn = async () => {
    const r = await console_.signInCore({ email: ops.email, password: PASSWORD, totpCode: await freshCode(ops) }, { headers: opsReq().headers });
    if (!r.ok) throw new Error(`ops sign-in failed: ${r.code}`);
    opsToken = r.token;
    secretsSeen.push(r.token);
  };
  const opsChange = async (orgId: number, target: "suspended" | "active", reason: string) =>
    actions.setCompanyAccessCore(opsReq(), { orgId: String(orgId), target, reference: companies.orgReference(orgId), reason, password: PASSWORD, totpCode: await freshCode(ops) });
  await opsSignIn();

  // ------------------------------------------------------------------------------------------------
  section("1. An active company works as before (customer sign-in, pages, server action, exports, files)");
  const cust = await newContext("198.51.100.41", A);
  const signedIn = await customerSignIn(cust, "owner@saffron-fixture.test");
  ok("an active company's user signs in to the dashboard", signedIn.error === null, signedIn.error ?? "");
  const cookie = await customerCookie(cust);
  ok("…the session cookie is issued", !!cookie);
  // Capture a real server-action POST (create a client) while the company is active.
  const cpage = signedIn.page;
  await go(cpage, "/clients/new");
  let captured: PwRequest | null = null;
  const onRequest = (r: PwRequest) => {
    if (r.method() === "POST" && r.headers()["next-action"]) captured = r;
  };
  cpage.on("request", onRequest);
  await cpage.locator("#name").fill("Fixture Client Before Suspension");
  await cpage.locator("form button[type=submit]").first().click();
  await cpage.waitForURL(/\/clients\/\d+$/, { timeout: 20_000 }).catch(() => undefined);
  cpage.off("request", onRequest);
  const capturedReq = captured as PwRequest | null;
  ok("a client is created through the real form (server action), and its POST is captured for a replay", (await clientsNamed(victim, "Fixture Client Before Suspension")) === 1 && !!capturedReq, `captured=${!!capturedReq}`);
  const exportBefore = await get("/documents/export?module=quotation&format=csv", cookie);
  const templateBefore = await get("/api/import-template/client?format=csv", cookie);
  const printBefore = await get("/print/quotation/999999", cookie);
  const pdfBefore = await get("/api/document-pdf/quotation/999999", cookie);
  ok("exports and the import template are served (200)", exportBefore.status === 200 && templateBefore.status === 200, `${exportBefore.status}/${templateBefore.status}`);
  ok("print and PDF reach the document lookup (an unknown document → 404 'not found')", printBefore.status === 404 && pdfBefore.status === 404, `${printBefore.status}/${pdfBefore.status}`);
  const fileBySession = await get(`/uploads/${victimAttachment}`, cookie);
  const signedLogo = signFileUrl(victimLogo, 600);
  const fileBySignature = await get(signedLogo, null);
  const bystanderSigned = signFileUrl(bystanderLogo, 600);
  const sessionMaxAge = Number((fileBySession.cacheControl ?? "").match(/max-age=(\d+)/)?.[1] ?? -1);
  const signedMaxAge = Number((fileBySignature.cacheControl ?? "").match(/max-age=(\d+)/)?.[1] ?? -1);
  ok("an attachment is served to its company's session (private, max-age=3600)", fileBySession.status === 200 && fileBySession.cacheControl === "private, max-age=3600", `${fileBySession.status} ${fileBySession.cacheControl}`);
  ok("a branding file is served for a VALID signature without a session (private; max-age capped at the signature's remaining validity)", fileBySignature.status === 200 && /^private, max-age=\d+$/.test(fileBySignature.cacheControl ?? "") && signedMaxAge > 0 && signedMaxAge <= 600 && sessionMaxAge === 3600, `${fileBySignature.status} ${fileBySignature.cacheControl}`);
  const legacyToken = await tenantAuth.signSessionToken({ userId: vOwner, orgId: victim });
  secretsSeen.push(legacyToken);
  const legacyBefore = await get("/dashboard", legacyToken);
  ok("a legacy jti-less token of an active company still works (200)", legacyBefore.status === 200, String(legacyBefore.status));

  // ------------------------------------------------------------------------------------------------
  section("2. The Platform Owner suspends the company through the console dialog");
  const pctx = await newContext("198.51.100.40", A);
  const ppage = await platformSignIn(pctx, owner);
  await go(ppage, `/platform/companies/${victim}?tab=access`);
  const panel = ppage.getByRole("tabpanel");
  const trigger = panel.getByRole("button", { name: "Suspend company", exact: true });
  ok("the Access tab offers an ENABLED Suspend control (and the header one)", (await trigger.isEnabled()) && (await ppage.getByRole("button", { name: "Suspend company", exact: true }).count()) === 2);
  await trigger.click();
  const dialog = ppage.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  const ref = ppage.locator(`#access-ref-${victim}`);
  await ref.waitFor({ state: "visible" });
  await ppage.waitForFunction((id) => !(document.getElementById(id) as HTMLInputElement | null)?.disabled, `access-ref-${victim}`, { timeout: 10_000 });
  const dialogText = plain(await dialog.innerText());
  ok("the dialog explains every consequence: users lose access at once, sign-ins refused, records kept, subscription unchanged, fresh sign-in after reactivation",
    ["All users of this company are signed out and lose access at once.", "New sign-ins are refused until access is reactivated.", "No record is deleted or changed", "The subscription is not changed.", "After reactivation, every user signs in again."].every((t) => dialogText.includes(t)));
  const modal = await ppage.evaluate(() => {
    const d = document.querySelector("[role=dialog]");
    const title = d?.getAttribute("aria-labelledby") ? document.getElementById(d.getAttribute("aria-labelledby") ?? "")?.textContent ?? "" : "";
    const described = !!(d?.getAttribute("aria-describedby") && document.getElementById(d.getAttribute("aria-describedby") ?? ""));
    const header = document.querySelector("header");
    const hiddenOutside = !!header && (header.closest("[aria-hidden=true]") !== null || header.closest("[inert]") !== null);
    return { title, described, hiddenOutside };
  });
  ok("…it is a labelled modal: role=dialog titled with the company (aria-labelledby), described, the page behind hidden from assistive technology, the reference to type",
    plain(modal.title) === "Suspend access for Saffron Fixture Trading Co?" && modal.title.includes("\u2068Saffron Fixture Trading Co\u2069") && modal.described && modal.hiddenOutside && dialogText.includes(`Type ${companies.orgReference(victim)} to confirm`), JSON.stringify(modal));
  ok("…focus moved into the dialog", await ppage.evaluate(() => !!document.activeElement?.closest("[role=dialog]")));
  let trapped = true;
  for (let i = 0; i < 14; i++) {
    await ppage.keyboard.press("Tab");
    trapped = trapped && (await ppage.evaluate(() => !!document.activeElement?.closest("[role=dialog]")));
  }
  ok("…Tab cycles inside the dialog (focus trap)", trapped);
  await shot(ppage, "50-suspend-dialog-en-light-1440");
  // Validation: nothing typed.
  const posts: PwRequest[] = [];
  const onPost = (r: PwRequest) => {
    if (r.method() === "POST") posts.push(r);
  };
  ppage.on("request", onPost);
  await dialog.getByRole("button", { name: "Suspend access" }).click();
  await sleep(300);
  const errText = await dialog.innerText();
  ok("submitting an empty form shows the reference, reason and step-up errors and sends NO request", errText.includes("Type the company reference exactly as shown.") && errText.includes("Enter a reason of 10 to 500 characters.") && errText.includes("Enter the 6-digit code from your authenticator app.") && posts.length === 0, `${posts.length} posts`);
  ok("…each invalid field is marked aria-invalid", (await ref.getAttribute("aria-invalid")) === "true" && (await ppage.locator(`#access-reason-${victim}`).getAttribute("aria-invalid")) === "true");
  await shot(ppage, "51-suspend-dialog-validation-en-light-1440");
  // Wrong reference but otherwise valid.
  await ref.fill(companies.orgReference(bystander));
  await ppage.locator(`#access-reason-${victim}`).fill("Fixture: overdue invoices, access paused");
  await ppage.locator(`#access-password-${victim}`).fill(PASSWORD);
  await ppage.locator(`#access-totp-${victim}`).fill("123456");
  await dialog.getByRole("button", { name: "Suspend access" }).click();
  await sleep(300);
  ok("another company's reference is refused in the browser too (no request)", (await dialog.innerText()).includes("Type the company reference exactly as shown.") && posts.length === 0);
  // Wrong password → server error, fields cleared. (The code is not consumed by a password failure, so it is reused below.)
  const stepUpCode = await freshCode(owner);
  await ref.fill(companies.orgReference(victim));
  await ppage.locator(`#access-password-${victim}`).fill("Wrong-Password-11!x");
  await ppage.locator(`#access-totp-${victim}`).fill(stepUpCode);
  await dialog.getByRole("button", { name: "Suspend access" }).click();
  await dialog.getByText("The email or password is incorrect.").waitFor({ timeout: 15_000 });
  ok("a wrong password: the server refuses (INVALID_CREDENTIALS message), password and code are cleared, nothing changed", (await ppage.locator(`#access-password-${victim}`).inputValue()) === "" && (await ppage.locator(`#access-totp-${victim}`).inputValue()) === "" && (await q("select 1 from tenant_access_controls where org_id = $1", [victim])).length === 0);
  // Correct.
  await ppage.locator(`#access-password-${victim}`).fill(PASSWORD);
  await ppage.locator(`#access-totp-${victim}`).fill(stepUpCode);
  await dialog.getByRole("button", { name: "Suspend access" }).click();
  await dialog.getByText(/Access suspended\. Active sessions ended: \d+\./).waitFor({ timeout: 20_000 });
  ppage.off("request", onPost);
  const ended = Number(((await dialog.innerText()).match(/Active sessions ended: (\d+)/) ?? [])[1] ?? -1);
  ok("success: the dialog reports the suspension and the number of sessions ended — and keeps its own title while the page behind refreshes to Suspended", ended >= 1 && plain(await dialog.getByRole("heading").first().innerText()) === "Suspend access for Saffron Fixture Trading Co?", String(ended));
  await shot(ppage, "52-suspend-dialog-success-en-light-1440");
  await dialog.getByRole("button", { name: "Done" }).click();
  await dialog.waitFor({ state: "hidden" });
  await ppage.getByRole("tabpanel").getByRole("button", { name: "Reactivate company", exact: true }).waitFor({ timeout: 15_000 });
  const panelText = await ppage.getByRole("tabpanel").innerText();
  ok("…after Done the page shows the new state: Suspended, the reason, the operator, and Reactivate in place of Suspend", panelText.includes("Suspended") && panelText.includes("Fixture: overdue invoices, access paused") && panelText.includes(owner.displayName));
  await ppage.getByRole("tab", { name: "Activity" }).click();
  await ppage.getByRole("cell", { name: "Suspended company access" }).first().waitFor({ timeout: 10_000 });
  ok("…the Activity tab lists the suspension (and the refused wrong-password attempt)", (await ppage.getByRole("cell", { name: "Suspended company access" }).count()) === 1 && (await ppage.getByRole("cell", { name: "Suspension attempt refused" }).count()) >= 1);
  await shot(ppage, "53-company-activity-en-light-1440");

  // ------------------------------------------------------------------------------------------------
  section("3. The suspended company: open session, sign-in, server action, exports, print/PDF, files");
  {
    await go(cpage, "/dashboard");
    ok("the user's OPEN browser session lands on the access-suspended screen (no business content)", cpage.url().endsWith("/access-suspended") && (await cpage.locator("h1").innerText()).trim() === "Company access suspended");
    const body = await cpage.locator("body").innerText();
    ok("…it explains the state, shows no company data and no administrative note", body.includes("Nothing has been deleted.") && !body.includes("Saffron Fixture Trading Co") && !body.includes("overdue invoices") && !body.includes("Fixture Client Before Suspension"));
    const a = await audit(cpage);
    ok("…accessible: one h1, named controls, no overflow", auditOk(a), JSON.stringify(a).slice(0, 200));
    await shot(cpage, "60-access-suspended-en-light-1440");
    for (const path of ["/clients", "/finance/reports", "/settings/organization", `/clients/new`]) {
      const r = await get(path, cookie);
      ok(`GET ${path} with the open session → redirected to /access-suspended (no page served)`, r.status === 307 && r.location === "/access-suspended", `${r.status} ${r.location}`);
    }
    if (capturedReq) {
      const headers = { ...capturedReq.headers(), cookie: `${CUSTOMER_COOKIE}=${cookie}` };
      delete (headers as Record<string, string>)["content-length"];
      const replay = await fetch(capturedReq.url(), { method: "POST", headers, body: (() => { const b = capturedReq.postDataBuffer(); return b ? new Uint8Array(b) : undefined; })(), redirect: "manual" });
      const replayText = await replay.text();
      const redirectHeader = replay.headers.get("x-action-redirect") ?? replay.headers.get("location") ?? "";
      ok("the captured server-action POST replayed directly (same cookie, same body) creates NOTHING and is redirected to /access-suspended", (await clientsNamed(victim, "Fixture Client Before Suspension")) === 1 && /access-suspended/.test(redirectHeader + replayText.slice(0, 400)), `${replay.status} ${redirectHeader}`);
    }
    const exportAfter = await get("/documents/export?module=quotation&format=csv", cookie);
    const templateAfter = await get("/api/import-template/client?format=csv", cookie);
    const printAfter = await get("/print/quotation/999999", cookie);
    const pdfAfter = await get("/api/document-pdf/quotation/999999", cookie);
    const refusedNoData = (r: Awaited<ReturnType<typeof get>>) => r.status === 307 && r.location === "/access-suspended" && !/csv|pdf|spreadsheet|octet-stream/i.test(r.contentType ?? "") && !r.body.toString("utf8").includes("Field Guide");
    ok("export, import template, print and PDF are refused before any lookup (307 → /access-suspended; no file, no CSV, no PDF)", [exportAfter, templateAfter, printAfter, pdfAfter].every(refusedNoData), [exportAfter, templateAfter, printAfter, pdfAfter].map((r) => `${r.status} ${r.location} ${r.contentType}`).join(" / "));
    const fileS = await get(`/uploads/${victimAttachment}`, cookie);
    const fileSig = await get(signedLogo, null);
    const fileBystander = await get(bystanderSigned, null);
    ok("an attachment by session → 404", fileS.status === 404 && fileS.body.length < 20);
    ok("a branding file with a still-VALID signature → 404 while the company is suspended", fileSig.status === 404, String(fileSig.status));
    ok("…another company's signed file is still served", fileBystander.status === 200);
    const [path, query] = signedLogo.split("?");
    const params = new URLSearchParams(query);
    const tampered = await get(`${path}?exp=${params.get("exp")}&sig=${(params.get("sig") ?? "").slice(0, -2)}xx`, null);
    const expired = await get(`${path}?exp=${Math.floor(Date.now() / 1000) - 60}&sig=${params.get("sig")}`, null);
    ok("tampered and expired signatures → 404", tampered.status === 404 && expired.status === 404);
    const legacyAfter = await get("/dashboard", legacyToken);
    ok("a legacy jti-less token cannot bypass the suspension (→ /access-suspended)", legacyAfter.status === 307 && legacyAfter.location === "/access-suspended", `${legacyAfter.status} ${legacyAfter.location}`);

    // Sign-in attempts.
    const login = await newContext("198.51.100.42", A);
    const wrong = await customerSignIn(login, "owner@saffron-fixture.test", "Wrong-Password-99!z");
    ok("a wrong password for a suspended company → the generic error (nothing about the company)", (wrong.error ?? "").includes("Invalid email or password.") && !(wrong.error ?? "").includes("suspended"), wrong.error ?? "");
    const right = await customerSignIn(login, "owner@saffron-fixture.test");
    ok("the RIGHT password → the neutral suspended message, after the credentials were verified", (right.error ?? "").includes("Your company's access is suspended. Contact your service provider."), right.error ?? "");
    ok("…and no session cookie was issued", (await customerCookie(login)) === null);
    await shot(right.page, "61-login-suspended-en-light-1440");
    const before = await recoveryLeft(vStaff);
    const mfaUser = await customerSignIn(login, "staff@saffron-fixture.test", CUSTOMER_PASSWORD, RECOVERY[0]);
    ok("an MFA user signing in with a valid recovery code → the suspended message; the recovery code is NOT spent", (mfaUser.error ?? "").includes("Your company's access is suspended.") && (await recoveryLeft(vStaff)) === before && before === 2, `${mfaUser.error} / ${before}`);
    const ar = await newContext("198.51.100.43", A, { locale: "ar", theme: "dark" });
    const arRight = await customerSignIn(ar, "owner@saffron-fixture.test");
    ok("in Arabic the message is native Arabic, right to left", (arRight.error ?? "").includes("تم إيقاف وصول شركتك. يُرجى التواصل مع مزوّد الخدمة.") && (await arRight.page.evaluate(() => document.documentElement.dir)) === "rtl", arRight.error ?? "");
    await arRight.page.setViewportSize({ width: 390, height: 844 });
    await shot(arRight.page, "62-login-suspended-ar-dark-390");
    bystanderCtx = await newContext("198.51.100.44", A);
    const bystanderLogin = await customerSignIn(bystanderCtx, "owner@bystander-fixture.test");
    signedInBystanderCookie = await customerCookie(bystanderCtx);
    ok("another company's user still signs in normally", bystanderLogin.error === null && !!signedInBystanderCookie, bystanderLogin.error ?? "");
  }

  // ------------------------------------------------------------------------------------------------
  section("4. The access-suspended screen: EN / AR × light / dark × 1440 / 1024 / 390");
  {
    // The customer's own browser context (its session cookie is HttpOnly and __Host-, so it is not injected).
    const shotsCtx = cust;
    const p = await shotsCtx.newPage();
    const results: string[] = [];
    for (const locale of ["en", "ar"] as const)
      for (const theme of ["light", "dark"] as const)
        for (const [w, h] of [[1440, 900], [1024, 768], [390, 844]] as const) {
          await setPrefs(shotsCtx, A, { locale, theme });
          await p.setViewportSize({ width: w, height: h });
          await go(p, "/access-suspended");
          const a = await audit(p);
          const good = auditOk(a) && a.lang === locale && a.dir === (locale === "ar" ? "rtl" : "ltr") && (a.theme ?? "light") === theme;
          if (!good) results.push(`${locale}-${theme}-${w}: ${JSON.stringify(a).slice(0, 160)}`);
          await shot(p, `63-access-suspended-${locale}-${theme}-${w}`);
        }
    ok("12 combinations: one h1, correct lang / dir / theme, named controls, no horizontal overflow", results.length === 0, results.join(" | "));
    await setPrefs(shotsCtx, A, { locale: "en", theme: "light" });
    await p.setViewportSize({ width: 1440, height: 900 });
    await go(p, "/access-suspended");
    await p.getByRole("button", { name: "Log out" }).click();
    await p.waitForURL("**/login", { timeout: 15_000 });
    ok("Log out works from the screen (back to sign-in, the cookie dropped)", (await customerCookie(shotsCtx)) === null);
  }

  // ------------------------------------------------------------------------------------------------
  section("5. Fail closed when the access table is missing (deployment-order error)");
  {
    const c2 = await newContext("198.51.100.46", A);
    await q("alter table tenant_access_controls rename to tenant_access_controls_hidden_test_only");
    try {
      const bystanderTry = await customerSignIn(c2, "owner@bystander-fixture.test");
      ok("sign-in → 'temporarily unavailable' (never 'suspended'); no session issued", (bystanderTry.error ?? "").includes("Sign-in is temporarily unavailable. Try again later.") && (await customerCookie(c2)) === null, bystanderTry.error ?? "");
      const bcookie = signedInBystanderCookie;
      if (bcookie && bystanderCtx) {
        const r = await get("/dashboard", bcookie);
        ok("an open session → /access-suspended, which says access can't be confirmed (not 'suspended')", r.status === 307 && r.location === "/access-suspended");
        const p = await bystanderCtx.newPage();
        await go(p, "/dashboard");
        ok("…the screen reads 'Company access can't be confirmed'", (await p.locator("h1").innerText()).trim() === "Company access can't be confirmed");
        await shot(p, "64-access-unavailable-en-light-1440");
      }
      const sig = await get(bystanderSigned, null);
      ok("a valid signed file → 404 (fails closed)", sig.status === 404);
    } finally {
      await q("alter table tenant_access_controls_hidden_test_only rename to tenant_access_controls");
    }
  }

  // ------------------------------------------------------------------------------------------------
  section("6. Reactivation in the console; every user signs in again");
  {
    await go(ppage, `/platform/companies/${victim}?tab=access`);
    const re = ppage.getByRole("tabpanel").getByRole("button", { name: "Reactivate company", exact: true });
    await re.click();
    const d = ppage.getByRole("dialog");
    await d.waitFor({ state: "visible" });
    await ppage.waitForFunction((id) => !(document.getElementById(id) as HTMLInputElement | null)?.disabled, `access-ref-${victim}`, { timeout: 10_000 });
    const t = plain(await d.innerText());
    ok("the reactivation dialog: its own title and consequences (nobody signed in automatically; records and subscription unchanged)", t.includes("Reactivate access for Saffron Fixture Trading Co?") && t.includes("Users can sign in again. Nobody is signed in automatically.") && t.includes("The subscription is not changed."));
    await shot(ppage, "54-reactivate-dialog-en-light-1440");
    await ppage.locator(`#access-ref-${victim}`).fill(companies.orgReference(victim));
    await ppage.locator(`#access-reason-${victim}`).fill("Fixture: account settled, access restored");
    await ppage.locator(`#access-password-${victim}`).fill(PASSWORD);
    await ppage.locator(`#access-totp-${victim}`).fill(await freshCode(owner));
    await d.getByRole("button", { name: "Reactivate access" }).click();
    await d.getByText("Access reactivated. Users can sign in again.").waitFor({ timeout: 20_000 });
    await d.getByRole("button", { name: "Done" }).click();
    await ppage.getByRole("tabpanel").getByRole("button", { name: "Suspend company", exact: true }).waitFor({ timeout: 15_000 });
    ok("reactivated: the page shows Active again with the reactivation reason", (await ppage.getByRole("tabpanel").innerText()).includes("Fixture: account settled, access restored"));
    const old = await get("/dashboard", cookie);
    ok("the OLD session is not restored: → /auth/clear → sign-in", old.status === 307 && (old.location ?? "").startsWith("/auth/clear"), `${old.status} ${old.location}`);
    const fresh = await customerSignIn(await newContext("198.51.100.47", A), "owner@saffron-fixture.test");
    ok("a fresh sign-in works", fresh.error === null, fresh.error ?? "");
    const sig = await get(signedLogo, null);
    ok("a signature minted before the suspension serves again until it expires (documented: signatures are time-limited, not revocable)", sig.status === 200);
  }

  // ------------------------------------------------------------------------------------------------
  section("7. Dialog edge states: concurrent change, audit outage, enforcement off, mobile sheet, Arabic, dark");
  {
    // Concurrent change: the page shows Active, a background operator suspends, then the dialog opens.
    await go(ppage, `/platform/companies/${victim}?tab=access`);
    const bg = await opsChange(victim, "suspended", "Fixture: suspended from another session");
    ok("(a background operator suspended the company meanwhile)", bg.ok, bg.ok ? "" : bg.code);
    await ppage.getByRole("tabpanel").getByRole("button", { name: "Suspend company", exact: true }).click();
    const d = ppage.getByRole("dialog");
    await d.getByText("This company's access changed after this page was loaded. Refresh to see the current state.").waitFor({ timeout: 10_000 });
    ok("opening the dialog on a stale page → 'changed since this page was loaded' with Refresh, and no form to confirm", (await d.locator(`#access-ref-${victim}`).count()) === 0);
    await shot(ppage, "55-dialog-changed-en-light-1024");
    await d.getByRole("button", { name: "Refresh" }).click();
    await ppage.getByRole("tabpanel").getByRole("button", { name: "Reactivate company", exact: true }).waitFor({ timeout: 15_000 });
    ok("…Refresh shows the current state (Reactivate offered)", true);
    // Submit-time conflict: open on a fresh page, change in the background, then submit.
    await ppage.getByRole("tabpanel").getByRole("button", { name: "Reactivate company", exact: true }).click();
    await ppage.waitForFunction((id) => !(document.getElementById(id) as HTMLInputElement | null)?.disabled, `access-ref-${victim}`, { timeout: 10_000 });
    const bg2 = await opsChange(victim, "active", "Fixture: reactivated from another session");
    await ppage.locator(`#access-ref-${victim}`).fill(companies.orgReference(victim));
    await ppage.locator(`#access-reason-${victim}`).fill("Fixture: second reactivation attempt");
    await ppage.locator(`#access-password-${victim}`).fill(PASSWORD);
    await ppage.locator(`#access-totp-${victim}`).fill(await freshCode(owner));
    await d.getByRole("button", { name: "Reactivate access" }).click();
    await d.getByText("This company's access changed after this page was loaded.").waitFor({ timeout: 15_000 });
    ok("a change made while the dialog was open → CONFLICT shown as 'changed', nothing applied twice", bg2.ok && Number((await q<{ n: number }>("select count(*)::int as n from platform_audit_events where org_id = $1 and action = 'company.reactivated'", [victim]))[0].n) === 2);
    await d.getByRole("button", { name: "Refresh" }).click();
    await ppage.getByRole("tabpanel").getByRole("button", { name: "Suspend company", exact: true }).waitFor({ timeout: 15_000 });

    // Audit outage at submit: nothing applied.
    await ppage.getByRole("tabpanel").getByRole("button", { name: "Suspend company", exact: true }).click();
    await ppage.waitForFunction((id) => !(document.getElementById(id) as HTMLInputElement | null)?.disabled, `access-ref-${victim}`, { timeout: 10_000 });
    await ppage.locator(`#access-ref-${victim}`).fill(companies.orgReference(victim));
    await ppage.locator(`#access-reason-${victim}`).fill("Fixture: attempt during an audit outage");
    await ppage.locator(`#access-password-${victim}`).fill(PASSWORD);
    await ppage.locator(`#access-totp-${victim}`).fill(await freshCode(owner));
    await auditOutage(true);
    try {
      await d.getByRole("button", { name: "Suspend access" }).click();
      await d.getByText("This change was not applied because it could not be recorded in the audit trail.").waitFor({ timeout: 15_000 });
      ok("audit trail unavailable → 'not applied' in the dialog; the company stays active", (await q<{ s: string }>("select access_status as s from tenant_access_controls where org_id = $1", [victim]))[0].s === "active");
      await shot(ppage, "56-dialog-audit-unavailable-en-light-1440");
    } finally {
      await auditOutage(false);
    }
    await ppage.keyboard.press("Escape");
    await d.waitFor({ state: "hidden" });
    ok("Escape closes the dialog and focus returns to its trigger", await ppage.evaluate(() => (document.activeElement?.textContent ?? "").includes("Suspend company")));

    // Enforcement off (server B): Suspend disabled with the reason.
    const bctx = await newContext("198.51.100.48", B);
    const bpage = await platformSignIn(bctx, owner);
    await go(bpage, `/platform/companies/${bystander}?tab=access`);
    const disabled = bpage.getByRole("tabpanel").getByRole("button", { name: /Suspend company — Customer enforcement is switched off/ });
    ok("server B (enforcement off): Suspend is DISABLED and says why; the note is shown", (await disabled.isDisabled()) && (await bpage.getByRole("tabpanel").innerText()).includes("Customer enforcement is switched off in this environment, so a company can be reactivated but not suspended."));
    await shot(bpage, "57-access-enforcement-off-en-light-1440");
    await go(bpage, "/platform/companies");
    ok("…the directory note says enforcement is off (no false promise)", (await bpage.locator("body").innerText()).includes("Customer enforcement is switched off in this environment"));
    const bLogin = await customerSignIn(await newContext("198.51.100.49", B), "owner@bystander-fixture.test");
    ok("…and customers on server B sign in exactly as before PO-02C", bLogin.error === null, bLogin.error ?? "");

    // Matrix of the dialog: EN / AR × light / dark × 1440 / 1024 / 390.
    const results: string[] = [];
    for (const locale of ["en", "ar"] as const)
      for (const theme of ["light", "dark"] as const)
        for (const [w, h] of [[1440, 900], [1024, 768], [390, 844]] as const) {
          await setPrefs(pctx, A, { locale, theme });
          await ppage.setViewportSize({ width: w, height: h });
          await go(ppage, `/platform/companies/${victim}?tab=access`);
          const label = locale === "ar" ? "إيقاف الشركة" : "Suspend company";
          await ppage.getByRole("tabpanel").getByRole("button", { name: label, exact: true }).click();
          const dd = ppage.getByRole("dialog");
          await dd.waitFor({ state: "visible" });
          await ppage.waitForFunction((id) => !(document.getElementById(id) as HTMLInputElement | null)?.disabled, `access-ref-${victim}`, { timeout: 10_000 });
          const a = await audit(ppage);
          const box = await dd.boundingBox();
          const sheetOk = w > 600 || (!!box && Math.abs(box.x) <= 1 && Math.abs(box.width - w) <= 2 && Math.abs(box.y + box.height - h) <= 2);
          const refDir = await ppage.locator(`#access-ref-${victim}`).getAttribute("dir");
          const good = a.lang === locale && a.dir === (locale === "ar" ? "rtl" : "ltr") && (a.theme ?? "light") === theme && a.unnamed.length === 0 && a.unlabelled.length === 0 && sheetOk && refDir === "ltr";
          if (!good) results.push(`${locale}-${theme}-${w}: ${JSON.stringify({ ...a, box }).slice(0, 200)}`);
          await shot(ppage, `58-suspend-dialog-${locale}-${theme}-${w}`);
          await ppage.keyboard.press("Escape");
          await dd.waitFor({ state: "hidden" });
        }
    ok("the dialog in 12 combinations: correct lang / dir / theme, every control named and labelled, the reference field LTR, a full-width bottom sheet at 390", results.length === 0, results.join(" | "));
    await setPrefs(pctx, A, { locale: "ar", theme: "light" });
    await ppage.setViewportSize({ width: 390, height: 844 });
    await go(ppage, `/platform/companies/${victim}?tab=access`);
    await ppage.getByRole("tabpanel").getByRole("button", { name: "إيقاف الشركة", exact: true }).click();
    await ppage.waitForFunction((id) => !(document.getElementById(id) as HTMLInputElement | null)?.disabled, `access-ref-${victim}`, { timeout: 10_000 });
    await ppage.getByRole("dialog").getByRole("button", { name: "إيقاف الوصول" }).click();
    await sleep(300);
    ok("Arabic validation messages are native Arabic", (await ppage.getByRole("dialog").innerText()).includes("اكتب مرجع الشركة تمامًا كما يظهر."));
    await shot(ppage, "59-suspend-dialog-validation-ar-light-390");
    await ppage.keyboard.press("Escape");
    for (const [locale, theme] of [["en", "light"], ["ar", "dark"]] as const) {
      await setPrefs(pctx, A, { locale, theme });
      await ppage.setViewportSize({ width: 1440, height: 900 });
      await go(ppage, `/platform/companies/${victim}?tab=access`);
      await shot(ppage, `65-company-access-tab-${locale}-${theme}-1440`);
    }
  }

  // ------------------------------------------------------------------------------------------------
  section("8. Nothing secret reaches the browser or the server log");
  {
    const out = A.output() + B.output();
    ok(`server output contains no password, TOTP secret, recovery code, token or app secret (${secretsSeen.length} values checked)`, !secretsSeen.some((s) => s && s.length >= 8 && out.includes(s)));
    const auditText = JSON.stringify(await q("select * from platform_audit_events"));
    ok("no secret in any audit record", !secretsSeen.some((s) => s && s.length >= 8 && auditText.includes(s)));
  }
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-company-access-browser");
} catch (e) {
  console.error(`verify:platform-company-access-browser crashed: ${describeError(e)}`);
  exitCode = 1;
} finally {
  for (const c of contexts) await c.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await A?.stop().catch(() => undefined);
  await B?.stop().catch(() => undefined);
  await pool.end().catch(() => undefined);
  if (created && process.env.PLATFORM_TEST_KEEP_DATABASES !== "1") await dropDisposableDatabase(testDbName).catch(() => undefined);
  rmSync(STORAGE_DIR, { recursive: true, force: true });
}
process.exit(exitCode);
