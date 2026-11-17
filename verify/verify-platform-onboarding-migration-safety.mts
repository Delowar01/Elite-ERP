/**
 * Platform Owner PO-02D1A — migration safety of drizzle/platform/PO02D1_onboarding_foundation.sql and its companions
 * (PO02D1_users_org_id_id_concurrently.sql, PO02D1_rollback.sql, PO02D1_users_org_id_id_drop.sql).
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *     npm run verify:platform-onboarding-migration-safety
 *
 * Proves, on disposable loopback `*_test_only_*` databases with FICTIONAL rows only: the guarded entry points refuse
 * unsafe targets; the preconditions; first and repeated application on five database shapes; refusal of every
 * pre-existing object whose shape differs (nothing applied, the object not altered) with positive controls;
 * all-or-nothing under injected failures (lock timeouts, a last-step conflict, a killed backend) and retry; MEASURED
 * lock modes, waits and elapsed times for customer sign-in, suspension, reads and writes during the foundation (both F1
 * paths), during the concurrent F1 build and its attach, and for the guard / foreign-key row locks; the INVALID-index
 * recovery; the rollback (its locks, a failure under a lock, both F1 cleanup paths, the data guard per table, audit
 * evidence kept); what `drizzle-kit push` does before and after the reviewed SQL; and that `db:preflight` still
 * refuses. Elapsed times are from this disposable local cluster — no production-size claim is made. Every database
 * is dropped at the end (PLATFORM_TEST_KEEP_DATABASES=1 keeps them).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import type { Client } from "pg";
import {
  connectDisposable,
  createDisposableDatabase,
  createPlatformTestDatabase,
  disposableName,
  dropDisposableDatabase,
  pushSchema,
  pushPreCompanyTenantSchema,
  pushPreOnboardingSchema,
  applyPlatformMigration,
} from "../scripts/platform/disposable-db";
import {
  projectCatalog,
  projectionDigest,
  diffProjection,
  checkOnboardingFoundation,
  PLATFORM_SQL_PATH,
  PO02A_SQL_PATH,
  PO02D1_SQL_PATH,
  PO02D1_ROLLBACK_SQL_PATH,
  PO02D1_USERS_KEY_CONCURRENT_SQL_PATH,
  PO02D1_USERS_KEY_DROP_SQL_PATH,
  ONBOARDING_TABLES,
} from "../scripts/platform/catalog";
import { section, ok, rejects, sqlState, summary, describeError } from "./platform/harness";
import { insertFixtures, tableChecksums, diffChecksums, newTokenHash, type TenantFixture } from "./platform/po02a-fixtures";
import { PO02D1_CREATED, PO02D1_VERIFIED, runPo02d1, runPo02d1Statements, po02d1Objects, noPo02d1, allPo02d1, po02d1Ddl } from "./platform/po02d1-fixtures";

const created: string[] = [];
const clients: Client[] = [];
const keep = process.env.PLATFORM_TEST_KEEP_DATABASES === "1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ms = (t0: number) => Math.round(performance.now() - t0);
const info = (line: string) => console.log(`  INFO  ${line}`);

async function newDb(prefix: string): Promise<{ name: string; url: string }> {
  const name = disposableName(prefix);
  const url = await createDisposableDatabase(name);
  created.push(name);
  return { name, url };
}
async function connect(url: string): Promise<Client> {
  const c = await connectDisposable(url);
  c.on("error", () => undefined);
  clients.push(c);
  return c;
}
const pidOf = async (c: Client) => Number((await c.query(`select pg_backend_pid() as p`)).rows[0].p);

type Db = { url: string; c: Client; fx: TenantFixture | null };
/** 621f156 tenant shape + PO-01A + fictional tenant rows + PO-02A (the database PO-02D1 is written for). */
async function preD1Db(prefix: string, opts: { fixtures?: boolean; platformRows?: boolean } = {}): Promise<Db> {
  const db = await newDb(prefix);
  const push = await pushPreCompanyTenantSchema(db.url);
  if (!push.ok) throw new Error(`push failed: ${push.output.slice(-400)}`);
  await applyPlatformMigration(db.url, [PLATFORM_SQL_PATH]);
  const c = await connect(db.url);
  const fx = opts.fixtures === false ? null : await insertFixtures(c);
  await applyPlatformMigration(db.url, [PO02A_SQL_PATH]);
  if (opts.platformRows && fx) {
    // PO-01A / PO-02A objects holding rows: an operator audit trail, a suspended company, a pending invitation.
    await c.query(
      `insert into platform_audit_events (actor_platform_admin_id, actor_label, action, entity_type, entity_id, org_id, reason, result)
       values ($1, 'Fictional Operator', 'company.access_suspended', 'organization', $2, $3, 'Fixture: suspended for the test', 'success'),
              ($1, 'Fictional Operator', 'auth.login_succeeded', 'platform_admin', $4, null, null, 'success')`,
      [fx.admin, String(fx.orgs[2]), fx.orgs[2], String(fx.admin)],
    );
    await c.query(`insert into tenant_access_controls (org_id, access_status, reason, changed_by_platform_admin_id, changed_at) values ($1, 'suspended', 'Fixture: suspended for the test', $2, now())`, [fx.orgs[2], fx.admin]);
    await c.query(
      `insert into organization_invitations (company_name, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash, invited_by_platform_admin_id)
       values ('Pending Fixture Co', 'hello@pending.fixture.test', 'Saudi Arabia', 'SAR', 'Pending Owner', 'pending.owner@fixture.test', $1, $2)`,
      [newTokenHash(), fx.admin],
    );
  }
  return { url: db.url, c, fx };
}
const digest = async (c: Client) => {
  const p = await projectCatalog(c);
  return projectionDigest(p.platform) + projectionDigest(p.other);
};
const allTables = async (c: Client) => {
  const p = await projectCatalog(c);
  return [...p.platform.tables, ...p.other.tables];
};
const steps = (s: string[]) => s.join(" · ");
const same = (a: readonly string[], b: readonly string[]) => JSON.stringify(a) === JSON.stringify(b);

const FOUNDATION = readFileSync(PO02D1_SQL_PATH, "utf8");
const ROLLBACK = readFileSync(PO02D1_ROLLBACK_SQL_PATH, "utf8");
/** The same files with their final COMMIT removed: the transaction stays open, holding its locks, until the test ends it. */
const FOUNDATION_HELD = FOUNDATION.replace(/\nCOMMIT;\s*$/, "\n");
const ROLLBACK_HELD = ROLLBACK.replace(/\nCOMMIT;\s*$/, "\n");
/** The runbook's statements, as runStatements executes them. */
const runbook = (path: string) =>
  readFileSync(path, "utf8")
    .split(/^-- statement\s*$/m)
    .slice(1)
    .map((chunk) => chunk.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n").trim())
    .filter(Boolean);
const CIC = runbook(PO02D1_USERS_KEY_CONCURRENT_SQL_PATH);
const CIC_BUILD = CIC.find((s) => s.startsWith("CREATE UNIQUE INDEX CONCURRENTLY")) ?? "";
const CIC_ATTACH = CIC.find((s) => s.startsWith("DO $attach$")) ?? "";
const KEY_AS_RUNBOOK_BUILDS_IT = "create unique index users_org_id_id_uq on public.users using btree (id, org_id)";

const WATCHED = ["users", "orgs", "platform_admins", "organization_invitations", "sessions", "tenant_access_controls", "platform_audit_events", "customers", "security_events"];
/** The relation locks a backend holds (granted) and waits for (not granted), on the customer and platform tables watched. */
async function locksOf(obs: Client, pid: number): Promise<{ held: Record<string, string[]>; waiting: string[] }> {
  const rows = (
    await obs.query(
      `select c.relname as rel, l.mode, l.granted from pg_locks l join pg_class c on c.oid = l.relation
       where l.pid = $1 and l.locktype = 'relation' and c.relname = any($2) order by 1, 2`,
      [pid, WATCHED],
    )
  ).rows as { rel: string; mode: string; granted: boolean }[];
  const held: Record<string, string[]> = {};
  for (const r of rows.filter((x) => x.granted)) (held[r.rel] ??= []).push(r.mode);
  return { held, waiting: rows.filter((x) => !x.granted).map((x) => `${x.rel} ${x.mode}`) };
}
const fmtLocks = (h: Record<string, string[]>) => Object.entries(h).map(([t, m]) => `${t}: ${m.join("+")}`).join("; ");
/** Poll until the backend waits on a heavyweight lock (a barrier: the test proceeds only once the wait is real). */
async function waitsOnLock(obs: Client, pid: number, timeoutMs = 15_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = (await obs.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid])).rows[0];
    if (r?.wait_event_type === "Lock") return true;
    await sleep(15);
  }
  return false;
}
type Probe = { label: string; ok: boolean; code?: string; ms: number };
/** One autocommit statement on its own connection with a lock timeout: did it run, or was it blocked? */
async function probe(c: Client, label: string, text: string, params: unknown[] = [], timeout = "1s"): Promise<Probe> {
  await c.query(`set lock_timeout = '${timeout}'`);
  const t0 = performance.now();
  try {
    await c.query(text, params);
    return { label, ok: true, ms: ms(t0) };
  } catch (e) {
    return { label, ok: false, code: sqlState(e), ms: ms(t0) };
  } finally {
    await c.query("reset lock_timeout").catch(() => undefined);
  }
}
const fmtProbe = (p: Probe) => `${p.label}: ${p.ok ? `ran in ${p.ms} ms` : `BLOCKED (${p.code} after ${p.ms} ms)`}`;

