/**
 * Platform Owner PO-06 — the D-6 migration and rollback REHEARSAL (docs/platform-owner/po06/D6_MIGRATION_MANIFEST.json,
 * scripts/platform/release-manifest.ts), scenarios A–O of Prompt 6 §4, on real PostgreSQL.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *   npx tsx --conditions=react-server verify/verify-po06-migration-rehearsal.mts
 *
 * Disposable `*_test_only_*` databases on a loopback cluster, fictional rows only (verify/platform/po06-fixtures.ts).
 * The production shape is pushPreCompanyTenantSchema + drizzle/immutable_audit.sql — PO-06 proved it byte-identical to
 * a push of main 621f156's own schema (pg_dump --schema-only, 5,240 lines) — and "existing company data" is the fixture
 * set in 17+ customer tables. Every failure scenario ends with an integrity check: the pinned catalog stage, no scratch
 * schema, no INVALID index, every trigger enabled, the immutable-audit triggers present, and every existing table's rows
 * byte-identical (row fingerprints; scenario B also compares pg_dump --data-only byte for byte).
 *
 *   A clean new database → full foundation        I incorrect SQL checksum
 *   B existing ERP-shaped database → additive      J Trial seed and its guarded rollback
 *   C retry of a completed migration (+ locks)     K the staged user_invitations installation
 *   D interrupted migration (3 kinds)              L its rollback on an empty table, and the full rollback chain
 *   E failure and transaction rollback (55P03)     M refusal to drop user_invitations holding a record
 *   F missing prerequisite                         N the preflight and verification after every step
 *   G unexpected existing table / column           O integrity after every failure
 *   H conflicting constraint / index               + a least-privilege runtime role (staging recommendation)
 * Nothing here can reach a non-loopback or non-`*_test_only_*` database: every connection goes through the guard.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import type { Client } from "pg";
import { connectDisposable, databaseUrlFor, disposableName, dropDisposableDatabase, pushPreCompanyTenantSchema, withAdmin } from "../scripts/platform/disposable-db";
import { projectCatalog } from "../scripts/platform/catalog";
import {
  applyManifest,
  autocommitStatements,
  inspect,
  loadManifest,
  ManifestError,
  rollbackManifest,
  STAGED_TABLE_PUSH_PLAN,
  statusOf,
  verifyManifestFiles,
  type Manifest,
  type StepResult,
} from "../scripts/platform/release-manifest";
import { runPreflight } from "../scripts/platform/release-preflight";
import { checkTrialSeed, runSeed, SeedRefusedError } from "../scripts/platform/trial-seed";
import { describeError, ok, section, sqlState, summary } from "./platform/harness";
import { changedTables, fingerprints, fmtHeld, insertProductionFixtures, locksHeldAtCommit, nonEmpty, publicTables, type ProductionFixture } from "./platform/po06-fixtures";

const ROOT = process.cwd();
/** The reviewed files' own refusals: a pre-existing table of another shape, and an index/constraint/trigger of another definition. */
const SQL_SHAPE = "42P07"; // duplicate_table
const SQL_DEFINITION = "42710"; // duplicate_object
const m = loadManifest();
const sql = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const IMMUTABLE = sql("drizzle/immutable_audit.sql");
const F = {
  po01: sql("drizzle/platform/PO01_platform_identity.sql"),
  po02a: sql("drizzle/platform/PO02A_company_foundation.sql"),
  usersKeyCic: sql("drizzle/platform/PO02D1_users_org_id_id_concurrently.sql"),
  po02d1: sql("drizzle/platform/PO02D1_onboarding_foundation.sql"),
  seed: sql("drizzle/platform/PO02D1B_seed_trial_and_settings.sql"),
  po03c: sql("drizzle/platform/PO03C_user_invitations.sql"),
};
const WATCH = ["orgs", "users", "sessions", "customers", "audit_logs", "security_events", "platform_admins", "platform_audit_events", "tenant_access_controls", "organization_invitations", "platform_settings", "subscription_packages", "subscription_package_versions", "tenant_subscriptions"];
const CUSTOMER = new Set(["orgs", "users", "sessions", "customers", "audit_logs", "security_events"]);
const STRONG = new Set(["ShareLock", "ShareRowExclusiveLock", "ExclusiveLock", "AccessExclusiveLock"]);
const strongOnCustomer = (h: Record<string, string[]>) => Object.entries(h).filter(([t, ms]) => CUSTOMER.has(t) && ms.some((x) => STRONG.has(x))).map(([t, ms]) => `${t}: ${ms.join("+")}`);

const created: string[] = [];
async function newDb(prefix: string, template: string | null = null): Promise<{ name: string; url: string }> {
  const name = disposableName(prefix);
  await withAdmin((c) => c.query(template ? `create database "${name}" template "${template}"` : `create database "${name}"`));
  created.push(name);
  return { name, url: databaseUrlFor(name) };
}
async function withDb<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = await connectDisposable(url);
  c.on("error", () => undefined);
  try {
    return await fn(c);
  } finally {
    await c.end().catch(() => undefined);
  }
}
const caught = async (p: Promise<unknown>): Promise<unknown> => p.then(() => null, (e) => e);
const exitOf = (e: unknown) => (e instanceof ManifestError ? e.exitCode : e instanceof SeedRefusedError ? e.exitCode : null);
const detailOf = (e: unknown) => (e instanceof ManifestError || e instanceof SeedRefusedError ? `${e.message} ${e.detail.join(" ")}` : describeError(e));
const ids = (r: StepResult[]) => r.map((x) => x.id).join(" ");
const outcomes = (r: StepResult[]) => r.map((x) => `${x.id}:${x.outcome}`).join(" ");
async function waitFor<T>(probe: () => Promise<T | undefined | null>, ms = 30_000): Promise<T | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await probe();
    if (v !== undefined && v !== null) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  return null;
}
const waitingPid = (obs: Client, app: string) =>
  waitFor(async () => (await obs.query(`select pid from pg_stat_activity where datname = current_database() and application_name = $1 and wait_event_type = 'Lock'`, [app])).rows[0]?.pid as number | undefined);
const auditCount = (c: Client) => c.query(`select count(*)::int as n from platform_audit_events`).then((r) => Number(r.rows[0].n));
function cli(args: string[], url: string | undefined, cwd = ROOT): { status: number | null; out: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (url === undefined) delete env.DATABASE_URL;
  else env.DATABASE_URL = url;
  // --tsconfig: the `@/` path alias must resolve when the CLI runs from a copy of the files in another directory (I2, I3).
  const r = spawnSync(join(ROOT, "node_modules", ".bin", "tsx"), ["--tsconfig", join(ROOT, "tsconfig.json"), "--conditions=react-server", join(ROOT, "scripts/platform/release-manifest.ts"), ...args], { cwd, env, encoding: "utf8", timeout: 600_000 });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.replace(/postgres(ql)?:\/\/\S+/g, "<redacted-url>") };
}

let fixture: ProductionFixture;
let tables: string[] = [];
let fpData: Record<string, string> = {};
const t: Record<string, { name: string; url: string }> = {};

