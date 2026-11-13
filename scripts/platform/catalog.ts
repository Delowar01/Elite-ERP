/**
 * Platform Owner PO-01A — catalog projection used to prove that
 *   (a) drizzle/platform/PO01_platform_identity.sql is equivalent to src/db/schema/platform.ts, and
 *   (b) neither touches any non-platform (tenant) object.
 * Read-only: SELECTs against pg_catalog only.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { AUDIT_PROTECTION_QUERY, evaluateAuditProtection, type AuditProtectionRow } from "@/lib/platform/audit-protection";

export const PLATFORM_SQL_PATH = join(process.cwd(), "drizzle", "platform", "PO01_platform_identity.sql");
export const PLATFORM_TABLES = ["platform_admins", "platform_sessions", "platform_login_attempts", "platform_audit_events"] as const;

type Queryable = { query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }> };

export type CatalogProjection = {
  tables: string[];
  columns: string[];
  constraints: string[];
  indexes: string[];
  triggers: string[];
  functions: string[];
  sequences: string[];
};

const isPlatform = (name: string | null | undefined) => typeof name === "string" && name.startsWith("platform_");

async function rows<T>(client: Queryable, sql: string): Promise<T[]> {
  return (await client.query(sql)).rows as T[];
}

/** Full public-schema projection, split into platform-owned and everything else. */
export async function projectCatalog(client: Queryable): Promise<{ platform: CatalogProjection; other: CatalogProjection }> {
  const tables = await rows<{ t: string }>(
    client,
    `select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p')`,
  );
  const columns = await rows<{ t: string; line: string }>(
    client,
    `select c.relname as t,
            concat_ws(' | ', c.relname, a.attnum, a.attname, format_type(a.atttypid, a.atttypmod),
                      case when a.attnotnull then 'not null' else 'null' end,
                      coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), coalesce(nullif(a.attidentity, ''), '-'),
                      coalesce(nullif(a.attgenerated, ''), '-'), coalesce(coll.collname, '-')) as line
     from pg_attribute a
     join pg_class c on c.oid = a.attrelid
     join pg_namespace n on n.oid = c.relnamespace
     left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     left join pg_collation coll on coll.oid = a.attcollation and coll.collname <> 'default'
     where n.nspname = 'public' and c.relkind in ('r','p') and a.attnum > 0 and not a.attisdropped`,
  );
  const constraints = await rows<{ t: string; line: string }>(
    client,
    `select c.relname as t,
            concat_ws(' | ', c.relname, con.conname, con.contype, pg_get_constraintdef(con.oid, true),
                      case when con.convalidated then 'validated' else 'not-validated' end,
                      case when con.condeferrable then 'deferrable' else 'immediate' end) as line
     from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'`,
  );
  const indexes = await rows<{ t: string; line: string }>(
    client,
    `select c.relname as t, concat_ws(' | ', c.relname, i.relname, pg_get_indexdef(ix.indexrelid)) as line
     from pg_index ix join pg_class i on i.oid = ix.indexrelid join pg_class c on c.oid = ix.indrelid
     join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'`,
  );
  const triggers = await rows<{ t: string; line: string }>(
    client,
    `select c.relname as t, concat_ws(' | ', c.relname, tg.tgname, pg_get_triggerdef(tg.oid, true), tg.tgenabled) as line
     from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not tg.tgisinternal`,
  );
  const functions = await rows<{ f: string; line: string }>(
    client,
    `select p.proname as f,
            concat_ws(' | ', p.proname, pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid), l.lanname,
                      regexp_replace(p.prosrc, '\\s+', ' ', 'g')) as line
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
     where n.nspname = 'public'`,
  );
  const sequences = await rows<{ owner: string | null; s: string; line: string }>(
    client,
    `select owner_tbl.relname as owner, s.relname as s,
            concat_ws(' | ', s.relname, format_type(sq.seqtypid, null), sq.seqstart, sq.seqincrement, sq.seqmin, sq.seqmax,
                      sq.seqcache, sq.seqcycle, coalesce(owner_tbl.relname || '.' || owner_col.attname, '-')) as line
     from pg_sequence sq
     join pg_class s on s.oid = sq.seqrelid
     join pg_namespace n on n.oid = s.relnamespace
     left join pg_depend dep on dep.objid = s.oid and dep.classid = 'pg_class'::regclass
          and dep.refclassid = 'pg_class'::regclass and dep.deptype in ('a', 'i')
     left join pg_class owner_tbl on owner_tbl.oid = dep.refobjid
     left join pg_attribute owner_col on owner_col.attrelid = dep.refobjid and owner_col.attnum = dep.refobjsubid
     where n.nspname = 'public'`,
  );

  const split = <T>(items: T[], pick: (x: T) => boolean, line: (x: T) => string) => ({
    platform: items.filter(pick).map(line).sort(),
    other: items.filter((x) => !pick(x)).map(line).sort(),
  });
  const tb = split(tables, (r) => isPlatform(r.t), (r) => r.t);
  const co = split(columns, (r) => isPlatform(r.t), (r) => r.line);
  const cn = split(constraints, (r) => isPlatform(r.t), (r) => r.line);
  const ix = split(indexes, (r) => isPlatform(r.t), (r) => r.line);
  const tg = split(triggers, (r) => isPlatform(r.t), (r) => r.line);
  const fn = split(functions, (r) => isPlatform(r.f), (r) => r.line);
  const sq = split(sequences, (r) => isPlatform(r.owner) || isPlatform(r.s), (r) => r.line);
  return {
    platform: { tables: tb.platform, columns: co.platform, constraints: cn.platform, indexes: ix.platform, triggers: tg.platform, functions: fn.platform, sequences: sq.platform },
    other: { tables: tb.other, columns: co.other, constraints: cn.other, indexes: ix.other, triggers: tg.other, functions: fn.other, sequences: sq.other },
  };
}