type TxnResult = { steps: Probe[]; blockedAt: string | null; totalMs: number };
/** A transaction made of labelled statements; rolled back at the end (measurement only — nothing is kept). */
async function txn(c: Client, statements: [string, string, unknown[]][], lockTimeout: string | null): Promise<TxnResult> {
  const out: Probe[] = [];
  const t0 = performance.now();
  let blockedAt: string | null = null;
  await c.query("begin isolation level read committed");
  if (lockTimeout) await c.query(`set local lock_timeout = '${lockTimeout}'`);
  for (const [label, text, params] of statements) {
    const s0 = performance.now();
    try {
      await c.query(text, params);
      out.push({ label, ok: true, ms: ms(s0) });
    } catch (e) {
      out.push({ label, ok: false, code: sqlState(e), ms: ms(s0) });
      blockedAt = label;
      break;
    }
  }
  await c.query("rollback").catch(() => undefined);
  return { steps: out, blockedAt, totalMs: ms(t0) };
}
const fmtTxn = (r: TxnResult) => r.steps.map((s) => `${s.label} ${s.ok ? `${s.ms} ms` : `BLOCKED ${s.code} after ${s.ms} ms`}`).join(" → ");
/** The customer sign-in's write transaction (src/app/(auth)/actions.ts completeSignIn), statement by statement. */
const signInStatements = (org: number, user: number): [string, string, unknown[]][] => [
  ["orgs FOR SHARE", `select id from orgs where id = $1 for share`, [org]],
  ["access read", `select o.id, tac.access_status from orgs o left join tenant_access_controls tac on tac.org_id = o.id where o.id = $1`, [org]],
  ["users FOR NO KEY UPDATE", `select org_id, is_active, mfa_recovery_codes from users where id = $1 for no key update`, [user]],
  ["UPDATE users.last_login_at", `update users set last_login_at = now() where id = $1`, [user]],
  ["INSERT sessions", `insert into sessions (org_id, user_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '30 days')`, [org, user, newTokenHash()]],
  ["INSERT security_events", `insert into security_events (org_id, user_id, email, type, severity) values ($1, $2, 'owner0@company-fixture.test', 'login.success', 'info')`, [org, user]],
];
/** The Platform Owner suspension's transaction (src/lib/platform/company-access-actions.ts), statement by statement. */
const suspensionStatements = (org: number, admin: string): [string, string, unknown[]][] => [
  ["TOTP step UPDATE platform_admins", `update platform_admins set mfa_last_totp_step = coalesce(mfa_last_totp_step, 0) + 1, updated_at = now() where id = $1`, [admin]],
  ["orgs FOR NO KEY UPDATE", `select id from orgs where id = $1 for no key update`, [org]],
  ["access row FOR UPDATE", `select access_status from tenant_access_controls where org_id = $1 for update`, [org]],
  [
    "upsert tenant_access_controls",
    `insert into tenant_access_controls (org_id, access_status, reason, changed_by_platform_admin_id, changed_at) values ($1, 'suspended', 'Fixture: lock measurement', $2, now())
     on conflict (org_id) do update set access_status = excluded.access_status, reason = excluded.reason, changed_by_platform_admin_id = excluded.changed_by_platform_admin_id, changed_at = excluded.changed_at, updated_at = now()`,
    [org, admin],
  ],
  ["revoke live sessions", `update sessions set revoked_at = now(), revoked_reason = 'org_suspended' where org_id = $1 and revoked_at is null and expires_at > now()`, [org]],
  ["INSERT platform_audit_events", `insert into platform_audit_events (actor_platform_admin_id, actor_label, action, entity_type, entity_id, org_id, reason, result) values ($2, 'Fictional Operator', 'company.access_suspended', 'organization', $3, $1, 'Fixture: lock measurement', 'success')`, [org, admin, String(org)]],
];

/** Reviewed DDL, read from the migration (so the shape cases follow the file). */
const SETTINGS_DDL = po02d1Ddl("CREATE TABLE %1$I.platform_settings");
const PACKAGES_DDL = [
  po02d1Ddl("CREATE TABLE %1$I.subscription_packages"),
  po02d1Ddl("CREATE UNIQUE INDEX subscription_packages_code_uq"),
  po02d1Ddl("CREATE UNIQUE INDEX subscription_packages_name_uq"),
  po02d1Ddl("CREATE UNIQUE INDEX subscription_packages_default_trial_uq"),
];
const VERSIONS_DDL = po02d1Ddl("CREATE TABLE %1$I.subscription_package_versions");
const OWNERS_DDL = po02d1Ddl("CREATE TABLE %1$I.tenant_primary_owners");
const OWNER_GUARD_DDL = po02d1Ddl("CREATE FUNCTION %1$I.tenant_primary_owner_guard()");
const SUBSCRIPTION_GUARD_DDL = po02d1Ddl("CREATE FUNCTION %1$I.tenant_subscription_guard()");
/** Replace `from` in a reviewed DDL; throws when the anchor is missing (a silent no-op would weaken the case). */
const edit = (ddl: string, from: string, to: string) => {
  if (!ddl.includes(from)) throw new Error(`DDL anchor not found: ${from}`);
  return ddl.split(from).join(to);
};
const STRICT_MODULES = `'strict $[*] ? (@.type() != "string")', '{}', true)`;
const LAX_MODULES = `'$[*] ? (@.type() != "string")')`; // the PO-02D0 proposal's text (defect D-10)

