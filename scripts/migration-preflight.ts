/**
 * AUD-08.1 — migration preflight.
 *
 * A READ-ONLY gate that must pass before `drizzle-kit migrate` is ever run. It is deliberately
 * STRICTER than drizzle's own bookkeeping check, which is a single watermark:
 *
 *     select id, hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1
 *     if (!last || Number(last.created_at) < migration.folderMillis) { run it }
 *
 * (drizzle-orm 0.45.2, pg-core/dialect.js). Three consequences drive everything below:
 *
 *   1. Applied-ness is decided by MAX(created_at) alone. Extra, missing or duplicate rows BELOW
 *      that maximum change nothing, so a hole in the middle of the history is invisible.
 *   2. The `hash` column is written and NEVER read, so an edited historical migration is invisible.
 *   3. A pending migration whose journal `when` is <= the watermark is SILENTLY SKIPPED — no error,
 *      no output, exit 0.
 *
 * This tool therefore checks exact correspondence, not a watermark, and refuses to let a migration
 * run unless the journal, the bookkeeping table AND the live schema all agree.
 *
 * It NEVER writes: no stamping, no bookkeeping repair, no DDL, no migration execution. It opens one
 * read-only connection, runs SELECTs, and exits.
 *
 * Run:   npm run db:preflight
 * Exit:  0  = OK
 *        10 = BASELINE RECONCILIATION REQUIRED
 *        20 = INCONSISTENT
 *        1  = tool error (unreadable journal, no connection, bad arguments)
 *
 * Secrets: DATABASE_URL is never printed. Only host and database name are reported.
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
// ClientBase is the common supertype of Client and PoolClient, so these projections work
// against a pooled connection or a standalone one without a cast at every call site.
import { Pool, type ClientBase } from "pg";

// ---------------------------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------------------------

export type JournalEntry = { idx: number; version: string; when: number; tag: string; breakpoints: boolean };
export type Journal = { version: string; dialect: string; entries: JournalEntry[] };

export function readJournal(migrationsFolder: string): Journal {
  const path = join(migrationsFolder, "meta", "_journal.json");
  if (!existsSync(path)) throw new Error(`journal not found: ${path}`);
  const journal = JSON.parse(readFileSync(path, "utf8")) as Journal;
  if (!Array.isArray(journal.entries)) throw new Error(`journal has no entries array: ${path}`);
  return journal;
}

/**
 * sha256 of the migration file's bytes, computed exactly as drizzle-orm's readMigrationFiles does:
 *   crypto.createHash("sha256").update(query).digest("hex")   where query = the WHOLE file
 * Read as a Buffer so the digest is byte-for-byte and not re-encoded.
 */
export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function migrationSqlPath(migrationsFolder: string, tag: string): string {
  return join(migrationsFolder, `${tag}.sql`);
}

export type JournalFinding = { code: string; detail: string };

/** Structural invariants of the journal alone — no database involved. */
export function journalInvariants(journal: Journal, migrationsFolder: string): JournalFinding[] {
  const findings: JournalFinding[] = [];
  const entries = journal.entries;

  // R5 — idx contiguous from 0, in order.
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].idx !== i) {
      findings.push({ code: "R5", detail: `journal idx not contiguous: position ${i} carries idx ${entries[i].idx}` });
    }
  }

  // R6 — `when` strictly increasing. drizzle compares created_at against `when`, so a flat or
  // decreasing pair makes "applied" ambiguous and can silently skip the lower entry.
  for (let i = 1; i < entries.length; i++) {
    if (!(entries[i - 1].when < entries[i].when)) {
      findings.push({
        code: "R6",
        detail: `journal 'when' not strictly increasing: ${entries[i - 1].tag} (${entries[i - 1].when}) >= ${entries[i].tag} (${entries[i].when})`,
      });
    }
  }

  // Every entry must have its SQL file — drizzle throws at read time, but a preflight should say so.
  for (const e of entries) {
    const p = migrationSqlPath(migrationsFolder, e.tag);
    if (!existsSync(p)) findings.push({ code: "MISSING_SQL", detail: `no SQL file for journal entry ${e.tag}: ${p}` });
  }

  return findings;
}

// ---------------------------------------------------------------------------------------------
// Bookkeeping (drizzle.__drizzle_migrations)
// ---------------------------------------------------------------------------------------------

export const BOOKKEEPING_SCHEMA = "drizzle";
export const BOOKKEEPING_TABLE = "__drizzle_migrations";

export type BookkeepingRow = { id: number; hash: string; created_at: string | null };
export type Bookkeeping = { present: boolean; rows: BookkeepingRow[] };

