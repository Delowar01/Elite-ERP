/**
 * Platform Owner PO-06 — the D-6 migration manifest tool (docs/platform-owner/po06/D6_MIGRATION_MANIFEST.json).
 *
 * It COMPOSES the existing framework, in the manifest's order:
 *   - the fail-closed local-db-guard (loopback-only server, `*_test_only_*` name; production is refused before a
 *     connection opens);
 *   - the reviewed SQL files in drizzle/platform, executed byte for byte as their checksums were verified;
 *   - the catalog checks of scripts/platform/catalog.ts, the release preflight (H-1 / H-2 / H-3) and the guarded Trial
 *     seed runner.
 * It is not a second migration engine:
 *   - it adds no SQL, no ledger table and no target of its own;
 *   - it decides what is complete from the database catalog alone, against the manifest's pinned fingerprints;
 *   - it never runs drizzle-kit push, migrate or generate. The one exception is the restricted B00 base step on an
 *     EMPTY new database: pushPreCompanyTenantSchema, the 621f156 tenant shape, verified against its pin.
 *
 *   npx tsx --conditions=react-server scripts/platform/release-manifest.ts --check             no database: checksums, sizes,
 *                                                                                               declared timeouts, coverage
 *   npx tsx … release-manifest.ts --plan                                                        no database: the ordered steps
 *   DATABASE_URL=… npx tsx … release-manifest.ts --status [--json]                              read-only
 *   DATABASE_URL=… npx tsx … release-manifest.ts --apply [--base] [--through=S07] [--concurrent-indexes]
 *                                                [--include-staged-user-invitations] [--reverify] [--verify-data] [--json]
 *   DATABASE_URL=… npx tsx … release-manifest.ts --rollback --to=R05 [--json]                   R08 … down to the named step
 *
 * Exit: 0 ok · 1 verification failed or tool error · 2 unsafe target refused · 3 blocked (precondition or preflight) ·
 *       4 a reviewed SQL file refused (its own guard: P0001 / 23xxx) · 5 manifest or checksum mismatch (nothing connected).
 * DATABASE_URL is never printed. Development and staging preparation only: decision D-6 is open.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { assertDisposableLocalDatabaseUrl, assertDisposableLocalServer, describeTarget, UnsafeDatabaseTargetError } from "./local-db-guard";
import { checkCompanyFoundation, checkOnboardingFoundation, checkPlatformObjects, PLATFORM_OWNED_TABLES, projectCatalog, projectionDigest, type CatalogProjection } from "./catalog";
import { runPreflight } from "./release-preflight";
import { checkTrialSeed, runSeed, SeedRefusedError } from "./trial-seed";
import { pushPreCompanyTenantSchema } from "./disposable-db";

export const MANIFEST_PATH = join(process.cwd(), "docs", "platform-owner", "po06", "D6_MIGRATION_MANIFEST.json");
export const SCRATCH_SCHEMAS = ["po02a_reference", "po02d1_reference", "po03c_reference"] as const;

type Kind = "check" | "sql-transaction" | "sql-autocommit" | "seed-runner" | "none";
export type ManifestStep = { id: string; name?: string; title?: string; kind: Kind; file?: string | null; requires?: string[]; timeouts?: { lock: string; statement: string }; undoes?: string };
export type ManifestFile = { path: string; sha256: string; bytes: number; step: string };
export type Manifest = {
  manifest: string;
  manifestVersion: number;
  pins: {
    platformDigest: { none: string; afterS02: string; afterS03: string; afterS05: string };
    m4Lines: string[];
    usersKeyLines: string[];
    po03c: { objects: string[]; lineCount: number; digest: string };
    baseSchema: { otherDigest: string; otherLineCount: number };
  };
  base: (ManifestStep & { file: string })[];
  forward: ManifestStep[];
  rollback: ManifestStep[];
  files: ManifestFile[];
};

/** A refusal carrying the exit code the CLI reports. */
export class ManifestError extends Error {
  constructor(
    readonly exitCode: 1 | 3 | 4 | 5,
    message: string,
    readonly detail: string[] = [],
  ) {
    super(message);
    this.name = "ManifestError";
  }
}

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const errCode = (e: unknown) => (typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "");
const errHint = (e: unknown) => (typeof e === "object" && e !== null && "hint" in e && (e as { hint?: unknown }).hint ? ` (hint: ${String((e as { hint: unknown }).hint)})` : "");
const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/postgres(ql)?:\/\/\S+/g, "<redacted-url>");

export function loadManifest(path = MANIFEST_PATH): Manifest {
  const m = JSON.parse(readFileSync(path, "utf8")) as Manifest;
  if (m.manifest !== "elite-erp/platform-owner/d6-migration-manifest" || m.manifestVersion !== 1) throw new ManifestError(5, "not a version-1 D-6 manifest");
  return m;
}

// ── No-database checks ────────────────────────────────────────────────────────────────────────────────────────────

