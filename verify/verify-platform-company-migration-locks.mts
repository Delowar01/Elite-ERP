/**
 * Platform Owner PO-02D1A.1 — PO-02A migration lock safety (decision D-11b): the approved PO-02A SQL against the
 * corrected one, MEASURED side by side, plus the corrected file's locking acceptance and its catalog equivalence.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *     npm run verify:platform-company-migration-locks
 *
 * The approved file is not kept as a copy: it is rebuilt from the corrected file by undoing the recorded PO-02D1A.1
 * hunks (verify/po02d1a1-approved-delta.mts) and must hash to PO-02A's recorded sha256 — so this suite also proves the
 * undo is byte-for-byte. Measurements use independent connections and deterministic barriers
 * (verify/platform/lock-probes.ts): each migration runs as a test copy whose final COMMIT is withheld, so its real
 * locks stay held while every probe records whether it ran or which backend blocked it on which lock. Disposable
 * loopback `*_test_only_*` databases, fictional rows only; every database is dropped at the end
 * (PLATFORM_TEST_KEEP_DATABASES=1 keeps them). Elapsed times are from a local cluster — no production-size claim.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
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
  checkPlatformObjects,
  checkCompanyFoundation,
  checkOnboardingFoundation,
  PLATFORM_SQL_PATH,
  PO02A_SQL_PATH,
  PO02A_M4_CONCURRENT_SQL_PATH,
  PO02A_ROLLBACK_SQL_PATH,
} from "../scripts/platform/catalog";
import { projectLive, fingerprintDigest } from "../scripts/migration-preflight";
import { section, ok, rejects, sqlState, summary, describeError } from "./platform/harness";
import { insertFixtures, tableChecksums, diffChecksums, runStatements, po02aObjects, type TenantFixture } from "./platform/po02a-fixtures";
import { PO02D1_CREATED, runPo02d1 } from "./platform/po02d1-fixtures";
import {
  pidOf,
  locksOf,
  fmtLocks,
  strongLocks,
  waitsOnLock,
  txnSteps,
  fmtSteps,
  msSince,
  sleep,
  customerSignInOff,
  customerSignInOn,
  platformOwnerSignIn,
  registration,
  customerReadsAndWrites,
  type Step,
} from "./platform/lock-probes";
import { PO02A_NEW } from "./po02a-approved-delta.mjs";
import { PO02D1A1_EDITS, undoPo02d1a1 } from "./po02d1a1-approved-delta.mjs";

const created: string[] = [];
const clients: Client[] = [];
const keep = process.env.PLATFORM_TEST_KEEP_DATABASES === "1";
const info = (line: string) => console.log(`  INFO  ${line}`);
const h16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const PO02A_REL = "drizzle/platform/PO02A_company_foundation.sql";
const CORRECTED = readFileSync(PO02A_SQL_PATH, "utf8");
const APPROVED = undoPo02d1a1(PO02A_REL, CORRECTED);
const held = (sql: string) => sql.replace(/\nCOMMIT;\s*$/, "\n");
const beforeCleanup = (sql: string) => sql.split("DROP SCHEMA po02a_reference CASCADE;")[0];
const steps = (res: unknown) =>
  (Array.isArray(res) ? res : [res]).flatMap((r: { rows?: Record<string, unknown>[] }) => (r.rows ?? []).map((x) => x.po02a_step)).filter((x): x is string => typeof x === "string");
const CREATED4 = ["M2 tenant_access_controls: created", "M3 organization_invitations: created", "M4 sessions_org_active_idx: created", "audit platform_audit_events_entity_idx: created"];
const VERIFIED4 = CREATED4.map((s) => s.replace(/created$/, "verified"));

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
type Db = { url: string; c: Client; fx: TenantFixture };
/** 621f156 tenant shape + PO-01A + fictional tenant rows; optionally M4 built concurrently first and PO-02A applied. */
async function db(prefix: string, opts: { cic?: boolean; po02a?: string } = {}): Promise<Db> {
  const d = await newDb(prefix);
  const push = await pushPreCompanyTenantSchema(d.url);
  if (!push.ok) throw new Error(`push failed: ${push.output.slice(-400)}`);
  await applyPlatformMigration(d.url, [PLATFORM_SQL_PATH]);
  const c = await connect(d.url);
  const fx = await insertFixtures(c);
  if (opts.cic) await runStatements(c, PO02A_M4_CONCURRENT_SQL_PATH);
  if (opts.po02a) await c.query(opts.po02a);
  return { url: d.url, c, fx };
}
const digest = async (c: Client) => {
  const p = await projectCatalog(c);
  return projectionDigest(p.platform) + projectionDigest(p.other);
};
const allTables = async (c: Client) => {
  const p = await projectCatalog(c);
  return [...p.platform.tables, ...p.other.tables];
};