export async function readBookkeeping(client: ClientBase): Promise<Bookkeeping> {
  const { rows: exists } = await client.query(
    `select 1 from information_schema.tables where table_schema = $1 and table_name = $2`,
    [BOOKKEEPING_SCHEMA, BOOKKEEPING_TABLE],
  );
  if (exists.length === 0) return { present: false, rows: [] };
  // created_at is `bigint`; node-postgres returns bigint as a string. Keep it a string and compare
  // numerically only where intended — never with ==, which would coerce surprisingly.
  const { rows } = await client.query<BookkeepingRow>(
    `select id, hash, created_at from ${BOOKKEEPING_SCHEMA}.${BOOKKEEPING_TABLE} order by created_at nulls first, id`,
  );
  return { present: true, rows };
}

/** The value drizzle itself would read: MAX(created_at), or null when there is nothing to read. */
export function watermark(bk: Bookkeeping): number | null {
  let max: number | null = null;
  for (const r of bk.rows) {
    if (r.created_at === null) continue;
    const n = Number(r.created_at);
    if (!Number.isFinite(n)) continue;
    if (max === null || n > max) max = n;
  }
  return max;
}

// ---------------------------------------------------------------------------------------------
// Live schema projection — F1..F6 (semantic) and F7 (triggers, Stage 2 only)
// ---------------------------------------------------------------------------------------------

export type LiveFingerprint = {
  f1Columns: string[];
  f2Constraints: string[];
  f3ForeignKeys: string[];
  f4Indexes: string[];
  f5Enums: string[];
  f6Sequences: string[];
};

export type Triggers = string[]; // F7 — kept OUT of F1..F6 equality on purpose (see AUD-08-P0-C1 §01)

/** pg_constraint action codes -> the words drizzle snapshots use, so both sides can be compared. */
const FK_ACTION: Record<string, string> = { a: "no action", r: "restrict", c: "cascade", n: "set null", d: "set default" };

/**
 * Index definitions carry a generated name that legitimately differs between a push-built and a
 * migration-built database. Strip the name so comparison is semantic, per AUD-08-P0-C1 §01 F4.
 */
export function normalizeIndexDef(def: string): string {
  return def
    .replace(/^CREATE (UNIQUE )?INDEX \S+ ON /i, (_m, u) => `CREATE ${u ?? ""}INDEX ON `)
    .replace(/\s+/g, " ")
    .trim();
}