/** Every checksum, size, declared timeout, the step order and the coverage of drizzle/platform. Empty = consistent. */
export function verifyManifestFiles(m: Manifest, root = process.cwd()): string[] {
  const findings: string[] = [];
  const byPath = new Map(m.files.map((f) => [f.path, f]));
  if (byPath.size !== m.files.length) findings.push("a file is listed twice in files[]");
  for (const f of m.files) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(root, f.path));
    } catch {
      findings.push(`${f.path}: missing`);
      continue;
    }
    if (sha256(bytes) !== f.sha256) findings.push(`${f.path}: sha256 ${sha256(bytes)} differs from the manifest's ${f.sha256}`);
    if (bytes.length !== f.bytes) findings.push(`${f.path}: ${bytes.length} bytes, the manifest records ${f.bytes}`);
  }
  const onDisk = readdirSync(join(root, "drizzle", "platform")).filter((n) => n.endsWith(".sql")).map((n) => `drizzle/platform/${n}`).sort();
  for (const p of onDisk) if (!byPath.has(p)) findings.push(`${p}: a reviewed SQL file the manifest does not cover`);
  const steps = [...m.base, ...m.forward, ...m.rollback];
  const ids = steps.map((s) => s.id);
  if (new Set(ids).size !== ids.length) findings.push("a step id is used twice");
  for (const s of steps) {
    if (!s.file) continue;
    const f = byPath.get(s.file);
    if (!f) findings.push(`${s.id}: its file ${s.file} is not in files[]`);
    else if (f.step !== s.id) findings.push(`${s.id}: files[] assigns ${s.file} to ${f.step}`);
  }
  // order: every forward step requires only earlier forward steps
  m.forward.forEach((s, i) => {
    for (const r of s.requires ?? []) if (!m.forward.slice(0, i).some((p) => p.id === r)) findings.push(`${s.id} requires ${r}, which does not come before it`);
  });
  const fwd = m.forward.map((s) => s.id).join(",");
  if (fwd !== "S00,S01,S02,S03,S04,S05,S06,S07,S08,S09") findings.push(`forward order is ${fwd}`);
  const back = m.rollback.map((s) => s.id).join(",");
  if (back !== "R08,R07,R05,R04,R03,R02") findings.push(`rollback order is ${back}`);
  // declared timeouts and execution kind match the files themselves
  for (const s of steps) {
    if (!s.file || !s.timeouts) continue;
    let text: string;
    try {
      text = readFileSync(join(root, s.file), "utf8");
    } catch {
      continue;
    }
    if (s.kind === "sql-transaction" || s.kind === "seed-runner") {
      const lock = text.match(/^SET LOCAL lock_timeout = '([^']+)';/m)?.[1];
      const stmt = text.match(/^SET LOCAL statement_timeout = '([^']+)';/m)?.[1];
      if (lock !== s.timeouts.lock || stmt !== s.timeouts.statement) findings.push(`${s.id}: the file sets lock ${lock} / statement ${stmt}, the manifest says ${s.timeouts.lock} / ${s.timeouts.statement}`);
      if (!/^BEGIN;$/m.test(text) || !/^COMMIT;\s*$/m.test(text)) findings.push(`${s.id}: ${s.file} is not one BEGIN … COMMIT transaction`);
    }
    if (s.kind === "sql-autocommit") {
      if (/^\s*(BEGIN|START TRANSACTION)\s*;/im.test(text)) findings.push(`${s.id}: an autocommit file opens a transaction`);
      if (!/^-- statement\s*$/m.test(text)) findings.push(`${s.id}: no "-- statement" separators`);
      // a plain declared value (no prose) must be the file's own first session setting
      const lock = text.match(/^SET lock_timeout = ([^;]+);/m)?.[1].replace(/'/g, "");
      const stmt = text.match(/^SET statement_timeout = ([^;]+);/m)?.[1].replace(/'/g, "");
      if (/^\S+$/.test(s.timeouts.lock) && lock !== s.timeouts.lock) findings.push(`${s.id}: the file sets lock_timeout ${lock}, the manifest says ${s.timeouts.lock}`);
      if (/^\S+$/.test(s.timeouts.statement) && s.timeouts.statement !== "default" && stmt !== s.timeouts.statement) findings.push(`${s.id}: the file sets statement_timeout ${stmt}, the manifest says ${s.timeouts.statement}`);
    }
  }
  return findings;
}

/** The bytes of a manifest file, verified at read time: what is executed is exactly what was checked. */
function readVerified(m: Manifest, path: string, root = process.cwd()): string {
  const f = m.files.find((x) => x.path === path);
  if (!f) throw new ManifestError(5, `${path} is not in the manifest`);
  const bytes = readFileSync(join(root, path));
  if (sha256(bytes) !== f.sha256 || bytes.length !== f.bytes) throw new ManifestError(5, `${path}: checksum mismatch — refusing to execute it`, [`sha256 ${sha256(bytes)}`, `manifest ${f.sha256}`]);
  return bytes.toString("utf8");
}

