/**
 * Platform Owner PO-03D (sub-batch A) — customer-user invitation ACCEPTANCE on real PostgreSQL: the platform core
 * (src/lib/platform/user-invitation-acceptance.ts), the customer bridge (src/lib/onboarding/user-invitation-acceptance.ts)
 * and the route's two server actions (src/app/(invite)/join/accept/actions.ts), driven exactly as /join/accept drives them.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://…/<admin db with _test_only_> npm run verify:platform-user-acceptance
 *
 * Disposable databases only (all dropped at the end): the reviewed schema and platform SQL chain plus the PO-02D1B Trial
 * seed, then the staged PO-03C user_invitations SQL applied by THIS suite (it is not in the chain). Fictional companies,
 * users and invitations; TEST-ONLY secrets generated in memory and never printed. Every race runs in a known interleaving:
 * a barrier (a held lock) is observed waiting in pg_stat_activity before it is released.
 *
 * Categories (docs/platform-owner/PO03D_DEVELOPMENT.md §C–§F, §K): F the switch and the staged table · O same origin,
 * canonical origin · T the link's lifecycle and what a check reveals · S success and its evidence (one transaction) ·
 * V the invitee's fields · R refusals (suspended company, an existing account, seats) · K races and lock-order proofs
 * (deterministic barriers) · Y rollback (failures injected at every write) · H the durable, purpose-separated throttle,
 * also across processes · P nothing secret stored, printed, audited or sent; no other tenant touched; the copy complete.
 */
import { createHash, randomBytes } from "node:crypto";
import net from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import bcrypt from "bcryptjs";
import pg from "pg";
import { connectDisposable, createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { describeError, ok, section, summary } from "./platform/harness";
import { withRequest } from "./platform/request-scope";

const ROOT = process.cwd();
const testDbName = disposableName("po03d_uaccept");
process.env.DATABASE_URL = databaseUrlFor(testDbName);
process.env.PLATFORM_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.FIELD_ENCRYPTION_KEYS = `1:${randomBytes(32).toString("base64")}`;
// Acceptance is independent of every console flag and of company-invitation acceptance: they stay OFF.
delete process.env.PLATFORM_CONSOLE_ENABLED;
delete process.env.PLATFORM_INVITATIONS_ENABLED;
delete process.env.PLATFORM_USER_INVITATIONS_ENABLED;
delete process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED;
delete process.env.CUSTOMER_SEAT_ENFORCEMENT_ENABLED;
process.env.CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED = "true";
process.env.PLATFORM_TRUSTED_PROXY_HOPS = "1";
const ORIGIN = "https://customer.erp.test";
const HOST = "customer.erp.test";
process.env.CUSTOMER_PUBLIC_ORIGIN = ORIGIN;
delete process.env.PLATFORM_INVITATIONS_LOOPBACK_ORIGIN;

let created = false;
await createPlatformTestDatabase("po03d_uaccept", testDbName);
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

const { pool } = await import("../src/db");
const { platformClock } = await import("../src/lib/platform/clock");
const core = await import("../src/lib/platform/user-invitation-acceptance");
const bridge = await import("../src/lib/onboarding/user-invitation-acceptance");
const routeActions = await import("../src/app/(invite)/join/accept/actions");
const companyThrottle = await import("../src/lib/platform/acceptance-throttle");
const loginThrottle = await import("../src/lib/platform/throttle");
const { JOIN_COPY_KEYS } = await import("../src/app/(invite)/join/accept/copy");
const { DEFAULT_POLICY } = await import("../src/lib/security/password-policy");
(pool as unknown as { options: { max: number } }).options.max = 40;
pool.on("error", () => undefined);
pool.on("connect", (client) => client.on("error", () => undefined));

// ---- deterministic platform clock ----------------------------------------------------------------------------------
let nowMs = Date.now();
platformClock.now = () => new Date(nowMs);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// ---- every console line is captured (none may hold a token or a password) -----------------------------------------
const logged: string[] = [];
for (const level of ["log", "info", "warn", "error", "debug"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    logged.push(args.map((a) => (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(" "));
    original(...(args as []));
  };
}
// ---- outbound connections and fetch() are recorded: only the loopback test database may be reached (no delivery) ---
const outbound: string[] = [];
const dbPort = Number(new URL(process.env.DATABASE_URL!).port || 5432);
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  const first = args[0] as { port?: number | string; host?: string; path?: string } | number | string;
  const port = typeof first === "object" && first !== null ? Number(first.port) : Number(first);
  const hostArg = typeof first === "object" && first !== null ? (first.host ?? first.path ?? "") : typeof args[1] === "string" ? args[1] : "";
  if (!(port === dbPort && ["127.0.0.1", "localhost", "::1", ""].includes(String(hostArg)))) outbound.push(`${hostArg}:${Number.isFinite(port) ? port : "?"}`);
  return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
} as typeof net.Socket.prototype.connect;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
  outbound.push(`fetch ${String(args[0]).slice(0, 80)}`);
  return originalFetch(...args);
}) as typeof fetch;

