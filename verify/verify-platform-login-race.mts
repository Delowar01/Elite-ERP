/**
 * Platform Owner PO-02C.1 — customer sign-in racing a company suspension, and recovery-code races: a
 * DETERMINISTIC concurrency suite over real HTTP. The production build (`next build` first) is served by
 * `next start` on loopback and driven in Chromium; suspensions and reactivations run through the real console
 * core (src/lib/platform/company-access-actions.ts) in this process, on the same disposable database.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *   PO02C1_EVIDENCE_DIR=<optional output dir> npm run verify:platform-login-race
 *
 * Determinism — no timing is guessed. Test-only triggers (created here, in the disposable database only) make a
 * chosen statement wait on a PostgreSQL advisory lock that a dedicated connection of this suite holds, so a
 * sign-in is paused at an exact statement (its session insert, its user-row update) or a suspension at its audit
 * insert (just before its commit, holding the company lock). The suite then reads pg_stat_activity to see which
 * backend waits on what (the barrier, a row lock), acts on a separate connection, and releases the barrier.
 * Elapsed-time bounds are used only to show that something did NOT finish while it was blocked.
 *
 * Server A: TENANT_ACCESS_ENFORCEMENT=enabled · B: enforcement OFF · C: enabled + CUSTOMER_LEGACY_TOKENS=reject.
 * Fictional companies, users and operators only; TEST-ONLY secrets generated in memory and never printed.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { connectDisposable, createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { section, ok, summary, describeError } from "./platform/harness";
import { startServer, testSecrets, type Server } from "./platform/browser-env";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");

const testDbName = disposableName("po02c1_race");
const secrets = testSecrets();
process.env.DATABASE_URL = databaseUrlFor(testDbName);
Object.assign(process.env, secrets, { PLATFORM_CONSOLE_ENABLED: "true", PLATFORM_TRUSTED_PROXY_HOPS: "1", TENANT_ACCESS_ENFORCEMENT: "enabled" });
delete process.env.CUSTOMER_LEGACY_TOKENS;

let created = false;
await createPlatformTestDatabase("po02c1_race", testDbName);
created = true;

const { db, pool, platformAdminsTable } = await import("../src/db");
const auth = await import("../src/lib/platform/auth");
const mfa = await import("../src/lib/platform/mfa");
const totp = await import("../src/lib/platform/totp");
const { platformClock } = await import("../src/lib/platform/clock");
const console_ = await import("../src/lib/platform/console");
const actions = await import("../src/lib/platform/company-access-actions");
const companies = await import("../src/lib/platform/companies");
const tenantAuth = await import("../src/lib/auth");
const { encryptField, decryptField } = await import("../src/lib/crypto/field-encryption");
const { seedOrgDefaults } = await import("../src/lib/seed-org");
const bcrypt = (await import("bcryptjs")).default;
// The fixture users' authenticator secret: random per run (TEST-ONLY), never printed.
const CUSTOMER_TOTP_SECRET = mfa.createTotpEnrollment("authenticator@race-fixture.test").secret;

const EVIDENCE = process.env.PO02C1_EVIDENCE_DIR || "";
if (EVIDENCE) mkdirSync(EVIDENCE, { recursive: true });
const PORT_A = Number(process.env.PO02C1_PORT_A || 3447);
const PORT_B = Number(process.env.PO02C1_PORT_B || 3448);
const PORT_C = Number(process.env.PO02C1_PORT_C || 3449);
const PASSWORD = "Juniper-Compass-62!k";
const CUSTOMER_PASSWORD = "Saffron-Meadow-48!t";
const SESSION_COOKIE = "__Host-elite_erp_session";
const SUSPENDED_TEXT = "Your company's access is suspended.";
const UNAVAILABLE_TEXT = "Sign-in is temporarily unavailable.";
const CODE_REFUSED_TEXT = "That code didn't match.";
const INVALID_TEXT = "Invalid email or password.";
const secretsSeen: string[] = [PASSWORD, CUSTOMER_PASSWORD, ...Object.values(secrets)];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const q = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
const evidence: Record<string, unknown> = {};
secretsSeen.push(CUSTOMER_TOTP_SECRET);

// ---- the platform side: one fictional operator; a deterministic platform clock gives each step-up a fresh TOTP step ----
let nowMs = Math.floor(Date.now() / 1000) * 1000;
platformClock.now = () => new Date(nowMs);
const nextStep = () => {
  nowMs = (totp.totpStepAt(new Date(nowMs)) + 1) * 30_000 + 1_000;
};
type Admin = { id: string; email: string; secret: string };
let operator!: Admin;
let opToken = "";
const opHeaders = () => new Headers({ host: "race.erp.test", origin: "https://race.erp.test", "sec-fetch-site": "same-origin", "user-agent": "verify-platform-login-race", "x-forwarded-for": "198.51.100.120" });
async function opSignIn() {
  nextStep();
  const r = await console_.signInCore({ email: operator.email, password: PASSWORD, totpCode: totp.hotpCode(operator.secret, totp.totpStepAt(new Date(nowMs))) }, { headers: opHeaders() });
  if (!r.ok) throw new Error(`operator sign-in failed: ${r.code}`);
  opToken = r.token;
  secretsSeen.push(r.token);
  nextStep();
}
/** Start an access change now; the caller decides when to await it, and calls nextStep() after it settles. */
function startChange(orgId: number, target: "suspended" | "active") {
  const code = totp.hotpCode(operator.secret, totp.totpStepAt(new Date(nowMs)));
  return actions.setCompanyAccessCore({ headers: opHeaders(), token: opToken }, { orgId: String(orgId), target, reference: companies.orgReference(orgId), reason: `Fixture: race scenario (${target})`, password: PASSWORD, totpCode: code });
}
async function change(orgId: number, target: "suspended" | "active") {
  const r = await startChange(orgId, target);
  nextStep();
  if (!r.ok) throw new Error(`access change failed: ${r.code}`);
  return r;
}