// ── Read-only inspection ──────────────────────────────────────────────────────────────────────────────────────────

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
export type Stage = "none" | "S02" | "S03" | "S05" | "drifted";
export type Inspection = {
  server: { versionNum: number; encoding: string; standby: boolean; schema: string };
  erpIdentity: boolean;
  tablesInPublic: number;
  scratchSchemas: string[];
  invalidIndexes: string[];
  disabledTriggers: string[];
  immutableTriggers: string[];
  platformDigest: string;
  stage: Stage;
  m4: "absent" | "present" | "invalid" | "different";
  usersKey: "absent" | "present" | "invalid" | "different";
  po03c: "absent" | "present" | "different";
  seed: "n/a" | "absent" | "complete" | "partial" | "different";
  otherDigest: string;
};

const linesOf = (p: CatalogProjection) => Object.values(p).flat() as string[];

export async function inspect(c: Queryable, m: Manifest): Promise<Inspection> {
  const s = (await c.query(`select current_setting('server_version_num')::int as v, current_setting('server_encoding') as e, pg_is_in_recovery() as r, current_schema() as sc`)).rows[0];
  const identity = (
    await c.query(
      `select count(*)::int as n from pg_attribute a join pg_class cl on cl.oid = a.attrelid join pg_namespace n on n.oid = cl.relnamespace
       where n.nspname = 'public' and cl.relkind = 'r' and not a.attisdropped
         and (cl.relname, a.attname) in (('orgs','id'),('users','id'),('users','org_id'),('users','email'),('sessions','org_id'))`,
    )
  ).rows[0].n;
  const tables = (await c.query(`select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p')`)).rows[0].n;
  const scratch = (await c.query(`select nspname as s from pg_namespace where nspname = any($1) order by 1`, [SCRATCH_SCHEMAS])).rows.map((r) => String(r.s));
  const invalid = (
    await c.query(
      `select i.relname as n from pg_index x join pg_class i on i.oid = x.indexrelid join pg_namespace n on n.oid = i.relnamespace
       where n.nspname = 'public' and not (x.indisvalid and x.indisready) order by 1`,
    )
  ).rows.map((r) => String(r.n));
  const disabled = (
    await c.query(
      `select c.relname || '.' || t.tgname as n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and not t.tgisinternal and t.tgenabled <> 'O' order by 1`,
    )
  ).rows.map((r) => String(r.n));
  const immutable = (
    await c.query(
      `select t.tgname as n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and t.tgenabled = 'O' and (t.tgname, c.relname) in (('audit_logs_immutable','audit_logs'),('security_events_immutable','security_events')) order by 1`,
    )
  ).rows.map((r) => String(r.n));
  const proj = await projectCatalog(c as never);
  const platformDigest = projectionDigest(proj.platform);
  const pd = m.pins.platformDigest;
  const stage: Stage = platformDigest === pd.none ? "none" : platformDigest === pd.afterS02 ? "S02" : platformDigest === pd.afterS03 ? "S03" : platformDigest === pd.afterS05 ? "S05" : "drifted";
  const other = linesOf(proj.other);
  const indexValid = async (name: string) =>
    (await c.query(`select x.indisvalid and x.indisready as v from pg_index x join pg_class i on i.oid = x.indexrelid join pg_namespace n on n.oid = i.relnamespace where n.nspname = 'public' and i.relname = $1`, [name])).rows[0]?.v;
  const objectState = async (name: string, pins: string[]) => {
    const mine = other.filter((l) => l.split(" | ")[1] === name);
    if (mine.length === 0) return "absent" as const;
    if ((await indexValid(name)) === false) return "invalid" as const;
    return JSON.stringify([...mine].sort()) === JSON.stringify([...pins].sort()) ? ("present" as const) : ("different" as const);
  };
  const m4 = await objectState("sessions_org_active_idx", m.pins.m4Lines);
  const usersKey = await objectState("users_org_id_id_uq", m.pins.usersKeyLines);
  const po03cLines = other.filter((l) => m.pins.po03c.objects.some((o) => l === o || l.startsWith(`${o} |`) || l.split(" | ")[0] === o));
  const po03c = po03cLines.length === 0 ? "absent" : po03cLines.length === m.pins.po03c.lineCount && sha256(JSON.stringify([...po03cLines].sort())) === m.pins.po03c.digest ? "present" : "different";
  let seed: Inspection["seed"] = "n/a";
  if (stage === "S05") seed = (await checkTrialSeed(c as never)).state;
  return {
    server: { versionNum: Number(s.v), encoding: String(s.e), standby: Boolean(s.r), schema: String(s.sc) },
    erpIdentity: Number(identity) === 5,
    tablesInPublic: Number(tables),
    scratchSchemas: scratch,
    invalidIndexes: invalid,
    disabledTriggers: disabled,
    immutableTriggers: immutable,
    platformDigest,
    stage,
    m4,
    usersKey,
    po03c,
    seed,
    otherDigest: projectionDigest(proj.other),
  };
}

