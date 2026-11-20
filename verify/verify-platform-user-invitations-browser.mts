/**
 * Platform Owner PO-03C, sub-batch C — browser suite: customer-user invitation administration in the console — the
 * production build (`next build` first) served by `next start` on loopback, driven in Chromium.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://…/<admin db with _test_only_> \
 *   PO03C_SCREENSHOT_DIR=<optional output dir> npm run verify:platform-user-invitations-browser
 *
 * One disposable database (dropped at the end): the reviewed schema and the PO-02D1B Trial seed, fictional companies
 * and users. The STAGED user_invitations table (drizzle/platform/PO03C_user_invitations.sql) is applied by this suite
 * part-way through, so the "not set up" state is seen first. Two servers on the same port, one after the other: the
 * first with PLATFORM_USER_INVITATIONS_ENABLED unset (the default: off), the second with it "true". CUSTOMER_PUBLIC_ORIGIN
 * is a fictional https origin that nothing ever requests. Distinctive CANARY values sit in the authentication columns:
 * none may appear in any page or server-action response. TEST-ONLY secrets are generated in memory and never printed.
 * Chromium is the pre-installed build (PO01B_CHROMIUM, default /opt/pw-browsers/chromium) — nothing is downloaded.
 *
 * Categories (docs/platform-owner/PO03C_DEVELOPMENT.md §J): U1 flag off — every page a 404 inside the console, no
 * panel, the directory's placeholder, a direct POST refused · U2 not set up — the pages say so, nothing can be
 * created · U3 invite from the company's Users tab (validation, the read-only check with seats, a wrong code, the
 * one-time link: hash-only storage, copy, gone when closed; seats now count the invitation) · U4 refusals shown before
 * any code is spent (already invited, e-mail in use, suspended company) · U5 the list (filters, search, a company's
 * own) · U6 the detail (an audited view, no token anywhere) · U7 revoke · U8 re-issue (a new link once, the lineage) ·
 * U9 a stale page is told to refresh · U10 English / Arabic × light / dark × 1440 / 1024 / 768 / 390 / 360 with layout
 * audits and the dialogs in Arabic on a phone · U11 payloads and direct POSTs · U12 nothing is sent, and with PO-03D's
 * acceptance switched off nothing accepts (/join/accept answers only "not available").
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { connectDisposable, createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { section, ok, summary, describeError } from "./platform/harness";
import { startServer, testSecrets, type Server } from "./platform/browser-env";
import { loadActionIds } from "./action-id.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");

const ROOT = process.cwd();
const testDbName = disposableName("po03c_uinv_browser");
const secrets = testSecrets();
const PORT = Number(process.env.PO03C_UINV_PORT || 3468);
const SHOTS = process.env.PO03C_SCREENSHOT_DIR || "";
const CUSTOMER_ORIGIN = "https://erp.example.test";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
process.env.DATABASE_URL = databaseUrlFor(testDbName);
Object.assign(process.env, secrets);
process.env.PLATFORM_CONSOLE_ENABLED = "true";
process.env.PLATFORM_TRUSTED_PROXY_HOPS = "1";
process.env.CUSTOMER_PUBLIC_ORIGIN = CUSTOMER_ORIGIN;
process.env.PLATFORM_USER_INVITATIONS_ENABLED = "true"; // this process only (U9 calls the core); each server gets its own value
delete process.env.PLATFORM_INVITATIONS_ENABLED;
delete process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED;
delete process.env.CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED;
delete process.env.CUSTOMER_SEAT_ENFORCEMENT_ENABLED;

let created = false;
await createPlatformTestDatabase("po03c_uinv_browser", testDbName);
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
const uinvCore = await import("../src/lib/platform/user-invitation-actions");
pool.on("error", () => undefined);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const q = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
const one = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await q<T>(text, values))[0];
const num = async (text: string, values: unknown[] = []) => Number((await one<{ n: number }>(text, values))?.n ?? 0);
const plain = (s: string) => s.replace(/[⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const PLATFORM_COOKIE = "__Host-elite_erp_platform";
const OPERATOR_PASSWORD = "Juniper-Lantern-58!q";
let ipSeq = 0;
const nextIp = () => `198.51.100.${(++ipSeq % 200) + 20}`;
const REASON = "Fixture: the company withdrew this request in writing";

// ---- canaries (stored in authentication columns; never allowed in a page or an action response) ---------------------
const bcryptPad = (stem: string) => "$2b$10$" + (stem + "Q".repeat(53)).slice(0, 53);
const CANARY = { hash: bcryptPad("CanaryUserInvitationsBrowserU9"), mfa: "v1:CANARY_UINV_BROWSER_MFA_ENVELOPE_U9", rec: "v1:CANARY_UINV_BROWSER_RECOVERY_ENVELOPE_U9" };
const tokensSeen: string[] = [];

// ---- fixtures -----------------------------------------------------------------------------------------------------------
type Admin = { id: string; email: string; secret: string; lastStep: number };
async function createAdmin(label: string): Promise<Admin> {
  const email = `${label}.${Date.now().toString(36)}@uinv-browser.test`;
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
async function addUser(orgId: number, name: string, email: string, role: string, active = true): Promise<number> {
  return Number(
    (await one<{ id: number }>(`insert into users (org_id, email, password_hash, name, role, is_active, mfa_secret, mfa_recovery_codes) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`, [orgId, email, CANARY.hash, name, role, active, CANARY.mfa, CANARY.rec]))!.id,
  );
}
async function subscribe(orgId: number, seatsSnapshot: number) {
  const v1 = (await one<{ id: string }>(`select v.id from subscription_package_versions v join subscription_packages p on p.id = v.package_id where p.is_default_trial and v.version_number = 1`))!.id;
  await q(
    `insert into tenant_subscriptions (org_id, package_version_id, version_state, is_trial, cycle, lifecycle_state, start_date, end_date, price_snapshot_sar, seats_snapshot, storage_snapshot_gb, module_groups_snapshot, assignment_source)
     values ($1, $2, 'published', true, 'trial', 'trialing', current_date, current_date + 13, 0, $3, 5, '[]'::jsonb, 'invitation_acceptance')`,
    [orgId, v1, seatsSnapshot],
  );
}
async function applyStagedSql(): Promise<boolean> {
  const c = await connectDisposable(process.env.DATABASE_URL!);
  try {
    await c.query(readFileSync(join(ROOT, "drizzle/platform/PO03C_user_invitations.sql"), "utf8"));
    return true;
  } catch {
    await c.query("rollback").catch(() => undefined);
    return false;
  } finally {
    await c.end().catch(() => undefined);
  }
}
const invRow = (id: string) => one<{ org_id: number; email_normalized: string; requested_role: string; token_hash: string; revoked_at: Date | null; accepted_at: Date | null }>(`select org_id, email_normalized, requested_role, token_hash, revoked_at, accepted_at from user_invitations where id = $1`, [id]);
const invByEmail = (email: string) => q<{ id: string; revoked_at: Date | null }>(`select id, revoked_at from user_invitations where email_normalized = $1 order by created_at, id`, [email]);
const auditCount = (action: string, entityId?: string) =>
  entityId ? num(`select count(*)::int as n from platform_audit_events where action = $1 and entity_id = $2`, [action, entityId]) : num(`select count(*)::int as n from platform_audit_events where action = $1`, [action]);
const referenceOf = (id: string) => `UIN-${id.slice(0, 8).toUpperCase()}`;

// ---- browser helpers --------------------------------------------------------------------------------------------------
let browser!: Browser;
let A!: Server;
const serverOutputs: string[] = [];
const requestedHosts = new Set<string>();
type Prefs = { locale: "en" | "ar"; theme: "light" | "dark" };
async function newContext(prefs: Prefs = { locale: "en", theme: "light" }, viewport = { width: 1440, height: 900 }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ baseURL: `http://localhost:${PORT}`, viewport, deviceScaleFactor: 1, reducedMotion: "reduce", extraHTTPHeaders: { "x-forwarded-for": nextIp() }, permissions: ["clipboard-read", "clipboard-write"] });
  ctx.on("request", (r) => {
    try {
      requestedHosts.add(new URL(r.url()).host);
    } catch {
      // data: and similar
    }
  });
  await setPrefs(ctx, prefs);
  return ctx;
}
async function setPrefs(ctx: BrowserContext, prefs: Prefs) {
  const url = `http://localhost:${PORT}`;
  await ctx.addCookies([
    { name: "locale", value: prefs.locale, url },
    { name: "theme", value: prefs.theme, url },
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
  for (const key of ["passwordHash", "mfaSecret", "mfaRecoveryCodes", "tokenHash", "password_hash", "mfa_secret", "token_hash", "#t="]) if (text.includes(key)) found.push(key);
  for (const t of tokensSeen) if (t && text.includes(t)) found.push("token");
  for (const t of tokensSeen) if (t && text.includes(sha256(t))) found.push("token-digest");
  return found;
}
const linkInDom = (page: Page) => page.evaluate(() => document.documentElement.outerHTML.includes("#t=") || [...document.querySelectorAll("input")].some((i) => (i as HTMLInputElement).value.includes("#t=")));

// ---- layout audit (the PO-01B … PO-03C rules) -----------------------------------------------------------------------------
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
const DIALOG_AUDIT = `(() => {
  const d = document.querySelector("[role=dialog]");
  if (!d) return { found: false };
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const labelled = (el) => (el.labels && el.labels.length) || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
  const unlabelled = [...d.querySelectorAll("input:not([type=hidden]), select, textarea")].filter((el) => visible(el) && !labelled(el)).length;
  const r = d.getBoundingClientRect();
  return { found: true, unlabelled, inside: r.left >= -1 && r.right <= window.innerWidth + 1, overflow: document.documentElement.scrollWidth - window.innerWidth, named: !!(d.getAttribute("aria-labelledby") || d.getAttribute("aria-label")) };
})()`;
const dialogAudit = async (page: Page) => (await page.evaluate(DIALOG_AUDIT)) as { found: boolean; unlabelled?: number; inside?: boolean; overflow?: number; named?: boolean };
const shots: string[] = [];
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
const toSignIn = (r: { status: number; text: string; location: string }) => (r.status >= 300 && r.status < 400 && /\/platform\/login/.test(r.location)) || /\/platform\/login/.test(r.text);
async function eventually(cond: () => Promise<boolean>, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond().catch(() => false)) return true;
    await sleep(200);
  }
  return false;
}
async function serve(flagOn: boolean): Promise<Server> {
  const s = await startServer(PORT, {
    ...secrets,
    DATABASE_URL: process.env.DATABASE_URL,
    PLATFORM_CONSOLE_ENABLED: "true",
    PLATFORM_TRUSTED_PROXY_HOPS: "1",
    CUSTOMER_PUBLIC_ORIGIN: CUSTOMER_ORIGIN,
    PLATFORM_USER_INVITATIONS_ENABLED: flagOn ? "true" : undefined,
    PLATFORM_INVITATIONS_ENABLED: undefined,
    CUSTOMER_INVITE_ACCEPTANCE_ENABLED: undefined,
    CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED: undefined,
    CUSTOMER_SEAT_ENFORCEMENT_ENABLED: undefined,
    TENANT_ACCESS_ENFORCEMENT: "enabled",
  });
  return s;
}
async function stopServer() {
  if (!A) return;
  serverOutputs.push(A.output());
  await A.stop();
}

async function main() {
  browser = await chromium.launch({ executablePath: process.env.PO01B_CHROMIUM || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });

  const operator = await createAdmin("operator");
  const second = await createAdmin("second");
  // A company with a 4-seat Trial snapshot: an owner, an admin and a DISABLED staff member (3 seats occupied).
  const T = await newOrg("Fictional Cedar Analytics");
  await addUser(T, "Rania Fictional", "rania.owner@cedar-fixture.test", "owner");
  await addUser(T, "Omar Fictional", "omar.admin@cedar-fixture.test", "admin");
  await addUser(T, "Layla Fictional", "layla.staff@cedar-fixture.test", "staff", false);
  await subscribe(T, 4);
  // A company with no subscription (no allowance) and a suspended company.
  const U = await newOrg("Fictional Oasis Traders");
  await addUser(U, "Huda Fictional", "huda.owner@oasis-fixture.test", "owner");
  const Sx = await newOrg("Fictional Dune Holdings");
  await addUser(Sx, "Sami Fictional", "sami.owner@dune-fixture.test", "owner");
  await q(`insert into tenant_access_controls (org_id, access_status, reason, changed_by_platform_admin_id, changed_at) values ($1, 'suspended', 'Fixture: suspended for the browser test', $2, now())`, [Sx, operator.id]);

  // ============================================================================================================
  section("U1 Flag off (the default): nothing of the feature is reachable");
  A = await serve(false);
  const ctx = await newContext();
  const page = await platformSignIn(ctx, operator);
  const platformCookie = (await ctx.cookies()).find((c) => c.name === PLATFORM_COOKIE)!;
  const cookie = `${PLATFORM_COOKIE}=${platformCookie.value}`;
  const dialog = page.getByRole("dialog");
  const offList = await go(page, "/platform/users/invitations");
  const offListText = await page.locator("main").innerText();
  const offShell = (await page.locator("nav").count()) > 0;
  await shot(page, "01-flag-off-list-404-en-light-1440");
  const offDetail = await go(page, `/platform/users/invitations/${randomUUID()}`);
  const offDetailText = await page.locator("main").innerText();
  // (Console pages stream behind (console)/loading.tsx, so a not-found arrives with HTTP 200 — as every console 404 does;
  // what matters is what renders: the console's own not-found, no data, no customer page.)
  ok("U1 /platform/users/invitations is \"Page not found\" inside the console (its navigation, a way back to users — never the customer app's 404); an invitation id is \"Invitation not found\"",
    /Page not found/.test(offListText) && /Back to users/.test(offListText) && offShell && !/Back to Dashboard/.test(offListText) && /Invitation not found/.test(offDetailText),
    `HTTP ${offList?.status()} / ${offDetail?.status()} · ${plain(offListText).slice(0, 80)}`);
  await go(page, `/platform/companies/${T}?tab=users`);
  ok("U1 the company's Users tab has no User invitations panel", (await page.getByTestId("company-user-invitations").count()) === 0 && (await page.getByTestId("company-seats").count()) === 1);
  await go(page, "/platform/users");
  const placeholder = page.getByRole("button", { name: /Invite user/ });
  ok("U1 the users directory keeps the disabled Invite user placeholder (no User invitations link)", (await placeholder.count()) === 1 && (await placeholder.isDisabled()) && (await page.getByTestId("users-invitations-link").count()) === 0);
  const offPost = await postAction(`/platform/companies/${T}`, "previewUserInvitationAction", [{ orgId: String(T), name: "Fictional Person", email: "person.off@cedar-fixture.test", role: "staff" }], cookie);
  ok("U1 a direct server-action POST is refused (USER_INVITATIONS_DISABLED) — the flag is checked before anything else, even before the table", /USER_INVITATIONS_DISABLED/.test(offPost.text) && !/"ok":true/.test(offPost.text), `${offPost.status} ${offPost.text.slice(-160)}`);
  await stopServer();

  // ============================================================================================================
  section("U2 Flag on, table not set up: the pages say so; nothing can be created");
  A = await serve(true);
  await go(page, "/platform/users/invitations");
  const notSetUp = await page.locator("main").innerText();
  await shot(page, "02-not-set-up-list-en-light-1440");
  ok("U2 the list says user invitations aren't set up (no table in this database), with no filters, rows or Invite user", /User invitations aren.t set up/.test(notSetUp) && (await page.locator("form[role=search]").count()) === 0 && (await page.getByTestId("invite-user-control").count()) === 0, plain(notSetUp).slice(0, 160));
  await go(page, `/platform/companies/${T}?tab=users`);
  const panelOff = page.getByTestId("company-user-invitations");
  ok("U2 the company's User invitations panel says so too — no Invite user button", (await panelOff.count()) === 1 && /no user-invitation table/i.test(await panelOff.innerText()) && (await panelOff.getByTestId("invite-user-control").count()) === 0);
  await go(page, "/platform/users");
  ok("U2 the users directory header links to User invitations (the disabled placeholder is gone)", (await page.getByTestId("users-invitations-link").count()) === 1 && (await page.getByRole("button", { name: /Invite user/ }).count()) === 0);
  const notInstalledPost = await postAction(`/platform/companies/${T}`, "createUserInvitationAction", [{ orgId: String(T), name: "Fictional Person", email: "person.ni@cedar-fixture.test", role: "staff", password: "x", totpCode: "000000" }], cookie);
  ok("U2 a direct create is refused (USER_INVITATIONS_NOT_INSTALLED) before any credential is checked", /USER_INVITATIONS_NOT_INSTALLED/.test(notInstalledPost.text), notInstalledPost.text.slice(-160));
  ok("U2 the reviewed SQL is applied (by the suite) to this disposable database only", await applyStagedSql());

  // ============================================================================================================
  section("U3 Invite a user from the company's Users tab");
  await go(page, `/platform/companies/${T}?tab=users`);
  const panel = page.getByTestId("company-user-invitations");
  const seatsBefore = await page.getByTestId("company-seats").innerText();
  ok("U3 the panel: no open invitations yet, the seat note and Invite user", /No pending or expired invitations/.test(await panel.innerText()) && /reserves a company seat/.test(await panel.innerText()) && (await panel.getByTestId("invite-user-control").count()) === 1);
  await shot(page, "10-company-panel-empty-en-light-1440");
  await panel.getByTestId("invite-user-control").click();
  await dialog.getByLabel("Full name").waitFor({ timeout: 15_000 });
  const inviteAudit0 = await dialogAudit(page);
  ok("U3 the invite dialog is a named dialog with the focus inside; it states copy-link only", inviteAudit0.found && inviteAudit0.named === true && (await focusInDialog(page)) && /Copy-link only: nothing is emailed or messaged/.test(await dialog.innerText()), JSON.stringify(inviteAudit0));
  await dialog.getByRole("button", { name: "Check details" }).click();
  const errorsText = await dialog.innerText();
  ok("U3 Check details with nothing entered: a name, a valid e-mail and a role are required (no request sent)", /Enter a name of up to 200 characters/.test(errorsText) && /Enter a valid email address/.test(errorsText) && /Choose admin or staff/.test(errorsText));
  await shot(page, "11-invite-errors-en-light-1440", "viewport");
  ok("U3 the role choice is admin or staff only — never owner", (await dialog.getByRole("radio").count()) === 2 && (await dialog.getByRole("radio", { name: "Admin" }).count()) === 1 && (await dialog.getByRole("radio", { name: "Staff" }).count()) === 1 && (await dialog.getByRole("radio", { name: /Owner/ }).count()) === 0);
  await dialog.getByLabel("Full name").fill("Reem Fictional");
  await dialog.getByLabel("Email", { exact: true }).fill("Reem.Staff@Cedar-Fixture.test");
  await dialog.getByRole("radio", { name: "Staff" }).check();
  await dialog.getByRole("button", { name: "Check details" }).click();
  await dialog.getByTestId("invite-review").waitFor({ timeout: 15_000 });
  const seatsLine = plain(await dialog.getByTestId("invite-seats").innerText());
  ok("U3 the read-only check lists the effects and the company's seats now and after (3 of 4 → 4 of 4) — nothing created yet", /3 of 4 now, 4 of 4 with this invitation/.test(seatsLine) && (await num(`select count(*)::int as n from user_invitations`)) === 0 && (await dialog.getByTestId("invite-blocked").count()) === 0, seatsLine);
  await shot(page, "12-invite-review-en-light-1440", "viewport");
  await dialog.getByRole("button", { name: "Create invitation" }).click();
  ok("U3 Create without the step-up asks for the password and the code (no request sent)", /Enter your password and the 6-digit code/.test(await dialog.innerText()) && (await num(`select count(*)::int as n from user_invitations`)) === 0);
  await dialog.getByLabel("Password", { exact: true }).fill(OPERATOR_PASSWORD);
  await dialog.getByLabel("Verification code", { exact: true }).fill("000000");
  await dialog.getByRole("button", { name: "Create invitation" }).click();
  const wrong = await eventually(async () => /code|second factor/i.test(await dialog.locator("[role=alert]").innerText()));
  ok("U3 a wrong code is refused: an error is shown, the password and the code are cleared, nothing is created",
    wrong && (await dialog.getByLabel("Password", { exact: true }).inputValue()) === "" && (await dialog.getByLabel("Verification code", { exact: true }).inputValue()) === "" && (await num(`select count(*)::int as n from user_invitations`)) === 0);
  await dialog.getByLabel("Password", { exact: true }).fill(OPERATOR_PASSWORD);
  await dialog.getByLabel("Verification code", { exact: true }).fill(await freshCode(operator));
  await dialog.getByRole("button", { name: "Create invitation" }).click();
  await dialog.locator("#user-invitation-link").waitFor({ timeout: 20_000 });
  const link1 = await dialog.locator("#user-invitation-link").inputValue();
  const token1 = link1.split("#t=")[1] ?? "";
  tokensSeen.push(token1);
  const [inv1] = await invByEmail("reem.staff@cedar-fixture.test");
  const row1 = inv1 ? await invRow(inv1.id) : undefined;
  const linkPanelText = plain(await dialog.innerText());
  ok("U3 success: the link panel shows the reference and the link — the configured origin, /join/accept, the token (43 base64url characters) in the fragment",
    !!inv1 && link1.startsWith(`${CUSTOMER_ORIGIN}/join/accept#t=`) && /^[A-Za-z0-9_-]{43}$/.test(token1) && linkPanelText.includes(referenceOf(inv1.id)), `${link1.slice(0, 40)}… ${linkPanelText.slice(0, 80)}`);
  ok("U3 …the database holds only sha256 of that token (normalized e-mail, the staff role, this company)", !!row1 && row1.token_hash === sha256(token1) && row1.email_normalized === "reem.staff@cedar-fixture.test" && row1.requested_role === "staff" && row1.org_id === T);
  // PO-03D: acceptance exists now, behind its own switch — this server leaves CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED unset,
  // so the panel says the link can't be used while that switch is off here (never that it works).
  ok("U3 …the panel says the link can't be used while user-invitation acceptance is switched off here, and was not sent", /can.t be used while user-invitation acceptance is switched off here/i.test(linkPanelText) && !/opens this link to choose a password/i.test(linkPanelText) && /Nothing was emailed or messaged/.test(linkPanelText) && /shown only now/.test(linkPanelText), linkPanelText.slice(0, 200));
  await shot(page, "13-invite-link-once-en-light-1440", "viewport");
  await dialog.getByRole("button", { name: "Copy link" }).click();
  const copied = await eventually(async () => /Link copied/.test(await dialog.innerText()));
  ok("U3 Copy link puts exactly the link on the clipboard and says so", copied && (await page.evaluate(() => navigator.clipboard.readText())) === link1);
  ok("U3 the panel closes only with Done (Escape keeps it: the link would be lost)", await (async () => {
    await page.keyboard.press("Escape");
    await sleep(300);
    return (await dialog.locator("#user-invitation-link").count()) === 1;
  })());
  await dialog.getByRole("button", { name: /Done — I have copied the link/ }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
  const listed = await eventually(async () => (await panel.getByTestId("company-user-invitations-open").count()) === 1 && /Reem Fictional/.test(await panel.innerText()));
  ok("U3 Done: the dialog closes, the page refreshes and the open list names the invitation (pending, staff, its reference)", listed && /Pending/.test(await panel.innerText()) && (await panel.innerText()).includes(referenceOf(inv1!.id)));
  ok("U3 …and the link is gone: not in the page, the URL, a cookie or browser storage", !(await linkInDom(page)) && !page.url().includes("#t=") && !(await ctx.cookies()).some((c) => c.value.includes(token1)) && (await page.evaluate(() => localStorage.length + sessionStorage.length)) === 0);
  const seatsAfter = await page.getByTestId("company-seats").innerText();
  ok("U3 the company's seats now count the pending invitation (3 → 4 occupied) — display only", /3/.test(seatsBefore) && /4/.test(seatsAfter) && plain(seatsAfter) !== plain(seatsBefore), `${plain(seatsBefore).slice(0, 60)} → ${plain(seatsAfter).slice(0, 60)}`);
  ok("U3 the platform audit has user_invitation.created for it", (await auditCount("user_invitation.created", inv1!.id)) === 1);
  await shot(page, "14-company-panel-pending-en-light-1440");

  // ============================================================================================================
  section("U4 Refusals are shown by the read-only check, before any code is spent");
  const codesBefore = await one<{ step: string | null }>(`select last_totp_step::text as step from platform_admins where id = $1`, [operator.id]).catch(() => ({ step: null }));
  async function previewFor(orgPath: string, email: string, role: "Admin" | "Staff" = "Admin") {
    await go(page, orgPath);
    await page.getByTestId("company-user-invitations").getByTestId("invite-user-control").click();
    await dialog.getByLabel("Full name").waitFor({ timeout: 15_000 });
    await dialog.getByLabel("Full name").fill("Fictional Candidate");
    await dialog.getByLabel("Email", { exact: true }).fill(email);
    await dialog.getByRole("radio", { name: role }).check();
    await dialog.getByRole("button", { name: "Check details" }).click();
    await dialog.getByTestId("invite-review").waitFor({ timeout: 15_000 });
    const text = plain(await dialog.innerText());
    const blocked = (await dialog.getByTestId("invite-blocked").count()) === 1;
    const createDisabled = await dialog.getByRole("button", { name: "Create invitation" }).isDisabled();
    const stepUp = await dialog.getByLabel("Verification code", { exact: true }).count();
    return { text, blocked, createDisabled, stepUp };
  }
  const dup = await previewFor(`/platform/companies/${U}?tab=users`, "REEM.staff@cedar-fixture.test");
  ok("U4 an e-mail an unexpired invitation holds (any case, another company) is blocked with that invitation's reference; Create is disabled and no code is asked for", dup.blocked && dup.createDisabled && dup.stepUp === 0 && dup.text.includes(referenceOf(inv1!.id)), dup.text.slice(0, 200));
  await shot(page, "20-invite-blocked-pending-en-light-1440", "viewport");
  await page.keyboard.press("Escape");
  const inUse = await previewFor(`/platform/companies/${T}?tab=users`, "OMAR.ADMIN@cedar-fixture.test");
  ok("U4 an e-mail a customer user already has (any letter case) is blocked", inUse.blocked && inUse.createDisabled && /A user already has this email address/.test(inUse.text));
  await page.keyboard.press("Escape");
  const suspended = await previewFor(`/platform/companies/${Sx}?tab=users`, "new.person@dune-fixture.test");
  ok("U4 a suspended company can't receive invitations", suspended.blocked && suspended.createDisabled && /access is suspended/.test(suspended.text));
  await page.keyboard.press("Escape");
  const overPreview = await previewFor(`/platform/companies/${T}?tab=users`, "extra.person@cedar-fixture.test", "Staff");
  ok("U4 a company at its allowance is NOT blocked: the check shows 4 of 4 → 5 of 4 and says the excess is shown only (seats are not enforced)", !overPreview.blocked && !overPreview.createDisabled && /4 of 4 now, 5 of 4 with this invitation/.test(overPreview.text) && /1 over the allowance/.test(overPreview.text) && /not enforced/.test(overPreview.text), overPreview.text.slice(0, 260));
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
  const codesAfter = await one<{ step: string | null }>(`select last_totp_step::text as step from platform_admins where id = $1`, [operator.id]).catch(() => ({ step: null }));
  ok("U4 none of these checks spent a code or wrote an invitation", (codesBefore?.step ?? null) === (codesAfter?.step ?? null) && (await num(`select count(*)::int as n from user_invitations`)) === 1);

  // ============================================================================================================
  section("U5 The list: every invitation, filters, search, one company's");
  await go(page, "/platform/users");
  await page.getByTestId("users-invitations-link").click();
  await page.waitForURL("**/platform/users/invitations", { timeout: 15_000 });
  await page.locator("h1").first().waitFor();
  const listText = plain(await page.locator("main").innerText());
  ok("U5 the users directory links to the list; it shows the invitation with its company, role, status and reference", /User invitations/.test(listText) && /Reem Fictional/.test(listText) && /Fictional Cedar Analytics/.test(listText) && /Staff/.test(listText) && /Pending/.test(listText) && listText.includes(referenceOf(inv1!.id)), listText.slice(0, 200));
  await shot(page, "30-list-en-light-1440");
  await go(page, "/platform/users/invitations?state=revoked");
  ok("U5 the status filter: no revoked invitation yet", /No invitations match these filters/.test(await page.locator("main").innerText()));
  await go(page, `/platform/users/invitations?q=${referenceOf(inv1!.id).toLowerCase()}`);
  ok("U5 search by the UIN reference (any case) finds it", (await page.locator(`[data-testid="uinv-row-${inv1!.id}"]`).count()) === 1);
  await go(page, `/platform/users/invitations?org=${U}`);
  const ownText = plain(await page.locator("main").innerText());
  ok("U5 one company's invitations: the company callout, Invite user in the header, and none of the other companies' rows", /Showing the invitations of Fictional Oasis Traders/.test(ownText) && (await page.getByTestId("invite-user-control").count()) === 1 && !/Reem Fictional/.test(ownText), ownText.slice(0, 200));
  await go(page, "/platform/users/invitations?state=bogus");
  ok("U5 an unknown filter value is a calm 'start over' state, not an error page", /start over/i.test(await page.locator("main").innerText()));

  // ============================================================================================================
  section("U6 The detail: an audited view; no token, digest or link anywhere");
  const viewsBefore = await auditCount("user_invitation.viewed", inv1!.id);
  const detail1 = await payloads(page, `/platform/users/invitations/${inv1!.id}`);
  const detailText = plain(await page.locator("main").innerText());
  ok("U6 the detail: name, company, e-mail, role, invited by, expiry, the switched-off-acceptance warning (PO-03D's copy; this server has acceptance off) and the history (Invited)", /Reem Fictional/.test(detailText) && /Fictional Cedar Analytics/.test(detailText) && /reem\.staff@cedar-fixture\.test/.test(detailText) && /can.t be accepted while user-invitation acceptance is switched off here/.test(detailText) && /Fictional operator/.test(detailText), detailText.slice(0, 240));
  ok("U6 opening it is recorded (user_invitation.viewed)", (await auditCount("user_invitation.viewed", inv1!.id)) >= viewsBefore + 1);
  ok("U6 the page's HTML and RSC payload hold no token, digest, link, password hash, MFA envelope or bcrypt-shaped string", leaksIn(detail1.html).length === 0 && leaksIn(detail1.rsc).length === 0, [...leaksIn(detail1.html), ...leaksIn(detail1.rsc)].join(","));
  await shot(page, "40-detail-pending-en-light-1440");

  // ============================================================================================================
  section("U7 Revoke");
  await go(page, `/platform/users/invitations/${inv1!.id}`);
  const actions1 = page.getByTestId(`uinv-actions-${inv1!.id}`);
  await actions1.getByTestId("uinv-revoke").click();
  await dialog.getByLabel("Reason").waitFor({ timeout: 15_000 });
  await eventually(async () => !(await dialog.getByLabel("Reason").isDisabled()));
  await dialog.getByLabel("Reason").fill("too short");
  await dialog.getByLabel("Verification code", { exact: true }).fill("123456");
  await dialog.getByRole("button", { name: "Revoke", exact: true }).click();
  ok("U7 a reason under 10 characters is refused in the dialog (nothing sent)", /Enter a reason of 10 to 500 characters/.test(await dialog.innerText()) && !(await invRow(inv1!.id))?.revoked_at);
  await shot(page, "41-revoke-dialog-en-light-1440", "viewport");
  await dialog.getByLabel("Reason").fill(REASON);
  await dialog.getByLabel("Verification code", { exact: true }).fill(await freshCode(operator));
  await dialog.getByRole("button", { name: "Revoke", exact: true }).click();
  const revoked = await eventually(async () => /is revoked/.test(await dialog.innerText()));
  ok("U7 revoke (reason + fresh code): the invitation is revoked and the dialog says so", revoked && !!(await invRow(inv1!.id))?.revoked_at);
  await dialog.getByRole("button", { name: "Done" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
  const revokedText = await eventually(async () => /Invitation revoked/.test(await page.locator("main").innerText()));
  const afterRevoke = plain(await page.locator("main").innerText());
  const reissueOffered = await actions1.getByTestId("uinv-reissue").count();
  const revokeOffered = await actions1.getByTestId("uinv-revoke").count();
  await shot(page, "41b-detail-revoked-en-light-1440");
  ok("U7 after Done the page shows Revoked, the history has the revocation with its reason, and Re-issue is still offered (Revoke is not)",
    revokedText && /Revoked/.test(afterRevoke) && afterRevoke.includes(REASON) && reissueOffered === 1 && revokeOffered === 0,
    `${revokedText} reissue=${reissueOffered} revoke=${revokeOffered} reason=${afterRevoke.includes(REASON)} · ${afterRevoke.slice(0, 200)}`);
  await go(page, `/platform/companies/${T}?tab=users`);
  ok("U7 the seat is released at once (the company's open list is empty again)", /No pending or expired invitations/.test(await page.getByTestId("company-user-invitations").innerText()));

  // ============================================================================================================
  section("U8 Re-issue: a new link, once; the lineage");
  await go(page, `/platform/users/invitations/${inv1!.id}`);
  await page.getByTestId(`uinv-actions-${inv1!.id}`).getByTestId("uinv-reissue").click();
  await dialog.getByLabel("Password", { exact: true }).waitFor({ timeout: 15_000 });
  await eventually(async () => !(await dialog.getByLabel("Password", { exact: true }).isDisabled()));
  await dialog.getByLabel("Password", { exact: true }).fill(OPERATOR_PASSWORD);
  await dialog.getByLabel("Verification code", { exact: true }).fill(await freshCode(operator));
  await dialog.getByRole("button", { name: "Re-issue", exact: true }).click();
  await dialog.locator("#user-invitation-link").waitFor({ timeout: 20_000 });
  const link2 = await dialog.locator("#user-invitation-link").inputValue();
  const token2 = link2.split("#t=")[1] ?? "";
  tokensSeen.push(token2);
  const both = await invByEmail("reem.staff@cedar-fixture.test");
  const inv2 = both.find((r) => r.id !== inv1!.id);
  ok("U8 the new link is shown once — a different token, a new reference; the database holds its digest only", !!inv2 && token2 !== token1 && /^[A-Za-z0-9_-]{43}$/.test(token2) && (await invRow(inv2.id))?.token_hash === sha256(token2) && plain(await dialog.innerText()).includes(referenceOf(inv2.id)));
  await shot(page, "42-reissue-link-en-light-1440", "viewport");
  await dialog.getByRole("button", { name: /Done — I have copied the link/ }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
  await go(page, `/platform/users/invitations/${inv2!.id}`);
  const lineage = plain(await page.locator("main").innerText());
  ok("U8 the new invitation's history names the one it replaces (a link to it); the revoked one stays revoked", lineage.includes(referenceOf(inv1!.id)) && /Replaces/.test(lineage) && !!(await invRow(inv1!.id))?.revoked_at && !(await invRow(inv2!.id))?.revoked_at, lineage.slice(0, 260));
  await shot(page, "43-detail-reissued-en-light-1440");

  // ============================================================================================================
  section("U9 A stale page is told to refresh");
  await go(page, `/platform/users/invitations/${inv2!.id}`);
  // Another operator revokes it after this page loaded (through the same core the console uses).
  const headersFor = () => new Headers({ host: `localhost:${PORT}`, origin: A.url, "sec-fetch-site": "same-origin", "user-agent": "verify-uinv-browser", "x-forwarded-for": nextIp() });
  const signed = await console_.signInCore({ email: second.email, password: OPERATOR_PASSWORD, totpCode: await freshCode(second) }, { headers: headersFor() });
  const other = await uinvCore.revokeUserInvitation({ headers: headersFor(), token: signed.ok ? signed.token : "" }, { invitationId: inv2!.id, reason: REASON, totpCode: await freshCode(second) });
  await page.getByTestId(`uinv-actions-${inv2!.id}`).getByTestId("uinv-revoke").click();
  const changed = await eventually(async () => /changed after this page was loaded/.test(await dialog.innerText()));
  ok("U9 the dialog reads the invitation's CURRENT state: it changed (revoked elsewhere) → no form, a Refresh button", other.ok && changed && (await dialog.getByLabel("Verification code", { exact: true }).count()) === 0);
  await shot(page, "44-stale-refresh-en-light-1440", "viewport");
  await dialog.getByRole("button", { name: "Refresh" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
  ok("U9 Refresh shows the current state (Revoked)", await eventually(async () => /Revoked/.test(await page.locator("main").innerText())));

  // ============================================================================================================
  section("U10 English / Arabic × light / dark × 1440 / 1024 / 768 / 390 / 360");
  const widths = [1440, 1024, 768, 390, 360];
  const matrix: string[] = [];
  const paths = ["/platform/users/invitations", `/platform/users/invitations/${inv2!.id}`, `/platform/companies/${T}?tab=users`];
  for (const locale of ["en", "ar"] as const) {
    for (const theme of ["light", "dark"] as const) {
      await setPrefs(ctx, { locale, theme });
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        for (const path of paths) {
          await go(page, path);
          const a = await audit(page);
          const good = auditOk(a) && a.lang === locale && a.dir === (locale === "ar" ? "rtl" : "ltr") && a.theme === theme;
          if (!good) matrix.push(`${locale}/${theme}/${width} ${path}: ${auditText(a)}`);
        }
        const tag = `${locale}-${theme}-${width}`;
        if ((width === 1440 && !(locale === "en" && theme === "light")) || width === 390 || (locale === "en" && theme === "light" && (width === 1024 || width === 768)) || (locale === "ar" && theme === "light" && width === 360)) {
          await go(page, "/platform/users/invitations");
          await shot(page, `60-list-${tag}`, width <= 390 ? "viewport" : "full");
          await go(page, `/platform/users/invitations/${inv2!.id}`);
          await shot(page, `61-detail-${tag}`, width <= 390 ? "viewport" : "full");
          await go(page, `/platform/companies/${T}?tab=users`);
          if (width <= 390) await page.getByTestId("company-user-invitations").scrollIntoViewIfNeeded();
          await shot(page, `62-company-panel-${tag}`, width <= 390 ? "viewport" : "full");
        }
      }
    }
  }
  ok("U10 every combination: one h1, no horizontal overflow, every control named, every field labelled, white text on orange, nothing clipped; lang / dir / theme as chosen", matrix.length === 0, matrix.slice(0, 3).join(" | "));
  // The invite dialog in Arabic on a phone (bottom sheet, dark): the check, then a real create and its one-time link.
  await setPrefs(ctx, { locale: "ar", theme: "dark" });
  await page.setViewportSize({ width: 390, height: 860 });
  await go(page, `/platform/companies/${T}?tab=users`);
  await page.getByTestId("company-user-invitations").getByTestId("invite-user-control").click();
  await dialog.getByLabel("الاسم الكامل").waitFor({ timeout: 15_000 });
  await dialog.getByLabel("الاسم الكامل").fill("سلمى الخيالية");
  await dialog.getByLabel("البريد الإلكتروني", { exact: true }).fill("salma.admin@cedar-fixture.test");
  await dialog.getByRole("radio", { name: "مسؤول" }).check();
  await dialog.getByRole("button", { name: "مراجعة التفاصيل" }).click();
  await dialog.getByTestId("invite-review").waitFor({ timeout: 15_000 });
  const arReview = await dialog.innerText();
  const arAudit = await dialogAudit(page);
  ok("U10 the Arabic invite check on a phone: Arabic text, the seats line, fields labelled, inside the screen, focus inside", /دعوة مستخدم إلى/.test(arReview) && /مقاعد الشركة/.test(arReview) && arAudit.found && arAudit.unlabelled === 0 && arAudit.inside === true && (arAudit.overflow ?? 9) <= 1 && (await focusInDialog(page)), JSON.stringify(arAudit));
  await shot(page, "63-invite-review-ar-dark-390", "viewport");
  await dialog.getByLabel("كلمة المرور", { exact: true }).fill(OPERATOR_PASSWORD);
  await dialog.getByLabel("رمز التحقق", { exact: true }).fill(await freshCode(operator));
  await dialog.getByRole("button", { name: "إنشاء الدعوة" }).click();
  await dialog.locator("#user-invitation-link").waitFor({ timeout: 20_000 });
  const link3 = await dialog.locator("#user-invitation-link").inputValue();
  tokensSeen.push(link3.split("#t=")[1] ?? "");
  const arLink = await dialog.innerText();
  const arLinkAudit = await dialogAudit(page);
  ok("U10 the Arabic one-time link panel on a phone: the link stays left-to-right, the warnings in Arabic, inside the screen", /أُنشئت الدعوة/.test(arLink) && /رابط الدعوة لمرة واحدة/.test(arLink) && (await dialog.locator("#user-invitation-link").getAttribute("dir")) === "ltr" && arLinkAudit.inside === true && (arLinkAudit.overflow ?? 9) <= 1, JSON.stringify(arLinkAudit));
  await shot(page, "64-invite-link-ar-dark-390", "viewport");
  await dialog.getByRole("button", { name: /تم، نسختُ الرابط/ }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
  const [inv3] = await invByEmail("salma.admin@cedar-fixture.test");
  await setPrefs(ctx, { locale: "ar", theme: "light" });
  await page.setViewportSize({ width: 360, height: 800 });
  await go(page, `/platform/users/invitations/${inv3!.id}`);
  await page.getByTestId(`uinv-actions-${inv3!.id}`).getByTestId("uinv-revoke").click();
  await dialog.getByLabel("السبب").waitFor({ timeout: 15_000 });
  const arRevoke = await dialog.innerText();
  const arRevokeAudit = await dialogAudit(page);
  ok("U10 the Arabic revoke dialog at 360: Arabic text, the reason and code labelled, inside the screen", /هل تريد سحب الدعوة/.test(arRevoke) && arRevokeAudit.unlabelled === 0 && arRevokeAudit.inside === true && (arRevokeAudit.overflow ?? 9) <= 1, JSON.stringify(arRevokeAudit));
  await shot(page, "65-revoke-dialog-ar-light-360", "viewport");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
  ok("U10 Escape closes it and the focus returns to Revoke", await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "uinv-revoke"));
  await setPrefs(ctx, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });

  // ============================================================================================================
  section("U11 Payloads and direct POSTs");
  const listPayload = await payloads(page, "/platform/users/invitations");
  const companyPayload = await payloads(page, `/platform/companies/${T}?tab=users`);
  const readPost = await postAction(`/platform/companies/${T}`, "readUserInvitationAction", [inv3!.id], cookie);
  const previewPost = await postAction(`/platform/companies/${T}`, "previewUserInvitationAction", [{ orgId: String(T), name: "Fictional Person", email: "person.p@cedar-fixture.test", role: "staff" }], cookie);
  ok("U11 the list, the company page and the dialog reads hold no token, digest, link, password hash, MFA envelope or bcrypt-shaped string",
    [listPayload.html, listPayload.rsc, companyPayload.html, companyPayload.rsc, readPost.text, previewPost.text].every((t) => leaksIn(t).length === 0) && /salma\.admin@cedar-fixture\.test/.test(readPost.text) && /"seats"/.test(previewPost.text),
    [listPayload.html, listPayload.rsc, companyPayload.html, companyPayload.rsc, readPost.text, previewPost.text].flatMap(leaksIn).join(","));
  const anon = await postAction(`/platform/companies/${T}`, "createUserInvitationAction", [{ orgId: String(T), name: "Fictional Person", email: "person.a@cedar-fixture.test", role: "staff", password: OPERATOR_PASSWORD, totpCode: "123456" }], "");
  const cross = await postAction(`/platform/companies/${T}`, "previewUserInvitationAction", [{ orgId: String(T), name: "Fictional Person", email: "person.c@cedar-fixture.test", role: "staff" }], cookie, "https://evil.example");
  const extra = await postAction(`/platform/companies/${T}`, "previewUserInvitationAction", [{ orgId: String(T), name: "Fictional Person", email: "person.e@cedar-fixture.test", role: "staff", seats: 99 }], cookie);
  const owner = await postAction(`/platform/companies/${T}`, "previewUserInvitationAction", [{ orgId: String(T), name: "Fictional Person", email: "person.o@cedar-fixture.test", role: "owner" }], cookie);
  const revokeAnon = await postAction(`/platform/users/invitations/${inv3!.id}`, "revokeUserInvitationAction", [{ invitationId: inv3!.id, reason: REASON, totpCode: "123456" }], "");
  ok("U11 no platform cookie → sent to sign-in; a cross-site POST → refused; an unexpected field or the owner role → VALIDATION_FAILED; nothing written",
    toSignIn(anon) && toSignIn(revokeAnon) && (cross.status >= 400 || /FORBIDDEN/.test(cross.text)) && /VALIDATION_FAILED/.test(extra.text) && /VALIDATION_FAILED/.test(owner.text) && (await num(`select count(*)::int as n from user_invitations where email_normalized like 'person.%'`)) === 0 && !(await invRow(inv3!.id))?.revoked_at,
    `${anon.status} ${revokeAnon.status} ${cross.status} ${extra.status} ${owner.status}`);

  // ============================================================================================================
  section("U12 Nothing is sent; with acceptance switched off, nothing accepts");
  // PO-03D (sub-batch A): /join/accept now exists — the user-invitation acceptance page, behind its own switch
  // (CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED, unset here). Switched off, it renders only the "isn't available" notice: no
  // form, no invitation data — and the token, in the fragment, never reaches a server. Its flow is verified by
  // verify:platform-user-acceptance, boundary rule 50 and the PO-03D browser suite.
  const join = await fetch(`${A.url}/join/accept`, { redirect: "manual" });
  const joinHtml = await join.text();
  ok("U12 with acceptance switched off, the link's page answers only 'not available': no form, no invitation data, not indexed, no referrer, not stored",
    join.status === 200 && joinHtml.includes("Invitation acceptance isn") && !joinHtml.includes("Accept and join") && !/type="password"/.test(joinHtml) && !joinHtml.includes("cedar-fixture.test") &&
      /<meta name="robots" content="[^"]*noindex[^"]*nofollow/.test(joinHtml) && /<meta name="referrer" content="no-referrer"/.test(joinHtml) && /no-store/.test(join.headers.get("cache-control") ?? ""),
    `${join.status} ${join.headers.get("cache-control")}`);
  const hosts = [...requestedHosts];
  ok("U12 the browser only ever talked to the console's own origin (nothing to the customer origin, a mail or messaging service)", hosts.length > 0 && hosts.every((h) => h === `localhost:${PORT}`), hosts.join(", "));
  ok("U12 no invitation was accepted and no user was created by any of this", (await num(`select count(*)::int as n from user_invitations where accepted_at is not null`)) === 0 && (await num(`select count(*)::int as n from users where lower(email) in ('reem.staff@cedar-fixture.test', 'salma.admin@cedar-fixture.test')`)) === 0);
  serverOutputs.push(A.output());
  const out = serverOutputs.join("\n");
  ok("U12 the servers' output holds no token, link or secret", tokensSeen.length >= 3 && tokensSeen.every((t) => t.length === 43 && !out.includes(t)) && !out.includes("#t=") && !out.includes(secrets.PLATFORM_AUTH_SECRET) && !out.includes(OPERATOR_PASSWORD));

  await ctx.close();
  if (SHOTS) console.log(`screenshots: ${shots.length}`);
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-user-invitations-browser");
} catch (e) {
  ok("suite ran to completion", false, describeError(e));
  exitCode = summary("verify:platform-user-invitations-browser");
} finally {
  await browser?.close().catch(() => undefined);
  await A?.stop().catch(() => undefined);
  await pool.end().catch(() => undefined);
  if (created && !process.env.PLATFORM_TEST_KEEP_DATABASES) await dropDisposableDatabase(testDbName).catch(() => undefined);
}
process.exit(exitCode);