// ---- helpers ----------------------------------------------------------------------------------------------------------
const q = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
const one = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await q<T>(text, values))[0];
const n = async (text: string, values: unknown[] = []) => Number((await one<{ n: number }>(text, values))?.n ?? 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const tokensSeen: string[] = [];
const PASSWORD = "Harbor-Quill-74!z";
const secretsSeen: string[] = [PASSWORD];

let ipSeq = 0;
const freshIp = () => {
  ipSeq += 1;
  return `10.30.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
};
const request = (ip = freshIp(), over: Record<string, string | null> = {}) => {
  const h: Record<string, string> = { host: HOST, origin: ORIGIN, "sec-fetch-site": "same-origin", "user-agent": "verify-user-acceptance", "x-forwarded-for": ip };
  for (const [k, v] of Object.entries(over)) if (v === null) delete h[k];
  else h[k] = v;
  return h;
};
const check = (token: unknown, ip?: string, over?: Record<string, string | null>) => withRequest(request(ip, over), () => bridge.checkJoinLink(token));
const accept = (input: { token: unknown; name?: unknown; password?: unknown; confirm?: unknown }, ip?: string, over?: Record<string, string | null>) =>
  withRequest(request(ip, over), () => bridge.acceptJoinLink({ name: "Fixture Invitee", password: PASSWORD, confirm: input.password ?? PASSWORD, ...input }));
const reasonOf = (r: { ok: boolean; reason?: string }) => (r.ok ? "OK" : (r.reason ?? "?"));

let seq = 0;
const tag = () => `${Date.now().toString(36)}${++seq}`;
const bcryptPad = (stem: string) => "$2b$10$" + (stem + "Q".repeat(53)).slice(0, 53);
const HASH = bcryptPad("UserAcceptanceFixtureHash");
const trialV1 = (await one<{ id: string }>(`select v.id from subscription_package_versions v join subscription_packages p on p.id = v.package_id where p.is_default_trial and v.version_number = 1`))!.id;
const keeper = (await one<{ id: string }>(`insert into platform_admins (email_normalized, display_name, password_hash, is_active) values ('keeper@uaccept-fixture.test', 'Fixture Keeper', $1, false) returning id`, [HASH]))!.id;

async function newOrg(name = `Join Fixture ${tag()}`): Promise<number> {
  return Number((await one<{ id: number }>(`insert into orgs (name, country, currency) values ($1, 'Saudi Arabia', 'SAR') returning id`, [name]))!.id);
}
async function newUser(orgId: number, role: string, email: string, active = true): Promise<number> {
  return Number((await one<{ id: number }>(`insert into users (org_id, email, password_hash, name, role, is_active) values ($1, $2, $3, $4, $5, $6) returning id`, [orgId, email, HASH, `Fixture ${role} ${tag()}`, role, active]))!.id);
}
async function subscribe(orgId: number, seats: number) {
  await q(
    `insert into tenant_subscriptions (org_id, package_version_id, version_state, is_trial, cycle, lifecycle_state, start_date, end_date, price_snapshot_sar, seats_snapshot, storage_snapshot_gb, module_groups_snapshot, assignment_source)
     values ($1, $2, 'published', true, 'trial', 'trialing', current_date, current_date + 13, 0, $3, 5, '[]'::jsonb, 'invitation_acceptance')`,
    [orgId, trialV1, seats],
  );
}
async function suspend(orgId: number) {
  await q(`insert into tenant_access_controls (org_id, access_status, reason, changed_by_platform_admin_id, changed_at) values ($1, 'suspended', 'Fixture: suspended for the test', $2, now())`, [orgId, keeper]);
}
/** An invitation written directly (a fixture): returns its id and its one-time token (kept only by the suite). */
async function invite(orgId: number, email: string, opts: { role?: "admin" | "staff"; name?: string; createdAgoMs?: number; ttlMs?: number } = {}) {
  const token = randomBytes(32).toString("base64url");
  tokensSeen.push(token);
  const createdAt = new Date(nowMs - (opts.createdAgoMs ?? MINUTE));
  const expiresAt = new Date(createdAt.getTime() + (opts.ttlMs ?? 72 * HOUR));
  const id = (await one<{ id: string }>(
    `insert into user_invitations (org_id, name, email_normalized, requested_role, token_hash, expires_at, invited_by_platform_admin_id, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [orgId, opts.name ?? "Fixture Invitee", email, opts.role ?? "staff", sha256(token), expiresAt, keeper, createdAt],
  ))!.id;
  return { id, token, email };
}
const invState = (id: string) => one<{ accepted_at: Date | null; accepted_user_id: number | null; revoked_at: Date | null }>(`select accepted_at, accepted_user_id, revoked_at from user_invitations where id = $1`, [id]);
const usersWith = (email: string) => n(`select count(*)::int as n from users where lower(email) = lower($1)`, [email]);
const auditsOf = (entityId: string) => q<{ action: string; result: string; after_safe: Record<string, unknown> | null; before_safe: Record<string, unknown> | null; actor_label: string | null; org_id: number | null }>(`select action, result, after_safe, before_safe, actor_label, org_id from platform_audit_events where entity_type = 'user_invitation' and entity_id = $1 order by id`, [entityId]);
const stagesOf = async (entityId: string) => (await auditsOf(entityId)).filter((a) => a.action === "user_invitation.accept.rejected").map((a) => String(a.after_safe?.stage));