export async function projectLive(client: ClientBase): Promise<LiveFingerprint> {
  // F1 — columns, with everything the review asked for: type, nullability, default, length,
  // precision, scale, identity, generated.
  const f1 = await client.query<{ v: string }>(`
    select table_name || '.' || column_name
           || ':t=' || data_type
           || ':udt=' || coalesce(udt_name, '')
           || ':null=' || is_nullable
           || ':def=' || coalesce(column_default, '')
           || ':len=' || coalesce(character_maximum_length::text, '')
           || ':prec=' || coalesce(numeric_precision::text, '')
           || ':scale=' || coalesce(numeric_scale::text, '')
           || ':ident=' || is_identity
           || ':gen=' || is_generated as v
      from information_schema.columns
     where table_schema = 'public'
     order by table_name, column_name`);

  // F2 — primary keys, uniques and checks, with ORDERED columns. Read from pg_constraint rather
  // than information_schema so the column order and the check expression are both available, and
  // so NOT NULL does not masquerade as a check constraint.
  const f2 = await client.query<{ v: string }>(`
    select rel.relname
           || ':' || case c.contype when 'p' then 'PRIMARY KEY' when 'u' then 'UNIQUE' else 'CHECK' end
           || ':' || coalesce((
                select string_agg(a.attname, ',' order by k.ord)
                  from unnest(c.conkey) with ordinality k(attnum, ord)
                  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum), '')
           || ':' || case when c.contype = 'c' then pg_get_constraintdef(c.oid) else '' end as v
      from pg_constraint c
      join pg_class rel on rel.oid = c.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'public' and c.contype in ('p', 'u', 'c')
     order by 1`);

  // F3 — foreign keys: ordered local columns, referenced table and columns, and BOTH actions.
  // These are invisible to a column fingerprint and are exactly the kind of divergence a baseline
  // has to catch (52 of 53 FKs to `orgs` cascade; audit_logs.org_id is SET NULL).
  const f3 = await client.query<{ v: string }>(`
    select rel.relname
           || ':' || coalesce((
                select string_agg(a.attname, ',' order by k.ord)
                  from unnest(c.conkey) with ordinality k(attnum, ord)
                  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum), '')
           || '->' || fr.relname
           || ':' || coalesce((
                select string_agg(a2.attname, ',' order by k2.ord)
                  from unnest(c.confkey) with ordinality k2(attnum, ord)
                  join pg_attribute a2 on a2.attrelid = c.confrelid and a2.attnum = k2.attnum), '')
           || ':del=' || c.confdeltype::text
           || ':upd=' || c.confupdtype::text as v
      from pg_constraint c
      join pg_class rel on rel.oid = c.conrelid
      join pg_class fr on fr.oid = c.confrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'public' and c.contype = 'f'
     order by 1`);

  // F4 — indexes, names stripped.
  const f4raw = await client.query<{ tablename: string; indexdef: string }>(
    `select tablename, indexdef from pg_indexes where schemaname = 'public' order by tablename, indexdef`,
  );

  // F5 — enum types with ORDERED values.
  const f5 = await client.query<{ v: string }>(`
    select t.typname || ':' || string_agg(e.enumlabel, ',' order by e.enumsortorder) as v
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public'
     group by t.typname
     order by 1`);

  // F6 — sequences and the column each one backs.
  const f6 = await client.query<{ v: string }>(`
    select c.relname
           || ':owner=' || coalesce(ownertab.relname, '')
           || '.' || coalesce(a.attname, '') as v
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_depend dep
             on dep.objid = c.oid
            and dep.classid = 'pg_class'::regclass
            and dep.deptype in ('a', 'i')
      left join pg_class ownertab on ownertab.oid = dep.refobjid
      left join pg_attribute a on a.attrelid = dep.refobjid and a.attnum = dep.refobjsubid
     where c.relkind = 'S' and n.nspname = 'public'
     order by 1`);

  return {
    f1Columns: f1.rows.map((r) => r.v),
    f2Constraints: f2.rows.map((r) => r.v),
    f3ForeignKeys: f3.rows.map((r) => `${r.v}`),
    f4Indexes: f4raw.rows.map((r) => `${r.tablename}:${normalizeIndexDef(r.indexdef)}`).sort(),
    f5Enums: f5.rows.map((r) => r.v),
    f6Sequences: f6.rows.map((r) => r.v),
  };
}

/** F7 — triggers. Unrelated legitimate triggers are permitted; this simply records what exists. */
export async function projectTriggers(client: ClientBase): Promise<Triggers> {
  const { rows } = await client.query<{ v: string }>(`
    select rel.relname || ':' || t.tgname || ':enabled=' || t.tgenabled::text as v
      from pg_trigger t
      join pg_class rel on rel.oid = t.tgrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'public' and not t.tgisinternal
     order by 1`);
  return rows.map((r) => r.v);
}

export function fingerprintDigest(fp: LiveFingerprint): string {
  const body = [
    "F1", ...fp.f1Columns,
    "F2", ...fp.f2Constraints,
    "F3", ...fp.f3ForeignKeys,
    "F4", ...fp.f4Indexes,
    "F5", ...fp.f5Enums,
    "F6", ...fp.f6Sequences,
  ].join("\n");
  return createHash("sha256").update(body).digest("hex");
}

// ---------------------------------------------------------------------------------------------
// Structural projection — the subset that is SAFE to compare against a drizzle snapshot
// ---------------------------------------------------------------------------------------------

/**
 * Why there are two projections.
 *
 * `projectLive` measures types, defaults, precision and scale from the database. A drizzle snapshot
 * spells the same facts differently ("serial" vs integer + a nextval default; "numeric(15, 3)" vs
 * numeric + precision + scale). Translating between the two spellings is a lossy layer that would
 * itself need testing, and a mistake in it would look exactly like a real schema divergence.
 *
 * So the snapshot comparison is restricted to the subset where both sides are unambiguous:
 * column identity, NOT NULL, primary keys, uniques, foreign keys WITH their actions, declared
 * indexes and enum values. That is more than enough to detect the case AUD-08 exists to repair —
 * bookkeeping behind, schema ahead — because a missing table or column shows up immediately.
 *
 * Full type/default/precision equality is proven live-against-live by verify-migration-baseline,
 * where both sides are measured the same way and no translation is involved.
 */
export type StructuralProjection = {
  columns: string[];  // "table.column:notNull=<bool>"
  pks: string[];      // "table:col1,col2"
  uniques: string[];  // "table:col1,col2"
  fks: string[];      // "table:cols->reftable:refcols:del=<word>:upd=<word>"
  indexes: string[];  // "table:unique=<bool>:col1,col2"
  enums: string[];    // "name:v1,v2"
};

