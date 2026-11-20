/**
 * Platform Owner PO-03C, sub-batch B — the customer Team actions end the affected member's sessions, on real PostgreSQL.
 * The Team-change service (src/lib/team/member-changes.ts) through the shared customer-user mutation service
 * (src/lib/team/customer-user-core.ts): a deactivation ends the member's live sessions in its own transaction, a
 * reactivation never revives one (and ends any left from before), a role change ends the member's sessions — and the
 * customer's evidence (activity record, security event) commits with the change or not at all.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://…/<admin db with _test_only_> npm run verify:platform-team-sessions
 *
 * One disposable database (dropped at the end): the reviewed schema and platform SQL. Fictional companies, users and
 * sessions only; TEST-ONLY secrets generated in memory and never printed. Every race runs in a known interleaving: a
 * barrier (a held transaction or row lock) is observed waiting in pg_stat_activity before it is released.
 *
 * Categories (docs/platform-owner/PO03C_DEVELOPMENT.md §E): T1 deactivation ends the member's sessions — and nobody
 * else's · T2 reactivation never revives a session; a new sign-in is required · T3 a role change ends the member's
 * sessions · T4 refusals change nothing · T5 an evidence failure rolls the whole change back · T6 concurrent sign-in
 * (PO-02C.1 session issuance, enforcement on) · T7 enforcement off · T8 the Team interface and messages are unchanged ·
 * T9 no business record changed, nothing secret printed.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import pg from "pg";
import { sql } from "drizzle-orm";
import { connectDisposable, createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { describeError, ok, section, summary } from "./platform/harness";
import { withRequest } from "./platform/request-scope";

const ROOT = process.cwd();
const testDbName = disposableName("po03c_team");
process.env.DATABASE_URL = databaseUrlFor(testDbName);
process.env.PLATFORM_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.FIELD_ENCRYPTION_KEYS = `1:${randomBytes(32).toString("base64")}`;
process.env.TENANT_ACCESS_ENFORCEMENT = "enabled";
delete process.env.CUSTOMER_LEGACY_TOKENS;
delete process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED;

let created = false;
await createPlatformTestDatabase("po03c_team", testDbName);
created = true;

const { db, pool } = await import("../src/db");
const changes = await import("../src/lib/team/member-changes");
const { lockOrgAccessForSessionIssue } = await import("../src/lib/security/tenant-access-gate");
const { createSession } = await import("../src/lib/security/session-store");
const tenantAuth = await import("../src/lib/auth");
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

const logged: string[] = [];
for (const level of ["log", "info", "warn", "error"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
    original(...(args as []));
  };
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
const secretsSeen: string[] = [];
const CUSTOMER_HEADERS = { host: "customer.erp.test", origin: "https://customer.erp.test", "sec-fetch-site": "same-origin", "user-agent": "TeamSessionsAgent/3.1", "x-forwarded-for": "198.51.100.31" };
const inCustomerRequest = <T,>(fn: () => Promise<T>) => withRequest(CUSTOMER_HEADERS, fn);

async function newOrg(name = `Team Fixture ${tag()}`): Promise<number> {
  return Number((await one<{ id: number }>(`insert into orgs (name, country, currency) values ($1, 'Saudi Arabia', 'SAR') returning id`, [name]))!.id);
}
async function newUser(orgId: number, role: Role, label: string = role, active = true): Promise<number> {
  const t1 = tag();
  const row = await one<{ id: number }>(
    `insert into users (org_id, email, password_hash, name, role, is_active) values ($1, $2, $3, $4, $5, $6) returning id`,
    [orgId, `${label}.${t1}@team-fixture.test`, "$2b$10$" + "T".repeat(53), `Fixture ${label} ${t1}`, role, active],
  );
  return Number(row!.id);
}
type Tenant = { jti: string; token: string; tokenHash: string };
async function sessionFor(orgId: number, userId: number, opts: { expiresInMs?: number; revokedReason?: string } = {}): Promise<Tenant> {
  const jti = randomBytes(24).toString("base64url");
  const tokenHash = sha256(jti);
  await q(
    `insert into sessions (org_id, user_id, token_hash, ip_address, user_agent, expires_at, revoked_at, revoked_reason) values ($1, $2, $3, '192.0.2.31', 'TeamFixtureAgent/1', $4, $5, $6)`,
    [orgId, userId, tokenHash, new Date(Date.now() + (opts.expiresInMs ?? 30 * 86_400_000)), opts.revokedReason ? new Date() : null, opts.revokedReason ?? null],
  );
  const token = await tenantAuth.signSessionToken({ userId, orgId, jti });
  secretsSeen.push(jti, token, tokenHash);
  return { jti, token, tokenHash };
}
async function actorSession(orgId: number, userId: number): Promise<Session> {
  const r = await customerSession.resolveSessionToken((await sessionFor(orgId, userId)).token);
  if (r.status !== "active") throw new Error(`fixture actor session is ${r.status}`);
  return r.session;
}
const live = (userId: number) => n(`select count(*)::int as n from sessions where user_id = $1 and revoked_at is null and expires_at > now()`, [userId]);
const reasonOf = async (tokenHash: string) => (await one<{ r: string | null }>(`select revoked_reason as r from sessions where token_hash = $1`, [tokenHash]))?.r ?? null;
const stateOf = async (token: string) => (await customerSession.resolveSessionToken(token)).status;
const userRow = (id: number) => one<{ role: string; is_active: boolean }>(`select role, is_active from users where id = $1`, [id]);
const endedEvents = (actorId: number) =>
  q<{ detail: string | null; metadata: Record<string, unknown> | null; severity: string }>(`select detail, metadata, severity from security_events where user_id = $1 and type = 'team.member_sessions_ended' order by id`, [actorId]);
const activityCount = (orgId: number, type: string) => n(`select count(*)::int as n from activity_logs where org_id = $1 and type = $2`, [orgId, type]);

// ---- barriers ------------------------------------------------------------------------------------------------------
type Blocker = { release: (commit?: boolean) => Promise<void> };
async function blocker(lockSql: string, values: unknown[] = []): Promise<Blocker> {
  const client: pg.Client = await connectDisposable(process.env.DATABASE_URL!);
  client.on("error", () => undefined);
  await client.query("begin");
  await client.query(lockSql, values);
  return {
    release: async (commit = false) => {
      await client.query(commit ? "commit" : "rollback").catch(() => undefined);
      await client.end().catch(() => undefined);
    },
  };
}
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

/** The customer sign-in's PO-02C.1 transaction from its real parts, HELD (a barrier) after its session insert. */
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