/** Findings that make any modifying step unsafe (S00): empty = the target may proceed. */
export function targetFindings(i: Inspection): string[] {
  const f: string[] = [];
  if (i.server.versionNum < 140000) f.push(`T-01 PostgreSQL ${i.server.versionNum} is older than 14`);
  if (i.server.encoding !== "UTF8") f.push(`T-06 server encoding ${i.server.encoding}, not UTF8`);
  if (i.server.standby) f.push("T-04 the target is a standby in recovery");
  if (i.server.schema !== "public") f.push(`T-05 current schema ${i.server.schema}, not public`);
  if (!i.erpIdentity) f.push("T-02 not an Elite ERP database (orgs / users / sessions identity columns missing)");
  if (i.scratchSchemas.length) f.push(`T-03 leftover scratch schema(s): ${i.scratchSchemas.join(", ")}`);
  if (i.invalidIndexes.length) f.push(`I-01 INVALID index(es) in public: ${i.invalidIndexes.join(", ")} — DROP INDEX CONCURRENTLY each, then re-run its step`);
  if (i.disabledTriggers.length) f.push(`I-02 disabled trigger(s): ${i.disabledTriggers.join(", ")}`);
  if (i.immutableTriggers.length !== 2) f.push(`I-03 immutable-audit triggers present: ${i.immutableTriggers.join(", ") || "none"} (both are required: npm run db:harden)`);
  if (i.stage === "drifted") f.push("D-01 the platform catalog matches no pinned state of the manifest (drifted, or a push-created partial schema): stop");
  if (i.m4 === "different" || i.usersKey === "different") f.push(`D-02 a key or index exists with a different definition (M4 ${i.m4}, users key ${i.usersKey})`);
  if (i.po03c === "different") f.push("D-03 user_invitations exists with a shape other than the reviewed one");
  return f;
}

// ── Execution ─────────────────────────────────────────────────────────────────────────────────────────────────────

async function guardedClient(url: string): Promise<Client> {
  const target = assertDisposableLocalDatabaseUrl(url);
  const client = new Client({ connectionString: url, application_name: "platform-release-manifest" });
  // A backend terminated mid-step (pg_terminate_backend, a server restart) fails the awaited query; without a listener the
  // client's 'error' event would also end the process before the step's failure could be reported.
  client.on("error", () => undefined);
  await client.connect();
  try {
    await assertDisposableLocalServer(client, target);
  } catch (err) {
    await client.end();
    throw err;
  }
  return client;
}

/** The statements of an autocommit runbook file, in order ("-- statement" separated; comment lines removed). */
export function autocommitStatements(text: string): string[] {
  return text
    .split(/^-- statement\s*$/m)
    .slice(1)
    .map((chunk) => chunk.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n").trim())
    .filter(Boolean);
}

async function execStep(c: Client, kind: Kind, text: string): Promise<void> {
  try {
    if (kind === "sql-transaction") await c.query(text);
    else if (kind === "sql-autocommit") for (const s of autocommitStatements(text)) await c.query(s);
    else throw new ManifestError(1, `step kind ${kind} has no SQL to execute`);
  } catch (err) {
    if (kind === "sql-transaction") await c.query("ROLLBACK").catch(() => undefined);
    if (err instanceof ManifestError) throw err;
    const code = errCode(err);
    const msg = `${errMessage(err)}${errHint(err)}`;
    if (code === "P0001" || code.startsWith("23")) throw new ManifestError(4, `the reviewed SQL refused: ${msg}`, [`SQLSTATE ${code}`]);
    throw new ManifestError(1, `the step failed (SQLSTATE ${code || "n/a"}): ${msg}`);
  }
}

/** Row fingerprints of the given tables (count + digest of every row's text, in order): read-only. */
export async function tableFingerprints(c: Queryable, tables: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of [...tables].sort()) {
    const r = (await c.query(`select count(*)::bigint as n, encode(sha256(convert_to(coalesce(string_agg(md5(x::text), '' order by md5(x::text)), ''), 'UTF8')), 'hex') as h from public."${t.replace(/"/g, "")}" x`)).rows[0];
    out[t] = `${r.n}:${r.h}`;
  }
  return out;
}

export type StepResult = {
  id: string;
  outcome: "applied" | "verified" | "skipped" | "checked";
  ms: number;
  notes: string[];
  preflight?: { verdict: string; state: string; blocking: string[]; components: Record<string, string> };
};
export type ApplyOptions = { base?: boolean; through?: string; concurrentIndexes?: boolean; includeStaged?: boolean; reverify?: boolean; verifyData?: boolean };