/** Hold `sqlText` open on a fresh connection; return its locks and every probe's outcome; then roll it back. */
async function measure(d: Db, sqlText: string, withTac: boolean): Promise<{ migPid: number; ranMs: number; held: Record<string, string[]>; probes: Record<string, Step>; flows: Record<string, { steps: Step[]; blockedAt: Step | null }> }> {
  const mig = await connect(d.url);
  const migPid = await pidOf(mig);
  const obs = await connect(d.url);
  const p = await connect(d.url);
  const t0 = performance.now();
  await mig.query(sqlText);
  const ranMs = msSince(t0);
  const l = await locksOf(obs, migPid);
  const org = d.fx.orgs[0];
  const user = d.fx.users[0];
  const probes: Record<string, Step> = {};
  for (const s of customerReadsAndWrites(org)) probes[s[0]] = (await txnSteps(obs, p, [s])).steps[0];
  const flows: Record<string, { steps: Step[]; blockedAt: Step | null }> = {};
  flows["customer sign-in (enforcement off)"] = await txnSteps(obs, p, customerSignInOff("owner0@company-fixture.test", user, org));
  if (withTac) flows["customer sign-in (enforcement on)"] = await txnSteps(obs, p, customerSignInOn("owner0@company-fixture.test", user, org));
  flows["Platform Owner sign-in"] = await txnSteps(obs, p, platformOwnerSignIn("operator@platform-fixture.test", d.fx.admin));
  flows["customer registration"] = await txnSteps(obs, p, registration(`m${migPid}`));
  await mig.query("rollback");
  return { migPid, ranMs, held: l.held, probes, flows };
}
const report = (label: string, m: Awaited<ReturnType<typeof measure>>) => {
  info(`[${label}] statements ${m.ranMs} ms, COMMIT withheld; locks held: ${fmtLocks(m.held)}`);
  for (const s of Object.values(m.probes)) info(`[${label}] ${fmtSteps([s])}`);
  for (const [k, f] of Object.entries(m.flows)) info(`[${label}] ${k}: ${fmtSteps(f.steps)}`);
};
const blockedBy = (s: Step | null | undefined, pid: number) => !!s && !s.ok && !!s.blockers?.includes(pid);
const completes = (f: { blockedAt: Step | null } | undefined) => !!f && f.blockedAt === null;

