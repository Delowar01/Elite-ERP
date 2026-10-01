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
 * Exit:  0  = OK                                (migrate PERMITTED)
 *        10 = BASELINE RECONCILIATION REQUIRED  (migrate refused; stamp workflow may resolve, AUD-08.3)
 *        20 = INCONSISTENT                      (migrate refused; stamp refused)
 *        30 = REFERENCE_STALE                   (the gate's own evidence does not describe the current
 *                                                migrations, or is missing; it refuses to judge at all)
 *        1  = tool error (unreadable journal, no connection, bad arguments)
 *
 * Authorization evidence: OK is granted ONLY when the target's FULL F1–F6 semantic digest equals the
 * MEASURED digest for its applied prefix (schema-reference.json, produced from disposable databases
 * by verify-migration-baseline). The structural projection is printed for diagnosis and is never a
 * permission input. A fresh database is OK only if it is empty across every object class AND its
 * digest equals the measured "empty" digest.
 *
 * Secrets: DATABASE_URL is never printed. Only host and database name are reported.
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
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
// Emptiness — what "a fresh database" actually means
// ---------------------------------------------------------------------------------------------

/**
 * A fresh database is a legitimate state: no bookkeeping, nothing applied, every migration pending,
 * and `migrate` should be allowed to initialize it. The first version of this tool got that wrong
 * and refused it.
 *
 * But "no tables in one narrow projection" is not emptiness. A database carrying views, sequences,
 * enum types, functions or triggers — or an unexpected application schema — is NOT fresh, and
 * treating it as fresh would let `migrate` run against something nobody has identified. So every
 * class of application object is counted, and `drizzle`'s own bookkeeping schema is the single
 * permitted exception.
 */
export type Emptiness = {
  empty: boolean;
  counts: Record<string, number>;
  extraSchemas: string[];
  detail: string;
};

const SYSTEM_SCHEMAS = ["pg_catalog", "information_schema", "pg_toast"];