const complete = (id: string, i: Inspection): boolean =>
  id === "S01" ? i.m4 === "present"
  : id === "S02" ? ["S02", "S03", "S05"].includes(i.stage)
  : id === "S03" ? ["S03", "S05"].includes(i.stage)
  : id === "S04" ? i.usersKey === "present"
  : id === "S05" ? i.stage === "S05"
  : id === "S07" ? i.seed === "complete"
  : id === "S08" ? i.po03c === "present"
  : false;

async function preflightSummary(url: string): Promise<StepResult["preflight"]> {
  const p = await runPreflight(url);
  return { verdict: p.verdict, state: p.state, blocking: p.findings.filter((f) => f.severity === "blocking").map((f) => `${f.code} ${f.message.slice(0, 140)}`), components: { ...p.components } };
}

/**
 * The one PARTIAL_OR_DRIFTED state S00 accepts: M4 pre-built by S01 (CONCURRENTLY) before PO-02A has run. The preflight
 * calls PO-02A "partial" because one of its objects exists; the manifest knows it is exactly its own S01 result — the
 * platform catalog is the pinned empty or post-S02 state (no PO-02A table exists) and M4 is exactly the pinned, valid
 * index. Anything else that the preflight calls partial or drifted stays refused.
 */
export function m4PrebuiltOnly(pre: StepResult["preflight"], i: Inspection): boolean {
  return (
    pre?.state === "PARTIAL_OR_DRIFTED" &&
    ["missing", "complete"].includes(pre.components.po01a) &&
    pre.components.po02a === "partial" &&
    pre.components.f1 === "missing" &&
    pre.components.po02d1a === "missing" &&
    (i.stage === "none" || i.stage === "S02") &&
    i.m4 === "present" &&
    i.usersKey === "absent" &&
    i.po03c === "absent"
  );
}

/**
 * The two statements drizzle-kit plans for the staged table once S08 has run: src/db/schema does not declare
 * user_invitations, so a push would drop it (rehearsal finding D6-F1). The release preflight blocks both (X-01).
 */
export const STAGED_TABLE_PUSH_PLAN = ['ALTER TABLE "user_invitations" DISABLE ROW LEVEL SECURITY;', 'DROP TABLE "user_invitations" CASCADE;'] as const;

/**
 * The preflight verdict a COMPLETE foundation must show: PUSH_SAFE — except while the staged user_invitations table is
 * installed, when exactly the two X-01 findings of STAGED_TABLE_PUSH_PLAN, and nothing else, is the correct verdict
 * (manifest neverRun). Anything else blocks.
 */
export function foundationPreflightOk(pre: StepResult["preflight"], i: Inspection): boolean {
  if (!pre || pre.state !== "REVIEWED_SQL_COMPLETE") return false;
  if (i.po03c !== "present") return pre.verdict === "PUSH_SAFE" && pre.blocking.length === 0;
  const planned = pre.blocking.map((b) => b.match(/^X-01 push would run: (.+?;)/)?.[1] ?? b).sort();
  return pre.verdict === "BLOCKED" && JSON.stringify(planned) === JSON.stringify([...STAGED_TABLE_PUSH_PLAN].sort());
}

/** The catalog state each step requires before it runs (beyond the steps before it having passed their own checks). */
function expectedBefore(id: string, i: Inspection): string | null {
  if (id === "S02" && i.stage !== "none") return `S02 needs no platform object yet (stage ${i.stage})`;
  if (id === "S03" && i.stage !== "S02") return `S03 needs exactly the PO-01A objects (stage ${i.stage})`;
  if (id === "S04" && (i.stage !== "S03" || i.usersKey !== "absent")) return `S04 needs stage S03 and no users key (stage ${i.stage}, users key ${i.usersKey})`;
  if (id === "S05" && i.stage !== "S03") return `S05 needs exactly the PO-01A and PO-02A objects (stage ${i.stage})`;
  if (id === "S07" && i.stage !== "S05") return `S07 needs the complete foundation (stage ${i.stage})`;
  if (id === "S08" && (i.stage !== "S05" || i.seed !== "complete")) return `S08 needs the foundation and the Trial seed (stage ${i.stage}, seed ${i.seed})`;
  return null;
}

