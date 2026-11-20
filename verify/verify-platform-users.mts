/**
 * Platform Owner PO-03B — customer-user management on real PostgreSQL: the read model (src/lib/platform/customer-users.ts),
 * the user controls (src/lib/platform/customer-user-actions.ts) and the SHARED customer-user mutation service
 * (src/lib/team/customer-user-core.ts) that they and the customer Team actions (src/lib/team/member-changes.ts) use.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://…/<admin db with _test_only_> npm run verify:platform-users
 *
 * One disposable database (dropped at the end): the reviewed schema and platform SQL plus the PO-02D1B Trial seed.
 * Fictional companies, users, sessions and operators only; TEST-ONLY secrets generated in memory and never printed. Every
 * race runs in a known interleaving: a barrier (a held transaction or row lock) is observed waiting in pg_stat_activity
 * before it is released.
 *
 * Categories (docs/platform-owner/PO03B_DEVELOPMENT.md §F; the 18 required verifications):
 *  A allow-listed fields (1) · B nothing sensitive leaves the server (2, 18) · C no cross-company exposure (3) ·
 *  D server-side authorization (4) · E invalid / replayed TOTP refused (5) · F primary owner protected (6) ·
 *  G last active owner protected (7) · H disabling ends the user's sessions (8) · I revocation vs concurrent sign-in (9) ·
 *  J two operators (10) · K stale page (11) · L audit / evidence failure rolls back (12) · M legacy companies and the
 *  staged rollout (13) · N customer Team actions unchanged (14) · O seat accounting read-only (15) · P business records
 *  untouched (17) · Q directory search, filters, sort, pagination, input validation and query count · R audited detail.
 *  (16 — languages, mobile and themes — is the browser suite, verify:platform-users-browser.)
 */
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import pg from "pg";
import { sql } from "drizzle-orm";
import { connectDisposable, createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { describeError, ok, section, summary } from "./platform/harness";
import { withRequest } from "./platform/request-scope";

const testDbName = disposableName("po03b_users");
process.env.DATABASE_URL = databaseUrlFor(testDbName);
process.env.PLATFORM_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.FIELD_ENCRYPTION_KEYS = `1:${randomBytes(32).toString("base64")}`;
process.env.PLATFORM_CONSOLE_ENABLED = "true";
process.env.PLATFORM_TRUSTED_PROXY_HOPS = "1";
process.env.TENANT_ACCESS_ENFORCEMENT = "enabled";
delete process.env.CUSTOMER_LEGACY_TOKENS;
delete process.env.PLATFORM_INVITATIONS_ENABLED;
delete process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED;

let created = false;
await createPlatformTestDatabase("po03b_users", testDbName);
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
const { platformClock } = await import("../src/lib/platform/clock");
const console_ = await import("../src/lib/platform/console");
const guards = await import("../src/lib/platform/guards");
const users = await import("../src/lib/platform/customer-users");
const controls = await import("../src/lib/platform/customer-user-actions");
const core = await import("../src/lib/team/customer-user-core");
const changes = await import("../src/lib/team/member-changes");
const { lockOrgAccessForSessionIssue } = await import("../src/lib/security/tenant-access-gate");
const { createSession } = await import("../src/lib/security/session-store");
const tenantAuth = await import("../src/lib/auth");
const { seedOrgDefaults } = await import("../src/lib/seed-org");
// Inside Next, server code resolves next/navigation to its react-server build (as the PO-02C suite does).
{
  const require = createRequire(import.meta.url);
  const navPath = require.resolve("next/navigation");
  require.cache[navPath] = { id: navPath, filename: navPath, loaded: true, exports: require("next/dist/api/navigation.react-server.js") } as unknown as NodeJS.Module;
}
const customerSession = await import("../src/lib/session");
type Session = import("../src/lib/session").Session;
type Role = import("../src/db").Role;
(pool as unknown as { options: { max: number } }).options.max = 30;
pool.on("error", () => undefined);
pool.on("connect", (client) => client.on("error", () => undefined));

// ---- console capture (incident lines; nothing may print a secret) ---------------------------------------------------
const logged: string[] = [];
for (const level of ["log", "info", "warn", "error"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
    original(...(args as []));
  };
}

// ---- SQL capture (what the read model asks the database) -----------------------------------------------------------
let capturing = false;
let capturedTexts: string[] = [];
const originalQuery = pool.query.bind(pool) as (...args: unknown[]) => unknown;
(pool as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
  if (capturing) {
    const first = args[0] as string | { text: string };
    capturedTexts.push(typeof first === "string" ? first : first.text);
  }
  return originalQuery(...args);
};
async function capture<T>(fn: () => Promise<T>): Promise<{ value: T; texts: string[] }> {
  capturedTexts = [];
  capturing = true;
  try {
    return { value: await fn(), texts: [...capturedTexts] };
  } finally {
    capturing = false;
  }
}

// ---- helpers -------------------------------------------------------------------------------------------------------
const q = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
const one = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await q<T>(text, values))[0];
const n = async (text: string, values: unknown[] = []) => Number((await one<{ n: number }>(text, values))?.n ?? 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
let seq = 0;
const tag = () => `${Date.now().toString(36)}${++seq}`;

// Deterministic platform clock (TOTP steps, throttle windows, audit and session timestamps).
let nowMs = Math.floor(Date.now() / 1000) * 1000;
platformClock.now = () => new Date(nowMs);
const nextStep = () => {
  nowMs = (totp.totpStepAt(new Date(nowMs)) + 1) * 30_000 + 1_000;
};
const HOST = "console.erp.test";
const headersFor = (ip: string, over: Record<string, string | null> = {}) => {
  const h = new Headers({ host: HOST, origin: `https://${HOST}`, "sec-fetch-site": "same-origin", "user-agent": "verify-platform-users", "x-forwarded-for": ip });
  for (const [k, v] of Object.entries(over)) if (v === null) h.delete(k);
  else h.set(k, v);
  return h;
};
const CUSTOMER_HEADERS = { host: "customer.erp.test", origin: "https://customer.erp.test", "sec-fetch-site": "same-origin", "user-agent": "CanaryCustomerAgent/7.1", "x-forwarded-for": "198.51.100.77" };
const inCustomerRequest = <T,>(fn: () => Promise<T>) => withRequest(CUSTOMER_HEADERS, fn);
const OPERATOR_IP = "203.0.113.45";

// ---- fictional operators -------------------------------------------------------------------------------------------
const STRONG = "Harbor-Quill-73!m";
const secretsSeen: string[] = [STRONG];
type Admin = { id: string; email: string; secret: string; displayName: string; token: string };
async function createAdmin(email: string, displayName: string): Promise<Admin> {
  const { secret } = mfa.createTotpEnrollment(email);
  const { codes, hashes } = await mfa.createRecoveryCodeSet();
  const at = new Date(nowMs);
  const [row] = await db
    .insert(platformAdminsTable)
    .values({ emailNormalized: email, displayName, passwordHash: await auth.hashPlatformPassword(STRONG), isActive: true, mfaSecretEncrypted: mfa.encryptTotpSecret(secret), mfaRecoveryHashes: hashes, mfaEnrolledAt: at, passwordChangedAt: at, createdAt: at, updatedAt: at })
    .returning({ id: platformAdminsTable.id });
  secretsSeen.push(secret, ...codes);
  const a: Admin = { id: row.id, email, secret, displayName, token: "" };
  a.token = await signIn(a, OPERATOR_IP);
  return a;
}
const codeFor = (a: Admin, offset = 0) => totp.hotpCode(a.secret, totp.totpStepAt(new Date(nowMs)) + offset);
async function signIn(a: Admin, ip: string): Promise<string> {
  nextStep();
  const r = await console_.signInCore({ email: a.email, password: STRONG, totpCode: codeFor(a) }, { headers: headersFor(ip) });
  if (!r.ok) throw new Error(`fixture sign-in failed: ${r.code}`);
  secretsSeen.push(r.token);
  nextStep(); // the sign-in consumed this step; the next step-up needs a fresh one
  return r.token;
}
const lastStep = async (a: Admin) => Number((await one<{ s: string | null }>("select mfa_last_totp_step::text as s from platform_admins where id = $1", [a.id]))?.s ?? -1);
const failures = async () => n("select count(*)::int as n from platform_login_attempts where outcome = 'failure'");
const req = (a: Admin, over: Record<string, string | null> = {}) => ({ headers: headersFor(OPERATOR_IP, over), token: a.token });
const readReq = (a: Admin) => ({ headers: headersFor(OPERATOR_IP), token: a.token });
const REASON = "Fixture: account review requested by the company";

// ---- fictional companies, users and sessions -----------------------------------------------------------------------
const bcryptPad = (stem: string) => "$2b$10$" + (stem + "Q".repeat(53)).slice(0, 53);
const CANARY = {
  hash: bcryptPad("CanaryPlatformUsersHashZ8"),
  mfa: "v1:CANARY_PLATFORM_USERS_MFA_ENVELOPE_Z8",
  rec: "v1:CANARY_PLATFORM_USERS_RECOVERY_ENVELOPE_Z8",
  agent: "CanarySessionAgent/9.9",
  ip: "192.0.2.199",
};
async function newOrg(name = `Fixture Trading ${tag()}`): Promise<number> {
  return Number((await one<{ id: number }>(`insert into orgs (name, country, currency) values ($1, 'Saudi Arabia', 'SAR') returning id`, [name]))!.id);
}
async function newUser(orgId: number, role: Role, opts: { active?: boolean; label?: string; mfa?: boolean; lastLogin?: Date | null; createdAt?: Date } = {}): Promise<number> {
  const t1 = tag();
  const label = opts.label ?? role;
  const row = await one<{ id: number }>(
    `insert into users (org_id, email, password_hash, name, role, is_active, mfa_enabled, mfa_secret, mfa_recovery_codes, last_login_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11, now()), coalesce($11, now())) returning id`,
    [orgId, `${label}.${t1}@users-fixture.test`, CANARY.hash, `Fixture ${label} ${t1}`, role, opts.active ?? true, opts.mfa ?? false, CANARY.mfa, CANARY.rec, opts.lastLogin ?? null, opts.createdAt ?? null],
  );
  return Number(row!.id);
}
async function mapPrimary(orgId: number, userId: number) {
  await q(`insert into tenant_primary_owners (org_id, user_id) values ($1, $2)`, [orgId, userId]);
}
type Tenant = { orgId: number; userId: number; jti: string; token: string; tokenHash: string };
async function sessionFor(orgId: number, userId: number, opts: { expiresInMs?: number; revokedReason?: string } = {}): Promise<Tenant> {
  const jti = randomBytes(24).toString("base64url");
  const tokenHash = sha256(jti);
  await q(
    `insert into sessions (org_id, user_id, token_hash, ip_address, user_agent, expires_at, revoked_at, revoked_reason) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [orgId, userId, tokenHash, CANARY.ip, CANARY.agent, new Date(Date.now() + (opts.expiresInMs ?? 30 * 86_400_000)), opts.revokedReason ? new Date() : null, opts.revokedReason ?? null],
  );
  const token = await tenantAuth.signSessionToken({ userId, orgId, jti });
  secretsSeen.push(jti, token, tokenHash);
  return { orgId, userId, jti, token, tokenHash };
}
const liveSessions = (userId: number) => n(`select count(*)::int as n from sessions where user_id = $1 and revoked_at is null and expires_at > now()`, [userId]);
const userRow = (id: number) => one<{ role: string; is_active: boolean; org_id: number; updated_at: Date }>(`select role, is_active, org_id, updated_at from users where id = $1`, [id]);
const stateOf = async (token: string) => (await customerSession.resolveSessionToken(token)).status;
async function versionOf(a: Admin, userId: number): Promise<string> {
  const r = await controls.readCustomerUserStateCore(readReq(a), String(userId));
  if (!r.ok) throw new Error(`state read failed: ${r.code}`);
  return r.state.version;
}
type Outcome = { ok: true } | { ok: false; code: string };
const codeOf = (o: Outcome) => (o.ok ? "OK" : o.code);
async function setStatus(a: Admin, userId: number, target: "disabled" | "active", over: Partial<{ reason: string; totpCode: string; version: string }> = {}) {
  nextStep();
  const version = over.version ?? (await versionOf(a, userId));
  return controls.setCustomerUserStatusCore(req(a), { userId: String(userId), target, reason: over.reason ?? REASON, totpCode: over.totpCode ?? codeFor(a), version });
}
async function revoke(a: Admin, userId: number, over: Partial<{ reason: string; totpCode: string }> = {}) {
  nextStep();
  return controls.revokeCustomerUserSessionsCore(req(a), { userId: String(userId), reason: over.reason ?? REASON, totpCode: over.totpCode ?? codeFor(a) });
}
type AuditRow = { action: string; result: string; org_id: number | null; reason: string | null; before_safe: Record<string, unknown> | null; after_safe: Record<string, unknown> | null; actor_platform_admin_id: string | null; actor_label: string };
const userAudits = (userId: number) =>
  q<AuditRow>(`select action, result, org_id, reason, before_safe, after_safe, actor_platform_admin_id, actor_label from platform_audit_events where entity_type = 'customer_user' and entity_id = $1 and action <> 'customer_user.viewed' order by id`, [String(userId)]);
const evidence = (userId: number) =>
  q<{ type: string; detail: string | null; metadata: Record<string, unknown> | null; ip_address: string | null; user_agent: string | null; browser: string | null; os: string | null; device: string | null; email: string | null }>(
    `select type, detail, metadata, ip_address, user_agent, browser, os, device, email from security_events where user_id = $1 and type like '%by_platform' order by id`,
    [userId],
  );

// ---- barriers ------------------------------------------------------------------------------------------------------
type Blocker = { client: pg.Client; release: (commit?: boolean) => Promise<void> };
async function blocker(lockSql: string, values: unknown[] = []): Promise<Blocker> {
  const client = await connectDisposable(process.env.DATABASE_URL!);
  client.on("error", () => undefined);
  await client.query("begin");
  await client.query(lockSql, values);
  return {
    client,
    release: async (commit = false) => {
      await client.query(commit ? "commit" : "rollback").catch(() => undefined);
      await client.end().catch(() => undefined);
    },
  };
}
/** Backends of this database waiting on a lock while running a statement that matches `re`. */
async function lockWaiters(re: RegExp): Promise<number> {
  const rows = await q<{ query: string }>(`select query from pg_stat_activity where datname = current_database() and state = 'active' and wait_event_type = 'Lock'`);
  return rows.filter((r) => re.test(r.query)).length;
}
async function until(cond: () => Promise<boolean>, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return true;
    await sleep(25);
  }
  return false;
}
const ORG_ROW_LOCK = /from "orgs"[\s\S]*for (no key update|share)/i;
const USER_ROW_LOCK = /from "users"[\s\S]*for no key update/i;

/**
 * The customer sign-in's PO-02C.1 transaction (src/app/(auth)/actions.ts completeSignIn) from its real parts: the
 * tenant-access gate's company lock (FOR SHARE) and access check, the user row FOR NO KEY UPDATE with its active re-check,
 * the last-login write and the real session insert (createSession) — then it HOLDS (a barrier) before committing.
 */
function heldSignIn(orgId: number, userId: number) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let inserted!: () => void;
  const insertedP = new Promise<void>((r) => (inserted = r));
  const done = inCustomerRequest(() =>
    db.transaction(
      async (tx) => {
        if ((await lockOrgAccessForSessionIssue(tx, orgId)) !== "active") return { ok: false as const, reason: "suspended" };
        const r = await tx.execute(sql`select org_id, is_active from users where id = ${userId} for no key update`);
        const row = r.rows[0] as { org_id: number; is_active: boolean } | undefined;
        if (!row || !row.is_active || row.org_id !== orgId) {
          inserted();
          return { ok: false as const, reason: "account" };
        }
        await tx.execute(sql`update users set last_login_at = now() where id = ${userId}`);
        const jti = await createSession(userId, orgId, tx);
        inserted();
        await gate;
        return { ok: true as const, jti };
      },
      { isolationLevel: "read committed" },
    ),
  );
  return { release, inserted: insertedP, done };
}

// ---- business-record checksum (everything but identity, session, security and platform tables) --------------------
const NOT_BUSINESS = new Set(["users", "sessions", "security_events", "activity_logs"]);
async function businessChecksum(): Promise<string> {
  const tables = (await q<{ t: string }>(`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`))
    .map((r) => r.t)
    .filter((t) => !NOT_BUSINESS.has(t) && !t.startsWith("platform_") && !t.startsWith("po03b_test_only"));
  const parts: string[] = [];
  for (const t of tables) {
    const r = await one<{ c: number; h: string | null }>(`select count(*)::int as c, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from "${t}" x`);
    parts.push(`${t}:${r?.c}:${r?.h}`);
  }
  return sha256(parts.join("\n"));
}
const SUBSCRIPTION_TABLES = ["tenant_subscriptions", "subscription_events", "subscription_packages", "subscription_package_versions", "platform_settings", "tenant_primary_owners"];
async function subscriptionChecksum(): Promise<string> {
  const parts: string[] = [];
  for (const t of SUBSCRIPTION_TABLES) {
    const r = await one<{ c: number; h: string | null }>(`select count(*)::int as c, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from "${t}" x`);
    parts.push(`${t}:${r?.c}:${r?.h}`);
  }
  return sha256(parts.join("\n"));
}

async function auditOutage(on: boolean) {
  if (on) {
    await q(`create or replace function po03b_test_only_fail_audit() returns trigger language plpgsql as $$ begin raise exception 'injected audit outage (test only)'; end $$`);
    await q(`create trigger po03b_test_only_fail_audit before insert on platform_audit_events for each row execute function po03b_test_only_fail_audit()`);
  } else {
    await q(`drop trigger if exists po03b_test_only_fail_audit on platform_audit_events`);
    await q(`drop function if exists po03b_test_only_fail_audit()`);
  }
}

async function main() {
  const operator = await createAdmin("operator@users-fixture.test", "Fixture Operator");
  const second = await createAdmin("second@users-fixture.test", "Second Operator");

  // A company with a mapped primary owner, a second owner, an admin and staff; business defaults seeded.
  const A = await newOrg("Alpha Fixture Trading");
  await db.transaction(async (tx) => seedOrgDefaults(tx, A, "Saudi Arabia"));
  const aPrimary = await newUser(A, "owner", { label: "aprimary", mfa: true, lastLogin: new Date(Date.now() - 3_600_000) });
  const aOwner2 = await newUser(A, "owner", { label: "aowner2" });
  const aAdmin = await newUser(A, "admin", { label: "aadmin", mfa: true });
  const aStaff = await newUser(A, "staff", { label: "astaff" });
  await mapPrimary(A, aPrimary);
  // A legacy company: one owner, no mapping, no subscription.
  const L = await newOrg("Legacy Fixture Supplies");
  const lOwner = await newUser(L, "owner", { label: "lowner" });
  const lStaff = await newUser(L, "staff", { label: "lstaff" });
  // A Trial company: a current subscription (1 seat) and a mapped owner.
  const T = await newOrg("Trial Fixture Logistics");
  const tOwner = await newUser(T, "owner", { label: "towner" });
  const tStaff = await newUser(T, "staff", { label: "tstaff" });
  await mapPrimary(T, tOwner);
  const v1 = (await one<{ id: string }>(`select v.id from subscription_package_versions v join subscription_packages p on p.id = v.package_id where p.is_default_trial and v.version_number = 1`))!.id;
  await q(
    `insert into tenant_subscriptions (org_id, package_version_id, version_state, is_trial, cycle, lifecycle_state, start_date, end_date, price_snapshot_sar, seats_snapshot, storage_snapshot_gb, module_groups_snapshot, assignment_source)
     values ($1, $2, 'published', true, 'trial', 'trialing', current_date, current_date + 13, 0, 1, 5, '[]'::jsonb, 'invitation_acceptance')`,
    [T, v1],
  );
  // A company for the Team last-owner check (N): one owner and one admin, no mapping.
  const N2 = await newOrg("Nexus Fixture Services");
  const n2Owner = await newUser(N2, "owner", { label: "n2owner" });
  const n2Admin = await newUser(N2, "admin", { label: "n2admin" });
  const businessBefore = await businessChecksum();
  const subscriptionsBefore = await subscriptionChecksum();

  // =====================================================================================================================
  section("A. Every directory and detail field is allow-listed (1)");
  {
    const { value: page, texts } = await capture(() => users.listCustomerUsers(readReq(operator), { org: String(A), sort: "name" }));
    const rowKeys = Object.keys(page.rows[0] ?? {}).sort();
    ok("A1 a directory row holds exactly: id, reference, name, e-mail, role, status, MFA on/off, last sign-in, created, company, primary-owner flag, seat usage", same(rowKeys, ["company", "createdAt", "email", "isActive", "lastSignInAt", "mfaEnabled", "name", "primaryOwner", "reference", "role", "seats", "userId"]), rowKeys.join(","));
    ok("A2 …the company is id, reference and name; the seat usage is occupied, allowance, over-limit and allowance state", same(Object.keys(page.rows[0].company).sort(), ["name", "orgId", "reference"]) && same(Object.keys(page.rows[0].seats ?? {}).sort(), ["allowance", "occupied", "overLimit", "seats"]));
    const detail = await capture(() => users.getCustomerUserDetail(readReq(operator), String(aAdmin)));
    ok("A3 the detail adds only the change marker, the last-active-owner rule, the live session COUNT, the company's seat accounting and the Platform Owner events", same(Object.keys(detail.value).sort(), ["activity", "company", "createdAt", "email", "isActive", "lastActiveOwner", "lastSignInAt", "liveSessions", "mfaEnabled", "name", "primaryOwner", "reference", "role", "seats", "userId", "version"]));
    const state = await capture(() => users.readCustomerUserState(readReq(operator), String(aAdmin)));
    ok("A4 the controls' live state is exactly: id, status, version, primary-owner flag, last-active-owner rule, live session count", same(Object.keys(state.value).sort(), ["isActive", "lastActiveOwner", "liveSessions", "primaryOwner", "userId", "version"]));
    const SECRET_COLUMNS = /password_hash|password_changed_at|mfa_secret|mfa_recovery_codes|token_hash|user_agent|ip_address|"browser"|"device"/i;
    const customerReads = [...texts, ...detail.texts, ...state.texts].filter((t) => /from "(users|sessions|orgs)"|join "(users|orgs)"/.test(t));
    ok("A5 no statement that reads a customer table (users, sessions, orgs) names a password, MFA, recovery, token or network column", customerReads.length >= 5 && !customerReads.some((t) => SECRET_COLUMNS.test(t)), String(customerReads.length));
    ok("A6 …and none selects a whole row", !customerReads.some((t) => /select \*|"users"\.\*|"sessions"\.\*/i.test(t)));
  }

  // =====================================================================================================================
  section("B. No password, MFA secret, recovery code, session token or network identity leaves the server (2, 18)");
  {
    const s1 = await sessionFor(A, aStaff);
    const outputs = JSON.stringify([
      await users.listCustomerUsers(readReq(operator), {}),
      await users.getCustomerUserDetail(readReq(operator), String(aStaff)),
      await users.readCustomerUserState(readReq(operator), String(aStaff)),
      await controls.readCustomerUserStateCore(readReq(operator), String(aStaff)),
    ]);
    const leaks = [CANARY.hash, CANARY.mfa, CANARY.rec, CANARY.agent, CANARY.ip, s1.tokenHash, s1.jti, s1.token].filter((c) => outputs.includes(c));
    ok("B1 the directory, detail and state outputs carry no canary hash, MFA or recovery envelope, session hash, token, user agent or IP", leaks.length === 0 && outputs.length > 1000, `${leaks.length} leaked`);
    ok("B2 …and no bcrypt-shaped string at all", !/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/.test(outputs));
    const r = await revoke(operator, aStaff);
    const ev = await evidence(aStaff);
    ok("B3 the customer's own evidence of a platform change carries no network identity (IP, user agent, browser, OS, device all empty) and names no operator", r.ok && ev.length === 1 && ev.every((e) => e.ip_address === null && e.user_agent === null && e.browser === null && e.os === null && e.device === null && e.detail === "platform_operator" && same(Object.keys(e.metadata ?? {}), ["sessionsEnded"])) && !JSON.stringify(ev).includes(operator.displayName) && !JSON.stringify(ev).includes(OPERATOR_IP));
  }

  // =====================================================================================================================
  section("C. Cross-company data is never exposed to customer users (3)");
  {
    const adminA = await customerSession.resolveSessionToken((await sessionFor(A, aAdmin)).token);
    const actor = adminA.status === "active" ? adminA.session : null;
    const lStaffBefore = await userRow(lStaff);
    const res = actor ? await inCustomerRequest(() => changes.setTeamMemberActive(actor, lStaff, false, "en")) : { error: "no session" };
    ok("C1 a Team admin of company A cannot deactivate a user of company B (the shared lock finds no such member) — nothing changes", res.error === changes.TEAM_MESSAGES.notFound && same(await userRow(lStaff), lStaffBefore));
    const locked = await db.transaction(async (tx) => core.lockCompanyUsers(tx, A, [lStaff, aStaff]));
    ok("C2 the shared service locks and returns only the given company's users (B's id is simply absent)", !!locked && same(locked.map((u) => u.id), [aStaff]));
    const customerToken = (await sessionFor(A, aAdmin)).token;
    const asCustomer = await users.listCustomerUsers({ headers: headersFor(OPERATOR_IP), token: customerToken }).then(() => "OK", (e) => (e as { code?: string }).code);
    ok("C3 a customer ERP session cannot read the console directory (UNAUTHORIZED)", asCustomer === "UNAUTHORIZED", asCustomer);
  }

  // =====================================================================================================================
  section("D. Platform permissions are checked server-side, in order (4)");
  {
    const version = await versionOf(operator, aStaff);
    const input = (over: Record<string, unknown> = {}) => ({ userId: String(aStaff), target: "disabled", reason: REASON, totpCode: codeFor(operator), version, ...over });
    const cases: [string, { headers: Headers; token: string | null }, string][] = [
      ["no platform session", { headers: headersFor(OPERATOR_IP), token: null }, "UNAUTHORIZED"],
      ["a forged token", { headers: headersFor(OPERATOR_IP), token: "eyJhbGciOiJIUzI1NiJ9.e30.forged" }, "UNAUTHORIZED"],
      ["a customer ERP token", { headers: headersFor(OPERATOR_IP), token: (await sessionFor(A, aAdmin)).token }, "UNAUTHORIZED"],
      ["a cross-site request", { headers: headersFor(OPERATOR_IP, { origin: "https://evil.example" }), token: operator.token }, "FORBIDDEN"],
      ["no Origin header", { headers: headersFor(OPERATOR_IP, { origin: null }), token: operator.token }, "FORBIDDEN"],
    ];
    const got = [];
    for (const [, r, expected] of cases) {
      const a = await controls.setCustomerUserStatusCore(r, input());
      const b = await controls.revokeCustomerUserSessionsCore(r, { userId: String(aStaff), reason: REASON, totpCode: codeFor(operator) });
      got.push([codeOf(a), codeOf(b), expected]);
    }
    ok("D1 disable / enable and revocation refuse: no session, a forged token, a customer token (UNAUTHORIZED); cross-site and Origin-less requests (FORBIDDEN)", got.every(([a, b, e]) => a === e && b === e), JSON.stringify(got));
    process.env.PLATFORM_CONSOLE_ENABLED = "false";
    const off = [codeOf(await controls.setCustomerUserStatusCore(req(operator), input())), await users.listCustomerUsers(readReq(operator)).then(() => "OK", (e) => (e as { code?: string }).code)];
    process.env.PLATFORM_CONSOLE_ENABLED = "true";
    ok("D2 with the console switched off every read and change is refused (CONSOLE_DISABLED)", same(off, ["CONSOLE_DISABLED", "CONSOLE_DISABLED"]), JSON.stringify(off));
    const unknownPermission = await guards.authorizePlatformToken(operator.token, "platform.users.administer" as never).then(() => "OK", (e) => (e as { code?: string }).code);
    ok("D3 the permission check is real: a permission the role does not hold is FORBIDDEN; the owner role holds platform.users.read and platform.users.manage", unknownPermission === "FORBIDDEN" && guards.PLATFORM_PERMISSIONS.includes("platform.users.read") && guards.PLATFORM_PERMISSIONS.includes("platform.users.manage"));
    ok("D4 …and none of the refused requests changed the account, spent a code or wrote a success record", (await userRow(aStaff))!.is_active && (await userAudits(aStaff)).every((r) => r.action !== "customer_user.disabled"));
  }

  // =====================================================================================================================
  section("E. Invalid or replayed TOTP codes are refused (5)");
  {
    const fails0 = await failures();
    const step0 = await lastStep(operator);
    const wrong = await setStatus(operator, aStaff, "disabled", { totpCode: codeFor(operator, 7) });
    ok("E1 a wrong code → MFA_INVALID; nothing changed; the failure counts against the throttle and the attempt is recorded (stage mfa)", codeOf(wrong) === "MFA_INVALID" && (await userRow(aStaff))!.is_active && (await failures()) === fails0 + 1 && (await userAudits(aStaff)).some((r) => r.action === "customer_user.disable.rejected" && r.after_safe?.stage === "mfa"));
    ok("E2 …and no code was consumed", (await lastStep(operator)) === step0);
    nextStep();
    const code = codeFor(operator);
    const used = await controls.revokeCustomerUserSessionsCore(req(operator), { userId: String(aStaff), reason: REASON, totpCode: code });
    const replay = await controls.setCustomerUserStatusCore(req(operator), { userId: String(aStaff), target: "disabled", reason: REASON, totpCode: code, version: await versionOf(operator, aStaff) });
    ok("E3 a code already used (here by a revocation) cannot approve a second change → MFA_INVALID (stage replay); the account is unchanged", used.ok && codeOf(replay) === "MFA_INVALID" && (await userRow(aStaff))!.is_active && (await userAudits(aStaff)).some((r) => r.after_safe?.stage === "replay"));
    const others = await setStatus(operator, aStaff, "disabled", { totpCode: codeFor(second) });
    ok("E4 another operator's code never approves this operator's change", codeOf(others) === "MFA_INVALID" && (await userRow(aStaff))!.is_active);
    const step5 = await lastStep(operator);
    const shapes = [
      await setStatus(operator, aStaff, "disabled", { totpCode: "12345" }),
      await setStatus(operator, aStaff, "disabled", { totpCode: "abcdef" }),
      await setStatus(operator, aStaff, "disabled", { reason: "too short" }),
      await setStatus(operator, aStaff, "disabled", { reason: "x".repeat(501) }),
      await setStatus(operator, aStaff, "disabled", { reason: "Fixture reason with a \u202e direction override" }),
      await setStatus(operator, aStaff, "disabled", { version: "not-a-version" }),
      await controls.setCustomerUserStatusCore(req(operator), { userId: String(aStaff), target: "deleted", reason: REASON, totpCode: codeFor(operator), version: await versionOf(operator, aStaff) }),
      await controls.setCustomerUserStatusCore(req(operator), { userId: "01", target: "disabled", reason: REASON, totpCode: codeFor(operator), version: "2026-01-01T00:00:00.000000" }),
    ];
    ok("E5 malformed requests (code shape, reason length / control characters, version, target) are VALIDATION_FAILED and a malformed id NOT_FOUND — and none spends a code",
      same(shapes.map(codeOf), ["VALIDATION_FAILED", "VALIDATION_FAILED", "VALIDATION_FAILED", "VALIDATION_FAILED", "VALIDATION_FAILED", "VALIDATION_FAILED", "VALIDATION_FAILED", "NOT_FOUND"]) && (await lastStep(operator)) === step5 && (await userRow(aStaff))!.is_active,
      shapes.map(codeOf).join(","));
  }

  // =====================================================================================================================
  section("F. The mapped primary owner cannot be disabled (6)");
  {
    await sessionFor(A, aPrimary);
    const sessions0 = await liveSessions(aPrimary);
    const step0 = await lastStep(operator);
    const r = await setStatus(operator, aPrimary, "disabled");
    ok("F1 disabling the mapped primary owner → LAST_PRIMARY_OWNER; the account stays active and its sessions stay live", codeOf(r) === "LAST_PRIMARY_OWNER" && (await userRow(aPrimary))!.is_active && (await liveSessions(aPrimary)) === sessions0 && sessions0 > 0);
    ok("F2 …the refusal is recorded (stage primary_owner), the code was rolled back with the transaction, and no customer evidence was written", (await userAudits(aPrimary)).some((x) => x.action === "customer_user.disable.rejected" && x.after_safe?.stage === "primary_owner") && (await lastStep(operator)) === step0 && (await evidence(aPrimary)).length === 0);
    const st = await users.readCustomerUserState(readReq(operator), String(aPrimary));
    ok("F3 the live state the dialog confirms against shows the designation (the dialog refuses before asking for a code)", st.primaryOwner === "yes");
  }

  // =====================================================================================================================
  section("G. The company's last active owner cannot be disabled (7)");
  {
    const r = await setStatus(operator, lOwner, "disabled");
    ok("G1 a legacy company's only owner → LAST_ACTIVE_OWNER; still active; recorded (stage last_owner)", codeOf(r) === "LAST_ACTIVE_OWNER" && (await userRow(lOwner))!.is_active && (await userAudits(lOwner)).some((x) => x.after_safe?.stage === "last_owner"));
    ok("G2 …the state read reports it as the last active owner", (await users.readCustomerUserState(readReq(operator), String(lOwner))).lastActiveOwner === true);
    const a2 = await setStatus(operator, aOwner2, "disabled");
    ok("G3 a second, non-primary owner of company A can be disabled (the primary owner remains an active owner)", a2.ok && !(await userRow(aOwner2))!.is_active);
    const back = await setStatus(operator, aOwner2, "active");
    ok("G4 …and enabled again", back.ok && (await userRow(aOwner2))!.is_active);
  }

  // =====================================================================================================================
  section("H. Disabling a user ends that user's sessions — and nobody else's (8)");
  {
    const x1 = await sessionFor(A, aAdmin);
    const x2 = await sessionFor(A, aAdmin);
    await sessionFor(A, aAdmin, { expiresInMs: -60_000 });
    await sessionFor(A, aAdmin, { revokedReason: "logout" });
    const y = await sessionFor(A, aStaff);
    const z = await sessionFor(L, lStaff);
    const live0 = await liveSessions(aAdmin);
    const before = await q<{ id: string; revoked_reason: string | null }>(`select id::text as id, revoked_reason from sessions where user_id = $1 and (revoked_at is not null or expires_at <= now()) order by id`, [aAdmin]);
    const r = await setStatus(operator, aAdmin, "disabled");
    ok("H1 the disable reports every live session it ended", r.ok && r.ok && (r as { sessionsEnded: number }).sessionsEnded === live0 && live0 >= 2);
    ok("H2 …every live session of the user is ended with reason 'disabled'; its tokens no longer resolve", (await liveSessions(aAdmin)) === 0 && (await stateOf(x1.token)) !== "active" && (await stateOf(x2.token)) !== "active" &&
      (await n(`select count(*)::int as n from sessions where user_id = $1 and revoked_reason = 'disabled'`, [aAdmin])) === live0);
    const after = await q<{ id: string; revoked_reason: string | null }>(`select id::text as id, revoked_reason from sessions where id = any($1::bigint[]) order by id`, [before.map((b) => b.id)]);
    ok("H3 already-expired and already-revoked sessions are left exactly as they were", same(after, before));
    ok("H4 another user of the company and a user of another company keep their sessions", (await stateOf(y.token)) === "active" && (await stateOf(z.token)) === "active");
    const ev = await evidence(aAdmin);
    ok("H5 the customer's own security log records account.disabled_by_platform with the count, and the platform audit records the operator, reason and counts", ev.some((e) => e.type === "account.disabled_by_platform" && e.metadata?.sessionsEnded === live0) &&
      (await userAudits(aAdmin)).some((x) => x.action === "customer_user.disabled" && x.result === "success" && x.reason === REASON && x.actor_platform_admin_id === operator.id && x.after_safe?.sessionsEnded === live0 && x.before_safe?.isActive === true && x.after_safe?.isActive === false && x.org_id === A));
    const stray = await sessionFor(A, aAdmin);
    const en = await setStatus(operator, aAdmin, "active");
    ok("H6 enabling makes sign-in possible again and ends any session left from before (reason 'reenabled'), so none comes back to life", en.ok && (await userRow(aAdmin))!.is_active && (await stateOf(stray.token)) !== "active" && (await n(`select count(*)::int as n from sessions where user_id = $1 and revoked_reason = 'reenabled'`, [aAdmin])) === 1);
    const again = await setStatus(operator, aAdmin, "active");
    ok("H7 a change to the state the account is already in → CONFLICT (recorded as stage state), nothing written twice", codeOf(again) === "CONFLICT" && (await userAudits(aAdmin)).filter((x) => x.action === "customer_user.enabled").length === 1);
  }

  // =====================================================================================================================
  section("I. Session revocation and disabling survive a concurrent sign-in (9)");
  {
    // I1 — a sign-in in flight (holding the company FOR SHARE, its session inserted, not committed) and a revocation.
    const s = heldSignIn(A, aStaff);
    await s.inserted;
    const p = revoke(operator, aStaff);
    ok("I1 the revocation waits for the in-flight sign-in at the company row (the PO-02C.1 lock protocol)", await until(async () => (await lockWaiters(ORG_ROW_LOCK)) >= 1));
    s.release();
    const signed = await s.done;
    const r1 = await p;
    const jtiHash = signed.ok ? sha256(signed.jti) : "";
    const row = await one<{ revoked_reason: string | null }>(`select revoked_reason from sessions where token_hash = $1`, [jtiHash]);
    ok("I2 …once the sign-in commits, the revocation ends the session it created (reason platform_revoked) and counts it", signed.ok && r1.ok && row?.revoked_reason === "platform_revoked" && (r1 as { sessionsEnded: number }).sessionsEnded >= 1);

    // I3 — the revocation holds the company row (paused at the user row by a barrier); a sign-in waits, then is a NEW sign-in.
    const earlier = await sessionFor(A, aStaff);
    const held = await blocker(`select id from users where id = $1 for no key update`, [aStaff]);
    let revocationDone = false;
    let insertedBeforeRevocation = false;
    const p2 = revoke(operator, aStaff).finally(() => (revocationDone = true));
    await until(async () => (await lockWaiters(USER_ROW_LOCK)) >= 1);
    const s2 = heldSignIn(A, aStaff);
    void s2.inserted.then(() => (insertedBeforeRevocation = !revocationDone));
    ok("I3 a sign-in that starts while the revocation holds the company row waits for it (no session can slip in between)", await until(async () => (await lockWaiters(ORG_ROW_LOCK)) >= 1));
    await held.release();
    const r2 = await p2;
    await s2.inserted;
    s2.release();
    const signed2 = await s2.done;
    const newHash = signed2.ok ? sha256(signed2.jti) : "";
    const liveRows = await q<{ token_hash: string }>(`select token_hash from sessions where user_id = $1 and revoked_at is null and expires_at > now()`, [aStaff]);
    const earlierRow = await one<{ revoked_reason: string | null }>(`select revoked_reason from sessions where token_hash = $1`, [earlier.tokenHash]);
    ok("I4 …the revocation committed first and ended every session that existed (reason platform_revoked); the waiting sign-in inserted its session only afterwards — a NEW sign-in, the only live session", r2.ok && signed2.ok && !insertedBeforeRevocation && earlierRow?.revoked_reason === "platform_revoked" && same(liveRows.map((r) => r.token_hash), [newHash]));

    // I5 — disabling while a sign-in is in flight: the sign-in's session is ended by the disable.
    const s3 = heldSignIn(L, lStaff);
    await s3.inserted;
    const p3 = setStatus(operator, lStaff, "disabled");
    await until(async () => (await lockWaiters(ORG_ROW_LOCK)) >= 1);
    s3.release();
    const signed3 = await s3.done;
    const r3 = await p3;
    const row3 = await one<{ revoked_reason: string | null }>(`select revoked_reason from sessions where token_hash = $1`, [signed3.ok ? sha256(signed3.jti) : ""]);
    ok("I5 a disable that meets an in-flight sign-in waits for it, then ends the session it created (reason disabled)", signed3.ok && r3.ok && row3?.revoked_reason === "disabled" && (await liveSessions(lStaff)) === 0);
    // I6 — a sign-in that waits behind a disable re-checks the account under its user-row lock and creates nothing.
    const en = await setStatus(operator, lStaff, "active");
    const held4 = await blocker(`select id from users where id = $1 for no key update`, [lStaff]);
    const p4 = setStatus(operator, lStaff, "disabled");
    await until(async () => (await lockWaiters(USER_ROW_LOCK)) >= 1);
    const s4 = heldSignIn(L, lStaff);
    await until(async () => (await lockWaiters(ORG_ROW_LOCK)) >= 1);
    await held4.release();
    const r4 = await p4;
    await s4.inserted;
    s4.release();
    const signed4 = await s4.done;
    ok("I6 a sign-in that waited behind a disable is refused on its re-check (account) and creates no session", en.ok && r4.ok && !signed4.ok && (await liveSessions(lStaff)) === 0);
    await setStatus(operator, lStaff, "active");

    // I7 — enforcement OFF (the legacy sign-in takes no lock): a session inserted after a disable can never be used, and
    // enabling ends it; a revocation-only race is a new sign-in (documented residual R-1).
    process.env.TENANT_ACCESS_ENFORCEMENT = "disabled";
    const dis = await setStatus(operator, lStaff, "disabled");
    const legacyJti = await inCustomerRequest(() => createSession(lStaff, L)); // the legacy issueSession path: no lock
    const legacyToken = await tenantAuth.signSessionToken({ userId: lStaff, orgId: L, jti: legacyJti });
    secretsSeen.push(legacyJti, legacyToken);
    const unusable = await stateOf(legacyToken);
    const en2 = await setStatus(operator, lStaff, "active");
    const legacyRow = await one<{ revoked_reason: string | null }>(`select revoked_reason from sessions where token_hash = $1`, [sha256(legacyJti)]);
    ok("I7 enforcement off: a session the legacy sign-in inserts after a disable is unusable (the account is checked on every request) and enabling ends it (reenabled)", dis.ok && unusable !== "active" && en2.ok && legacyRow?.revoked_reason === "reenabled");
    process.env.TENANT_ACCESS_ENFORCEMENT = "enabled";
  }

  // =====================================================================================================================
  section("J. Two operators changing one user (10)");
  {
    const target = await newUser(A, "staff", { label: "jtarget" });
    await sessionFor(A, target);
    const v = await versionOf(operator, target);
    const held = await blocker(`select id from orgs where id = $1 for share`, [A]); // what an in-flight sign-in holds
    nextStep();
    const pA = controls.setCustomerUserStatusCore(req(operator), { userId: String(target), target: "disabled", reason: REASON, totpCode: codeFor(operator), version: v });
    const pB = controls.setCustomerUserStatusCore(req(second), { userId: String(target), target: "disabled", reason: "Fixture: second operator, same decision", totpCode: codeFor(second), version: v });
    ok("J1 both operators' changes wait at the company row", await until(async () => (await lockWaiters(ORG_ROW_LOCK)) >= 2));
    await held.release();
    const [a, b] = await Promise.all([pA, pB]);
    const codes = [codeOf(a), codeOf(b)].sort();
    ok("J2 they serialize: exactly one applies; the other sees the moved version and is refused (VERSION_CONFLICT)", same(codes, ["OK", "VERSION_CONFLICT"]), codes.join(","));
    const audits = await userAudits(target);
    ok("J3 one success record and one rejected attempt (stage stale); the sessions were ended once; one evidence event", audits.filter((x) => x.action === "customer_user.disabled").length === 1 && audits.filter((x) => x.after_safe?.stage === "stale").length === 1 && (await evidence(target)).length === 1 && (await liveSessions(target)) === 0);
    const loser = a.ok ? second : operator;
    const loserStep = await lastStep(loser);
    ok("J4 the refused operator's code was rolled back with its transaction (not consumed)", loserStep < totp.totpStepAt(new Date(nowMs)));
  }

  // =====================================================================================================================
  section("K. A stale page cannot overwrite a newer decision (11)");
  {
    const target = await newUser(A, "staff", { label: "ktarget" });
    const stale = await versionOf(operator, target);
    const d = await setStatus(second, target, "disabled");
    const e = await setStatus(second, target, "active");
    const r = await setStatus(operator, target, "disabled", { version: stale });
    ok("K1 after another operator disabled and re-enabled the account, a disable from a page loaded before → VERSION_CONFLICT; the account stays active", d.ok && e.ok && codeOf(r) === "VERSION_CONFLICT" && (await userRow(target))!.is_active && (await userAudits(target)).some((x) => x.after_safe?.stage === "stale"));
    const actor = await customerSession.resolveSessionToken((await sessionFor(A, aPrimary)).token);
    const before = await versionOf(operator, target);
    const roleChange = actor.status === "active" ? await inCustomerRequest(() => changes.changeTeamMemberRole(actor.session, target, "admin", "en")) : { error: "no session" };
    const r2 = await setStatus(operator, target, "disabled", { version: before });
    ok("K2 a customer Team change (a role change) moves the version too: the console's older decision is refused", same(roleChange, {}) && codeOf(r2) === "VERSION_CONFLICT" && (await userRow(target))!.is_active);
  }

  // =====================================================================================================================
  section("L. An audit or evidence failure rolls the whole change back (12)");
  {
    const target = await newUser(A, "staff", { label: "ltarget" });
    await sessionFor(A, target);
    const live0 = await liveSessions(target);
    nextStep();
    const code = codeFor(operator);
    const v = await versionOf(operator, target);
    const step0 = await lastStep(operator);
    await auditOutage(true);
    let outage: Outcome;
    try {
      outage = await controls.setCustomerUserStatusCore(req(operator), { userId: String(target), target: "disabled", reason: REASON, totpCode: code, version: v });
    } finally {
      await auditOutage(false);
    }
    ok("L1 audit trail down → AUDIT_UNAVAILABLE: still active, sessions live, no customer evidence, code not consumed", codeOf(outage) === "AUDIT_UNAVAILABLE" && (await userRow(target))!.is_active && (await liveSessions(target)) === live0 && (await evidence(target)).length === 0 && (await lastStep(operator)) === step0);
    ok("L2 …the outage was reported as an incident line without any secret", logged.some((l) => /audit_write_failed/.test(l) && /customer_user\.disabled/.test(l)));
    const retry = await controls.setCustomerUserStatusCore(req(operator), { userId: String(target), target: "disabled", reason: REASON, totpCode: code, version: v });
    ok("L3 the same code works once the trail is back (nothing was spent by the failed attempt)", retry.ok && !(await userRow(target))!.is_active);
    await q(`create or replace function po03b_test_only_fail_evidence() returns trigger language plpgsql as $$ begin if new.type like '%by_platform' then raise exception 'injected evidence failure (test only)'; end if; return new; end $$`);
    await q(`create trigger po03b_test_only_fail_evidence before insert on security_events for each row execute function po03b_test_only_fail_evidence()`);
    let evFail: Outcome;
    let revFail: Outcome;
    try {
      evFail = await setStatus(operator, target, "active");
      revFail = await revoke(operator, aStaff);
    } finally {
      await q(`drop trigger if exists po03b_test_only_fail_evidence on security_events`);
      await q(`drop function if exists po03b_test_only_fail_evidence()`);
    }
    ok("L4 a customer-evidence failure applies nothing either (enable and revocation both refused, CONFIG_ERROR; still disabled)", codeOf(evFail) === "CONFIG_ERROR" && codeOf(revFail) === "CONFIG_ERROR" && !(await userRow(target))!.is_active);
  }

  // =====================================================================================================================
  section("M. Legacy companies and the staged rollout stay compatible (13)");
  {
    const row = (await users.listCustomerUsers(readReq(operator), { org: String(L) })).rows.find((r) => r.userId === lOwner)!;
    ok("M1 a legacy company: not designated, no subscription (allowance none) — nothing is inferred", row.primaryOwner === "no" && row.seats?.allowance === "none" && row.seats?.seats === null);
    const lowner2 = await newUser(L, "owner", { label: "lowner2" });
    await q(`alter table tenant_primary_owners rename to po03b_test_only_mapping_aside`);
    let absentOff: Outcome;
    let absentOn: Outcome;
    let listed: string;
    try {
      absentOff = await setStatus(operator, lowner2, "disabled");
      listed = (await users.listCustomerUsers(readReq(operator), { org: String(A) })).rows[0]?.primaryOwner ?? "";
      process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED = "true";
      absentOn = await setStatus(operator, lowner2, "active");
    } finally {
      delete process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED;
      await q(`alter table po03b_test_only_mapping_aside rename to tenant_primary_owners`);
    }
    ok("M2 mapping table absent and no feature creating mappings: the change proceeds (legacy behaviour) and the directory says 'not installed'", absentOff.ok && listed === "not_installed");
    ok("M3 mapping table absent while acceptance is on (a deployment-order error): the change fails closed (OWNER_PROTECTION_UNAVAILABLE), nothing applied, the refusal recorded", codeOf(absentOn) === "OWNER_PROTECTION_UNAVAILABLE" && !(await userRow(lowner2))!.is_active && (await userAudits(lowner2)).some((x) => x.after_safe?.stage === "protection_unavailable"));
    await setStatus(operator, lowner2, "active");
  }

  // =====================================================================================================================
  section("N. The customer Team actions still work, through the same shared service (14)");
  {
    const owner = await customerSession.resolveSessionToken((await sessionFor(A, aPrimary)).token);
    const s = owner.status === "active" ? owner.session : (null as unknown as Session);
    const member = await newUser(A, "staff", { label: "nmember" });
    const mSession = await sessionFor(A, member);
    const r1 = await inCustomerRequest(() => changes.changeTeamMemberRole(s, member, "admin", "en"));
    const r2 = await inCustomerRequest(() => changes.setTeamMemberActive(s, member, false, "en"));
    ok("N1 role change and deactivation by the owner succeed", same(r1, {}) && same(r2, {}) && (await userRow(member))!.role === "admin" && !(await userRow(member))!.is_active);
    ok("N2 …a Team deactivation leaves session rows as before (the customer behaviour is unchanged) and every request is refused for the inactive account", (await n(`select count(*)::int as n from sessions where user_id = $1 and revoked_at is null`, [member])) === 1 && (await stateOf(mSession.token)) !== "active");
    const r3 = await inCustomerRequest(() => changes.setTeamMemberActive(s, member, true, "en"));
    const prim = await inCustomerRequest(() => changes.setTeamMemberActive(s, aPrimary, false, "en"));
    const admin = await customerSession.resolveSessionToken((await sessionFor(A, aAdmin)).token);
    const primByAdmin = admin.status === "active" ? await inCustomerRequest(() => changes.setTeamMemberActive(admin.session, aPrimary, false, "en")) : { error: "" };
    const n2 = await customerSession.resolveSessionToken((await sessionFor(N2, n2Admin)).token);
    const lastOwner = n2.status === "active" ? await inCustomerRequest(() => changes.setTeamMemberActive(n2.session, n2Owner, false, "en")) : { error: "" };
    ok("N3 activation works; your own account, the primary owner and the last active owner are still protected with the PO-03A messages", same(r3, {}) && prim.error === changes.TEAM_MESSAGES.ownAccount && primByAdmin.error === changes.TEAM_MESSAGES.primaryDeactivate && lastOwner.error === changes.TEAM_MESSAGES.lastOwner && (await userRow(n2Owner))!.is_active);
  }

  // =====================================================================================================================
  section("O. Seat accounting stays read-only (15)");
  {
    const seatsBefore = (await users.getCustomerUserDetail(readReq(operator), String(tStaff))).seats!;
    const d = await setStatus(operator, tStaff, "disabled");
    const seatsAfter = (await users.getCustomerUserDetail(readReq(operator), String(tStaff))).seats!;
    ok("O1 a disabled user still occupies a seat: occupied unchanged, active −1, disabled +1, never enforced", d.ok && seatsAfter.occupied === seatsBefore.occupied && seatsAfter.users.active === seatsBefore.users.active - 1 && seatsAfter.users.disabled === seatsBefore.users.disabled + 1 && seatsAfter.enforced === false);
    const row = (await users.listCustomerUsers(readReq(operator), { org: String(T) })).rows[0];
    ok("O2 the directory shows the Trial allowance and the over-limit fact (2 users, 1 seat) — display only", row.seats?.allowance === "assigned" && row.seats?.seats === 1 && row.seats?.occupied === 2 && row.seats?.overLimit === true);
    await setStatus(operator, tStaff, "active");
    ok("O3 no subscription, package, settings or primary-owner row was written by any of it", (await subscriptionChecksum()) === subscriptionsBefore);
  }

  // =====================================================================================================================
  section("Q. Directory search, filters, sorting, pagination and input validation");
  {
    const all = await users.listCustomerUsers(readReq(operator), { size: "50" });
    const byName = await users.listCustomerUsers(readReq(operator), { q: "aprimary" });
    const byEmail = await users.listCustomerUsers(readReq(operator), { q: "@users-fixture.test", size: "50" });
    const byCompany = await users.listCustomerUsers(readReq(operator), { q: "Legacy Fixture" });
    const byRef = await users.listCustomerUsers(readReq(operator), { q: users.userReference(aAdmin) });
    const byOrgRef = await users.listCustomerUsers(readReq(operator), { q: `ORG-${String(T).padStart(6, "0")}` });
    ok("Q1 search by name, e-mail, company name, USR- and ORG- reference", byName.rows.length === 1 && byName.rows[0].userId === aPrimary && byEmail.total === all.total && byCompany.rows.every((r) => r.company.orgId === L) && byCompany.total >= 2 &&
      byRef.rows.some((r) => r.userId === aAdmin) && byOrgRef.rows.every((r) => r.company.orgId === T) && byOrgRef.total === 2);
    const wild = await users.listCustomerUsers(readReq(operator), { q: "%" });
    ok("Q2 LIKE wildcards are literal (a '%' search matches no fixture name)", wild.total === 0);
    const owners = await users.listCustomerUsers(readReq(operator), { role: "owner", size: "50" });
    const disabled = await users.listCustomerUsers(readReq(operator), { status: "disabled", size: "50" });
    const mfaOn = await users.listCustomerUsers(readReq(operator), { mfa: "on", size: "50" });
    const orgA = await users.listCustomerUsers(readReq(operator), { org: String(A), size: "50" });
    ok("Q3 filters: role, status, MFA and company each narrow exactly", owners.rows.every((r) => r.role === "owner") && owners.total > 0 && disabled.rows.every((r) => !r.isActive) && mfaOn.rows.every((r) => r.mfaEnabled) && mfaOn.total >= 2 &&
      orgA.rows.every((r) => r.company.orgId === A) && orgA.company?.orgId === A);
    const sorted = (rows: { name: string }[]) => rows.map((r) => r.name.toLowerCase());
    const byNameSort = await users.listCustomerUsers(readReq(operator), { sort: "name", size: "50" });
    const byCompanySort = await users.listCustomerUsers(readReq(operator), { sort: "company", size: "50" });
    const bySignIn = await users.listCustomerUsers(readReq(operator), { sort: "last_sign_in", size: "50" });
    const newest = await users.listCustomerUsers(readReq(operator), { sort: "newest", size: "50" });
    const oldest = await users.listCustomerUsers(readReq(operator), { sort: "oldest", size: "50" });
    const signIns = bySignIn.rows.map((r) => r.lastSignInAt?.getTime() ?? -Infinity);
    ok("Q4 sorts: name, company, latest sign-in (never-signed-in last), newest and oldest", same(sorted(byNameSort.rows), [...sorted(byNameSort.rows)].sort()) &&
      same(byCompanySort.rows.map((r) => r.company.name.toLowerCase()), [...byCompanySort.rows.map((r) => r.company.name.toLowerCase())].sort()) &&
      signIns.every((v, i) => i === 0 || v <= signIns[i - 1]) && same(newest.rows.map((r) => r.userId), [...oldest.rows.map((r) => r.userId)].reverse()));
    const p1 = await users.listCustomerUsers(readReq(operator), { size: "10", sort: "oldest" });
    const p2 = await users.listCustomerUsers(readReq(operator), { size: "10", sort: "oldest", page: "2" });
    ok("Q5 numbered pages: disjoint, in order, with the right offset, total and page count", p1.total === p2.total && p1.pages === Math.ceil(p1.total / 10) && p2.offset === 10 && !p1.rows.some((r) => p2.rows.some((s) => s.userId === r.userId)) &&
      same([...p1.rows, ...p2.rows].map((r) => r.userId), oldest.rows.slice(0, p1.rows.length + p2.rows.length).map((r) => r.userId)));
    const bad = [
      { size: "0" }, { size: "51" }, { page: "0" }, { page: "10001" }, { role: "superuser" }, { status: "deleted" }, { mfa: "maybe" }, { sort: "password" }, { q: "x".repeat(101) }, { q: ["a", "b"] }, { q: "bad\u0007value" }, { org: "abc" },
    ];
    const codes = [];
    for (const input of bad) codes.push(await users.listCustomerUsers(readReq(operator), input).then(() => "OK", (e) => (e as { code?: string }).code));
    ok("Q6 every malformed query parameter is VALIDATION_FAILED (size, page, role, status, MFA, sort, search length / repetition / control characters, company id)", codes.every((c) => c === "VALIDATION_FAILED"), codes.join(","));
    const small = await capture(() => users.listCustomerUsers(readReq(operator), { size: "10" }));
    const large = await capture(() => users.listCustomerUsers(readReq(operator), { size: "50" }));
    ok("Q7 a page costs a fixed number of queries whatever its size (no N+1)", small.texts.length === large.texts.length && small.texts.length <= 20, `${small.texts.length}/${large.texts.length}`);
  }

  // =====================================================================================================================
  section("R. The user detail is an audited view");
  {
    const before = await n(`select count(*)::int as n from platform_audit_events where action = 'customer_user.viewed' and entity_id = $1`, [String(aStaff)]);
    const d = await users.getCustomerUserDetail(readReq(operator), String(aStaff));
    const rec = await one<{ org_id: number; actor_platform_admin_id: string; result: string }>(`select org_id, actor_platform_admin_id, result from platform_audit_events where action = 'customer_user.viewed' and entity_type = 'customer_user' and entity_id = $1 order by id desc limit 1`, [String(aStaff)]);
    ok("R1 viewing a user writes customer_user.viewed on customer_user/<id> with the company and operator", d.userId === aStaff && (await n(`select count(*)::int as n from platform_audit_events where action = 'customer_user.viewed' and entity_id = $1`, [String(aStaff)])) === before + 1 && rec?.org_id === A && rec?.actor_platform_admin_id === operator.id && rec?.result === "success");
    await auditOutage(true);
    let outage: string;
    try {
      outage = await users.getCustomerUserDetail(readReq(operator), String(aStaff)).then(() => "OK", (e) => (e as { code?: string }).code ?? "");
    } finally {
      await auditOutage(false);
    }
    ok("R2 if the record cannot be written, nothing is returned (AUDIT_UNAVAILABLE)", outage === "AUDIT_UNAVAILABLE");
    const missing = await Promise.all(["999999999", "0", "abc", "1.5", "-3"].map((id) => users.getCustomerUserDetail(readReq(operator), id).then(() => "OK", (e) => (e as { code?: string }).code)));
    ok("R3 unknown and malformed ids are NOT_FOUND (the same answer for both)", missing.every((c) => c === "NOT_FOUND"), missing.join(","));
    const detail = await users.getCustomerUserDetail(readReq(operator), String(aAdmin));
    ok("R4 the detail lists the Platform Owner events about the account (newest first) and their reasons, bounded", detail.activity.length > 0 && detail.activity.length <= users.USER_ACTIVITY_LIMIT && detail.activity.every((x, i) => i === 0 || x.at.getTime() <= detail.activity[i - 1].at.getTime()));
  }

  // =====================================================================================================================
  section("P. No customer business record was modified; no secret was printed or audited (17, 18)");
  {
    ok("P1 every business table is byte-identical to before (checksum over all rows)", (await businessChecksum()) === businessBefore);
    const audits = JSON.stringify(await q(`select reason, before_safe, after_safe, actor_label, user_agent, ip_address from platform_audit_events`));
    const leaked = secretsSeen.filter((s) => s.length >= 6 && audits.includes(s));
    ok("P2 no password, TOTP secret, recovery code, platform token, customer token or session id / hash appears in any audit record", leaked.length === 0, `${leaked.length} leaked`);
    const canaryInAudit = [CANARY.hash, CANARY.mfa, CANARY.rec, CANARY.agent].filter((c) => audits.includes(c));
    ok("P3 …nor any canary authentication value", canaryInAudit.length === 0);
    const printed = secretsSeen.concat([CANARY.hash, CANARY.mfa, CANARY.rec]).filter((s) => s.length >= 6 && logged.some((l) => l.includes(s)));
    ok("P4 nothing the suite captured from the console output contains a secret or canary", printed.length === 0, `${printed.length} printed`);
  }
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-users");
} catch (err) {
  ok("the suite completed without an exception", false, describeError(err));
  exitCode = summary("verify:platform-users");
} finally {
  await pool.end().catch(() => undefined);
  if (created && !process.env.PLATFORM_TEST_KEEP_DATABASES) await dropDisposableDatabase(testDbName).catch(() => undefined);
}
process.exit(exitCode);