export function emptyStructural(): StructuralProjection {
  return { columns: [], pks: [], uniques: [], fks: [], indexes: [], enums: [] };
}

export async function projectLiveStructural(client: ClientBase): Promise<StructuralProjection> {
  const cols = await client.query<{ v: string }>(`
    select table_name || '.' || column_name || ':notNull=' || case when is_nullable = 'NO' then 'true' else 'false' end as v
      from information_schema.columns where table_schema = 'public' order by 1`);

  const pk = await client.query<{ v: string }>(`
    select rel.relname || ':' || coalesce((
             select string_agg(a.attname, ',' order by k.ord)
               from unnest(c.conkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum), '') as v
      from pg_constraint c join pg_class rel on rel.oid = c.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'public' and c.contype = 'p' order by 1`);

  const uq = await client.query<{ v: string }>(`
    select rel.relname || ':' || coalesce((
             select string_agg(a.attname, ',' order by k.ord)
               from unnest(c.conkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum), '') as v
      from pg_constraint c join pg_class rel on rel.oid = c.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'public' and c.contype = 'u' order by 1`);

  const fk = await client.query<{ tbl: string; cols: string; reftbl: string; refcols: string; del: string; upd: string }>(`
    select rel.relname as tbl,
           coalesce((select string_agg(a.attname, ',' order by k.ord)
                       from unnest(c.conkey) with ordinality k(attnum, ord)
                       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum), '') as cols,
           fr.relname as reftbl,
           coalesce((select string_agg(a2.attname, ',' order by k2.ord)
                       from unnest(c.confkey) with ordinality k2(attnum, ord)
                       join pg_attribute a2 on a2.attrelid = c.confrelid and a2.attnum = k2.attnum), '') as refcols,
           c.confdeltype::text as del, c.confupdtype::text as upd
      from pg_constraint c
      join pg_class rel on rel.oid = c.conrelid
      join pg_class fr on fr.oid = c.confrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'public' and c.contype = 'f'`);

  // Only NON-constraint-backed indexes: a snapshot records PK/unique as constraints, not indexes,
  // so including constraint indexes here would produce a phantom difference on every table.
  const ix = await client.query<{ v: string }>(`
    select rel.relname || ':unique=' || case when i.indisunique then 'true' else 'false' end || ':' ||
           coalesce((select string_agg(a.attname, ',' order by k.ord)
                       from unnest(string_to_array(i.indkey::text, ' ')::int[]) with ordinality k(attnum, ord)
                       join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum), '') as v
      from pg_index i
      join pg_class rel on rel.oid = i.indrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'public'
       and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)`);

  const en = await client.query<{ v: string }>(`
    select t.typname || ':' || string_agg(e.enumlabel, ',' order by e.enumsortorder) as v
      from pg_type t join pg_enum e on e.enumtypid = t.oid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' group by t.typname`);

  return {
    columns: cols.rows.map((r) => r.v).sort(),
    pks: pk.rows.map((r) => r.v).sort(),
    uniques: uq.rows.map((r) => r.v).sort(),
    fks: fk.rows.map((r) => `${r.tbl}:${r.cols}->${r.reftbl}:${r.refcols}:del=${FK_ACTION[r.del] ?? r.del}:upd=${FK_ACTION[r.upd] ?? r.upd}`).sort(),
    indexes: ix.rows.map((r) => r.v).sort(),
    enums: en.rows.map((r) => r.v).sort(),
  };
}

type SnapshotColumn = { name: string; type: string; primaryKey?: boolean; notNull?: boolean };
type SnapshotFk = { tableFrom: string; tableTo: string; columnsFrom: string[]; columnsTo: string[]; onDelete?: string; onUpdate?: string };
type SnapshotIndex = { name: string; columns: unknown[]; isUnique?: boolean };
type SnapshotTable = {
  name: string;
  columns: Record<string, SnapshotColumn>;
  indexes?: Record<string, SnapshotIndex>;
  foreignKeys?: Record<string, SnapshotFk>;
  compositePrimaryKeys?: Record<string, { name?: string; columns: string[] }>;
  uniqueConstraints?: Record<string, { name?: string; columns: string[] }>;
};
type Snapshot = {
  tables: Record<string, SnapshotTable>;
  enums?: Record<string, { name: string; values: string[] }>;
};

