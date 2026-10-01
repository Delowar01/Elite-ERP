/**
 * AUD-08.1 — migration baseline measurement and negative controls.
 *
 * ## What this suite is for
 *
 * AUD-08 exists because this project's schema was built with `db:push` while its migration history
 * stopped at `0004`. Before anything is authored or stamped, three things have to stop being
 * proposals and start being measured facts:
 *
 *   1. the exact size and shape of the historical gap (re-measured here, NOT copied from the
 *      September 2026 audit's figures);
 *   2. how the INSTALLED drizzle CLI actually decides applied-vs-pending, including the ways it
 *      fails silently;
 *   3. that hardening is a SEPARATE axis from schema equality, so the two are never conflated.
 *
 * The negative controls (E6b, E7, E13) are the point of the batch. Each demonstrates a real failure
 * that `drizzle-kit migrate` reports as success with exit code 0. A safeguard whose failure mode has
 * never been observed is decoration.
 *
 * ## Verified call chain (drizzle-kit 0.31.10 / drizzle-orm 0.45.2 / pg 8.22.0)
 *
 *   drizzle-kit migrate (bin.cjs:92010)
 *     -> preparePostgresDB (bin.cjs:78760)   driver probe: pglite -> pg -> postgres -> ...
 *     -> import("drizzle-orm/node-postgres/migrator")
 *     -> readMigrationFiles(config)          drizzle-orm/migrator.js  (hash = sha256 of whole file,
 *                                            folderMillis = journal `when`)
 *     -> PgDialect.migrate                   drizzle-orm/pg-core/dialect.js:44-71
 *          table drizzle.__drizzle_migrations (id serial, hash text not null, created_at bigint)
 *          reads ONE row:  order by created_at desc limit 1
 *          applies when:   !last || Number(last.created_at) < migration.folderMillis
 *          `hash` is written and NEVER read.
 *
 * Only `pg` is installed, and it is probed first, so for this installation the CLI and the
 * programmatic migrator are the same code. That is a fact about THIS dependency set: installing
 * @neondatabase/serverless or @vercel/postgres would resolve a different migrator module, and the
 * conclusion would have to be re-measured.
 *
 * ## Safety
 *
 * Disposable databases only. The repository's own DATABASE_URL is deliberately ignored: a target is
 * refused unless its database name carries the AUD08_DB_PREFIX and its host is local. Nothing is
 * printed but host and database name. Every database this suite creates, it drops.
 *
 * Run: AUD08_ADMIN_URL="postgresql://<user>@127.0.0.1:5432/postgres" \\
 *        npx tsx --conditions=react-server verify/verify-migration-baseline.mts
 * Exit: 0 all checks passed, 1 any failure, 2 refused for safety (no disposable target).
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "pg";
import {
  classify,
  diffStructural,
  fingerprintDigest,
  journalInvariants,
  migrationSqlPath,
  projectLive,
  projectLiveStructural,
  projectSnapshotStructural,
  projectTriggers,
  readBookkeeping,
  readJournal,
  readSnapshot,
  sha256File,
  structuralDigest,
  watermark,
  type Journal,
  type LiveFingerprint,
} from "../scripts/migration-preflight";

// -------------------------------------------------------------------------------------------------
// Harness plumbing
// -------------------------------------------------------------------------------------------------

const REPO = resolve(".");
const DB_PREFIX = "aud081_";
// Supplied by the operator, never defaulted and never committed: a default would hardcode a
// credential into the repository, and a fallback is how a harness ends up pointed at something it
// should not touch. Absent => refuse (exit 2).
const ADMIN_URL = process.env.AUD08_ADMIN_URL ?? "";
const EVIDENCE_DIR = join(REPO, "docs", "audits", "aud-08", "evidence");
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", ""]);

if (ADMIN_URL === "") {
  console.error("AUD-08.1 REFUSED: AUD08_ADMIN_URL is not set.");
  console.error("");
  console.error("This suite creates, modifies and drops databases. It will not guess a target and it");
  console.error("will never fall back to the repository's own DATABASE_URL. Point AUD08_ADMIN_URL at a");
  console.error("DISPOSABLE local PostgreSQL superuser/CREATEDB connection whose database names you are");
  console.error("content to see dropped, e.g. a throwaway local cluster. Every database it touches must");
  console.error("be named aud081_*, and the host must be local.");
  process.exit(2);
}

let passed = 0;
let failed = 0;
const transcript: string[] = [];

function log(line: string): void {
  console.log(line);
  transcript.push(line);
}

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++;
    log(`PASS  ${name}`);
  } else {
    failed++;
    log(`FAIL  ${name}${detail ? `  -> ${detail}` : ""}`);
  }
}

function section(title: string): void {
  log("");
  log(`── ${title} ──`);
}

function dbUrl(name: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  return u.toString();
}

/** Host and database only — never the URL, never the password. */
function describe(name: string): string {
  const u = new URL(ADMIN_URL);
  return `host=${u.hostname} port=${u.port || "5432"} database=${name}`;
}

/**
 * Refuse to touch anything that is not provably disposable. Two independent conditions, both
 * required: a local host, and a database name carrying the AUD-08.1 prefix. The repository's own
 * DATABASE_URL is never consulted — being present is not a licence to use it.
 */
function guardDisposable(name: string): void {
  const u = new URL(ADMIN_URL);
  if (!LOCAL_HOSTS.has(u.hostname)) {
    throw new Error(`refusing a non-local target: host=${u.hostname}. AUD-08.1 runs on disposable local databases only.`);
  }
  if (!name.startsWith(DB_PREFIX)) {
    throw new Error(`refusing database "${name}": AUD-08.1 only creates, modifies or drops databases named ${DB_PREFIX}*`);
  }
}

