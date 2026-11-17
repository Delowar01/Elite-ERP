/**
 * Platform Owner PO-02D1A — shared helpers for verify:platform-onboarding-schema and
 * verify:platform-onboarding-migration-safety. Disposable `*_test_only_*` databases only; every row these suites
 * write is fictional, and every fictional value (Trial length, seats, storage, labels, prices) is a TEST value, not an
 * approved business value — no seed exists until PO-02D1B.
 */
import { readFileSync } from "node:fs";
import type { Client } from "pg";
import { ONBOARDING_FUNCTIONS, ONBOARDING_TABLES, ONBOARDING_TRIGGERS, PO02D1_ROLLBACK_SQL_PATH, PO02D1_SQL_PATH, USERS_KEY } from "../../scripts/platform/catalog";
import { runStatements } from "./po02a-fixtures";

/** The step lines of a successful first application, in file order. */
export const PO02D1_CREATED = [
  "F1 users_org_id_id_uq: created",
  ...ONBOARDING_FUNCTIONS.map((f) => `fn ${f}: created`),
  "F2 platform_settings: created",
  "F3 subscription_packages: created",
  "F4 subscription_package_versions: created",
  "F5 tenant_primary_owners: created",
  "F6 tenant_subscriptions: created",
  "F7 subscription_events: created",
  "F8 organization_invitation_terms: created",
  ...ONBOARDING_TRIGGERS.map((t) => `trigger ${t.table}.${t.trigger}: created`),
] as const;
export const PO02D1_VERIFIED = PO02D1_CREATED.map((s) => s.replace(/created$/, "verified"));

/** Run the reviewed PO-02D1 foundation on an open client; returns its step lines. Rolls back on error. */
export async function runPo02d1(c: Client, sqlText = readFileSync(PO02D1_SQL_PATH, "utf8")): Promise<string[]> {
  try {
    const res = await c.query(sqlText);
    const results = Array.isArray(res) ? res : [res];
    return results.flatMap((r) => (r.rows ?? []).map((row: Record<string, unknown>) => row.po02d1_step)).filter((x): x is string => typeof x === "string");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}

/** Rollback step 1 (one transaction). Rolls back the client's transaction on error. */
export async function runPo02d1Rollback(c: Client): Promise<void> {
  try {
    await c.query(readFileSync(PO02D1_ROLLBACK_SQL_PATH, "utf8"));
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}

/** Rollback step 2 / the F1 runbook files (autocommit, statement by statement). */
export const runPo02d1Statements = (c: Client, path: string) => runStatements(c, path);

export type Po02d1Objects = { tables: string[]; functions: string[]; triggers: string[]; usersKey: boolean; usersIndex: boolean; scratch: boolean; helpers: number };

/** Which PO-02D1 objects exist right now (and whether any scratch schema or pg_temp helper was left behind). */
export async function po02d1Objects(c: Client): Promise<Po02d1Objects> {
  const q = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows;
  const tables = (await q(`select c.relname as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = any($1) order by 1`, [ONBOARDING_TABLES])).map((r) => r.n as string);
  const functions = (await q(`select p.proname as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1) order by 1`, [ONBOARDING_FUNCTIONS])).map((r) => r.n as string);
  const triggers = (await q(`select tg.tgname as n from pg_trigger tg where not tg.tgisinternal and tg.tgname = any($1) order by 1`, [ONBOARDING_TRIGGERS.map((t) => t.trigger)])).map((r) => r.n as string);
  const usersKey = (await q(`select 1 from pg_constraint where conrelid = 'public.users'::regclass and conname = $1`, [USERS_KEY.name])).length === 1;
  const usersIndex = (await q(`select to_regclass('public.${USERS_KEY.name}') is not null as x`))[0].x === true;
  const scratch = (await q(`select 1 from pg_namespace where nspname = 'po02d1_reference'`)).length === 1;
  const helpers = Number((await q(`select count(*)::int as n from pg_proc where proname like 'po02d1%'`))[0].n);
  return { tables, functions, triggers, usersKey, usersIndex, scratch, helpers };
}

/** No PO-02D1 object of any kind (the users key included), and nothing left behind. */
export const noPo02d1 = (o: Po02d1Objects) =>
  o.tables.length === 0 && o.functions.length === 0 && o.triggers.length === 0 && !o.usersKey && !o.usersIndex && !o.scratch && o.helpers === 0;
/** Every PO-02D1 object present (and nothing left behind). */
export const allPo02d1 = (o: Po02d1Objects) =>
  o.tables.length === ONBOARDING_TABLES.length && o.functions.length === ONBOARDING_FUNCTIONS.length && o.triggers.length === ONBOARDING_TRIGGERS.length &&
  o.usersKey && o.usersIndex && !o.scratch && o.helpers === 0;

/** The DDL templates, read from the migration itself (so the tests follow the file); %1$I → public. */
export function po02d1Ddl(needle: string): string {
  const text = readFileSync(PO02D1_SQL_PATH, "utf8");
  const m = text.split("$ddl$").find((part) => part.startsWith(needle));
  if (!m) throw new Error(`DDL starting with "${needle}" not found in ${PO02D1_SQL_PATH}`);
  return m.replace(/%1\$I/g, "public");
}