export function readSnapshot(migrationsFolder: string, idx: number): Snapshot {
  const tag = String(idx).padStart(4, "0");
  const path = join(migrationsFolder, "meta", `${tag}_snapshot.json`);
  if (!existsSync(path)) throw new Error(`snapshot not found for idx ${idx}: ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
}

export function projectSnapshotStructural(snap: Snapshot): StructuralProjection {
  const out = emptyStructural();

  for (const table of Object.values(snap.tables)) {
    const singlePk: string[] = [];
    for (const col of Object.values(table.columns)) {
      out.columns.push(`${table.name}.${col.name}:notNull=${col.notNull ? "true" : "false"}`);
      if (col.primaryKey) singlePk.push(col.name);
    }
    if (singlePk.length > 0) out.pks.push(`${table.name}:${singlePk.join(",")}`);
    for (const pk of Object.values(table.compositePrimaryKeys ?? {})) {
      out.pks.push(`${table.name}:${pk.columns.join(",")}`);
    }
    for (const uq of Object.values(table.uniqueConstraints ?? {})) {
      out.uniques.push(`${table.name}:${uq.columns.join(",")}`);
    }
    for (const fk of Object.values(table.foreignKeys ?? {})) {
      const del = (fk.onDelete ?? "no action").toLowerCase();
      const upd = (fk.onUpdate ?? "no action").toLowerCase();
      out.fks.push(`${fk.tableFrom}:${fk.columnsFrom.join(",")}->${fk.tableTo}:${fk.columnsTo.join(",")}:del=${del}:upd=${upd}`);
    }
    for (const ix of Object.values(table.indexes ?? {})) {
      const cols = ix.columns.map((c) => (typeof c === "string" ? c : ((c as { expression?: string }).expression ?? String(c))));
      out.indexes.push(`${table.name}:unique=${ix.isUnique ? "true" : "false"}:${cols.join(",")}`);
    }
  }
  for (const en of Object.values(snap.enums ?? {})) {
    out.enums.push(`${en.name}:${en.values.join(",")}`);
  }

  out.columns.sort(); out.pks.sort(); out.uniques.sort(); out.fks.sort(); out.indexes.sort(); out.enums.sort();
  return out;
}

export type StructuralDiff = { component: keyof StructuralProjection; onlyExpected: string[]; onlyActual: string[] };

export function diffStructural(expected: StructuralProjection, actual: StructuralProjection): StructuralDiff[] {
  const components: (keyof StructuralProjection)[] = ["columns", "pks", "uniques", "fks", "indexes", "enums"];
  const diffs: StructuralDiff[] = [];
  for (const component of components) {
    const e = new Set(expected[component]);
    const a = new Set(actual[component]);
    const onlyExpected = [...e].filter((x) => !a.has(x));
    const onlyActual = [...a].filter((x) => !e.has(x));
    if (onlyExpected.length > 0 || onlyActual.length > 0) diffs.push({ component, onlyExpected, onlyActual });
  }
  return diffs;
}

export function structuralDigest(p: StructuralProjection): string {
  const body = [
    "columns", ...p.columns, "pks", ...p.pks, "uniques", ...p.uniques,
    "fks", ...p.fks, "indexes", ...p.indexes, "enums", ...p.enums,
  ].join("\n");
  return createHash("sha256").update(body).digest("hex");
}

// ---------------------------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------------------------

export type PreflightState = "OK" | "BASELINE_RECONCILIATION_REQUIRED" | "INCONSISTENT";
export const EXIT: Record<PreflightState, number> = {
  OK: 0,
  BASELINE_RECONCILIATION_REQUIRED: 10,
  INCONSISTENT: 20,
};

export type Finding = { code: string; detail: string };

export type PreflightResult = {
  state: PreflightState;
  findings: Finding[];
  appliedPrefix: string[];   // tags considered applied
  pending: string[];         // tags considered pending
  watermark: number | null;
  bookkeepingPresent: boolean;
  bookkeepingRowCount: number;
  schemaChecked: boolean;
  schemaMatchesPrefix: boolean | null;
  structuralDigestActual: string | null;
};

/** The reference registry verify-migration-baseline emits, used only to recognise a push shape. */
export type SchemaReference = { pushStructuralDigest?: string; prefixStructuralDigests?: Record<string, string> };

export function readSchemaReference(path: string): SchemaReference | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SchemaReference;
  } catch {
    return null;
  }
}

/**
 * The state machine.
 *
 * Bookkeeping validity alone is NOT sufficient for OK (AUD-08.1 mandatory correction): the live
 * schema must also match the schema expected at the applied prefix.
 */
export function classify(args: {
  journal: Journal;
  journalFindings: Finding[];
  bookkeeping: Bookkeeping;
  fileHashes: Map<string, string>;
  schemaMatchesPrefix: boolean | null;
  actualMatchesPushReference: boolean | null;
  structuralDigestActual: string | null;
}): PreflightResult {
  const { journal, bookkeeping, fileHashes } = args;
  const findings: Finding[] = [...args.journalFindings];
  const w = watermark(bookkeeping);

  // Index the bookkeeping by created_at up front: the applied prefix is defined by ROW PRESENCE,
  // not by the watermark.
  //
  // Defining it by the watermark (`when <= MAX(created_at)`) was wrong in two ways. It made R7
  // unreachable — `pending` was then "when > watermark" by construction, so no pending entry could
  // ever be at or below it — and it mis-diagnosed a wall-clock stamp as five missing rows rather
  // than as five migrations that will be silently skipped. Row presence gives the honest picture:
  // the applied set MUST be a contiguous prefix, a row outside it is a hole, and anything after it
  // whose `when` sits at or below the watermark is a migration drizzle will skip in silence.
  const rowsByWhen = new Map<number, BookkeepingRow[]>();
  for (const r of bookkeeping.rows) {
    const n = r.created_at === null ? NaN : Number(r.created_at);
    if (!Number.isFinite(n)) continue;
    const list = rowsByWhen.get(n) ?? [];
    list.push(r);
    rowsByWhen.set(n, list);
  }

  let prefixLen = 0;
  while (prefixLen < journal.entries.length && rowsByWhen.has(journal.entries[prefixLen].when)) prefixLen++;
  const applied = journal.entries.slice(0, prefixLen);
  const pending = journal.entries.slice(prefixLen);

  const base = {
    appliedPrefix: applied.map((e) => e.tag),
    pending: pending.map((e) => e.tag),
    watermark: w,
    bookkeepingPresent: bookkeeping.present,
    bookkeepingRowCount: bookkeeping.rows.length,
    schemaChecked: args.schemaMatchesPrefix !== null,
    schemaMatchesPrefix: args.schemaMatchesPrefix,
    structuralDigestActual: args.structuralDigestActual,
  };

  // A journal that is structurally broken is never anything but INCONSISTENT — it is the input to
  // every other decision, so nothing downstream can be trusted.
  if (findings.length > 0) {
    return { state: "INCONSISTENT", findings, ...base };
  }

  // --- Case 1: no bookkeeping at all, or an empty table. This is the shape a `db:push` database
  // has. It is NOT corruption and it is NOT healthy either: history has never been recorded.
  if (!bookkeeping.present || bookkeeping.rows.length === 0) {
    findings.push({
      code: "BK_ABSENT",
      detail: bookkeeping.present
        ? `${BOOKKEEPING_SCHEMA}.${BOOKKEEPING_TABLE} exists but holds 0 rows: no migration history has been recorded`
        : `${BOOKKEEPING_SCHEMA}.${BOOKKEEPING_TABLE} does not exist: no migration history has been recorded`,
    });
    // Only call it a baseline situation if the live schema is a recognised push-equivalent shape.
    // Otherwise we do not know what this database is, and guessing is exactly what must not happen.
    if (args.actualMatchesPushReference === true) {
      findings.push({ code: "SCHEMA_IS_PUSH_SHAPE", detail: "live schema matches the proven db:push reference shape" });
      return { state: "BASELINE_RECONCILIATION_REQUIRED", findings, ...base };
    }
    findings.push({
      code: "SCHEMA_UNRECOGNISED",
      detail:
        args.actualMatchesPushReference === null
          ? "no db:push reference digest available, so the live schema cannot be recognised; refusing to classify this as a baseline situation"
          : "live schema does not match the proven db:push reference shape",
    });
    return { state: "INCONSISTENT", findings, ...base };
  }

  // --- Case 2: bookkeeping exists. Require EXACT correspondence over the applied prefix.
  for (const r of bookkeeping.rows) {
    if (r.created_at === null || !Number.isFinite(Number(r.created_at))) {
      findings.push({ code: "BK_BAD_CREATED_AT", detail: `bookkeeping row id=${r.id} has a non-numeric created_at` });
    }
  }

  // R2 — duplicate created_at.
  for (const [when, rows] of rowsByWhen) {
    if (rows.length > 1) {
      findings.push({ code: "R2", detail: `duplicate bookkeeping rows for created_at=${when} (ids ${rows.map((r) => r.id).join(", ")})` });
    }
  }

  const journalWhens = new Set(journal.entries.map((e) => e.when));

  // R3 — orphan bookkeeping rows.
  for (const when of rowsByWhen.keys()) {
    if (!journalWhens.has(when)) {
      findings.push({ code: "R3", detail: `bookkeeping row created_at=${when} matches no journal entry` });
    }
  }

  // R1 — a hole: a row exists for an entry that is NOT inside the contiguous applied prefix, which
  // means an earlier entry's row is missing. Drizzle cannot see this at all, because it only ever
  // reads the single highest row.
  for (const e of pending) {
    if (rowsByWhen.has(e.when)) {
      findings.push({
        code: "R1",
        detail: `bookkeeping is not a contiguous prefix: ${e.tag} (when=${e.when}) HAS a row while an earlier migration does not${
          pending.length > 0 && pending[0].tag !== e.tag ? ` (first gap at ${pending[0].tag})` : ""
        }`,
      });
    }
  }

  // X3 / R4 — hash equality over the applied prefix. Drizzle writes this column and never reads it.
  for (const e of applied) {
    const rows = rowsByWhen.get(e.when) ?? [];
    const expected = fileHashes.get(e.tag);
    if (expected === undefined) continue; // MISSING_SQL already recorded by journalInvariants
    for (const r of rows) {
      if (r.hash !== expected) {
        findings.push({
          code: "R4",
          detail: `hash mismatch for ${e.tag}: bookkeeping row id=${r.id} records ${r.hash.slice(0, 12)}…, file is ${expected.slice(0, 12)}…`,
        });
      }
    }
  }

  // R7 — a pending migration whose `when` is at or below the watermark. Drizzle's test is
  // `Number(last.created_at) < folderMillis`, so such a migration is SKIPPED, silently, exit 0.
  for (const e of pending) {
    if (w !== null && e.when <= w) {
      findings.push({ code: "R7", detail: `pending migration ${e.tag} (when=${e.when}) is at or below the watermark ${w} and would be SILENTLY SKIPPED` });
    }
  }

  if (findings.length > 0) {
    return { state: "INCONSISTENT", findings, ...base };
  }

  // --- Mandatory schema/bookkeeping consistency. Bookkeeping being valid is not enough.
  if (args.schemaMatchesPrefix === null) {
    findings.push({
      code: "SCHEMA_UNCHECKED",
      detail: "the live schema could not be compared against the applied prefix (no snapshot for that prefix); refusing to return OK",
    });
    return { state: "INCONSISTENT", findings, ...base };
  }

  if (args.schemaMatchesPrefix === false) {
    // Bookkeeping is internally valid but the database is not at the shape that prefix implies.
    // If it is demonstrably the current push shape, this is the historical pattern AUD-08 repairs.
    if (args.actualMatchesPushReference === true) {
      findings.push({
        code: "BK_BEHIND_SCHEMA_AHEAD",
        detail: "bookkeeping is valid but behind; the live schema matches the proven db:push reference shape",
      });
      return { state: "BASELINE_RECONCILIATION_REQUIRED", findings, ...base };
    }
    findings.push({
      code: "SCHEMA_PREFIX_MISMATCH",
      detail:
        args.actualMatchesPushReference === null
          ? "live schema does not match the applied prefix, and no db:push reference digest is available to explain it"
          : "live schema matches neither the applied prefix nor the proven db:push reference shape",
    });
    return { state: "INCONSISTENT", findings, ...base };
  }

  return { state: "OK", findings, ...base };
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

/** Host and database only. The password and the full URL are never reported. */
export function describeTarget(url: string): string {
  try {
    const u = new URL(url);
    const db = u.pathname.replace(/^\//, "") || "(none)";
    const host = u.hostname || "(socket)";
    const port = u.port || "5432";
    return `host=${host} port=${port} database=${db}`;
  } catch {
    return "host=(unparseable) database=(unparseable)";
  }
}

const MIGRATIONS_FOLDER = process.env.AUD08_MIGRATIONS_FOLDER ?? "drizzle";
const REFERENCE_PATH = process.env.AUD08_SCHEMA_REFERENCE ?? join("docs", "audits", "aud-08", "evidence", "schema-reference.json");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("preflight: DATABASE_URL is not set. Set it explicitly for the target database.");
    process.exit(1);
  }

  console.log("── migration preflight ──");
  console.log(`target        : ${describeTarget(url)}`);
  console.log(`migrations    : ${MIGRATIONS_FOLDER}`);

  const journal = readJournal(MIGRATIONS_FOLDER);
  const journalFindings = journalInvariants(journal, MIGRATIONS_FOLDER);
  const fileHashes = new Map<string, string>();
  for (const e of journal.entries) {
    const p = migrationSqlPath(MIGRATIONS_FOLDER, e.tag);
    if (existsSync(p)) fileHashes.set(e.tag, sha256File(p));
  }
  console.log(`journal       : ${journal.entries.length} entries, version ${journal.version}, dialect ${journal.dialect}`);

  const reference = readSchemaReference(REFERENCE_PATH);
  const pool = new Pool({ connectionString: url, max: 1 });
  let result: PreflightResult;
  try {
    const client = await pool.connect();
    try {
      const bookkeeping = await readBookkeeping(client);
      const w = watermark(bookkeeping);
      const applied = journal.entries.filter((e) => w !== null && e.when <= w);

      const actualStructural = await projectLiveStructural(client);
      const actualDigest = structuralDigest(actualStructural);

      // Compare against the snapshot for the applied prefix. "Applied prefix N" means snapshot
      // idx N-1 (0 entries applied => an empty schema is expected).
      let schemaMatchesPrefix: boolean | null = null;
      let prefixDiffs: StructuralDiff[] = [];
      if (applied.length === 0) {
        schemaMatchesPrefix = actualStructural.columns.length === 0;
        if (!schemaMatchesPrefix) {
          prefixDiffs = diffStructural(emptyStructural(), actualStructural);
        }
      } else {
        const lastIdx = applied[applied.length - 1].idx;
        try {
          const snap = readSnapshot(MIGRATIONS_FOLDER, lastIdx);
          const expected = projectSnapshotStructural(snap);
          prefixDiffs = diffStructural(expected, actualStructural);
          schemaMatchesPrefix = prefixDiffs.length === 0;
        } catch {
          schemaMatchesPrefix = null;
        }
      }

      const actualMatchesPushReference =
        reference?.pushStructuralDigest === undefined ? null : reference.pushStructuralDigest === actualDigest;

      result = classify({
        journal,
        journalFindings,
        bookkeeping,
        fileHashes,
        schemaMatchesPrefix,
        actualMatchesPushReference,
        structuralDigestActual: actualDigest,
      });

      console.log(`bookkeeping   : ${bookkeeping.present ? `present, ${bookkeeping.rows.length} row(s)` : "ABSENT"}`);
      console.log(`watermark     : ${w === null ? "(none)" : w}`);
      console.log(`applied       : ${result.appliedPrefix.length === 0 ? "(none)" : result.appliedPrefix.join(", ")}`);
      console.log(`pending       : ${result.pending.length === 0 ? "(none)" : result.pending.join(", ")}`);
      console.log(`schema digest : ${actualDigest.slice(0, 16)}… (structural)`);
      console.log(`push reference: ${reference?.pushStructuralDigest ? `${reference.pushStructuralDigest.slice(0, 16)}…` : "(not available)"}`);
      console.log(`schema vs prefix: ${schemaMatchesPrefix === null ? "UNCHECKED" : schemaMatchesPrefix ? "match" : "MISMATCH"}`);

      if (prefixDiffs.length > 0) {
        for (const d of prefixDiffs) {
          const miss = d.onlyExpected.length;
          const extra = d.onlyActual.length;
          console.log(`  ${d.component}: ${miss} expected-but-absent, ${extra} present-but-unexpected`);
          for (const x of d.onlyExpected.slice(0, 3)) console.log(`     - missing : ${x}`);
          for (const x of d.onlyActual.slice(0, 3)) console.log(`     + extra   : ${x}`);
        }
      }
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(`preflight: could not inspect the target database: ${e instanceof Error ? e.message : String(e)}`);
    await pool.end();
    process.exit(1);
  }
  await pool.end();

  console.log("");
  for (const f of result.findings) console.log(`  [${f.code}] ${f.detail}`);
  console.log("");
  console.log(`STATE: ${result.state}`);
  if (result.state === "OK") {
    console.log("migrate: PERMITTED");
  } else if (result.state === "BASELINE_RECONCILIATION_REQUIRED") {
    console.log("migrate: REFUSED — only the separately reviewed stamp workflow may resolve this,");
    console.log("         and only after schema and data equivalence are proven (AUD-08.3).");
  } else {
    console.log("migrate: REFUSED. stamp: REFUSED. This is a consistency failure, not a baseline");
    console.log("         situation; stamping would conceal it. Human diagnosis required.");
  }
  process.exit(EXIT[result.state]);
}

// Only run the CLI when invoked directly, so the verify harness can import the projections.
const invokedDirectly = process.argv[1] !== undefined && /migration-preflight\.ts$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