/** Integrity after a scenario: the expected stage, no leftovers, every trigger enabled, existing rows byte-identical. */
async function integrity(url: string, label: string, expect: { stage: string; po03c?: string; seed?: string; invalidOk?: boolean; data?: boolean }) {
  await withDb(url, async (c) => {
    const i = await inspect(c, m);
    const problems: string[] = [];
    if (i.stage !== expect.stage) problems.push(`stage ${i.stage} (expected ${expect.stage})`);
    if (i.scratchSchemas.length) problems.push(`scratch schema ${i.scratchSchemas.join(",")}`);
    if (!expect.invalidOk && i.invalidIndexes.length) problems.push(`INVALID ${i.invalidIndexes.join(",")}`);
    if (i.disabledTriggers.length) problems.push(`disabled ${i.disabledTriggers.join(",")}`);
    if (i.immutableTriggers.length !== 2) problems.push("immutable-audit triggers missing");
    if (expect.po03c && i.po03c !== expect.po03c) problems.push(`user_invitations ${i.po03c}`);
    if (expect.seed && i.seed !== expect.seed) problems.push(`seed ${i.seed}`);
    if (expect.data !== false) {
      const changed = changedTables(fpData, await fingerprints(c, tables));
      if (changed.length) problems.push(`existing rows changed in ${changed.join(", ")}`);
    }
    ok(`${label}: integrity — stage ${expect.stage}, no scratch schema, ${expect.invalidOk ? "" : "no INVALID index, "}every trigger enabled, immutable-audit triggers present${expect.data === false ? "" : `, all ${tables.length} existing tables byte-identical`}`, problems.length === 0, problems.join("; "));
  });
}

