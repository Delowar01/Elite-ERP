/**
 * Platform Owner PO-02D1A.1 — lock-measurement helpers (verify:platform-company-migration-locks).
 *
 * Independent connections and deterministic barriers: a probe runs WITHOUT a lock timeout; the helper waits until the
 * probe either finished or `pg_stat_activity` shows it waiting on a heavyweight lock, and only then records the exact
 * blocking backends (`pg_blocking_pids`) and the lock it waits for, and cancels it (`pg_cancel_backend`) — no sleep
 * decides an outcome. Every transaction is rolled back (measurement only). The statement sequences mirror the code they
 * are named after. Disposable `*_test_only_*` databases with fictional rows only.
 */
import { performance } from "node:perf_hooks";
import type { Client } from "pg";
import { sqlState } from "./harness";
import { newTokenHash } from "./po02a-fixtures";

export const sleep = (n: number) => new Promise((r) => setTimeout(r, n));
export const msSince = (t0: number) => Math.round(performance.now() - t0);
export const pidOf = async (c: Client) => Number((await c.query(`select pg_backend_pid() as p`)).rows[0].p);

/** The customer and platform tables whose locks are reported. */
export const WATCHED = [
  "orgs", "users", "sessions", "customers", "security_events",
  "platform_admins", "platform_sessions", "platform_login_attempts", "platform_audit_events",
  "tenant_access_controls", "organization_invitations",
];

/** Relation locks a backend holds (granted) and waits for (not granted), on the watched tables. */
export async function locksOf(obs: Client, pid: number): Promise<{ held: Record<string, string[]>; waiting: string[] }> {
  const rows = (
    await obs.query(
      `select c.relname as rel, l.mode, l.granted from pg_locks l join pg_class c on c.oid = l.relation
       join pg_namespace n on n.oid = c.relnamespace
       where l.pid = $1 and l.locktype = 'relation' and n.nspname = 'public' and c.relname = any($2) order by 1, 2`,
      [pid, WATCHED],
    )
  ).rows as { rel: string; mode: string; granted: boolean }[];
  const held: Record<string, string[]> = {};
  for (const r of rows.filter((x) => x.granted)) (held[r.rel] ??= []).push(r.mode);
  return { held, waiting: rows.filter((x) => !x.granted).map((x) => `${x.rel} ${x.mode}`) };
}
export const fmtLocks = (h: Record<string, string[]>) => Object.entries(h).map(([t, m]) => `${t}: ${m.join("+")}`).join("; ") || "none";
export const STRONG = ["ShareRowExclusiveLock", "ExclusiveLock", "AccessExclusiveLock", "ShareLock"];
/** The strongest-mode locks only (the ones that can block ordinary reads or writes). */
export const strongLocks = (h: Record<string, string[]>) =>
  Object.fromEntries(Object.entries(h).map(([t, m]) => [t, m.filter((x) => STRONG.includes(x))]).filter(([, m]) => (m as string[]).length > 0)) as Record<string, string[]>;

/** Barrier: true once the backend waits on a heavyweight lock. */
export async function waitsOnLock(obs: Client, pid: number, timeoutMs = 15_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = (await obs.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid])).rows[0];
    if (r?.wait_event_type === "Lock") return true;
    await sleep(10);
  }
  return false;
}

export type Step = { label: string; ok: boolean; ms: number; blockers?: number[]; waitingFor?: string; code?: string };

/**
 * Run one statement on `c` and classify it: it completed (ok), it failed on its own (code), or it waited on a lock —
 * then the blocking pids and the awaited lock are recorded and the statement is cancelled.
 */
export async function runOrBlocked(obs: Client, c: Client, cPid: number, label: string, text: string, params: unknown[] = [], settleMs = 3_000): Promise<Step> {
  const t0 = performance.now();
  let done = false;
  let err: unknown = null;
  const run = c.query(text, params).then(
    () => { done = true; },
    (e) => { done = true; err = e; },
  );
  const deadline = Date.now() + settleMs;
  let waiting = false;
  while (!done && Date.now() < deadline) {
    const r = (await obs.query(`select wait_event_type from pg_stat_activity where pid = $1`, [cPid])).rows[0];
    if (r?.wait_event_type === "Lock") {
      waiting = true;
      break;
    }
    await sleep(5);
  }
  if (!waiting) {
    await run;
    return err ? { label, ok: false, ms: msSince(t0), code: sqlState(err) } : { label, ok: true, ms: msSince(t0) };
  }
  const blockers = ((await obs.query(`select pg_blocking_pids($1) as b`, [cPid])).rows[0].b as number[]).map(Number);
  const w = (await obs.query(`select l.locktype, c.relname, l.mode from pg_locks l left join pg_class c on c.oid = l.relation where l.pid = $1 and not l.granted limit 1`, [cPid])).rows[0];
  await obs.query(`select pg_cancel_backend($1)`, [cPid]);
  await run;
  return { label, ok: false, ms: msSince(t0), blockers, waitingFor: w ? `${w.relname ?? w.locktype} ${w.mode}` : "unknown", code: sqlState(err) };
}

/** A transaction of labelled statements, stopped at the first blocked or failing statement, then rolled back. */
export async function txnSteps(obs: Client, c: Client, statements: [string, string, unknown[]][]): Promise<{ steps: Step[]; blockedAt: Step | null }> {
  const cPid = await pidOf(c);
  await c.query("begin isolation level read committed");
  const steps: Step[] = [];
  let blockedAt: Step | null = null;
  for (const [label, text, params] of statements) {
    const s = await runOrBlocked(obs, c, cPid, label, text, params);
    steps.push(s);
    if (!s.ok) {
      blockedAt = s;
      break;
    }
  }
  await c.query("rollback").catch(() => undefined);
  return { steps, blockedAt };
}
export const fmtSteps = (steps: Step[]) =>
  steps.map((s) => (s.ok ? `${s.label} ${s.ms} ms` : s.blockers ? `${s.label} BLOCKED (waits for ${s.waitingFor}; blocked by pid ${s.blockers.join(",")})` : `${s.label} FAILED ${s.code}`)).join(" → ");