async function main(): Promise<void> {
  ok("test copies: the held-open variants differ from the reviewed files only by their final COMMIT", FOUNDATION_HELD !== FOUNDATION && ROLLBACK_HELD !== ROLLBACK && FOUNDATION_HELD.length === FOUNDATION.length - "COMMIT;\n".length && !!CIC_BUILD && !!CIC_ATTACH);
  ok("the reviewed DDL templates were read from the migration file (and the corrected strict module check is in it)", VERSIONS_DDL.includes(STRICT_MODULES) && SETTINGS_DDL.startsWith("CREATE TABLE public.platform_settings"));

  // ------------------------------------------------------------------------------------------------
  section("1. Execution safety: the guarded entry points refuse unsafe targets before any connection");
  {
    const cli = (script: string, url: string) => spawnSync("npx", ["tsx", "--conditions=react-server", script], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: url }, encoding: "utf8", timeout: 120_000 });
    const port = new URL(process.env.PLATFORM_TEST_ADMIN_DATABASE_URL ?? "postgres://x@127.0.0.1:1/x_test_only_x").port;
    for (const [label, url] of [
      ["a database name without _test_only_ (loopback)", `postgres://postgres@127.0.0.1:${port}/elite_erp`],
      ["a non-loopback host", "postgres://postgres@db.example.invalid:5432/po02d1_test_only_x"],
      ["no DATABASE_URL at all", ""],
    ] as const) {
      for (const script of ["scripts/platform/apply-platform-sql.ts", "scripts/platform/check-platform-db.ts"]) {
        const r = cli(script, url);
        ok(`${script.split("/").pop()} with ${label}: REFUSED, exit 2`, r.status === 2 && /REFUSED \[/.test(`${r.stdout}${r.stderr}`), `exit ${r.status}: ${`${r.stdout}${r.stderr}`.trim().split("\n").slice(-1)[0]?.slice(0, 160)}`);
      }
    }
  }

  // ------------------------------------------------------------------------------------------------
  section("2. Preconditions: refused without PO-02A or PO-01A, or with users columns out of order — nothing created");
  {
    const A = await newDb("po02d1_mig_pre_a");
    ok("A: 621f156 tenant shape + PO-01A only (no PO-02A)", (await pushPreCompanyTenantSchema(A.url)).ok);
    await applyPlatformMigration(A.url, [PLATFORM_SQL_PATH]);
    const a = await connect(A.url);
    const a0 = await digest(a);
    await rejects("without PO-02A: refused, naming the missing invitation and access columns", () => runPo02d1(a), (e) => /precondition failed: missing or different column\(s\): .*organization_invitations\.id uuid.*tenant_access_controls\.org_id integer/.test(String((e as Error).message)));
    ok("…nothing created (no table, function, trigger, users key, scratch schema or helper); catalog unchanged", noPo02d1(await po02d1Objects(a)) && (await digest(a)) === a0);
    await applyPlatformMigration(A.url, [PO02A_SQL_PATH]);
    await a.query(`drop function platform_reject_mutation() cascade`); // test-only: a database where PO-01A's function is gone
    const a1 = await digest(a);
    await rejects("without PO-01A's platform_reject_mutation(): refused", () => runPo02d1(a), (e) => /platform_reject_mutation\(\) \(PO01\) is missing/.test(String((e as Error).message)));
    ok("…nothing created; catalog unchanged", noPo02d1(await po02d1Objects(a)) && (await digest(a)) === a1);
    const B = await newDb("po02d1_mig_pre_b");
    const b = await connect(B.url);
    await b.query(`create table orgs (id serial primary key, name text not null)`);
    await b.query(`create table users (org_id integer not null references orgs (id), id serial primary key, role text not null default 'staff', is_active boolean not null default true)`);
    await b.query(`create table platform_admins (id uuid primary key default gen_random_uuid())`);
    await b.query(`create table platform_audit_events (id bigserial primary key, action text not null)`);
    await b.query(`create table organization_invitations (id uuid primary key default gen_random_uuid(), accepted_org_id integer)`);
    await b.query(`create table tenant_access_controls (org_id integer primary key)`);
    await b.query(`create function platform_reject_mutation() returns trigger language plpgsql as $$ begin raise exception 'append-only'; end $$`);
    const b0 = await digest(b);
    await rejects("users.org_id positioned before users.id: refused (the composite keys pair columns in table order)", () => runPo02d1(b), (e) => /users\.id is not positioned before users\.org_id/.test(String((e as Error).message)));
    ok("…nothing created; catalog unchanged", noPo02d1(await po02d1Objects(b)) && (await digest(b)) === b0);
  }

  // ------------------------------------------------------------------------------------------------
  section("3. First and repeated application on five database shapes (retry safety)");
  {
    // (1) the minimal eligible schema: only the base tables and columns PO-02D1 references, no rows.
    const M = await newDb("po02d1_mig_minimal");
    const m = await connect(M.url);
    for (const s of [
      `create table orgs (id serial primary key, name text not null)`,
      `create table users (id serial primary key, org_id integer not null references orgs (id) on delete cascade, email text not null, role text not null default 'staff', is_active boolean not null default true)`,
      `create table platform_admins (id uuid primary key default gen_random_uuid())`,
      `create table platform_audit_events (id bigserial primary key, actor_platform_admin_id uuid, actor_label text not null, action text not null, entity_type text not null, entity_id text not null, after_safe jsonb, result text not null)`,
      `create function platform_reject_mutation() returns trigger language plpgsql as $$ begin raise exception 'Table % is append-only; % is not permitted', TG_TABLE_NAME, TG_OP; end $$`,
      `create table organization_invitations (id uuid primary key default gen_random_uuid(), accepted_org_id integer references orgs (id))`,
      `create table tenant_access_controls (org_id integer primary key references orgs (id))`,
    ])
      await m.query(s);
    let s = await runPo02d1(m);
    ok(`(1) minimal eligible schema, empty: created ×${PO02D1_CREATED.length}`, same(s, PO02D1_CREATED), steps(s));
    const m1 = await digest(m);
    s = await runPo02d1(m);
    ok(`…second application: verified ×${PO02D1_VERIFIED.length}; catalog identical`, same(s, PO02D1_VERIFIED) && (await digest(m)) === m1, steps(s));
    ok("…the onboarding check passes; nothing left behind", (await checkOnboardingFoundation(m)).ok && allPo02d1(await po02d1Objects(m)));

    // (2)+(3) production-shaped (621f156) with fictional tenant rows, and PO-01A / PO-02A objects holding rows.
    const P = await preD1Db("po02d1_mig_prod", { platformRows: true });
    const tables = await allTables(P.c);
    const data0 = await tableChecksums(P.c, tables);
    const t0 = performance.now();
    s = await runPo02d1(P.c);
    const firstMs = ms(t0);
    ok(`(2)+(3) 621f156 shape + fictional tenant rows + PO-01A/PO-02A rows (an audit trail, a suspended company, a pending invitation): created ×${PO02D1_CREATED.length}`, same(s, PO02D1_CREATED), steps(s));
    info(`first application on this fixture database: ${firstMs} ms (one transaction, F1 created inside it)`);
    ok(`…the data of all ${tables.length} pre-existing tables is byte-identical (tenant rows, operator audit trail, the suspended company's access row, the pending invitation)`, diffChecksums(data0, await tableChecksums(P.c, tables)).length === 0, diffChecksums(data0, await tableChecksums(P.c, tables)).join(","));
    const p1 = await digest(P.c);
    for (const n of [2, 3]) {
      const t1 = performance.now();
      s = await runPo02d1(P.c);
      ok(`…application #${n}: verified ×${PO02D1_VERIFIED.length} in ${ms(t1)} ms; catalog and data identical`, same(s, PO02D1_VERIFIED) && (await digest(P.c)) === p1 && diffChecksums(data0, await tableChecksums(P.c, tables)).length === 0, steps(s));
    }
    const legacy = (await P.c.query(`select (select count(*) from tenant_access_controls)::int as tac, (select access_status from tenant_access_controls limit 1) as status, (select count(*) from organization_invitations where accepted_at is null and revoked_at is null)::int as pending`)).rows[0];
    ok("…the suspended company is still suspended, the other two legacy companies still have no access row (active), the invitation still pending", legacy.tac === 1 && legacy.status === "suspended" && legacy.pending === 1, JSON.stringify(legacy));

    // (4a) the branch schema pushed WITHOUT the onboarding module and F1 (what an environment built from the previous
    //      branch head looks like), then PO01 + PO02A, then PO02D1.
    const Q = await newDb("po02d1_mig_branch");
    ok("(4a) the pre-onboarding branch schema pushed", (await pushPreOnboardingSchema(Q.url)).ok);
    await applyPlatformMigration(Q.url, [PLATFORM_SQL_PATH, PO02A_SQL_PATH]);
    const q = await connect(Q.url);
    s = await runPo02d1(q);
    ok(`…PO02D1 on it: created ×${PO02D1_CREATED.length}`, same(s, PO02D1_CREATED), steps(s));
    s = await runPo02d1(q);
    ok("…and again: verified ×21", same(s, PO02D1_VERIFIED), steps(s));

    // (4b) the supported local Drizzle procedure: full push (onboarding module included) + every reviewed file.
    const t2 = performance.now();
    const D = await createPlatformTestDatabase("po02d1_mig_drizzle");
    created.push(D.name);
    info(`createPlatformTestDatabase (full push + PO01 + PO02A + PO02D1): ${ms(t2)} ms`);
    const d = await connect(D.url);
    ok("(4b) the supported local procedure (createPlatformTestDatabase) yields a database that passes the onboarding check", (await checkOnboardingFoundation(d)).ok);
    s = await runPo02d1(d);
    ok("(5) an already-migrated database: verified ×21 — nothing created or altered", same(s, PO02D1_VERIFIED), steps(s));
    const P2 = await newDb("po02d1_mig_drizzle_steps");
    ok("…on a second full push, before the platform SQL", pushSchema(P2.url, "full").ok);
    await applyPlatformMigration(P2.url, [PLATFORM_SQL_PATH, PO02A_SQL_PATH]);
    const p2 = await connect(P2.url);
    s = await runPo02d1(p2);
    const expectOnPush = [
      "F1 users_org_id_id_uq: verified",
      "fn subscription_package_version_guard: created",
      "fn tenant_primary_owner_guard: created",
      "fn tenant_subscription_guard: created",
      ...PO02D1_VERIFIED.filter((x) => /^F[2-8] /.test(x)),
      ...PO02D1_CREATED.filter((x) => x.startsWith("trigger ")),
    ];
    ok("…the reviewed SQL on a push-built database VERIFIES F1 and the seven tables push created, and creates the three functions and ten triggers push cannot", same(s, expectOnPush), steps(s));
  }

  // ------------------------------------------------------------------------------------------------
  section("4. A pre-existing object whose shape differs is refused — nothing applied, the object not altered");
  {
    const X = await preD1Db("po02d1_mig_shape", { fixtures: false });
    const d0 = await digest(X.c);
    const fullRollback = async () => {
      await X.c.query(ROLLBACK).catch(async (e) => {
        await X.c.query("ROLLBACK").catch(() => undefined);
        throw e;
      });
      await runPo02d1Statements(X.c, PO02D1_USERS_KEY_DROP_SQL_PATH);
      await X.c.query("reset lock_timeout");
    };
    const installAll = async () => {
      await runPo02d1(X.c);
    };
    type Case = { label: string; setup: () => Promise<void>; expect: "refused" | RegExp; code?: string; detail?: RegExp; teardown: () => Promise<void> };
    const q = (...sql: string[]) => async () => {
      for (const s of sql) await X.c.query(s);
    };
    const key = "alter table users add constraint users_org_id_id_uq unique (id, org_id)";
    const cases: Case[] = [
      { label: "platform_settings exactly as reviewed (positive control)", setup: q(SETTINGS_DDL), expect: /F2 platform_settings: verified/, teardown: fullRollback },
      { label: "platform_settings with DEFAULT 14 on default_trial_days (an assumed Trial length)", setup: q(edit(SETTINGS_DDL, "default_trial_days           integer     NOT NULL,", "default_trial_days           integer     NOT NULL DEFAULT 14,")), expect: "refused", code: "42P07", detail: /column 2 default_trial_days integer not null default=14/, teardown: q("drop table platform_settings") },
      { label: "platform_settings with an invite_only column", setup: q(SETTINGS_DDL, "alter table platform_settings add column invite_only boolean not null default true"), expect: "refused", code: "42P07", detail: /unexpected in public: column 11 invite_only boolean/, teardown: q("drop table platform_settings") },
      { label: "platform_settings whose grace-days CHECK allows 90", setup: q(edit(SETTINGS_DDL, "grace_days BETWEEN 0 AND 60", "grace_days BETWEEN 0 AND 90")), expect: "refused", code: "42P07", detail: /platform_settings_grace_days_chk/, teardown: q("drop table platform_settings") },
      { label: "a VIEW named platform_settings", setup: q("create view platform_settings as select 1::smallint as id"), expect: "refused", code: "42P07", detail: /relation kind=v/, teardown: q("drop view platform_settings") },
      { label: "subscription_packages without the one-default-Trial index", setup: q(PACKAGES_DDL[0], PACKAGES_DDL[1], PACKAGES_DDL[2]), expect: "refused", code: "42P07", detail: /missing in public: +index .*subscription_packages_default_trial_uq/, teardown: q("drop table subscription_packages") },
      { label: "subscription_package_versions with the PO-02D0 proposal's LAX module check (defect D-10: accepts nested lists)", setup: q(...PACKAGES_DDL, edit(VERSIONS_DDL, STRICT_MODULES, LAX_MODULES)), expect: "refused", code: "42P07", detail: /subscription_package_versions_modules_chk/, teardown: q("drop table subscription_package_versions", "drop table subscription_packages") },
      { label: "subscription_package_versions with numeric(12,2) prices", setup: q(...PACKAGES_DDL, edit(VERSIONS_DDL, "numeric(14,2)", "numeric(12,2)")), expect: "refused", code: "42P07", detail: /monthly_price numeric\((12|14),2\)/, teardown: q("drop table subscription_package_versions", "drop table subscription_packages") },
      { label: "tenant_primary_owners whose user foreign key is single-column (a cross-company owner possible)", setup: q(edit(OWNERS_DDL, "FOREIGN KEY (user_id, org_id) REFERENCES public.users (id, org_id)", "FOREIGN KEY (user_id) REFERENCES public.users (id)")), expect: "refused", code: "42P07", detail: /tenant_primary_owners_user_fk/, teardown: q("drop table tenant_primary_owners") },
      { label: "tenant_primary_owners with row-level security enabled", setup: q(key, OWNERS_DDL, "alter table tenant_primary_owners enable row level security"), expect: "refused", code: "42P07", detail: /rls=true/, teardown: q("drop table tenant_primary_owners", "alter table users drop constraint users_org_id_id_uq") },
      { label: "F1 exactly as reviewed: the UNIQUE (id, org_id) constraint (positive control)", setup: q(key), expect: /F1 users_org_id_id_uq: verified/, teardown: fullRollback },
      { label: "F1 as a bare valid index exactly as the runbook builds it (positive control)", setup: q(KEY_AS_RUNBOOK_BUILDS_IT), expect: /F1 users_org_id_id_uq: attached/, teardown: fullRollback },
      { label: "F1 as UNIQUE (org_id, id) — the other column order", setup: q("alter table users add constraint users_org_id_id_uq unique (org_id, id)"), expect: "refused", code: "42710", detail: /found: u UNIQUE \(org_id, id\)/, teardown: q("alter table users drop constraint users_org_id_id_uq") },
      { label: "F1 as a DEFERRABLE constraint", setup: q("alter table users add constraint users_org_id_id_uq unique (id, org_id) deferrable"), expect: "refused", code: "42710", detail: /DEFERRABLE \(deferrable t,/, teardown: q("alter table users drop constraint users_org_id_id_uq") },
      { label: "F1 as a bare index on (org_id, id)", setup: q("create unique index users_org_id_id_uq on users (org_id, id)"), expect: "refused", code: "42710", detail: /found: CREATE UNIQUE INDEX users_org_id_id_uq ON public\.users USING btree \(org_id, id\)/, teardown: q("drop index users_org_id_id_uq") },
      { label: "F1 as an INVALID index (an interrupted concurrent build)", setup: q(KEY_AS_RUNBOOK_BUILDS_IT, "update pg_index set indisvalid = false where indexrelid = 'users_org_id_id_uq'::regclass"), expect: "refused", code: "55000", teardown: q("drop index users_org_id_id_uq") },
      { label: "a TABLE squatting on the F1 name", setup: q("create table users_org_id_id_uq (x int)"), expect: "refused", code: "42710", detail: /is not an index \(relkind r\)/, teardown: q("drop table users_org_id_id_uq") },
      { label: "tenant_primary_owner_guard() with a weakened body (inactive owners accepted)", setup: q(edit(OWNER_GUARD_DDL, " AND u.is_active", "")), expect: "refused", code: "42723", teardown: q("drop function tenant_primary_owner_guard()") },
      { label: "tenant_subscription_guard() as SECURITY DEFINER", setup: q(SUBSCRIPTION_GUARD_DDL, "alter function tenant_subscription_guard() security definer"), expect: "refused", code: "42723", teardown: q("drop function tenant_subscription_guard()") },
      { label: "an overload tenant_primary_owner_guard(integer)", setup: q("create function tenant_primary_owner_guard(x integer) returns integer language sql as 'select 1'"), expect: "refused", code: "42723", detail: /overload/, teardown: q("drop function tenant_primary_owner_guard(integer)") },
      { label: "an installed foundation whose subscription_events_immutable trigger was DISABLED", setup: async () => { await installAll(); await X.c.query("alter table subscription_events disable trigger subscription_events_immutable"); }, expect: "refused", code: "42710", detail: /\[enabled D\]/, teardown: async () => { await X.c.query("alter table subscription_events enable trigger subscription_events_immutable"); await fullRollback(); } },
      { label: "an installed foundation whose owner guard was re-created for INSERT only", setup: async () => { await installAll(); await X.c.query("drop trigger tenant_primary_owners_guard on tenant_primary_owners; create trigger tenant_primary_owners_guard before insert on tenant_primary_owners for each row execute function tenant_primary_owner_guard()"); }, expect: "refused", code: "42710", detail: /BEFORE INSERT ON tenant_primary_owners/, teardown: fullRollback },
      { label: "an installed foundation with an EXTRA trigger on platform_settings", setup: async () => { await installAll(); await X.c.query("create function d1_test_only_noop() returns trigger language plpgsql as $$ begin return new; end $$; create trigger d1_test_only_extra before insert on platform_settings for each row execute function d1_test_only_noop()"); }, expect: "refused", code: "42710", detail: /platform_settings\.d1_test_only_extra/, teardown: async () => { await X.c.query("drop trigger d1_test_only_extra on platform_settings; drop function d1_test_only_noop()"); await fullRollback(); } },
    ];
    for (const k of cases) {
      await k.setup();
      const pre = await projectCatalog(X.c);
      if (k.expect instanceof RegExp) {
        let s: string[] = [];
        try {
          s = await runPo02d1(X.c);
        } catch (e) {
          ok(`${k.label}: accepted`, false, describeError(e));
        }
        if (s.length) ok(`${k.label}: accepted (${s.find((x) => k.expect instanceof RegExp && k.expect.test(x))}), everything else created`, s.some((x) => (k.expect as RegExp).test(x)) && s.length === PO02D1_CREATED.length && (await checkOnboardingFoundation(X.c)).ok, steps(s));
      } else {
        let err: unknown = null;
        try {
          await runPo02d1(X.c);
        } catch (e) {
          err = e;
        }
        const e = err as { code?: string; message?: string; detail?: string; hint?: string } | null;
        const text = `${e?.message ?? ""} ${e?.detail ?? ""}`;
        ok(`${k.label}: refused [${k.code}]`, !!e && e.code === k.code && /nothing was applied/.test(e.message ?? "") && (!k.detail || k.detail.test(text)), e ? `${e.code}: ${text}`.slice(0, 300) : "not refused");
        if (k.code === "55000") ok("…with the exact recovery step (DROP INDEX CONCURRENTLY, the runbook, then this file)", /DROP INDEX CONCURRENTLY public\.users_org_id_id_uq/.test(e?.hint ?? ""), e?.hint ?? "");
        const post = await projectCatalog(X.c);
        const changed = [...diffProjection(pre.platform, post.platform), ...diffProjection(pre.other, post.other)];
        ok("…nothing created and the pre-existing object left exactly as it was", changed.length === 0 && (await po02d1Objects(X.c)).scratch === false && (await po02d1Objects(X.c)).helpers === 0, changed.slice(0, 4).join(" | "));
      }
      await k.teardown();
      ok("…teardown restores the exact pre-PO-02D1 catalog", (await digest(X.c)) === d0);
    }
    ok(`after every refusal the same database migrates cleanly: created ×${PO02D1_CREATED.length}`, same(await runPo02d1(X.c), PO02D1_CREATED));
  }

  // ------------------------------------------------------------------------------------------------
  section("5. All-or-nothing under injected failure, and retry");
  {
    const F = await preD1Db("po02d1_mig_fail");
    const fx = F.fx as TenantFixture;
    const tables = await allTables(F.c);
    const d0 = await digest(F.c);
    const data0 = await tableChecksums(F.c, tables);
    const intact = async (label: string) => {
      ok(`${label}: no PO-02D1 object (F1 included), no scratch schema or helper; catalog and data exactly as before`, noPo02d1(await po02d1Objects(F.c)) && (await digest(F.c)) === d0 && diffChecksums(data0, await tableChecksums(F.c, tables)).length === 0);
    };
    const obs = await connect(F.url);
    const reader = await connect(F.url);
    // (a) lock timeout at F8, after F1–F7 were created in the same transaction: an in-flight writer holds ROW EXCLUSIVE on
    //     organization_invitations, which the F8 foreign key needs in SHARE ROW EXCLUSIVE.
    const writer = await connect(F.url);
    await writer.query(`begin; lock table organization_invitations in row exclusive mode`);
    const mig = await connect(F.url);
    const migPid = await pidOf(mig);
    const t0 = performance.now();
    const run = runPo02d1(mig).then(() => "applied", (e) => sqlState(e) ?? "error");
    ok("barrier: the migration is waiting for its lock on organization_invitations", await waitsOnLock(obs, migPid));
    const held = await locksOf(obs, migPid);
    info(`while it waits at F8 (plain path, F1 created earlier in the transaction) it holds: ${fmtLocks(held.held)}; waiting for: ${held.waiting.join(", ")}`);
    ok("…it already holds AccessExclusiveLock on users (from F1) and waits for ShareRowExclusiveLock on organization_invitations", (held.held.users ?? []).includes("AccessExclusiveLock") && held.waiting.includes("organization_invitations ShareRowExclusiveLock"));
    const blockedRead = await probe(reader, "a sign-in's read of users", `select id, org_id, is_active from users where id = $1`, [fx.users[0]]);
    info(`meanwhile — ${fmtProbe(blockedRead)}`);
    ok("…so on the plain path every read of users is blocked while the migration waits (bounded by its lock_timeout)", !blockedRead.ok && blockedRead.code === "55P03");
    const result = await run;
    const waited = ms(t0);
    ok(`…the migration gives up with 55P03 after lock_timeout (${waited} ms)`, result === "55P03" && waited >= 4_500);
    await writer.query("rollback");
    await intact("…F1–F7, created earlier in the transaction, were rolled back");
    // (b) lock timeout at F1: a long reader of users (ACCESS SHARE) blocks ADD CONSTRAINT's ACCESS EXCLUSIVE — and readers that
    //     arrive after the migration queue behind it.
    await reader.query(`begin; select count(*) from users`);
    const t1 = performance.now();
    const run2 = runPo02d1(mig).then(() => "applied", (e) => sqlState(e) ?? "error");
    ok("barrier: the migration is waiting for AccessExclusiveLock on users", await waitsOnLock(obs, migPid));
    const latecomer = await connect(F.url);
    const queued = await probe(latecomer, "a new read of users that arrives while F1 waits", `select count(*) from users`);
    info(`meanwhile — ${fmtProbe(queued)} (it queues behind the pending AccessExclusiveLock request)`);
    ok("…a read arriving after the migration queues behind it (55P03 at its own 1 s lock_timeout)", !queued.ok && queued.code === "55P03");
    const result2 = await run2;
    const waited2 = ms(t1);
    ok(`…the migration gives up with 55P03 after lock_timeout (${waited2} ms)`, result2 === "55P03" && waited2 >= 4_500);
    const after = await probe(latecomer, "the same read once the migration gave up", `select count(*) from users`);
    ok("…and reads proceed again immediately", after.ok, fmtProbe(after));
    await reader.query("commit");
    await intact("…nothing was applied");
    // (c) a conflict at the last DDL step: a TABLE squatting on F8's index name.
    await F.c.query(`create table organization_invitation_terms_version_idx (x int)`);
    await rejects("a name conflict at F8's index aborts the migration (42P07)", () => runPo02d1(F.c), (e) => sqlState(e) === "42P07" && /organization_invitation_terms_version_idx/.test(String((e as Error).message)));
    const o = await po02d1Objects(F.c);
    ok("…F1 and F2–F7 rolled back; the squatting table left exactly as it was", noPo02d1(o) && (await F.c.query(`select count(*)::int as n from organization_invitation_terms_version_idx`)).rows[0].n === 0);
    await F.c.query(`drop table organization_invitation_terms_version_idx`);
    await intact("…once the squatter is removed");
    // (d) the migration's backend is killed while it waits (a crash, a lost connection, an operator's pg_terminate_backend).
    await writer.query(`begin; lock table organization_invitations in row exclusive mode`);
    const doomed = await connect(F.url);
    const doomedPid = await pidOf(doomed);
    const run3 = runPo02d1(doomed).then(() => "applied", (e) => describeError(e));
    ok("barrier: the migration is waiting at F8", await waitsOnLock(obs, doomedPid));
    await obs.query(`select pg_terminate_backend($1)`, [doomedPid]);
    const killed = await run3;
    ok("pg_terminate_backend ends it (connection terminated)", killed !== "applied", killed.slice(0, 120));
    await writer.query("rollback");
    await intact("…the killed transaction left nothing behind (its session-temporary helpers went with it)");
    const retry = await connect(F.url);
    const s = await runPo02d1(retry);
    ok(`…and a retry on a new connection applies everything: created ×${PO02D1_CREATED.length}`, same(s, PO02D1_CREATED), steps(s));
    ok("…with every pre-existing table's data unchanged", diffChecksums(data0, await tableChecksums(F.c, tables)).length === 0);
  }

  // ------------------------------------------------------------------------------------------------
  section("6. MEASURED: customer sign-in, suspension, reads and writes while the foundation transaction is open");
  for (const path of ["plain", "verified"] as const) {
    const L = await preD1Db(`po02d1_mig_lock_${path}`);
    const fx = L.fx as TenantFixture;
    if (path === "verified") await runPo02d1Statements(L.c, PO02D1_USERS_KEY_CONCURRENT_SQL_PATH);
    const obs = await connect(L.url);
    const mig = await connect(L.url);
    const migPid = await pidOf(mig);
    const t0 = performance.now();
    await mig.query(FOUNDATION_HELD); // every statement but COMMIT: the transaction stays open, holding its locks
    info(`[${path}] the foundation's statements ran in ${ms(t0)} ms (${path === "plain" ? "F1 created inside the transaction" : "F1 built and attached beforehand by the concurrent runbook"}); COMMIT withheld`);
    const locks = await locksOf(obs, migPid);
    info(`[${path}] locks held until COMMIT: ${fmtLocks(locks.held)}`);
    const fkTargets = ["orgs", "platform_admins", "organization_invitations"];
    ok(`[${path}] orgs, platform_admins, organization_invitations: ShareRowExclusiveLock (the new foreign keys) and never AccessExclusiveLock (the scratch reference touches no existing table)`, fkTargets.every((t) => (locks.held[t] ?? []).includes("ShareRowExclusiveLock") && !(locks.held[t] ?? []).includes("AccessExclusiveLock")), fmtLocks(locks.held));
    if (path === "plain") ok("[plain] users: AccessExclusiveLock (F1's ADD CONSTRAINT builds the key inside the transaction)", (locks.held.users ?? []).includes("AccessExclusiveLock"), fmtLocks(locks.held));
    else ok("[verified] users: ShareRowExclusiveLock (the primary-owner foreign key) and no AccessExclusiveLock", (locks.held.users ?? []).includes("ShareRowExclusiveLock") && !(locks.held.users ?? []).includes("AccessExclusiveLock"), fmtLocks(locks.held));
    ok(`[${path}] no lock at all on sessions, tenant_access_controls, platform_audit_events, customers, security_events`, ["sessions", "tenant_access_controls", "platform_audit_events", "customers", "security_events"].every((t) => !locks.held[t]), fmtLocks(locks.held));
    const p = await connect(L.url);
    const probes = [
      await probe(p, "read users", `select count(*) from users`),
      await probe(p, "read orgs", `select count(*) from orgs`),
      await probe(p, "read customers", `select count(*) from customers`),
      await probe(p, "read sessions (session validation)", `select count(*) from sessions where revoked_at is null`),
      await probe(p, "INSERT customers (business write; its FK check takes KEY SHARE on orgs)", `insert into customers (org_id, name) values ($1, 'Fixture customer written during the migration')`, [fx.orgs[0]]),
      await probe(p, "INSERT users (registration / team invite)", `insert into users (org_id, email, password_hash, name, role) values ($1, 'new.member@company-fixture.test', 'x', 'New Member', 'staff')`, [fx.orgs[0]]),
      await probe(p, "UPDATE orgs (company settings)", `update orgs set name = name where id = $1`, [fx.orgs[0]]),
    ];
    for (const pr of probes) info(`[${path}] ${fmtProbe(pr)}`);
    const byLabel = Object.fromEntries(probes.map((x) => [x.label.split(" (")[0], x]));
    ok(`[${path}] reads of orgs, customers and sessions run; a business INSERT into customers runs`, byLabel["read orgs"].ok && byLabel["read customers"].ok && byLabel["read sessions"].ok && byLabel["INSERT customers"].ok);
    ok(`[${path}] reads of users ${path === "plain" ? "are BLOCKED" : "run"}; writes to users and orgs are BLOCKED until COMMIT`, byLabel["read users"].ok === (path === "verified") && !byLabel["INSERT users"].ok && !byLabel["UPDATE orgs"].ok);
    const signIn = await txn(p, signInStatements(fx.orgs[0], fx.users[0]), "1s");
    info(`[${path}] customer sign-in transaction: ${fmtTxn(signIn)}`);
    ok(`[${path}] a customer sign-in is blocked at ${path === "plain" ? "its first statement on users (users FOR NO KEY UPDATE)" : "UPDATE users.last_login_at (its row lock FOR NO KEY UPDATE is granted)"}`, signIn.blockedAt === (path === "plain" ? "users FOR NO KEY UPDATE" : "UPDATE users.last_login_at"));
    const suspension = await txn(p, suspensionStatements(fx.orgs[1], fx.admin), "1s");
    info(`[${path}] Platform Owner suspension transaction: ${fmtTxn(suspension)}`);
    ok(`[${path}] a Platform Owner suspension is blocked at its first statement (the TOTP step UPDATE on platform_admins)`, suspension.blockedAt === "TOTP step UPDATE platform_admins");
    // Wait behaviour without a lock timeout: the sign-in queues, and completes as soon as the migration commits.
    const waiter = await connect(L.url);
    const waiterPid = await pidOf(waiter);
    const queued = txn(waiter, signInStatements(fx.orgs[0], fx.users[0]), null);
    ok(`[${path}] barrier: a sign-in without a lock timeout is waiting`, await waitsOnLock(obs, waiterPid));
    const held = 400;
    await sleep(held);
    const c0 = performance.now();
    await mig.query("commit");
    const commitMs = ms(c0);
    const r = await queued;
    info(`[${path}] that sign-in waited, then completed ${r.totalMs} ms after it started (the migration was held open ${held} ms past the barrier; its COMMIT took ${commitMs} ms): ${fmtTxn(r)}`);
    ok(`[${path}] …it completes once the migration commits (a wait, not a failure)`, r.blockedAt === null && r.steps.length === 6 && r.totalMs >= held);
    ok(`[${path}] …and the database now passes the onboarding check`, (await checkOnboardingFoundation(L.c)).ok);
    const r0 = performance.now();
    await mig.query(FOUNDATION_HELD);
    const rerun = await locksOf(obs, migPid);
    info(`[${path}] a verify-only re-run's statements ran in ${ms(r0)} ms and hold: ${fmtLocks(rerun.held) || "no lock on any watched table"}`);
    ok(`[${path}] a verify-only re-run holds NO lock on any existing customer or platform table`, Object.keys(rerun.held).length === 0, fmtLocks(rerun.held));
    const rerunSignIn = await txn(p, signInStatements(fx.orgs[0], fx.users[0]), "1s");
    ok(`[${path}] …so a customer sign-in runs to completion during it`, rerunSignIn.blockedAt === null, fmtTxn(rerunSignIn));
    await mig.query("rollback");
  }

  // ------------------------------------------------------------------------------------------------
  section("7. MEASURED: the concurrent F1 runbook — writes continue during the build; the attach is brief but exclusive");
  {
    const K = await preD1Db("po02d1_mig_cic");
    const fx = K.fx as TenantFixture;
    const obs = await connect(K.url);
    const holder = await connect(K.url);
    const builder = await connect(K.url);
    const builderPid = await pidOf(builder);
    const p = await connect(K.url);
    await holder.query("begin");
    await holder.query(`update users set last_login_at = last_login_at where id = $1`, [fx.users[1]]); // an in-flight write transaction older than the build
    const t0 = performance.now();
    const build = builder.query(CIC_BUILD).then(() => "built", (e) => describeError(e));
    ok("barrier: CREATE UNIQUE INDEX CONCURRENTLY is waiting for the older transaction", await waitsOnLock(obs, builderPid));
    const bl = await locksOf(obs, builderPid);
    info(`during the concurrent build it holds: ${fmtLocks(bl.held)}`);
    ok("…holding only ShareUpdateExclusiveLock on users", same(bl.held.users ?? [], ["ShareUpdateExclusiveLock"]), fmtLocks(bl.held));
    const during = [
      await probe(p, "INSERT users (registration)", `insert into users (org_id, email, password_hash, name, role) values ($1, 'during.build@company-fixture.test', 'x', 'During Build', 'staff')`, [fx.orgs[0]]),
      await probe(p, "UPDATE users (sign-in last_login_at)", `update users set last_login_at = now() where id = $1`, [fx.users[2]]),
      await probe(p, "read users", `select count(*) from users`),
    ];
    for (const pr of during) info(`during the build — ${fmtProbe(pr)}`);
    ok("…user INSERTs, UPDATEs and reads all run meanwhile", during.every((x) => x.ok));
    const signIn = await txn(p, signInStatements(fx.orgs[0], fx.users[0]), "1s");
    info(`during the build — customer sign-in transaction: ${fmtTxn(signIn)}`);
    ok("…and a whole customer sign-in transaction completes", signIn.blockedAt === null);
    await sleep(300);
    await holder.query("commit");
    const built = await build;
    info(`the build finished ${ms(t0)} ms after it started (it waited ~300+ ms for the older write transaction to end)`);
    ok("…the build completes once the older transaction ends, leaving a valid index", built === "built" && (await K.c.query(`select indisvalid and indisready as v from pg_index where indexrelid = 'users_org_id_id_uq'::regclass`)).rows[0].v === true);
    // The attach: measure its lock inside an explicit transaction, then its duration in autocommit.
    const att = await connect(K.url);
    const attPid = await pidOf(att);
    await att.query(`begin; alter table public.users add constraint users_org_id_id_uq unique using index users_org_id_id_uq`);
    const al = await locksOf(obs, attPid);
    info(`ALTER TABLE users ADD CONSTRAINT ... UNIQUE USING INDEX holds: ${fmtLocks(al.held)}`);
    ok("the attach takes AccessExclusiveLock on users (catalog change only, no scan)", (al.held.users ?? []).includes("AccessExclusiveLock"), fmtLocks(al.held));
    const blocked = await probe(p, "read users while the attach is uncommitted", `select count(*) from users`);
    ok("…so even a read of users waits while it is held", !blocked.ok && blocked.code === "55P03", fmtProbe(blocked));
    await att.query("rollback");
    const a0 = performance.now();
    await att.query(CIC_ATTACH);
    info(`the attach in autocommit (runbook statement 5): ${ms(a0)} ms`);
    ok("…in autocommit it is a short catalog change", ms(a0) < 2_000 && (await K.c.query(`select count(*)::int as n from pg_constraint where conname = 'users_org_id_id_uq'`)).rows[0].n === 1);
    // The queueing effect, and why statement 5 carries lock_timeout 5 s.
    await K.c.query(`alter table users drop constraint users_org_id_id_uq`);
    await builder.query(CIC_BUILD);
    const longReader = await connect(K.url);
    await longReader.query(`begin; select count(*) from users`);
    const q0 = performance.now();
    const attach = att.query(CIC_ATTACH).then(() => "attached", (e) => sqlState(e) ?? "error");
    ok("barrier: the attach is waiting behind a long reader of users", await waitsOnLock(obs, attPid));
    const late = await probe(p, "a new read of users while the attach waits", `select count(*) from users`);
    info(`while the attach waits — ${fmtProbe(late)}`);
    ok("…new readers queue behind the waiting attach (55P03 at their own 1 s timeout)", !late.ok && late.code === "55P03");
    const outcome = await attach;
    info(`the attach gave up after ${ms(q0)} ms with ${outcome} (statement 5's lock_timeout 5 s bounds the queue)`);
    ok("…the attach gives up at its lock_timeout (55P03), so the queue lasts at most ~5 s", outcome === "55P03" && ms(q0) >= 4_500);
    ok("…leaving the valid index in place, unattached", (await K.c.query(`select count(*)::int as n from pg_constraint where conname = 'users_org_id_id_uq'`)).rows[0].n === 0 && (await K.c.query(`select indisvalid as v from pg_index where indexrelid = 'users_org_id_id_uq'::regclass`)).rows[0].v === true);
    await longReader.query("commit");
    await runPo02d1Statements(builder, PO02D1_USERS_KEY_CONCURRENT_SQL_PATH);
    ok("…and a re-run of the runbook attaches it (the build statement is a no-op)", (await K.c.query(`select count(*)::int as n from pg_constraint where conname = 'users_org_id_id_uq'`)).rows[0].n === 1);
    const s = await runPo02d1(K.c);
    ok("the foundation after the runbook: F1 verified, everything else created", s[0] === "F1 users_org_id_id_uq: verified" && s.slice(1).every((x) => x.endsWith("created")), steps(s));
    // An interrupted concurrent build leaves an INVALID index: refusal everywhere, the recovery, then success.
    const V = await preD1Db("po02d1_mig_invalid");
    const vfx = V.fx as TenantFixture;
    const vObs = await connect(V.url);
    const vHolder = await connect(V.url);
    const vBuilder = await connect(V.url);
    const vPid = await pidOf(vBuilder);
    await vHolder.query("begin");
    await vHolder.query(`update users set last_login_at = last_login_at where id = $1`, [vfx.users[1]]);
    const vBuild = vBuilder.query(CIC_BUILD).then(() => "built", (e) => sqlState(e) ?? "error");
    ok("barrier: a concurrent build is waiting", await waitsOnLock(vObs, vPid));
    await vObs.query(`select pg_cancel_backend($1)`, [vPid]);
    ok("pg_cancel_backend interrupts it (57014)", (await vBuild) === "57014");
    await vHolder.query("commit");
    const inv = (await V.c.query(`select indisvalid as v from pg_index where indexrelid = to_regclass('public.users_org_id_id_uq')`)).rows;
    ok("…leaving an INVALID users_org_id_id_uq behind (measured, not simulated)", inv.length === 1 && inv[0].v === false);
    await rejects("the runbook refuses to build over it, naming the recovery", () => runPo02d1Statements(vBuilder, PO02D1_USERS_KEY_CONCURRENT_SQL_PATH), (e) => /is INVALID \(an interrupted build\)/.test(String((e as Error).message)) && /DROP INDEX CONCURRENTLY public\.users_org_id_id_uq/.test(String((e as { hint?: string }).hint)));
    await vBuilder.query("reset lock_timeout; reset statement_timeout");
    await rejects("the foundation refuses too (55000), naming the recovery", () => runPo02d1(V.c), (e) => sqlState(e) === "55000" && /DROP INDEX CONCURRENTLY/.test(String((e as { hint?: string }).hint)));
    ok("…nothing was applied", (await po02d1Objects(V.c)).tables.length === 0);
    await vBuilder.query(`drop index concurrently public.users_org_id_id_uq`);
    await runPo02d1Statements(vBuilder, PO02D1_USERS_KEY_CONCURRENT_SQL_PATH);
    const s2 = await runPo02d1(V.c);
    ok("recovery: DROP INDEX CONCURRENTLY, the runbook, then the foundation — F1 verified, everything else created", s2[0] === "F1 users_org_id_id_uq: verified" && s2.length === PO02D1_CREATED.length && (await checkOnboardingFoundation(V.c)).ok, steps(s2));
  }

  // ------------------------------------------------------------------------------------------------
  section("8. MEASURED: row locks of the primary-owner guard and the composite foreign key (for PO-02D2/D3 writers)");
  {
    const G = await preD1Db("po02d1_mig_rowlocks");
    const fx = G.fx as TenantFixture;
    await runPo02d1(G.c);
    const owner = fx.users[0];
    const org = fx.orgs[0];
    const tx1 = await connect(G.url);
    const p = await connect(G.url);
    await tx1.query("begin");
    await tx1.query(`insert into tenant_primary_owners (user_id, org_id, assigned_by_platform_admin_id) values ($1, $2, $3)`, [owner, org, fx.admin]);
    const whileMapping = [
      await probe(p, "the owner's sign-in row lock (users FOR NO KEY UPDATE)", `select id from users where id = $1 for no key update`, [owner]),
      await probe(p, "the owner's UPDATE users.last_login_at", `update users set last_login_at = now() where id = $1`, [owner]),
      await probe(p, "a foreign-key check on the owner's row (FOR KEY SHARE)", `select id from users where id = $1 for key share`, [owner]),
      await probe(p, "a plain read of the owner's row", `select id, role from users where id = $1`, [owner]),
      await probe(p, "another user's sign-in row lock in the same company", `select id from users where id = $1 for no key update`, [fx.users[1]]),
    ];
    for (const pr of whileMapping) info(`while a primary-owner INSERT is uncommitted — ${fmtProbe(pr)}`);
    ok("the guard's FOR SHARE on the owner's users row blocks that owner's sign-in (row lock and last_login_at UPDATE) until it commits", !whileMapping[0].ok && !whileMapping[1].ok && whileMapping[0].code === "55P03");
    ok("…but not foreign-key checks, plain reads, or any other user's sign-in", whileMapping[2].ok && whileMapping[3].ok && whileMapping[4].ok);
    await tx1.query("rollback");
    await tx1.query("begin");
    await tx1.query(`select id from users where id = $1 for no key update`, [owner]); // a sign-in holding the owner's row
    const mapping = await probe(p, "a primary-owner INSERT while the owner signs in", `insert into tenant_primary_owners (user_id, org_id, assigned_by_platform_admin_id) values ($1, $2, $3)`, [owner, org, fx.admin]);
    info(`while the owner's sign-in holds FOR NO KEY UPDATE — ${fmtProbe(mapping)}`);
    ok("…and in the other direction a primary-owner INSERT waits for an in-flight sign-in of that owner (lock order for PO-02D3: never lock users before orgs)", !mapping.ok && mapping.code === "55P03");
    await tx1.query("rollback");
    ok("no primary-owner row was left behind", (await G.c.query(`select count(*)::int as n from tenant_primary_owners`)).rows[0].n === 0);
  }

  // ------------------------------------------------------------------------------------------------
  section("9. Rollback: its locks, a failure under a lock, both F1 cleanup paths, the data guard, audit evidence kept");
  {
    const R = await preD1Db("po02d1_mig_rollback", { platformRows: true });
    const fx = R.fx as TenantFixture;
    const tables = await allTables(R.c);
    const d0 = await digest(R.c);
    const data0 = await tableChecksums(R.c, tables);
    const audit0 = (await R.c.query(`select id from platform_audit_events order by id`)).rows.map((r) => String(r.id));
    await runPo02d1(R.c);
    const obs = await connect(R.url);
    // Locks of step 1 (held open).
    const rb = await connect(R.url);
    const rbPid = await pidOf(rb);
    const t0 = performance.now();
    await rb.query(ROLLBACK_HELD);
    info(`rollback step 1's statements ran in ${ms(t0)} ms; COMMIT withheld`);
    const rl = await locksOf(obs, rbPid);
    info(`rollback step 1 holds until COMMIT: ${fmtLocks(rl.held)}`);
    ok("rollback step 1 takes AccessExclusiveLock on users, orgs, platform_admins and organization_invitations (dropping the foreign keys removes their triggers there)", ["users", "orgs", "platform_admins", "organization_invitations"].every((t) => (rl.held[t] ?? []).includes("AccessExclusiveLock")), fmtLocks(rl.held));
    const p = await connect(R.url);
    const rp = await probe(p, "read users during rollback step 1", `select count(*) from users`);
    info(`during rollback step 1 — ${fmtProbe(rp)}`);
    ok("…so customer reads of users wait for the (short) rollback transaction", !rp.ok);
    await rb.query("rollback");
    ok("…(that held-open rollback was abandoned: every PO-02D1 object still present)", allPo02d1(await po02d1Objects(R.c)));
    // A failure under a lock: an in-flight writer on organization_invitations.
    const writer = await connect(R.url);
    await writer.query(`begin; lock table organization_invitations in row exclusive mode`);
    const t1 = performance.now();
    await rejects("rollback step 1 under a conflicting lock gives up with 55P03 at its lock_timeout", () => R.c.query(ROLLBACK).catch(async (e) => { await R.c.query("ROLLBACK").catch(() => undefined); throw e; }), (e) => sqlState(e) === "55P03");
    info(`rollback step 1 waited ${ms(t1)} ms before giving up`);
    await writer.query("rollback");
    const auditMid = (await R.c.query(`select count(*)::int as n from platform_audit_events`)).rows[0].n;
    ok("…nothing was dropped and no audit record was added (all-or-nothing)", allPo02d1(await po02d1Objects(R.c)) && auditMid === audit0.length);
    // Step 2 before step 1 is refused.
    await rejects("rollback step 2 before step 1 is refused while the primary-owner foreign key depends on F1", () => runPo02d1Statements(R.c, PO02D1_USERS_KEY_DROP_SQL_PATH), (e) => /F1 drop refused: .*tenant_primary_owners_user_fk/.test(String((e as Error).message)));
    await R.c.query("reset lock_timeout");
    ok("…nothing changed", allPo02d1(await po02d1Objects(R.c)));
    // The data guard: refused while any of the seven tables holds a row (each inside a transaction that is rolled back).
    const trialVersion = async () => {
      const pkg = (await R.c.query(`insert into subscription_packages (code, name, status, is_trial, is_default_trial) values ('fixture-trial', 'Fixture Trial (fictional)', 'active', true, true) returning id`)).rows[0].id;
      return (await R.c.query(`insert into subscription_package_versions (package_id, is_trial, version_number, publish_state, monthly_price, annual_price, included_seats, storage_allowance_gb, module_groups, trial_days, published_at) values ($1, true, 1, 'published', 0, 0, 3, 1, '["Fixture Module"]', 7, now()) returning id`, [pkg])).rows[0].id as string;
    };
    const subscription = async () =>
      (await R.c.query(`insert into tenant_subscriptions (org_id, package_version_id, is_trial, cycle, lifecycle_state, start_date, end_date, price_snapshot_sar, seats_snapshot, storage_snapshot_gb, module_groups_snapshot, assignment_source) values ($1, $2, true, 'trial', 'trialing', '2026-11-01', '2026-11-07', 0, 3, 1, '["Fixture Module"]', 'invitation_acceptance') returning id`, [fx.orgs[1], await trialVersion()])).rows[0].id as string;
    const dataCases: [string, () => Promise<unknown>][] = [
      ["platform_settings", () => R.c.query(`insert into platform_settings (default_trial_days) values (7)`)],
      ["subscription_packages", () => R.c.query(`insert into subscription_packages (code, name, created_by_platform_admin_id) values ('fixture-paid', 'Fixture Paid (fictional)', $1)`, [fx.admin])],
      ["subscription_package_versions", () => trialVersion()],
      ["tenant_primary_owners", () => R.c.query(`insert into tenant_primary_owners (user_id, org_id) values ($1, $2)`, [fx.users[0], fx.orgs[0]])],
      ["tenant_subscriptions", () => subscription()],
      ["subscription_events", async () => R.c.query(`insert into subscription_events (tenant_subscription_id, org_id, event_type, actor_label) values ($1, $2, 'assigned', 'invitee')`, [await subscription(), fx.orgs[1]])],
      [
        "organization_invitation_terms",
        async () => {
          const inv = (await R.c.query(`insert into organization_invitations (company_name, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash, invited_by_platform_admin_id) values ('Terms Fixture Co', 'hello@terms-rb.fixture.test', 'Saudi Arabia', 'SAR', 'Terms Owner', 'terms.rb@fixture.test', $1, $2) returning id`, [newTokenHash(), fx.admin])).rows[0].id;
          return R.c.query(`insert into organization_invitation_terms (invitation_id, initial_package_version_id, initial_is_trial, initial_cycle) values ($1, $2, true, 'trial')`, [inv, await trialVersion()]);
        },
      ],
    ];
    for (const [table, insert] of dataCases) {
      await R.c.query("begin");
      await insert();
      let err: unknown = null;
      try {
        await R.c.query(ROLLBACK); // inside the test's transaction: its BEGIN only warns; the guard raises before anything is dropped
      } catch (e) {
        err = e;
      }
      await R.c.query("rollback").catch(() => undefined);
      ok(`rollback refused while ${table} holds a row (P0001, the table named)`, sqlState(err) === "P0001" && new RegExp(`rollback refused: ${table} holds 1 row\\(s\\); nothing was changed`).test(String((err as Error)?.message)), describeError(err));
    }
    ok("…after every refusal: all PO-02D1 objects present, no audit record added, the fictional rows gone with their transactions", allPo02d1(await po02d1Objects(R.c)) && (await R.c.query(`select count(*)::int as n from platform_audit_events`)).rows[0].n === audit0.length && Object.values((await checkOnboardingFoundation(R.c)).rowCounts).every((n) => n === 0));
    // The regular path: step 1, then step 2 (constraint path).
    const s1 = performance.now();
    await R.c.query(ROLLBACK);
    info(`rollback step 1 (autocommit file, one transaction): ${ms(s1)} ms`);
    let o = await po02d1Objects(R.c);
    ok("step 1: the seven tables, ten triggers and three functions are gone; F1 is kept", o.tables.length === 0 && o.functions.length === 0 && o.triggers.length === 0 && o.usersKey && o.usersIndex);
    await R.c.query(ROLLBACK);
    ok("…step 1 again: a no-op that adds no audit record", (await R.c.query(`select count(*)::int as n from platform_audit_events where action = 'schema.onboarding_foundation_removed'`)).rows[0].n === 1);
    await rb.query(`begin; alter table public.users drop constraint users_org_id_id_uq`);
    const dl = await locksOf(obs, rbPid);
    info(`ALTER TABLE users DROP CONSTRAINT users_org_id_id_uq (rollback step 2, statement 3) holds: ${fmtLocks(dl.held)}`);
    ok("rollback step 2's DROP CONSTRAINT takes AccessExclusiveLock on users (brief: catalog change and index drop, no scan; bounded by lock_timeout 5 s)", (dl.held.users ?? []).includes("AccessExclusiveLock"), fmtLocks(dl.held));
    await rb.query("rollback");
    const s2 = performance.now();
    await runPo02d1Statements(R.c, PO02D1_USERS_KEY_DROP_SQL_PATH);
    info(`rollback step 2 (constraint path): ${ms(s2)} ms`);
    o = await po02d1Objects(R.c);
    ok("step 2: F1 removed with ALTER TABLE ... DROP CONSTRAINT (its index with it)", noPo02d1(o));
    await runPo02d1Statements(R.c, PO02D1_USERS_KEY_DROP_SQL_PATH);
    await R.c.query("reset lock_timeout");
    const evidence = (await R.c.query(`select action, after_safe->>'removed' as removed from platform_audit_events where entity_type = 'schema' and entity_id = 'PO02D1' order by id`)).rows;
    ok("…step 2 again: a no-op; the audit trail gained exactly two records (step 1, step 2 — constraint and index)", evidence.length === 2 && evidence[0].action === "schema.onboarding_foundation_removed" && evidence[1].action === "schema.users_key_removed" && /constraint and index/.test(evidence[1].removed), JSON.stringify(evidence));
    const auditNow = (await R.c.query(`select id from platform_audit_events order by id`)).rows.map((r) => String(r.id));
    ok("…no audit record was deleted (every earlier record still present)", audit0.every((id) => auditNow.includes(id)));
    ok("the exact pre-PO-02D1 catalog is restored (digest equal)", (await digest(R.c)) === d0);
    ok("…and every pre-existing table's data is unchanged except the two added audit records", diffChecksums(data0, await tableChecksums(R.c, tables)).every((t) => t === "platform_audit_events"));
    ok(`re-applying after a full rollback: created ×${PO02D1_CREATED.length}`, same(await runPo02d1(R.c), PO02D1_CREATED));
    // The concurrent-index cleanup path: a bare index from the runbook (never attached), no PO-02D1 table.
    const B = await preD1Db("po02d1_mig_rb_bare");
    const b0 = await digest(B.c);
    await B.c.query(CIC_BUILD);
    await runPo02d1Statements(B.c, PO02D1_USERS_KEY_DROP_SQL_PATH);
    const bareEvidence = (await B.c.query(`select after_safe->>'removed' as removed from platform_audit_events where action = 'schema.users_key_removed'`)).rows;
    ok("step 2 on a bare runbook index: removed with DROP INDEX CONCURRENTLY; one audit record says so; catalog restored", noPo02d1(await po02d1Objects(B.c)) && bareEvidence.length === 1 && /bare index, dropped concurrently/.test(bareEvidence[0].removed) && (await digest(B.c)) === b0, JSON.stringify(bareEvidence));
    await B.c.query("reset lock_timeout");
    await B.c.query(KEY_AS_RUNBOOK_BUILDS_IT);
    await B.c.query(`update pg_index set indisvalid = false where indexrelid = 'users_org_id_id_uq'::regclass`);
    await runPo02d1Statements(B.c, PO02D1_USERS_KEY_DROP_SQL_PATH);
    ok("step 2 on an INVALID leftover: removed concurrently too; catalog restored", noPo02d1(await po02d1Objects(B.c)) && (await digest(B.c)) === b0);
  }

  // ------------------------------------------------------------------------------------------------
  section("10. drizzle-kit push before and after the reviewed SQL");
  {
    // After: the supported order. Push issues nothing for PO-02D1 and changes nothing.
    const A = await preD1Db("po02d1_mig_push_after");
    await runPo02d1(A.c);
    const before = await projectCatalog(A.c);
    const push = pushSchema(A.url, "full", { verbose: true });
    const statements = push.output.split("\n").map((l) => l.trim()).filter((l) => /^(CREATE|ALTER|DROP)\s/i.test(l));
    const touching = statements.filter((l) => /platform_settings|subscription_packages|subscription_package_versions|tenant_primary_owners|tenant_subscriptions|subscription_events|organization_invitation_terms|users_org_id_id_uq|tenant_access_controls|organization_invitations|"platform_/.test(l));
    ok("AFTER the reviewed SQL: push succeeds and issues no statement for any PO-02D1, PO-02A or PO-01A object", push.ok && touching.length === 0, touching.slice(0, 3).join(" | "));
    const fkLong = statements.filter((l) => /^ALTER TABLE "([a-z_]+)" (DROP|ADD) CONSTRAINT "([a-z0-9_]{60,})"/.test(l));
    ok(`…its only statements re-create the pre-existing long-named customer foreign keys (${statements.length}, a known no-op)`, statements.length === fkLong.length);
    const after = await projectCatalog(A.c);
    const changed = [...diffProjection(before.platform, after.platform), ...diffProjection(before.other, after.other)];
    ok("…and the catalog is unchanged afterwards: no D1 constraint, index or trigger dropped, replaced or weakened", changed.length === 0 && (await checkOnboardingFoundation(A.c)).ok, changed.slice(0, 3).join(" | "));
    // Before, with customer users present: drizzle-kit asks whether to TRUNCATE users; without a terminal it aborts first.
    const H = await preD1Db("po02d1_mig_push_before_rows");
    const hTables = await allTables(H.c);
    const hData = await tableChecksums(H.c, hTables);
    const h0 = await digest(H.c);
    const hp = pushSchema(H.url, "full", { verbose: true });
    const prompt = /You're about to add [\s\S]*?users_org_id_id_uq[\s\S]*? unique constraint to the table, which contains \d+ items[\s\S]*?truncate [\s\S]*?users[\s\S]*? table/.test(hp.output);
    info(`BEFORE the reviewed SQL, users holding rows: push ok=${hp.ok}; truncate prompt shown=${prompt}; non-interactive → ${/Interactive prompts require a TTY/.test(hp.output) ? "aborted at the prompt" : "?"}`);
    ok("HAZARD: BEFORE the reviewed SQL, on a database whose users table has rows, push stops at drizzle-kit's prompt to TRUNCATE users (F1 is a new unique constraint)", !hp.ok && prompt);
    ok("…without a terminal it aborts before executing anything: catalog and data unchanged", (await digest(H.c)) === h0 && diffChecksums(hData, await tableChecksums(H.c, hTables)).length === 0 && noPo02d1(await po02d1Objects(H.c)));
    ok(`…and the reviewed SQL then applies cleanly: created ×${PO02D1_CREATED.length}`, same(await runPo02d1(H.c), PO02D1_CREATED));
    // Before, with users empty: push runs, adds the composite foreign key BEFORE the users key, fails (42830) half-way.
    const E = await preD1Db("po02d1_mig_push_before_empty", { fixtures: false });
    const ep = pushSchema(E.url, "full", { verbose: true });
    const eObjects = await po02d1Objects(E.c);
    const eReport = await checkOnboardingFoundation(E.c);
    info(`BEFORE the reviewed SQL, users empty: push ok=${ep.ok}; 42830=${/42830|no unique constraint matching given keys for referenced table "users"/.test(ep.output)}; left behind: ${eObjects.tables.length} tables, ${eObjects.triggers.length} triggers, users key ${eObjects.usersKey}`);
    ok("HAZARD: BEFORE the reviewed SQL, on an empty users table, push fails half-way (42830: the composite foreign key is added before the users key) — it is not atomic", !ep.ok && /no unique constraint matching given keys for referenced table "users"/.test(ep.output) && eObjects.tables.length === ONBOARDING_TABLES.length && !eObjects.usersKey && eObjects.triggers.length === 0);
    ok("…the half-built tables have no triggers and no users key: platform:db:check reports it (fail closed)", !eReport.ok && eReport.findings.some((f) => /missing users key/.test(f)) && eReport.findings.some((f) => /missing trigger/.test(f)));
    await rejects("…the reviewed SQL refuses the half-built tables (42P07, nothing applied)", () => runPo02d1(E.c), (e) => sqlState(e) === "42P07" && /nothing was applied/.test(String((e as Error).message)));
    await E.c.query(ROLLBACK);
    const es = await runPo02d1(E.c);
    ok("…RECOVERY: rollback step 1 drops the empty half-built tables, then the reviewed SQL creates everything (×21) and the check passes", same(es, PO02D1_CREATED) && (await checkOnboardingFoundation(E.c)).ok, steps(es));
  }

  // ------------------------------------------------------------------------------------------------
  section("11. The existing migration gate still refuses (db:preflight) — the production migration path stays disabled");
  {
    const D = await preD1Db("po02d1_mig_preflight");
    await runPo02d1(D.c);
    const res = spawnSync("npm", ["run", "-s", "db:preflight"], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: D.url }, encoding: "utf8", timeout: 300_000 });
    const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    const stateLine = out.split("\n").find((l) => l.startsWith("STATE:")) ?? "(no STATE line)";
    info(`db:preflight on a PO-02D1-migrated database: exit ${res.status}, ${stateLine}`);
    ok("db:preflight does not authorize `drizzle-kit migrate` on it (INCONSISTENT, exit 20) — D-6 unchanged", res.status === 20, stateLine);
  }
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-onboarding-migration-safety");
} catch (e) {
  console.error(`verify:platform-onboarding-migration-safety aborted: ${describeError(e)}`);
  exitCode = 1;
} finally {
  for (const c of clients) await c.end().catch(() => undefined);
  if (!keep) for (const name of created) await dropDisposableDatabase(name).catch(() => undefined);
}
process.exit(exitCode);