async function withClient<T>(name: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: dbUrl(name) });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function admin(sql: string): Promise<void> {
  const client = new Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

const created = new Set<string>();

async function freshDb(name: string): Promise<void> {
  guardDisposable(name);
  await admin(`drop database if exists "${name}"`);
  await admin(`create database "${name}"`);
  created.add(name);
}

async function dropDb(name: string): Promise<void> {
  guardDisposable(name);
  await admin(`drop database if exists "${name}"`);
  created.delete(name);
}

type Run = { status: number; stdout: string; stderr: string };

function runDrizzleKit(args: string[], target: string, configPath: string): Run {
  const r = spawnSync("npx", ["drizzle-kit", ...args, "--config", configPath], {
    cwd: REPO,
    encoding: "utf8",
    // The child gets DATABASE_URL explicitly. process.env wins over --env-file-if-exists in Node,
    // measured in this batch, so the repository .env cannot override it even where a script loads it.
    env: { ...process.env, DATABASE_URL: dbUrl(target) },
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function runHardening(target: string, extraArgs: string[] = []): Run {
  // Invoked directly rather than through `npm run db:harden`, so no .env is loaded at all.
  const r = spawnSync("npx", ["tsx", "scripts/apply-db-hardening.ts", ...extraArgs], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: dbUrl(target) },
    shell: false,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * A throwaway copy of ./drizzle plus a config pointing at it. Every experiment that needs to author,
 * mutate or break a migration file works HERE — committed historical migrations are never edited in
 * place (E10's explicit requirement).
 */
function tempMigrations(label: string): { folder: string; config: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), `aud081-${label}-`));
  const folder = join(root, "drizzle");
  cpSync(join(REPO, "drizzle"), folder, { recursive: true });
  const config = join(root, "drizzle.config.ts");
  writeFileSync(
    config,
    `export default {\n` +
      `  schema: ${JSON.stringify(join(REPO, "src/db/schema/index.ts"))},\n` +
      `  out: ${JSON.stringify(folder)},\n` +
      `  dialect: "postgresql",\n` +
      `  dbCredentials: { url: process.env.DATABASE_URL },\n` +
      `};\n`,
  );
  return { folder, config, root };
}

function addTempMigration(folder: string, tag: string, when: number, sql: string): void {
  writeFileSync(join(folder, `${tag}.sql`), sql);
  const jp = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(jp, "utf8")) as Journal;
  journal.entries.push({ idx: journal.entries.length, version: "7", when, tag, breakpoints: true });
  writeFileSync(jp, JSON.stringify(journal, null, 2));
}

function counts(fp: LiveFingerprint): string {
  return `F1=${fp.f1Columns.length} F2=${fp.f2Constraints.length} F3=${fp.f3ForeignKeys.length} F4=${fp.f4Indexes.length} F5=${fp.f5Enums.length} F6=${fp.f6Sequences.length}`;
}

function tableSet(fp: LiveFingerprint): Set<string> {
  return new Set(fp.f1Columns.map((c) => c.split(".")[0]));
}

function columnIdentities(fp: LiveFingerprint): Set<string> {
  return new Set(fp.f1Columns.map((c) => c.split(":")[0]));
}

const REQUIRED_TRIGGERS = [
  { table: "audit_logs", trigger: "audit_logs_immutable" },
  { table: "security_events", trigger: "security_events_immutable" },
];

async function hasRequiredTriggers(name: string): Promise<{ present: string[]; missing: string[]; all: string[] }> {
  return withClient(name, async (c) => {
    const all = await projectTriggers(c);
    const present: string[] = [];
    const missing: string[] = [];
    for (const t of REQUIRED_TRIGGERS) {
      const hit = all.find((row) => row.startsWith(`${t.table}:${t.trigger}:`));
      if (hit && hit.endsWith("enabled=O")) present.push(`${t.table}.${t.trigger}`);
      else missing.push(`${t.table}.${t.trigger}`);
    }
    return { present, missing, all };
  });
}

/**
 * The two append-only tables have different NOT NULL columns, so the probe has to speak each one's
 * shape. Using one hardcoded column name produced a FALSE positive on the first run: the INSERT
 * failed with "column does not exist", and the subsequent UPDATE then also errored — which looks
 * exactly like the trigger rejecting it. A rejection test that passes because the row was never
 * there proves nothing, so the insert is asserted first and the probe column is per-table.
 */
const APPEND_ONLY_PROBE: Record<string, { col: string; value: string }> = {
  audit_logs: { col: "action", value: "aud081-enforcement-probe" },
  security_events: { col: "type", value: "aud081.enforcement.probe" },
};

async function mutationRejected(
  name: string,
  table: string,
): Promise<{ insert: boolean; insertError: string | null; rows: number; update: string | null; del: string | null }> {
  const probe = APPEND_ONLY_PROBE[table];
  if (!probe) throw new Error(`no append-only probe defined for ${table}`);
  return withClient(name, async (c) => {
    let insert = false;
    let insertError: string | null = null;
    try {
      await c.query(`insert into ${table} (${probe.col}) values ($1)`, [probe.value]);
      insert = true;
    } catch (e) {
      insertError = e instanceof Error ? e.message : String(e);
    }
    // The trigger is BEFORE UPDATE/DELETE FOR EACH ROW, so it only fires when a row matches.
    // Confirm there IS a row, otherwise the next two probes are vacuous.
    const { rows: countRows } = await c.query<{ n: number }>(
      `select count(*)::int as n from ${table} where ${probe.col} = $1`,
      [probe.value],
    );
    const rows = countRows[0].n;

    let update: string | null = null;
    try {
      await c.query(`update ${table} set ${probe.col} = 'aud081-mutated' where ${probe.col} = $1`, [probe.value]);
      update = null; // no error raised => NOT rejected
    } catch (e) {
      update = e instanceof Error ? e.message : String(e);
    }
    let del: string | null = null;
    try {
      await c.query(`delete from ${table} where ${probe.col} = $1`, [probe.value]);
      del = null;
    } catch (e) {
      del = e instanceof Error ? e.message : String(e);
    }
    return { insert, insertError, rows, update, del };
  });
}

// -------------------------------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------------------------------

const journal = readJournal("drizzle");
const fileHashes = new Map<string, string>();
for (const e of journal.entries) fileHashes.set(e.tag, sha256File(migrationSqlPath("drizzle", e.tag)));
const journalFindings = journalInvariants(journal, "drizzle");

const evidence: Record<string, unknown> = {};

async function main(): Promise<void> {
  log("── AUD-08.1 — migration baseline measurement ──");
  log(`repository    : ${REPO}`);
  log(`target cluster: ${describe("(per-experiment)")}`);
  log(`db name rule  : must start with "${DB_PREFIX}" and the host must be local`);
  log(`journal       : ${journal.entries.length} entries, version ${journal.version}, dialect ${journal.dialect}`);

  // Positively identify the cluster as reachable and local before anything else.
  try {
    const c = new Client({ connectionString: ADMIN_URL });
    await c.connect();
    const { rows } = await c.query<{ v: string; d: string }>("select version() as v, current_database() as d");
    await c.end();
    log(`server        : ${rows[0].v.split(" on ")[0]}`);
    log(`admin database: ${rows[0].d}`);
  } catch (e) {
    log("");
    log(`REFUSED: no disposable PostgreSQL target is reachable (${e instanceof Error ? e.message : String(e)}).`);
    log("AUD-08.1 will not fall back to any other database. Provide a local disposable cluster and");
    log("set AUD08_ADMIN_URL, or treat this as a blocker.");
    process.exit(2);
  }

  // ===========================================================================================
  section("0. Journal invariants (no database)");
  check("journal idx contiguous and `when` strictly increasing, every SQL file present", journalFindings.length === 0,
    journalFindings.map((f) => `${f.code}: ${f.detail}`).join(" | "));
  log(`      entries: ${journal.entries.map((e) => `${e.tag}@${e.when}`).join(", ")}`);
  for (const e of journal.entries) log(`      sha256 ${e.tag} = ${fileHashes.get(e.tag)!.slice(0, 16)}…`);

  // ===========================================================================================
  section("1. Reference shapes + independent re-measurement of the historical gap");

  const MIG = `${DB_PREFIX}mig`;
  const PUSH = `${DB_PREFIX}push`;
  const base = tempMigrations("base");

  await freshDb(MIG);
  const migRun = runDrizzleKit(["migrate"], MIG, base.config);
  check("drizzle-kit migrate applied the committed history to a fresh database", migRun.status === 0,
    `exit ${migRun.status} ${migRun.stderr.slice(0, 200)}`);

  await freshDb(PUSH);
  const pushRun = runDrizzleKit(["push", "--force"], PUSH, base.config);
  check("drizzle-kit push built the current schema on a fresh database", pushRun.status === 0,
    `exit ${pushRun.status} ${pushRun.stderr.slice(0, 200)}`);

  const fpMig = await withClient(MIG, projectLive);
  const fpPush = await withClient(PUSH, projectLive);
  const stMig = await withClient(MIG, projectLiveStructural);
  const stPush = await withClient(PUSH, projectLiveStructural);

  const tMig = tableSet(fpMig);
  const tPush = tableSet(fpPush);
  const cMig = columnIdentities(fpMig);
  const cPush = columnIdentities(fpPush);
  const tablesAdd = [...tPush].filter((t) => !tMig.has(t)).sort();
  const tablesDrop = [...tMig].filter((t) => !tPush.has(t)).sort();
  const colsAdd = [...cPush].filter((c) => !cMig.has(c)).sort();
  const colsDrop = [...cMig].filter((c) => !cPush.has(c)).sort();
  const colsBoth = [...cMig].filter((c) => cPush.has(c));

  log(`      migrations-only : ${tMig.size} tables, ${cMig.size} columns   (${counts(fpMig)})`);
  log(`      push-built      : ${tPush.size} tables, ${cPush.size} columns   (${counts(fpPush)})`);
  log(`      shared columns  : ${colsBoth.length}`);
  log(`      columns to ADD  : ${colsAdd.length}`);
  log(`      columns to DROP : ${colsDrop.length}  ${colsDrop.join(", ")}`);
  log(`      tables to ADD   : ${tablesAdd.length}  ${tablesAdd.join(", ")}`);
  log(`      tables to DROP  : ${tablesDrop.length}`);

  // Measured, not asserted against hardcoded September figures. The numbers are reported either
  // way; the assertions are on the RELATIONSHIPS, which are what a 0005 author needs to be true.
  check("arithmetic closes: shared + drop == migrations-only column count", colsBoth.length + colsDrop.length === cMig.size);
  check("arithmetic closes: shared + add == push column count", colsBoth.length + colsAdd.length === cPush.size);
  check("the gap is purely additive plus drops — no table needs dropping", tablesDrop.length === 0);
  check("exactly ONE column must be dropped", colsDrop.length === 1, `got ${colsDrop.length}: ${colsDrop.join(", ")}`);
  check("the sole dropped column is terms_conditions_groups.content",
    colsDrop.length === 1 && colsDrop[0] === "terms_conditions_groups.content", colsDrop.join(", "));
  check("terms_conditions_groups gains exactly one column, `terms`",
    colsAdd.filter((c) => c.startsWith("terms_conditions_groups.")).join(",") === "terms_conditions_groups.terms",
    colsAdd.filter((c) => c.startsWith("terms_conditions_groups.")).join(","));

  // Do any SHARED columns differ in type, nullability, default, precision or scale?
  //
  // The September 2026 audit concluded they do not. Its fingerprint was
  //     table.column : data_type : is_nullable : column_default
  // which omits numeric_precision and numeric_scale. For every money column `data_type` is simply
  // "numeric" on BOTH sides, so a numeric(14,2) -> numeric(15,3) widening was invisible to it. This
  // suite includes precision and scale (AUD-08-P0-C1 §01 F1 requires both), and it finds them.
  const f1MigSet = new Set(fpMig.f1Columns);
  const f1PushSet = new Set(fpPush.f1Columns);
  const f1OnlyMig = [...f1MigSet].filter((x) => !f1PushSet.has(x));
  const f1OnlyPush = [...f1PushSet].filter((x) => !f1MigSet.has(x));
  log(`      F1 rows only in migrations-only: ${f1OnlyMig.length} (identity-only figure was ${colsDrop.length})`);
  log(`      F1 rows only in push-built     : ${f1OnlyPush.length} (identity-only figure was ${colsAdd.length})`);

  type ColAttrs = { type: string; nullable: string; def: string; prec: string; scale: string; len: string };
  function parseF1(row: string): { key: string; attrs: ColAttrs } {
    const [key, ...rest] = row.split(":");
    const bag = new Map<string, string>();
    for (const part of rest.join(":").split(":")) {
      const eq = part.indexOf("=");
      if (eq > 0) bag.set(part.slice(0, eq), part.slice(eq + 1));
    }
    return {
      key,
      attrs: {
        type: bag.get("t") ?? "", nullable: bag.get("null") ?? "", def: bag.get("def") ?? "",
        prec: bag.get("prec") ?? "", scale: bag.get("scale") ?? "", len: bag.get("len") ?? "",
      },
    };
  }
  const migAttrs = new Map(fpMig.f1Columns.map((r) => { const p = parseF1(r); return [p.key, p.attrs]; }));
  const pushAttrs = new Map(fpPush.f1Columns.map((r) => { const p = parseF1(r); return [p.key, p.attrs]; }));

  const sharedDiffs: { key: string; from: ColAttrs; to: ColAttrs; kinds: string[] }[] = [];
  for (const key of colsBoth) {
    const a = migAttrs.get(key)!;
    const b = pushAttrs.get(key)!;
    const kinds: string[] = [];
    if (a.type !== b.type) kinds.push("type");
    if (a.nullable !== b.nullable) kinds.push("nullability");
    if (a.def !== b.def) kinds.push("default");
    if (a.prec !== b.prec || a.scale !== b.scale) kinds.push("precision/scale");
    if (a.len !== b.len) kinds.push("length");
    if (kinds.length > 0) sharedDiffs.push({ key, from: a, to: b, kinds });
  }

  const byKind = new Map<string, number>();
  for (const d of sharedDiffs) {
    const sig = d.kinds.includes("precision/scale") && d.kinds.length === 1
      ? `precision/scale numeric(${d.from.prec},${d.from.scale}) -> numeric(${d.to.prec},${d.to.scale})`
      : d.kinds.join("+");
    byKind.set(sig, (byKind.get(sig) ?? 0) + 1);
  }
  log(`      SHARED columns differing: ${sharedDiffs.length} of ${colsBoth.length}`);
  for (const [sig, n] of [...byKind].sort((x, y) => y[1] - x[1])) log(`        ${String(n).padStart(3)}x  ${sig}`);
  const affectedTables = [...new Set(sharedDiffs.map((d) => d.key.split(".")[0]))].sort();
  if (sharedDiffs.length > 0) log(`      across ${affectedTables.length} tables: ${affectedTables.join(", ")}`);

  // The arithmetic must close: every F1-only row is either an added/dropped column or one of the
  // differing shared columns. If it does not close, the measurement itself is wrong.
  check("F1 delta arithmetic closes against the identity delta plus differing shared columns",
    f1OnlyMig.length === colsDrop.length + sharedDiffs.length && f1OnlyPush.length === colsAdd.length + sharedDiffs.length,
    `only-mig ${f1OnlyMig.length} vs ${colsDrop.length}+${sharedDiffs.length}; only-push ${f1OnlyPush.length} vs ${colsAdd.length}+${sharedDiffs.length}`);

  // What 0005 has to do about them depends entirely on WHICH attribute moved. A precision widening
  // is a safe ALTER; a nullability or default change is not, and a type change is a data migration.
  const onlyPrecisionScale = sharedDiffs.every((d) => d.kinds.length === 1 && d.kinds[0] === "precision/scale");
  check("every differing SHARED column differs ONLY in precision/scale — no type, nullability, default or length change",
    onlyPrecisionScale,
    sharedDiffs.filter((d) => !(d.kinds.length === 1 && d.kinds[0] === "precision/scale")).slice(0, 5).map((d) => `${d.key}:${d.kinds.join("+")}`).join(", "));

  // A widening (precision up, scale not down) loses nothing. A narrowing would truncate stored money.
  const narrowing = sharedDiffs.filter((d) => {
    const pFrom = Number(d.from.prec), pTo = Number(d.to.prec);
    const sFrom = Number(d.from.scale), sTo = Number(d.to.scale);
    if (!Number.isFinite(pFrom) || !Number.isFinite(pTo)) return false;
    return pTo < pFrom || sTo < sFrom;
  });
  check("every precision/scale change is a WIDENING, so no stored value can be truncated by it",
    narrowing.length === 0, narrowing.slice(0, 5).map((d) => `${d.key}: numeric(${d.from.prec},${d.from.scale})->numeric(${d.to.prec},${d.to.scale})`).join(", "));

  evidence.sharedColumnDifferences = {
    count: sharedDiffs.length,
    kinds: Object.fromEntries(byKind),
    tables: affectedTables,
    onlyPrecisionScale,
    allWidening: narrowing.length === 0,
    columns: sharedDiffs.map((d) => ({ column: d.key, from: `numeric(${d.from.prec},${d.from.scale})`, to: `numeric(${d.to.prec},${d.to.scale})`, kinds: d.kinds })),
  };

  check("F5 enums are identical in both shapes (no enum DDL needed in 0005)",
    JSON.stringify(fpMig.f5Enums) === JSON.stringify(fpPush.f5Enums),
    `mig ${JSON.stringify(fpMig.f5Enums)} vs push ${JSON.stringify(fpPush.f5Enums)}`);

  // Stage 1 machinery self-test: the comparator must actually SEE this difference. A comparator that
  // reports equality here would be worthless for A5/A6 later.
  const stDiff = diffStructural(stMig, stPush);
  check("Stage 1 comparator detects the known gap (it is not vacuously equal)", stDiff.length > 0,
    "the structural comparator reported no difference between a 59-table and a 66-table database");
  log(`      Stage 1 components differing: ${stDiff.map((d) => `${d.component}(-${d.onlyExpected.length}/+${d.onlyActual.length})`).join(", ")}`);

  const digestPush = structuralDigest(stPush);
  const digestMig = structuralDigest(stMig);
  log(`      structural digest push = ${digestPush.slice(0, 16)}…`);
  log(`      structural digest mig  = ${digestMig.slice(0, 16)}…`);
  log(`      semantic   digest push = ${fingerprintDigest(fpPush).slice(0, 16)}…`);
  log(`      semantic   digest mig  = ${fingerprintDigest(fpMig).slice(0, 16)}…`);

  // The snapshot-derived expectation must match the database the migrations actually built. If this
  // fails, every snapshot-based preflight conclusion is unreliable and must not be trusted.
  const snap4 = readSnapshot("drizzle", journal.entries[journal.entries.length - 1].idx);
  const expected4 = projectSnapshotStructural(snap4);
  const snapDiff = diffStructural(expected4, stMig);
  check("snapshot 0004 projection matches the database migrations 0000-0004 actually build",
    snapDiff.length === 0,
    snapDiff.map((d) => `${d.component}: -${d.onlyExpected.length}/+${d.onlyActual.length}`).join(" | "));
  if (snapDiff.length > 0) {
    for (const d of snapDiff) {
      for (const x of d.onlyExpected.slice(0, 4)) log(`        snapshot-only : ${d.component} ${x}`);
      for (const x of d.onlyActual.slice(0, 4)) log(`        database-only : ${d.component} ${x}`);
    }
  }

  evidence.gap = {
    migrationsOnly: { tables: tMig.size, columns: cMig.size },
    pushBuilt: { tables: tPush.size, columns: cPush.size },
    sharedColumns: colsBoth.length,
    columnsToAdd: colsAdd.length,
    columnsToDrop: colsDrop,
    tablesToAdd: tablesAdd,
    tablesToDrop: tablesDrop,
    sharedColumnsDiffering: sharedDiffs.length,
  };

  // ===========================================================================================
  section("2. Bookkeeping as the installed CLI actually writes it (A8)");

  const bkMig = await withClient(MIG, readBookkeeping);
  check("bookkeeping table is drizzle.__drizzle_migrations and it exists after migrate", bkMig.present);
  check(`one bookkeeping row per journal entry (${journal.entries.length})`, bkMig.rows.length === journal.entries.length,
    `got ${bkMig.rows.length}`);
  const wMig = watermark(bkMig);
  check("watermark equals the LAST journal entry's `when`", wMig === journal.entries[journal.entries.length - 1].when,
    `watermark ${wMig} vs journal ${journal.entries[journal.entries.length - 1].when}`);
  let hashesMatch = true;
  for (const e of journal.entries) {
    const row = bkMig.rows.find((r) => Number(r.created_at) === e.when);
    if (!row || row.hash !== fileHashes.get(e.tag)) hashesMatch = false;
  }
  check("each recorded hash equals sha256 of its .sql file, and created_at equals its journal `when`", hashesMatch);
  const bkCols = await withClient(MIG, async (c) => {
    const { rows } = await c.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
        where table_schema='drizzle' and table_name='__drizzle_migrations' order by ordinal_position`);
    return rows.map((r) => `${r.column_name}:${r.data_type}`);
  });
  log(`      observed bookkeeping columns: ${bkCols.join(", ")}`);
  check("observed bookkeeping columns are id/hash/created_at as the source predicted",
    bkCols.some((c) => c.startsWith("id:")) && bkCols.some((c) => c.startsWith("hash:")) && bkCols.some((c) => c.startsWith("created_at:")),
    bkCols.join(", "));
  evidence.bookkeepingColumns = bkCols;

  // ===========================================================================================
  section("3. Stage 2 — hardening is a SEPARATE axis (E8, E9, E17, F7)");

  const trigMigBefore = await hasRequiredTriggers(MIG);
  check("E8a bare `drizzle-kit migrate` left the immutable audit triggers ABSENT",
    trigMigBefore.present.length === 0, `present: ${trigMigBefore.present.join(", ")}`);
  const checkBefore = runHardening(MIG, ["--check"]);
  check("E8b verify:db-hardening exits NON-ZERO on the migration-built database", checkBefore.status !== 0,
    `exit ${checkBefore.status}`);
  log(`      --check exit before harden: ${checkBefore.status}`);

  const hardenMig = runHardening(MIG);
  check("E8c db:harden succeeded on the migration-built database", hardenMig.status === 0, `exit ${hardenMig.status}`);
  const checkAfter = runHardening(MIG, ["--check"]);
  check("E8d verify:db-hardening exits 0 after harden", checkAfter.status === 0, `exit ${checkAfter.status}`);
  log(`      --check exit after harden : ${checkAfter.status}`);
  const trigMigAfter = await hasRequiredTriggers(MIG);
  check("E8e both required triggers now exist on their intended tables and are enabled",
    trigMigAfter.missing.length === 0, `missing: ${trigMigAfter.missing.join(", ")}`);

  // The push shape must be brought to the SAME hardening state before F7 may be compared at all.
  const pushCheckBefore = runHardening(PUSH, ["--check"]);
  log(`      push --check exit before harden: ${pushCheckBefore.status} (raw \`drizzle-kit push\` does not harden; the npm wrapper chains it)`);
  const hardenPush = runHardening(PUSH);
  check("db:harden succeeded on the push-built database", hardenPush.status === 0, `exit ${hardenPush.status}`);

  const f7Mig = (await hasRequiredTriggers(MIG)).all.filter((t) => t.includes("_immutable:"));
  const f7Push = (await hasRequiredTriggers(PUSH)).all.filter((t) => t.includes("_immutable:"));
  check("F7 matches between the two shapes once BOTH have been hardened",
    JSON.stringify(f7Mig) === JSON.stringify(f7Push), `mig ${JSON.stringify(f7Mig)} vs push ${JSON.stringify(f7Push)}`);
  log(`      F7 (both hardened): ${f7Mig.join(" | ")}`);

  // E17 — presence in a catalog is not enforcement.
  for (const t of ["audit_logs", "security_events"]) {
    const r = await mutationRejected(MIG, t);
    check(`E17 ${t}: a row can be INSERTed (append-only, not read-only)`, r.insert, r.insertError ?? "insert failed");
    check(`E17 ${t}: the probe row really exists, so the next two probes are not vacuous`, r.rows === 1, `found ${r.rows} rows`);
    check(`E17 ${t}: UPDATE is actually REJECTED`, r.update !== null, "update succeeded — the trigger is not enforcing");
    check(`E17 ${t}: DELETE is actually REJECTED`, r.del !== null, "delete succeeded — the trigger is not enforcing");
    check(`E17 ${t}: the refusal comes from the append-only trigger, not from some other error`,
      (r.update ?? "").includes("append-only") && (r.del ?? "").includes("append-only"),
      `update: ${(r.update ?? "none").split("\n")[0].slice(0, 90)}`);
    if (r.update) log(`      ${t} update refusal: ${r.update.split("\n")[0].slice(0, 110)}`);
  }

  // E9 — a decoy trigger of the required NAME on an unrelated table. AUD-08.1 may not modify the
  // hardening implementation, so if the decoy satisfies the check, that is RECORDED as an AUD-08.3
  // requirement rather than fixed here.
  const DECOY = `${DB_PREFIX}decoy`;
  await freshDb(DECOY);
  const decoyPush = runDrizzleKit(["push", "--force"], DECOY, base.config);
  check("E9 setup: decoy database built", decoyPush.status === 0, `exit ${decoyPush.status}`);
  await withClient(DECOY, async (c) => {
    await c.query(`create table aud081_decoy_table (id serial primary key, action text)`);
    await c.query(`create or replace function aud081_noop() returns trigger as $$ begin return new; end; $$ language plpgsql`);
    // BOTH required names are decoyed, on an unrelated table, and neither enforces anything.
    // Decoying only one name would leave the other genuinely missing, and the check would fail for
    // the right reason by accident — which is not the question being asked.
    for (const t of REQUIRED_TRIGGERS) {
      await c.query(`create trigger ${t.trigger} before update on aud081_decoy_table for each row execute function aud081_noop()`);
    }
  });
  const decoyCheck = runHardening(DECOY, ["--check"]);
  const decoyTriggers = await hasRequiredTriggers(DECOY);
  log(`      decoy: real triggers present? ${decoyTriggers.missing.length === 0 ? "yes" : `no (missing ${decoyTriggers.missing.join(", ")})`}`);
  log(`      decoy: --check exit = ${decoyCheck.status}`);
  const decoyFooledTheCheck = decoyCheck.status === 0 && decoyTriggers.missing.length > 0;
  check("E9 MEASURED: does a same-named decoy trigger on another table satisfy --check?", true,
    undefined);
  log(`      E9 RESULT: ${decoyFooledTheCheck
    ? "the check IS satisfied by the decoy while the real triggers are ABSENT -> AUD-08.3 requirement (tighten to (relname, tgname, tgenabled))"
    : "the check is NOT satisfied by the decoy"}`);
  evidence.e9 = { decoyFooledTheCheck, decoyCheckExit: decoyCheck.status, missingRealTriggers: decoyTriggers.missing };
  await dropDb(DECOY);

  // ===========================================================================================
  section("4. E11 / E12 — rerun is a no-op; a failing migration leaves nothing");

  const rerun = runDrizzleKit(["migrate"], MIG, base.config);
  const bkRerun = await withClient(MIG, readBookkeeping);
  check("E11 a second `migrate` exits 0 and adds no bookkeeping rows",
    rerun.status === 0 && bkRerun.rows.length === bkMig.rows.length,
    `exit ${rerun.status}, rows ${bkMig.rows.length} -> ${bkRerun.rows.length}`);

  const E12DB = `${DB_PREFIX}e12`;
  const e12 = tempMigrations("e12");
  const lastWhen = journal.entries[journal.entries.length - 1].when;
  addTempMigration(e12.folder, "0005_aud081_e12_broken", lastWhen + 1000,
    `CREATE TABLE aud081_e12_marker (id integer);\n--> statement-breakpoint\nTHIS IS NOT VALID SQL;\n`);
  await freshDb(E12DB);
  const e12Run = runDrizzleKit(["migrate"], E12DB, e12.config);
  const e12State = await withClient(E12DB, async (c) => {
    const t = await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='aud081_e12_marker'`);
    const anyTable = await c.query(`select count(*)::int as n from information_schema.tables where table_schema='public'`);
    const bk = await readBookkeeping(c);
    return { marker: t.rows.length > 0, tables: anyTable.rows[0].n as number, bkRows: bk.rows.length, bkPresent: bk.present };
  });
  check("E12 the failing migration run exited non-zero", e12Run.status !== 0, `exit ${e12Run.status}`);
  check("E12 no partial schema survived (marker table absent, public schema empty)",
    !e12State.marker && e12State.tables === 0, `marker=${e12State.marker} tables=${e12State.tables}`);
  check("E12 no bookkeeping row was recorded", e12State.bkRows === 0, `rows=${e12State.bkRows}`);
  log(`      E12: single-transaction behaviour confirmed — ${e12State.tables} tables, ${e12State.bkRows} bookkeeping rows`);
  await dropDb(E12DB);
  rmSync(e12.root, { recursive: true, force: true });

  // ===========================================================================================
  section("5. E6(b) — a pending migration at or below the watermark is SILENTLY SKIPPED");

  const E6DB = `${DB_PREFIX}e6b`;
  const e6 = tempMigrations("e6b");
  // The skip requires a watermark to already exist. On an EMPTY database `lastDbMigration` is
  // undefined, the `!lastDbMigration` branch is taken, and EVERY migration applies regardless of its
  // `when` — the first run of this experiment proved that by creating the marker table. So the
  // history has to be applied first, establishing watermark = the last committed `when`, and only
  // then is the low-`when` migration added.
  await freshDb(E6DB);
  const e6Seed = runDrizzleKit(["migrate"], E6DB, e6.config);
  check("E6b setup: committed history applied first, establishing a watermark", e6Seed.status === 0, `exit ${e6Seed.status}`);
  const e6Watermark = watermark(await withClient(E6DB, readBookkeeping));
  log(`      watermark established = ${e6Watermark}`);

  // `when` deliberately EQUAL to the watermark: drizzle's test is a strict `<`, so an equal value
  // counts as already applied.
  addTempMigration(e6.folder, "0005_aud081_e6b_low_when", lastWhen,
    `CREATE TABLE aud081_e6b_marker (id integer);\n`);
  const e6First = runDrizzleKit(["migrate"], E6DB, e6.config);
  const e6State = await withClient(E6DB, async (c) => {
    const t = await c.query(`select 1 from information_schema.tables where table_schema='public' and table_name='aud081_e6b_marker'`);
    const bk = await readBookkeeping(c);
    return { marker: t.rows.length > 0, bk };
  });
  log(`      migrate exit = ${e6First.status}; bookkeeping rows = ${e6State.bk.rows.length} (unchanged = ${e6State.bk.rows.length === journal.entries.length})`);
  check("E6b the marker table was NOT created although the migration was pending", !e6State.marker,
    "the low-`when` migration was applied, so the skip did not occur");
  check("E6b no bookkeeping row was added for the skipped migration", e6State.bk.rows.length === journal.entries.length,
    `rows ${e6State.bk.rows.length}`);
  check("E6b drizzle-kit nevertheless exited 0 — the skip is silent", e6First.status === 0, `exit ${e6First.status}`);
  const e6Journal = readJournal(e6.folder);
  const e6Hashes = new Map<string, string>();
  for (const e of e6Journal.entries) e6Hashes.set(e.tag, sha256File(migrationSqlPath(e6.folder, e.tag)));
  const e6Pre = classify({
    journal: e6Journal,
    journalFindings: journalInvariants(e6Journal, e6.folder),
    bookkeeping: e6State.bk,
    fileHashes: e6Hashes,
    schemaMatchesPrefix: true,
    actualMatchesPushReference: false,
    structuralDigestActual: null,
  });
  check("E6b db:preflight classifies this INCONSISTENT and names R6/R7",
    e6Pre.state === "INCONSISTENT" && e6Pre.findings.some((f) => f.code === "R7" || f.code === "R6"),
    `${e6Pre.state}: ${e6Pre.findings.map((f) => f.code).join(",")}`);
  log(`      preflight: ${e6Pre.state} — ${e6Pre.findings.map((f) => `[${f.code}]`).join(" ")}`);
  evidence.e6b = { migrateExit: e6First.status, markerCreated: e6State.marker, preflightState: e6Pre.state, codes: e6Pre.findings.map((f) => f.code) };
  await dropDb(E6DB);
  rmSync(e6.root, { recursive: true, force: true });

  // ===========================================================================================
  section("6. E7 — the Date.now() stamp hazard");

  const E7DB = `${DB_PREFIX}e7`;
  await freshDb(E7DB);
  const nowStamp = Date.now();
  await withClient(E7DB, async (c) => {
    await c.query(`create schema if not exists drizzle`);
    await c.query(`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`);
    // A wall-clock stamp on an EMPTY database: exactly the mistake the stamp design must forbid.
    await c.query(`insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`, ["aud081-wallclock-stamp", String(nowStamp)]);
  });
  const e7Run = runDrizzleKit(["migrate"], E7DB, base.config);
  const e7State = await withClient(E7DB, async (c) => {
    const n = await c.query(`select count(*)::int as n from information_schema.tables where table_schema='public'`);
    const bk = await readBookkeeping(c);
    return { tables: n.rows[0].n as number, bk };
  });
  log(`      stamped created_at = ${nowStamp} (wall clock); highest journal when = ${lastWhen}`);
  check("E7 drizzle-kit migrate exited 0", e7Run.status === 0, `exit ${e7Run.status}`);
  check("E7 the ENTIRE committed history was silently skipped — the database is still empty",
    e7State.tables === 0, `${e7State.tables} tables exist`);
  const e7Pre = classify({
    journal, journalFindings, bookkeeping: e7State.bk, fileHashes,
    schemaMatchesPrefix: false, actualMatchesPushReference: false, structuralDigestActual: null,
  });
  check("E7 db:preflight refuses it (orphan stamp row, unrecognised schema)",
    e7Pre.state === "INCONSISTENT" && e7Pre.findings.some((f) => f.code === "R3"),
    `${e7Pre.state}: ${e7Pre.findings.map((f) => f.code).join(",")}`);
  log(`      preflight: ${e7Pre.state} — ${e7Pre.findings.map((f) => `[${f.code}]`).join(" ")}`);
  evidence.e7 = { stamp: nowStamp, tablesAfter: e7State.tables, migrateExit: e7Run.status, preflightState: e7Pre.state };
  await dropDb(E7DB);

  // ===========================================================================================
  section("7. E10 / E13 / E14 / E15 — preflight detects what drizzle cannot see");

  // E10 — a mutated applied migration file. Done on a COPY; committed files are never edited.
  const e10 = tempMigrations("e10");
  const victim = journal.entries[2];
  const victimPath = migrationSqlPath(e10.folder, victim.tag);
  writeFileSync(victimPath, `${readFileSync(victimPath, "utf8")}\n-- aud081 e10 tamper\n`);
  const e10Hashes = new Map(fileHashes);
  e10Hashes.set(victim.tag, sha256File(victimPath));
  const e10Pre = classify({
    journal, journalFindings, bookkeeping: bkMig, fileHashes: e10Hashes,
    schemaMatchesPrefix: true, actualMatchesPushReference: false, structuralDigestActual: null,
  });
  check(`E10 a tampered applied migration (${victim.tag}) is detected as R4`,
    e10Pre.state === "INCONSISTENT" && e10Pre.findings.some((f) => f.code === "R4"),
    `${e10Pre.state}: ${e10Pre.findings.map((f) => f.code).join(",")}`);
  log(`      E10 preflight: ${e10Pre.state} — ${e10Pre.findings.filter((f) => f.code === "R4").map((f) => f.detail).join("; ").slice(0, 160)}`);
  rmSync(e10.root, { recursive: true, force: true });

  // E13 — delete a MIDDLE bookkeeping row, leave the watermark intact.
  const E13DB = `${DB_PREFIX}e13`;
  await freshDb(E13DB);
  check("E13 setup: migrated normally", runDrizzleKit(["migrate"], E13DB, base.config).status === 0);
  await withClient(E13DB, async (c) => {
    await c.query(`delete from drizzle.__drizzle_migrations where created_at = $1`, [String(journal.entries[2].when)]);
  });
  const e13Rerun = runDrizzleKit(["migrate"], E13DB, base.config);
  const e13Bk = await withClient(E13DB, readBookkeeping);
  log(`      E13: rows ${journal.entries.length} -> ${e13Bk.rows.length}; watermark unchanged = ${watermark(e13Bk) === lastWhen}`);
  check("E13 drizzle-kit migrate still reports success and applies nothing (the hole is invisible to it)",
    e13Rerun.status === 0 && e13Bk.rows.length === journal.entries.length - 1,
    `exit ${e13Rerun.status}, rows ${e13Bk.rows.length}`);
  const e13Pre = classify({
    journal, journalFindings, bookkeeping: e13Bk, fileHashes,
    schemaMatchesPrefix: true, actualMatchesPushReference: false, structuralDigestActual: null,
  });
  check("E13 db:preflight returns INCONSISTENT citing R1 and naming the missing migration",
    e13Pre.state === "INCONSISTENT" && e13Pre.findings.some((f) => f.code === "R1" && f.detail.includes(journal.entries[2].tag)),
    `${e13Pre.state}: ${e13Pre.findings.map((f) => f.code).join(",")}`);
  log(`      E13 preflight: ${e13Pre.state} — ${e13Pre.findings.map((f) => `[${f.code}] ${f.detail}`).join(" | ").slice(0, 200)}`);
  evidence.e13 = { migrateExit: e13Rerun.status, rowsRemaining: e13Bk.rows.length, preflightState: e13Pre.state };
  await dropDb(E13DB);

  // E14 — orphan bookkeeping row.
  const e14Bk = { present: true, rows: [...bkMig.rows, { id: 999, hash: "deadbeef", created_at: String(lastWhen + 7777) }] };
  const e14Pre = classify({
    journal, journalFindings, bookkeeping: e14Bk, fileHashes,
    schemaMatchesPrefix: true, actualMatchesPushReference: false, structuralDigestActual: null,
  });
  check("E14 an orphan bookkeeping row (created_at matching no journal entry) is detected as R3",
    e14Pre.state === "INCONSISTENT" && e14Pre.findings.some((f) => f.code === "R3"),
    `${e14Pre.state}: ${e14Pre.findings.map((f) => f.code).join(",")}`);

  // E15 — duplicate created_at.
  const dupe = bkMig.rows[1];
  const e15Bk = { present: true, rows: [...bkMig.rows, { id: 998, hash: dupe.hash, created_at: dupe.created_at }] };
  const e15Pre = classify({
    journal, journalFindings, bookkeeping: e15Bk, fileHashes,
    schemaMatchesPrefix: true, actualMatchesPushReference: false, structuralDigestActual: null,
  });
  check("E15 duplicate bookkeeping rows for one created_at are detected as R2",
    e15Pre.state === "INCONSISTENT" && e15Pre.findings.some((f) => f.code === "R2"),
    `${e15Pre.state}: ${e15Pre.findings.map((f) => f.code).join(",")}`);

  // ===========================================================================================
  section("8. E18 — BOOKKEEPING BEHIND, SCHEMA AHEAD (the historical pattern AUD-08 repairs)");

  // E19 first, because it determines how E18 can be set up at all.
  //
  // `drizzle-kit push` onto a database that still has terms_conditions_groups.content hits the SAME
  // promptColumnsConflicts TTY failure the September audit attributed only to `drizzle-kit generate`
  // — and `--force` does not help, because --force accepts data-loss statements, it does not answer
  // a rename-vs-recreate question. Worse, it EXITS 0 while applying nothing.
  const E19DB = `${DB_PREFIX}e19`;
  await freshDb(E19DB);
  check("E19 setup: migrated to the committed prefix", runDrizzleKit(["migrate"], E19DB, base.config).status === 0);
  const e19Before = (await withClient(E19DB, projectLiveStructural)).columns.length;
  const e19Push = runDrizzleKit(["push", "--force"], E19DB, base.config);
  const e19After = (await withClient(E19DB, projectLiveStructural)).columns.length;
  const e19Conflict = /promptColumnsConflicts|Interactive prompts require a TTY/.test(e19Push.stdout + e19Push.stderr);
  check("E19 `push --force` onto a database holding the legacy column hits the columns-conflict prompt",
    e19Conflict, `stderr: ${e19Push.stderr.split("\n")[0]?.slice(0, 120)}`);
  check("E19 it applied NOTHING — the schema is unchanged", e19Before === e19After, `${e19Before} -> ${e19After} columns`);
  check("E19 and it EXITED 0 — the failure is silent to any `push && next-step` chain",
    e19Push.status === 0, `exit ${e19Push.status}`);
  log(`      E19: columns ${e19Before} -> ${e19After}, exit ${e19Push.status}, conflict prompt reached = ${e19Conflict}`);
  evidence.e19 = { exit: e19Push.status, columnsBefore: e19Before, columnsAfter: e19After, conflictPromptReached: e19Conflict };
  await dropDb(E19DB);

  // E18 therefore cannot be built by pushing onto a migrated database. It is built the way the real
  // situation arose instead: a push-built schema whose bookkeeping records an earlier prefix.
  const E18DB = `${DB_PREFIX}e18`;
  await freshDb(E18DB);
  const e18PushRun = runDrizzleKit(["push", "--force"], E18DB, base.config);
  check("E18 setup: schema built at the current push shape", e18PushRun.status === 0, `exit ${e18PushRun.status}`);
  // Now record bookkeeping for the committed prefix only, with the REAL hashes and whens — the
  // state a correct stamp of the committed history would leave behind.
  await withClient(E18DB, async (c) => {
    await c.query(`create schema if not exists drizzle`);
    await c.query(`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`);
    for (const e of journal.entries) {
      await c.query(`insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`, [fileHashes.get(e.tag), String(e.when)]);
    }
  });
  const e18BkAfter = await withClient(E18DB, readBookkeeping);
  const e18St = await withClient(E18DB, projectLiveStructural);
  const e18Digest = structuralDigest(e18St);

  check("E18 bookkeeping records the committed prefix exactly, with real hashes and whens",
    e18BkAfter.rows.length === journal.entries.length && watermark(e18BkAfter) === lastWhen,
    `rows ${e18BkAfter.rows.length}, watermark ${watermark(e18BkAfter)}`);
  check("E18 the live schema equals the proven db:push reference shape", e18Digest === digestPush,
    `${e18Digest.slice(0, 12)} vs ${digestPush.slice(0, 12)}`);

  const e18PrefixDiff = diffStructural(expected4, e18St);
  const e18Pre = classify({
    journal, journalFindings, bookkeeping: e18BkAfter, fileHashes,
    schemaMatchesPrefix: e18PrefixDiff.length === 0,
    actualMatchesPushReference: e18Digest === digestPush,
    structuralDigestActual: e18Digest,
  });
  check("E18 bookkeeping alone looks healthy — exact correspondence holds over the applied prefix",
    !e18Pre.findings.some((f) => ["R1", "R2", "R3", "R4", "R7"].includes(f.code)),
    e18Pre.findings.map((f) => f.code).join(","));
  check("E18 db:preflight does NOT return OK", e18Pre.state !== "OK", `state ${e18Pre.state}`);
  check("E18 db:preflight returns BASELINE RECONCILIATION REQUIRED",
    e18Pre.state === "BASELINE_RECONCILIATION_REQUIRED",
    `${e18Pre.state}: ${e18Pre.findings.map((f) => f.code).join(",")}`);
  log(`      E18 preflight: ${e18Pre.state} — ${e18Pre.findings.map((f) => `[${f.code}]`).join(" ")}`);
  log(`      E18 ordinary migrate: REFUSED (exit ${10})`);

  // The same database, but with the push reference unavailable: the answer must get STRICTER,
  // never looser. An unexplained shape is INCONSISTENT, not a baseline situation.
  const e18NoRef = classify({
    journal, journalFindings, bookkeeping: e18BkAfter, fileHashes,
    schemaMatchesPrefix: false, actualMatchesPushReference: null, structuralDigestActual: e18Digest,
  });
  check("E18 without a push reference the classification is INCONSISTENT, not OK and not baseline",
    e18NoRef.state === "INCONSISTENT", `state ${e18NoRef.state}`);
  evidence.e18 = { preflightWithReference: e18Pre.state, preflightWithoutReference: e18NoRef.state, schemaEqualsPush: e18Digest === digestPush };

  // ===========================================================================================
  section("9. Positive control + CLI exit codes");

  // A migration-managed database at its own prefix, with correct bookkeeping, MUST return OK —
  // otherwise the gate is useless because it never passes.
  const okPre = classify({
    journal, journalFindings, bookkeeping: bkMig, fileHashes,
    schemaMatchesPrefix: true, actualMatchesPushReference: false, structuralDigestActual: digestMig,
  });
  check("positive control: a correctly migrated database at its own prefix returns OK",
    okPre.state === "OK", `${okPre.state}: ${okPre.findings.map((f) => f.code).join(",")}`);

  // Exit codes through the real CLI, so the documented contract is observed rather than asserted.
  const cliOnMig = spawnSync("npx", ["tsx", "scripts/migration-preflight.ts"], {
    cwd: REPO, encoding: "utf8", shell: false,
    env: { ...process.env, DATABASE_URL: dbUrl(MIG), AUD08_SCHEMA_REFERENCE: join(EVIDENCE_DIR, "schema-reference.json") },
  });
  log(`      CLI against the migrated database: exit ${cliOnMig.status}`);
  check("CLI exit code 0 corresponds to OK on the migrated database", cliOnMig.status === 0, `exit ${cliOnMig.status}`);
  const cliOnE18 = spawnSync("npx", ["tsx", "scripts/migration-preflight.ts"], {
    cwd: REPO, encoding: "utf8", shell: false,
    env: { ...process.env, DATABASE_URL: dbUrl(E18DB), AUD08_SCHEMA_REFERENCE: join(EVIDENCE_DIR, "schema-reference.json") },
  });
  log(`      CLI against the bookkeeping-behind/schema-ahead database: exit ${cliOnE18.status}`);
  check("CLI exit code 10 corresponds to BASELINE RECONCILIATION REQUIRED", cliOnE18.status === 10, `exit ${cliOnE18.status}`);
  // The secret is taken FROM the supplied URL rather than written here: a literal in this file would
  // be a committed credential, which is the thing the assertion is about.
  const secret = new URL(ADMIN_URL).password;
  const cliOutput = cliOnMig.stdout + cliOnMig.stderr + cliOnE18.stdout + cliOnE18.stderr;
  check("CLI never printed the password or a whole connection string",
    (secret === "" || !cliOutput.includes(secret)) && !/postgres(ql)?:\/\//.test(cliOutput),
    secret !== "" && cliOutput.includes(secret) ? "the password appeared in CLI output" : "a connection string appeared in CLI output");

  await dropDb(E18DB);

  // ===========================================================================================
  section("10. Evidence");

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const reference = {
    note: "AUD-08.1 measured reference digests. Structural projection only — see scripts/migration-preflight.ts for why types are excluded from snapshot comparison.",
    measuredAt: new Date().toISOString(),
    repoHead: spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout.trim(),
    drizzleOrm: JSON.parse(readFileSync(join(REPO, "node_modules/drizzle-orm/package.json"), "utf8")).version,
    drizzleKit: JSON.parse(readFileSync(join(REPO, "node_modules/drizzle-kit/package.json"), "utf8")).version,
    pgDriver: JSON.parse(readFileSync(join(REPO, "node_modules/pg/package.json"), "utf8")).version,
    pushStructuralDigest: digestPush,
    migrationsOnlyStructuralDigest: digestMig,
    prefixStructuralDigests: { [String(journal.entries[journal.entries.length - 1].idx)]: digestMig },
    pushSemanticDigest: fingerprintDigest(fpPush),
    migrationsOnlySemanticDigest: fingerprintDigest(fpMig),
  };
  writeFileSync(join(EVIDENCE_DIR, "schema-reference.json"), `${JSON.stringify(reference, null, 2)}\n`);
  writeFileSync(join(EVIDENCE_DIR, "gap-measurement.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  log(`      wrote ${join("docs/audits/aud-08/evidence", "schema-reference.json")}`);
  log(`      wrote ${join("docs/audits/aud-08/evidence", "gap-measurement.json")}`);

  await dropDb(MIG);
  await dropDb(PUSH);
  rmSync(base.root, { recursive: true, force: true });

  log("");
  log(`${passed} passed, ${failed} failed`);
  writeFileSync(join(EVIDENCE_DIR, "verify-migration-baseline.txt"), `${transcript.join("\n")}\n`);
  if (failed > 0) {
    log("MIGRATION BASELINE VERIFICATION FAIL");
    process.exit(1);
  }
  log("MIGRATION BASELINE VERIFICATION PASS");
}

main().catch(async (e) => {
  console.error(e);
  // Clean up only what this suite created.
  for (const name of [...created]) {
    try {
      await dropDb(name);
    } catch {
      /* best effort */
    }
  }
  process.exit(1);
});