/** Post-step verification: the catalog must hold exactly what the step promises; otherwise the step is NOT complete. */
async function verifyAfter(c: Client, m: Manifest, id: string, url: string, opts: { staged?: boolean } = {}): Promise<{ notes: string[]; preflight: StepResult["preflight"] }> {
  const i = await inspect(c, m);
  const problems = targetFindings(i);
  const want = (ok: boolean, what: string) => {
    if (!ok) problems.push(what);
  };
  const pd = m.pins.platformDigest;
  if (id === "S01") want(i.m4 === "present", `M4 is ${i.m4}`);
  if (id === "S02") {
    // "at least this step's state": a re-verified early step on a later database must find the later pinned state
    want([pd.afterS02, pd.afterS03, pd.afterS05].includes(i.platformDigest), "platform fingerprint is not a pinned state at or after S02");
    const r = await checkPlatformObjects(c as never);
    if (!r.ok) problems.push(...r.findings);
  }
  if (id === "S03") {
    want([pd.afterS03, pd.afterS05].includes(i.platformDigest), "platform fingerprint is not a pinned state at or after S03");
    want(i.m4 === "present", `M4 is ${i.m4}`);
    const r = await checkCompanyFoundation(c as never);
    if (!r.ok) problems.push(...r.findings);
  }
  if (id === "S04") want(i.usersKey === "present", `the users key is ${i.usersKey}`);
  if (["S05", "S06", "S07", "S08", "S09"].includes(id)) {
    want(i.platformDigest === pd.afterS05, "platform fingerprint is not the pinned post-S05 state");
    want(i.usersKey === "present" && i.m4 === "present", `users key ${i.usersKey}, M4 ${i.m4}`);
    for (const r of [await checkPlatformObjects(c as never), await checkCompanyFoundation(c as never), await checkOnboardingFoundation(c as never)]) if (!r.ok) problems.push(...r.findings);
  }
  if (id === "S07" || id === "S08" || id === "S09") want(i.seed === "complete", `the Trial seed is ${i.seed}`);
  if (id === "S08") want(i.po03c === "present", `user_invitations is ${i.po03c}`);
  if (id === "S09") want(opts.staged ? i.po03c === "present" : i.po03c === "absent", `user_invitations is ${i.po03c} (staged step ${opts.staged ? "included" : "not included"})`);
  const preflight = await preflightSummary(url);
  if (["S05", "S06", "S07", "S08", "S09"].includes(id)) want(foundationPreflightOk(preflight, i), `preflight ${preflight?.verdict} / ${preflight?.state}: ${preflight?.blocking.join("; ")}`);
  if (problems.length) throw new ManifestError(1, `${id} is NOT complete: its post-verification failed`, problems);
  return { notes: [`stage ${i.stage}; M4 ${i.m4}; users key ${i.usersKey}; seed ${i.seed}; user_invitations ${i.po03c}`], preflight };
}

/** B00 — a NEW, EMPTY database only: the 621f156 tenant schema plus the immutable-audit hardening, verified. */
export async function applyBase(url: string, m: Manifest): Promise<StepResult> {
  const t0 = Date.now();
  const hardening = readVerified(m, "drizzle/immutable_audit.sql");
  const c = await guardedClient(url);
  try {
    const n = Number((await c.query(`select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p','v','m','S')`)).rows[0].n);
    if (n > 0) throw new ManifestError(3, `B00 refused: public already holds ${n} relation(s); the base step is only for a new, empty database`);
    const push = await pushPreCompanyTenantSchema(url);
    if (!push.ok) throw new ManifestError(1, "B00: the restricted base push failed", [push.output.slice(-600)]);
    await c.query(hardening);
    const i = await inspect(c, m);
    const problems: string[] = [];
    if (i.otherDigest !== m.pins.baseSchema.otherDigest) problems.push("the customer schema is not the pinned 621f156 shape");
    if (i.stage !== "none") problems.push("a platform object exists after the base step");
    if (i.immutableTriggers.length !== 2) problems.push("the immutable-audit triggers are missing");
    if (problems.length) throw new ManifestError(1, "B00 is NOT complete", problems);
    return { id: "B00", outcome: "applied", ms: Date.now() - t0, notes: ["621f156 tenant shape + immutable-audit triggers; fingerprint matches the pin"] };
  } finally {
    await c.end();
  }
}