const NOT_BUSINESS = new Set(["users", "sessions", "security_events", "activity_logs"]);
async function businessChecksum(): Promise<string> {
  const tables = (await q<{ t: string }>(`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`)).map((r) => r.t).filter((t) => !NOT_BUSINESS.has(t) && !t.startsWith("platform_"));
  const parts: string[] = [];
  for (const t of tables) {
    const r = await one<{ c: number; h: string | null }>(`select count(*)::int as c, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from "${t}" x`);
    parts.push(`${t}:${r?.c}:${r?.h}`);
  }
  return sha256(parts.join("\n"));
}
async function evidenceFailure(on: boolean) {
  if (on) {
    await q(`create or replace function po03c_fail_sessions_ended() returns trigger language plpgsql as $$ begin if new.type = 'team.member_sessions_ended' then raise exception 'fixture: security log unavailable'; end if; return new; end $$`);
    await q(`create trigger po03c_fail_sessions_ended before insert on security_events for each row execute function po03c_fail_sessions_ended()`);
  } else {
    await q(`drop trigger if exists po03c_fail_sessions_ended on security_events`);
    await q(`drop function if exists po03c_fail_sessions_ended()`);
  }
}

async function main() {
  const A = await newOrg("Team Fixture Alpha");
  const aOwner = await newUser(A, "owner", "aowner");
  await q(`insert into tenant_primary_owners (org_id, user_id) values ($1, $2)`, [A, aOwner]);
  const aAdmin = await newUser(A, "admin", "aadmin");
  const aOther = await newUser(A, "staff", "aother");
  const B = await newOrg("Team Fixture Beta");
  const bOwner = await newUser(B, "owner", "bowner");
  const bStaff = await newUser(B, "staff", "bstaff");
  const L = await newOrg("Team Fixture Legacy");
  const lOwner = await newUser(L, "owner", "lowner");
  const lAdmin = await newUser(L, "admin", "ladmin");
  const owner = await actorSession(A, aOwner);
  const businessBefore = await businessChecksum();

  // ===================================================================================================================
  section("T1. A deactivation ends the member's sessions — and nobody else's");
  {
    const m = await newUser(A, "staff", "t1member");
    const s1 = await sessionFor(A, m);
    const s2 = await sessionFor(A, m);
    const expired = await sessionFor(A, m, { expiresInMs: -60_000 });
    const revoked = await sessionFor(A, m, { revokedReason: "logout" });
    const other = await sessionFor(A, aOther);
    const elsewhere = await sessionFor(B, bStaff);
    const eventsBefore = (await endedEvents(aOwner)).length;
    const activityBefore = await activityCount(A, "team.member-deactivated");
    const r = await inCustomerRequest(() => changes.setTeamMemberActive(owner, m, false, "en"));
    ok("T1a a Team deactivation succeeds and ends every live session of the member (reason disabled); their tokens no longer resolve", same(r, {}) && !(await userRow(m))!.is_active && (await live(m)) === 0 && (await reasonOf(s1.tokenHash)) === "disabled" && (await reasonOf(s2.tokenHash)) === "disabled" && (await stateOf(s1.token)) !== "active");
    ok("T1b …another member of the company and a member of another company keep their sessions", (await stateOf(other.token)) === "active" && (await stateOf(elsewhere.token)) === "active");
    ok("T1c …already-expired and already-revoked sessions are left exactly as they were", (await reasonOf(expired.tokenHash)) === null && (await reasonOf(revoked.tokenHash)) === "logout");
    const ev = (await endedEvents(aOwner)).slice(eventsBefore);
    ok("T1d …the customer's security log records team.member_sessions_ended (deactivated, the member and the count) and the activity record is written — the same transaction", ev.length === 1 && ev[0].detail === "deactivated" && ev[0].metadata?.targetUserId === m && ev[0].metadata?.sessionsEnded === 2 && ev[0].severity === "medium" && (await activityCount(A, "team.member-deactivated")) === activityBefore + 1);
  }

  // ===================================================================================================================
  section("T2. A reactivation never revives a session; the member signs in again");
  {
    const m = await newUser(A, "staff", "t2member");
    const old = await sessionFor(A, m);
    await inCustomerRequest(() => changes.setTeamMemberActive(owner, m, false, "en"));
    // A session inserted while the member is inactive (the legacy enforcement-off sign-in takes no lock; T7).
    process.env.TENANT_ACCESS_ENFORCEMENT = "disabled";
    const strayJti = await inCustomerRequest(() => createSession(m, A));
    process.env.TENANT_ACCESS_ENFORCEMENT = "enabled";
    secretsSeen.push(strayJti);
    const eventsBefore = (await endedEvents(aOwner)).length;
    const r = await inCustomerRequest(() => changes.setTeamMemberActive(owner, m, true, "en"));
    ok("T2a reactivation succeeds; the old session stays ended and its token still does not resolve", same(r, {}) && (await userRow(m))!.is_active && (await reasonOf(old.tokenHash)) === "disabled" && (await stateOf(old.token)) !== "active");
    ok("T2b …a session left from before (inserted while the member was inactive) is ended by the reactivation (reason reenabled) — nothing is revived", (await reasonOf(sha256(strayJti))) === "reenabled" && (await live(m)) === 0);
    const ev = (await endedEvents(aOwner)).slice(eventsBefore);
    ok("T2c …recorded as team.member_sessions_ended (reactivated, info)", ev.length === 1 && ev[0].detail === "reactivated" && ev[0].severity === "info");
    const fresh = await sessionFor(A, m);
    ok("T2d …a NEW sign-in after the reactivation works", (await stateOf(fresh.token)) === "active");
    const m2 = await newUser(A, "staff", "t2clean");
    const eventsBefore2 = (await endedEvents(aOwner)).length;
    await inCustomerRequest(() => changes.setTeamMemberActive(owner, m2, false, "en"));
    await inCustomerRequest(() => changes.setTeamMemberActive(owner, m2, true, "en"));
    ok("T2e …with no session to end, nothing is recorded beyond the activity (no empty security event)", (await endedEvents(aOwner)).length === eventsBefore2);
  }

  // ===================================================================================================================
  section("T3. A role change ends the member's sessions");
  {
    const m = await newUser(A, "staff", "t3member");
    const s1 = await sessionFor(A, m);
    const own = await sessionFor(A, aOwner);
    const other = await sessionFor(A, aOther);
    const eventsBefore = (await endedEvents(aOwner)).length;
    const r = await inCustomerRequest(() => changes.changeTeamMemberRole(owner, m, "admin", "en"));
    const ev = (await endedEvents(aOwner)).slice(eventsBefore);
    ok("T3a staff → admin succeeds and ends the member's sessions (reason role_change); the token no longer resolves", same(r, {}) && (await userRow(m))!.role === "admin" && (await reasonOf(s1.tokenHash)) === "role_change" && (await stateOf(s1.token)) !== "active");
    ok("T3b …recorded (team.member_sessions_ended, role_changed) with the activity record team.role-changed", ev.length === 1 && ev[0].detail === "role_changed" && (await activityCount(A, "team.role-changed")) >= 1);
    ok("T3c …the acting owner's own session and another member's session are untouched", (await stateOf(own.token)) === "active" && (await stateOf(other.token)) === "active");
    const s2 = await sessionFor(A, m);
    const before2 = (await endedEvents(aOwner)).length;
    const same2 = await inCustomerRequest(() => changes.changeTeamMemberRole(owner, m, "admin", "en"));
    ok("T3d a request that leaves the role unchanged ends nothing", same(same2, {}) && (await stateOf(s2.token)) === "active" && (await endedEvents(aOwner)).length === before2);
  }

  // ===================================================================================================================
  section("T4. Refusals change nothing (sessions included)");
  {
    const ownerSession = await sessionFor(A, aOwner);
    const admin = await actorSession(A, aAdmin);
    const r1 = await inCustomerRequest(() => changes.setTeamMemberActive(admin, aOwner, false, "en"));
    ok("T4a deactivating the primary owner is refused with the PO-03A message; their sessions stay live", r1.error === changes.TEAM_MESSAGES.primaryDeactivate && (await stateOf(ownerSession.token)) === "active" && (await userRow(aOwner))!.is_active);
    const lAdminSession = await actorSession(L, lAdmin);
    const lOwnerTenant = await sessionFor(L, lOwner);
    const r2 = await inCustomerRequest(() => changes.setTeamMemberActive(lAdminSession, lOwner, false, "en"));
    ok("T4b deactivating a legacy company's last active owner is refused; their sessions stay live", r2.error === changes.TEAM_MESSAGES.lastOwner && (await stateOf(lOwnerTenant.token)) === "active");
    const r3 = await inCustomerRequest(() => changes.changeTeamMemberRole(lAdminSession, lOwner, "staff", "en"));
    ok("T4c an admin changing an owner's role is refused (existing role rules); sessions untouched", r3.error === changes.TEAM_MESSAGES.memberRole && (await stateOf(lOwnerTenant.token)) === "active" && (await userRow(lOwner))!.role === "owner");
  }

  // ===================================================================================================================
  section("T5. An evidence failure rolls the whole change back");
  {
    const m = await newUser(A, "staff", "t5member");
    const s = await sessionFor(A, m);
    const actBefore = await activityCount(A, "team.member-deactivated");
    await evidenceFailure(true);
    let r: { error?: string };
    let r2: { error?: string };
    try {
      r = await inCustomerRequest(() => changes.setTeamMemberActive(owner, m, false, "en"));
      r2 = await inCustomerRequest(() => changes.changeTeamMemberRole(owner, m, "admin", "en"));
    } finally {
      await evidenceFailure(false);
    }
    ok("T5a the security log refuses the event → the deactivation is not applied: still active, the session live, no activity record (the 'nothing was changed' message)", r.error === changes.TEAM_MESSAGES.failed && (await userRow(m))!.is_active && (await stateOf(s.token)) === "active" && (await activityCount(A, "team.member-deactivated")) === actBefore);
    ok("T5b …nor the role change: still staff, the session live", r2.error === changes.TEAM_MESSAGES.failed && (await userRow(m))!.role === "staff" && (await reasonOf(s.tokenHash)) === null);
  }

  // ===================================================================================================================
  section("T6. Concurrent sign-in (PO-02C.1 session issuance, enforcement on)");
  {
    // T6a/b — a sign-in in flight (company FOR SHARE held, session inserted, not committed) meets a deactivation.
    const m = await newUser(A, "staff", "t6member");
    const held = heldSignIn(A, m);
    await held.inserted;
    const p = inCustomerRequest(() => changes.setTeamMemberActive(owner, m, false, "en"));
    ok("T6a the deactivation waits for the in-flight sign-in at the company row", await until(async () => (await lockWaiters(ORG_ROW_LOCK)) >= 1));
    held.release();
    const signed = await held.done;
    const r = await p;
    ok("T6b …once the sign-in commits, the deactivation ends the session it created (reason disabled); nothing live remains", signed.ok && same(r, {}) && (await reasonOf(signed.ok ? sha256(signed.jti) : "")) === "disabled" && (await live(m)) === 0);
    // T6c — the deactivation holds the company row (paused at the user row by a barrier); a sign-in waits, then is refused.
    await inCustomerRequest(() => changes.setTeamMemberActive(owner, m, true, "en"));
    const userLock = await blocker(`select id from users where id = $1 for no key update`, [m]);
    const p2 = inCustomerRequest(() => changes.setTeamMemberActive(owner, m, false, "en"));
    await until(async () => (await lockWaiters(USER_ROW_LOCK)) >= 1);
    const s2 = heldSignIn(A, m);
    const waited = await until(async () => (await lockWaiters(ORG_ROW_LOCK)) >= 1);
    await userLock.release();
    const r2 = await p2;
    await s2.inserted;
    s2.release();
    const signed2 = await s2.done;
    ok("T6c a sign-in that starts while the deactivation holds the company row waits, and its re-check refuses it (account) — no session is created", waited && same(r2, {}) && !signed2.ok && (await live(m)) === 0);
    // T6d — a role change meets an in-flight sign-in: it waits, then ends the new session (reason role_change).
    const m2 = await newUser(A, "staff", "t6role");
    const held3 = heldSignIn(A, m2);
    await held3.inserted;
    const p3 = inCustomerRequest(() => changes.changeTeamMemberRole(owner, m2, "admin", "en"));
    const waited3 = await until(async () => (await lockWaiters(ORG_ROW_LOCK)) >= 1);
    held3.release();
    const signed3 = await held3.done;
    const r3 = await p3;
    ok("T6d a role change that meets an in-flight sign-in waits for it, then ends the session it created (reason role_change)", waited3 && signed3.ok && same(r3, {}) && (await reasonOf(signed3.ok ? sha256(signed3.jti) : "")) === "role_change" && (await live(m2)) === 0);
  }

  // ===================================================================================================================
  section("T7. Enforcement off (the legacy sign-in takes no company lock)");
  {
    const m = await newUser(A, "staff", "t7member");
    await inCustomerRequest(() => changes.setTeamMemberActive(owner, m, false, "en"));
    process.env.TENANT_ACCESS_ENFORCEMENT = "disabled";
    const jti = await inCustomerRequest(() => createSession(m, A));
    const token = await tenantAuth.signSessionToken({ userId: m, orgId: A, jti });
    secretsSeen.push(jti, token);
    const state = await stateOf(token);
    await inCustomerRequest(() => changes.setTeamMemberActive(owner, m, true, "en"));
    process.env.TENANT_ACCESS_ENFORCEMENT = "enabled";
    ok("T7a a session the legacy sign-in inserts after a deactivation is unusable (the account is checked on every request), and the reactivation ends it (reenabled)", state !== "active" && (await reasonOf(sha256(jti))) === "reenabled" && (await stateOf(token)) !== "active");
  }

  // ===================================================================================================================
  section("T8. The Team interface and its messages are unchanged");
  {
    ok("T8a the Team messages are the PO-03A set, unchanged (13 keys, the same English text)", Object.keys(changes.TEAM_MESSAGES).length === 13 && changes.TEAM_MESSAGES.lastOwner === "The organization must keep at least one active owner." && changes.TEAM_MESSAGES.failed === "The change couldn't be saved. Nothing was changed.");
    const dict = readFileSync(join(ROOT, "src/lib/i18n/dict.ts"), "utf8");
    ok("T8b …each still has its Saudi Arabic translation", Object.values(changes.TEAM_MESSAGES).every((m) => dict.includes(JSON.stringify(m)) || dict.includes(`"${m.replace(/"/g, '\\"')}"`)));
    const actions = readFileSync(join(ROOT, "src/app/(app)/settings/team/actions.ts"), "utf8");
    ok("T8c the Team server actions still call the same two service functions (no new action, no changed permission check)", /changeTeamMemberRole\(/.test(actions) && /setTeamMemberActive\(/.test(actions) && /requireRole\(/.test(actions));
  }

  // ===================================================================================================================
  section("T9. No business record changed; nothing secret printed");
  {
    ok("T9a every business table is byte-identical to before (checksum over all rows)", (await businessChecksum()) === businessBefore);
    const printed = secretsSeen.filter((s) => s.length >= 6 && logged.some((l) => l.includes(s)));
    ok("T9b nothing the suite captured from the console output contains a session id, token or hash", printed.length === 0, `${printed.length} printed`);
    void bOwner;
  }
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-team-sessions");
} catch (err) {
  ok("the suite completed without an exception", false, describeError(err));
  exitCode = summary("verify:platform-team-sessions");
} finally {
  await pool.end().catch(() => undefined);
  if (created && !process.env.PLATFORM_TEST_KEEP_DATABASES) await dropDisposableDatabase(testDbName).catch(() => undefined);
}
process.exit(exitCode);
