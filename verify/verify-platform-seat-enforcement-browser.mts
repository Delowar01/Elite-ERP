/**
 * Platform Owner PO-03D — browser suite for user-seat ENFORCEMENT: the customer Team tab (who occupies the seats, the
 * user limit, Add Member refused at the limit in English and Arabic and allowed again once a seat is freed, a company
 * above its allowance, a legacy company without a subscription) and the Platform Owner console (a company's Users &
 * seats, the users directory, a user's page and the invite dialog's seat check) — the production build (`next build`
 * first) served by `next start` on loopback, driven in Chromium.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *   PO03D_SCREENSHOT_DIR=<optional output dir> npm run verify:platform-seat-enforcement-browser
 *
 * Server A: CUSTOMER_SEAT_ENFORCEMENT_ENABLED=true, the console with user invitations on, user-invitation acceptance on;
 * server B: the same with enforcement unset (OFF) — the contrast. One trusted proxy hop; every browser context sends its
 * own fictional X-Forwarded-For. One disposable database (dropped at the end): the reviewed schema, the PO-02D1B Trial
 * seed and the staged PO-03C user_invitations SQL, with fictional companies, users and invitations. TEST-ONLY secrets are
 * generated in memory and never printed. Chromium is the pre-installed build (PO01B_CHROMIUM, default
 * /opt/pw-browsers/chromium) — nothing is downloaded.
 *
 * Categories E1 … E12 (docs/platform-owner/PO03D_DEVELOPMENT.md §L): E1 the Team card at the limit (2 users + 1 pending
 * invitation = 3 of 3) · E2 Add Member refused at the limit — the toast, nothing created, one security event · E3 the
 * same refusal in Arabic · E4 a seat freed (the invitation revoked) → Add Member works, the limit is reached again ·
 * E5 a company above its allowance · E6 a legacy company: no subscription, Add Member allowed (the legacy rule) · E7 the
 * console company detail (seat use, user limit, the limit callout) · E8 the users directory and a user's page · E9 the
 * invite dialog's seat check (at the limit, no subscription, a free seat) · E10 enforcement OFF (server B): nothing
 * refused, "not enforced" · E11 EN / AR × light / dark × 1440 / 1024 / 768 / 390 / 360 with layout audits and
 * screenshots · E12 no server error, nothing requested from another host.
 */
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import bcrypt from "bcryptjs";
import { connectDisposable, createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { section, ok, summary, describeError } from "./platform/harness";
import { startServer, testSecrets, type Server } from "./platform/browser-env";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");

const ROOT = process.cwd();
const testDbName = disposableName("po03d_seats_browser");
const secrets = testSecrets();
const PORT_A = Number(process.env.PO03D_SEAT_PORT_A || 3473);
const PORT_B = Number(process.env.PO03D_SEAT_PORT_B || 3474);
const SHOTS = process.env.PO03D_SCREENSHOT_DIR ? join(process.env.PO03D_SCREENSHOT_DIR, "seats") : "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
process.env.DATABASE_URL = databaseUrlFor(testDbName);
Object.assign(process.env, secrets);

let created = false;
await createPlatformTestDatabase("po03d_seats_browser", testDbName);
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

const { db, pool, platformAdminsTable } = await import("../src/db");
const auth = await import("../src/lib/platform/auth");
const mfa = await import("../src/lib/platform/mfa");
const totp = await import("../src/lib/platform/totp");
const { t } = await import("../src/lib/i18n/dict");
pool.on("error", () => undefined);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const q = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
const one = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await q<T>(text, values))[0];
const num = async (text: string, values: unknown[] = []) => Number((await one<{ n: number }>(text, values))?.n ?? 0);
const plain = (s: string) => s.replace(/[⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const CUSTOMER_COOKIE = "__Host-elite_erp_session";
const PLATFORM_COOKIE = "__Host-elite_erp_platform";
const PASSWORD = "Mangrove-Ledger-47!t";
const OPERATOR_PASSWORD = "Saffron-Beacon-93!m";
const MEMBER_PASSWORD = "Coral-Harbor-26#v";
const HOUR = 3_600_000;
let ipSeq = 0;
const nextIp = () => `198.51.100.${(++ipSeq % 200) + 30}`;

// The exact English messages (src/lib/team/member-add.ts); dict.ts holds their Saudi Arabic.
const SEAT_LIMIT_MESSAGE = "This company has reached its user limit. Nothing was changed. Free a seat, or ask your Elite ERP contact about more seats.";
const LIMIT_REACHED_LINE = "The user limit is reached: no member can be added until a seat is freed.";
const ABOVE_LIMIT_LINE = "Above the user limit: existing members keep their access, but no member can be added.";
const ENFORCED_NOTE = "User limits are enforced. Active and disabled accounts both occupy a seat, and so does each pending invitation until it is revoked or expires.";
const NOT_ENFORCED_NOTE = "Seat limits are not enforced yet. Active and disabled accounts both occupy a seat.";

// ---- fixtures -----------------------------------------------------------------------------------------------------------
type Admin = { id: string; email: string; secret: string; lastStep: number };
async function createAdmin(): Promise<Admin> {
  const email = `operator.${Date.now().toString(36)}@seats-enforcement.test`;
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
const trialV1 = async () => (await one<{ id: string }>(`select v.id from subscription_package_versions v join subscription_packages p on p.id = v.package_id where p.is_default_trial and v.version_number = 1`))!.id;
type Member = { name: string; email: string; role: "owner" | "admin" | "staff" };
type Company = { orgId: number; ids: Record<string, number> };
async function company(name: string, seats: number | null, members: Member[]): Promise<Company> {
  const orgId = Number((await one<{ id: number }>(`insert into orgs (name, country, currency) values ($1, 'Saudi Arabia', 'SAR') returning id`, [name]))!.id);
  const hash = await bcrypt.hash(PASSWORD, 4);
  const ids: Record<string, number> = {};
  for (const m of members) ids[m.email] = Number((await one<{ id: number }>(`insert into users (org_id, email, password_hash, name, role) values ($1, $2, $3, $4, $5) returning id`, [orgId, m.email, hash, m.name, m.role]))!.id);
  if (seats !== null) {
    await q(
      `insert into tenant_subscriptions (org_id, package_version_id, version_state, is_trial, cycle, lifecycle_state, start_date, end_date, price_snapshot_sar, seats_snapshot, storage_snapshot_gb, module_groups_snapshot, assignment_source)
       values ($1, $2, 'published', true, 'trial', 'trialing', current_date, current_date + 13, 0, $3, 5, '[]'::jsonb, 'invitation_acceptance')`,
      [orgId, await trialV1(), seats],
    );
  }
  return { orgId, ids };
}
/** A pending user invitation, written as PO-03C writes one (32 random bytes, base64url; only sha256 is stored). */
async function pendingInvitation(orgId: number, adminId: string, email: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const createdAt = new Date(Date.now() - HOUR);
  return (await one<{ id: string }>(
    `insert into user_invitations (org_id, name, email_normalized, requested_role, token_hash, expires_at, invited_by_platform_admin_id, created_at) values ($1, 'Fixture Invitee', $2, 'staff', $3, $4, $5, $6) returning id`,
    [orgId, email, sha256(token), new Date(createdAt.getTime() + 72 * HOUR), adminId, createdAt],
  ))!.id;
}
const usersOf = (orgId: number) => num(`select count(*)::int as n from users where org_id = $1`, [orgId]);
const refusals = (orgId: number) => num(`select count(*)::int as n from security_events where org_id = $1 and type = 'team.member_add_refused' and detail = 'seat_limit'`, [orgId]);

// ---- browser helpers --------------------------------------------------------------------------------------------------
let browser!: Browser;
let A!: Server;
let B!: Server;
const contexts: BrowserContext[] = [];
const requestedHosts = new Set<string>();
type Prefs = { locale: "en" | "ar"; theme: "light" | "dark" };
async function newContext(server: Server, prefs: Prefs = { locale: "en", theme: "light" }, viewport = { width: 1440, height: 900 }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ baseURL: server.url, viewport, deviceScaleFactor: 1, reducedMotion: "reduce", extraHTTPHeaders: { "x-forwarded-for": nextIp() } });
  ctx.on("request", (r) => {
    try {
      requestedHosts.add(new URL(r.url()).hostname);
    } catch {
      // data: and similar
    }
  });
  await ctx.addCookies([
    { name: "locale", value: prefs.locale, url: server.url },
    { name: "theme", value: prefs.theme, url: server.url },
  ]);
  contexts.push(ctx);
  return ctx;
}
async function go(page: Page, path: string) {
  const res = await page.goto(path);
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 20_000 });
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
/** Fill and save the Team's Add Member dialog; returns the toast that answered (success or error). */
async function addMember(page: Page, locale: "en" | "ar", name: string, email: string, roleLabel: "Owner" | "Admin" | "Staff"): Promise<string> {
  await page.getByRole("button", { name: t(locale, "Add Team Member") }).click();
  await page.locator("#member-name").fill(name);
  await page.locator("#member-email").fill(email);
  await page.locator("#member-role").click();
  await page.getByRole("option", { name: t(locale, roleLabel), exact: true }).click();
  await page.locator("#member-password").fill(MEMBER_PASSWORD);
  await page.getByRole("dialog").getByRole("button", { name: t(locale, "Save") }).click();
  const toast = page.locator("[data-sonner-toast]").last();
  await toast.waitFor({ state: "visible", timeout: 20_000 });
  return plain(await toast.innerText());
}
async function dismissToasts(page: Page) {
  await page.evaluate(() => document.querySelectorAll("[data-sonner-toast]").forEach((el) => el.remove())).catch(() => undefined);
}