/** Forward steps in manifest order; each preconditioned, executed, verified and followed by the release preflight. */
export async function applyManifest(url: string, m: Manifest, opts: ApplyOptions = {}): Promise<StepResult[]> {
  const fileFindings = verifyManifestFiles(m);
  if (fileFindings.length) throw new ManifestError(5, "the manifest does not match the repository; nothing was connected", fileFindings);
  assertDisposableLocalDatabaseUrl(url);
  const results: StepResult[] = [];
  if (opts.base) results.push(await applyBase(url, m));
  const c = await guardedClient(url);
  try {
    const t0 = Date.now();
    const i0 = await inspect(c, m);
    const blocked = targetFindings(i0);
    const pre = await preflightSummary(url);
    if (pre && !["REVIEWED_SQL_NOT_APPLIED", "REVIEWED_SQL_COMPLETE"].includes(pre.state) && !m4PrebuiltOnly(pre, i0)) blocked.push(`P-00 release preflight state ${pre.state}: ${pre.blocking.join("; ")}`);
    if (blocked.length) throw new ManifestError(3, "S00: the target is not safe to migrate; nothing was changed", blocked);
    // customer tables only: platform tables legitimately gain rows (the seed, the rollback and migration audit records)
    const platformOwned = new Set<string>([...PLATFORM_OWNED_TABLES, "user_invitations"]);
    const preTables = (await c.query(`select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`)).rows
      .map((r) => String(r.t))
      .filter((name) => !platformOwned.has(name));
    const before = opts.verifyData ? await tableFingerprints(c, preTables) : null;
    results.push({ id: "S00", outcome: "checked", ms: Date.now() - t0, notes: [`stage ${i0.stage}; ${preTables.length} existing customer tables`], preflight: pre });
    if (opts.through && !m.forward.some((s) => s.id === opts.through)) throw new ManifestError(5, `unknown step ${opts.through}`);
    const stop = opts.through ? m.forward.findIndex((s) => s.id === opts.through) : m.forward.length - 1;
    for (const [index, step] of m.forward.entries()) {
      if (step.id === "S00") continue;
      if (index > stop) break;
      const t1 = Date.now();
      if (step.kind === "check") {
        const v = await verifyAfter(c, m, step.id, url, { staged: Boolean(opts.includeStaged) });
        results.push({ id: step.id, outcome: "checked", ms: Date.now() - t1, notes: v.notes, preflight: v.preflight });
        continue;
      }
      if ((step.id === "S01" || step.id === "S04") && !opts.concurrentIndexes) continue;
      if (step.id === "S08" && !opts.includeStaged) continue;
      const state = await inspect(c, m);
      if (complete(step.id, state) && !opts.reverify) {
        results.push({ id: step.id, outcome: "skipped", ms: Date.now() - t1, notes: ["already complete (catalog state)"] });
        continue;
      }
      const wasComplete = complete(step.id, state);
      const notReady = wasComplete ? null : expectedBefore(step.id, state);
      if (notReady) throw new ManifestError(3, `${step.id} blocked: ${notReady}; nothing was changed by this step`);
      if (step.kind === "seed-runner" && wasComplete && state.po03c === "present") {
        // --reverify after S08: the seed runner's gate needs PUSH_SAFE, which is impossible while the staged table exists
        // (D6-F1) — so the seed is verified READ-ONLY instead, never re-run around the gate.
        const seed = await checkTrialSeed(c as never);
        if (seed.state !== "complete") throw new ManifestError(1, `S07: the Trial seed is ${seed.state}`, seed.findings);
        results.push({ id: step.id, outcome: "verified", ms: Date.now() - t1, notes: ["verified read-only (checkTrialSeed): after S08 the seed runner's preflight gate refuses by design (D6-F1)"] });
        continue;
      }
      if (step.kind === "seed-runner") {
        try {
          await runSeed(url);
        } catch (err) {
          if (err instanceof SeedRefusedError) throw new ManifestError(err.exitCode === 4 ? 4 : err.exitCode === 3 ? 3 : 1, `S07: ${err.message}`, err.detail);
          throw err;
        }
      } else {
        const text = readVerified(m, step.file as string);
        await execStep(c, step.kind, text);
      }
      const v = await verifyAfter(c, m, step.id, url);
      if (before) {
        const after = await tableFingerprints(c, preTables);
        const changed = preTables.filter((t) => before[t] !== after[t]);
        if (changed.length) throw new ManifestError(1, `${step.id}: existing table data changed`, changed);
        v.notes.push(`${preTables.length} existing customer tables byte-identical (row fingerprints)`);
      }
      results.push({ id: step.id, outcome: wasComplete ? "verified" : "applied", ms: Date.now() - t1, notes: v.notes, preflight: v.preflight });
    }
    return results;
  } finally {
    await c.end();
  }
}

/** A rollback step whose object is already gone is skipped (the chain is idempotent); R02 has nothing to run. */
const rolledBack = (id: string, i: Inspection): boolean =>
  id === "R08" ? i.po03c === "absent"
  : id === "R07" ? i.stage !== "S05" || i.seed === "absent"
  : id === "R05" ? i.stage !== "S05"
  : id === "R04" ? i.usersKey === "absent"
  : id === "R03" ? i.stage !== "S03" && i.m4 === "absent"
  : id === "R02" ? i.stage === "none"
  : false;

/** Rollback steps R08 … down to `to` (inclusive), each guarded by its own reviewed SQL (refusals are never overridden). */
export async function rollbackManifest(url: string, m: Manifest, to: string): Promise<StepResult[]> {
  const fileFindings = verifyManifestFiles(m);
  if (fileFindings.length) throw new ManifestError(5, "the manifest does not match the repository; nothing was connected", fileFindings);
  const last = m.rollback.findIndex((s) => s.id === to);
  if (last < 0) throw new ManifestError(5, `unknown rollback step ${to}`);
  const results: StepResult[] = [];
  const c = await guardedClient(url);
  try {
    for (const step of m.rollback.slice(0, last + 1)) {
      const t0 = Date.now();
      const before = await inspect(c, m);
      if (rolledBack(step.id, before)) {
        results.push({ id: step.id, outcome: "skipped", ms: Date.now() - t0, notes: ["nothing to undo (catalog state)"] });
        continue;
      }
      if (before.po03c === "different" || before.stage === "drifted") throw new ManifestError(3, `${step.id} blocked: the catalog is drifted (stage ${before.stage}, user_invitations ${before.po03c}); nothing was changed`);
      if (step.kind === "none") throw new ManifestError(3, `${step.id}: no reviewed rollback exists for ${step.undoes}; stop (an owner-approved, backed-up plan is required)`);
      if (step.kind === "seed-runner") {
        try {
          await runSeed(url, { rollback: true });
        } catch (err) {
          if (err instanceof SeedRefusedError) throw new ManifestError(err.exitCode === 4 ? 4 : err.exitCode === 3 ? 3 : 1, `${step.id}: ${err.message}`, err.detail);
          throw err;
        }
      } else {
        await execStep(c, step.kind, readVerified(m, step.file as string));
      }
      const i = await inspect(c, m);
      results.push({ id: step.id, outcome: "applied", ms: Date.now() - t0, notes: [`stage ${i.stage}; M4 ${i.m4}; users key ${i.usersKey}; seed ${i.seed}; user_invitations ${i.po03c}`] });
    }
    return results;
  } finally {
    await c.end();
  }
}

