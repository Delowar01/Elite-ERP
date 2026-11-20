/**
 * Platform Owner PO-03A — browser suite: the customer Team tab (read-only user-seat summary, the primary-owner badge and
 * its protected menu, localized refusals) and the Platform Owner company detail's Users & seats panel — the production
 * build (`next build` first) served by `next start` on loopback, driven in Chromium.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://…/<admin db with _test_only_> \
 *   PO03A_SCREENSHOT_DIR=<optional output dir> npm run verify:platform-users-seats-browser
 *
 * One disposable database (dropped at the end): the reviewed schema, the PO-02D1B Trial seed, a Trial company created by
 * the REAL PO-02D3 acceptance path (its owner is mapped) and a legacy company created by the shared bootstrap (as
 * /register does: no mapping, no subscription). TEST-ONLY secrets are generated in memory and never printed; every
 * person, company and address is fictional. Chromium is the pre-installed build (PO01B_CHROMIUM, default
 * /opt/pw-browsers/chromium) — nothing is downloaded.
 *
 * Categories (docs/platform-owner/PO03A_DEVELOPMENT.md §J): W1 1 of 3 · W2–W4 adding members through the Team dialog to
 * 2, 3 and 4 of 3 (nothing is enforced) · W5 a disabled member still occupies a seat · W6 the primary owner's protected
 * menu · W7 direct server-action POSTs refused in English and Arabic · W8 a legacy company · W9 the last-owner refusal,
 * localized · W10 the console's Users & seats · W11 EN / AR × light / dark × 1440 / 1024 / 768 / 390 / 360 with layout
 * audits and screenshots · W12 Arabic RTL with left-to-right numbers.
 */
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import bcrypt from "bcryptjs";
import { createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { section, ok, summary, describeError } from "./platform/harness";
import { startServer, testSecrets, type Server } from "./platform/browser-env";
import { withRequest } from "./platform/request-scope";
import { loadActionIds } from "./action-id.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");

const testDbName = disposableName("po03a_browser");
const secrets = testSecrets();
const PORT = Number(process.env.PO03A_PORT || 3461);
const SHOTS = process.env.PO03A_SCREENSHOT_DIR || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
process.env.DATABASE_URL = databaseUrlFor(testDbName);
Object.assign(process.env, secrets);
// In this process only (the fixture acceptance runs here, not in the server): acceptance on, a fixed customer origin.
const FIXTURE_ORIGIN = "https://customer.erp.test";
process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED = "true";
process.env.CUSTOMER_PUBLIC_ORIGIN = FIXTURE_ORIGIN;
process.env.PLATFORM_TRUSTED_PROXY_HOPS = "1";