// ---- layout audit (the PO-01B / PO-02 / PO-03A rules) -------------------------------------------------------------------
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
  const scope = document.querySelector("[data-testid=team-seat-summary], [data-testid=company-seats], [data-testid=user-seats]")?.closest("main") || document.querySelector("main");
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
async function shot(page: Page, name: string, mode: "full" | "viewport" = "full") {
  if (!SHOTS) return;
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await sleep(150);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: mode === "full" });
  shots.push(name);
}

async function main() {
  browser = await chromium.launch({ executablePath: process.env.PO01B_CHROMIUM || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const common = {
    ...secrets,
    DATABASE_URL: process.env.DATABASE_URL,
    PLATFORM_CONSOLE_ENABLED: "true",
    PLATFORM_TRUSTED_PROXY_HOPS: "1",
    PLATFORM_USER_INVITATIONS_ENABLED: "true",
    PLATFORM_INVITATIONS_ENABLED: undefined,
    CUSTOMER_INVITE_ACCEPTANCE_ENABLED: undefined,
    CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED: "true",
    PLATFORM_INVITATIONS_LOOPBACK_ORIGIN: "true",
  };
  A = await startServer(PORT_A, { ...common, CUSTOMER_SEAT_ENFORCEMENT_ENABLED: "true", CUSTOMER_PUBLIC_ORIGIN: `http://localhost:${PORT_A}` });
  B = await startServer(PORT_B, { ...common, CUSTOMER_SEAT_ENFORCEMENT_ENABLED: undefined, CUSTOMER_PUBLIC_ORIGIN: `http://localhost:${PORT_B}` });

  const operator = await createAdmin();
  const T = await company("Qasr Fixture Trading", 3, [
    { name: "Mariam Fixture", email: "mariam.owner@qasr-fixture.test", role: "owner" },
    { name: "Faisal Fixture", email: "faisal.admin@qasr-fixture.test", role: "admin" },
  ]);
  const pendingT = await pendingInvitation(T.orgId, operator.id, "pending.one@qasr-fixture.test");
  const O = await company("Wadi Fixture Logistics", 2, [
    { name: "Yousef Fixture", email: "yousef.owner@wadi-fixture.test", role: "owner" },
    { name: "Hind Fixture", email: "hind.staff@wadi-fixture.test", role: "staff" },
    { name: "Sami Fixture", email: "sami.staff@wadi-fixture.test", role: "staff" },
  ]);
  const L = await company("Bayt Fixture Legacy", null, [
    { name: "Amal Fixture", email: "amal.owner@bayt-fixture.test", role: "owner" },
    { name: "Nawaf Fixture", email: "nawaf.staff@bayt-fixture.test", role: "staff" },
  ]);
  const F = await company("Nakheel Fixture Foods", 5, [
    { name: "Rania Fixture", email: "rania.owner@nakheel-fixture.test", role: "owner" },
    { name: "Ziyad Fixture", email: "ziyad.admin@nakheel-fixture.test", role: "admin" },
  ]);
  const X = await company("Sahab Fixture Media", 2, [
    { name: "Tariq Fixture", email: "tariq.owner@sahab-fixture.test", role: "owner" },
    { name: "Lina Fixture", email: "lina.staff@sahab-fixture.test", role: "staff" },
  ]);

  // ============================================================================================================
  section("E1 The Team card at the limit: 2 users + 1 pending invitation = 3 of 3");
  const tctx = await newContext(A);
  const tp = await customerSignIn(tctx, "mariam.owner@qasr-fixture.test");
  await go(tp, TEAM);
  const c1 = await cardText(tp);
  ok("E1 3 of 3 user seats occupied; who occupies them: \"2 users + 1 pending invitation = 3 of 3 seats occupied\"; 0 remaining",
    /3 of 3 user seats occupied/.test(c1) && plain(await tp.getByTestId("team-seat-breakdown").innerText()) === "2 users + 1 pending invitation = 3 of 3 seats occupied" && /Remaining seats: 0/.test(c1), c1);
  ok("E1 …the limit is stated once (\"The user limit is reached …\") and the note says user limits are enforced",
    plain(await tp.getByTestId("team-seat-limit").innerText()) === LIMIT_REACHED_LINE && plain(await tp.getByTestId("team-seat-note").innerText()) === ENFORCED_NOTE, c1);
  await shot(tp, "10-team-at-limit-en-light-1440");

  // ============================================================================================================
  section("E2 Add Member at the limit is refused: the toast, nothing created, one security event");
  const usersBefore = await usersOf(T.orgId);
  const refusalsBefore = await refusals(T.orgId);
  const toast1 = await addMember(tp, "en", "Basma Fixture", "basma.staff@qasr-fixture.test", "Staff");
  ok("E2 the toast says the company reached its user limit, nothing was changed, and what to do", toast1 === SEAT_LIMIT_MESSAGE, toast1);
  ok("E2 …the dialog stays open (the existing behaviour on an error) and no user was created",
    (await tp.getByRole("dialog").isVisible()) && (await usersOf(T.orgId)) === usersBefore && (await num(`select count(*)::int as n from users where lower(email) = 'basma.staff@qasr-fixture.test'`)) === 0);
  ok("E2 …exactly one customer security event records the refusal (team.member_add_refused, seat_limit, the role asked for)",
    (await refusals(T.orgId)) === refusalsBefore + 1 && (await one<{ role: string }>(`select metadata->>'role' as role from security_events where org_id = $1 and type = 'team.member_add_refused' order by id desc limit 1`, [T.orgId]))?.role === "staff");
  await shot(tp, "11-team-add-refused-en-light-1440", "viewport");
  await tp.keyboard.press("Escape");
  await dismissToasts(tp);

  // ============================================================================================================
  section("E3 The same refusal in Arabic (an admin's Arabic session)");
  const actx = await newContext(A, { locale: "ar", theme: "light" });
  const ap = await customerSignIn(actx, "faisal.admin@qasr-fixture.test");
  await go(ap, TEAM);
  const ac = await cardText(ap);
  ok("E3 the Arabic card: the breakdown, the limit line and the enforced note in Saudi Arabic, numbers left-to-right",
    ac.includes(t("ar", LIMIT_REACHED_LINE)) && ac.includes(t("ar", ENFORCED_NOTE)) && ac.includes(t("ar", "1 pending invitation")) && (await ap.getByTestId("team-seat-breakdown").locator("bdi[dir=ltr]").count()) >= 3, ac);
  const toastAr = await addMember(ap, "ar", "Basma Fixture", "basma.staff@qasr-fixture.test", "Staff");
  ok("E3 the Arabic toast is the dictionary's Saudi Arabic of the seat-limit message; nothing created", toastAr === t("ar", SEAT_LIMIT_MESSAGE) && toastAr !== SEAT_LIMIT_MESSAGE && (await usersOf(T.orgId)) === usersBefore, toastAr);
  await shot(ap, "12-team-add-refused-ar-light-1440", "viewport");
  await ap.keyboard.press("Escape");

  // ============================================================================================================
  section("E4 A seat is freed (the pending invitation revoked) → Add Member works, and the limit is reached again");
  await q(`update user_invitations set revoked_at = greatest(now(), created_at), revoked_by_platform_admin_id = $2 where id = $1`, [pendingT, operator.id]);
  await go(tp, TEAM);
  const c4a = await untilCard(tp, "2 of 3");
  ok("E4 after the revocation: \"2 users + 0 pending invitations = 2 of 3 seats occupied\", 1 remaining, no limit line",
    plain(await tp.getByTestId("team-seat-breakdown").innerText()) === "2 users + 0 pending invitations = 2 of 3 seats occupied" && /Remaining seats: 1/.test(c4a) && (await tp.getByTestId("team-seat-limit").count()) === 0, c4a);
  const toast4 = await addMember(tp, "en", "Basma Fixture", "basma.staff@qasr-fixture.test", "Staff");
  const c4b = await untilCard(tp, "3 of 3");
  const basma = await one<{ org_id: number; role: string }>(`select org_id, role from users where email = 'basma.staff@qasr-fixture.test'`);
  ok("E4 Add Member succeeds (\"Saved\"): the member is in THIS company with the chosen role; the card shows 3 users = 3 of 3 and the limit line again",
    toast4 === "Saved" && basma?.org_id === T.orgId && basma.role === "staff" && plain(await tp.getByTestId("team-seat-breakdown").innerText()) === "3 users + 0 pending invitations = 3 of 3 seats occupied" && (await tp.getByTestId("team-seat-limit").count()) === 1, `${toast4} | ${c4b}`);
  ok("E4 …and its activity record is the existing one (team.member-added)", (await num(`select count(*)::int as n from activity_logs where org_id = $1 and type = 'team.member-added'`, [T.orgId])) === 1);
  await shot(tp, "13-team-full-again-en-light-1440");
  await dismissToasts(tp);

  // ============================================================================================================
  section("E5 A company above its allowance (3 users, 2 seats): members keep their access, no member can be added");
  const octx = await newContext(A);
  const opg = await customerSignIn(octx, "yousef.owner@wadi-fixture.test");
  await go(opg, TEAM);
  const c5 = await cardText(opg);
  ok("E5 3 of 2 occupied, over by 1, \"Above the user limit: existing members keep their access …\"; the owner is signed in (access kept)",
    /3 of 2 user seats occupied/.test(c5) && /Over the seat allowance by 1/.test(c5) && plain(await opg.getByTestId("team-seat-limit").innerText()) === ABOVE_LIMIT_LINE && opg.url().includes("/settings/organization"), c5);
  const o0 = await usersOf(O.orgId);
  const toast5 = await addMember(opg, "en", "Reem Fixture", "reem.staff@wadi-fixture.test", "Staff");
  ok("E5 Add Member is refused with the same message; nothing created", toast5 === SEAT_LIMIT_MESSAGE && (await usersOf(O.orgId)) === o0, toast5);
  await shot(opg, "14-team-over-limit-en-light-1440", "viewport");
  await opg.keyboard.press("Escape");

  // ============================================================================================================
  section("E6 A legacy company (no subscription): the legacy rule — Add Member allowed, nothing enforced");
  const lctx = await newContext(A);
  const lp = await customerSignIn(lctx, "amal.owner@bayt-fixture.test");
  await go(lp, TEAM);
  const c6 = await cardText(lp);
  ok("E6 \"2 user seats occupied\", \"No subscription assigned\", the breakdown without an allowance, no limit line, not enforced",
    /2 user seats occupied/.test(c6) && /No subscription assigned/.test(c6) && plain(await lp.getByTestId("team-seat-breakdown").innerText()) === "2 users + 0 pending invitations = 2 occupied" && (await lp.getByTestId("team-seat-limit").count()) === 0 && plain(await lp.getByTestId("team-seat-note").innerText()) === NOT_ENFORCED_NOTE, c6);
  const toast6 = await addMember(lp, "en", "Dalia Fixture", "dalia.staff@bayt-fixture.test", "Staff");
  ok("E6 Add Member succeeds (\"Saved\") — a company without a subscription keeps the legacy rule; 3 users now", toast6 === "Saved" && (await usersOf(L.orgId)) === 3 && /3 user seats occupied/.test(await untilCard(lp, "3 user seats")), toast6);
  await shot(lp, "15-team-legacy-en-light-1440");
  await dismissToasts(lp);

  // ============================================================================================================
  section("E7 The console company detail — seat use, the user limit and the limit callout");
  const pctx = await newContext(A);
  const pp = await platformSignIn(pctx, operator);
  await go(pp, `/platform/companies/${T.orgId}?tab=users`);
  await pp.getByTestId("company-seats").waitFor({ state: "visible", timeout: 20_000 });
  const s7 = plain(await pp.getByTestId("company-seats").innerText());
  ok("E7 the company at its limit: \"Seat use 3 users + 0 pending invitations = 3 of 3 seats occupied\", \"User limit Enforced\", Remaining 0",
    /Seat use\s*3 users \+ 0 pending invitations = 3 of 3 seats occupied/.test(s7) && /User limit\s*Enforced/.test(s7) && /Remaining\s*0/.test(s7), s7);
  ok("E7 …the callout \"The user limit is reached: no user can be added or invited until a seat is freed.\" and the enforced note",
    plain(await pp.getByTestId("seats-limit-reached").innerText()) === "The user limit is reached: no user can be added or invited until a seat is freed." && /User limits are enforced\. Active and disabled users both occupy a seat, and so does each pending user invitation until it is revoked or expires\./.test(s7), s7);
  await shot(pp, "20-console-company-at-limit-en-light-1440");
  await go(pp, `/platform/companies/${O.orgId}?tab=users`);
  const s7o = plain(await pp.getByTestId("company-seats").innerText());
  ok("E7 the company above its allowance: \"Over the allowance by 1: existing users keep their access, but no user can be added or invited.\" — and no 'reached' callout",
    /Over the allowance by 1: existing users keep their access, but no user can be added or invited\./.test(s7o) && /User limit\s*Enforced/.test(s7o) && (await pp.getByTestId("seats-limit-reached").count()) === 0, s7o);
  await go(pp, `/platform/companies/${L.orgId}?tab=users`);
  const s7l = plain(await pp.getByTestId("company-seats").innerText());
  ok("E7 the legacy company: \"User limit No subscription — user invitations are refused until one is assigned\"; seat use without an allowance",
    /User limit\s*No subscription — user invitations are refused until one is assigned/.test(s7l) && /Seat use\s*3 users \+ 0 pending invitations = 3 occupied \(no subscription allowance\)/.test(s7l), s7l);
  await shot(pp, "21-console-company-legacy-en-light-1440");

  // ============================================================================================================
  section("E8 The users directory and a user's page");
  await go(pp, "/platform/users");
  const tRow = plain(await pp.getByTestId(`user-row-${T.ids["mariam.owner@qasr-fixture.test"]}`).innerText());
  const oRow = plain(await pp.getByTestId(`user-row-${O.ids["yousef.owner@wadi-fixture.test"]}`).innerText());
  const fRow = plain(await pp.getByTestId(`user-row-${F.ids["rania.owner@nakheel-fixture.test"]}`).innerText());
  ok("E8 the directory's seat column: \"Limit reached\" for the full company, \"Over by 1 · no new users\" for the one above, neither for a company with free seats",
    /3 of 3/.test(tRow) && /Limit reached/.test(tRow) && /Over by 1 · no new users/.test(oRow) && !/Limit reached|no new users/.test(fRow), `${tRow} || ${oRow} || ${fRow}`);
  await shot(pp, "22-console-users-directory-en-light-1440");
  await go(pp, `/platform/users/${T.ids["faisal.admin@qasr-fixture.test"]}`);
  const s8 = plain(await pp.getByTestId("user-seats").innerText());
  ok("E8 a user's page: the company's seat use, \"User limit Enforced\" and the limit callout",
    /Seat use\s*3 users \+ 0 pending invitations = 3 of 3 seats occupied/.test(s8) && /User limit\s*Enforced/.test(s8) && (await pp.getByTestId("user-seats").getByTestId("seats-limit-reached").count()) === 1, s8);
  await shot(pp, "23-console-user-page-en-light-1440");

  // ============================================================================================================
  section("E9 The invite dialog's seat check: at the limit, without a subscription, with a free seat");
  const dialog = pp.getByRole("dialog");
  async function previewFor(orgId: number, email: string) {
    await go(pp, `/platform/companies/${orgId}?tab=users`);
    await pp.getByTestId("company-user-invitations").getByTestId("invite-user-control").click();
    await dialog.getByLabel("Full name").waitFor({ timeout: 15_000 });
    await dialog.getByLabel("Full name").fill("Fictional Candidate");
    await dialog.getByLabel("Email", { exact: true }).fill(email);
    await dialog.getByRole("radio", { name: "Staff" }).check();
    await dialog.getByRole("button", { name: "Check details" }).click();
    await dialog.getByTestId("invite-review").waitFor({ timeout: 15_000 });
    return {
      text: plain(await dialog.innerText()),
      seats: plain(await dialog.getByTestId("invite-seats").innerText()),
      blocked: (await dialog.getByTestId("invite-blocked").count()) === 1,
      createDisabled: await dialog.getByRole("button", { name: "Create invitation" }).isDisabled(),
      stepUp: await dialog.getByLabel("Verification code", { exact: true }).count(),
    };
  }
  const stepBefore = (await one<{ step: string | null }>(`select last_totp_step::text as step from platform_admins where id = $1`, [operator.id]).catch(() => ({ step: null })))?.step ?? null;
  const full = await previewFor(T.orgId, "candidate.one@qasr-fixture.test");
  ok("E9 at the limit: blocked before any code is asked — \"no free user seat (pending invitations count)\", Create disabled; the seats line says the limit applies",
    full.blocked && full.createDisabled && full.stepUp === 0 && full.text.includes("This company has no free user seat (pending invitations count). Revoke a pending invitation or free a seat first.") &&
      full.seats === "Company seats: 3 of 3 now, 4 of 3 with this invitation. The company's user limit applies.", `${full.seats} | ${full.text.slice(0, 240)}`);
  await shot(pp, "24-invite-blocked-at-limit-en-light-1440", "viewport");
  await pp.keyboard.press("Escape");
  const legacy = await previewFor(L.orgId, "candidate.two@bayt-fixture.test");
  ok("E9 no subscription: blocked — \"no current subscription, so no user can be invited until one is assigned\"", legacy.blocked && legacy.createDisabled && legacy.text.includes("This company has no current subscription, so no user can be invited until one is assigned."), legacy.text.slice(0, 240));
  await pp.keyboard.press("Escape");
  const free = await previewFor(F.orgId, "candidate.three@nakheel-fixture.test");
  ok("E9 a free seat: not blocked, Create enabled; \"2 of 5 now, 3 of 5 with this invitation. The company's user limit applies.\"",
    !free.blocked && !free.createDisabled && free.seats === "Company seats: 2 of 5 now, 3 of 5 with this invitation. The company's user limit applies.", free.seats);
  await shot(pp, "25-invite-free-seat-en-light-1440", "viewport");
  await pp.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
  const stepAfter = (await one<{ step: string | null }>(`select last_totp_step::text as step from platform_admins where id = $1`, [operator.id]).catch(() => ({ step: null })))?.step ?? null;
  ok("E9 none of these checks spent a code or wrote an invitation", stepBefore === stepAfter && (await num(`select count(*)::int as n from user_invitations where revoked_at is null`)) === 0);

  // ============================================================================================================
  section("E10 Enforcement OFF (server B, same build and database): nothing refused, \"not enforced\"");
  const xctx = await newContext(B);
  const xp = await customerSignIn(xctx, "tariq.owner@sahab-fixture.test");
  await go(xp, TEAM);
  const c10 = await cardText(xp);
  ok("E10 2 of 2 occupied — the breakdown is shown, but no limit line, and the note says limits are not enforced",
    /2 of 2 user seats occupied/.test(c10) && plain(await xp.getByTestId("team-seat-breakdown").innerText()) === "2 users + 0 pending invitations = 2 of 2 seats occupied" && (await xp.getByTestId("team-seat-limit").count()) === 0 && plain(await xp.getByTestId("team-seat-note").innerText()) === NOT_ENFORCED_NOTE, c10);
  const toast10 = await addMember(xp, "en", "Omar Fixture", "omar.staff@sahab-fixture.test", "Staff");
  ok("E10 Add Member at 2 of 2 succeeds (\"Saved\") — the behaviour before PO-03D; 3 of 2, over by 1 (informational)", toast10 === "Saved" && (await usersOf(X.orgId)) === 3 && /Over the seat allowance by 1/.test(await untilCard(xp, "3 of 2")) && (await refusals(X.orgId)) === 0, toast10);
  await shot(xp, "30-team-enforcement-off-en-light-1440");
  await dismissToasts(xp);

  // ============================================================================================================
  section("E11 EN / AR × light / dark × 1440 / 1024 / 768 / 390 / 360 — layout audits and screenshots");
  const failures: string[] = [];
  let screens = 0;
  const WIDTHS = [1440, 1024, 768, 390, 360];
  const customerCookies = (await tctx.cookies()).filter((c) => c.name === CUSTOMER_COOKIE);
  const overCookies = (await octx.cookies()).filter((c) => c.name === CUSTOMER_COOKIE);
  const platformCookies = (await pctx.cookies()).filter((c) => c.name === PLATFORM_COOKIE);
  const screensFor: { name: string; path: string; testId: string; cookies: typeof customerCookies; widths: number[] }[] = [
    { name: "team-at-limit", path: TEAM, testId: "team-seat-summary", cookies: customerCookies, widths: WIDTHS },
    { name: "team-over-limit", path: TEAM, testId: "team-seat-summary", cookies: overCookies, widths: [1440, 390] },
    { name: "console-at-limit", path: `/platform/companies/${T.orgId}?tab=users`, testId: "company-seats", cookies: platformCookies, widths: WIDTHS },
    { name: "console-user-page", path: `/platform/users/${T.ids["faisal.admin@qasr-fixture.test"]}`, testId: "user-seats", cookies: platformCookies, widths: [1440, 390] },
  ];
  for (const locale of ["en", "ar"] as const) {
    for (const theme of ["light", "dark"] as const) {
      for (const s of screensFor) {
        const ctx = await newContext(A, { locale, theme });
        await ctx.addCookies(s.cookies);
        const page = await ctx.newPage();
        for (const w of s.widths) {
          await page.setViewportSize({ width: w, height: w < 500 ? 844 : 900 });
          await go(page, s.path);
          await page.getByTestId(s.testId).waitFor({ state: "visible", timeout: 20_000 });
          if (w <= 390) await page.getByTestId(s.testId).scrollIntoViewIfNeeded();
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
  ok(`E11 ${screens} screens (Team tab, console company and user pages) × EN / AR × light / dark × five widths: one h1, named controls, labelled fields, no horizontal scroll, no clipped text, white on orange, lang / dir / theme applied`, failures.length === 0 && screens === 56, failures.slice(0, 3).join(" | "));
  const rctx = await newContext(A, { locale: "ar", theme: "dark" }, { width: 390, height: 844 });
  await rctx.addCookies(platformCookies);
  const rp = await rctx.newPage();
  await go(rp, `/platform/companies/${T.orgId}?tab=users`);
  const ar7 = plain(await rp.getByTestId("company-seats").innerText());
  ok("E11 the console in Arabic: the limit callout and the enforced value are the dictionary's Arabic, the counts left-to-right",
    ar7.length > 0 && !/User limit|Enforced|The user limit is reached/.test(ar7) && (await rp.getByTestId("company-seats").locator("[dir=ltr]").count()) >= 3 && (await rp.getByTestId("seats-limit-reached").count()) === 1, ar7.slice(0, 300));
  await shot(rp, "40-console-at-limit-ar-dark-390");

  // ============================================================================================================
  section("E12 No server error was logged; nothing was requested from another host");
  const out = (A.output() + B.output()).replace(/Your version of Next\.js[^\n]*/g, "");
  ok("E12 no server error or unhandled rejection in either server's output", !/Error: |TypeError|Unhandled/.test(out), out.slice(-400));
  ok("E12 the servers' output holds no password or secret", ![PASSWORD, OPERATOR_PASSWORD, MEMBER_PASSWORD, ...Object.values(secrets)].some((s) => typeof s === "string" && s.length >= 6 && out.includes(s)));
  const foreign = [...requestedHosts].filter((h) => h !== "localhost" && h !== "127.0.0.1" && h !== "");
  ok("E12 every request stayed on loopback", foreign.length === 0, foreign.join(","));
  ok("E12 screenshots written (only when PO03D_SCREENSHOT_DIR is set)", !SHOTS || shots.length >= 60, String(shots.length));
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-seat-enforcement-browser");
} catch (e) {
  ok("suite ran to completion", false, describeError(e));
  exitCode = summary("verify:platform-seat-enforcement-browser");
} finally {
  for (const c of contexts) await c.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await A?.stop().catch(() => undefined);
  await B?.stop().catch(() => undefined);
  await pool.end().catch(() => undefined);
  if (created && !process.env.PLATFORM_TEST_KEEP_DATABASES) await dropDisposableDatabase(testDbName).catch(() => undefined);
  if (SHOTS) console.log(`${shots.length} screenshots written`);
}
process.exit(exitCode);