function dataDump(url: string): string {
  const u = new URL(url);
  const r = spawnSync(
    "pg_dump",
    ["--data-only", "--no-owner", "--no-privileges", ...["public.platform_*", "public.tenant_*", "public.organization_invitation*", "public.subscription_*", "public.user_invitations"].flatMap((p) => ["--exclude-table", p])],
    { env: { ...process.env, PGHOST: u.hostname, PGPORT: u.port, PGUSER: decodeURIComponent(u.username), PGDATABASE: u.pathname.slice(1) }, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`pg_dump failed: ${(r.stderr ?? "").slice(0, 300)}`);
  return r.stdout.split("\n").filter((l) => !/^\\(un)?restrict /.test(l)).join("\n");
}
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

try {
  section("0. The production shape, the fictional company data and the intermediate states");
  const vf = verifyManifestFiles(m);
  ok("the manifest matches the repository (13 files: checksums, sizes, declared timeouts, order, coverage)", vf.length === 0, vf.join("; "));
  t.prod = await newDb("po06r_tprod");
  const push = await pushPreCompanyTenantSchema(t.prod.url);
  ok("the 621f156 tenant schema is pushed into an empty disposable database", push.ok, push.output.slice(-300));
  await withDb(t.prod.url, async (c) => {
    await c.query(IMMUTABLE);
    const i = await inspect(c, m);
    ok("…plus drizzle/immutable_audit.sql: exactly the pinned customer schema (other-projection digest c712ee56…, 1,298 lines), no platform object, both immutable-audit triggers", i.otherDigest === m.pins.baseSchema.otherDigest && i.stage === "none" && i.immutableTriggers.length === 2);
  });
  t.data = await newDb("po06r_tdata", t.prod.name);
  await withDb(t.data.url, async (c) => {
    fixture = await insertProductionFixtures(c);
    tables = await publicTables(c);
    fpData = await fingerprints(c, tables);
    const filled = await nonEmpty(c, tables);
    ok(`fictional company data: ${Object.keys(fixture.orgs).length} companies, ${Object.keys(fixture.users).length} users, rows in ${filled.length} of ${tables.length} customer tables`, filled.length >= 20, filled.join(","));
  });
  t.s03 = await newDb("po06r_ts03", t.data.name);
  await applyManifest(t.s03.url, m, { through: "S03" });
  t.s06 = await newDb("po06r_ts06", t.s03.name);
  await applyManifest(t.s06.url, m, { through: "S06" });
  t.s07 = await newDb("po06r_ts07", t.s06.name);
  await applyManifest(t.s07.url, m, { through: "S07" });
  for (const [k, v] of [["s03", "S03"], ["s06", "S05"], ["s07", "S05"]] as const) {
    await withDb(t[k].url, async (c) => {
      const i = await inspect(c, m);
      ok(`intermediate template ${k}: stage ${v}${k === "s07" ? ", Trial seed complete" : ""}; existing rows byte-identical`, i.stage === v && (k !== "s07" || i.seed === "complete") && changedTables(fpData, await fingerprints(c, tables)).length === 0);
    });
  }

  section("A. A clean, new database → the full foundation (B00 → S09)");
  const A = await newDb("po06r_a");
  const resA = await applyManifest(A.url, m, { base: true, includeStaged: true, verifyData: true });
  ok("A1 every step ran in manifest order: B00 S00 S02 S03 S05 S06 S07 S08 S09", ids(resA) === "B00 S00 S02 S03 S05 S06 S07 S08 S09", ids(resA));
  ok("A2 every modifying step 'applied', every check 'checked' — none skipped", outcomes(resA) === "B00:applied S00:checked S02:applied S03:applied S05:applied S06:checked S07:applied S08:applied S09:checked", outcomes(resA));
  const stA = await statusOf(A.url, m);
  ok("A3 the final catalog is the pinned end state: platform afterS05, M4 and the users key exactly, user_invitations (38 lines, aaec6979…), Trial complete, no finding",
    stA.inspection.stage === "S05" && stA.inspection.m4 === "present" && stA.inspection.usersKey === "present" && stA.inspection.po03c === "present" && stA.inspection.seed === "complete" && stA.findings.length === 0,
    JSON.stringify(stA.findings));
  const cliA = cli(["--status", "--json"], A.url);
  ok("A4 the CLI --status (read-only) reports the same, exit 0", cliA.status === 0 && /"stage":"S05"/.test(cliA.out), cliA.out.slice(-200));

  section("N. The release preflight and the step verification after every completed step");
  const pfA = Object.fromEntries(resA.filter((r) => r.preflight).map((r) => [r.id, `${r.preflight!.verdict}/${r.preflight!.state}`]));
  ok("N1 A: BLOCKED/REVIEWED_SQL_NOT_APPLIED through S03 (the safe in-order prefix), PUSH_SAFE/REVIEWED_SQL_COMPLETE after S05, S06 and S07, BLOCKED/COMPLETE after S08 and S09",
    pfA.S00 === "BLOCKED/REVIEWED_SQL_NOT_APPLIED" && pfA.S02 === "BLOCKED/REVIEWED_SQL_NOT_APPLIED" && pfA.S03 === "BLOCKED/REVIEWED_SQL_NOT_APPLIED" &&
      pfA.S05 === "PUSH_SAFE/REVIEWED_SQL_COMPLETE" && pfA.S06 === "PUSH_SAFE/REVIEWED_SQL_COMPLETE" && pfA.S07 === "PUSH_SAFE/REVIEWED_SQL_COMPLETE" &&
      pfA.S08 === "BLOCKED/REVIEWED_SQL_COMPLETE" && pfA.S09 === "BLOCKED/REVIEWED_SQL_COMPLETE", JSON.stringify(pfA));
  const s08 = resA.find((r) => r.id === "S08")!.preflight!;
  ok("N2 after S08 the preflight blocks exactly the two statements a push would run against the staged table (D6-F1): ALTER TABLE \"user_invitations\" DISABLE ROW LEVEL SECURITY; DROP TABLE \"user_invitations\" CASCADE",
    s08.blocking.length === 2 && STAGED_TABLE_PUSH_PLAN.every((st) => s08.blocking.some((b) => b.includes(st))), s08.blocking.join(" | "));
  ok("N3 every result carries its post-verification notes (the catalog stage it reached) — a step is never reported complete without them", resA.every((r) => r.notes.length > 0));

  section("B. An existing ERP-shaped database with company data → additive (S00 → S09, CONCURRENTLY indexes)");
  const B = await newDb("po06r_b", t.data.name);
  const otherBefore = await withDb(B.url, async (c) => Object.values((await projectCatalog(c)).other).flat() as string[]);
  const dumpBefore = dataDump(B.url);
  const resB = await applyManifest(B.url, m, { concurrentIndexes: true, includeStaged: true, verifyData: true });
  ok("B1 every step ran: S00 S01 S02 S03 S04 S05 S06 S07 S08 S09", ids(resB) === "S00 S01 S02 S03 S04 S05 S06 S07 S08 S09", ids(resB));
  ok("B2 each modifying step verified the existing customer tables byte-identical (row fingerprints) right after it ran", resB.filter((r) => ["S01", "S02", "S03", "S04", "S05", "S07", "S08"].includes(r.id)).every((r) => r.notes.some((n) => /byte-identical/.test(n))));
  const dumpAfter = dataDump(B.url);
  ok(`B3 pg_dump --data-only of every customer table is byte-identical before and after (sha256 ${sha(dumpBefore).slice(0, 16)}, ${dumpBefore.length} bytes)`, dumpBefore === dumpAfter && dumpBefore.length > 10_000, `${dumpBefore.length} vs ${dumpAfter.length}`);
  const otherAfter = await withDb(B.url, async (c) => Object.values((await projectCatalog(c)).other).flat() as string[]);
  const added = otherAfter.filter((l) => !otherBefore.includes(l));
  const removed = otherBefore.filter((l) => !otherAfter.includes(l));
  ok("B4 the customer catalog changed ONLY additively: exactly M4 (1 line), the users key (2 lines) and the staged user_invitations objects (38 lines); nothing removed",
    removed.length === 0 && added.length === 1 + 2 + m.pins.po03c.lineCount && m.pins.m4Lines.every((l) => added.includes(l)) && m.pins.usersKeyLines.every((l) => added.includes(l)),
    `added ${added.length}, removed ${removed.length}`);
  const stB = await statusOf(B.url, m);
  ok("B5 the platform objects are the same with company data as on the empty database (one pinned fingerprint; data-independent)", stB.inspection.platformDigest === stA.inspection.platformDigest && stB.findings.length === 0);
  ok("B6 S01 (M4 CONCURRENTLY, before PO-01) is followed by the one PARTIAL_OR_DRIFTED state the manifest accepts, then the normal prefix",
    resB.find((r) => r.id === "S01")!.preflight!.state === "PARTIAL_OR_DRIFTED" && resB.find((r) => r.id === "S03")!.preflight!.state === "REVIEWED_SQL_NOT_APPLIED");

  section("C. Retry of a completed migration, and the locks each step takes");
  const fpAllB = await withDb(B.url, async (c) => fingerprints(c, await publicTables(c)));
  const auditB = await withDb(B.url, auditCount);
  const projB = await withDb(B.url, async (c) => JSON.stringify(await projectCatalog(c)));
  const resC1 = await applyManifest(B.url, m, { concurrentIndexes: true, includeStaged: true });
  ok("C1 a repeated run skips every completed step (catalog state), runs the three read-only checks, changes nothing",
    outcomes(resC1) === "S00:checked S01:skipped S02:skipped S03:skipped S04:skipped S05:skipped S06:checked S07:skipped S08:skipped S09:checked", outcomes(resC1));
  const resC2 = await applyManifest(B.url, m, { concurrentIndexes: true, includeStaged: true, reverify: true });
  ok("C2 a forced re-run of every file (--reverify) reports each step 'verified' — the files are retry-safe",
    outcomes(resC2) === "S00:checked S01:verified S02:verified S03:verified S04:verified S05:verified S06:checked S07:verified S08:verified S09:checked", outcomes(resC2));
  await withDb(B.url, async (c) => {
    const fpNow = await fingerprints(c, await publicTables(c));
    ok("C3 …and after both re-runs EVERY table — customer and platform — is byte-identical, the catalog projection is identical, and no audit record was added",
      changedTables(fpAllB, fpNow).length === 0 && JSON.stringify(await projectCatalog(c)) === projB && (await auditCount(c)) === auditB, changedTables(fpAllB, fpNow).join(","));
    const reruns: [string, string][] = [["S02", F.po01], ["S03", F.po02a], ["S05", F.po02d1], ["S08", F.po03c]];
    for (const [id, text] of reruns) {
      const held = await locksHeldAtCommit(c, text, WATCH);
      const strong = strongOnCustomer(held);
      const expectNone = id === "S03" || id === "S08";
      ok(`C4 lock record — a verify-only re-run of ${id} holds at COMMIT: ${fmtHeld(held)}${expectNone ? " (no strong lock on a customer table)" : ""}`, expectNone ? strong.length === 0 : true, strong.join("; "));
    }
  });
  const L0 = await newDb("po06r_locks", t.data.name);
  const firstApply: [string, string, string][] = [["S02", F.po01, "S00"], ["S03", F.po02a, "S02"], ["S05", F.po02d1, "S03"], ["S07", F.seed, "S06"], ["S08", F.po03c, "S07"]];
  for (const [id, text, through] of firstApply) {
    if (through !== "S00") await applyManifest(L0.url, m, { through });
    const held = await withDb(L0.url, (c) => locksHeldAtCommit(c, text, WATCH));
    const strong = strongOnCustomer(held);
    const note =
      id === "S05" ? "first application WITHOUT S04 (finding D6-F4): the plain users-key build is ALTER TABLE users ADD CONSTRAINT … UNIQUE, so ACCESS EXCLUSIVE on users is held until COMMIT — every read of users waits for the whole transaction"
      : id === "S07" ? "the seed: no customer table"
      : id === "S08" ? "first application: SHARE ROW EXCLUSIVE on orgs and users until COMMIT, nothing stronger"
      : id === "S03" ? "first application WITHOUT S01: the plain M4 build holds SHARE on sessions (session writes wait); ACCESS EXCLUSIVE only on the new tables"
      : "first application: SHARE ROW EXCLUSIVE on orgs; ACCESS EXCLUSIVE only on the new platform tables";
    const okLocks =
      id === "S07" ? strong.length === 0
      : id === "S05" ? (held.users ?? []).includes("AccessExclusiveLock") && (held.orgs ?? []).includes("ShareRowExclusiveLock")
      : id === "S03" ? (held.sessions ?? []).includes("ShareLock") && !Object.entries(held).some(([tb, ms]) => CUSTOMER.has(tb) && ms.includes("AccessExclusiveLock"))
      : !Object.entries(held).some(([tb, ms]) => CUSTOMER.has(tb) && ms.includes("AccessExclusiveLock"));
    ok(`C5 lock record — ${id} ${note}: ${fmtHeld(held)}`, okLocks, strong.join("; "));
  }
  await applyManifest(L0.url, m, { includeStaged: true });
  // the same two steps on the CONCURRENTLY path (S01 + S04, what the staging runbook uses): no ACCESS EXCLUSIVE, no SHARE
  const L1 = await newDb("po06r_locks_cic", t.data.name);
  await applyManifest(L1.url, m, { concurrentIndexes: true, through: "S02" });
  const heldS03 = await withDb(L1.url, (c) => locksHeldAtCommit(c, F.po02a, WATCH));
  ok(`C6 lock record — S03 after S01 (M4 pre-built CONCURRENTLY): ${fmtHeld(heldS03)} — no lock stronger than SHARE ROW EXCLUSIVE on a customer table, none on sessions beyond ACCESS SHARE`,
    !(heldS03.sessions ?? []).some((x) => x !== "AccessShareLock") && !Object.entries(heldS03).some(([tb, ms]) => CUSTOMER.has(tb) && ms.some((x) => x === "AccessExclusiveLock" || x === "ShareLock")));
  await applyManifest(L1.url, m, { concurrentIndexes: true, through: "S04" });
  const heldS05 = await withDb(L1.url, (c) => locksHeldAtCommit(c, F.po02d1, WATCH));
  ok(`C7 lock record — S05 after S04 (the users key built CONCURRENTLY and attached in its own statement): ${fmtHeld(heldS05)} — SHARE ROW EXCLUSIVE at most on orgs and users, never ACCESS EXCLUSIVE or SHARE`,
    !Object.entries(heldS05).some(([tb, ms]) => CUSTOMER.has(tb) && ms.some((x) => x === "AccessExclusiveLock" || x === "ShareLock")) && (heldS05.users ?? []).includes("ShareRowExclusiveLock"));
  await applyManifest(L1.url, m, { concurrentIndexes: true, includeStaged: true });

  section("D. Interrupted migrations — the backend is terminated in the middle");
  // D1: a single-transaction step (S05) killed while it waits for a lock: nothing it did survives.
  const D1 = await newDb("po06r_d1", t.s03.name);
  await withDb(D1.url, async (blocker) => {
    await blocker.query("begin");
    await blocker.query("update users set name = name where id = $1", [fixture.users.a1owner]);
    const run = caught(applyManifest(D1.url, m, { through: "S05" }));
    await withDb(D1.url, async (obs) => {
      const pid = await waitingPid(obs, "platform-release-manifest");
      ok("D1 S05 (one transaction) is observed waiting for the users lock held by an open customer transaction", Boolean(pid));
      // two cheap probes while it waits (its lock_timeout is 5 s), then the kill
      const mid = (await obs.query(`select to_regclass('public.platform_settings') is null and to_regclass('public.tenant_primary_owners') is null as invisible, (select count(*)::int from pg_namespace where nspname = 'po02d1_reference') as scratch`)).rows[0];
      if (pid) await obs.query("select pg_terminate_backend($1)", [pid]);
      ok("…while it waits, nothing it has created is visible to any other session (no onboarding table, no scratch schema)", mid.invisible === true && mid.scratch === 0, JSON.stringify(mid));
    });
    const err = await run;
    ok("…pg_terminate_backend ends it: the step fails (57P01), it is NOT reported complete", exitOf(err) === 1 && /57P01|terminat/i.test(detailOf(err)), detailOf(err));
    await blocker.query("rollback");
  });
  await integrity(D1.url, "D1 after the kill", { stage: "S03" });
  const resD1 = await applyManifest(D1.url, m, { includeStaged: true, verifyData: true });
  ok("D1 a re-run resumes at S05 (S02, S03 skipped) and completes", outcomes(resD1).startsWith("S00:checked S02:skipped S03:skipped S05:applied") && /S09:checked$/.test(outcomes(resD1)), outcomes(resD1));
  // D2: the CONCURRENTLY users-key build killed: an INVALID index is left — refused, recovered, re-run.
  const D2 = await newDb("po06r_d2", t.s03.name);
  await withDb(D2.url, async (blocker) => {
    await blocker.query("begin");
    await blocker.query("update users set name = name where id = $1", [fixture.users.bowner]);
    const run = caught(applyManifest(D2.url, m, { concurrentIndexes: true, through: "S04" }));
    await withDb(D2.url, async (obs) => {
      const pid = await waitingPid(obs, "platform-release-manifest");
      const q = pid ? String((await obs.query(`select query from pg_stat_activity where pid = $1`, [pid])).rows[0]?.query ?? "") : "";
      ok("D2 the CONCURRENTLY build (S04) is observed waiting for the transaction that was already open", Boolean(pid) && /CREATE UNIQUE INDEX CONCURRENTLY/i.test(q), q.slice(0, 80));
      if (pid) await obs.query("select pg_terminate_backend($1)", [pid]);
    });
    const err = await run;
    ok("…killed, the step fails and is not reported complete", exitOf(err) === 1, detailOf(err));
    await blocker.query("rollback");
  });
  await withDb(D2.url, async (c) => {
    const i = await inspect(c, m);
    ok("D2 an INVALID users_org_id_id_uq is left behind — the manifest sees it as 'invalid', never as complete", i.usersKey === "invalid" && i.invalidIndexes.includes("users_org_id_id_uq"), `${i.usersKey} ${i.invalidIndexes}`);
    const runbookErr = await caught((async () => { for (const s of autocommitStatements(F.usersKeyCic)) await c.query(s); })());
    ok("…the runbook file itself refuses to build over it (P0001) and names the recovery: DROP INDEX CONCURRENTLY", sqlState(runbookErr) === "P0001" && /DROP INDEX CONCURRENTLY/.test(`${describeError(runbookErr)} ${(runbookErr as { hint?: string })?.hint ?? ""}`), describeError(runbookErr));
  });
  const d2Refused = await caught(applyManifest(D2.url, m, { concurrentIndexes: true }));
  ok("…and the tool refuses at S00 (exit 3) with I-01 and the same recovery", exitOf(d2Refused) === 3 && /I-01.*DROP INDEX CONCURRENTLY/.test(detailOf(d2Refused)), detailOf(d2Refused));
  await integrity(D2.url, "D2 after the kill (the INVALID index is the only leftover)", { stage: "S03", invalidOk: true });
  await withDb(D2.url, (c) => c.query("drop index concurrently public.users_org_id_id_uq"));
  const resD2 = await applyManifest(D2.url, m, { concurrentIndexes: true, includeStaged: true, verifyData: true });
  ok("D2 after the recovery (DROP INDEX CONCURRENTLY) the re-run builds the key again and completes", /S04:applied/.test(outcomes(resD2)) && /S09:checked$/.test(outcomes(resD2)), outcomes(resD2));
  // D3: the Trial seed CANCELLED (an operator's Ctrl-C: pg_cancel_backend) while it waits for its catalog lock.
  const D3 = await newDb("po06r_d3", t.s06.name);
  const auditD3 = await withDb(D3.url, auditCount);
  await withDb(D3.url, async (blocker) => {
    await blocker.query("begin");
    await blocker.query("lock table platform_settings in row exclusive mode");
    const run = caught(applyManifest(D3.url, m, { through: "S07" }));
    await withDb(D3.url, async (obs) => {
      const pid = await waitingPid(obs, "platform-seed");
      ok("D3 the seed transaction (S07) is observed waiting for its SHARE ROW EXCLUSIVE lock on platform_settings", Boolean(pid));
      if (pid) await obs.query("select pg_cancel_backend($1)", [pid]);
    });
    const err = await run;
    ok("…cancelled (57014), the step fails and is not reported complete", sqlState(err) === "57014" || /57014|cancel/i.test(describeError(err)), describeError(err));
    await blocker.query("rollback");
  });
  await withDb(D3.url, async (c) => ok("D3 nothing of the seed survives: no Trial, no settings row, no audit record", (await checkTrialSeed(c)).state === "absent" && (await auditCount(c)) === auditD3));
  await integrity(D3.url, "D3 after the cancellation", { stage: "S05", seed: "absent" });
  const resD3 = await applyManifest(D3.url, m, { through: "S07" });
  ok("D3 a re-run seeds normally", /S07:applied/.test(outcomes(resD3)), outcomes(resD3));

  section("E. Migration failure and transaction rollback — a real lock timeout (55P03)");
  const E = await newDb("po06r_e", t.s03.name);
  await withDb(E.url, async (blocker) => {
    await blocker.query("begin");
    await blocker.query("update users set name = name where id = $1", [fixture.users.a1owner]);
    const t0 = Date.now();
    const run = caught(applyManifest(E.url, m, { through: "S05" }));
    let queued = -1;
    let queuedOk = false;
    await withDb(E.url, async (obs) => {
      const pid = await waitingPid(obs, "platform-release-manifest");
      ok("E1 S05 waits for SHARE ROW EXCLUSIVE on users behind the open customer transaction", Boolean(pid));
      await withDb(E.url, async (writer) => {
        const tw = Date.now();
        await writer.query("update users set name = name where id = $1", [fixture.users.bowner]);
        queued = Date.now() - tw;
        queuedOk = true;
      });
    });
    const err = await run;
    const elapsed = Date.now() - t0;
    ok(`E2 the migration gives up after its lock_timeout (5 s): SQLSTATE 55P03, the step fails and is not complete (${elapsed} ms in all)`, exitOf(err) === 1 && /55P03/.test(detailOf(err)), detailOf(err));
    ok(`E3 lock-queue effect, measured: a customer UPDATE of ANOTHER user that arrived while the migration waited queued behind it for ${queued} ms — bounded by the 5 s lock_timeout, then it ran`, queuedOk && queued >= 1_000 && queued <= 7_000, String(queued));
    await blocker.query("rollback");
  });
  await integrity(E.url, "E after the timeout", { stage: "S03" });
  const resE = await applyManifest(E.url, m, { includeStaged: true, verifyData: true });
  ok("E4 once the long transaction is gone the same step succeeds", /S05:applied/.test(outcomes(resE)) && /S09:checked$/.test(outcomes(resE)), outcomes(resE));

  section("F. Missing prerequisites");
  const F1 = await newDb("po06r_f1");
  const f1 = await caught(applyManifest(F1.url, m));
  ok("F1 an empty database (no ERP schema) is refused at S00 (exit 3, T-02) — no table created", exitOf(f1) === 3 && /T-02/.test(detailOf(f1)) && (await withDb(F1.url, async (c) => Number((await c.query(`select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'`)).rows[0].n))) === 0, detailOf(f1));
  const cliF1 = cli(["--apply"], F1.url);
  ok("…the CLI says the same: exit 3", cliF1.status === 3, cliF1.out.slice(-200));
  const notTest = new URL(databaseUrlFor(F1.name));
  notTest.pathname = "/postgres";
  const cliF1b = cli(["--status"], notTest.toString());
  ok("…a database without the _test_only_ marker is refused before any connection (exit 2)", cliF1b.status === 2 && /REFUSED/.test(cliF1b.out), cliF1b.out.slice(-160));
  const cliF1c = cli(["--status"], "postgres://po06@db.example.invalid:5432/elite_test_only_x");
  ok("…and so is a non-loopback host (exit 2)", cliF1c.status === 2 && /REFUSED/.test(cliF1c.out), cliF1c.out.slice(-160));
  const F2 = await newDb("po06r_f2", t.data.name);
  const f2 = await withDb(F2.url, (c) => caught(c.query(F.po02d1)));
  await withDb(F2.url, (c) => c.query("rollback").catch(() => undefined));
  ok("F2 PO-02D1 run out of order (no PO-01A / PO-02A) refuses in its own precondition (P0001)", sqlState(f2) === "P0001", describeError(f2));
  await integrity(F2.url, "F2", { stage: "none" });
  const F3 = await newDb("po06r_f3", t.s03.name);
  const f3 = await caught(runSeed(F3.url));
  ok("F3 the Trial seed before PO-02D1 is refused by its preflight gate (exit 3) — nothing written", exitOf(f3) === 3, detailOf(f3));
  await integrity(F3.url, "F3", { stage: "S03" });
  const f4 = await withDb(F3.url, (c) => caught(c.query(F.po03c)));
  await withDb(F3.url, (c) => c.query("rollback").catch(() => undefined));
  ok("F4 PO-03C before PO-02D1 refuses in its own precondition (P0001)", sqlState(f4) === "P0001", describeError(f4));
  await integrity(F3.url, "F4", { stage: "S03", po03c: "absent" });

  section("G. Unexpected existing tables and columns");
  const G1 = await newDb("po06r_g1", t.data.name);
  await applyManifest(G1.url, m, { through: "S02" });
  await withDb(G1.url, (c) => c.query(`create table public.tenant_access_controls (org_id integer primary key, access_status text not null, unexpected_note text)`));
  const g1 = await caught(applyManifest(G1.url, m, { through: "S03" }));
  ok("G1 a pre-existing, differently shaped tenant_access_controls: the tool refuses at S00 (exit 3, D-01 drifted)", exitOf(g1) === 3 && /D-01/.test(detailOf(g1)), detailOf(g1));
  const g1f = await withDb(G1.url, async (c) => { const e = await caught(c.query(F.po02a)); await c.query("rollback").catch(() => undefined); return e; });
  ok("…and PO-02A itself aborts naming the table (42P07 duplicate_table: 'already exists with a different shape; nothing was applied')", sqlState(g1f) === SQL_SHAPE && /tenant_access_controls.*different shape/.test(describeError(g1f)), describeError(g1f).slice(0, 200));
  await withDb(G1.url, async (c) => ok("…organization_invitations was not created", (await c.query(`select to_regclass('public.organization_invitations') is null as x`)).rows[0].x === true));
  await integrity(G1.url, "G1", { stage: "drifted" });
  const G2 = await newDb("po06r_g2", t.data.name);
  await withDb(G2.url, (c) => c.query(`create table public.platform_admins (id uuid primary key)`));
  const g2 = await caught(applyManifest(G2.url, m));
  ok("G2a a grossly malformed pre-existing platform_admins (one column): refused at S00 (exit 3, D-01) before PO-01 runs", exitOf(g2) === 3 && /D-01/.test(detailOf(g2)), detailOf(g2));
  const g2f = await withDb(G2.url, async (c) => { const e = await caught(c.query(F.po01)); await c.query("rollback").catch(() => undefined); return e; });
  ok("…PO-01's own SQL fails only by accident — its first index names a missing column (42703) — it has no shape check", sqlState(g2f) === "42703" && /email_normalized/.test(describeError(g2f)), describeError(g2f).slice(0, 200));
  await integrity(G2.url, "G2a", { stage: "drifted" });
  // D6-F2: a table with PO-01's own columns but without the bcrypt-only CHECK. PO-01's `CREATE TABLE IF NOT EXISTS` skips it silently.
  const adminsDdl = /CREATE TABLE IF NOT EXISTS platform_admins \([\s\S]*?\n\);/.exec(F.po01)?.[0] ?? "";
  const weakened = adminsDdl.replace(/\n[ \t]*CONSTRAINT platform_admins_password_hash_chk CHECK \([^\n]*\),/, "");
  ok("G2b fixture: PO-01's own platform_admins statement with only the bcrypt-only CHECK removed", adminsDdl.length > 0 && weakened.length < adminsDdl.length && !/platform_admins_password_hash_chk/.test(weakened));
  const G2b = await newDb("po06r_g2b", t.data.name);
  await withDb(G2b.url, (c) => c.query(weakened));
  const g2b = await caught(applyManifest(G2b.url, m));
  ok("G2b a subtly different pre-existing platform_admins (no bcrypt-only CHECK): refused at S00 (exit 3, D-01)", exitOf(g2b) === 3 && /D-01/.test(detailOf(g2b)), detailOf(g2b));
  const g2bf = await withDb(G2b.url, async (c) => {
    const e = await caught(c.query(F.po01));
    await c.query("rollback").catch(() => undefined);
    const chk = await c.query(`select count(*)::int as n from pg_constraint where conrelid = 'public.platform_admins'::regclass and conname = 'platform_admins_password_hash_chk'`);
    return { e, chk: Number(chk.rows[0].n), i: await inspect(c, m) };
  });
  ok("…PO-01's own SQL does NOT notice: it succeeds (CREATE … IF NOT EXISTS) and leaves the table without its bcrypt-only CHECK — only the manifest's catalog fingerprint stops this (D6-F2)", g2bf.e === null && g2bf.chk === 0 && g2bf.i.stage === "drifted", `${describeError(g2bf.e)} check=${g2bf.chk} stage=${g2bf.i.stage}`);
  await integrity(G2b.url, "G2b", { stage: "drifted" });
  const G3 = await newDb("po06r_g3", t.s06.name);
  await withDb(G3.url, (c) => c.query(`alter table public.subscription_packages add column unexpected_column text`));
  const g3 = await caught(applyManifest(G3.url, m));
  ok("G3 an unexpected column on an installed onboarding table: refused at S00 (exit 3, D-01)", exitOf(g3) === 3 && /D-01/.test(detailOf(g3)), detailOf(g3));
  const g3f = await withDb(G3.url, async (c) => { const e = await caught(c.query(F.po02d1)); await c.query("rollback").catch(() => undefined); return e; });
  ok("…a PO-02D1 re-run aborts naming the table (42P07 duplicate_table, 'different shape; nothing was applied')", sqlState(g3f) === SQL_SHAPE && /subscription_packages.*different shape/.test(describeError(g3f)), describeError(g3f).slice(0, 200));
  await integrity(G3.url, "G3", { stage: "drifted" });
  const G4 = await newDb("po06r_g4", t.s07.name);
  await withDb(G4.url, (c) => c.query(`create table public.user_invitations (id uuid primary key, org_id integer not null)`));
  const g4 = await caught(applyManifest(G4.url, m, { includeStaged: true }));
  ok("G4 an unexpected user_invitations: refused at S00 (exit 3, D-03)", exitOf(g4) === 3 && /D-03/.test(detailOf(g4)), detailOf(g4));
  const g4f = await withDb(G4.url, async (c) => { const e = await caught(c.query(F.po03c)); await c.query("rollback").catch(() => undefined); return e; });
  ok("…PO-03C aborts naming the table (42P07 duplicate_table, 'different shape; nothing was applied')", sqlState(g4f) === SQL_SHAPE && /user_invitations.*different shape/.test(describeError(g4f)), describeError(g4f).slice(0, 200));
  await integrity(G4.url, "G4", { stage: "S05", po03c: "different" });

  section("H. Conflicting constraints and indexes");
  const H1 = await newDb("po06r_h1", t.s03.name);
  await withDb(H1.url, (c) => c.query(`alter table public.users add constraint users_org_id_id_uq unique (org_id, id)`));
  const h1 = await caught(applyManifest(H1.url, m));
  ok("H1 users_org_id_id_uq with the wrong column order: refused at S00 (exit 3, D-02)", exitOf(h1) === 3 && /D-02/.test(detailOf(h1)), detailOf(h1));
  const h1f = await withDb(H1.url, async (c) => { const e = await caught(c.query(F.po02d1)); await c.query("rollback").catch(() => undefined); return e; });
  ok("…PO-02D1 refuses it (42710 duplicate_object, 'users_org_id_id_uq with a different definition; nothing was applied')", sqlState(h1f) === SQL_DEFINITION && /users_org_id_id_uq.*different definition/.test(describeError(h1f)), describeError(h1f).slice(0, 200));
  const h1r = await withDb(H1.url, (c) => caught((async () => { for (const s of autocommitStatements(F.usersKeyCic)) await c.query(s); })()));
  ok("…and so does the CONCURRENTLY runbook (P0001)", sqlState(h1r) === "P0001", describeError(h1r).slice(0, 200));
  const H2 = await newDb("po06r_h2", t.s03.name);
  await withDb(H2.url, (c) => c.query(`alter table public.tenant_access_controls add constraint po06_unexpected_check check (org_id > 0)`));
  const h2 = await caught(applyManifest(H2.url, m));
  ok("H2 an extra constraint on a PO-02A table: refused at S00 (exit 3, D-01)", exitOf(h2) === 3 && /D-01/.test(detailOf(h2)), detailOf(h2));
  const h2f = await withDb(H2.url, async (c) => { const e = await caught(c.query(F.po02a)); await c.query("rollback").catch(() => undefined); return e; });
  ok("…a PO-02A re-run aborts naming the table (42P07 duplicate_table: an extra constraint is a different shape)", sqlState(h2f) === SQL_SHAPE && /tenant_access_controls.*different shape/.test(describeError(h2f)), describeError(h2f).slice(0, 200));
  // PO-01A first (S02, without S01), so that PO-02A reaches its index check instead of its PO-01A precondition.
  const H3 = await newDb("po06r_h3", t.data.name);
  await applyManifest(H3.url, m, { through: "S02" });
  await withDb(H3.url, (c) => c.query(`create index sessions_org_active_idx on public.sessions (org_id)`));
  const h3 = await caught(applyManifest(H3.url, m));
  ok("H3 sessions_org_active_idx with a different definition: refused at S00 (exit 3, D-02)", exitOf(h3) === 3 && /D-02/.test(detailOf(h3)), detailOf(h3));
  const h3f = await withDb(H3.url, async (c) => { const e = await caught(c.query(F.po02a)); await c.query("rollback").catch(() => undefined); return e; });
  ok("…PO-02A refuses it (42710 duplicate_object, 'sessions_org_active_idx … different definition; nothing was applied')", sqlState(h3f) === SQL_DEFINITION && /sessions_org_active_idx.*different definition/.test(describeError(h3f)), describeError(h3f).slice(0, 200));
  for (const [k, d] of [["H1", H1], ["H2", H2], ["H3", H3]] as const) await integrity(d.url, k, { stage: k === "H3" ? "S02" : k === "H2" ? "drifted" : "S03", data: true });

  section("I. Incorrect SQL checksum");
  const I = await newDb("po06r_i", t.data.name);
  const tampered: Manifest = JSON.parse(JSON.stringify(m));
  tampered.files.find((f) => f.step === "S03")!.sha256 = "0".repeat(64);
  const i1 = await caught(applyManifest(I.url, tampered));
  ok("I1 a manifest checksum that does not match the file: refused with exit 5 before any connection", exitOf(i1) === 5 && /checksum|does not match/.test(detailOf(i1)), detailOf(i1).slice(0, 200));
  await integrity(I.url, "I1", { stage: "none" });
  const tmp = mkdtempSync(join(tmpdir(), "po06-manifest-"));
  try {
    mkdirSync(join(tmp, "docs", "platform-owner", "po06"), { recursive: true });
    cpSync(join(ROOT, "drizzle"), join(tmp, "drizzle"), { recursive: true });
    cpSync(join(ROOT, "docs/platform-owner/po06/D6_MIGRATION_MANIFEST.json"), join(tmp, "docs/platform-owner/po06/D6_MIGRATION_MANIFEST.json"));
    ok("I2 an untouched copy of the files passes --check (exit 0)", cli(["--check"], undefined, tmp).status === 0);
    const target = join(tmp, "drizzle/platform/PO02A_company_foundation.sql");
    writeFileSync(target, readFileSync(target, "utf8").replace("Platform Owner", "Platform 0wner"));
    const vt = verifyManifestFiles(m, tmp);
    ok("I3 one changed byte in PO02A_company_foundation.sql (same size) is named: its sha256 differs", vt.length === 1 && /PO02A_company_foundation\.sql: sha256/.test(vt[0]), vt.join("; "));
    const ct = cli(["--check"], undefined, tmp);
    ok("…and the CLI --check exits 5", ct.status === 5 && /MISMATCH/.test(ct.out), ct.out.slice(-200));
    writeFileSync(join(tmp, "drizzle/platform/PO99_unreviewed.sql"), "select 1;\n");
    ok("I4 an unreviewed SQL file added beside them is reported as not covered by the manifest", verifyManifestFiles(m, tmp).some((f) => /PO99_unreviewed\.sql: a reviewed SQL file the manifest does not cover/.test(f)));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  section("J. The Trial seed and its guarded rollback");
  const J = await newDb("po06r_j", t.s07.name);
  const auditJ = await withDb(J.url, auditCount);
  const resJ1 = await applyManifest(J.url, m, { through: "S07", reverify: true });
  ok("J1 the seed re-run verifies the approved values and writes nothing (not even an audit record)", /S07:verified/.test(outcomes(resJ1)) && (await withDb(J.url, auditCount)) === auditJ, outcomes(resJ1));
  await withDb(J.url, (c) => c.query(`update platform_settings set default_trial_days = 21 where id = 1`));
  const j2 = await caught(rollbackManifest(J.url, m, "R07"));
  ok("J2 settings changed after seeding (21 days): the seed rollback REFUSES (exit 4) and names the difference", exitOf(j2) === 4 && /default_trial_days|settings/i.test(detailOf(j2)), detailOf(j2).slice(0, 240));
  await withDb(J.url, async (c) => ok("…nothing was removed: the Trial package, version 1 and the settings row are all still there", (await c.query(`select (select count(*) from subscription_packages)::int + (select count(*) from subscription_package_versions)::int + (select count(*) from platform_settings)::int as n`)).rows[0].n === 3));
  await withDb(J.url, (c) => c.query(`update platform_settings set default_trial_days = 14 where id = 1`));
  const resJ3 = await rollbackManifest(J.url, m, "R07");
  await withDb(J.url, async (c) => {
    ok("J3 with the approved value back, R08 (nothing to undo) then R07 remove the seed: Trial absent, one rollback audit record", outcomes(resJ3) === "R08:skipped R07:applied" && (await checkTrialSeed(c)).state === "absent" && (await auditCount(c)) === auditJ + 1, outcomes(resJ3));
  });
  const resJ4 = await rollbackManifest(J.url, m, "R07");
  ok("J4 a repeated rollback changes and records nothing", outcomes(resJ4) === "R08:skipped R07:skipped" && (await withDb(J.url, auditCount)) === auditJ + 1, outcomes(resJ4));
  const resJ5 = await applyManifest(J.url, m, { includeStaged: true });
  ok("J5 seeding again after the rollback works (a second creation record), and so does S08", /S07:applied/.test(outcomes(resJ5)) && /S08:applied/.test(outcomes(resJ5)), outcomes(resJ5));
  const j6 = await caught(runSeed(J.url, { rollback: true }));
  ok("J6 the seed rollback run directly while user_invitations exists is refused by its preflight gate (exit 3): R08 must come first", exitOf(j6) === 3, detailOf(j6).slice(0, 200));
  await integrity(J.url, "J", { stage: "S05", seed: "complete", po03c: "present" });

  section("K. The staged user_invitations installation (S08)");
  await withDb(A.url, async (c) => {
    const n = (await c.query(
      `select (select count(*) from pg_trigger t where t.tgrelid = 'public.user_invitations'::regclass and not t.tgisinternal and t.tgenabled = 'O')::int as trg,
              (select count(*) from pg_constraint where conrelid = 'public.user_invitations'::regclass)::int as con,
              (select count(*) from pg_index where indrelid = 'public.user_invitations'::regclass)::int as idx,
              to_regprocedure('public.user_invitation_guard()') is not null as fn`,
    )).rows[0];
    ok("K1 user_invitations: 2 enabled triggers, 15 constraints, 6 indexes, user_invitation_guard() — the reviewed shape", n.trg === 2 && n.con === 15 && n.idx === 6 && n.fn === true, JSON.stringify(n));
    await c.query("begin");
    const org = Number((await c.query(`insert into orgs (name) values ('Fictional Probe Co') returning id`)).rows[0].id);
    const admin = String((await c.query(`insert into platform_admins (email_normalized, display_name, password_hash, mfa_secret_encrypted, mfa_enrolled_at) values ('probe@platform-fixture.test', 'Fictional Operator', $1, 'v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB==:CCCCCCCC', now()) returning id`, [await bcrypt.hash("Fictional-Passw0rd!x", 4)])).rows[0].id);
    const inv = String((await c.query(`insert into user_invitations (org_id, name, email_normalized, requested_role, token_hash, invited_by_platform_admin_id) values ($1, 'Fictional Invitee', 'invitee@fixture-po06.test', 'staff', $2, $3) returning id`, [org, "a".repeat(64), admin])).rows[0].id);
    const probe = async (stmt: string) => {
      await c.query("savepoint p");
      const e = await caught(c.query(stmt, stmt.includes("$1") ? [inv] : []));
      await c.query("rollback to savepoint p");
      return e;
    };
    const upd = await probe(`update user_invitations set email_normalized = 'other@fixture-po06.test' where id = $1`);
    const del = await probe(`delete from user_invitations where id = $1`);
    const trunc = await probe(`truncate user_invitations`);
    await c.query("rollback");
    ok("K2 the guard holds on the installed table: an open invitation can be inserted; its terms cannot change, it cannot be deleted, the table cannot be truncated (probe rolled back)",
      upd !== null && del !== null && trunc !== null, `${sqlState(upd)} ${sqlState(del)} ${sqlState(trunc)}`);
    ok("…nothing of the probe persists", Number((await c.query(`select count(*)::int as n from user_invitations`)).rows[0].n) === 0);
  });
  const pfK = await runPreflight(A.url);
  ok("K3 the release preflight after S08: BLOCKED with exactly the two X-01 statements for user_invitations (push must never run after S08)",
    pfK.verdict === "BLOCKED" && pfK.findings.filter((f) => f.severity === "blocking").length === 2 && pfK.findings.filter((f) => f.severity === "blocking").every((f) => f.code === "X-01" && /user_invitations/.test(f.message)));

  section("L. user_invitations rollback on an empty table, and the full rollback chain");
  const auditA = await withDb(A.url, auditCount);
  const resL1 = await rollbackManifest(A.url, m, "R08");
  await withDb(A.url, async (c) => {
    const rec = Number((await c.query(`select count(*)::int as n from platform_audit_events where action = 'schema.user_invitations_removed'`)).rows[0].n);
    ok("L1 R08 on an empty table removes the table, its two triggers and the guard function, and appends one audit record", outcomes(resL1) === "R08:applied" && (await inspect(c, m)).po03c === "absent" && (await auditCount(c)) === auditA + 1 && rec === 1, outcomes(resL1));
  });
  const resL2 = await rollbackManifest(A.url, m, "R08");
  ok("L2 a repeated R08 is skipped and records nothing", outcomes(resL2) === "R08:skipped" && (await withDb(A.url, auditCount)) === auditA + 1);
  const resL3 = await applyManifest(A.url, m, { includeStaged: true });
  ok("L3 S08 installs it again, exactly to the pin", /S08:applied/.test(outcomes(resL3)) && (await statusOf(A.url, m)).inspection.po03c === "present", outcomes(resL3));
  const Lf = await newDb("po06r_lfull", t.data.name);
  await applyManifest(Lf.url, m, { concurrentIndexes: true, includeStaged: true });
  const resL4 = await rollbackManifest(Lf.url, m, "R03");
  await withDb(Lf.url, async (c) => {
    const i = await inspect(c, m);
    ok("L4 the full chain R08 → R07 → R05 → R04 → R03 runs in order on a company database", outcomes(resL4) === "R08:applied R07:applied R05:applied R04:applied R03:applied", outcomes(resL4));
    ok("…the customer schema is EXACTLY the 621f156 shape again (pinned other-projection digest): M4 and the users key are gone, nothing else changed",
      i.otherDigest === m.pins.baseSchema.otherDigest && i.m4 === "absent" && i.usersKey === "absent", i.otherDigest.slice(0, 16));
    ok("…PO-01A remains (stage S02): no reviewed rollback exists for it, and its audit trail keeps the record of every step", i.stage === "S02" && (await auditCount(c)) > 0);
  });
  await integrity(Lf.url, "L4", { stage: "S02" });
  const l5 = await caught(rollbackManifest(Lf.url, m, "R02"));
  ok("L5 R02 refuses (exit 3): removing PO-01A needs its own owner-approved, backed-up plan (D6-F3); R08–R03 are skipped as already undone", exitOf(l5) === 3 && /no reviewed rollback/.test(detailOf(l5)), detailOf(l5));

  section("M. Refusal to drop user_invitations while it holds a record");
  const M = await newDb("po06r_m", t.s07.name);
  await applyManifest(M.url, m, { includeStaged: true });
  const auditM = await withDb(M.url, async (c) => {
    const admin = String((await c.query(`insert into platform_admins (email_normalized, display_name, password_hash, mfa_secret_encrypted, mfa_enrolled_at) values ('keeper@platform-fixture.test', 'Fictional Operator', $1, 'v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB==:CCCCCCCC', now()) returning id`, [await bcrypt.hash("Fictional-Passw0rd!x", 4)])).rows[0].id);
    await c.query(`insert into user_invitations (org_id, name, email_normalized, requested_role, token_hash, invited_by_platform_admin_id) values ($1, 'Fictional Invitee', 'kept.invitee@fixture-po06.test', 'staff', $2, $3)`, [fixture.orgs.A1, "b".repeat(64), admin]);
    return auditCount(c);
  });
  const mErr = await caught(rollbackManifest(M.url, m, "R08"));
  await withDb(M.url, async (c) => {
    ok("M1 R08 with one record in user_invitations is REFUSED (exit 4): 'holds 1 row(s); nothing was changed'", exitOf(mErr) === 4 && /holds 1 row/.test(detailOf(mErr)), detailOf(mErr));
    ok("…the table, its triggers and the record are intact, and no audit record was added", (await inspect(c, m)).po03c === "present" && Number((await c.query(`select count(*)::int as n from user_invitations`)).rows[0].n) === 1 && (await auditCount(c)) === auditM);
  });
  await integrity(M.url, "M", { stage: "S05", po03c: "present", seed: "complete" });

  section("+ A least-privilege runtime role (the staging recommendation), checked statement by statement");
  await withDb(B.url, async (c) => {
    await c.query("begin");
    await c.query(`create role po06_test_only_app nologin`);
    await c.query(`grant usage on schema public to po06_test_only_app`);
    await c.query(`grant select, insert, update, delete on all tables in schema public to po06_test_only_app`);
    await c.query(`grant usage, select on all sequences in schema public to po06_test_only_app`);
    await c.query(`set local role po06_test_only_app`);
    const attempt = async (stmt: string) => {
      await c.query("savepoint s");
      const e = await caught(c.query(stmt));
      await c.query("rollback to savepoint s");
      return e;
    };
    const reads = await attempt(`select count(*) from orgs`);
    const writes = await attempt(`insert into customers (org_id, name) values (${fixture.orgs.A1}, 'Fictional Runtime Customer')`);
    const disable = await attempt(`alter table audit_logs disable trigger audit_logs_immutable`);
    const drop = await attempt(`drop table customers`);
    const create = await attempt(`create table public.po06_probe (x int)`);
    const truncate = await attempt(`truncate platform_audit_events`);
    const rewrite = await attempt(`update platform_audit_events set result = result`);
    const erase = await attempt(`delete from audit_logs`);
    await c.query("rollback");
    ok("S1 a DML-only role can read and write business rows", reads === null && writes === null, `${describeError(reads)} ${describeError(writes)}`);
    ok("S2 …but cannot disable a trigger, drop or create a table, or truncate (42501 insufficient privilege)", [disable, drop, create, truncate].every((e) => sqlState(e) === "42501"), [disable, drop, create, truncate].map(sqlState).join(","));
    ok("S3 …and the append-only triggers still refuse to rewrite or erase audit history", rewrite !== null && erase !== null, `${sqlState(rewrite)} ${sqlState(erase)}`);
  });
  ok("S4 the role was created inside a transaction that was rolled back: it does not exist", (await withAdmin(async (c) => (await c.query(`select count(*)::int as n from pg_roles where rolname = 'po06_test_only_app'`)).rows[0].n)) === 0);
} catch (err) {
  ok("rehearsal completed without an unexpected error", false, describeError(err));
} finally {
  for (const name of created.reverse()) await dropDisposableDatabase(name).catch(() => undefined);
}
process.exit(summary("verify-po06-migration-rehearsal"));