let created = false;
await createPlatformTestDatabase("po03a_browser", testDbName);
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
const invitations = await import("../src/lib/platform/invitations");
const orchestrator = await import("../src/lib/onboarding/invitation-acceptance");
const { bootstrapOrganization } = await import("../src/lib/org-bootstrap");
const { hashPassword } = await import("../src/lib/auth");
const { t } = await import("../src/lib/i18n/dict");
const { TEAM_MESSAGES } = await import("../src/lib/team/member-changes");
pool.on("error", () => undefined);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const q = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
const one = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await q<T>(text, values))[0];
const plain = (s: string) => s.replace(/[⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
const CUSTOMER_COOKIE = "__Host-elite_erp_session";
const PLATFORM_COOKIE = "__Host-elite_erp_platform";
const PASSWORD = "Fjord-Lantern-58!q";
const OPERATOR_PASSWORD = "Juniper-Compass-62!k";
let ipSeq = 0;
const nextIp = () => `198.51.100.${(++ipSeq % 200) + 20}`;

// ---- fixtures -----------------------------------------------------------------------------------------------------------
type Admin = { id: string; email: string; secret: string; lastStep: number };
async function createAdmin(): Promise<Admin> {
  const email = `operator.${Date.now().toString(36)}@seats-browser.test`;
  const { secret } = mfa.createTotpEnrollment(email);
  const { hashes } = await mfa.createRecoveryCodeSet();
  const at = new Date();
  const [row] = await db
    .insert(platformAdminsTable)
    .values({ emailNormalized: email, displayName: "Fictional Seats Operator", passwordHash: await auth.hashPlatformPassword(OPERATOR_PASSWORD), isActive: true, mfaSecretEncrypted: mfa.encryptTotpSecret(secret), mfaRecoveryHashes: hashes, mfaEnrolledAt: at, passwordChangedAt: at, createdAt: at, updatedAt: at })
    .returning({ id: platformAdminsTable.id });
  return { id: row.id, email, secret, lastStep: 0 };
}
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
/** A Trial company created by the REAL acceptance path (in this process): its owner is the mapped primary owner. */
async function acceptedCompany(operatorId: string, ownerName: string, ownerEmail: string): Promise<{ orgId: number; ownerId: number }> {
  const { token, tokenHash } = invitations.newInvitationToken();
  const createdAt = new Date(Date.now() - 3_600_000);
  const inv = (await one<{ id: string }>(
    `insert into organization_invitations (company_name, industry, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash, expires_at, invited_by_platform_admin_id, created_at, updated_at)
     values ('Al-Noor Fictional Exhibitions', 'Exhibitions', 'contact@alnoor-fixture.test', 'Saudi Arabia', 'SAR', $1, $2, $3, $4, $5, $6, $6) returning id`,
    [ownerName, ownerEmail, tokenHash, new Date(createdAt.getTime() + 72 * 3_600_000), operatorId, createdAt],
  ))!.id;
  await q(`insert into organization_invitation_terms (invitation_id, initial_package_version_id, initial_is_trial, initial_cycle)
           select $1, v.id, true, 'trial' from subscription_package_versions v join subscription_packages p on p.id = v.package_id where p.is_default_trial and v.version_number = 1`, [inv]);
  const out = await withRequest({ host: "customer.erp.test", origin: FIXTURE_ORIGIN, "sec-fetch-site": "same-origin", "user-agent": "verify-users-seats-browser", "x-forwarded-for": "10.51.0.7" }, () =>
    orchestrator.acceptInvitationLink({ token, ownerName, password: PASSWORD, confirm: PASSWORD }),
  );
  if (!out.ok) throw new Error(`fixture acceptance failed: ${JSON.stringify(out)}`);
  const row = (await one<{ org_id: number; user_id: number }>(`select p.org_id, p.user_id from tenant_primary_owners p join organization_invitations i on i.accepted_org_id = p.org_id where i.id = $1`, [inv]))!;
  return { orgId: Number(row.org_id), ownerId: Number(row.user_id) };
}
/** A legacy company exactly as /register creates it (the shared bootstrap): no mapping, no subscription. */
async function legacyCompany(): Promise<{ orgId: number; ownerId: number }> {
  const passwordHash = await hashPassword(PASSWORD);
  return db.transaction(async (tx) => {
    const r = await bootstrapOrganization(tx, { orgName: "Fictional Legacy Trading", country: "Saudi Arabia", currency: "SAR", ownerName: "Huda Fictional", ownerEmail: "huda.owner@legacy-fixture.test", passwordHash });
    return { orgId: r.orgId, ownerId: r.userId };
  });
}
async function addUser(orgId: number, name: string, email: string, role: string): Promise<number> {
  return Number((await one<{ id: number }>(`insert into users (org_id, email, password_hash, name, role) values ($1, $2, $3, $4, $5) returning id`, [orgId, email, await bcrypt.hash(PASSWORD, 4), name, role]))!.id);
}

// ---- browser helpers --------------------------------------------------------------------------------------------------
let browser!: Browser;
let A!: Server;
const contexts: BrowserContext[] = [];
type Prefs = { locale: "en" | "ar"; theme: "light" | "dark" };
async function newContext(prefs: Prefs = { locale: "en", theme: "light" }, viewport = { width: 1440, height: 900 }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ baseURL: A.url, viewport, deviceScaleFactor: 1, reducedMotion: "reduce", extraHTTPHeaders: { "x-forwarded-for": nextIp() } });
  await ctx.addCookies([
    { name: "locale", value: prefs.locale, url: A.url },
    { name: "theme", value: prefs.theme, url: A.url },
  ]);
  contexts.push(ctx);
  return ctx;
}
async function settled(page: Page) {
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 20_000 });
}
async function go(page: Page, path: string) {
  const res = await page.goto(path);
  await settled(page);
  return res;
}
async function customerSignIn(ctx: BrowserContext, email: string): Promise<Page> {
  const page = await ctx.newPage();
  await go(page, "/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("form button[type=submit]").click();
  await page.waitForURL("**/dashboard", { timeout: 25_000 });
  return page;
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
const TEAM = "/settings/organization?tab=team";
const card = (page: Page) => page.getByTestId("team-seat-summary");
async function cardText(page: Page): Promise<string> {
  await card(page).waitFor({ state: "visible", timeout: 20_000 });
  return plain(await card(page).innerText());
}
async function untilCard(page: Page, needle: string, timeout = 20_000): Promise<string> {
  const t0 = Date.now();
  for (;;) {
    const text = await cardText(page).catch(() => "");
    if (text.includes(needle) || Date.now() - t0 > timeout) return text;
    await sleep(150);
  }
}
async function addMember(page: Page, name: string, email: string, roleLabel: "Owner" | "Admin" | "Staff") {
  await page.getByRole("button", { name: "Add Team Member" }).click();
  await page.locator("#member-name").fill(name);
  await page.locator("#member-email").fill(email);
  // Always chosen explicitly: the dialog keeps the role picked for the previous member (existing behaviour).
  await page.locator("#member-role").click();
  await page.getByRole("option", { name: roleLabel, exact: true }).click();
  await page.locator("#member-password").fill(PASSWORD);
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 20_000 });
}
const rowOf = (page: Page, name: string) => page.locator("tr", { hasText: name });
async function openMenu(page: Page, name: string) {
  await rowOf(page, name).getByRole("button", { name: /Member actions|إجراءات العضو/ }).click();
  await page.getByRole("menu").waitFor({ state: "visible", timeout: 10_000 });
}
const menuItems = async (page: Page) => (await page.getByRole("menuitem").allInnerTexts()).map(plain);