export async function statusOf(url: string, m: Manifest): Promise<{ inspection: Inspection; findings: string[]; complete: string[] }> {
  const c = await guardedClient(url);
  try {
    await c.query("set default_transaction_read_only = on");
    const i = await inspect(c, m);
    return { inspection: i, findings: targetFindings(i), complete: m.forward.filter((s) => complete(s.id, i)).map((s) => s.id) };
  } finally {
    await c.end();
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const has = (f: string) => argv.includes(f);
  const val = (f: string) => argv.find((a) => a.startsWith(`${f}=`))?.slice(f.length + 1);
  const json = has("--json");
  const out = (x: unknown, text: () => void) => (json ? console.log(JSON.stringify(x)) : text());
  try {
    const m = loadManifest();
    if (has("--check")) {
      const f = verifyManifestFiles(m);
      out({ ok: f.length === 0, findings: f, files: m.files.length }, () => {
        for (const x of f) console.error(`  MISMATCH ${x}`);
        console.log(f.length === 0 ? `OK: ${m.files.length} files, checksums, sizes, timeouts, order and coverage match the manifest` : `FAILED: ${f.length} finding(s)`);
      });
      process.exitCode = f.length === 0 ? 0 : 5;
      return;
    }
    if (has("--plan")) {
      out({ base: m.base, forward: m.forward, rollback: m.rollback }, () => {
        for (const s of [...m.base, ...m.forward, ...m.rollback]) console.log(`  ${s.id} ${s.kind ?? "base"} ${s.file ?? ""} ${s.title ?? s.undoes ?? ""}`.trimEnd());
      });
      return;
    }
    const url = process.env.DATABASE_URL;
    const target = assertDisposableLocalDatabaseUrl(url);
    if (!json) console.log(`release-manifest → ${describeTarget(target)} (development / staging preparation only)`);
    if (has("--status")) {
      const s = await statusOf(url as string, m);
      out(s, () => {
        console.log(`  stage ${s.inspection.stage}; complete: ${s.complete.join(", ") || "none"}`);
        for (const f of s.findings) console.log(`  FINDING ${f}`);
      });
      return;
    }
    if (has("--apply")) {
      const r = await applyManifest(url as string, m, {
        base: has("--base"),
        through: val("--through"),
        concurrentIndexes: has("--concurrent-indexes"),
        includeStaged: has("--include-staged-user-invitations"),
        reverify: has("--reverify"),
        verifyData: has("--verify-data"),
      });
      out(r, () => {
        for (const s of r) console.log(`  ${s.id} ${s.outcome} (${s.ms} ms) ${s.notes.join("; ")}${s.preflight ? ` · preflight ${s.preflight.verdict}/${s.preflight.state}` : ""}`);
        console.log("RESULT: APPLIED");
      });
      return;
    }
    if (has("--rollback")) {
      const to = val("--to");
      if (!to) throw new ManifestError(5, "--rollback needs --to=<step>");
      const r = await rollbackManifest(url as string, m, to);
      out(r, () => {
        for (const s of r) console.log(`  ${s.id} ${s.outcome} (${s.ms} ms) ${s.notes.join("; ")}`);
        console.log("RESULT: ROLLED_BACK");
      });
      return;
    }
    console.error("usage: --check | --plan | --status | --apply [...] | --rollback --to=<step>");
    process.exitCode = 1;
  } catch (err) {
    if (err instanceof UnsafeDatabaseTargetError) {
      console.error(`REFUSED [${err.reasonCode}] ${err.message}`);
      process.exitCode = 2;
      return;
    }
    if (err instanceof ManifestError) {
      console.error(`release-manifest: ${err.message}`);
      for (const d of err.detail) console.error(`  ${d}`);
      process.exitCode = err.exitCode;
      return;
    }
    console.error(`release-manifest failed (fail closed): ${errMessage(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && /release-manifest\.ts$/.test(process.argv[1])) void main();