export const fmtStep = (s: Step) => fmtSteps([s]);

// ---------------------------------------------------------------------------------------------------------------------
// Statement sequences (each mirrors the named code path; parameters are fictional fixture rows).
// ---------------------------------------------------------------------------------------------------------------------
type Stmts = [string, string, unknown[]][];

/** Customer sign-in with tenant-access enforcement OFF — the live default (src/app/(auth)/actions.ts loginAction). */
export const customerSignInOff = (email: string, user: number, org: number): Stmts => [
  ["users read by e-mail", `select id, org_id, password_hash, is_active from users where email = $1`, [email]],
  ["UPDATE users.last_login_at", `update users set last_login_at = now() where id = $1`, [user]],
  ["INSERT security_events", `insert into security_events (org_id, user_id, email, type, severity) values ($1, $2, $3, 'login.success', 'info')`, [org, user, email]],
  ["INSERT sessions", `insert into sessions (org_id, user_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '30 days')`, [org, user, newTokenHash()]],
];
/** Customer sign-in with enforcement ON (PO-02C.1 completeSignIn) — only where tenant_access_controls exists. */
export const customerSignInOn = (email: string, user: number, org: number): Stmts => [
  ["orgs FOR SHARE", `select id from orgs where id = $1 for share`, [org]],
  ["access read", `select o.id, tac.access_status from orgs o left join tenant_access_controls tac on tac.org_id = o.id where o.id = $1`, [org]],
  ["users FOR NO KEY UPDATE", `select org_id, is_active, mfa_recovery_codes from users where id = $1 for no key update`, [user]],
  ["UPDATE users.last_login_at", `update users set last_login_at = now() where id = $1`, [user]],
  ["INSERT sessions", `insert into sessions (org_id, user_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '30 days')`, [org, user, newTokenHash()]],
  ["INSERT security_events", `insert into security_events (org_id, user_id, email, type, severity) values ($1, $2, $3, 'login.success', 'info')`, [org, user, email]],
];
/** Platform Owner sign-in (src/lib/platform/login.ts: admin read; then TOTP step, session, last login, audit). */
export const platformOwnerSignIn = (email: string, admin: string): Stmts => [
  ["platform_admins read by e-mail", `select id, password_hash, is_active from platform_admins where lower(email_normalized) = $1`, [email]],
  ["TOTP step UPDATE platform_admins", `update platform_admins set mfa_last_totp_step = coalesce(mfa_last_totp_step, 0) + 1, updated_at = now() where id = $1`, [admin]],
  ["INSERT platform_sessions", `insert into platform_sessions (platform_admin_id, token_hash, mfa_verified_at, created_at, last_seen_at, expires_at) values ($1, $2, now(), now(), now(), now() + interval '12 hours')`, [admin, newTokenHash()]],
  ["UPDATE platform_admins.last_login_at", `update platform_admins set last_login_at = now(), updated_at = now() where id = $1`, [admin]],
  ["INSERT platform_audit_events", `insert into platform_audit_events (actor_platform_admin_id, actor_label, action, entity_type, entity_id, result) values ($1, 'Fictional Operator', 'auth.login.succeeded', 'platform_session', 'fixture-session', 'success')`, [admin]],
  ["INSERT platform_login_attempts", `insert into platform_login_attempts (email_hash, ip_hash, outcome) values ($1, $2, 'success')`, [newTokenHash(), newTokenHash()]],
];
/** Customer self-registration (src/app/(auth)/actions.ts registerAction: org + owner, then security event and session). */
export const registration = (tag: string): Stmts => [
  ["users e-mail lookup", `select id from users where email = $1 limit 1`, [`owner.${tag}@registration-fixture.test`]],
  ["INSERT orgs", `insert into orgs (name, country, currency) values ($1, 'Saudi Arabia', 'SAR')`, [`Registration Fixture ${tag}`]],
  ["INSERT users (owner)", `insert into users (org_id, email, password_hash, name, role) values (currval(pg_get_serial_sequence('orgs', 'id')), $1, 'x', 'Fixture Owner', 'owner')`, [`owner.${tag}@registration-fixture.test`]],
  ["INSERT security_events", `insert into security_events (org_id, email, type, severity) values (currval(pg_get_serial_sequence('orgs', 'id')), $1, 'account.created', 'info')`, [`owner.${tag}@registration-fixture.test`]],
  ["INSERT sessions", `insert into sessions (org_id, user_id, token_hash, expires_at) values (currval(pg_get_serial_sequence('orgs', 'id')), currval(pg_get_serial_sequence('users', 'id')), $1, now() + interval '30 days')`, [newTokenHash()]],
];
/** Ordinary customer reads and writes: tenant pages read the company, users and business rows; business inserts. */
export const customerReadsAndWrites = (org: number): Stmts => [
  ["read orgs (company header)", `select id, name from orgs where id = $1`, [org]],
  ["read users (team list)", `select id, name, role from users where org_id = $1`, [org]],
  ["read customers", `select count(*) from customers where org_id = $1`, [org]],
  ["read sessions (session validation)", `select count(*) from sessions where org_id = $1 and revoked_at is null`, [org]],
  ["INSERT customers (FK check KEY SHARE on orgs)", `insert into customers (org_id, name) values ($1, 'Fixture customer written during the migration')`, [org]],
  ["UPDATE orgs (company settings)", `update orgs set name = name where id = $1`, [org]],
];