async function main(): Promise<void> {
  // ------------------------------------------------------------------------------------------------
  section("0. The approved file rebuilt from the corrected one (byte for byte) and the correction itself");
  ok(`undoing the recorded PO-02D1A.1 hunks rebuilds the approved PO-02A SQL byte for byte (sha256/16 ${h16(APPROVED)} = PO-02A's recorded ${PO02A_NEW[PO02A_REL]})`,
    h16(APPROVED) === PO02A_NEW[PO02A_REL] && APPROVED !== CORRECTED);
  ok("the correction is recorded as exactly one file's hunks for the PO-02A SQL (plus the freeze verifiers' own hooks)",
    (PO02D1A1_EDITS[PO02A_REL] ?? []).length > 0 && Object.keys(PO02D1A1_EDITS).every((f) => [PO02A_REL, "verify/verify-document-form.mts", "verify/verify-page-archetypes.mts"].includes(f)));
  ok("corrected: no DDL template references a LIVE table (no `REFERENCES public.`); the approved file had 5", !/REFERENCES public\./.test(CORRECTED) && (APPROVED.match(/REFERENCES public\./g) ?? []).length === 5);
  ok("corrected: key-only stand-ins of orgs and platform_admins are created inside the scratch schema, right after it",
    /CREATE SCHEMA po02a_reference;\n[\s\S]*?CREATE TABLE po02a_reference\.orgs \(id integer NOT NULL, CONSTRAINT orgs_pkey PRIMARY KEY \(id\)\);\nCREATE TABLE po02a_reference\.platform_admins \(id uuid NOT NULL, CONSTRAINT platform_admins_pkey PRIMARY KEY \(id\)\);/.test(CORRECTED));
  ok("corrected: the shape comparison strips the schema prefix from constraint definitions (reference FKs name the stand-ins)",
    /\|\| replace\(pg_get_constraintdef\(con\.oid, true\), p_schema \|\| '\.', ''\)/.test(CORRECTED));
  ok("both: every public DDL statement is otherwise the same text (the templates differ only by %1$I.orgs / %1$I.platform_admins)",
    CORRECTED.split("$ddl$").filter((_, i) => i % 2 === 1).map((t) => t.replace(/%1\$I\.(orgs|platform_admins) \(id\)/g, "public.$1 (id)")).join("|") ===
      APPROVED.split("$ddl$").filter((_, i) => i % 2 === 1).join("|"));

  // ------------------------------------------------------------------------------------------------
  section("1. D-11b reproduced on the APPROVED PO-02A SQL (independent connections, barriers, blocking pids)");
  {
    const R = await db("po02d1a1_lk_appr_retry", { po02a: APPROVED });
    const full = await measure(R, held(APPROVED), true);
    report("approved, verify-only re-run", full);
    ok("approved re-run: holds ACCESS EXCLUSIVE on orgs AND platform_admins until COMMIT (it creates nothing)",
      ["orgs", "platform_admins"].every((t) => (full.held[t] ?? []).includes("AccessExclusiveLock")), fmtLocks(full.held));
    ok("…so a plain read of orgs waits, blocked by the migration backend", blockedBy(full.probes["read orgs (company header)"], full.migPid), fmtSteps([full.probes["read orgs (company header)"]]));
    ok("…a customer INSERT waits (its foreign-key check needs orgs)", blockedBy(full.probes["INSERT customers (FK check KEY SHARE on orgs)"], full.migPid));
    ok("…customer sign-in waits (enforcement off: at INSERT security_events; on: at its first statement, orgs FOR SHARE)",
      blockedBy(full.flows["customer sign-in (enforcement off)"].blockedAt, full.migPid) && full.flows["customer sign-in (enforcement off)"].blockedAt?.label === "INSERT security_events" &&
        blockedBy(full.flows["customer sign-in (enforcement on)"].blockedAt, full.migPid) && full.flows["customer sign-in (enforcement on)"].blockedAt?.label === "orgs FOR SHARE");
    ok("…Platform Owner sign-in waits at its very first read of platform_admins", blockedBy(full.flows["Platform Owner sign-in"].blockedAt, full.migPid) && full.flows["Platform Owner sign-in"].blockedAt?.label === "platform_admins read by e-mail");
    ok("…a customer registration waits at INSERT orgs", blockedBy(full.flows["customer registration"].blockedAt, full.migPid) && full.flows["customer registration"].blockedAt?.label === "INSERT orgs");
    const pre = await measure(R, beforeCleanup(APPROVED), true);
    report("approved re-run, stopped before the scratch cleanup", pre);
    ok("ROOT CAUSE, part 1: before its cleanup the approved re-run holds no ACCESS EXCLUSIVE — the cleanup (DROP SCHEMA po02a_reference CASCADE) takes it",
      ["orgs", "platform_admins"].every((t) => !(pre.held[t] ?? []).includes("AccessExclusiveLock")));
    ok("ROOT CAUSE, part 2: it already holds SHARE ROW EXCLUSIVE on both — from creating the scratch copies' foreign keys into the LIVE tables — so writes wait (Platform Owner TOTP step, registration)",
      ["orgs", "platform_admins"].every((t) => (pre.held[t] ?? []).includes("ShareRowExclusiveLock")) &&
        blockedBy(pre.flows["Platform Owner sign-in"].blockedAt, pre.migPid) && pre.flows["Platform Owner sign-in"].blockedAt?.label === "TOTP step UPDATE platform_admins" &&
        blockedBy(pre.flows["customer registration"].blockedAt, pre.migPid));
    const F = await db("po02d1a1_lk_appr_first", { cic: true });
    const first = await measure(F, held(APPROVED), false);
    report("approved, first application (production order: M4 built concurrently first)", first);
    ok("approved first application: ACCESS EXCLUSIVE on orgs and platform_admins too (the same cleanup)", ["orgs", "platform_admins"].every((t) => (first.held[t] ?? []).includes("AccessExclusiveLock")));
  }

  // ------------------------------------------------------------------------------------------------
  section("2. CORRECTED — a verify-only re-run takes no blocking lock: sign-in, Platform Owner login, reads and writes all proceed");
  {
    const R = await db("po02d1a1_lk_corr_retry", { po02a: CORRECTED });
    const d0 = await digest(R.c);
    const m = await measure(R, held(CORRECTED), true);
    report("corrected, verify-only re-run", m);
    ok("corrected re-run: no SHARE / SHARE ROW EXCLUSIVE / EXCLUSIVE / ACCESS EXCLUSIVE lock on any watched table (only ACCESS SHARE on sessions and platform_audit_events, to copy their structure)",
      Object.keys(strongLocks(m.held)).length === 0 && Object.keys(m.held).every((t) => ["sessions", "platform_audit_events"].includes(t)), fmtLocks(m.held));
    ok("…every customer read and write runs (orgs, users, customers, sessions; INSERT customers; UPDATE orgs)", Object.values(m.probes).every((s) => s.ok), Object.values(m.probes).map((s) => fmtSteps([s])).join(" | "));
    ok("…customer sign-in completes with enforcement off AND on", completes(m.flows["customer sign-in (enforcement off)"]) && completes(m.flows["customer sign-in (enforcement on)"]));
    ok("…Platform Owner sign-in completes (TOTP step, session, last login, audit, attempt)", completes(m.flows["Platform Owner sign-in"]));
    ok("…a concurrent customer registration completes (INSERT orgs, owner, event, session)", completes(m.flows["customer registration"]));
    const t0 = performance.now();
    const s = steps(await R.c.query(CORRECTED));
    ok(`…and committed, the re-run is verified ×4 in ${msSince(t0)} ms with the catalog unchanged`, JSON.stringify(s) === JSON.stringify(VERIFIED4) && (await digest(R.c)) === d0, s.join(" · "));
  }

  // ------------------------------------------------------------------------------------------------
  section("3. CORRECTED — first installation: only the genuine, bounded foreign-key and index-build locks; no ACCESS EXCLUSIVE");
  {
    const P = await db("po02d1a1_lk_corr_first", { cic: true });
    const m = await measure(P, held(CORRECTED), false);
    report("corrected, first application (production order)", m);
    ok("first application holds SHARE ROW EXCLUSIVE on orgs and platform_admins (the new foreign keys) and SHARE on platform_audit_events (the audit index build) — and never ACCESS EXCLUSIVE",
      ["orgs", "platform_admins"].every((t) => (m.held[t] ?? []).includes("ShareRowExclusiveLock") && !(m.held[t] ?? []).includes("AccessExclusiveLock")) &&
        (m.held.platform_audit_events ?? []).includes("ShareLock") && !Object.values(m.held).some((x) => x.includes("AccessExclusiveLock")) && !(m.held.sessions ?? []).includes("ShareLock"),
      fmtLocks(m.held));
    const pre = await measure(P, beforeCleanup(CORRECTED), false);
    ok("…and its cleanup adds no lock (the locks with and without the scratch cleanup are identical)", fmtLocks(strongLocks(pre.held)) === fmtLocks(strongLocks(m.held)), `${fmtLocks(strongLocks(pre.held))} vs ${fmtLocks(strongLocks(m.held))}`);
    ok("…reads continue (orgs, users, customers, sessions) and a business INSERT runs (KEY SHARE is compatible)",
      ["read orgs (company header)", "read users (team list)", "read customers", "read sessions (session validation)", "INSERT customers (FK check KEY SHARE on orgs)"].every((k) => m.probes[k]?.ok));
    ok("…a customer sign-in completes (the production order builds M4 concurrently first)", completes(m.flows["customer sign-in (enforcement off)"]));
    ok("…the documented first-installation write waits, each blocked by the migration backend: UPDATE orgs, a registration's INSERT orgs, the Platform Owner TOTP-step UPDATE",
      blockedBy(m.probes["UPDATE orgs (company settings)"], m.migPid) &&
        blockedBy(m.flows["customer registration"].blockedAt, m.migPid) && m.flows["customer registration"].blockedAt?.label === "INSERT orgs" &&
        blockedBy(m.flows["Platform Owner sign-in"].blockedAt, m.migPid) && m.flows["Platform Owner sign-in"].blockedAt?.label === "TOTP step UPDATE platform_admins");
    // Bounded: without a timeout the waiting writer completes as soon as the migration commits.
    const mig = await connect(P.url);
    const migPid = await pidOf(mig);
    const obs = await connect(P.url);
    const w = await connect(P.url);
    const wPid = await pidOf(w);
    await mig.query(held(CORRECTED));
    const t0 = performance.now();
    const writer = (async () => {
      await w.query("begin");
      await w.query(`insert into orgs (name, country, currency) values ('Bounded Wait Fixture', 'Saudi Arabia', 'SAR')`);
      await w.query("rollback");
      return msSince(t0);
    })();
    ok("barrier: a registration's INSERT orgs is waiting for the first installation", await waitsOnLock(obs, wPid));
    const blockers = ((await obs.query(`select pg_blocking_pids($1) as b`, [wPid])).rows[0].b as number[]).map(Number);
    await sleep(300);
    await mig.query("commit");
    const waited = await writer;
    info(`a registration INSERT orgs waited for the migration (blocked by pid ${blockers.join(",")}), then completed ${waited} ms after it started — the migration was held 300 ms past the barrier`);
    ok("…it waits (blocked by the migration backend) and completes once the migration commits — a bounded wait, not a failure", blockers.includes(migPid) && waited >= 300 && waited < 5_000);
    ok("…and the committed first installation passes the company-foundation check", (await checkCompanyFoundation(P.c)).ok);
    const T = await db("po02d1a1_lk_corr_first_test");
    const t = await measure(T, held(CORRECTED), false);
    report("corrected, first application (test-database path: M4 built inside the transaction)", t);
    ok("test-database path (M4 not built concurrently first): additionally SHARE on sessions, so a sign-in waits at INSERT sessions — the documented reason production builds M4 concurrently first",
      (t.held.sessions ?? []).includes("ShareLock") && t.flows["customer sign-in (enforcement off)"].blockedAt?.label === "INSERT sessions" && !Object.values(t.held).some((x) => x.includes("AccessExclusiveLock")));
  }

  // ------------------------------------------------------------------------------------------------
  section("4. CORRECTED — a lock timeout rolls everything back; an interrupted migration can be retried");
  {
    const F = await db("po02d1a1_lk_corr_fail");
    const proj0 = await projectCatalog(F.c);
    const tables = await allTables(F.c);
    const d0 = await digest(F.c);
    const data0 = await tableChecksums(F.c, tables);
    const intact = async (label: string) =>
      ok(`${label}: no PO-02A table or index, no scratch schema or helper; catalog and data exactly as before`,
        (await po02aObjects(F.c)).tables.length === 0 && (await po02aObjects(F.c)).indexes.length === 0 && !(await po02aObjects(F.c)).scratch &&
          (await F.c.query(`select count(*)::int as n from pg_proc where proname like 'po02a%'`)).rows[0].n === 0 &&
          (await digest(F.c)) === d0 && diffChecksums(data0, await tableChecksums(F.c, tables)).length === 0);
    const writer = await connect(F.url);
    await writer.query(`begin; lock table platform_admins in row exclusive mode`);
    const mig = await connect(F.url);
    const migPid = await pidOf(mig);
    const obs = await connect(F.url);
    const t0 = performance.now();
    const run = mig.query(CORRECTED).then(() => "applied", async (e) => { await mig.query("ROLLBACK").catch(() => undefined); return sqlState(e) ?? "error"; });
    ok("barrier: the first installation waits for its foreign key on platform_admins (an in-flight writer)", await waitsOnLock(obs, migPid));
    const w = await locksOf(obs, migPid);
    info(`while waiting it holds ${fmtLocks(strongLocks(w.held))}; waits for ${w.waiting.join(", ")}`);
    const outcome = await run;
    const waited = msSince(t0);
    ok(`…and gives up with 55P03 at its lock_timeout (${waited} ms)`, outcome === "55P03" && waited >= 4_500);
    await writer.query("rollback");
    await intact("…everything created earlier in the transaction was rolled back");
    await writer.query(`begin; lock table platform_admins in row exclusive mode`);
    const doomed = await connect(F.url);
    const dPid = await pidOf(doomed);
    const run2 = doomed.query(CORRECTED).then(() => "applied", (e) => describeError(e));
    ok("barrier: a second attempt is waiting", await waitsOnLock(obs, dPid));
    await obs.query(`select pg_terminate_backend($1)`, [dPid]);
    ok("pg_terminate_backend ends it", (await run2) !== "applied");
    await writer.query("rollback");
    await intact("…the killed transaction left nothing behind");
    const retry = await connect(F.url);
    const s = steps(await retry.query(CORRECTED));
    ok("…a retry on a new connection installs everything: created ×4", JSON.stringify(s) === JSON.stringify(CREATED4), s.join(" · "));
    const after = await projectCatalog(F.c);
    const tenantDiff = diffProjection(proj0.other, after.other, "before", "after");
    ok("no unrelated customer table changed: the only tenant-schema difference is M4 (sessions_org_active_idx), as reviewed",
      tenantDiff.length === 1 && tenantDiff[0] === "indexes: only in after: sessions | sessions_org_active_idx | CREATE INDEX sessions_org_active_idx ON public.sessions USING btree (org_id) WHERE (revoked_at IS NULL)", tenantDiff.join(" | "));
    ok("…and every pre-existing table's data is byte-identical after the installation", diffChecksums(data0, await tableChecksums(F.c, tables)).length === 0);
  }

  // ------------------------------------------------------------------------------------------------
  section("5. CORRECTED — every company-control constraint present, validated and enabled; PO-01A audit protection intact");
  {
    const C = await db("po02d1a1_lk_corr_cons", { po02a: CORRECTED });
    const cons = (await C.c.query(
      `select c.relname as t, con.conname as n, con.contype::text as k, con.convalidated as v, con.condeferrable as d, pg_get_constraintdef(con.oid) as def
       from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname = 'public' and c.relname in ('tenant_access_controls', 'organization_invitations') order by 1, 2`,
    )).rows as { t: string; n: string; k: string; v: boolean; d: boolean; def: string }[];
    ok(`all ${cons.length} constraints of tenant_access_controls (9) and organization_invitations (19) are present, validated and not deferrable`, cons.length === 28 && cons.every((x) => x.v && !x.d), String(cons.length));
    const fks = Object.fromEntries(cons.filter((x) => x.k === "f").map((x) => [x.n, x.def]));
    ok("the five foreign keys reference the live tables exactly as reviewed (ON DELETE RESTRICT)",
      JSON.stringify(fks) === JSON.stringify({
        organization_invitations_accepted_org_fk: "FOREIGN KEY (accepted_org_id) REFERENCES orgs(id) ON DELETE RESTRICT",
        organization_invitations_invited_by_fk: "FOREIGN KEY (invited_by_platform_admin_id) REFERENCES platform_admins(id) ON DELETE RESTRICT",
        organization_invitations_revoked_by_fk: "FOREIGN KEY (revoked_by_platform_admin_id) REFERENCES platform_admins(id) ON DELETE RESTRICT",
        tenant_access_controls_changed_by_fk: "FOREIGN KEY (changed_by_platform_admin_id) REFERENCES platform_admins(id) ON DELETE RESTRICT",
        tenant_access_controls_org_fk: "FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE RESTRICT",
      }), JSON.stringify(fks));
    const idx = (await C.c.query(`select i.relname as n, ix.indisvalid and ix.indisready as ok from pg_index ix join pg_class i on i.oid = ix.indexrelid join pg_class t on t.oid = ix.indrelid where t.relname in ('tenant_access_controls', 'organization_invitations', 'sessions', 'platform_audit_events') and i.relname in ('organization_invitations_token_hash_uq', 'organization_invitations_accepted_org_uq', 'organization_invitations_pending_email_uq', 'organization_invitations_pending_expiry_idx', 'sessions_org_active_idx', 'platform_audit_events_entity_idx')`)).rows;
    ok("the six PO-02A indexes exist and are valid", idx.length === 6 && idx.every((r) => r.ok));
    await rejects("a CHECK is enforced: a suspension without its operator is refused", () => C.c.query(`insert into tenant_access_controls (org_id, access_status) values ($1, 'suspended')`, [C.fx.orgs[0]]), (e) => sqlState(e) === "23514");
    await rejects("a FOREIGN KEY is enforced: an access row for an unknown organization is refused", () => C.c.query(`insert into tenant_access_controls (org_id) values (999999)`), (e) => sqlState(e) === "23503");
    const trg = (await C.c.query(`select tgname, tgenabled::text as e from pg_trigger where tgrelid = 'public.platform_audit_events'::regclass and not tgisinternal order by 1`)).rows;
    ok("PO-01A audit protection intact: platform_audit_events' append-only triggers present and ENABLED; the decoy-resistant check passes",
      trg.length === 2 && trg.every((r) => r.e === "O") && (await checkPlatformObjects(C.c)).ok, JSON.stringify(trg));
  }

  // ------------------------------------------------------------------------------------------------
  section("6. CORRECTED — drift is still refused by the changed constraint comparison (nothing applied)");
  {
    const X = await db("po02d1a1_lk_corr_drift");
    const d0 = await digest(X.c);
    const rollback = async () => {
      await X.c.query(readFileSync(PO02A_ROLLBACK_SQL_PATH, "utf8")).catch(async () => { await X.c.query("ROLLBACK").catch(() => undefined); });
      await X.c.query(`drop table if exists tenant_access_controls`);
    };
    const tacDdl = (CORRECTED.split("$ddl$").find((p) => p.startsWith("CREATE TABLE %1$I.tenant_access_controls")) ?? "").replace(/%1\$I/g, "public");
    const edit = (from: string, to: string) => {
      if (!tacDdl.includes(from)) throw new Error(`anchor missing: ${from}`);
      return tacDdl.replace(from, to);
    };
    await X.c.query(`create table lookalike_orgs (id integer primary key)`);
    const d1 = await digest(X.c);
    const cases: [string, string, RegExp | null][] = [
      ["tenant_access_controls exactly as reviewed (positive control)", tacDdl, null],
      ["…whose org foreign key points at another table", edit("REFERENCES public.orgs (id) ON DELETE RESTRICT", "REFERENCES public.lookalike_orgs (id) ON DELETE RESTRICT"), /tenant_access_controls_org_fk/],
      ["…whose org foreign key cascades on delete", edit("REFERENCES public.orgs (id) ON DELETE RESTRICT", "REFERENCES public.orgs (id) ON DELETE CASCADE"), /tenant_access_controls_org_fk/],
      ["…without its changed-by foreign key", tacDdl.replace(/\n  CONSTRAINT tenant_access_controls_changed_by_fk[^\n]*/, ""), /tenant_access_controls_changed_by_fk/],
      ["…whose org foreign key is NOT VALID", `${tacDdl.replace(/\n  CONSTRAINT tenant_access_controls_org_fk[^\n]*/, "")};\nalter table tenant_access_controls add constraint tenant_access_controls_org_fk foreign key (org_id) references orgs (id) on delete restrict not valid`, /NOT VALID/],
    ];
    for (const [label, setup, detail] of cases) {
      for (const stmt of setup.split(";\n")) await X.c.query(stmt);
      const pre = await projectCatalog(X.c);
      type PgError = { code?: string; message?: string; detail?: string };
      let err: PgError | null = null;
      let s: string[] = [];
      try {
        s = steps(await X.c.query(CORRECTED));
      } catch (e) {
        err = e as PgError;
        await X.c.query("ROLLBACK").catch(() => undefined);
      }
      if (!detail) ok(`${label}: accepted as verified, the rest created`, !err && s[0] === "M2 tenant_access_controls: verified" && s.slice(1).every((x) => x.endsWith("created")), err ? describeError(err) : s.join(" · "));
      else {
        ok(`${label}: refused [42P07], naming the difference`, err?.code === "42P07" && /nothing was applied/.test(err?.message ?? "") && detail.test(`${err?.detail ?? ""}`), `${err?.code}: ${(err?.detail ?? "").slice(0, 200)}`);
        const post = await projectCatalog(X.c);
        ok("…nothing else created; the drifted table left as it was", [...diffProjection(pre.platform, post.platform), ...diffProjection(pre.other, post.other)].length === 0);
      }
      await rollback();
      ok("…teardown restores the exact catalog", (await digest(X.c)) === d1);
    }
    await X.c.query(`drop table lookalike_orgs`);
    ok("after the drift cases the catalog is exactly the pre-PO-02A one", (await digest(X.c)) === d0);
  }

  // ------------------------------------------------------------------------------------------------
  section("7. Catalog equivalence: the approved and the corrected file leave the same public schema (three shapes)");
  for (const shape of ["tenant", "concurrent-m4", "push-built"] as const) {
    const build = async (sql: string, tag: string) => {
      const d = await newDb(`po02d1a1_lk_eq_${tag}`);
      if (shape === "push-built") ok(`[${shape}/${tag}] pre-onboarding schema pushed`, pushSchema(d.url, "pre-onboarding").ok);
      else ok(`[${shape}/${tag}] 621f156 tenant shape pushed`, (await pushPreCompanyTenantSchema(d.url)).ok);
      await applyPlatformMigration(d.url, [PLATFORM_SQL_PATH]);
      const c = await connect(d.url);
      await insertFixtures(c);
      if (shape === "concurrent-m4") await runStatements(c, PO02A_M4_CONCURRENT_SQL_PATH);
      const first = steps(await c.query(sql));
      const second = steps(await c.query(sql));
      const proj = await projectCatalog(c);
      const live = fingerprintDigest(await projectLive(c));
      const schemas = (await c.query(`select string_agg(nspname, ',' order by nspname) as s from pg_namespace where nspname not like 'pg\\_%' and nspname <> 'information_schema'`)).rows[0].s;
      const counts = Object.fromEntries(Object.entries(await tableChecksums(c, [...proj.platform.tables, ...proj.other.tables])).map(([t, v]) => [t, v.split(":")[0]]));
      await runPo02d1(c);
      const withD1 = await projectCatalog(c);
      return { first, second, proj, live, schemas, counts, withD1 };
    };
    const a = await build(APPROVED, "a");
    const b = await build(CORRECTED, "c");
    ok(`[${shape}] identical step lines on the first run (${b.first.map((x) => x.split(": ")[1]).join("/")}) and on the re-run (${b.second.map((x) => x.split(": ")[1]).join("/")})`,
      JSON.stringify(a.first) === JSON.stringify(b.first) && JSON.stringify(a.second) === JSON.stringify(b.second));
    const dP = diffProjection(a.proj.platform, b.proj.platform, "approved", "corrected");
    const dO = diffProjection(a.proj.other, b.proj.other, "approved", "corrected");
    ok(`[${shape}] the full public catalog projection is identical — platform and tenant (digests ${projectionDigest(b.proj.platform).slice(0, 12)} / ${projectionDigest(b.proj.other).slice(0, 12)})`, dP.length === 0 && dO.length === 0, [...dP, ...dO].slice(0, 4).join(" | "));
    ok(`[${shape}] …and so is the independent AUD-08 live fingerprint (F1–F6 digest ${b.live.slice(0, 12)})`, a.live === b.live);
    ok(`[${shape}] no scratch schema left (schemas: ${b.schemas}); identical row counts in every table`, a.schemas === "public" && b.schemas === "public" && JSON.stringify(a.counts) === JSON.stringify(b.counts));
    const dD1 = [...diffProjection(a.withD1.platform, b.withD1.platform), ...diffProjection(a.withD1.other, b.withD1.other)];
    ok(`[${shape}] PO-02D1A applied on top of either yields the identical catalog`, dD1.length === 0, dD1.slice(0, 3).join(" | "));
  }

  // ------------------------------------------------------------------------------------------------
  section("8. PO-01A → corrected PO-02A → PO-02D1A on a production-shaped fictional database");
  {
    const D = await db("po02d1a1_lk_chain", { cic: true, po02a: CORRECTED });
    const s = await runPo02d1(D.c);
    ok(`PO-02D1A on the corrected foundation: created ×${PO02D1_CREATED.length}`, JSON.stringify(s) === JSON.stringify(PO02D1_CREATED), s.join(" · "));
    ok("…the PO-01A, PO-02A and onboarding checks all pass", (await checkPlatformObjects(D.c)).ok && (await checkCompanyFoundation(D.c)).ok && (await checkOnboardingFoundation(D.c)).ok);
  }
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-company-migration-locks");
} catch (e) {
  console.error(`verify:platform-company-migration-locks aborted: ${describeError(e)}`);
  exitCode = 1;
} finally {
  for (const c of clients) await c.end().catch(() => undefined);
  if (!keep) for (const name of created) await dropDisposableDatabase(name).catch(() => undefined);
}
process.exit(exitCode);