export async function measureEmptiness(client: ClientBase): Promise<Emptiness> {
  const q = async (sql: string): Promise<number> => {
    const { rows } = await client.query<{ n: number }>(sql);
    return Number(rows[0]?.n ?? 0);
  };

  const counts: Record<string, number> = {
    tables: await q(`select count(*)::int as n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`),
    views: await q(`select count(*)::int as n from information_schema.tables where table_schema='public' and table_type='VIEW'`),
    matviews: await q(`select count(*)::int as n from pg_matviews where schemaname='public'`),
    sequences: await q(`select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='S' and n.nspname='public'`),
    // Enums, composites and domains all live in pg_type. Exclude the row-types PostgreSQL creates
    // implicitly for every table/view/sequence, otherwise this can never read zero.
    types: await q(`select count(*)::int as n from pg_type t join pg_namespace n on n.oid=t.typnamespace
                     where n.nspname='public' and t.typtype in ('e','c','d')
                       and not exists (select 1 from pg_class c where c.reltype = t.oid)`),
    routines: await q(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`),
    triggers: await q(`select count(*)::int as n from pg_trigger t join pg_class c on c.oid=t.tgrelid
                        join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal`),
  };

  // Any non-system schema other than `public` and drizzle's own bookkeeping schema is unexpected.
  const { rows: schemaRows } = await client.query<{ nspname: string }>(
    `select nspname from pg_namespace
      where nspname <> all($1::text[]) and nspname not like 'pg_temp%' and nspname not like 'pg_toast%'
        and nspname not in ('public', $2) order by 1`,
    [SYSTEM_SCHEMAS, BOOKKEEPING_SCHEMA],
  );
  const extraSchemas = schemaRows.map((r) => r.nspname);

  const nonZero = Object.entries(counts).filter(([, n]) => n > 0);
  const empty = nonZero.length === 0 && extraSchemas.length === 0;
  const detail = empty
    ? "public schema holds no tables, views, materialized views, sequences, enum/composite/domain types, routines or triggers, and there is no unexpected schema"
    : [
        nonZero.length > 0 ? nonZero.map(([k, n]) => `${k}=${n}`).join(" ") : "",
        extraSchemas.length > 0 ? `unexpected schemas: ${extraSchemas.join(", ")}` : "",
      ].filter(Boolean).join("; ");

  return { empty, counts, extraSchemas, detail };
}

// ---------------------------------------------------------------------------------------------
// Reference binding — a stale reference must never be trusted silently
// ---------------------------------------------------------------------------------------------

/**
 * Identity of the MIGRATION inputs: ordered journal tuples plus each migration file's own sha256.
 *
 * Deliberately NOT the git HEAD. A tooling-only commit legitimately moves HEAD without changing a
 * single migration, and a reference refused for that reason would train people to bypass the gate.
 * Content identity moves if and only if the migrations or the journal move.
 */
export function migrationJournalDigest(journal: Journal, fileHashes: Map<string, string>): string {
  const body = journal.entries
    .map((e) => `${e.idx}|${e.when}|${e.tag}|${fileHashes.get(e.tag) ?? "MISSING"}`)
    .join("\n");
  return createHash("sha256").update(`${journal.version}|${journal.dialect}\n${body}`).digest("hex");
}

/**
 * Identity of the SCHEMA SOURCE inputs that produced the push reference: every schema module plus
 * the drizzle config, hashed in a stable path order. If these move, `db:push` may produce a
 * different shape, so `pushSemanticDigest` must no longer be used to recognise a baseline.
 */
export function schemaSourceDigest(schemaDir = join("src", "db", "schema"), configPath = "drizzle.config.ts"): string {
  const hash = createHash("sha256");
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && /\.(ts|mts)$/.test(entry.name)) files.push(p);
    }
  };
  if (existsSync(schemaDir)) walk(schemaDir);
  // Paths are hashed RELATIVE to the schema directory, and the config under a fixed label, so the
  // identity is a function of CONTENT and layout only. Hashing absolute paths would make a
  // byte-identical checkout at another location read as stale — a false REFERENCE_STALE that
  // would teach people to ignore the gate.
  const entries = files
    .map((f) => ({ label: relative(schemaDir, f).split(sep).join("/"), path: f }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (existsSync(configPath)) entries.push({ label: "<drizzle.config>", path: configPath });
  for (const e of entries) {
    hash.update(`${e.label}\n`);
    hash.update(readFileSync(e.path));
    hash.update("\n");
  }
  return hash.digest("hex");
}

// ---------------------------------------------------------------------------------------------
// Structural projection — DIAGNOSTIC ONLY
// ---------------------------------------------------------------------------------------------

/**
 * ===============================================================================================
 *   STRUCTURAL EQUALITY IS DIAGNOSTIC ONLY.
 *   IT MUST NEVER AUTHORIZE MIGRATION EXECUTION.
 * ===============================================================================================
 *
 * This projection exists to tell a HUMAN what differs between a database and a drizzle snapshot,
 * in terms both sides can express: column identity, NOT NULL, primary keys, uniques, foreign keys
 * with their actions, declared indexes and enum values.
 *
 * It deliberately omits column types, defaults, numeric precision and scale, CHECK constraints and
 * sequence ownership, because a drizzle snapshot spells those differently from the catalog
 * ("serial" vs integer + a nextval default; "numeric(15, 3)" vs numeric + precision + scale) and an
 * approximate translation would be a second thing to get wrong.
 *
 * That omission is exactly why it cannot gate anything. AUD-08.1 MEASURED that 61 money columns
 * differ ONLY in precision/scale between a migrations-built and a push-built database — a
 * difference this projection cannot see at all. An earlier version of this tool used it as the
 * equality gate for OK; review correctly rejected that (AUD-08.1-C1, Blocker 2).
 *
 * The permission decision uses the FULL semantic F1–F6 digest (`projectLive` + `fingerprintDigest`)
 * compared against MEASURED reference digests. See `classify`.
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
/** Distinct from all three states: the gate's own evidence is unusable, so it refuses to judge. */
export const EXIT_REFERENCE_STALE = 30;

export type Finding = { code: string; detail: string };

export type PreflightResult = {
  state: PreflightState;
  findings: Finding[];
  appliedPrefix: string[];   // tags considered applied
  pending: string[];         // tags considered pending
  watermark: number | null;
  bookkeepingPresent: boolean;
  bookkeepingRowCount: number;
  /** The reference key the applied prefix maps to: "empty", or the idx of the last applied entry. */
  prefixKey: string;
  semanticDigestActual: string | null;
  semanticDigestExpected: string | null;
};

/**
 * The reference registry verify-migration-baseline emits from DISPOSABLE databases.
 *
 * Every digest here is MEASURED — `projectLive` + `fingerprintDigest` against a database that the
 * migrations (or `db:push`) actually built — never translated from snapshot JSON.
 */
export type SchemaReference = {
  /** Content identity of the migration inputs that produced the prefix digests. */
  migrationJournalDigest?: string;
  /** Content identity of the schema-source inputs that produced the push digest. */
  schemaSourceDigest?: string;
  /** FULL F1–F6 semantic digests keyed by prefix: "empty", "0", "1", ... */
  prefixSemanticDigests?: Record<string, string>;
  /** FULL F1–F6 semantic digest of the current db:push shape. */
  pushSemanticDigest?: string;
  /** Diagnostic only — never consulted for a permission decision. */
  pushStructuralDigest?: string;
  prefixStructuralDigests?: Record<string, string>;
};

export function readSchemaReference(path: string): SchemaReference | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SchemaReference;
  } catch {
    return null;
  }
}

/** "empty" when nothing is applied, else the idx of the last applied journal entry. */
export function prefixKeyFor(applied: JournalEntry[]): string {
  return applied.length === 0 ? "empty" : String(applied[applied.length - 1].idx);
}

/**
 * Freshness binding. Returns the reasons the reference may not be used, split by WHICH part:
 *   - migration identity stale  => the prefix digests are unusable => REFUSE the whole run
 *   - schema-source identity stale => only the push digest is unusable => no baseline recognition
 * Never regenerated here: db:preflight is read-only and evidence is produced by the verify suite.
 */
export function referenceFreshness(args: {
  reference: SchemaReference | null;
  currentMigrationDigest: string;
  currentSchemaSourceDigest: string;
}): { migrationsUsable: boolean; pushUsable: boolean; findings: Finding[] } {
  const { reference } = args;
  const findings: Finding[] = [];
  if (reference === null) {
    findings.push({ code: "REFERENCE_MISSING", detail: "no readable schema-reference.json; the gate has no measured digests to compare against" });
    return { migrationsUsable: false, pushUsable: false, findings };
  }

  let migrationsUsable = true;
  if (!reference.migrationJournalDigest) {
    migrationsUsable = false;
    findings.push({ code: "REFERENCE_STALE", detail: "reference carries no migrationJournalDigest, so it cannot be bound to the current migrations" });
  } else if (reference.migrationJournalDigest !== args.currentMigrationDigest) {
    migrationsUsable = false;
    findings.push({
      code: "REFERENCE_STALE",
      detail: `reference was measured against different migration inputs (reference ${reference.migrationJournalDigest.slice(0, 12)}…, current ${args.currentMigrationDigest.slice(0, 12)}…). Re-run verify-migration-baseline to regenerate it.`,
    });
  }

  let pushUsable = true;
  if (!reference.schemaSourceDigest || !reference.pushSemanticDigest) {
    pushUsable = false;
    findings.push({ code: "PUSH_REFERENCE_UNAVAILABLE", detail: "reference carries no schemaSourceDigest/pushSemanticDigest; baseline recognition disabled" });
  } else if (reference.schemaSourceDigest !== args.currentSchemaSourceDigest) {
    pushUsable = false;
    findings.push({
      code: "PUSH_REFERENCE_STALE",
      detail: `schema source changed since the push reference was measured (reference ${reference.schemaSourceDigest.slice(0, 12)}…, current ${args.currentSchemaSourceDigest.slice(0, 12)}…); baseline recognition disabled`,
    });
  }

  return { migrationsUsable, pushUsable, findings };
}

/**
 * The state machine.
 *
 * OK requires the target's FULL F1–F6 semantic digest to equal the MEASURED digest for its applied
 * prefix. Structural equality is never consulted for a permission decision.
 *
 *   NO bookkeeping
 *     + empty application schema AND digest == reference["empty"]   -> OK (prefix 0, all pending)
 *     + digest == pushSemanticDigest (and push reference fresh)      -> BASELINE RECONCILIATION REQUIRED
 *     + anything else                                                -> INCONSISTENT
 *   bookkeeping present
 *     + any of R1–R7                                                 -> INCONSISTENT
 *     + digest == reference[prefix]                                  -> OK
 *     + digest == pushSemanticDigest (and push reference fresh)      -> BASELINE RECONCILIATION REQUIRED
 *     + anything else, or no reference for that prefix               -> INCONSISTENT
 */
export function classify(args: {
  journal: Journal;
  journalFindings: Finding[];
  bookkeeping: Bookkeeping;
  fileHashes: Map<string, string>;
  emptiness: Emptiness;
  semanticDigestActual: string;
  /** Measured F1–F6 digests by prefix key. null => no usable reference (fail closed). */
  prefixSemanticDigests: Record<string, string> | null;
  /** null => no usable push reference (missing or stale); baseline recognition is then impossible. */
  pushSemanticDigest: string | null;
}): PreflightResult {
  const { journal, bookkeeping, fileHashes } = args;
  const findings: Finding[] = [...args.journalFindings];
  const w = watermark(bookkeeping);

  // The applied prefix is defined by ROW PRESENCE, not by the watermark.
  //
  // Defining it by `when <= MAX(created_at)` made R7 unreachable — `pending` was then "when >
  // watermark" by construction — and mis-diagnosed a wall-clock stamp as missing rows rather than as
  // migrations drizzle will skip in silence. Row presence gives the honest picture: the applied set
  // MUST be a contiguous prefix, a row outside it is a hole, and anything after it at or below the
  // watermark is a silent skip.
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
  const prefixKey = prefixKeyFor(applied);
  const expected = args.prefixSemanticDigests?.[prefixKey] ?? null;

  const base = {
    appliedPrefix: applied.map((e) => e.tag),
    pending: pending.map((e) => e.tag),
    watermark: w,
    bookkeepingPresent: bookkeeping.present,
    bookkeepingRowCount: bookkeeping.rows.length,
    prefixKey,
    semanticDigestActual: args.semanticDigestActual,
    semanticDigestExpected: expected,
  };

  // A structurally broken journal is the input to every other decision; nothing downstream holds.
  if (findings.length > 0) return { state: "INCONSISTENT", findings, ...base };

  const matchesPush = args.pushSemanticDigest !== null && args.semanticDigestActual === args.pushSemanticDigest;

  // --- Case 1: no bookkeeping at all, or an empty table.
  if (!bookkeeping.present || bookkeeping.rows.length === 0) {
    findings.push({
      code: "BK_ABSENT",
      detail: bookkeeping.present
        ? `${BOOKKEEPING_SCHEMA}.${BOOKKEEPING_TABLE} exists but holds 0 rows`
        : `${BOOKKEEPING_SCHEMA}.${BOOKKEEPING_TABLE} does not exist`,
    });

    // A) A genuinely fresh database. Emptiness is measured across every object class, AND the full
    //    semantic digest must equal the measured "empty" reference. Both, not either.
    if (args.emptiness.empty) {
      const emptyRef = args.prefixSemanticDigests?.["empty"] ?? null;
      if (emptyRef === null) {
        findings.push({ code: "REFERENCE_MISSING_PREFIX", detail: "no measured semantic digest for the empty prefix; refusing to authorize" });
        return { state: "INCONSISTENT", findings, ...base };
      }
      if (args.semanticDigestActual !== emptyRef) {
        findings.push({ code: "EMPTY_DIGEST_MISMATCH", detail: "object counts read as empty but the F1–F6 digest is not the measured empty digest" });
        return { state: "INCONSISTENT", findings, ...base };
      }
      findings.push({ code: "FRESH_EMPTY", detail: args.emptiness.detail });
      return { state: "OK", findings, ...base };
    }

    // B) The exact proven push shape, recognised by the FULL semantic digest.
    if (matchesPush) {
      findings.push({ code: "SCHEMA_IS_PUSH_SHAPE", detail: "full F1–F6 semantic digest equals the measured db:push reference" });
      return { state: "BASELINE_RECONCILIATION_REQUIRED", findings, ...base };
    }

    // C) Anything else.
    findings.push({
      code: "SCHEMA_UNRECOGNISED",
      detail: `database is not empty (${args.emptiness.detail}) and its semantic digest matches ${
        args.pushSemanticDigest === null ? "no usable push reference" : "neither the empty nor the push reference"
      }`,
    });
    return { state: "INCONSISTENT", findings, ...base };
  }

  // --- Case 2: bookkeeping exists. Exact correspondence over the applied prefix.
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

  // R3 — orphan bookkeeping rows.
  const journalWhens = new Set(journal.entries.map((e) => e.when));
  for (const when of rowsByWhen.keys()) {
    if (!journalWhens.has(when)) findings.push({ code: "R3", detail: `bookkeeping row created_at=${when} matches no journal entry` });
  }

  // R1 — a hole: a row exists for an entry outside the contiguous applied prefix. Drizzle cannot see
  // this at all, because it only ever reads the single highest row.
  for (const e of pending) {
    if (rowsByWhen.has(e.when)) {
      findings.push({
        code: "R1",
        detail: `bookkeeping is not a contiguous prefix: ${e.tag} (when=${e.when}) HAS a row while an earlier migration does not${
          pending[0].tag !== e.tag ? ` (first gap at ${pending[0].tag})` : ""
        }`,
      });
    }
  }

  // X3 / R4 — hash equality over the applied prefix. Drizzle writes this column and never reads it.
  for (const e of applied) {
    const expectedHash = fileHashes.get(e.tag);
    if (expectedHash === undefined) continue; // MISSING_SQL already recorded by journalInvariants
    for (const r of rowsByWhen.get(e.when) ?? []) {
      if (r.hash !== expectedHash) {
        findings.push({
          code: "R4",
          detail: `hash mismatch for ${e.tag}: bookkeeping row id=${r.id} records ${r.hash.slice(0, 12)}…, file is ${expectedHash.slice(0, 12)}…`,
        });
      }
    }
  }

  // R7 — a pending migration at or below the watermark is SKIPPED by drizzle, silently, exit 0.
  for (const e of pending) {
    if (w !== null && e.when <= w) {
      findings.push({ code: "R7", detail: `pending migration ${e.tag} (when=${e.when}) is at or below the watermark ${w} and would be SILENTLY SKIPPED` });
    }
  }

  if (findings.length > 0) return { state: "INCONSISTENT", findings, ...base };

  // --- Mandatory schema/bookkeeping consistency, on the FULL semantic digest.
  if (expected === null) {
    findings.push({
      code: "REFERENCE_MISSING_PREFIX",
      detail: `no measured F1–F6 semantic digest for applied prefix "${prefixKey}"; refusing to authorize (no structural fallback)`,
    });
    return { state: "INCONSISTENT", findings, ...base };
  }

  if (args.semanticDigestActual === expected) {
    findings.push({ code: "SCHEMA_MATCHES_PREFIX", detail: `full F1–F6 semantic digest equals the measured digest for prefix "${prefixKey}"` });
    return { state: "OK", findings, ...base };
  }

  if (matchesPush) {
    findings.push({
      code: "BK_BEHIND_SCHEMA_AHEAD",
      detail: "bookkeeping is valid but behind; the full F1–F6 semantic digest equals the measured db:push reference",
    });
    return { state: "BASELINE_RECONCILIATION_REQUIRED", findings, ...base };
  }

  findings.push({
    code: "SCHEMA_PREFIX_MISMATCH",
    detail: `full F1–F6 semantic digest matches neither prefix "${prefixKey}" nor ${
      args.pushSemanticDigest === null ? "any usable push reference" : "the db:push reference"
    }`,
  });
  return { state: "INCONSISTENT", findings, ...base };
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
const SCHEMA_DIR = process.env.AUD08_SCHEMA_DIR ?? join("src", "db", "schema");
const SCHEMA_CONFIG = process.env.AUD08_SCHEMA_CONFIG ?? "drizzle.config.ts";

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

  // Freshness FIRST, before touching the database: if the migration reference is stale, nothing the
  // database says can be judged, and a judgement against stale evidence is worse than none.
  const reference = readSchemaReference(REFERENCE_PATH);
  const currentMigrationDigest = migrationJournalDigest(journal, fileHashes);
  const currentSchemaDigest = schemaSourceDigest(SCHEMA_DIR, SCHEMA_CONFIG);
  const fresh = referenceFreshness({ reference, currentMigrationDigest, currentSchemaSourceDigest: currentSchemaDigest });
  console.log(`reference     : ${existsSync(REFERENCE_PATH) ? REFERENCE_PATH : "(not found)"}`);
  console.log(`migration id  : current ${currentMigrationDigest.slice(0, 16)}… reference ${reference?.migrationJournalDigest?.slice(0, 16) ?? "(none)"}${reference?.migrationJournalDigest ? "…" : ""}`);
  console.log(`schema src id : current ${currentSchemaDigest.slice(0, 16)}… reference ${reference?.schemaSourceDigest?.slice(0, 16) ?? "(none)"}${reference?.schemaSourceDigest ? "…" : ""}`);

  if (!fresh.migrationsUsable) {
    console.log("");
    for (const f of fresh.findings) console.log(`  [${f.code}] ${f.detail}`);
    console.log("");
    console.log("STATE: REFERENCE_STALE");
    console.log("migrate: REFUSED. The gate's measured evidence does not describe the current migrations,");
    console.log("         so it will not judge this database. db:preflight never regenerates evidence.");
    process.exit(EXIT_REFERENCE_STALE);
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  let result: PreflightResult;
  try {
    const client = await pool.connect();
    try {
      const bookkeeping = await readBookkeeping(client);
      const emptiness = await measureEmptiness(client);
      const live = await projectLive(client);
      const semanticDigest = fingerprintDigest(live);

      result = classify({
        journal,
        journalFindings,
        bookkeeping,
        fileHashes,
        emptiness,
        semanticDigestActual: semanticDigest,
        prefixSemanticDigests: reference?.prefixSemanticDigests ?? null,
        pushSemanticDigest: fresh.pushUsable ? (reference?.pushSemanticDigest ?? null) : null,
      });

      console.log(`bookkeeping   : ${bookkeeping.present ? `present, ${bookkeeping.rows.length} row(s)` : "ABSENT"}`);
      console.log(`watermark     : ${result.watermark === null ? "(none)" : result.watermark}`);
      console.log(`applied       : ${result.appliedPrefix.length === 0 ? "(none)" : result.appliedPrefix.join(", ")}`);
      console.log(`pending       : ${result.pending.length === 0 ? "(none)" : result.pending.join(", ")}`);
      console.log(`emptiness     : ${emptiness.empty ? "EMPTY" : "not empty"} — ${emptiness.detail}`);
      console.log(`prefix key    : ${result.prefixKey}`);
      console.log(`semantic F1-6 : actual   ${semanticDigest.slice(0, 16)}…`);
      console.log(`                expected ${result.semanticDigestExpected ? `${result.semanticDigestExpected.slice(0, 16)}…` : "(no reference for this prefix)"}`);
      console.log(`                push     ${fresh.pushUsable && reference?.pushSemanticDigest ? `${reference.pushSemanticDigest.slice(0, 16)}…` : "(not usable)"}`);

      // DIAGNOSTIC ONLY. Printed to help a human locate a difference; never consulted above.
      if (result.state !== "OK" && result.appliedPrefix.length > 0) {
        const lastIdx = journal.entries[result.appliedPrefix.length - 1].idx;
        try {
          const actualStructural = await projectLiveStructural(client);
          const expectedStructural = projectSnapshotStructural(readSnapshot(MIGRATIONS_FOLDER, lastIdx));
          const diffs = diffStructural(expectedStructural, actualStructural);
          console.log(`structural    : ${diffs.length === 0 ? "no structural difference (the difference is semantic: type/default/precision/check/sequence)" : "differences below"}  [DIAGNOSTIC ONLY]`);
          for (const d of diffs) {
            console.log(`  ${d.component}: ${d.onlyExpected.length} expected-but-absent, ${d.onlyActual.length} present-but-unexpected`);
            for (const x of d.onlyExpected.slice(0, 3)) console.log(`     - missing : ${x}`);
            for (const x of d.onlyActual.slice(0, 3)) console.log(`     + extra   : ${x}`);
          }
        } catch {
          console.log("structural    : (no snapshot available for that prefix)  [DIAGNOSTIC ONLY]");
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
  for (const f of [...fresh.findings, ...result.findings]) console.log(`  [${f.code}] ${f.detail}`);
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