// ---- fictional customer companies and users -------------------------------------------------------------------------
async function company(name: string): Promise<number> {
  const [o] = await q<{ id: number }>("insert into orgs (name, country, currency, base_currency_confirmed_at) values ($1, 'Saudi Arabia', 'SAR', now()) returning id", [name]);
  await db.transaction((tx) => seedOrgDefaults(tx, o.id, "Saudi Arabia"));
  await q("insert into customers (org_id, name) values ($1, 'Fixture business row')", [o.id]);
  return o.id;
}
type User = { id: number; orgId: number; email: string; recovery: string[] };
async function user(orgId: number, email: string, recovery: string[] = []): Promise<User> {
  const hash = await tenantAuth.hashPassword(CUSTOMER_PASSWORD);
  const mfaOn = recovery.length > 0;
  const codes = mfaOn ? encryptField(JSON.stringify(await Promise.all(recovery.map((c) => bcrypt.hash(c, 4))))) : null;
  const [u] = await q<{ id: number }>(
    "insert into users (org_id, email, password_hash, name, role, is_active, mfa_enabled, mfa_secret, mfa_recovery_codes) values ($1, $2, $3, $4, 'owner', true, $5, $6, $7) returning id",
    [orgId, email, hash, `Fixture ${email.split("@")[0]}`, mfaOn, mfaOn ? encryptField(CUSTOMER_TOTP_SECRET) : null, codes],
  );
  secretsSeen.push(...recovery);
  return { id: u.id, orgId, email, recovery };
}
const codesLeft = async (u: User) => (JSON.parse(decryptField((await q<{ c: string | null }>("select mfa_recovery_codes as c from users where id = $1", [u.id]))[0].c) ?? "[]") as string[]).length;
const sessionsOf = async (u: User) => q<{ id: number; revoked_at: Date | null; revoked_reason: string | null }>("select id, revoked_at, revoked_reason from sessions where user_id = $1 order by id", [u.id]);
const eventsOf = async (u: User) => (await q<{ type: string }>("select type from security_events where user_id = $1 order by id", [u.id])).map((r) => r.type);
const lastLogin = async (u: User) => (await q<{ t: Date | null }>("select last_login_at as t from users where id = $1", [u.id]))[0].t?.toISOString() ?? null;
const count = (xs: string[], x: string) => xs.filter((e) => e === x).length;

// ---- deterministic barriers -------------------------------------------------------------------------------------------
let ctl!: Awaited<ReturnType<typeof connectDisposable>>;
let barrierKey = 7_300_000;
async function installBarriers() {
  await q(`create table po02c1_test_only_barrier (name text primary key, rel text not null, key_col text not null, key_val text not null, lock_key bigint not null)`);
  await q(`create function po02c1_test_only_barrier_fn() returns trigger language plpgsql as $$
    declare b record;
    begin
      for b in select * from po02c1_test_only_barrier where rel = TG_TABLE_NAME loop
        if (to_jsonb(NEW) ->> b.key_col) = b.key_val then perform pg_advisory_xact_lock(b.lock_key); end if;
      end loop;
      return NEW;
    end $$`);
  await q(`create trigger po02c1_test_only_barrier_sessions before insert on sessions for each row execute function po02c1_test_only_barrier_fn()`);
  await q(`create trigger po02c1_test_only_barrier_users before update on users for each row execute function po02c1_test_only_barrier_fn()`);
  await q(`create trigger po02c1_test_only_barrier_audit before insert on platform_audit_events for each row execute function po02c1_test_only_barrier_fn()`);
}
type Barrier = { release: () => Promise<void> };
/** Hold an advisory lock, then arm it: the next matching row write waits on it until release(). */
async function arm(rel: "sessions" | "users" | "platform_audit_events", keyCol: string, keyVal: number | string): Promise<Barrier> {
  const key = ++barrierKey;
  const name = `b${key}`;
  await ctl.query("select pg_advisory_lock($1)", [key]);
  await q("insert into po02c1_test_only_barrier (name, rel, key_col, key_val, lock_key) values ($1, $2, $3, $4, $5)", [name, rel, keyCol, String(keyVal), key]);
  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      await q("delete from po02c1_test_only_barrier where name = $1", [name]);
      await ctl.query("select pg_advisory_unlock($1)", [key]);
    },
  };
}
type Waiter = { pid: number; wait_event: string; query: string };
const waiters = async () => q<Waiter>("select pid, wait_event, query from pg_stat_activity where datname = current_database() and state = 'active' and wait_event_type = 'Lock'");
async function until(cond: () => Promise<boolean>, ms = 20_000): Promise<boolean> {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await cond()) return true;
    await sleep(40);
  }
  return false;
}
const atBarrier = (re: RegExp, n = 1) => async () => (await waiters()).filter((w) => w.wait_event === "advisory" && re.test(w.query)).length >= n;
const onRowLock = (re: RegExp) => async () => (await waiters()).some((w) => (w.wait_event === "transactionid" || w.wait_event === "tuple") && re.test(w.query));
const SESSION_INSERT = /insert into "sessions"/i;
const USER_UPDATE = /update "users"/i;
const AUDIT_INSERT = /insert into "platform_audit_events"/i;
const ORG_LOCK_FOR_CHANGE = /from "orgs"[\s\S]*for no key update/i;
const ORG_LOCK_FOR_SIGN_IN = /from "orgs"[\s\S]*for share/i;
const USER_LOCK = /from "users"[\s\S]*for (no key )?update/i;
const secondSignInWaits = async () => (await onRowLock(USER_LOCK)()) || (await onRowLock(USER_UPDATE)()) || (await atBarrier(USER_UPDATE, 2)());
/** Whether a promise settles within `ms` (its result is left to the caller). */
async function settlesWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
  let done = false;
  p.then(
    () => (done = true),
    () => (done = true),
  );
  await until(async () => done, ms);
  return done;
}

