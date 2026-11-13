/**
 * Platform Owner PO-02A — migration safety of drizzle/platform/PO02A_company_foundation.sql and its
 * companions (PO02A_m4_sessions_index_concurrently.sql, PO02A_rollback.sql).
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *     npm run verify:platform-migration-safety
 *
 * Proves: preconditions; first / second / third application; acceptance of identical objects
 * created by db:push; all-or-nothing rollback under injected failures (a lock timeout mid-way, a
 * conflicting object at the last step); refusal of every pre-existing object whose shape differs
 * (without altering it); the concurrent-index runbook (incl. an INVALID leftover); the lock modes
 * of both index strategies; the guarded rollback script (exact restoration of the pre-PO-02A
 * catalog); what a later `drizzle-kit push` does; and that `db:preflight` still refuses.
 * Disposable loopback `*_test_only_*` databases only; fictional data; all dropped at the end.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Client } from "pg";
import {
  connectDisposable,
  createDisposableDatabase,
  disposableName,
  dropDisposableDatabase,
  pushSchema,
  pushPreCompanyTenantSchema,
  applyPlatformMigration,
} from "../scripts/platform/disposable-db";
import {
  projectCatalog,
  projectionDigest,
  diffProjection,
  PLATFORM_SQL_PATH,
  PO02A_SQL_PATH,
  PO02A_M4_CONCURRENT_SQL_PATH,
  PO02A_ROLLBACK_SQL_PATH,
} from "../scripts/platform/catalog";
import { section, ok, rejects, sqlState, summary, describeError } from "./platform/harness";
import { insertFixtures, tableChecksums, diffChecksums, runPo02a, runStatements, po02aObjects, newTokenHash } from "./platform/po02a-fixtures";

const created: string[] = [];
const clients: Client[] = [];
const keep = process.env.PLATFORM_TEST_KEEP_DATABASES === "1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
/** A pre-PO-02A database (621f156 tenant shape + PO-01A), optionally with fictional tenant data. */
async function legacyDb(prefix: string, fixtures = true): Promise<{ url: string; c: Client }> {
  const db = await newDb(prefix);
  const push = await pushPreCompanyTenantSchema(db.url);
  if (!push.ok) throw new Error(`push failed: ${push.output.slice(-400)}`);
  await applyPlatformMigration(db.url, [PLATFORM_SQL_PATH]);
  const c = await connect(db.url);
  if (fixtures) await insertFixtures(c);
  return { url: db.url, c };
}
const fullDigest = async (c: Client) => {
  const p = await projectCatalog(c);
  return projectionDigest(p.platform) + projectionDigest(p.other);
};
const allTables = async (c: Client) => {
  const p = await projectCatalog(c);
  return [...p.platform.tables, ...p.other.tables];
};
const CREATED = ["M2 tenant_access_controls: created", "M3 organization_invitations: created", "M4 sessions_org_active_idx: created", "audit platform_audit_events_entity_idx: created"];
const VERIFIED = CREATED.map((s) => s.replace(/created$/, "verified"));
const none = (o: { tables: string[]; indexes: string[]; scratch: boolean }) => o.tables.length === 0 && o.indexes.length === 0 && !o.scratch;

/** The reviewed DDL templates, read from the migration itself (so the tests follow the file). */
const SQL_TEXT = readFileSync(PO02A_SQL_PATH, "utf8");
const ddl = (needle: string) => {
  const m = SQL_TEXT.split("$ddl$").find((part) => part.startsWith(needle));
  if (!m) throw new Error(`DDL starting with "${needle}" not found in ${PO02A_SQL_PATH}`);
  return m.replace(/%1\$I/g, "public");
};
const TAC_DDL = ddl("CREATE TABLE %1$I.tenant_access_controls");
const INV_DDL = ddl("CREATE TABLE %1$I.organization_invitations");
const INV_INDEXES = ["CREATE UNIQUE INDEX organization_invitations_token_hash_uq", "CREATE UNIQUE INDEX organization_invitations_accepted_org_uq", "CREATE UNIQUE INDEX organization_invitations_pending_email_uq", "CREATE INDEX organization_invitations_pending_expiry_idx"].map(ddl);