/** Restrict a projection to the object classes drizzle-kit push can create (no triggers/functions). */
export function withoutRoutines(p: CatalogProjection): CatalogProjection {
  return { ...p, triggers: [], functions: [] };
}

export function projectionDigest(p: CatalogProjection): string {
  return createHash("sha256").update(JSON.stringify(p)).digest("hex");
}

/** Human-readable differences (empty array = identical). */
export function diffProjection(a: CatalogProjection, b: CatalogProjection, labelA = "A", labelB = "B"): string[] {
  const out: string[] = [];
  for (const key of Object.keys(a) as (keyof CatalogProjection)[]) {
    const setB = new Set(b[key]);
    const setA = new Set(a[key]);
    for (const x of a[key]) if (!setB.has(x)) out.push(`${key}: only in ${labelA}: ${x}`);
    for (const x of b[key]) if (!setA.has(x)) out.push(`${key}: only in ${labelB}: ${x}`);
  }
  return out;
}

export type PlatformObjectReport = { ok: boolean; findings: string[]; tablesPresent: string[] };

/** Verify the platform objects exist and the audit trail is protected (decoy-resistant). */
export async function checkPlatformObjects(client: Queryable): Promise<PlatformObjectReport> {
  const findings: string[] = [];
  const present = (
    await rows<{ t: string }>(
      client,
      `select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = current_schema() and c.relkind = 'r' and c.relname like 'platform\\_%'`,
    )
  ).map((r) => r.t);
  for (const t of PLATFORM_TABLES) if (!present.includes(t)) findings.push(`missing table ${t}`);
  if (present.includes("platform_audit_events")) {
    const verdict = evaluateAuditProtection(await rows<AuditProtectionRow>(client, AUDIT_PROTECTION_QUERY));
    for (const m of verdict.missing) findings.push(`audit protection missing: ${m}`);
  }
  return { ok: findings.length === 0, findings, tablesPresent: present.sort() };
}
