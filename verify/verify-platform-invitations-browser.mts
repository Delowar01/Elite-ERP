/**
 * Platform Owner PO-02D2 — browser suite for company invitation administration: the production build (`next build`
 * first) served by `next start` on loopback, driven in Chromium.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *   PO02D2_SCREENSHOT_DIR=<optional output dir> npm run verify:platform-invitations-browser
 *
 * Server A: PLATFORM_CONSOLE_ENABLED=true and PLATFORM_INVITATIONS_ENABLED=true, CUSTOMER_PUBLIC_ORIGIN set to a
 * fictional https origin that is never contacted. Server B: the console on, invitations OFF (the PO-02B page exactly).
 * One disposable database (dropped at the end): the reviewed schema and the PO-02D1B Trial seed (guarded runner),
 * fictional operators, companies and invitations. TEST-ONLY secrets are generated in memory and never printed; the
 * one-time links the browser receives are collected only to prove they appear nowhere else. Chromium is the
 * pre-installed build (PO01B_CHROMIUM, default /opt/pw-browsers/chromium) — nothing is downloaded.
 *
 * Proves: the flag-off page is PO-02B's; the create dialog (labelled modal, focus trap and return, validation without
 * a request, review of the offered Trial, refusals before a code is spent, wrong password, success); the one-time link
 * (shown once, Copy, not dismissible by Escape or a click outside, gone from the DOM when closed, never in the URL or
 * storage, the browser never contacts the customer origin); re-issue and revoke from a row (current-state check,
 * reason rules, changed-since-loaded, audit outage); the history view and the invitation detail; the discard prompt;
 * and EN / AR × light / dark × 1440 / 1024 / 390 screenshots with layout audits (one h1, named controls, labelled
 * fields, no horizontal scroll, white text on orange, RTL, no clipping).
 */
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Page, Request as PwRequest } from "playwright";
import { createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { section, ok, summary, describeError } from "./platform/harness";
import { startServer, testSecrets, type Server } from "./platform/browser-env";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");

const testDbName = disposableName("po02d2_browser");
const secrets = testSecrets();
const CUSTOMER_ORIGIN = "https://customer.erp.test";
process.env.DATABASE_URL = databaseUrlFor(testDbName);
Object.assign(process.env, secrets, { PLATFORM_CONSOLE_ENABLED: "true", PLATFORM_TRUSTED_PROXY_HOPS: "1" });

let created = false;
await createPlatformTestDatabase("po02d2_browser", testDbName);
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

const SHOTS = process.env.PO02D2_SCREENSHOT_DIR || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PORT_A = Number(process.env.PO02D2_PORT_A || 3447);
const PORT_B = Number(process.env.PO02D2_PORT_B || 3448);
const PASSWORD = "Harbor-Lattice-73!q";
const secretsSeen: string[] = [PASSWORD, ...Object.values(secrets)];
const tokensSeen: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Text as read, without the Unicode direction isolates the console puts around names and references. */
const plain = (s: string) => s.replace(/[⁦-⁩]/g, "");
const q = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
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
type Prefs = { locale: "en" | "ar"; theme: "light" | "dark" };
async function newContext(ip: string, server: Server, prefs: Prefs = { locale: "en", theme: "light" }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ baseURL: server.url, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce", extraHTTPHeaders: { "x-forwarded-for": ip }, permissions: ["clipboard-read", "clipboard-write"] });
  await setPrefs(ctx, server, prefs);
  contexts.push(ctx);
  return ctx;
}
async function setPrefs(ctx: BrowserContext, server: Server, prefs: Prefs) {
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
const shots: string[] = [];
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await sleep(150);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
  shots.push(name);
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

/** In-page audit (the PO-01B / PO-02B rules): one h1, named controls, labelled fields, no page overflow, white on orange, no storage. */
type AuditResult = { h1: number; lang: string; dir: string; theme: string | null; overflow: number; unnamed: string[]; unlabelled: string[]; orangeOffenders: string[]; storage: number; clipped: string[] };
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
    if (text && !el.classList.contains("sr-only") && el.closest("[role=dialog], .platform-timeline, .platform-terms, .platform-callout") && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "auto" && !["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) clipped.push(el.tagName.toLowerCase() + "." + String(el.className).slice(0, 40));
  }
  return { h1: document.querySelectorAll("h1").length, lang: document.documentElement.lang, dir: document.documentElement.dir, theme: document.documentElement.dataset.theme || null, overflow: document.documentElement.scrollWidth - window.innerWidth, unnamed, unlabelled, orangeOffenders: offenders, storage: localStorage.length + sessionStorage.length, clipped };
})()`;
const audit = async (page: Page) => (await page.evaluate(AUDIT_SCRIPT)) as AuditResult;
const auditOk = (a: AuditResult) => a.h1 === 1 && a.overflow <= 1 && a.unnamed.length === 0 && a.unlabelled.length === 0 && a.orangeOffenders.length === 0 && a.storage === 0 && a.clipped.length === 0;
const auditText = (a: AuditResult) => JSON.stringify({ ...a, unnamed: a.unnamed.slice(0, 2), unlabelled: a.unlabelled.slice(0, 2), orangeOffenders: a.orangeOffenders.slice(0, 2), clipped: a.clipped.slice(0, 3) });

async function auditOutage(on: boolean) {
  if (on) {
    await q(`create or replace function po02d2_test_only_fail_audit() returns trigger language plpgsql as $$ begin raise exception 'injected audit outage (test only)'; end $$`);
    await q(`create trigger po02d2_test_only_fail_audit before insert on platform_audit_events for each row execute function po02d2_test_only_fail_audit()`);
  } else {
    await q(`drop trigger if exists po02d2_test_only_fail_audit on platform_audit_events`);
    await q(`drop function if exists po02d2_test_only_fail_audit()`);
  }
}

// ---- fictional invitations (SQL fixtures, each with its terms row; the code under test creates the rest) --------
let trialVersion = "";
async function fixtureInvitation(f: { company: string; owner: string; email: string; createdAgoMs: number; ttlMs?: number; revokedBy?: string; acceptedOrg?: number }, by: string): Promise<{ id: string; reference: string }> {
  const created = new Date(Date.now() - f.createdAgoMs);
  const expires = new Date(created.getTime() + (f.ttlMs ?? 72 * 3_600_000));
  const token = randomBytes(32).toString("base64url");
  const [row] = await q<{ id: string }>(
    `insert into organization_invitations (company_name, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash, expires_at, accepted_at, accepted_org_id, revoked_at, revoked_by_platform_admin_id, invited_by_platform_admin_id, created_at, updated_at)
     values ($1, $2, 'Saudi Arabia', 'SAR', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) returning id`,
    [f.company, `office.${f.email}`, f.owner, f.email, sha256(token), expires, f.acceptedOrg ? new Date(created.getTime() + 60_000) : null, f.acceptedOrg ?? null, f.revokedBy ? new Date(created.getTime() + 120_000) : null, f.revokedBy ?? null, by, created],
  );
  await q("insert into organization_invitation_terms (invitation_id, initial_package_version_id, initial_version_state, initial_is_trial, initial_cycle, created_at) values ($1, $2, 'published', true, 'trial', $3)", [row.id, trialVersion, created]);
  return { id: row.id, reference: `INV-${row.id.slice(0, 8).toUpperCase()}` };
}
const invState = async (id: string) => (await q<{ revoked_at: Date | null; accepted_at: Date | null }>("select revoked_at, accepted_at from organization_invitations where id = $1", [id]))[0];
const linkInDom = (page: Page) => page.evaluate(() => document.documentElement.outerHTML.includes("#t=") || [...document.querySelectorAll("input")].some((i) => (i as HTMLInputElement).value.includes("#t=")));

async function main() {
  const owner = await createAdmin("owner@invite-browser.test", "Test Operator");
  const ops = await createAdmin("ops@invite-browser.test", "Background Operator");
  trialVersion = (await q<{ id: string }>("select v.id from subscription_package_versions v join subscription_packages p on p.id = v.package_id where p.code = 'trial' and v.version_number = 1"))[0].id;
  const HOUR = 3_600_000;
  const [existingOrg] = await q<{ id: number }>("insert into orgs (name, country, currency) values ('Existing Fixture Holding', 'Saudi Arabia', 'SAR') returning id");
  await q("insert into users (org_id, email, password_hash, name, role) values ($1, 'Existing.Owner@Invite-Browser.test', '$2a$10$abcdefghijklmnopqrstuuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZa', 'Existing Owner', 'owner')", [existingOrg.id]);
  const [acceptedOrg] = await q<{ id: number }>("insert into orgs (name, country, currency) values ('Accepted Fixture Org', 'Saudi Arabia', 'SAR') returning id");
  const F1 = await fixtureInvitation({ company: "Nakheel Fixture Trading", owner: "Nora Fixture", email: "nakheel.owner@invite-browser.test", createdAgoMs: 2 * HOUR }, ops.id);
  const F2 = await fixtureInvitation({ company: "Rawabi Fixture Events", owner: "Rami Fixture", email: "rawabi.owner@invite-browser.test", createdAgoMs: 3 * HOUR }, ops.id);
  const F3 = await fixtureInvitation({ company: "Sahil Fixture Logistics", owner: "Salma Fixture", email: "sahil.owner@invite-browser.test", createdAgoMs: 4 * HOUR }, ops.id);
  const F4 = await fixtureInvitation({ company: "Qimma Fixture Retail", owner: "Qasim Fixture", email: "qimma.owner@invite-browser.test", createdAgoMs: 5 * HOUR }, ops.id);
  const F5 = await fixtureInvitation({ company: "Waha Fixture Services", owner: "Wafa Fixture", email: "waha.owner@invite-browser.test", createdAgoMs: 6 * HOUR }, ops.id);
  await fixtureInvitation({ company: "مؤسسة الواحة للتجارة", owner: "خالد الحربي", email: "khalid.owner@invite-browser.test", createdAgoMs: 7 * HOUR }, ops.id);
  const E1 = await fixtureInvitation({ company: "Dana Fixture Trading", owner: "Dana Fixture", email: "dana.owner@invite-browser.test", createdAgoMs: 5 * 24 * HOUR }, ops.id);
  await fixtureInvitation({ company: "Faisal Fixture Group", owner: "Faisal Fixture", email: "faisal.owner@invite-browser.test", createdAgoMs: 2 * 24 * HOUR, revokedBy: ops.id }, ops.id);
  await fixtureInvitation({ company: "Accepted Fixture Org", owner: "Amal Fixture", email: "amal.owner@invite-browser.test", createdAgoMs: 3 * 24 * HOUR, acceptedOrg: acceptedOrg.id }, ops.id);
  const before = {
    orgs: (await q<{ n: number }>("select count(*)::int as n from orgs"))[0].n,
    users: (await q<{ n: number }>("select count(*)::int as n from users"))[0].n,
    sessions: (await q<{ n: number }>("select count(*)::int as n from sessions"))[0].n,
  };

  browser = await chromium.launch({ executablePath: process.env.PO01B_CHROMIUM || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const common = { ...secrets, DATABASE_URL: process.env.DATABASE_URL, PLATFORM_CONSOLE_ENABLED: "true", PLATFORM_TRUSTED_PROXY_HOPS: "1", CUSTOMER_PUBLIC_ORIGIN: CUSTOMER_ORIGIN };
  A = await startServer(PORT_A, { ...common, PLATFORM_INVITATIONS_ENABLED: "true" });
  B = await startServer(PORT_B, { ...common, PLATFORM_INVITATIONS_ENABLED: undefined });

  // Every request any page makes is recorded: none may go to the customer origin (or anywhere but the console).
  const foreign: string[] = [];
  const watch = (page: Page) =>
    page.on("request", (r: PwRequest) => {
      const host = new URL(r.url()).hostname;
      if (host !== "localhost" && host !== "127.0.0.1") foreign.push(host);
    });

  // ------------------------------------------------------------------------------------------------
  section("1. Invitations OFF (PLATFORM_INVITATIONS_ENABLED unset): the PO-02B page, unchanged");
  {
    const bctx = await newContext("198.51.100.30", B);
    const bpage = await platformSignIn(bctx, owner);
    watch(bpage);
    await go(bpage, "/platform/companies?view=invitations");
    const preview = bpage.getByRole("button", { name: /Invite company — Planned for PO-02D/ });
    ok("#23 Invite company is the disabled PO-02B preview naming its phase", (await preview.count()) === 1 && (await preview.isDisabled()));
    ok("#23 no history segment, no Actions column, no Re-issue / Revoke control, company names are plain text (no detail link)", (await bpage.getByRole("link", { name: /Invitation history/ }).count()) === 0 && (await bpage.getByRole("columnheader", { name: "Actions" }).count()) === 0 && (await bpage.getByRole("button", { name: /^(Re-issue|Revoke) INV-/ }).count()) === 0 && (await bpage.getByRole("link", { name: "Nakheel Fixture Trading" }).count()) === 0);
    const bodyText = await bpage.locator("main").innerText();
    ok("#23 the PO-02B notes are shown (creating, resending and revoking arrive in PO-02D)", bodyText.includes("Creating, resending and revoking invitations arrives in phase PO-02D."));
    const hist = await go(bpage, "/platform/companies?view=history");
    ok("#23 ?view=history falls back to the registered directory (no history view exists while the flag is off)", hist?.status() === 200 && (await bpage.getByRole("link", { name: /Registered/ }).first().getAttribute("aria-current")) === "page");
    await go(bpage, `/platform/companies/invitations/${F1.id}`);
    const nf = await bpage.locator("main").innerText();
    ok("#23 the invitation detail route is \"Invitation not found\" inside the console (no data: not even the company name)", (await bpage.locator("h1").innerText()).trim() === "Invitation not found" && !nf.includes("Nakheel") && !nf.includes(F1.reference));
    await go(bpage, "/platform/dashboard");
    ok("#23 the dashboard keeps the disabled preview too", (await bpage.getByRole("button", { name: /Invite company — Planned for PO-02D/ }).isDisabled()));
    await bctx.close();
  }

  // ------------------------------------------------------------------------------------------------
  section("2. Invitations ON: the pending list with its actions, the Invite control, the history segment");
  const pctx = await newContext("198.51.100.40", A);
  const page = await platformSignIn(pctx, owner);
  watch(page);
  const posts: PwRequest[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") posts.push(r);
  });
  {
    await go(page, "/platform/companies?view=invitations");
    const invite = page.getByRole("button", { name: "Invite company", exact: true });
    ok("an ENABLED Invite company button (a dialog trigger)", (await invite.isEnabled()) && (await invite.getAttribute("aria-haspopup")) === "dialog");
    ok("the views: Registered, Pending invitations, Invitation history", (await page.getByRole("link", { name: /^Invitation history/ }).count()) === 1);
    ok("an Actions column (Re-issue, Revoke on each pending or expired row); the company name links to the invitation's detail and history",
      (await page.getByRole("columnheader", { name: "Actions" }).count()) === 1 && (await page.getByRole("button", { name: `Re-issue ${F1.reference}` }).count()) === 1 && (await page.getByRole("button", { name: `Revoke ${E1.reference}` }).count()) === 1 && (await page.getByRole("link", { name: "Nakheel Fixture Trading" }).getAttribute("href")) === `/platform/companies/invitations/${F1.id}`);
    const rowHeights = await page.locator(".platform-company-table tbody tr").evaluateAll((rows) => rows.map((r) => Math.round(r.getBoundingClientRect().height)));
    ok("#24 the actions fit on one line at 1440 (every row is a single line high)", rowHeights.length > 0 && Math.max(...rowHeights) <= 80, JSON.stringify(rowHeights));
    const note = await page.locator("main").innerText();
    ok("the slot note now explains re-issue (and no 'arrives in PO-02D' promise remains)", note.includes("Re-issuing creates a new link and revokes the current one.") && !note.includes("arrives in phase PO-02D"));
    const a = await audit(page);
    ok("layout audit (EN, light, 1440)", auditOk(a) && a.dir === "ltr" && a.lang === "en", auditText(a));
    await shot(page, "01-pending-en-light-1440");
  }

  // ------------------------------------------------------------------------------------------------
  section("3. Create: labelled modal, focus trap, validation without a request, review of the offered Trial");
  let createdRef = "";
  let createdLink = "";
  {
    const trigger = page.getByRole("button", { name: "Invite company", exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });
    const modal = await page.evaluate(() => {
      const d = document.querySelector("[role=dialog]");
      const title = d?.getAttribute("aria-labelledby") ? (document.getElementById(d.getAttribute("aria-labelledby") ?? "")?.textContent ?? "") : "";
      const described = !!(d?.getAttribute("aria-describedby") && document.getElementById(d.getAttribute("aria-describedby") ?? ""));
      const header = document.querySelector("header");
      const hiddenOutside = !!header && (header.closest("[aria-hidden=true]") !== null || header.closest("[inert]") !== null);
      return { title, described, hiddenOutside, focusInside: !!document.activeElement?.closest("[role=dialog]") };
    });
    ok("#24 the keyboard opens a labelled modal (title Invite a company, described), the page behind is hidden from assistive technology, focus inside", plain(modal.title) === "Invite a company" && modal.described && modal.hiddenOutside && modal.focusInside, JSON.stringify(modal));
    let trapped = true;
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press("Tab");
      trapped = trapped && (await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]")));
    }
    ok("#24 Tab cycles inside the dialog (focus trap)", trapped);
    const dialogText = await dialog.innerText();
    ok("the dialog states plainly that nothing is sent (copy-link only)", dialogText.includes("Nothing is emailed or sent: you copy the link and deliver it yourself."));
    await shot(page, "10-create-form-en-light-1440");
    const posts0 = posts.length;
    await dialog.getByRole("button", { name: "Continue" }).click();
    await sleep(300);
    const errText = await dialog.innerText();
    ok("#15 an empty form shows every field error and sends NO request", ["Enter a company name of up to 200 characters.", "Enter a valid email address.", "Choose a country.", "Choose a currency.", "Enter the owner's name, up to 200 characters."].every((t) => errText.includes(t)) && posts.length === posts0, `${posts.length - posts0} posts`);
    ok("#15 …each invalid field is marked aria-invalid and points at its error", (await page.locator("#invite-companyName").getAttribute("aria-invalid")) === "true" && (await page.locator("#invite-companyName").getAttribute("aria-describedby")) === "invite-companyName-error");
    await shot(page, "11-create-validation-en-light-1440");
    await page.locator("#invite-companyName").fill("Lulu Fixture Exhibitions");
    await page.locator("#invite-industry").fill("Exhibitions");
    await page.locator("#invite-companyEmail").fill("hello@lulu-fixture.test");
    await page.locator("#invite-country").selectOption("Saudi Arabia");
    ok("choosing the country fills its currency (SAR) until the operator picks one", (await page.locator("#invite-currency").inputValue()) === "SAR");
    await page.locator("#invite-ownerName").fill("Lina Fixture");
    await page.locator("#invite-ownerEmail").fill("  Lina.Owner@Lulu-Fixture.TEST ");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByText("Offered terms").waitFor({ timeout: 15_000 });
    const review = plain(await dialog.innerText());
    ok("#2 the review shows the offered terms: Trial version 1, 14 days, 3 users, 5 GB, SAR 0.00, cycle Trial", ["Trial · version 1", "14 days", "5 GB", "SAR 0.00", "Billing cycle"].every((t) => review.includes(t)) && /Users\s*3/.test(review), review.slice(0, 400));
    ok("#14 …the owner e-mail as it will be stored (lower case, trimmed); the 72-hour validity is stated", review.includes("lina.owner@lulu-fixture.test") && review.includes("The link is valid for 72 hours."));
    ok("#24 the step-up asks for the password and a verification code", (await dialog.getByLabel("Password", { exact: true }).count()) === 1 && (await dialog.getByLabel("Verification code", { exact: true }).count()) === 1);
    await shot(page, "12-create-review-en-light-1440");

    // A wrong password: refused by the server, fields cleared, nothing created (the code is not consumed by a password failure).
    const code = await freshCode(owner);
    await dialog.getByLabel("Password", { exact: true }).fill("Wrong-Password-11!x");
    await dialog.getByLabel("Verification code", { exact: true }).fill(code);
    await dialog.getByRole("button", { name: "Create invitation" }).click();
    await dialog.getByText("The email or password is incorrect.").waitFor({ timeout: 15_000 });
    ok("#9 a wrong password: the server refuses, password and code are cleared, no invitation exists", (await dialog.getByLabel("Password", { exact: true }).inputValue()) === "" && (await dialog.getByLabel("Verification code", { exact: true }).inputValue()) === "" && (await q("select 1 from organization_invitations where owner_email_normalized = 'lina.owner@lulu-fixture.test'")).length === 0);
    // Correct.
    await dialog.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await dialog.getByLabel("Verification code", { exact: true }).fill(code);
    await dialog.getByRole("button", { name: "Create invitation" }).click();
    await page.locator("#invitation-link").waitFor({ timeout: 20_000 });
    createdLink = await page.locator("#invitation-link").inputValue();
    tokensSeen.push(createdLink.split("#t=")[1] ?? "");
    const panel = plain(await dialog.innerText());
    createdRef = (panel.match(/INV-[0-9A-F]{8}/) ?? [""])[0];
    const row = (await q<{ token_hash: string }>("select token_hash from organization_invitations where owner_email_normalized = 'lina.owner@lulu-fixture.test' and revoked_at is null"))[0];
    ok("#2 success: the link panel shows the reference and the link — the canonical origin, /register/accept, the token in the fragment", createdLink.startsWith(`${CUSTOMER_ORIGIN}/register/accept#t=`) && /^[A-Za-z0-9_-]{43}$/.test(createdLink.split("#t=")[1] ?? "") && /^INV-[0-9A-F]{8}$/.test(createdRef));
    ok("#2 …the database holds only sha256 of that token", !!row && row.token_hash === sha256(createdLink.split("#t=")[1] ?? ""));
    ok("#4 the panel warns it is shown once, that acceptance does not exist yet (PO-02D3), and gives the expiry", panel.includes("This link is shown only once.") && panel.includes("Invitation acceptance is not available yet (phase PO-02D3).") && panel.includes("Do not send this link to a real customer") && /Expires /.test(panel));
    ok("#24 the link field is read-only and left-to-right", (await page.locator("#invitation-link").getAttribute("readonly")) !== null && (await page.locator("#invitation-link").getAttribute("dir")) === "ltr");
    await dialog.getByRole("button", { name: "Copy link" }).click();
    await dialog.getByText("Link copied.").waitFor({ timeout: 5_000 });
    ok("#4 Copy puts exactly the link on the clipboard and says so (aria-live)", (await page.evaluate(() => navigator.clipboard.readText())) === createdLink);
    await shot(page, "13-create-link-en-light-1440");
    await page.keyboard.press("Escape");
    await sleep(300);
    await page.mouse.click(5, 5);
    await sleep(300);
    ok("#4 Escape and a click outside do NOT close the link panel (only Done does)", await page.locator("#invitation-link").isVisible());
    ok("#4 the link is not in the URL, a cookie or browser storage", !page.url().includes("#t=") && !(await pctx.cookies()).some((c) => c.value.includes(createdLink.split("#t=")[1] ?? "x")) && (await page.evaluate(() => localStorage.length + sessionStorage.length)) === 0);
    await dialog.getByRole("button", { name: "Done — I have copied the link" }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByText(createdRef).first().waitFor({ timeout: 15_000 });
    ok("#4 after Done the link is gone from the DOM (no field, no text, no attribute holds it)", !(await linkInDom(page)));
    ok("#24 …focus returned to the Invite company button", await page.evaluate(() => document.activeElement?.tagName === "BUTTON" && (document.activeElement?.textContent ?? "").trim() === "Invite company"));
    ok("…and the pending list shows the new invitation", (await page.getByRole("button", { name: `Revoke ${createdRef}` }).count()) === 1);
    await page.reload();
    await settled(page);
    ok("#4 a reload cannot show the link again (no field, no text)", !(await linkInDom(page)));
  }

  // ------------------------------------------------------------------------------------------------
  section("4. Refusals shown at review, before any code is spent; the company-name confirmation (I-10)");
  {
    const openForm = async (f: { company: string; email: string }) => {
      await page.getByRole("button", { name: "Invite company", exact: true }).click();
      const d = page.getByRole("dialog");
      await d.waitFor({ state: "visible" });
      await page.locator("#invite-companyName").fill(f.company);
      await page.locator("#invite-companyEmail").fill("office@review-fixture.test");
      await page.locator("#invite-country").selectOption("Saudi Arabia");
      await page.locator("#invite-ownerName").fill("Review Fixture");
      await page.locator("#invite-ownerEmail").fill(f.email);
      await d.getByRole("button", { name: "Continue" }).click();
      await d.getByText("Offered terms").waitFor({ timeout: 15_000 });
      return d;
    };
    const closeForm = async (d: ReturnType<Page["getByRole"]>) => {
      await page.keyboard.press("Escape");
      await d.getByRole("button", { name: "Discard" }).click();
      await d.waitFor({ state: "hidden" });
    };
    let d = await openForm({ company: "Pending Twin Co", email: "NAKHEEL.owner@invite-browser.test" });
    let t = plain(await d.innerText());
    ok("#12 an owner e-mail with a pending invitation → the warning names it; no step-up and no Create button", t.includes(`An invitation for this owner email is already pending: ${F1.reference}.`) && (await d.getByRole("button", { name: "Create invitation" }).count()) === 0 && (await d.getByLabel("Password", { exact: true }).count()) === 0);
    await shot(page, "14-create-pending-conflict-en-light-1440");
    await closeForm(d);
    d = await openForm({ company: "Existing User Co", email: "existing.owner@invite-browser.test" });
    t = plain(await d.innerText());
    ok("#14 an e-mail a customer user holds in another letter case → refused at review", t.includes("A customer account already uses this owner email (in any letter case)") && (await d.getByRole("button", { name: "Create invitation" }).count()) === 0);
    await closeForm(d);
    d = await openForm({ company: "existing fixture holding", email: "new.owner@review-fixture.test" });
    t = plain(await d.innerText());
    ok("#15 a name matching a registered company → a warning and a confirmation checkbox", t.includes("This name matches 1 registered companies and 0 pending invitations.") && (await page.locator("#invite-name-confirm").count()) === 1);
    const posts0 = posts.length;
    const code = await freshCode(owner);
    await d.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await d.getByLabel("Verification code", { exact: true }).fill(code);
    await d.getByRole("button", { name: "Create invitation" }).click();
    await sleep(300);
    ok("#15 …submitting without the confirmation is stopped in the browser (no request)", (await d.innerText()).includes("Confirm that this is a different company to continue.") && posts.length === posts0);
    await page.locator("#invite-name-confirm").click();
    await d.getByRole("button", { name: "Create invitation" }).click();
    await page.locator("#invitation-link").waitFor({ timeout: 20_000 });
    tokensSeen.push((await page.locator("#invitation-link").inputValue()).split("#t=")[1] ?? "");
    ok("#15 …once confirmed, the invitation is created", (await q("select 1 from organization_invitations where owner_email_normalized = 'new.owner@review-fixture.test'")).length === 1);
    await d.getByRole("button", { name: "Done — I have copied the link" }).click();
    await d.waitFor({ state: "hidden" });
  }

  // ------------------------------------------------------------------------------------------------
  section("5. The discard prompt (Escape with unsaved details), by keyboard");
  {
    const trigger = page.getByRole("button", { name: "Invite company", exact: true });
    await trigger.click();
    const d = page.getByRole("dialog");
    await d.waitFor({ state: "visible" });
    await page.locator("#invite-companyName").fill("Half Typed Fixture Co");
    await page.keyboard.press("Escape");
    await d.getByText("Discard this invitation?").waitFor({ timeout: 5_000 });
    ok("#24 Escape with typed details asks before discarding them", true);
    await shot(page, "15-create-discard-en-light-1440");
    await page.keyboard.press("Escape");
    await page.locator("#invite-companyName").waitFor({ timeout: 5_000 });
    ok("#24 …Escape on the prompt returns to the form with the details kept", (await page.locator("#invite-companyName").inputValue()) === "Half Typed Fixture Co");
    await page.keyboard.press("Escape");
    await d.getByRole("button", { name: "Discard" }).click();
    await d.waitFor({ state: "hidden" });
    ok("#24 …Discard closes the dialog and focus returns to the trigger", await page.evaluate(() => document.activeElement?.tagName === "BUTTON" && (document.activeElement?.textContent ?? "").trim() === "Invite company"));
  }

  // ------------------------------------------------------------------------------------------------
  section("6. Re-issue and revoke from a row: current-state check, reason rules, changed state, audit outage");
  let reissuedRef = "";
  {
    // Re-issue F3.
    await page.getByRole("button", { name: `Re-issue ${F3.reference}` }).click();
    const d = page.getByRole("dialog");
    await d.waitFor({ state: "visible" });
    await page.locator(`#reissue-${F3.id}-password`).waitFor({ timeout: 10_000 });
    await page.waitForFunction((id) => !(document.getElementById(id) as HTMLInputElement | null)?.disabled, `reissue-${F3.id}-totp`, { timeout: 10_000 });
    const t = plain(await d.innerText());
    ok("#17 the re-issue dialog names the invitation and explains the effects (old link stops, new 72-hour link, current Trial, nothing sent)",
      t.includes(`Re-issue invitation ${F3.reference}`) && t.includes("The current link stops working immediately.") && t.includes("A new link, valid for 72 hours, is created for the same company and owner.") && t.includes("The new invitation offers the current default Trial."));
    await shot(page, "20-reissue-dialog-en-light-1440");
    await page.locator(`#reissue-${F3.id}-password`).fill(PASSWORD);
    await page.locator(`#reissue-${F3.id}-totp`).fill(await freshCode(owner));
    await d.getByRole("button", { name: "Re-issue invitation" }).click();
    await page.locator("#invitation-link").waitFor({ timeout: 20_000 });
    const link = await page.locator("#invitation-link").inputValue();
    tokensSeen.push(link.split("#t=")[1] ?? "");
    const panel = plain(await d.innerText());
    reissuedRef = (panel.match(/New invitation: (INV-[0-9A-F]{8})/) ?? ["", ""])[1];
    ok("#17 the new link is shown once, with the new reference and the previous one revoked", link.startsWith(`${CUSTOMER_ORIGIN}/register/accept#t=`) && /^INV-[0-9A-F]{8}$/.test(reissuedRef) && panel.includes(`previous invitation ${F3.reference} revoked`) && (await invState(F3.id)).revoked_at !== null);
    await shot(page, "21-reissue-link-en-light-1440");
    await d.getByRole("button", { name: "Done — I have copied the link" }).click();
    await d.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: `Revoke ${reissuedRef}` }).waitFor({ timeout: 15_000 });
    ok("#17 …the list now shows the new invitation and no longer the revoked one; no link left in the DOM", (await page.getByRole("button", { name: `Re-issue ${F3.reference}` }).count()) === 0 && !(await linkInDom(page)));

    // Revoke F2: the reason rules, then success.
    await page.getByRole("button", { name: `Revoke ${F2.reference}` }).click();
    await d.waitFor({ state: "visible" });
    await page.waitForFunction((id) => !(document.getElementById(id) as HTMLInputElement | null)?.disabled, `revoke-${F2.id}-reason`, { timeout: 10_000 });
    ok("#16 the revoke dialog asks for a reason and a code — no password", (await page.locator(`#revoke-${F2.id}-reason`).count()) === 1 && (await page.locator(`#revoke-${F2.id}-password`).count()) === 0);
    const posts0 = posts.length;
    await page.locator(`#revoke-${F2.id}-reason`).fill("too short");
    await page.locator(`#revoke-${F2.id}-totp`).fill("123456");
    await d.getByRole("button", { name: "Revoke invitation" }).click();
    await sleep(300);
    ok("#16 a 9-character reason is stopped in the browser (no request)", (await d.innerText()).includes("Enter a reason of 10 to 500 characters.") && posts.length === posts0);
    await shot(page, "22-revoke-validation-en-light-1440");
    await page.locator(`#revoke-${F2.id}-reason`).fill("Fixture: the company withdrew its request");
    await page.locator(`#revoke-${F2.id}-totp`).fill(await freshCode(owner));
    await d.getByRole("button", { name: "Revoke invitation" }).click();
    await d.getByText(new RegExp(`Invitation [\u2066-\u2069]?${F2.reference}[\u2066-\u2069]? revoked\\.`)).waitFor({ timeout: 20_000 });
    ok("#16 success: the invitation is revoked, attributed and audited with the reason", (await invState(F2.id)).revoked_at !== null && (await q("select 1 from platform_audit_events where action = 'invitation.revoked' and entity_id = $1 and reason = 'Fixture: the company withdrew its request'", [F2.id])).length === 1);
    await d.getByRole("button", { name: "Done" }).click();
    await d.waitFor({ state: "hidden" });
    // Done refreshes the page; wait until the refreshed list no longer has the revoked row (so the page is settled).
    await page.getByRole("button", { name: `Revoke ${F2.reference}` }).waitFor({ state: "detached", timeout: 15_000 });
    ok("#16 …after Done the refreshed list no longer shows the revoked invitation", (await page.getByRole("button", { name: `Revoke ${F2.reference}` }).count()) === 0);

    // Changed since the page loaded: F4 is revoked elsewhere, then its dialog is opened.
    await q("update organization_invitations set revoked_at = now(), revoked_by_platform_admin_id = $2, updated_at = now() where id = $1", [F4.id, ops.id]);
    await page.getByRole("button", { name: `Revoke ${F4.reference}` }).click();
    await d.getByText("This invitation changed since the page loaded. Refresh to see its current state.").waitFor({ timeout: 10_000 });
    ok("#19 a dialog opened on a stale row reads the current state first → 'changed', with Refresh and no form to confirm", (await page.locator(`#revoke-${F4.id}-reason`).count()) === 0);
    await shot(page, "23-changed-en-light-1440");
    await d.getByRole("button", { name: "Refresh" }).click();
    await d.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: `Revoke ${F4.reference}` }).waitFor({ state: "detached", timeout: 15_000 });
    ok("#19 …Refresh shows the current list (the row revoked elsewhere is gone)", (await page.getByRole("button", { name: `Revoke ${F4.reference}` }).count()) === 0 && (await page.getByRole("button", { name: `Revoke ${F5.reference}` }).count()) === 1);

    // Audit outage at submit: nothing applied, the operator is told the truth; Cancel returns focus to the row's button.
    await page.getByRole("button", { name: `Revoke ${F5.reference}` }).click();
    await page.waitForFunction((id) => !(document.getElementById(id) as HTMLInputElement | null)?.disabled, `revoke-${F5.id}-reason`, { timeout: 10_000 });
    await page.locator(`#revoke-${F5.id}-reason`).fill("Fixture: attempt during an audit outage");
    await page.locator(`#revoke-${F5.id}-totp`).fill(await freshCode(owner));
    await auditOutage(true);
    try {
      await d.getByRole("button", { name: "Revoke invitation" }).click();
      await d.getByText("This change was not applied because it could not be recorded in the audit trail.").waitFor({ timeout: 20_000 });
    } finally {
      await auditOutage(false);
    }
    ok("#18 an audit outage: 'not applied because it could not be recorded'; the invitation is still pending", (await invState(F5.id)).revoked_at === null);
    await shot(page, "24-audit-outage-en-light-1440");
    await d.getByRole("button", { name: "Cancel" }).click();
    await d.waitFor({ state: "hidden" });
    ok("#24 Cancel closes the dialog and focus returns to that row's Revoke button", await page.evaluate((ref) => document.activeElement?.getAttribute("aria-label") === `Revoke ${ref}`, F5.reference));
  }

  // ------------------------------------------------------------------------------------------------
  section("7. The history view and the invitation detail (audited view, timeline, no link)");
  {
    await go(page, "/platform/companies?view=history");
    const states = await page.locator(".platform-company-table [data-status-domain='platform.invitation']").evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("data-status")))].sort());
    ok("#24 the history lists every state as a labelled tag: accepted, expired, pending, revoked", JSON.stringify(states) === JSON.stringify(["accepted", "expired", "pending", "revoked"]), JSON.stringify(states));
    const a = await audit(page);
    ok("layout audit (history, EN, light, 1440)", auditOk(a), auditText(a));
    await shot(page, "30-history-en-light-1440");
    await page.locator("#history-state").selectOption("revoked");
    await page.getByRole("button", { name: "Apply" }).click();
    await page.waitForURL(/state=revoked/, { timeout: 15_000 });
    await settled(page);
    const filtered = await page.locator(".platform-company-table [data-status-domain='platform.invitation']").evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
    ok("#24 the state filter (Revoked) shows only revoked invitations", filtered.length >= 3 && filtered.every((s) => s === "revoked"), JSON.stringify(filtered));
    const views0 = Number((await q<{ n: number }>("select count(*)::int as n from platform_audit_events where action = 'invitation.viewed'"))[0].n);
    await go(page, `/platform/companies/invitations/${F3.id}`);
    const t = plain(await page.locator("main").innerText());
    ok("#24 the detail: breadcrumbs, the status, the no-acceptance warning, details, offered terms and the timeline",
      t.includes("Invitation acceptance is not available in this phase (PO-02D3).") && t.includes("Sahil Fixture Logistics") && t.includes("Offered terms") && t.includes("14 days") && t.includes("Invitation revoked") && t.includes(`Re-issued as ${reissuedRef}`) && plain(await page.locator(".platform-breadcrumbs").innerText()).replace(/\s+/g, " ").includes(`Companies Pending invitations ${F3.reference}`));
    ok("#24 …a revoked invitation offers no Re-issue or Revoke", (await page.getByRole("button", { name: /^(Re-issue|Revoke) INV-/ }).count()) === 0);
    ok("#4 …opening it is an audited view (invitation.viewed), and the page holds no link", Number((await q<{ n: number }>("select count(*)::int as n from platform_audit_events where action = 'invitation.viewed'"))[0].n) === views0 + 1 && !(await linkInDom(page)));
    const a2 = await audit(page);
    ok("layout audit (detail, EN, light, 1440)", auditOk(a2), auditText(a2));
    await shot(page, "31-detail-revoked-en-light-1440");
    await page.getByRole("link", { name: reissuedRef }).first().click();
    await page.waitForURL(/view=history/, { timeout: 15_000 });
    await settled(page);
    ok("#24 the related reference links to its row in the history", (await page.getByText(reissuedRef).count()) >= 1);
    const newId = (await q<{ id: string }>("select id from organization_invitations where upper(substr(id::text, 1, 8)) = $1", [reissuedRef.slice(4)]))[0].id;
    await go(page, `/platform/companies/invitations/${newId}`);
    const t2 = plain(await page.locator("main").innerText());
    ok("#24 the re-issued invitation's detail: pending, 'Invitation re-issued', 'Replaces' the old reference, with Re-issue and Revoke", t2.includes("Invitation re-issued") && t2.includes(`Replaces ${F3.reference}`) && (await page.getByRole("button", { name: `Revoke ${reissuedRef}` }).count()) === 1);
    await shot(page, "32-detail-pending-en-light-1440");
    const views1 = Number((await q<{ n: number }>("select count(*)::int as n from platform_audit_events where action = 'invitation.viewed'"))[0].n);
    let notFoundOk = true;
    for (const path of ["/platform/companies/invitations/00000000-0000-4000-8000-000000000000", "/platform/companies/invitations/not-a-uuid"]) {
      await go(page, path);
      notFoundOk = notFoundOk && (await page.locator("h1").innerText()).trim() === "Invitation not found" && (await page.getByRole("link", { name: "Back to pending invitations" }).isVisible());
    }
    ok("#24 an unknown or malformed invitation id → \"Invitation not found\" with a way back, and no audit record for it", notFoundOk && Number((await q<{ n: number }>("select count(*)::int as n from platform_audit_events where action = 'invitation.viewed'"))[0].n) === views1);
  }

  // ------------------------------------------------------------------------------------------------
  section("8. EN / AR × light / dark × 1440 / 1024 / 390: pending list, history, detail, dialogs");
  {
    const newId = (await q<{ id: string }>("select id from organization_invitations where upper(substr(id::text, 1, 8)) = $1", [reissuedRef.slice(4)]))[0].id;
    const combos: [Prefs, number, number][] = [];
    for (const locale of ["en", "ar"] as const) for (const theme of ["light", "dark"] as const) for (const [w, h] of [[1440, 900], [1024, 768], [390, 844]] as const) combos.push([{ locale, theme }, w, h]);
    let allOk = true;
    const failures: string[] = [];
    for (const [prefs, w, h] of combos) {
      await setPrefs(pctx, A, prefs);
      await page.setViewportSize({ width: w, height: h });
      for (const [name, path] of [["pending", "/platform/companies?view=invitations"], ["history", "/platform/companies?view=history"], ["detail", `/platform/companies/invitations/${newId}`]] as const) {
        await go(page, path);
        const a = await audit(page);
        const good = auditOk(a) && a.lang === prefs.locale && a.dir === (prefs.locale === "ar" ? "rtl" : "ltr") && a.theme === prefs.theme;
        if (!good) {
          allOk = false;
          failures.push(`${name}-${prefs.locale}-${prefs.theme}-${w}: ${auditText(a)}`);
        }
        await shot(page, `4${name === "pending" ? 0 : name === "history" ? 1 : 2}-${name}-${prefs.locale}-${prefs.theme}-${w}`);
      }
      // The create dialog's form at every size (no request is sent).
      await go(page, "/platform/companies?view=invitations");
      await page.getByRole("button", { name: prefs.locale === "ar" ? "دعوة شركة" : "Invite company", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "visible" });
      const da = await audit(page);
      if (!(da.overflow <= 1 && da.unnamed.length === 0 && da.unlabelled.length === 0 && da.orangeOffenders.length === 0 && da.clipped.length === 0)) {
        allOk = false;
        failures.push(`dialog-${prefs.locale}-${prefs.theme}-${w}: ${auditText(da)}`);
      }
      await shot(page, `43-create-form-${prefs.locale}-${prefs.theme}-${w}`);
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
    }
    ok(`#24 all ${combos.length} combinations × (pending, history, detail, create dialog): one h1, named controls, labelled fields, no horizontal scroll, white on orange, no clipping, lang / dir / theme applied`, allOk, failures.slice(0, 3).join(" | "));
    await setPrefs(pctx, A, { locale: "ar", theme: "light" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await go(page, "/platform/companies?view=history");
    const ar = await page.locator("main").innerText();
    ok("#24 Arabic: natural labels (سجل الدعوات، مسحوبة، مقبولة، معلّقة، منتهية الصلاحية) and Latin values isolated", ["سجل الدعوات", "مسحوبة", "مقبولة", "معلّقة", "منتهية الصلاحية"].every((s) => ar.includes(s)) && (await page.locator("bdi[dir=ltr], [dir=ltr]").count()) > 0);
    await go(page, `/platform/companies/invitations/${newId}`);
    const arDetail = await page.locator("main").innerText();
    ok("#24 Arabic detail: the timeline and the system reasons read in Arabic (أُعيد إصدار الدعوة، بدلًا من الدعوة)", arDetail.includes("أُعيد إصدار الدعوة") && arDetail.includes("بدلًا من الدعوة") && arDetail.includes("قبول الدعوات غير متاح في هذه المرحلة"));
  }

  // ------------------------------------------------------------------------------------------------
  section("9. A full create on a phone in Arabic and dark mode: the bottom sheet and the stacked link row");
  {
    await setPrefs(pctx, A, { locale: "ar", theme: "dark" });
    await page.setViewportSize({ width: 390, height: 844 });
    await go(page, "/platform/companies?view=invitations");
    ok("#24 on a phone the pending rows are cards with their actions", (await page.getByRole("button", { name: `إعادة إصدار ${F1.reference}` }).count()) === 1);
    await page.getByRole("button", { name: "دعوة شركة", exact: true }).click();
    const d = page.getByRole("dialog");
    await d.waitFor({ state: "visible" });
    const box = await d.boundingBox();
    ok("#24 the dialog is a bottom sheet: full width, flush with the bottom of the screen", !!box && Math.abs(box.width - 390) <= 1 && Math.abs(box.y + box.height - 844) <= 2, JSON.stringify(box));
    await page.locator("#invite-companyName").fill("شركة الريادة للمعارض");
    await page.locator("#invite-companyEmail").fill("info@riyada-fixture.test");
    await page.locator("#invite-country").selectOption("Saudi Arabia");
    await page.locator("#invite-ownerName").fill("سارة العتيبي");
    await page.locator("#invite-ownerEmail").fill("sara.owner@riyada-fixture.test");
    await d.getByRole("button", { name: "متابعة" }).click();
    await d.getByText("الشروط المعروضة").waitFor({ timeout: 15_000 });
    const reviewAr = await d.innerText();
    ok("#24 the Arabic review: the Trial terms in Arabic (14 يومًا، 5 جيجابايت) and the 72-hour note", reviewAr.includes("14 يومًا") && reviewAr.includes("5 جيجابايت") && reviewAr.includes("الرابط صالح لمدة 72 ساعة."));
    await shot(page, "50-create-review-ar-dark-390");
    await d.getByLabel("كلمة المرور", { exact: true }).fill(PASSWORD);
    await d.getByLabel("رمز التحقق", { exact: true }).fill(await freshCode(owner));
    await d.getByRole("button", { name: "إنشاء الدعوة" }).click();
    await page.locator("#invitation-link").waitFor({ timeout: 20_000 });
    const link = await page.locator("#invitation-link").inputValue();
    tokensSeen.push(link.split("#t=")[1] ?? "");
    const field = await page.locator("#invitation-link").boundingBox();
    const copy = await d.getByRole("button", { name: "نسخ الرابط" }).boundingBox();
    ok("#24 the link row stacks on a phone: Copy below the field, both full width; the field stays left-to-right", !!field && !!copy && copy.y >= field.y + field.height - 1 && Math.abs(copy.width - field.width) <= 2 && (await page.locator("#invitation-link").getAttribute("dir")) === "ltr", JSON.stringify({ field, copy }));
    const panelAr = await d.innerText();
    ok("#24 the Arabic link panel: shown once, acceptance not available (PO-02D3), do not send to a real customer", panelAr.includes("يظهر هذا الرابط مرة واحدة فقط.") && panelAr.includes("قبول الدعوات غير متاح بعد (المرحلة PO-02D3).") && panelAr.includes("لا ترسل هذا الرابط إلى عميل حقيقي"));
    const a = await audit(page);
    ok("#24 layout audit of the link panel (AR, dark, 390): no overflow, named controls, no clipping", a.overflow <= 1 && a.unnamed.length === 0 && a.clipped.length === 0 && a.dir === "rtl", auditText(a));
    await shot(page, "51-create-link-ar-dark-390");
    await d.getByRole("button", { name: "تم، نسختُ الرابط" }).click();
    await d.waitFor({ state: "hidden" });
    ok("#4 …and after Done the link is gone from the DOM", !(await linkInDom(page)));
    await setPrefs(pctx, A, { locale: "en", theme: "light" });
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  // ------------------------------------------------------------------------------------------------
  section("10. Nothing secret reaches the browser or the server log; nothing was delivered or onboarded");
  {
    const out = A.output() + B.output();
    ok(`#3 the server output holds none of the ${tokensSeen.length} links' tokens, no link, no password, TOTP secret, recovery code or session token`,
      tokensSeen.length >= 4 && tokensSeen.every((t) => t.length === 43 && !out.includes(t)) && !out.includes("#t=") && secretsSeen.every((s) => !out.includes(s)));
    const incidents = out.split("\n").filter((l) => l.includes("[platform-security-incident]"));
    ok("#18 the only incident lines are the deliberate audit outage", incidents.length >= 1 && incidents.every((l) => l.includes("audit_write_failed") && l.includes("invitation.revoked")), String(incidents.length));
    ok("#20 the browser never contacted the customer origin (or any host but the console)", foreign.length === 0, [...new Set(foreign)].join(", "));
    const now = {
      orgs: (await q<{ n: number }>("select count(*)::int as n from orgs"))[0].n,
      users: (await q<{ n: number }>("select count(*)::int as n from users"))[0].n,
      sessions: (await q<{ n: number }>("select count(*)::int as n from sessions"))[0].n,
    };
    ok("#21 #22 no organization, user or customer session was created", now.orgs === before.orgs && now.users === before.users && now.sessions === before.sessions);
    const allAudit = (await q<{ x: string }>("select coalesce(after_safe::text, '') || coalesce(before_safe::text, '') || coalesce(reason, '') as x from platform_audit_events")).map((r) => r.x).join("\n");
    ok("#3 no audit record holds a token or a link", tokensSeen.every((t) => !allAudit.includes(t)) && !allAudit.includes("register/accept"));
    if (SHOTS) ok(`screenshots written (${shots.length})`, shots.length >= 60, String(shots.length));
  }
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-invitations-browser");
} catch (err) {
  console.error(`verify:platform-invitations-browser aborted: ${describeError(err)}`);
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