// ---- customer sign-in through the real form ---------------------------------------------------------------------------
let browser!: Browser;
let A!: Server;
let B!: Server;
let C!: Server;
const contexts: BrowserContext[] = [];
async function context(server: Server): Promise<BrowserContext> {
  const ctx = await browser.newContext({ baseURL: server.url, viewport: { width: 1280, height: 800 }, extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${10 + (contexts.length % 200)}` } });
  await ctx.addCookies([
    { name: "locale", value: "en", url: server.url },
    { name: "theme", value: "light", url: server.url },
  ]);
  contexts.push(ctx);
  return ctx;
}
type Outcome = { kind: "signed_in" | "error" | "crashed"; text: string; path: string; setCookie: boolean; status: number };
type Login = { page: Page; ctx: BrowserContext; submit: () => void; outcome: () => Promise<Outcome> };
/** Open the form and fill it (passing the code step when a code is given) up to the final submit, which submit() fires. */
async function prepareLogin(server: Server, u: User, code?: string): Promise<Login> {
  const ctx = await context(server);
  const page = await ctx.newPage();
  const seen = { setCookie: false, status: 0 };
  page.on("response", (r) => {
    if (r.request().method() !== "POST") return;
    seen.status = r.status();
    r.headersArray()
      .then((hs) => {
        if (hs.some((h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith(`${SESSION_COOKIE}=`) && !/max-age=0/i.test(h.value))) seen.setCookie = true;
      })
      .catch(() => undefined);
  });
  await page.goto("/login");
  await page.locator("h1").first().waitFor();
  await page.locator("#email").fill(u.email);
  await page.locator("#password").fill(CUSTOMER_PASSWORD);
  if (code) {
    await page.locator("form button[type=submit]").click();
    await page.locator("#mfaCode").waitFor({ state: "visible", timeout: 20_000 });
    await page.locator("#mfaCode").fill(code);
  }
  let settled: Promise<Outcome> | null = null;
  const signedInPath = () => ["/dashboard", "/access-suspended"].includes(new URL(page.url()).pathname);
  const watch = async (): Promise<Outcome> => {
    const t0 = Date.now();
    let kind: Outcome["kind"] = "crashed";
    let text = "";
    let formGoneAt = 0;
    while (Date.now() - t0 < 40_000) {
      if (signedInPath()) {
        kind = "signed_in";
        break;
      }
      // A thrown server action answers 500 and Next replaces the page with its error screen.
      if (seen.status >= 500) {
        await sleep(300);
        text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 120);
        kind = "crashed";
        break;
      }
      const err = page.locator("form p.text-danger");
      if ((await err.count()) > 0) {
        text = (await err.first().innerText().catch(() => "")).trim();
        if (text) {
          kind = "error";
          break;
        }
      }
      // During the client navigation to the dashboard the form unmounts a moment before the URL changes.
      if ((await page.locator("form").count()) === 0) {
        formGoneAt ||= Date.now();
        if (Date.now() - formGoneAt > 10_000) {
          text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 120);
          kind = "crashed";
          break;
        }
      } else formGoneAt = 0;
      await sleep(60);
    }
    await sleep(150); // let the response listener record the cookie header
    return { kind, text, path: new URL(page.url()).pathname, setCookie: seen.setCookie, status: seen.status };
  };
  return {
    page,
    ctx,
    submit: () => {
      void page.locator("form button[type=submit]").click();
    },
    outcome: () => (settled ??= watch()),
  };
}
const cookieOf = async (ctx: BrowserContext) => (await ctx.cookies()).find((c) => c.name === SESSION_COOKIE)?.value ?? null;
async function signIn(server: Server, u: User, code?: string): Promise<Outcome> {
  const l = await prepareLogin(server, u, code);
  l.submit();
  const out = await l.outcome();
  return { ...out, setCookie: out.setCookie || (await cookieOf(l.ctx)) !== null };
}
async function get(server: Server, path: string, token: string | null) {
  const r = await fetch(`${server.url}${path}`, { redirect: "manual", headers: token ? { cookie: `${SESSION_COOKIE}=${token}`, "x-forwarded-for": "198.51.100.99" } : { "x-forwarded-for": "198.51.100.99" } });
  await r.arrayBuffer();
  return { status: r.status, location: r.headers.get("location") };
}
/** What a token is worth on the dashboard right now. */
const usable = async (server: Server, token: string | null) => {
  if (!token) return "no-token";
  const r = await get(server, "/dashboard", token);
  return r.status === 200 ? "usable" : r.location === "/access-suspended" ? "suspended" : "signed-out";
};
const customerTotp = () => totp.hotpCode(CUSTOMER_TOTP_SECRET, Math.floor(Date.now() / 30_000));

async function main() {
  {
    const at = new Date(nowMs);
    const { secret } = mfa.createTotpEnrollment("race-operator@race-fixture.test");
    const { codes, hashes } = await mfa.createRecoveryCodeSet();
    const [row] = await db
      .insert(platformAdminsTable)
      .values({ emailNormalized: "race-operator@race-fixture.test", displayName: "Race Operator", passwordHash: await auth.hashPlatformPassword(PASSWORD), isActive: true, mfaSecretEncrypted: mfa.encryptTotpSecret(secret), mfaRecoveryHashes: hashes, mfaEnrolledAt: at, passwordChangedAt: at, createdAt: at, updatedAt: at })
      .returning({ id: platformAdminsTable.id });
    operator = { id: row.id, email: "race-operator@race-fixture.test", secret };
    secretsSeen.push(secret, ...codes);
  }
  await opSignIn();
  ctl = await connectDisposable(process.env.DATABASE_URL!);
  await installBarriers();

  const fx = {
    before: await company("Race Suspended-before Fixture Co"),
    between: await company("Race Between-steps Fixture Co"),
    s1: await company("Race Insert Fixture Co"),
    s2: await company("Race Reactivation Fixture Co"),
    s3: await company("Race Recovery Fixture Co"),
    s4: await company("Race Suspend-first Fixture Co"),
    s5: await company("Race Same-code Fixture Co"),
    s6: await company("Race Two-codes Fixture Co"),
    s7: await company("Race Insert-failure Fixture Co"),
    s8: await company("Race Audit-failure Fixture Co"),
    react: await company("Race Reactivation-in-flight Fixture Co"),
    deact: await company("Race Deactivation Fixture Co"),
    legacy: await company("Race Legacy Fixture Co"),
    explicit: await company("Race Explicit Fixture Co"),
    bystander: await company("Race Bystander Fixture Co"),
    busy: await company("Race Busy-suspension Fixture Co"),
    unavailable: await company("Race Unavailable Fixture Co"),
    off: await company("Race Switch-off Fixture Co"),
    offSuspended: await company("Race Switch-off Suspended Fixture Co"),
  };
  const u = {
    before: await user(fx.before, "owner@race-before.test", ["RACE-ALPHA-11", "RACE-BRAVO-12"]),
    between: await user(fx.between, "owner@race-between.test", ["RACE-ALPHA-21", "RACE-BRAVO-22"]),
    s1: await user(fx.s1, "owner@race-s1.test"),
    s2: await user(fx.s2, "owner@race-s2.test"),
    s3: await user(fx.s3, "owner@race-s3.test", ["RACE-ALPHA-31", "RACE-BRAVO-32"]),
    s4: await user(fx.s4, "owner@race-s4.test", ["RACE-ALPHA-41", "RACE-BRAVO-42"]),
    s5: await user(fx.s5, "owner@race-s5.test", ["RACE-ALPHA-51", "RACE-BRAVO-52", "RACE-CHARLIE-53"]),
    s6: await user(fx.s6, "owner@race-s6.test", ["RACE-ALPHA-61", "RACE-BRAVO-62", "RACE-CHARLIE-63"]),
    s7: await user(fx.s7, "owner@race-s7.test", ["RACE-ALPHA-71", "RACE-BRAVO-72"]),
    s8: await user(fx.s8, "owner@race-s8.test", ["RACE-ALPHA-81", "RACE-BRAVO-82"]),
    react: await user(fx.react, "owner@race-react.test"),
    deact: await user(fx.deact, "staff@race-deact.test"),
    legacy: await user(fx.legacy, "owner@race-legacy.test"),
    totp: await user(fx.legacy, "admin@race-legacy.test", ["RACE-ALPHA-A1", "RACE-BRAVO-A2"]),
    d8: await user(fx.legacy, "staff@race-legacy.test"),
    explicit: await user(fx.explicit, "owner@race-explicit.test"),
    bystander: await user(fx.bystander, "owner@race-bystander.test"),
    unavailable: await user(fx.unavailable, "owner@race-unavailable.test", ["RACE-ALPHA-01", "RACE-BRAVO-02"]),
    off: await user(fx.off, "owner@race-off.test", ["RACE-ALPHA-91", "RACE-BRAVO-92", "RACE-CHARLIE-93"]),
    offSuspended: await user(fx.offSuspended, "owner@race-off-suspended.test"),
  };
  await change(fx.explicit, "suspended");
  await change(fx.explicit, "active"); // an explicit 'active' access row
  await change(fx.offSuspended, "suspended");

  // Business data the races must never touch: every table except the sign-in, session and access tables.
  const tables = (await q<{ t: string }>("select tablename as t from pg_tables where schemaname = 'public' and tablename not like 'po02c1_test_only_%' order by 1")).map((r) => r.t);
  const SIGN_IN_TABLES = new Set(["sessions", "users", "security_events", "tenant_access_controls", "platform_audit_events", "platform_admins", "platform_sessions", "platform_login_attempts"]);
  const checksum = async (t: string) => (await q<{ h: string }>(`select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from "${t}" x`))[0].h;
  const businessBefore = Object.fromEntries(await Promise.all(tables.filter((t) => !SIGN_IN_TABLES.has(t)).map(async (t) => [t, await checksum(t)] as const)));

  browser = await chromium.launch({ executablePath: process.env.PO01B_CHROMIUM || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const common = { ...secrets, DATABASE_URL: process.env.DATABASE_URL, PLATFORM_CONSOLE_ENABLED: "true", PLATFORM_TRUSTED_PROXY_HOPS: "1" };
  A = await startServer(PORT_A, { ...common, TENANT_ACCESS_ENFORCEMENT: "enabled", CUSTOMER_LEGACY_TOKENS: undefined });
  B = await startServer(PORT_B, { ...common, TENANT_ACCESS_ENFORCEMENT: undefined, CUSTOMER_LEGACY_TOKENS: undefined });
  C = await startServer(PORT_C, { ...common, TENANT_ACCESS_ENFORCEMENT: "enabled", CUSTOMER_LEGACY_TOKENS: "reject" });

  // ------------------------------------------------------------------------------------------------------------------
  section("0. Suspension committed before the first access check (server A, enforcement on)");
  {
    await change(fx.before, "suspended");
    const n = await codesLeft(u.before);
    const out = await signIn(A, u.before, u.before.recovery[0]);
    ok("suspended before the sign-in starts → the neutral message after the code step; no session, no code spent, no success record, no cookie", out.kind === "error" && out.text.includes(SUSPENDED_TEXT) && (await sessionsOf(u.before)).length === 0 && (await codesLeft(u.before)) === n && !(await eventsOf(u.before)).includes("login.success") && !out.setCookie, JSON.stringify(out));

    const l = await prepareLogin(A, u.between, u.between.recovery[0]); // the password step passed; the code is typed
    await change(fx.between, "suspended");
    const m = await codesLeft(u.between);
    l.submit();
    const o2 = await l.outcome();
    ok("suspended between the password step and the code step → refused at the code step; nothing spent, no cookie", o2.kind === "error" && o2.text.includes(SUSPENDED_TEXT) && (await sessionsOf(u.between)).length === 0 && (await codesLeft(u.between)) === m && !o2.setCookie, JSON.stringify(o2));
  }

  // ------------------------------------------------------------------------------------------------------------------
  section("1. Suspension racing the session INSERT (the sign-in paused at that exact statement)");
  {
    const bar = await arm("sessions", "org_id", fx.s1);
    const l = await prepareLogin(A, u.s1);
    l.submit();
    ok("the sign-in is paused at its session insert (barrier)", await until(atBarrier(SESSION_INSERT)));
    const suspension = startChange(fx.s1, "suspended");
    const blocked = await until(onRowLock(ORG_LOCK_FOR_CHANGE), 5_000);
    const finishedWhilePaused = await settlesWithin(suspension, 1_500);
    await bar.release();
    const out = await l.outcome();
    const s = await suspension;
    nextStep();
    const rows = await sessionsOf(u.s1);
    evidence.s1 = { suspensionWaitedOnCompanyLock: blocked, suspensionFinishedWhileSignInPaused: finishedWhilePaused, signIn: out.kind, sessionsEnded: s.ok ? s.sessionsEnded : s.code, rows };
    ok("the suspension WAITS for the in-flight sign-in on the company row (it cannot commit around it)", blocked && !finishedWhilePaused, JSON.stringify(evidence.s1));
    ok("…after release the sign-in committed first, and the suspension's bulk revocation then ended that very session (none escaped it)", s.ok && s.sessionsEnded === 1 && rows.length === 1 && rows[0].revoked_reason === "org_suspended", JSON.stringify(evidence.s1));
    ok("…the token it received is not usable while the company is suspended", (await usable(A, await cookieOf(l.ctx))) !== "usable");
    await change(fx.s1, "active");
    ok("…reactivation after the racing sign-in: that token stays signed out — the user must sign in again", (await usable(A, await cookieOf(l.ctx))) === "signed-out");
    const fresh = await signIn(A, u.s1);
    ok("…and a fresh sign-in after reactivation works", fresh.kind === "signed_in", JSON.stringify(fresh));
  }

  // ------------------------------------------------------------------------------------------------------------------
  section("2. A sign-in paused across a suspension AND a reactivation");
  {
    const bar = await arm("sessions", "org_id", fx.s2);
    const l = await prepareLogin(A, u.s2);
    l.submit();
    ok("the sign-in is paused at its session insert", await until(atBarrier(SESSION_INSERT)));
    const suspension = startChange(fx.s2, "suspended");
    const finished = await settlesWithin(suspension, 3_000);
    let reactivatedWhilePaused = false;
    if (finished) {
      nextStep();
      await change(fx.s2, "active");
      reactivatedWhilePaused = true;
    }
    await bar.release();
    const out = await l.outcome();
    if (!finished) {
      const s = await suspension;
      nextStep();
      if (!s.ok) throw new Error(`suspension failed: ${s.code}`);
      await change(fx.s2, "active");
    }
    const state = await usable(A, await cookieOf(l.ctx));
    evidence.s2 = { suspensionFinishedWhileSignInPaused: finished, reactivatedWhileSignInPaused: reactivatedWhilePaused, signIn: out.kind, tokenAfterReactivation: state, rows: await sessionsOf(u.s2) };
    ok("a sign-in authenticated before the suspension cannot leave a session usable after the reactivation without signing in again", state === "signed-out", JSON.stringify(evidence.s2));
  }

  // ------------------------------------------------------------------------------------------------------------------
  section("3. Suspension after the access check, during the recovery-code consumption (paused at the user-row update)");
  {
    const before = await codesLeft(u.s3);
    const bar = await arm("users", "id", u.s3.id);
    const l = await prepareLogin(A, u.s3, u.s3.recovery[0]);
    l.submit();
    ok("the sign-in is paused at its user-row update (after its access check)", await until(atBarrier(USER_UPDATE)));
    const suspension = startChange(fx.s3, "suspended");
    const blocked = await until(onRowLock(ORG_LOCK_FOR_CHANGE), 5_000);
    const finishedWhilePaused = await settlesWithin(suspension, 1_500);
    await bar.release();
    const out = await l.outcome();
    const s = await suspension;
    nextStep();
    const rows = await sessionsOf(u.s3);
    const events = await eventsOf(u.s3);
    const left = await codesLeft(u.s3);
    evidence.s3 = { suspensionWaitedOnCompanyLock: blocked, finishedWhilePaused, signIn: out, sessionsEnded: s.ok ? s.sessionsEnded : s.code, codesBefore: before, codesAfter: left, events, rows };
    const committedThenEnded = left === before - 1 && rows.length === 1 && count(events, "login.success") === 1 && count(events, "mfa.recovery_used") === 1;
    const nothingSpent = left === before && rows.length === 0 && !events.includes("login.success") && !events.includes("mfa.recovery_used");
    ok("consistent: the sign-in either committed whole (code spent + session + success record) or spent nothing — never a spent code or a success record without a session", committedThenEnded || nothingSpent, JSON.stringify(evidence.s3));
    ok("…the suspension waited for it and ended the session it issued; nothing of this company is usable", blocked && !finishedWhilePaused && rows.every((r) => r.revoked_at !== null) && (await usable(A, await cookieOf(l.ctx))) !== "usable", JSON.stringify(evidence.s3));
    await change(fx.s3, "active");
  }

  // ------------------------------------------------------------------------------------------------------------------
  section("4. Suspension in progress (holding the company row, paused just before its commit) when the sign-in reaches its check");
  {
    const before = await codesLeft(u.s4);
    const bar = await arm("platform_audit_events", "org_id", fx.s4);
    const suspension = startChange(fx.s4, "suspended");
    ok("the suspension is paused at its audit insert, its company lock and session revocation already taken", await until(atBarrier(AUDIT_INSERT)));
    const l = await prepareLogin(A, u.s4, u.s4.recovery[0]);
    l.submit();
    const signInWaits = await until(onRowLock(ORG_LOCK_FOR_SIGN_IN), 5_000);
    const signInFinished = await settlesWithin(l.outcome(), 1_500);
    await bar.release();
    const s = await suspension;
    nextStep();
    const out = await l.outcome();
    const rows = await sessionsOf(u.s4);
    evidence.s4 = { signInWaitedOnCompanyLock: signInWaits, signInFinishedWhileSuspensionPaused: signInFinished, signIn: out, rows, codesBefore: before, codesAfter: await codesLeft(u.s4), events: await eventsOf(u.s4) };
    ok("the sign-in WAITS for the in-flight suspension, then is refused with the neutral message", signInWaits && !signInFinished && out.kind === "error" && out.text.includes(SUSPENDED_TEXT), JSON.stringify(evidence.s4));
    ok("…no session row, no recovery code spent, no success record, no cookie", s.ok && rows.length === 0 && (await codesLeft(u.s4)) === before && !(await eventsOf(u.s4)).includes("login.success") && !out.setCookie && (await cookieOf(l.ctx)) === null, JSON.stringify(evidence.s4));
    await change(fx.s4, "active");
  }

  // ------------------------------------------------------------------------------------------------------------------
  section("5. Two concurrent sign-ins with the SAME recovery code (server A)");
  {
    const before = await codesLeft(u.s5);
    const bar = await arm("users", "id", u.s5.id);
    const first = await prepareLogin(A, u.s5, u.s5.recovery[0]);
    const second = await prepareLogin(A, u.s5, u.s5.recovery[0]);
    first.submit();
    ok("the first sign-in is paused at its user-row update", await until(atBarrier(USER_UPDATE)));
    second.submit();
    ok("the second sign-in, with the same code, waits behind it (user row or barrier)", await until(secondSignInWaits, 10_000));
    await bar.release();
    const [o1, o2] = await Promise.all([first.outcome(), second.outcome()]);
    const rows = await sessionsOf(u.s5);
    const left = await codesLeft(u.s5);
    const events = await eventsOf(u.s5);
    evidence.s5 = { outcomes: [o1.kind, o2.kind], texts: [o1.text, o2.text], codesBefore: before, codesAfter: left, sessions: rows.length, successes: count(events, "login.success") };
    ok("exactly ONE succeeds; the other is refused with the code message (single use)", [o1.kind, o2.kind].filter((k) => k === "signed_in").length === 1 && [o1, o2].some((o) => o.kind === "error" && o.text.includes(CODE_REFUSED_TEXT)), JSON.stringify(evidence.s5));
    ok("…one session, one success record, exactly one code removed", rows.length === 1 && left === before - 1 && count(events, "login.success") === 1, JSON.stringify(evidence.s5));
    const replay = await signIn(A, u.s5, u.s5.recovery[0]);
    ok("…and the same code is refused afterwards", replay.kind === "error" && replay.text.includes(CODE_REFUSED_TEXT), JSON.stringify(replay));
  }

  // ------------------------------------------------------------------------------------------------------------------
  section("6. Two concurrent sign-ins with two DIFFERENT recovery codes (no lost update)");
  {
    const before = await codesLeft(u.s6);
    const bar = await arm("users", "id", u.s6.id);
    const first = await prepareLogin(A, u.s6, u.s6.recovery[0]);
    const second = await prepareLogin(A, u.s6, u.s6.recovery[1]);
    first.submit();
    await until(atBarrier(USER_UPDATE));
    second.submit();
    ok("the second sign-in waits behind the first", await until(secondSignInWaits, 10_000));
    await bar.release();
    const outs = await Promise.all([first.outcome(), second.outcome()]);
    const left = await codesLeft(u.s6);
    evidence.s6 = { outcomes: outs.map((o) => o.kind), codesBefore: before, codesAfter: left };
    ok("both succeed and BOTH codes are removed (neither write restores the other's code)", outs.every((o) => o.kind === "signed_in") && left === before - 2, JSON.stringify(evidence.s6));
    const r1 = await signIn(A, u.s6, u.s6.recovery[0]);
    const r2 = await signIn(A, u.s6, u.s6.recovery[1]);
    ok("…neither code works again", r1.kind === "error" && r2.kind === "error", JSON.stringify([r1.kind, r2.kind]));
  }

  // ------------------------------------------------------------------------------------------------------------------
  section("7. A database error during session issuance (injected on the session insert)");
  {
    const before = await codesLeft(u.s7);
    const lastBefore = await lastLogin(u.s7);
    await q(`create function po02c1_test_only_fail_session() returns trigger language plpgsql as $$ begin if NEW.org_id = ${Number(fx.s7)} then raise exception 'injected session failure (test only)'; end if; return NEW; end $$`);
    await q(`create trigger po02c1_test_only_fail_session before insert on sessions for each row execute function po02c1_test_only_fail_session()`);
    let out: Outcome;
    try {
      out = await signIn(A, u.s7, u.s7.recovery[0]);
    } finally {
      await q(`drop trigger if exists po02c1_test_only_fail_session on sessions`);
      await q(`drop function if exists po02c1_test_only_fail_session()`);
    }
    const events = await eventsOf(u.s7);
    evidence.s7 = { signIn: out, codesBefore: before, codesAfter: await codesLeft(u.s7), events, lastLoginChanged: (await lastLogin(u.s7)) !== lastBefore };
    ok("the sign-in fails with the generic 'temporarily unavailable' message (no detail shown)", out.kind === "error" && out.text.includes(UNAVAILABLE_TEXT), JSON.stringify(out));
    ok("…NOTHING was applied: no session row, the recovery code not spent, no success or code-used record, last sign-in time unchanged", (await sessionsOf(u.s7)).length === 0 && (await codesLeft(u.s7)) === before && !events.includes("login.success") && !events.includes("mfa.recovery_used") && (await lastLogin(u.s7)) === lastBefore, JSON.stringify(evidence.s7));
    ok("…and no session cookie was issued", !out.setCookie);
    const retry = await signIn(A, u.s7, u.s7.recovery[0]);
    ok("…once the store works again, the same (unspent) code signs in", retry.kind === "signed_in", JSON.stringify(retry));
  }

  // ------------------------------------------------------------------------------------------------------------------
  section("8. The success record cannot be written (injected on the login.success event)");
  {
    const before = await codesLeft(u.s8);
    await q(`create function po02c1_test_only_fail_event() returns trigger language plpgsql as $$ begin if NEW.type = 'login.success' and NEW.user_id = ${Number(u.s8.id)} then raise exception 'injected event failure (test only)'; end if; return NEW; end $$`);
    await q(`create trigger po02c1_test_only_fail_event before insert on security_events for each row execute function po02c1_test_only_fail_event()`);
    let out: Outcome;
    try {
      out = await signIn(A, u.s8, u.s8.recovery[0]);
    } finally {
      await q(`drop trigger if exists po02c1_test_only_fail_event on security_events`);
      await q(`drop function if exists po02c1_test_only_fail_event()`);
    }
    evidence.s8 = { signIn: out, codesBefore: before, codesAfter: await codesLeft(u.s8), sessions: await sessionsOf(u.s8), events: await eventsOf(u.s8) };
    ok("the sign-in fails ('temporarily unavailable'): no session exists without its success record", out.kind === "error" && out.text.includes(UNAVAILABLE_TEXT) && (await sessionsOf(u.s8)).length === 0, JSON.stringify(evidence.s8));
    ok("…the recovery code is not spent and no session cookie was issued", (await codesLeft(u.s8)) === before && !out.setCookie, JSON.stringify(evidence.s8));
  }

  // ------------------------------------------------------------------------------------------------------------------
  section("9. Reactivation in flight, and an account deactivated while a sign-in waits (server A)");
  {
    await change(fx.react, "suspended");
    const bar = await arm("platform_audit_events", "org_id", fx.react);
    const reactivation = startChange(fx.react, "active");
    ok("the reactivation is paused just before its commit, holding the company row", await until(atBarrier(AUDIT_INSERT)));
    const l = await prepareLogin(A, u.react);
    l.submit();
    const waits = await until(onRowLock(ORG_LOCK_FOR_SIGN_IN), 5_000);
    await bar.release();
    const r = await reactivation;
    nextStep();
    const out = await l.outcome();
    const rows = await sessionsOf(u.react);
    evidence.reactivation = { signInWaitedOnCompanyLock: waits, signIn: out, rows };
    ok("a sign-in arriving during a reactivation waits for it, then signs in normally; the reactivation did not end the new session", r.ok && waits && out.kind === "signed_in" && rows.length === 1 && rows[0].revoked_at === null && (await usable(A, await cookieOf(l.ctx))) === "usable", JSON.stringify(evidence.reactivation));

    const holder = await connectDisposable(process.env.DATABASE_URL!);
    let out2: Outcome;
    let waited = false;
    try {
      await holder.query("begin");
      await holder.query("select id from orgs where id = $1 for no key update", [fx.deact]);
      const l2 = await prepareLogin(A, u.deact);
      l2.submit();
      waited = await until(onRowLock(ORG_LOCK_FOR_SIGN_IN), 5_000);
      await q("update users set is_active = false where id = $1", [u.deact.id]); // deactivated while the sign-in waits
      await holder.query("rollback");
      out2 = await l2.outcome();
    } finally {
      await holder.query("rollback").catch(() => undefined);
      await holder.end();
    }
    evidence.deactivation = { signInWaitedOnCompanyLock: waited, signIn: out2, sessions: await sessionsOf(u.deact) };
    ok("an account deactivated while its sign-in waits is re-checked under the lock: generic refusal, no session, no cookie", waited && out2.kind === "error" && out2.text.includes(INVALID_TEXT) && (await sessionsOf(u.deact)).length === 0 && !out2.setCookie, JSON.stringify(evidence.deactivation));
  }

  // ------------------------------------------------------------------------------------------------------------------
  section("10. Ordinary companies, the authenticator path, other companies and the missing access table (server A)");
  {
    const lg = await signIn(A, u.legacy);
    ok("a company without an access row (an existing customer) signs in", lg.kind === "signed_in", JSON.stringify(lg));
    const ex = await signIn(A, u.explicit);
    ok("a company with an explicit 'active' row signs in", ex.kind === "signed_in", JSON.stringify(ex));
    const t = await signIn(A, u.totp, customerTotp());
    ok("an authenticator-app (TOTP) sign-in works and spends no recovery code", t.kind === "signed_in" && (await codesLeft(u.totp)) === 2, JSON.stringify(t));
    const bar = await arm("platform_audit_events", "org_id", fx.busy);
    const busy = startChange(fx.busy, "suspended");
    await until(atBarrier(AUDIT_INSERT));
    const by = await prepareLogin(A, u.bystander);
    by.submit();
    const bystanderDone = await settlesWithin(by.outcome(), 20_000);
    await bar.release();
    await busy;
    nextStep();
    const byOut = await by.outcome();
    ok("another company's sign-in is not delayed by a suspension in flight (it completes while that suspension holds its own company row)", bystanderDone && byOut.kind === "signed_in", JSON.stringify(byOut));
    const before = await codesLeft(u.unavailable);
    await q("alter table tenant_access_controls rename to tenant_access_controls_hidden_test_only");
    let miss: Outcome;
    try {
      miss = await signIn(A, u.unavailable, u.unavailable.recovery[0]);
    } finally {
      await q("alter table tenant_access_controls_hidden_test_only rename to tenant_access_controls");
    }
    ok("the access table missing → 'temporarily unavailable'; no session, no code spent, no cookie (fails closed)", miss.kind === "error" && miss.text.includes(UNAVAILABLE_TEXT) && (await sessionsOf(u.unavailable)).length === 0 && (await codesLeft(u.unavailable)) === before && !miss.setCookie, JSON.stringify(miss));
    ok("…recorded as login.access_unavailable", (await eventsOf(u.unavailable)).includes("login.access_unavailable"));
  }

  // ------------------------------------------------------------------------------------------------------------------
  section("11. Enforcement switched OFF (server B): the accepted behavior");
  {
    const holder = await connectDisposable(process.env.DATABASE_URL!);
    let offOut: Outcome;
    try {
      await holder.query("begin");
      await holder.query("select id from orgs where id = $1 for no key update", [fx.off]);
      offOut = await signIn(B, u.off, u.off.recovery[0]);
    } finally {
      await holder.query("rollback").catch(() => undefined);
      await holder.end();
    }
    ok("sign-in works and takes no company lock (it completes while another transaction holds the company row)", offOut.kind === "signed_in", JSON.stringify(offOut));
    const os = await signIn(B, u.offSuspended);
    ok("a company with a suspended row still signs in while enforcement is off (PO-02C activation policy unchanged)", os.kind === "signed_in" && !(await eventsOf(u.offSuspended)).includes("login.company_suspended"), JSON.stringify(os));
    const offBefore = await codesLeft(u.off);
    const bar = await arm("users", "id", u.off.id);
    const f1 = await prepareLogin(B, u.off, u.off.recovery[1]);
    const f2 = await prepareLogin(B, u.off, u.off.recovery[1]);
    f1.submit();
    await until(atBarrier(USER_UPDATE));
    f2.submit();
    await until(secondSignInWaits, 10_000);
    await bar.release();
    const offOuts = await Promise.all([f1.outcome(), f2.outcome()]);
    evidence.off = { outcomes: offOuts.map((o) => o.kind), codesBefore: offBefore, codesAfter: await codesLeft(u.off) };
    ok("the same recovery code submitted twice at once is accepted exactly once (switch off too)", offOuts.filter((o) => o.kind === "signed_in").length === 1 && offOuts.some((o) => o.kind === "error" && o.text.includes(CODE_REFUSED_TEXT)) && (await codesLeft(u.off)) === offBefore - 1, JSON.stringify(evidence.off));
  }

  // ------------------------------------------------------------------------------------------------------------------
  section("12. Legacy (jti-less) tokens with D-8 off and on");
  {
    const legacy = await tenantAuth.signSessionToken({ userId: u.d8.id, orgId: fx.legacy });
    secretsSeen.push(legacy);
    ok("D-8 off (server A): a legacy token is still accepted until it expires", (await usable(A, legacy)) === "usable");
    ok("D-8 on (server C, CUSTOMER_LEGACY_TOKENS=reject): the same token is signed out", (await usable(C, legacy)) === "signed-out");
    ok("switch off (server B): accepted as before", (await usable(B, legacy)) === "usable");
    await change(fx.legacy, "suspended");
    ok("…and it cannot bypass a suspension (server A)", (await usable(A, legacy)) === "suspended");
    await change(fx.legacy, "active");
    ok("…after reactivation a legacy token (no server-side session to end) is usable again until it expires — documented; D-8 closes it", (await usable(A, legacy)) === "usable");
  }

  // ------------------------------------------------------------------------------------------------------------------
  section("13. Business data, logs and secrets");
  {
    const after = Object.fromEntries(await Promise.all(Object.keys(businessBefore).map(async (t) => [t, await checksum(t)] as const)));
    const changed = Object.keys(businessBefore).filter((t) => businessBefore[t] !== after[t]);
    ok(`every business table (${Object.keys(businessBefore).length}: orgs, customers, accounting, invoices, stock, HR, documents, settings …) is byte-identical after all the races`, changed.length === 0 && Object.keys(businessBefore).length > 40, changed.join(", "));
    const out = A.output() + B.output() + C.output();
    const leakedOut = secretsSeen.filter((s) => s && s.length >= 8 && out.includes(s));
    ok(`no password, MFA secret, recovery code, token or app secret in the server output (${secretsSeen.length} values checked)`, leakedOut.length === 0, `${leakedOut.length} leaked`);
    const events = JSON.stringify(await q("select * from security_events"));
    const leakedEv = secretsSeen.filter((s) => s && s.length >= 8 && events.includes(s));
    ok("no password, recovery code or token in any customer security event", leakedEv.length === 0, `${leakedEv.length} leaked`);
    const stray = await q<{ n: number }>("select count(*)::int as n from pg_stat_activity where datname = current_database() and state like 'idle in transaction%'");
    ok("no connection left idle in a transaction (every sign-in transaction ended)", stray[0].n === 0, String(stray[0].n));
  }
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-login-race");
} catch (e) {
  console.error(`verify:platform-login-race crashed: ${describeError(e)}`);
  exitCode = 1;
} finally {
  if (EVIDENCE) writeFileSync(join(EVIDENCE, "login-race.json"), JSON.stringify(evidence, null, 2));
  for (const c of contexts) await c.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await A?.stop().catch(() => undefined);
  await B?.stop().catch(() => undefined);
  await C?.stop().catch(() => undefined);
  await ctl?.end().catch(() => undefined);
  await pool.end().catch(() => undefined);
  if (created && process.env.PLATFORM_TEST_KEEP_DATABASES !== "1") await dropDisposableDatabase(testDbName).catch(() => undefined);
}
process.exit(exitCode);