// ---- barriers ------------------------------------------------------------------------------------------------------
type Blocker = { client: pg.Client; release: (commit?: boolean) => Promise<void> };
async function blocker(statements: { text: string; values?: unknown[] }[]): Promise<Blocker> {
  const client: pg.Client = await connectDisposable(process.env.DATABASE_URL!);
  client.on("error", () => undefined);
  await client.query("begin");
  for (const s of statements) await client.query(s.text, s.values ?? []);
  return {
    client,
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
const EMAIL_LOCK = /pg_advisory_xact_lock/i;
const ORG_LOCK = /from "orgs"[\s\S]*for no key update/i;
const INV_LOCK = /from "user_invitations"[\s\S]*for update/i;
const USERS_INSERT = /insert into "users"/i;
const emailLockSql = { text: `select pg_advisory_xact_lock(hashtextextended('platform-invitation-email:' || $1, 0))` };

async function failingTrigger(table: string, on: boolean, when = "true", timing = "before insert") {
  const fn = `po03d_test_only_fail_${table}`;
  if (on) {
    await q(`create or replace function ${fn}() returns trigger language plpgsql as $$ begin if ${when} then raise exception 'injected outage (test only)'; end if; return new; end $$`);
    await q(`create trigger ${fn} ${timing} on ${table} for each row execute function ${fn}()`);
  } else {
    await q(`drop trigger if exists ${fn} on ${table}`);
    await q(`drop function if exists ${fn}()`);
  }
}
async function tenantChecksum(orgIds: number[]): Promise<string> {
  const rows = await q<{ t: string }>(
    `select md5(string_agg(x, '|' order by x)) as t from (
       select 'u:' || id || ':' || org_id || ':' || email || ':' || role || ':' || is_active || ':' || coalesce(updated_at::text, '') as x from users where org_id = any($1)
       union all select 's:' || id || ':' || user_id || ':' || coalesce(revoked_at::text, '') from sessions where user_id in (select id from users where org_id = any($1))
       union all select 'i:' || id || ':' || coalesce(accepted_at::text, '') || ':' || coalesce(revoked_at::text, '') from user_invitations where org_id = any($1)
     ) z`,
    [orgIds],
  );
  return rows[0]?.t ?? "";
}

async function main() {
  // Company A: Trial, 3 seats, an owner. B (another tenant, never touched): an owner and a staff member, each with a
  // live session. E: where existing accounts of the e-mail cases live. S: suspended. L: no subscription. F: Trial,
  // 2 seats, full.
  const A = await newOrg("Join Fixture Alpha");
  await newUser(A, "owner", `owner.alpha.${tag()}@join-fixture.test`);
  await subscribe(A, 3);
  const B = await newOrg("Join Fixture Beta");
  for (const role of ["owner", "staff"]) {
    const id = await newUser(B, role, `${role}.beta.${tag()}@join-fixture.test`);
    await q(`insert into sessions (org_id, user_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '1 day')`, [B, id, sha256(`fixture-session-${tag()}`)]);
  }
  await subscribe(B, 5);
  const E = await newOrg("Join Fixture Elsewhere");
  await newUser(E, "owner", `owner.elsewhere.${tag()}@join-fixture.test`);
  const S = await newOrg("Join Fixture Suspended");
  await newUser(S, "owner", `owner.suspended.${tag()}@join-fixture.test`);
  await subscribe(S, 3);
  await suspend(S);
  const L = await newOrg("Join Fixture Legacy");
  await newUser(L, "owner", `owner.legacy.${tag()}@join-fixture.test`);
  const F = await newOrg("Join Fixture Full");
  await newUser(F, "owner", `owner.full.${tag()}@join-fixture.test`);
  await newUser(F, "staff", `staff.full.${tag()}@join-fixture.test`);
  await subscribe(F, 2);
  const otherTenantBefore = await tenantChecksum([B]);

  // ===================================================================================================================
  section("F. The switch (CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED) and the staged table");
  {
    const inv = await invite(A, `switch.${tag()}@join-fixture.test`);
    const auditsBefore = await n(`select count(*)::int as n from platform_audit_events`);
    const attemptsBefore = await n(`select count(*)::int as n from platform_login_attempts`);
    const offs: string[] = [];
    for (const value of [undefined, "", "TRUE", "1", " true", "yes"]) {
      if (value === undefined) delete process.env.CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED;
      else process.env.CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED = value;
      offs.push(reasonOf(await check(inv.token)), reasonOf(await accept({ token: inv.token })));
    }
    process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED = "true";
    process.env.CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED = "false";
    const companyFlagOnly = reasonOf(await accept({ token: inv.token }));
    delete process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED;
    process.env.CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED = "true";
    ok("F1 only the exact string \"true\" switches acceptance on: unset, empty, 'TRUE', '1', ' true' and 'yes' answer `disabled` to both actions — and the company-invitation flag does not switch it on",
      offs.every((r) => r === "disabled") && companyFlagOnly === "disabled", offs.join(","));
    ok("F2 while it is off nothing is read, written, audited or counted: no user, the invitation still pending, no audit record, no throttle row",
      (await usersWith(inv.email)) === 0 && (await invState(inv.id))!.accepted_at === null && (await n(`select count(*)::int as n from platform_audit_events`)) === auditsBefore && (await n(`select count(*)::int as n from platform_login_attempts`)) === attemptsBefore);
    ok("F3 independent of the console: with every Platform Owner flag off, the switch alone makes the link usable", reasonOf(await check(inv.token)) === "OK");
    await q(`alter table user_invitations rename to user_invitations_po03d_away`);
    const missing = [reasonOf(await check(inv.token)), reasonOf(await accept({ token: inv.token }))];
    await q(`alter table user_invitations_po03d_away rename to user_invitations`);
    ok("F4 the staged table missing (it is not in the platform SQL chain) fails closed: `unavailable` for both actions, nothing created", missing.every((r) => r === "unavailable") && (await usersWith(inv.email)) === 0);
  }

  // ===================================================================================================================
  section("O. Same-origin POSTs from the canonical customer origin only");
  {
    const inv = await invite(A, `origin.${tag()}@join-fixture.test`);
    const crossSite = reasonOf(await accept({ token: inv.token }, undefined, { "sec-fetch-site": "cross-site" }));
    const noOrigin = reasonOf(await accept({ token: inv.token }, undefined, { origin: null }));
    const foreign = reasonOf(await accept({ token: inv.token }, undefined, { origin: "https://evil.example.test" }));
    const nonCanonical = reasonOf(await accept({ token: inv.token }, undefined, { host: "other.erp.test", origin: "https://other.erp.test" }));
    ok("O1 a cross-site request, a missing Origin, a foreign Origin and a same-origin but non-canonical host are all refused (`unavailable`) before the token is read; nothing is created",
      [crossSite, noOrigin, foreign, nonCanonical].every((r) => r === "unavailable") && (await usersWith(inv.email)) === 0 && (await stagesOf(inv.id)).length === 0);
  }

  // ===================================================================================================================
  section("T. The link: format, lifecycle, and what a check reveals");
  {
    const auditsBefore = await n(`select count(*)::int as n from platform_audit_events`);
    const malformed = await Promise.all(["", "short", "x".repeat(44), 42, null, "a".repeat(42) + "!"].map((t) => check(t)));
    const unknown = await check(randomBytes(32).toString("base64url"));
    ok("T1 malformed and unknown links answer `invalid` (one answer for both) and leave no audit record (there is no invitation to attach one to)",
      malformed.every((r) => reasonOf(r) === "invalid") && reasonOf(unknown) === "invalid" && (await n(`select count(*)::int as n from platform_audit_events`)) === auditsBefore);
    const revoked = await invite(A, `revoked.${tag()}@join-fixture.test`);
    await q(`update user_invitations set revoked_at = greatest(now(), created_at), revoked_by_platform_admin_id = $2 where id = $1`, [revoked.id, keeper]);
    const expired = await invite(A, `expired.${tag()}@join-fixture.test`, { createdAgoMs: 80 * HOUR });
    ok("T2 a revoked link is `invalid` (like an unknown one), an expired link is `expired`; each refusal of a real invitation is audited with its stage",
      reasonOf(await check(revoked.token)) === "invalid" && reasonOf(await check(expired.token)) === "expired" && JSON.stringify(await stagesOf(revoked.id)) === '["revoked"]' && JSON.stringify(await stagesOf(expired.id)) === '["expired"]');
    const fresh = await invite(A, `preview.${tag()}@join-fixture.test`, { role: "admin", name: "Fixture Preview Person" });
    const r = await check(fresh.token);
    const keys = r.ok ? Object.keys(r.invitation).sort().join(",") : "";
    ok("T3 a check shows exactly the allow-listed fields — reference, company, name, e-mail, role, expiry (both languages), plan and seats — never an id, the token or its digest",
      r.ok && keys === "companyName,email,expiresAt,expiresAtText,name,plan,reference,role,seats" && r.invitation.companyName === "Join Fixture Alpha" && r.invitation.role === "admin" && r.invitation.email === fresh.email &&
        r.invitation.name === "Fixture Preview Person" && /^UIN-[0-9A-F]{8}$/.test(r.invitation.reference) && !JSON.stringify(r).includes(fresh.token) && !JSON.stringify(r).includes(sha256(fresh.token)) &&
        r.invitation.plan?.packageName !== undefined && r.invitation.seats.state === "shown",
      JSON.stringify(r).slice(0, 300));
    ok("T4 a check is read-only: it creates nothing and the invitation stays pending (a check can be repeated)", (await usersWith(fresh.email)) === 0 && (await invState(fresh.id))!.accepted_at === null && reasonOf(await check(fresh.token)) === "OK");
  }

  // ===================================================================================================================
  section("S. Success: one transaction, the user in the invitation's company, its evidence — and no session");
  {
    const email = `joiner.${tag()}@join-fixture.test`;
    const inv = await invite(A, email, { name: "Fixture Joiner" });
    const res = await accept({ token: inv.token, name: "  Fixture   Joiner  Edited " });
    const user = await one<{ id: number; org_id: number; email: string; role: string; name: string; is_active: boolean; password_hash: string; xmin: string }>(`select id, org_id, email, role, name, is_active, password_hash, xmin::text as xmin from users where email = $1`, [email]);
    const state = await one<{ accepted_at: Date | null; accepted_user_id: number | null; xmin: string }>(`select accepted_at, accepted_user_id, xmin::text as xmin from user_invitations where id = $1`, [inv.id]);
    ok("S1 accepted: ONE user in the invitation's company with the invited role, the lower-cased e-mail, the confirmed name (white space collapsed), active, a bcrypt hash of the chosen password",
      res.ok && res.email === email && res.companyName === "Join Fixture Alpha" && res.role === "staff" && !!user && user.org_id === A && user.role === "staff" && user.name === "Fixture Joiner Edited" && user.is_active && (await bcrypt.compare(PASSWORD, user.password_hash)) && user.password_hash !== PASSWORD,
      JSON.stringify(res));
    const audit = (await auditsOf(inv.id)).find((a) => a.action === "user_invitation.accepted");
    const sec = await one<{ type: string; detail: string | null; xmin: string }>(`select type, detail, xmin::text as xmin from security_events where user_id = $1 and type = 'account.created'`, [user!.id]);
    const act = await one<{ type: string; description: string; xmin: string }>(`select type, description, xmin::text as xmin from activity_logs where entity_id = $1 and type = 'team.member-joined'`, [user!.id]);
    const auditXmin = await one<{ xmin: string }>(`select xmin::text as xmin from platform_audit_events where entity_id = $1 and action = 'user_invitation.accepted'`, [inv.id]);
    ok("S2 the invitation is accepted BY that user (accepted_at, accepted_user_id); the user, the acceptance, the security event, the activity record and the platform audit share ONE transaction (one xmin)",
      !!state?.accepted_at && state.accepted_user_id === user!.id && new Set([user!.xmin, state.xmin, sec?.xmin, act?.xmin, auditXmin?.xmin]).size === 1);
    ok("S3 the evidence: platform audit `user_invitation.accepted` (actor 'invitee', pending → accepted, reference, user, role, seats not enforced), customer `account.created` and the company's activity `team.member-joined`",
      !!audit && audit.result === "success" && audit.actor_label === "invitee" && audit.before_safe?.state === "pending" && audit.after_safe?.state === "accepted" && audit.after_safe?.userId === user!.id && audit.after_safe?.role === "staff" &&
        (audit.after_safe?.seats as { enforced?: boolean })?.enforced === false && sec?.type === "account.created" && /user invitation, staff/.test(String(sec?.detail)) && act?.description === "Joined the team by invitation (staff)");
    ok("S4 no session is issued: the new user has no session row (the page links to /login)", (await n(`select count(*)::int as n from sessions where user_id = $1`, [user!.id])) === 0);
    const replay = await accept({ token: inv.token });
    ok("S5 the link works once: a replay answers `used` and creates nothing (one user with the e-mail)", reasonOf(replay) === "used" && (await usersWith(email)) === 1);
    const adminInv = await invite(A, `admin.${tag()}@join-fixture.test`, { role: "admin" });
    const adminRes = await accept({ token: adminInv.token });
    ok("S6 an admin invitation creates an admin (never an owner — the table refuses an owner invitation)",
      adminRes.ok && (await one<{ role: string }>(`select role from users where email = $1`, [adminInv.email]))?.role === "admin" &&
        (await q(`insert into user_invitations (org_id, name, email_normalized, requested_role, token_hash, expires_at, invited_by_platform_admin_id) values ($1, 'X', 'owner.invite@join-fixture.test', 'owner', $2, now() + interval '1 hour', $3)`, [A, sha256(tag()), keeper]).then(() => "OK", (e: { code?: string }) => e.code)) === "23514");
  }

  // ===================================================================================================================
  section("V. The invitee's fields (the /register policy); the company, e-mail and role cannot be changed");
  {
    const inv = await invite(A, `fields.${tag()}@join-fixture.test`);
    const results = await Promise.all([
      accept({ token: inv.token, name: "" }),
      accept({ token: inv.token, name: "x".repeat(201) }),
      accept({ token: inv.token, name: "Bad\u202eName" }),
      accept({ token: inv.token, password: "short", confirm: "short" }),
      accept({ token: inv.token, password: "alllowercase1!", confirm: "alllowercase1!" }),
      accept({ token: inv.token, password: "Password1!", confirm: "Password1!" }),
      accept({ token: inv.token, confirm: "Different-Pass-1!" }),
    ]);
    const fields = results.map((r) => (r.ok ? "OK" : r.reason === "validation" ? `v:${r.field}` : r.reason));
    ok("V1 name (empty, over 200, a direction override), password policy (too short, no upper case, a common password) and the confirmation are refused field by field; nothing is created and the link stays usable",
      JSON.stringify(fields) === JSON.stringify(["v:name", "v:name", "v:name", "v:password", "v:password", "v:password", "v:confirm"]) && (await usersWith(inv.email)) === 0 && reasonOf(await check(inv.token)) === "OK",
      fields.join(","));
    const extra = await withRequest(request(), () => routeActions.acceptJoinLinkAction({ token: inv.token, name: "X Y", password: PASSWORD, confirm: PASSWORD, email: "attacker@join-fixture.test" }));
    const roleField = await withRequest(request(), () => routeActions.acceptJoinLinkAction({ token: inv.token, name: "X Y", password: PASSWORD, confirm: PASSWORD, role: "owner" }));
    const orgField = await withRequest(request(), () => routeActions.checkJoinLinkAction({ token: inv.token, orgId: B }));
    ok("V2 the server actions take strict shapes: an e-mail, a role or a company sent by the client is refused as an invalid link before anything runs — those come from the invitation only",
      reasonOf(extra) === "invalid" && reasonOf(roleField) === "invalid" && reasonOf(orgField) === "invalid" && (await usersWith(inv.email)) === 0 && (await usersWith("attacker@join-fixture.test")) === 0);
  }

  // ===================================================================================================================
  section("R. Refusals: a suspended company, an existing account (neutral), seats");
  {
    const sInv = await invite(S, `suspended.${tag()}@join-fixture.test`);
    ok("R1 a suspended company: the check and the acceptance answer `company_unavailable`; nothing is created; audited (company_suspended)",
      reasonOf(await check(sInv.token)) === "company_unavailable" && reasonOf(await accept({ token: sInv.token })) === "company_unavailable" && (await usersWith(sInv.email)) === 0 && (await stagesOf(sInv.id)).includes("company_suspended"));
    const taken = `taken.${tag()}@join-fixture.test`;
    const tInv = await invite(A, taken);
    await newUser(E, "staff", taken.toUpperCase());
    const tCheck = await check(tInv.token);
    const tAccept = await accept({ token: tInv.token });
    ok("R2 an e-mail that already belongs to a customer user (another company, another letter case): the check does not reveal it; the acceptance answers the neutral `unavailable` — the same word as a system failure — and creates nothing",
      reasonOf(tCheck) === "OK" && reasonOf(tAccept) === "unavailable" && (await usersWith(taken)) === 1 && (await invState(tInv.id))!.accepted_at === null && (await stagesOf(tInv.id)).includes("email_conflict"));
    // Seats, enforcement ON.
    process.env.CUSTOMER_SEAT_ENFORCEMENT_ENABLED = "true";
    const fInv = await invite(F, `full.${tag()}@join-fixture.test`);
    const fCheck = await check(fInv.token);
    const fAccept = await accept({ token: fInv.token });
    ok("R3 enforcement on, a full company (2 users + this reservation = 3 of 2 seats): the check and the acceptance answer `seats_full`; nothing is created; audited (seat_limit)",
      reasonOf(fCheck) === "seats_full" && reasonOf(fAccept) === "seats_full" && (await usersWith(fInv.email)) === 0 && (await stagesOf(fInv.id)).includes("seat_limit"));
    const lInv = await invite(L, `legacy.${tag()}@join-fixture.test`);
    ok("R4 enforcement on, a company with no subscription: the invitation cannot be accepted (`seats_full`, audited no_subscription) — a missing subscription is never read as unlimited",
      reasonOf(await accept({ token: lInv.token })) === "seats_full" && (await usersWith(lInv.email)) === 0 && (await stagesOf(lInv.id)).includes("no_subscription"));
    const C3 = await newOrg("Join Fixture Convert");
    await newUser(C3, "owner", `owner.convert.${tag()}@join-fixture.test`);
    await newUser(C3, "staff", `staff.convert.${tag()}@join-fixture.test`, false);
    await subscribe(C3, 3);
    const cInv = await invite(C3, `convert.${tag()}@join-fixture.test`);
    const before = await check(cInv.token);
    const conv = await accept({ token: cInv.token });
    const seatsAfter = await one<{ users: number; pending: number }>(`select (select count(*)::int from users where org_id = $1) as users, (select count(*)::int from user_invitations where org_id = $1 and accepted_at is null and revoked_at is null) as pending`, [C3]);
    const convSeats = (await auditsOf(cInv.id)).find((a) => a.action === "user_invitation.accepted")?.after_safe?.seats as { enforced?: unknown; seats?: unknown; occupied?: unknown } | undefined;
    ok("R5 enforcement on, the reserved seat becomes the user (never counted twice): 2 users + the reservation = 3 of 3 before, 3 users + 0 pending = 3 of 3 after; the audit records the enforced seats",
      before.ok && before.invitation.seats.state === "enforced" && before.invitation.seats.occupied === 3 && conv.ok && seatsAfter?.users === 3 && seatsAfter?.pending === 0 &&
        convSeats?.enforced === true && convSeats.seats === 3 && convSeats.occupied === 3,
      JSON.stringify(convSeats));
    delete process.env.CUSTOMER_SEAT_ENFORCEMENT_ENABLED;
    const offInv = await invite(F, `full.off.${tag()}@join-fixture.test`);
    const offCheck = await check(offInv.token);
    const off = await accept({ token: offInv.token });
    ok("R6 enforcement off (the default): the same full company accepts (seats shown, not enforced — the behaviour before PO-03D)", offCheck.ok && offCheck.invitation.seats.state === "shown" && off.ok && (await usersWith(offInv.email)) === 1);
  }

  // ===================================================================================================================
  section("K. Races (deterministic barriers) and the shared lock order");
  {
    // K1 two simultaneous acceptances of one link.
    const k1 = await invite(A, `twice.${tag()}@join-fixture.test`);
    const gate = await blocker([{ ...emailLockSql, values: [k1.email] }]);
    const first = accept({ token: k1.token });
    const second = accept({ token: k1.token });
    const bothWait = await until(async () => (await lockWaiters(EMAIL_LOCK)) === 2);
    await gate.release();
    const pair = [reasonOf(await first), reasonOf(await second)].sort();
    ok("K1 two simultaneous acceptances of one link both queue on the e-mail lock: exactly one user, the other answers `used`", bothWait && JSON.stringify(pair) === '["OK","used"]' && (await usersWith(k1.email)) === 1);

    // K2 acceptance vs revocation — both orders.
    const k2a = await invite(A, `revoke.first.${tag()}@join-fixture.test`);
    const rev = await blocker([{ ...emailLockSql, values: [k2a.email] }, { text: `update user_invitations set revoked_at = greatest(now(), created_at), revoked_by_platform_admin_id = $2 where id = $1`, values: [k2a.id, keeper] }]);
    const waitingAccept = accept({ token: k2a.token });
    const k2aWaits = await until(async () => (await lockWaiters(EMAIL_LOCK)) === 1);
    await rev.release(true);
    const k2aRes = reasonOf(await waitingAccept);
    const k2b = await invite(A, `accept.first.${tag()}@join-fixture.test`);
    const hold = await blocker([{ text: `select id from user_invitations where id = $1 for update`, values: [k2b.id] }]);
    const acceptFirst = accept({ token: k2b.token });
    const k2bAcceptWaits = await until(async () => (await lockWaiters(INV_LOCK)) === 1);
    const revoker = await blocker([]);
    const revokeLater = revoker.client.query(`select pg_advisory_xact_lock(hashtextextended('platform-invitation-email:' || $1, 0))`, [k2b.email]).then(() => revoker.client.query(`update user_invitations set revoked_at = greatest(now(), created_at), revoked_by_platform_admin_id = $2 where id = $1 and accepted_at is null and revoked_at is null`, [k2b.id, keeper]));
    const revokeWaits = await until(async () => (await lockWaiters(EMAIL_LOCK)) === 1);
    await hold.release();
    const k2bRes = reasonOf(await acceptFirst);
    const revokeRows = (await revokeLater).rowCount;
    await revoker.release(true);
    ok("K2 acceptance vs revocation: a revocation that commits first makes the waiting acceptance `invalid` (no user); an acceptance that holds the locks first wins and the revocation then finds nothing open to revoke",
      k2aWaits && k2aRes === "invalid" && (await usersWith(k2a.email)) === 0 && k2bAcceptWaits && revokeWaits && k2bRes === "OK" && revokeRows === 0 && (await invState(k2b.id))!.revoked_at === null && (await usersWith(k2b.email)) === 1);

    // K3 acceptance vs re-issue — the re-issue revokes the old link and inserts a new one under the same e-mail lock.
    const k3 = await invite(A, `reissue.${tag()}@join-fixture.test`);
    const newToken = randomBytes(32).toString("base64url");
    tokensSeen.push(newToken);
    const reissue = await blocker([
      { ...emailLockSql, values: [k3.email] },
      { text: `update user_invitations set revoked_at = greatest(now(), created_at), revoked_by_platform_admin_id = $2 where id = $1`, values: [k3.id, keeper] },
      { text: `insert into user_invitations (org_id, name, email_normalized, requested_role, token_hash, expires_at, invited_by_platform_admin_id, created_at) values ($1, 'Fixture Invitee', $2, 'staff', $3, $4, $5, $6)`, values: [A, k3.email, sha256(newToken), new Date(nowMs + 72 * HOUR), keeper, new Date(nowMs - MINUTE)] },
    ]);
    const oldLink = accept({ token: k3.token });
    const k3Waits = await until(async () => (await lockWaiters(EMAIL_LOCK)) === 1);
    await reissue.release(true);
    const oldRes = reasonOf(await oldLink);
    const newRes = reasonOf(await accept({ token: newToken }));
    ok("K3 acceptance vs re-issue: the old link, waiting while the re-issue commits, is `invalid`; the new link then works — one user", k3Waits && oldRes === "invalid" && newRes === "OK" && (await usersWith(k3.email)) === 1);

    // K4 acceptance vs expiry: the decision time is read AFTER the locks.
    const k4 = await invite(A, `expiring.${tag()}@join-fixture.test`, { createdAgoMs: 71 * HOUR + 59 * MINUTE });
    const exp = (await one<{ e: Date }>(`select expires_at as e from user_invitations where id = $1`, [k4.id]))!.e.getTime();
    const k4gate = await blocker([{ ...emailLockSql, values: [k4.email] }]);
    const late = accept({ token: k4.token });
    const k4Waits = await until(async () => (await lockWaiters(EMAIL_LOCK)) === 1);
    const saved = nowMs;
    nowMs = exp; // the link expires while the acceptance waits
    await k4gate.release();
    const k4Res = reasonOf(await late);
    nowMs = saved;
    ok("K4 acceptance vs expiry: a link that expires while the acceptance waits for its locks is `expired` (judged at the decision time, after the locks); nothing created", k4Waits && k4Res === "expired" && (await usersWith(k4.email)) === 0);

    // K5 acceptance vs company suspension — both orders.
    const K5 = await newOrg("Join Fixture Suspend Race");
    await newUser(K5, "owner", `owner.k5.${tag()}@join-fixture.test`);
    await subscribe(K5, 5);
    const k5a = await invite(K5, `suspend.first.${tag()}@join-fixture.test`);
    const susp = await blocker([{ text: `select id from orgs where id = $1 for no key update`, values: [K5] }, { text: `insert into tenant_access_controls (org_id, access_status, reason, changed_by_platform_admin_id, changed_at) values ($1, 'suspended', 'Fixture: suspended during acceptance', $2, now())`, values: [K5, keeper] }]);
    const k5aAccept = accept({ token: k5a.token });
    const k5aWaits = await until(async () => (await lockWaiters(ORG_LOCK)) === 1);
    await susp.release(true);
    const k5aRes = reasonOf(await k5aAccept);
    const K5b = await newOrg("Join Fixture Suspend Race B");
    await newUser(K5b, "owner", `owner.k5b.${tag()}@join-fixture.test`);
    await subscribe(K5b, 5);
    const k5b = await invite(K5b, `accept.before.suspend.${tag()}@join-fixture.test`);
    const invHold = await blocker([{ text: `select id from user_invitations where id = $1 for update`, values: [k5b.id] }]);
    const k5bAccept = accept({ token: k5b.token });
    const k5bAtInvitation = await until(async () => (await lockWaiters(INV_LOCK)) === 1);
    const suspender = await blocker([]);
    const suspendLater = suspender.client.query(`select id from orgs where id = $1 for no key update`, [K5b]);
    const suspendWaits = await until(async () => (await lockWaiters(/from orgs where id = \$1 for no key update/i)) === 1);
    await invHold.release();
    const k5bRes = reasonOf(await k5bAccept);
    await suspendLater;
    await suspender.client.query(`insert into tenant_access_controls (org_id, access_status, reason, changed_by_platform_admin_id, changed_at) values ($1, 'suspended', 'Fixture: suspended after acceptance', $2, now())`, [K5b, keeper]);
    await suspender.release(true);
    ok("K5 acceptance vs suspension: a suspension committed while the acceptance waits for the company row makes it `company_unavailable` (nothing created); an acceptance holding the company row makes the suspension wait — the user is created first, then the company is suspended",
      k5aWaits && k5aRes === "company_unavailable" && (await usersWith(k5a.email)) === 0 && k5bAtInvitation && suspendWaits && k5bRes === "OK" && (await usersWith(k5b.email)) === 1);

    // K6 acceptance vs a direct registration of the same e-mail (/register writes users without the e-mail lock).
    const k6a = await invite(A, `register.first.${tag()}@join-fixture.test`);
    const R1 = await newOrg("Join Fixture Registrant");
    await newUser(R1, "owner", k6a.email);
    const k6aRes = reasonOf(await accept({ token: k6a.token }));
    const k6b = await invite(A, `register.racing.${tag()}@join-fixture.test`);
    const R2 = await newOrg("Join Fixture Registrant Two");
    const registrant = await blocker([{ text: `insert into users (org_id, email, password_hash, name, role) values ($1, $2, $3, 'Fixture Registrant', 'owner')`, values: [R2, k6b.email, HASH] }]);
    const racing = accept({ token: k6b.token });
    const waitsOnIndex = await until(async () => (await lockWaiters(USERS_INSERT)) === 1);
    await registrant.release(true);
    const k6bRes = reasonOf(await racing);
    const k6c = await invite(A, `register.rolledback.${tag()}@join-fixture.test`);
    const R3 = await newOrg("Join Fixture Registrant Three");
    const registrant2 = await blocker([{ text: `insert into users (org_id, email, password_hash, name, role) values ($1, $2, $3, 'Fixture Registrant', 'owner')`, values: [R3, k6c.email, HASH] }]);
    const racing2 = accept({ token: k6c.token });
    const waits2 = await until(async () => (await lockWaiters(USERS_INSERT)) === 1);
    await registrant2.release(false);
    const k6cRes = reasonOf(await racing2);
    ok("K6 acceptance vs registration of the same e-mail: an account committed first refuses the acceptance (`unavailable`, neutral); a registration still in flight makes the acceptance wait on users_email_unique — committed, the acceptance rolls back WHOLE (23505 → `unavailable`); rolled back, the acceptance succeeds. One account each time",
      k6aRes === "unavailable" && (await usersWith(k6a.email)) === 1 && waitsOnIndex && k6bRes === "unavailable" && (await usersWith(k6b.email)) === 1 && (await invState(k6b.id))!.accepted_at === null && waits2 && k6cRes === "OK" && (await usersWith(k6c.email)) === 1);

    // K7 mixed-case e-mails and writers outside the application (company E holds the existing accounts).
    const k7a = await invite(A, `mixed.case.${tag()}@join-fixture.test`);
    await newUser(E, "staff", k7a.email.replace(/^m/, "M").replace("case", "CASE"));
    const k7aRes = reasonOf(await accept({ token: k7a.token }));
    ok("K7 mixed case: an existing account in another letter case refuses the acceptance (lower(email) check under the e-mail lock, neutral `unavailable`); nothing created",
      k7aRes === "unavailable" && (await usersWith(k7a.email)) === 1 && (await invState(k7a.id))!.accepted_at === null);

    // K8 the documented residual (D-7): a writer OUTSIDE the application — one that neither takes the e-mail lock nor
    //    stores the lower-cased form — inserting a case-variant twin in parallel is invisible to the in-transaction check
    //    (not yet committed) and is not stopped by the case-sensitive users_email_unique. The PO-02D3 proposal
    //    users_email_lower_uq closes it; it is applied here to THIS disposable database only (partial, so the twins this
    //    test created first do not stop it from building), never to any shared database.
    const k8 = await invite(A, `external.writer.${tag()}@join-fixture.test`);
    const external = await blocker([{ text: `insert into users (org_id, email, password_hash, name, role) values ($1, $2, $3, 'Fixture External', 'staff')`, values: [E, k8.email.toUpperCase(), HASH] }]);
    const k8Res = reasonOf(await accept({ token: k8.token }));
    await external.release(true);
    const twins = await usersWith(k8.email);
    const C8 = await newOrg("Join Fixture Lower Index");
    await newUser(C8, "owner", `owner.lower.${tag()}@join-fixture.test`);
    const lowerIdx = await q(`create unique index users_email_lower_uq on users (lower(email)) where org_id <> ${Number(E)}`).then(() => true, () => false);
    const k8c = await invite(C8, `external.closed.${tag()}@join-fixture.test`);
    const external2 = await blocker([{ text: `insert into users (org_id, email, password_hash, name, role) values ($1, $2, $3, 'Fixture External', 'staff')`, values: [C8, k8c.email.toUpperCase(), HASH] }]);
    const k8cAccept = accept({ token: k8c.token });
    const k8cWaits = await until(async () => (await lockWaiters(USERS_INSERT)) === 1, 5_000);
    await external2.release(true);
    const k8cRes = reasonOf(await k8cAccept);
    await q(`drop index if exists users_email_lower_uq`);
    ok("K8 the documented residual, explicitly: a writer OUTSIDE the application inserting a case-variant twin in parallel is not stopped by the case-sensitive users_email_unique (two rows that differ only in case) — release stays NO-GO until the D-7 audit and the owner's decision on users_email_lower_uq; with that proposed index (this disposable database only) the same race waits and is refused by the database (`unavailable`, the acceptance rolled back whole)",
      k8Res === "OK" && twins === 2 && lowerIdx && k8cWaits && k8cRes === "unavailable" && (await usersWith(k8c.email)) === 1 && (await invState(k8c.id))!.accepted_at === null,
      `${k8Res} twins=${twins} idx=${lowerIdx} waits=${k8cWaits} ${k8cRes}`);

    // K9 the lock order is the shared one: a transaction that takes it the other way round can deadlock — PostgreSQL
    //    aborts one side, and whichever it is, nothing half-done remains.
    const K9 = await newOrg("Join Fixture Deadlock");
    await newUser(K9, "owner", `owner.k9.${tag()}@join-fixture.test`);
    await subscribe(K9, 5);
    const k9 = await invite(K9, `deadlock.${tag()}@join-fixture.test`);
    const wrongOrder = await blocker([{ text: `select id from orgs where id = $1 for no key update`, values: [K9] }]);
    const k9Accept = accept({ token: k9.token });
    const atOrg = await until(async () => (await lockWaiters(ORG_LOCK)) === 1);
    const wrongEmail = wrongOrder.client.query(`select pg_advisory_xact_lock(hashtextextended('platform-invitation-email:' || $1, 0))`, [k9.email]).then(() => "granted", (e: { code?: string }) => e.code ?? "ERR");
    const k9Res = reasonOf(await k9Accept);
    const wrongRes = await wrongEmail;
    await wrongOrder.release(false);
    const k9Users = await usersWith(k9.email);
    ok("K9 a transaction that violates the lock order (company row first, then the e-mail lock) deadlocks with an acceptance: PostgreSQL aborts one side (40P01) and nothing half-done remains — no user without an accepted invitation, no accepted invitation without its user",
      atOrg &&
        ((k9Res === "unavailable" && wrongRes === "granted" && k9Users === 0 && (await invState(k9.id))!.accepted_at === null && (await stagesOf(k9.id)).includes("deadlock")) ||
          (k9Res === "OK" && wrongRes === "40P01" && k9Users === 1 && (await invState(k9.id))!.accepted_user_id !== null)),
      `${k9Res} ${wrongRes}`);

    // K10 a bounded wait: the company row held longer than 5 s.
    const K10 = await newOrg("Join Fixture Timeout");
    await newUser(K10, "owner", `owner.k10.${tag()}@join-fixture.test`);
    await subscribe(K10, 5);
    const k10 = await invite(K10, `timeout.${tag()}@join-fixture.test`);
    const longHold = await blocker([{ text: `select id from orgs where id = $1 for no key update`, values: [K10] }]);
    const t0 = Date.now();
    const k10Res = reasonOf(await accept({ token: k10.token }));
    const waited = Date.now() - t0;
    await longHold.release();
    ok("K10 lock waits are bounded: a company row held for longer than 5 s makes the acceptance answer `unavailable` (lock_timeout, audited); nothing created; the same link then works",
      k10Res === "unavailable" && waited >= 4_500 && (await usersWith(k10.email)) === 0 && (await stagesOf(k10.id)).includes("lock_timeout") && reasonOf(await accept({ token: k10.token })) === "OK");
  }

  // ===================================================================================================================
  section("Y. Rollback: a failure at any write leaves nothing (no user, no acceptance, no success record)");
  {
    const cases: { name: string; table: string; when?: string; timing?: string; stage: string }[] = [
      { name: "the user insert", table: "users", stage: "user" },
      { name: "the acceptance mark (after the user insert, before accepted)", table: "user_invitations", timing: "before update", stage: "accepted" },
      { name: "the customer security event", table: "security_events", stage: "evidence" },
      { name: "the activity record", table: "activity_logs", stage: "evidence" },
      { name: "the platform audit record", table: "platform_audit_events", when: "new.action = 'user_invitation.accepted'", stage: "audit" },
    ];
    const outcomes: string[] = [];
    for (const c of cases) {
      const inv = await invite(A, `rollback.${c.table}.${tag()}@join-fixture.test`);
      await failingTrigger(c.table, true, c.when, c.timing);
      const res = reasonOf(await accept({ token: inv.token }));
      await failingTrigger(c.table, false, undefined, c.timing);
      const nothing = (await usersWith(inv.email)) === 0 && (await invState(inv.id))!.accepted_at === null && !(await auditsOf(inv.id)).some((a) => a.action === "user_invitation.accepted");
      const retried = reasonOf(await accept({ token: inv.token }));
      outcomes.push(`${c.name}:${res}:${nothing}:${(await stagesOf(inv.id)).includes(c.stage)}:${retried}`);
    }
    ok("Y1 an injected failure at the user insert, at the acceptance mark (the user already inserted), at the security event, at the activity record or at the platform audit answers `unavailable` and leaves NOTHING: no user, the invitation still pending, no success record; the failure is audited with its stage, and the same link then succeeds",
      outcomes.every((o) => /:unavailable:true:true:OK$/.test(o)), outcomes.join(" | "));
    ok("Y2 an audit-trail outage is reported as an incident line (class only — no message, value, token or password)", logged.some((l) => /audit_write_failed/.test(l) && /user_invitation\.accepted/.test(l)));
  }

  // ===================================================================================================================
  section("H. The durable, purpose-separated public throttle");
  {
    const ip = "10.99.0.7";
    const real = await invite(A, `throttle.${tag()}@join-fixture.test`);
    const answers: string[] = [];
    for (let i = 0; i < 10; i++) answers.push(reasonOf(await check(randomBytes(32).toString("base64url"), ip)));
    const blocked = reasonOf(await check(real.token, ip));
    const attemptsDuring = await n(`select count(*)::int as n from platform_login_attempts`);
    const blockedAgain = reasonOf(await accept({ token: real.token }, ip));
    ok("H1 ten unknown links from one address: the eleventh request — even with a REAL link — is `throttled` before any lookup, and a request during the block writes nothing",
      answers.every((a) => a === "invalid") && blocked === "throttled" && blockedAgain === "throttled" && (await n(`select count(*)::int as n from platform_login_attempts`)) === attemptsDuring && (await usersWith(real.email)) === 0);
    const now = new Date(nowMs);
    const companyBlocked = await companyThrottle.activeAcceptanceBlock(companyThrottle.acceptanceThrottleKeys(null, ip), now);
    const loginBlocked = await loginThrottle.activeLoginBlock(loginThrottle.throttleKeys("someone@join-fixture.test", ip), now);
    const ownKeys = core.userAcceptanceThrottleKeys(real.email, ip);
    const companyKeys = companyThrottle.acceptanceThrottleKeys(real.email, ip);
    ok("H2 purpose-separated keys: the address blocked HERE is not blocked for company-invitation acceptance nor for Platform Owner sign-in, and its digests never equal theirs",
      companyBlocked === null && loginBlocked === null && ownKeys.ipHash !== companyKeys.ipHash && ownKeys.invitationHash !== companyKeys.invitationHash && !!ownKeys.ipHash && !JSON.stringify(ownKeys).includes(ip) && !JSON.stringify(ownKeys).includes(real.email));
    const ip2 = "10.99.0.8";
    for (let i = 0; i < 10; i++) await companyThrottle.recordAcceptanceAttempt(companyThrottle.acceptanceThrottleKeys(null, ip2), "failure", now);
    ok("H3 …and the reverse: an address blocked for company-invitation acceptance is NOT blocked here", (await companyThrottle.activeAcceptanceBlock(companyThrottle.acceptanceThrottleKeys(null, ip2), now)) !== null && reasonOf(await check(real.token, ip2)) === "OK");
    // Independent processes: four children record failures for one fresh address at the same time.
    const ip3 = "10.99.0.9";
    const runChild = (args: string[]) =>
      new Promise<string>((resolve) => {
        const child = spawn(process.execPath, [join(ROOT, "node_modules", ".bin", "tsx"), "--conditions=react-server", join(ROOT, "verify/platform/user-acceptance-throttle-child.mts"), ...args], { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        child.stdout.on("data", (d) => (out += String(d)));
        child.on("close", () => resolve(out.trim().split("\n").pop() ?? ""));
      });
    const childOut = await Promise.all([0, 1, 2, 3].map(() => runChild(["fail", ip3, now.toISOString(), "3"])));
    const probe = await runChild(["probe", ip3, now.toISOString()]);
    const failures = await n(`select count(*)::int as n from platform_login_attempts where ip_hash = $1 and outcome = 'failure'`, [core.userAcceptanceThrottleKeys(null, ip3).ipHash]);
    const blockRows = await n(`select count(*)::int as n from platform_login_attempts where ip_hash = $1 and blocked_until is not null`, [core.userAcceptanceThrottleKeys(null, ip3).ipHash]);
    ok("H4 independent processes: four processes recording 3 failures each for one address at once are counted exactly (12, under per-key advisory locks); the block is written from the 10th failure on; a fifth process sees the block — the state is in PostgreSQL, not in memory",
      childOut.every((o) => /"recorded":3/.test(o)) && failures === 12 && blockRows === 3 && /"blocked":true/.test(probe) && reasonOf(await check(real.token, ip3)) === "throttled", `${childOut.join(" ")} ${probe} f=${failures} b=${blockRows}`);
    // Per invitation: five client-caused failures against one invitation block it from any address.
    const victim = await invite(A, `victim.${tag()}@join-fixture.test`, { createdAgoMs: 80 * HOUR });
    const perInv: string[] = [];
    for (let i = 0; i < 6; i++) perInv.push(reasonOf(await check(victim.token)));
    nowMs += 16 * MINUTE;
    const afterBlock = reasonOf(await check(victim.token));
    ok("H5 per invitation: five client-caused refusals (here: an expired link, each from a different address) block that invitation for 15 minutes from any address; the block lifts after it",
      JSON.stringify(perInv) === '["expired","expired","expired","expired","expired","throttled"]' && afterBlock === "expired", `${perInv.join(",")} then ${afterBlock}`);
  }

  // ===================================================================================================================
  section("P. Nothing secret stored, printed, audited or sent; no other tenant touched; the copy is complete");
  {
    const auditText = JSON.stringify(await q(`select * from platform_audit_events`));
    const secText = JSON.stringify(await q(`select * from security_events`));
    const actText = JSON.stringify(await q(`select * from activity_logs`));
    const logText = logged.join("\n");
    const leaked = [...tokensSeen, ...tokensSeen.map(sha256), ...secretsSeen].filter((s) => auditText.includes(s) || secText.includes(s) || actText.includes(s) || logText.includes(s));
    ok("P1 no link token, token digest or password appears in any platform audit record, customer security event, activity record or console line", leaked.length === 0, `${leaked.length} leaked`);
    const tables = (await q<{ t: string }>(`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`)).map((r) => r.t);
    let tableLeaks = 0;
    for (const t of tables) {
      const text = JSON.stringify(await q(`select * from "${t}"`));
      for (const s of [...tokensSeen, PASSWORD]) if (text.includes(s)) tableLeaks++;
    }
    ok("P2 a text scan of EVERY table finds no link token and no password (only digests and bcrypt hashes are stored)", tableLeaks === 0, `${tableLeaks}`);
    ok("P3 nothing is delivered: no connection or fetch to any host but the loopback test database (no e-mail, SMS or WhatsApp)", outbound.length === 0, outbound.join(", "));
    ok("P4 no other tenant changed: company B's users, sessions and invitations are byte-identical", (await tenantChecksum([B])) === otherTenantBefore);
    const clientSrc = readFileSync(join(ROOT, "src/app/(invite)/join/accept/join-invitation.tsx"), "utf8");
    const used = new Set<string>();
    for (const m of clientSrc.matchAll(/\bc\("((?:[^"\\]|\\.)+)"\)/g)) used.add(m[1]);
    for (const m of clientSrc.matchAll(/fill\(locale, "((?:[^"\\]|\\.)+)"/g)) used.add(m[1]);
    for (const m of clientSrc.matchAll(/(?:title|body): "((?:[^"\\]|\\.)+)"/g)) used.add(m[1]);
    for (const m of clientSrc.matchAll(/return "((?:[^"\\]|\\.)+)";/g)) used.add(m[1]);
    for (const m of clientSrc.matchAll(/next\.\w+ = "((?:[^"\\]|\\.)+)";/g)) used.add(m[1]);
    for (const m of clientSrc.matchAll(/c\(view\.invitation\.seats\.state === "enforced" \? "([^"]+)" : "([^"]+)"\)/g)) used.add(m[1]).add(m[2]);
    const bridgeSrc = readFileSync(join(ROOT, "src/lib/onboarding/user-invitation-acceptance.ts"), "utf8");
    for (const m of bridgeSrc.matchAll(/message: "((?:[^"\\]|\\.)+)"/g)) used.add(m[1]);
    // …and every message of the /register password policy the server can return (DEFAULT_POLICY).
    const policySrc = readFileSync(join(ROOT, "src/lib/security/password-policy.ts"), "utf8");
    for (const m of policySrc.matchAll(/errors\.push\("((?:[^"\\]|\\.)+)"\)/g)) used.add(m[1]);
    used.add(`Must be at least ${DEFAULT_POLICY.minLength} characters.`);
    const missingCopy = [...used].filter((k) => !JOIN_COPY_KEYS.includes(k));
    ok("P5 every English string of the page (headings, labels, notices, refusals and the server's validation messages) has its Saudi Arabic entry", used.size >= 40 && missingCopy.length === 0, `${used.size} strings; missing: ${missingCopy.join(" | ")}`);
  }
}

let crashed = false;
try {
  await main();
} catch (e) {
  crashed = true;
  ok("the suite ran to completion", false, describeError(e));
} finally {
  await pool.end().catch(() => undefined);
  if (created) await dropDisposableDatabase(testDbName).catch(() => undefined);
}
summary("verify:platform-user-acceptance");
if (crashed) process.exitCode = 1;