// ---- layout audit (the PO-01B / PO-02 rules) ----------------------------------------------------------------------------
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
  const scope = document.querySelector("[data-testid=team-seat-summary], [data-testid=company-seats]")?.closest("main") || document.querySelector("main");
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
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await sleep(150);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
  shots.push(name);
}

// ---- direct POSTs to the build's own server actions (ids from its manifest) -----------------------------------------------
const actionIdOf = await loadActionIds();
async function postAction(name: string, args: unknown[], cookies: string): Promise<{ status: number; text: string }> {
  const id = actionIdOf(name);
  if (!id) throw new Error(`server action ${name} is not in the build manifest`);
  const res = await fetch(`${A.url}/settings/organization`, {
    method: "POST",
    headers: { "next-action": id, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", origin: A.url, cookie: cookies, "x-forwarded-for": nextIp() },
    body: JSON.stringify(args),
    redirect: "manual",
  });
  return { status: res.status, text: await res.text() };
}
const cookieHeader = async (ctx: BrowserContext, locale: "en" | "ar") => {
  const session = (await ctx.cookies()).find((c) => c.name === CUSTOMER_COOKIE)?.value;
  return `${CUSTOMER_COOKIE}=${session}; locale=${locale}`;
};

async function main() {
  browser = await chromium.launch({ executablePath: process.env.PO01B_CHROMIUM || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  A = await startServer(PORT, { ...secrets, DATABASE_URL: process.env.DATABASE_URL, PLATFORM_CONSOLE_ENABLED: "true", PLATFORM_TRUSTED_PROXY_HOPS: "1", PLATFORM_INVITATIONS_ENABLED: undefined, CUSTOMER_INVITE_ACCEPTANCE_ENABLED: "true", CUSTOMER_PUBLIC_ORIGIN: `http://localhost:${PORT}`, PLATFORM_INVITATIONS_LOOPBACK_ORIGIN: "true" });

  const operator = await createAdmin();
  const M = await acceptedCompany(operator.id, "Fatimah Al-Qahtani", "fatimah.owner@alnoor-fixture.test");
  const L = await legacyCompany();
  const lAdmin = await addUser(L.orgId, "Omar Fictional", "omar.admin@legacy-fixture.test", "admin");
  await addUser(L.orgId, "Sara Fictional", "sara.staff@legacy-fixture.test", "staff");

  // ============================================================================================================
  section("W1–W5 The Team tab of the invitation-created Trial company");
  const pctx = await newContext();
  const pp = await customerSignIn(pctx, "fatimah.owner@alnoor-fixture.test");
  await go(pp, TEAM);
  const t1 = await cardText(pp);
  ok("W1 1 of 3 user seats occupied, 2 remaining, the Trial package and version, the end date, 1 active / 0 disabled", /1 of 3 user seats occupied/.test(t1) && /Remaining seats: 2/.test(t1) && /Version 1/.test(t1) && /Until /.test(t1) && /Active users: 1 · Disabled users: 0/.test(t1), t1);
  ok("W1 …the primary owner is named, and says seat limits are not enforced yet", /Primary owner: Fatimah Al-Qahtani/.test(t1) && /Seat limits are not enforced yet/.test(t1));
  ok("W1 …the primary owner's row carries the \"Primary owner\" badge", (await rowOf(pp, "Fatimah Al-Qahtani").getByTestId("team-primary-owner-badge").count()) === 1);
  await shot(pp, "10-team-trial-1of3-en-light-1440");
  await addMember(pp, "Noura Fictional", "noura.owner@alnoor-fixture.test", "Owner");
  const t2 = await untilCard(pp, "2 of 3");
  ok("W2 adding a second owner through the Team dialog → 2 of 3, 1 remaining", /2 of 3 user seats occupied/.test(t2) && /Remaining seats: 1/.test(t2), t2);
  await addMember(pp, "Khalid Fictional", "khalid.staff@alnoor-fixture.test", "Staff");
  const t3 = await untilCard(pp, "3 of 3");
  ok("W3 a third member → 3 of 3, 0 remaining", /3 of 3 user seats occupied/.test(t3) && /Remaining seats: 0/.test(t3), t3);
  await addMember(pp, "Layla Fictional", "layla.staff@alnoor-fixture.test", "Staff");
  const t4 = await untilCard(pp, "4 of 3");
  ok("W4 a fourth member is still added (nothing enforced) → 4 of 3, \"Over the seat allowance by 1\" (informational)", /4 of 3 user seats occupied/.test(t4) && /Over the seat allowance by 1/.test(t4) && (await rowOf(pp, "Layla Fictional").count()) === 1, t4);
  await shot(pp, "11-team-trial-4of3-en-light-1440");
  await openMenu(pp, "Layla Fictional");
  await pp.getByRole("menuitem", { name: "Deactivate" }).click();
  await pp.getByRole("alertdialog").or(pp.getByRole("dialog")).getByRole("button", { name: "Deactivate" }).click();
  const t5 = await untilCard(pp, "Disabled users: 1");
  ok("W5 deactivating a member keeps 4 of 3 occupied; 3 active / 1 disabled", /4 of 3 user seats occupied/.test(t5) && /Active users: 3 · Disabled users: 1/.test(t5), t5);

  // ============================================================================================================
  section("W6–W7 The primary owner, seen by another owner");
  const qctx = await newContext();
  const qp = await customerSignIn(qctx, "noura.owner@alnoor-fixture.test");
  await go(qp, TEAM);
  await openMenu(qp, "Fatimah Al-Qahtani");
  const pItems = await menuItems(qp);
  ok("W6 the primary owner's menu offers no demotion and no deactivation — only the protected notice (disabled)", pItems.length === 1 && /The primary owner's role and access are protected/.test(pItems[0]) &&
    (await qp.getByRole("menuitem", { name: /protected/ }).getAttribute("aria-disabled")) === "true", JSON.stringify(pItems));
  await shot(qp, "12-team-primary-owner-menu-en-light-1440");
  await qp.keyboard.press("Escape");
  await openMenu(qp, "Khalid Fictional");
  const kItems = await menuItems(qp);
  ok("W6 …other members keep the existing menu (Make Owner / Make Admin, Deactivate)", kItems.some((x) => /Make\s+Owner/.test(x)) && kItems.some((x) => /Make\s+Admin/.test(x)) && kItems.includes("Deactivate"), JSON.stringify(kItems));
  await qp.keyboard.press("Escape");
  const before = await one<{ role: string; is_active: boolean }>(`select role, is_active from users where id = $1`, [M.ownerId]);
  const en1 = await postAction("changeRoleAction", [M.ownerId, "admin"], await cookieHeader(qctx, "en"));
  const en2 = await postAction("toggleMemberActiveAction", [M.ownerId, false], await cookieHeader(qctx, "en"));
  const ar1 = await postAction("changeRoleAction", [M.ownerId, "staff"], await cookieHeader(qctx, "ar"));
  const ar2 = await postAction("toggleMemberActiveAction", [M.ownerId, false], await cookieHeader(qctx, "ar"));
  ok("W7 a direct server-action POST demoting or deactivating the primary owner is refused by the server (English)", en1.text.includes(TEAM_MESSAGES.primaryRole) && en2.text.includes(TEAM_MESSAGES.primaryDeactivate), `${en1.status} ${en2.status}`);
  ok("W7 …and in Arabic for an Arabic session", ar1.text.includes(t("ar", TEAM_MESSAGES.primaryRole)) && ar2.text.includes(t("ar", TEAM_MESSAGES.primaryDeactivate)));
  const afterRow = await one<{ role: string; is_active: boolean }>(`select role, is_active from users where id = $1`, [M.ownerId]);
  ok("W7 …the primary owner is unchanged and four refusals are on record (security events)", JSON.stringify(before) === JSON.stringify(afterRow) && afterRow?.role === "owner" && afterRow?.is_active === true &&
    Number((await one<{ n: number }>(`select count(*)::int as n from security_events where org_id = $1 and type = 'team.primary_owner_protected'`, [M.orgId]))?.n) === 4);

  // ============================================================================================================
  section("W8–W9 A legacy company (created as /register creates it)");
  const lctx = await newContext();
  const lp = await customerSignIn(lctx, "huda.owner@legacy-fixture.test");
  await go(lp, TEAM);
  const l1 = await cardText(lp);
  ok("W8 \"3 user seats occupied\", \"No subscription assigned\", \"Primary owner: not designated\" — nothing inferred", /3 user seats occupied/.test(l1) && /No subscription assigned/.test(l1) && /Primary owner: not designated/.test(l1) && !/of \d+ user seats/.test(l1), l1);
  ok("W8 …no primary-owner badge, and the owner's menu for the admin is the existing one", (await lp.getByTestId("team-primary-owner-badge").count()) === 0);
  await openMenu(lp, "Omar Fictional");
  const oItems = await menuItems(lp);
  ok("W8 …(Make Owner / Make Staff / Deactivate, as before)", oItems.some((x) => /Make\s+Owner/.test(x)) && oItems.some((x) => /Make\s+Staff/.test(x)) && oItems.includes("Deactivate"), JSON.stringify(oItems));
  await lp.keyboard.press("Escape");
  await shot(lp, "20-team-legacy-en-light-1440");
  const actx = await newContext({ locale: "ar", theme: "light" });
  const ap = await customerSignIn(actx, "omar.admin@legacy-fixture.test");
  await go(ap, TEAM);
  await openMenu(ap, "Huda Fictional");
  await ap.getByRole("menuitem", { name: t("ar", "Deactivate") }).click();
  await ap.getByRole("alertdialog").or(ap.getByRole("dialog")).getByRole("button", { name: /Deactivate|إلغاء التفعيل/ }).click();
  const lastOwnerAr = t("ar", TEAM_MESSAGES.lastOwner);
  await ap.getByText(lastOwnerAr).first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  ok("W9 an admin deactivating the only owner is refused with the Arabic last-owner message, and nothing changes", (await ap.getByText(lastOwnerAr).count()) >= 1 &&
    (await one<{ is_active: boolean }>(`select is_active from users where id = $1`, [L.ownerId]))?.is_active === true);
  await shot(ap, "21-team-legacy-last-owner-ar-light-1440");
  void lAdmin;

  // ============================================================================================================
  section("W10 The Platform Owner company detail — Users & seats");
  const octx = await newContext();
  const op = await platformSignIn(octx, operator);
  await go(op, `/platform/companies/${M.orgId}?tab=users`);
  const panel = op.getByTestId("company-seats");
  await panel.waitFor({ state: "visible", timeout: 20_000 });
  const c1 = plain(await panel.innerText());
  ok("W10 the Trial company: 4 of 3 occupied, the allowance from its snapshot (3, package, version 1), 0 remaining, over by 1 (not enforced, stated once), 3 active / 1 disabled",
    /Occupied seats\s*4 of 3/.test(c1) && /Seat allowance\s*3 — .+ · Version 1/.test(c1) && /Remaining\s*0/.test(c1) && (c1.match(/Over the allowance by 1 \(not enforced\)/g) ?? []).length === 1 && /Active users\s*3/.test(c1) && /Disabled users\s*1/.test(c1), c1);
  ok("W10 …the primary owner by name and e-mail; seat limits are not enforced", /Primary owner\s*Fatimah Al-Qahtani\s*fatimah\.owner@alnoor-fixture\.test/.test(c1) && /Seat limits are not enforced/.test(c1), c1);
  await shot(op, "30-console-seats-trial-en-light-1440");
  await go(op, `/platform/companies/${L.orgId}?tab=users`);
  await op.getByTestId("company-seats").waitFor({ state: "visible", timeout: 20_000 });
  const c2 = plain(await op.getByTestId("company-seats").innerText());
  ok("W10 the legacy company: 3 occupied, \"No subscription assigned\", \"Not designated\" and the legacy note — nothing assigned", /Occupied seats\s*3/.test(c2) && /No subscription assigned/.test(c2) && /Primary owner\s*Not designated/.test(c2) && /Nothing is assigned automatically/.test(c2), c2);
  await shot(op, "31-console-seats-legacy-en-light-1440");

  // ============================================================================================================
  section("W11–W12 EN / AR × light / dark × 1440 / 1024 / 768 / 390 / 360 — layout audits and screenshots");
  const failures: string[] = [];
  let screens = 0;
  const WIDTHS = [1440, 1024, 768, 390, 360];
  // One sign-in per application, reused: the session cookies are copied into each locale × theme context.
  const customerCookies = (await pctx.cookies()).filter((c) => c.name === CUSTOMER_COOKIE);
  const legacyCookies = (await lctx.cookies()).filter((c) => c.name === CUSTOMER_COOKIE);
  const platformCookies = (await octx.cookies()).filter((c) => c.name === PLATFORM_COOKIE);
  const screensFor: { name: string; path: string; testId: string; cookies: typeof customerCookies; widths: number[] }[] = [
    { name: "team-trial", path: TEAM, testId: "team-seat-summary", cookies: customerCookies, widths: WIDTHS },
    { name: "team-legacy", path: TEAM, testId: "team-seat-summary", cookies: legacyCookies, widths: [1440, 390] },
    { name: "console-trial", path: `/platform/companies/${M.orgId}?tab=users`, testId: "company-seats", cookies: platformCookies, widths: WIDTHS },
    { name: "console-legacy", path: `/platform/companies/${L.orgId}?tab=users`, testId: "company-seats", cookies: platformCookies, widths: [1440, 390] },
  ];
  for (const locale of ["en", "ar"] as const) {
    for (const theme of ["light", "dark"] as const) {
      for (const s of screensFor) {
        const ctx = await newContext({ locale, theme });
        await ctx.addCookies(s.cookies);
        const page = await ctx.newPage();
        for (const w of s.widths) {
          await page.setViewportSize({ width: w, height: w < 500 ? 844 : 900 });
          await go(page, s.path);
          await page.getByTestId(s.testId).waitFor({ state: "visible", timeout: 20_000 });
          const a = await audit(page);
          const goodDir = a.lang === locale && a.dir === (locale === "ar" ? "rtl" : "ltr") && a.theme === theme;
          screens++;
          if (!auditOk(a) || !goodDir) failures.push(`${s.name}-${locale}-${theme}-${w}: ${auditText(a)}`);
          await shot(page, `4-${s.name}-${locale}-${theme}-${w}`);
        }
        await ctx.close();
      }
    }
  }
  ok(`W11 ${screens} screens (Team tab and console detail) × EN / AR × light / dark × five widths: one h1, named controls, labelled fields, no horizontal scroll, no clipped text, white on orange, lang / dir / theme applied`, failures.length === 0 && screens >= 40, failures.slice(0, 3).join(" | "));
  const rctx = await newContext({ locale: "ar", theme: "light" }, { width: 390, height: 844 });
  const rp = await customerSignIn(rctx, "fatimah.owner@alnoor-fixture.test");
  await go(rp, TEAM);
  const ar = await cardText(rp);
  const ltrNumbers = await card(rp).locator("bdi[dir=ltr]").count();
  ok("W12 Arabic (RTL): the card reads «المقاعد المشغولة: 4 من 3», with every number in a left-to-right isolate", /مقاعد المستخدمين/.test(ar) && /المقاعد المشغولة: 4 من 3/.test(ar) && /تجاوز عدد المقاعد المسموح به بمقدار 1/.test(ar) && ltrNumbers >= 5 && /المالك الرئيسي: Fatimah Al-Qahtani/.test(ar), `${ar} | ltr=${ltrNumbers}`);
  ok("W12 …the primary-owner badge and the not-enforced note are in Arabic", (await rowOf(rp, "Fatimah Al-Qahtani").getByText("المالك الرئيسي").count()) === 1 && /لا تُطبَّق حدود المقاعد بعد/.test(ar));
  await shot(rp, "13-team-trial-ar-light-390");

  ok("W13 no server error was logged while the suite ran", !/Error: |TypeError|Unhandled/.test(A.output().replace(/Your version of Next\.js[^\n]*/g, "")), A.output().slice(-400));
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-users-seats-browser");
} catch (e) {
  ok("suite ran to completion", false, describeError(e));
  exitCode = summary("verify:platform-users-seats-browser");
} finally {
  for (const c of contexts) await c.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await A?.stop().catch(() => undefined);
  await pool.end().catch(() => undefined);
  if (created && !process.env.PLATFORM_TEST_KEEP_DATABASES) await dropDisposableDatabase(testDbName).catch(() => undefined);
  if (SHOTS) console.log(`${shots.length} screenshots written`);
}
process.exit(exitCode);