async function main(): Promise<void> {
  section("1. Preconditions: refused without PO-01A, nothing created");
  {
    const { c } = await legacyDb("po02a_mig_pre", false).then(async (x) => {
      // undo PO-01A on this one database: a pre-PO-01A target
      await x.c.query(`drop table platform_audit_events, platform_login_attempts, platform_sessions, platform_admins; drop function platform_reject_mutation()`);
      return x;
    });
    const before = await fullDigest(c);
    await rejects("without PO-01A the migration refuses (precondition names the missing objects)", () => runPo02a(c), (e) => /precondition failed: missing or different column\(s\): .*platform_admins\.id uuid/.test(String((e as Error).message)));
    ok("…and nothing was created (no table, index or scratch schema; catalog unchanged)", none(await po02aObjects(c)) && (await fullDigest(c)) === before);
  }

  section("2. First, second and third application on a populated pre-PO-02A database");
  const M = await legacyDb("po02a_mig_apply");
  {
    const tables = await allTables(M.c);
    const data0 = await tableChecksums(M.c, tables);
    ok("first application: created ×4", JSON.stringify(await runPo02a(M.c)) === JSON.stringify(CREATED));
    const d1 = await fullDigest(M.c);
    const data1 = await tableChecksums(M.c, tables);
    ok("…every pre-existing table's data unchanged", diffChecksums(data0, data1).length === 0, diffChecksums(data0, data1).join(","));
    ok("second application: verified ×4 (nothing created or altered)", JSON.stringify(await runPo02a(M.c)) === JSON.stringify(VERIFIED));
    ok("…full catalog digest identical after the second application", (await fullDigest(M.c)) === d1);
    ok("third application: verified ×4, digest identical", JSON.stringify(await runPo02a(M.c)) === JSON.stringify(VERIFIED) && (await fullDigest(M.c)) === d1);
    ok("…data still identical after three applications", diffChecksums(data0, await tableChecksums(M.c, tables)).length === 0);
    ok("no scratch schema or helper function is left behind", !(await po02aObjects(M.c)).scratch && (await M.c.query(`select count(*)::int as n from pg_proc where proname like 'po02a%'`)).rows[0].n === 0);
  }

  section("3. Objects created by `drizzle-kit push` (the current way environments are built) are accepted, not duplicated");
  {
    const P = await newDb("po02a_mig_push");
    ok("full push", pushSchema(P.url, "full").ok);
    await applyPlatformMigration(P.url, [PLATFORM_SQL_PATH]);
    const c = await connect(P.url);
    const d0 = await fullDigest(c);
    ok("PO-02A on a push-built database: verified ×4", JSON.stringify(await runPo02a(c)) === JSON.stringify(VERIFIED));
    ok("…catalog unchanged", (await fullDigest(c)) === d0);
  }

  section("4. All-or-nothing under injected failure");
  {
    const F = await legacyDb("po02a_mig_fail");
    const tables = await allTables(F.c);
    const d0 = await fullDigest(F.c);
    const data0 = await tableChecksums(F.c, tables);
    // (a) mid-way: an in-flight writer holds ROW EXCLUSIVE on sessions, so M4's CREATE INDEX (SHARE) cannot
    // get its lock; lock_timeout (5 s) fires AFTER M2 and M3 were created inside the transaction.
    const writer = await connect(F.url);
    await writer.query(`begin; lock table sessions in row exclusive mode`);
    const t0 = Date.now();
    await rejects("a lock timeout at M4 aborts the migration (55P03)", () => runPo02a(F.c), (e) => sqlState(e) === "55P03");
    ok(`…after waiting about lock_timeout (${Date.now() - t0} ms)`, Date.now() - t0 >= 4_500);
    await writer.query("rollback");
    ok("…M2 and M3, created earlier in the same transaction, were rolled back too; no scratch schema", none(await po02aObjects(F.c)));
    ok("…catalog and data exactly as before", (await fullDigest(F.c)) === d0 && diffChecksums(data0, await tableChecksums(F.c, tables)).length === 0);
    // (b) at the very last step: a TABLE squatting on the audit index name.
    await F.c.query(`create table platform_audit_events_entity_idx (x int)`);
    await rejects("a conflicting object at the last step aborts the migration (42710)", () => runPo02a(F.c), (e) => sqlState(e) === "42710" && /platform_audit_events_entity_idx/.test(String((e as Error).message)));
    const o = await po02aObjects(F.c);
    ok("…M2, M3 and M4 rolled back; the squatting table left exactly as it was", o.tables.length === 0 && o.indexes.length === 0 && !o.scratch && (await F.c.query(`select count(*)::int as n from platform_audit_events_entity_idx`)).rows[0].n === 0);
    await F.c.query(`drop table platform_audit_events_entity_idx`);
    ok("…catalog back to the exact pre-PO-02A digest once the squatter is removed", (await fullDigest(F.c)) === d0);
    ok("the same database then migrates cleanly: created ×4", JSON.stringify(await runPo02a(F.c)) === JSON.stringify(CREATED));
  }

  section("5. A pre-existing object whose shape differs is refused — nothing applied, the object not altered");
  {
    const X = await legacyDb("po02a_mig_shape", false);
    const d0 = await fullDigest(X.c);
    type Case = { label: string; setup: string[]; expect: "refused" | "accepted"; code?: string; detail?: RegExp; teardown: string[] };
    const cases: Case[] = [
      { label: "tenant_access_controls exactly as reviewed (positive control)", setup: [TAC_DDL], expect: "accepted", teardown: ["drop table if exists tenant_access_controls"] },
      { label: "tenant_access_controls.org_id bigint", setup: [TAC_DDL.replace("org_id                       integer     NOT NULL", "org_id                       bigint      NOT NULL")], expect: "refused", code: "42P07", detail: /column 1 org_id (integer|bigint)/, teardown: ["drop table tenant_access_controls"] },
      { label: "tenant_access_controls without updated_at", setup: [TAC_DDL.replace(/\n  updated_at[^\n]*/, "").replace(/,\n  CONSTRAINT tenant_access_controls_timestamps_chk[^\n]*/, "")], expect: "refused", code: "42P07", detail: /missing in public: +column 7 updated_at/, teardown: ["drop table tenant_access_controls"] },
      { label: "tenant_access_controls whose status CHECK also allows 'paused'", setup: [TAC_DDL.replace("IN ('active', 'suspended')", "IN ('active', 'suspended', 'paused')")], expect: "refused", code: "42P07", detail: /tenant_access_controls_status_chk/, teardown: ["drop table tenant_access_controls"] },
      { label: "tenant_access_controls with an extra column", setup: [TAC_DDL, "alter table tenant_access_controls add column notes text"], expect: "refused", code: "42P07", detail: /unexpected in public: +column 8 notes/, teardown: ["drop table tenant_access_controls"] },
      { label: "tenant_access_controls without the changed-by foreign key", setup: [TAC_DDL.replace(/\n  CONSTRAINT tenant_access_controls_changed_by_fk[^\n]*/, "")], expect: "refused", code: "42P07", detail: /tenant_access_controls_changed_by_fk/, teardown: ["drop table tenant_access_controls"] },
      { label: "tenant_access_controls with an extra trigger", setup: [TAC_DDL, "create function po02a_test_only_noop() returns trigger language plpgsql as $$ begin return new; end $$", "create trigger po02a_test_only_extra before update on tenant_access_controls for each row execute function po02a_test_only_noop()"], expect: "refused", code: "42P07", detail: /trigger po02a_test_only_extra/, teardown: ["drop table tenant_access_controls", "drop function po02a_test_only_noop()"] },
      { label: "tenant_access_controls with row-level security enabled", setup: [TAC_DDL, "alter table tenant_access_controls enable row level security"], expect: "refused", code: "42P07", detail: /rls=true/, teardown: ["drop table tenant_access_controls"] },
      { label: "a VIEW named tenant_access_controls", setup: ["create view tenant_access_controls as select id as org_id, 'active'::text as access_status from orgs"], expect: "refused", code: "42P07", detail: /relation kind=v/, teardown: ["drop view tenant_access_controls"] },
      { label: "organization_invitations without its pending-email unique index", setup: [INV_DDL, INV_INDEXES[0], INV_INDEXES[1], INV_INDEXES[3]], expect: "refused", code: "42P07", detail: /missing in public: +index .*organization_invitations_pending_email_uq/, teardown: ["drop table organization_invitations"] },
      { label: "organization_invitations whose pending-email index lost its WHERE (a global unique e-mail)", setup: [INV_DDL, INV_INDEXES[0], INV_INDEXES[1], INV_INDEXES[2].replace(/ WHERE .*$/, ""), INV_INDEXES[3]], expect: "refused", code: "42P07", detail: /organization_invitations_pending_email_uq/, teardown: ["drop table organization_invitations"] },
      { label: "sessions_org_active_idx exactly as reviewed (positive control)", setup: ["create index sessions_org_active_idx on sessions using btree (org_id) where revoked_at is null"], expect: "accepted", teardown: ["drop index if exists sessions_org_active_idx"] },
      { label: "sessions_org_active_idx without its WHERE clause", setup: ["create index sessions_org_active_idx on sessions using btree (org_id)"], expect: "refused", code: "42710", detail: /expected: CREATE INDEX sessions_org_active_idx ON sessions USING btree \(org_id\) WHERE \(revoked_at IS NULL\)/, teardown: ["drop index sessions_org_active_idx"] },
      { label: "an INVALID sessions_org_active_idx (interrupted concurrent build)", setup: ["create index sessions_org_active_idx on sessions using btree (org_id) where revoked_at is null", "update pg_index set indisvalid = false where indexrelid = 'sessions_org_active_idx'::regclass"], expect: "refused", code: "55000", teardown: ["drop index sessions_org_active_idx"] },
      { label: "platform_audit_events_entity_idx without created_at", setup: ["create index platform_audit_events_entity_idx on platform_audit_events using btree (entity_type, entity_id)"], expect: "refused", code: "42710", teardown: ["drop index platform_audit_events_entity_idx"] },
    ];
    for (const k of cases) {
      for (const s of k.setup) await X.c.query(s);
      const pre = await projectCatalog(X.c);
      if (k.expect === "accepted") {
        let steps: string[] = [];
        try {
          steps = await runPo02a(X.c);
        } catch (e) {
          ok(`${k.label}: accepted`, false, describeError(e));
        }
        if (steps.length) ok(`${k.label}: accepted as 'verified', the rest created`, steps.some((s) => s.endsWith("verified")) && steps.filter((s) => s.endsWith("created")).length === 3, steps.join(" · "));
        await X.c.query(readFileSync(PO02A_ROLLBACK_SQL_PATH, "utf8"));
      } else {
        let err: unknown = null;
        try {
          await runPo02a(X.c);
        } catch (e) {
          err = e;
        }
        const e = err as { code?: string; message?: string; detail?: string; hint?: string } | null;
        ok(
          `${k.label}: refused [${k.code}]`,
          !!e && e.code === k.code && /nothing was applied/.test(e.message ?? "") && (!k.detail || k.detail.test(`${e.detail ?? ""} ${e.message ?? ""}`)),
          e ? `${e.code}: ${e.message} | ${e.detail ?? ""}`.slice(0, 300) : "not refused",
        );
        if (k.code === "55000") ok("…with the exact recovery step (DROP INDEX CONCURRENTLY, then re-run)", /DROP INDEX CONCURRENTLY public\.sessions_org_active_idx/.test(e?.hint ?? ""), e?.hint ?? "");
        const post = await projectCatalog(X.c);
        const changed = [...diffProjection(pre.platform, post.platform), ...diffProjection(pre.other, post.other)];
        ok("…nothing else created and the pre-existing object left exactly as it was", changed.length === 0, changed.slice(0, 4).join(" | "));
      }
      for (const s of k.teardown) await X.c.query(s);
      ok("…teardown restores the exact pre-PO-02A catalog", (await fullDigest(X.c)) === d0);
    }
    ok("after every refusal, the database still migrates cleanly: created ×4", JSON.stringify(await runPo02a(X.c)) === JSON.stringify(CREATED));
  }

  section("6. M4 for the production runbook: CREATE INDEX CONCURRENTLY, then the migration");
  {
    const C = await legacyDb("po02a_mig_cic");
    const data0 = await tableChecksums(C.c, await allTables(C.c));
    await runStatements(C.c, PO02A_M4_CONCURRENT_SQL_PATH);
    const idx = async () => (await C.c.query(`select pg_get_indexdef(i.indexrelid) as d, i.indisvalid and i.indisready as v from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname = 'sessions_org_active_idx'`)).rows;
    let r = await idx();
    ok("the concurrent build creates a valid index with the reviewed definition", r.length === 1 && r[0].v === true && r[0].d === "CREATE INDEX sessions_org_active_idx ON public.sessions USING btree (org_id) WHERE (revoked_at IS NULL)", JSON.stringify(r));
    await runStatements(C.c, PO02A_M4_CONCURRENT_SQL_PATH);
    r = await idx();
    ok("running it again is a no-op (one valid index)", r.length === 1 && r[0].v === true);
    ok("the migration then verifies M4 and creates the rest", JSON.stringify(await runPo02a(C.c)) === JSON.stringify(["M2 tenant_access_controls: created", "M3 organization_invitations: created", "M4 sessions_org_active_idx: verified", "audit platform_audit_events_entity_idx: created"]));
    ok("…data unchanged", diffChecksums(data0, await tableChecksums(C.c, await allTables(C.c))).filter((t) => !["tenant_access_controls", "organization_invitations"].includes(t)).length === 0);
    // An interrupted concurrent build leaves an INVALID index: the runbook refuses, names the recovery, and recovers.
    await C.c.query(`update pg_index set indisvalid = false where indexrelid = 'sessions_org_active_idx'::regclass`);
    await rejects("over an INVALID leftover the runbook refuses with the recovery step", () => runStatements(C.c, PO02A_M4_CONCURRENT_SQL_PATH), (e) => /is INVALID/.test(String((e as Error).message)) && /DROP INDEX CONCURRENTLY public\.sessions_org_active_idx/.test(String((e as { hint?: string }).hint)));
    await C.c.query("reset lock_timeout; reset statement_timeout");
    await C.c.query(`drop index concurrently public.sessions_org_active_idx`);
    await runStatements(C.c, PO02A_M4_CONCURRENT_SQL_PATH);
    r = await idx();
    ok("…after DROP INDEX CONCURRENTLY a re-run rebuilds it valid", r.length === 1 && r[0].v === true);
    ok("…and the migration verifies everything", JSON.stringify(await runPo02a(C.c)) === JSON.stringify(VERIFIED));
  }

  section("7. Locking: a transactional build blocks writers to sessions, a concurrent build does not");
  {
    const K = await legacyDb("po02a_mig_lock");
    const builder = await connect(K.url);
    const writer = await connect(K.url);
    const holder = await connect(K.url);
    const pid = (await builder.query(`select pg_backend_pid() as p`)).rows[0].p;
    const anyLive = (await K.c.query(`select id, org_id, user_id from sessions where revoked_at is null and expires_at > now() limit 1`)).rows[0];
    const insertSession = (c: Client) => c.query(`insert into sessions (org_id, user_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '1 day')`, [anyLive.org_id, anyLive.user_id, newTokenHash()]);
    const sessionLock = async () => (await K.c.query(`select l.mode, l.granted from pg_locks l join pg_class c on c.oid = l.relation where l.pid = $1 and c.relname = 'sessions'`, [pid])).rows as { mode: string; granted: boolean }[];

    await builder.query(`begin; create index sessions_org_active_idx on sessions using btree (org_id) where revoked_at is null`);
    ok("transactional CREATE INDEX holds ShareLock on sessions", (await sessionLock()).some((l) => l.mode === "ShareLock" && l.granted), JSON.stringify(await sessionLock()));
    await writer.query(`set lock_timeout = '1500ms'`);
    await rejects("…a sign-in's session INSERT waits and times out while it is held (writes blocked)", () => insertSession(writer), (e) => sqlState(e) === "55P03");
    ok("…reads continue", (await writer.query(`select count(*)::int as n from sessions`)).rows[0].n > 0);
    await builder.query("rollback");

    await holder.query("begin");
    await holder.query(`update sessions set last_activity_at = last_activity_at where id = $1`, [anyLive.id]); // an in-flight write transaction
    const cic = builder.query(`create index concurrently sessions_org_active_idx on sessions using btree (org_id) where revoked_at is null`).then(() => "done", (e) => `error ${describeError(e)}`);
    let waiting = false;
    for (let i = 0; i < 100 && !waiting; i++) {
      await sleep(100);
      waiting = (await K.c.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid])).rows[0]?.wait_event_type === "Lock";
    }
    ok("CREATE INDEX CONCURRENTLY waits for the in-flight write transaction", waiting);
    ok("…while holding only ShareUpdateExclusiveLock on sessions", (await sessionLock()).some((l) => l.mode === "ShareUpdateExclusiveLock" && l.granted) && !(await sessionLock()).some((l) => l.mode === "ShareLock"), JSON.stringify(await sessionLock()));
    let wrote = false;
    try {
      await insertSession(writer);
      wrote = true;
    } catch (e) {
      ok("…a new sign-in's session INSERT succeeds meanwhile (writes not blocked)", false, describeError(e));
    }
    if (wrote) ok("…a new sign-in's session INSERT succeeds meanwhile (writes not blocked)", true);
    await holder.query("commit");
    ok("…and the build completes once that transaction ends", (await cic) === "done");
    ok("…leaving a valid index", (await K.c.query(`select indisvalid as v from pg_index where indexrelid = 'sessions_org_active_idx'::regclass`)).rows[0].v === true);
  }

  section("8. The rollback script: exact restoration, and it refuses to drop data");
  {
    const R = await legacyDb("po02a_mig_rollback");
    const tables = await allTables(R.c);
    const d0 = await fullDigest(R.c);
    const data0 = await tableChecksums(R.c, tables);
    const rollback = () => R.c.query(readFileSync(PO02A_ROLLBACK_SQL_PATH, "utf8")).catch(async (e) => {
      await R.c.query("ROLLBACK").catch(() => undefined);
      throw e;
    });
    await runPo02a(R.c);
    await rollback();
    ok("rollback on empty PO-02A tables restores the exact pre-PO-02A catalog (digest equal)", (await fullDigest(R.c)) === d0 && none(await po02aObjects(R.c)));
    ok("…and every pre-existing table's data is unchanged", diffChecksums(data0, await tableChecksums(R.c, tables)).length === 0);
    ok("re-applying after a rollback: created ×4", JSON.stringify(await runPo02a(R.c)) === JSON.stringify(CREATED));
    const org = (await R.c.query(`select min(id) as id from orgs`)).rows[0].id;
    await R.c.query(`insert into tenant_access_controls (org_id) values ($1)`, [org]);
    await rejects("rollback refuses while tenant_access_controls holds a row (P0001), changing nothing", () => rollback(), (e) => sqlState(e) === "P0001" && /tenant_access_controls holds 1 row/.test(String((e as Error).message)));
    const kept = await po02aObjects(R.c);
    ok("…every PO-02A object still present", kept.tables.length === 2 && kept.indexes.length === 2);
    await R.c.query(`delete from tenant_access_controls`);
    const admin = (await R.c.query(`select id from platform_admins limit 1`)).rows[0].id;
    await R.c.query(`insert into organization_invitations (company_name, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash, invited_by_platform_admin_id) values ('Rollback Guard Co', 'ops@rollback-guard.test', 'Saudi Arabia', 'SAR', 'Guard Owner', 'guard@rollback-guard.test', $1, $2)`, [newTokenHash(), admin]);
    await rejects("…and while organization_invitations holds a row", () => rollback(), (e) => sqlState(e) === "P0001" && /organization_invitations holds 1 row/.test(String((e as Error).message)));
    await R.c.query(`delete from organization_invitations`);
    await rollback();
    ok("once empty again, rollback restores the exact pre-PO-02A catalog", (await fullDigest(R.c)) === d0);
  }

  section("9. A later `drizzle-kit push` on the migrated database");
  {
    const before = await projectCatalog(M.c);
    const push = pushSchema(M.url, "full", { verbose: true });
    const statements = push.output.split("\n").map((l) => l.trim()).filter((l) => /^(CREATE|ALTER|DROP)\s/i.test(l));
    const touchesPo02a = statements.filter((l) => /tenant_access_controls|organization_invitations|sessions_org_active_idx|platform_audit_events_entity_idx|"platform_/.test(l));
    ok("push succeeds and issues no statement for any PO-02A or platform object", push.ok && touchesPo02a.length === 0, touchesPo02a.slice(0, 3).join(" | "));
    const fkLong = statements.filter((l) => /^ALTER TABLE "([a-z_]+)" (DROP|ADD) CONSTRAINT "([a-z0-9_]{60,})"/.test(l));
    ok(
      `its only statements re-create pre-existing customer foreign keys whose generated names exceed PostgreSQL's 63-character limit (${statements.length} statements) — not PO-02A`,
      statements.length === fkLong.length,
      statements.filter((l) => !fkLong.includes(l)).slice(0, 3).join(" | "),
    );
    const after = await projectCatalog(M.c);
    const changed = [...diffProjection(before.platform, after.platform), ...diffProjection(before.other, after.other)];
    ok("…and the catalog is unchanged afterwards (those re-creations are no-ops)", changed.length === 0, changed.slice(0, 3).join(" | "));
  }

  section("10. The existing migration gate still refuses (db:preflight)");
  {
    const res = spawnSync("npm", ["run", "-s", "db:preflight"], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: M.url }, encoding: "utf8", timeout: 300_000 });
    const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    const stateLine = out.split("\n").find((l) => l.startsWith("STATE:")) ?? "(no STATE line)";
    console.log(`  INFO  db:preflight on the migrated database: exit ${res.status}, ${stateLine}`);
    ok("db:preflight does not authorize `drizzle-kit migrate` on it (INCONSISTENT, exit 20) — D-6 is unchanged", res.status === 20, stateLine);
  }
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-migration-safety");
} catch (e) {
  console.error(`verify:platform-migration-safety aborted: ${describeError(e)}`);
  exitCode = 1;
} finally {
  for (const c of clients) await c.end().catch(() => undefined);
  if (!keep) for (const name of created) await dropDisposableDatabase(name).catch(() => undefined);
}
process.exit(exitCode);
