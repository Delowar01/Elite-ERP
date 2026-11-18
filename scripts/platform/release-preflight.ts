/**
 * Platform Owner PO-02D1A.1 — release preflight for the push-before-SQL hazards (H-1 / H-2). READ-ONLY, FAIL CLOSED.
 *
 *   DATABASE_URL=postgres://…@127.0.0.1:<port>/<name containing _test_only_> npm run platform:db:preflight [-- --json] [-- --intent=migrate]
 *
 * One question, answered before any modifying command runs: may `drizzle-kit push` (`npm run db:push`) run against this
 * database now? The branch's Drizzle schema declares the reviewed Platform Owner objects (PO-01A, PO-02A, F1 and
 * PO-02D1A), but push cannot create their triggers and guard functions, adds the primary-owner foreign key before the
 * users key (42830, half-way, not atomic: H-2), and on a populated users table stops at a prompt offering to TRUNCATE
 * users (H-1). The reviewed SQL must run FIRST; afterwards push issues nothing for those objects. This tool tells the
 * states apart and names every reason it refuses.
 *
 * It never writes:
 *   - its session starts READ ONLY (`default_transaction_read_only=on`, verified before the first query), so any write
 *     would fail with 25006 — and none is attempted: only SELECTs and drizzle-kit's read-only catalog introspection;
 *   - drizzle-kit's push plan is computed with its `pushSchema` API and NEVER applied (`apply` is never called); its row
 *     counts are answered as 0 so it never opens an interactive prompt — this tool measures the real counts itself;
 *   - the existing `db:preflight` (read-only, AUD-08.1) is consulted for the journal / bookkeeping state.
 * Development only: production targets are refused by scripts/platform/local-db-guard.ts before a connection is
 * opened (decisions D-6 and D-7 are open). DATABASE_URL is never printed. `db:push` itself is NOT changed (owner gate:
 * docs/platform-owner/PO02D1A1_MIGRATION_HARDENING.md, section F).
 *
 * Exit: 0 PUSH_SAFE · 3 BLOCKED (at least one blocking finding; every one is listed) · 2 unsafe target refused · 1 tool
 * error (fail closed: an unreadable catalog, an uncomputable plan or any unexpected error is never a pass).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { assertDisposableLocalDatabaseUrl, assertDisposableLocalServer, describeTarget, UnsafeDatabaseTargetError } from "./local-db-guard";
import {
  checkCompanyFoundation,
  checkOnboardingFoundation,
  checkPlatformObjects,
  COMPANY_TABLES,
  ONBOARDING_FUNCTIONS,
  ONBOARDING_TABLES,
  PLATFORM_OWNED_TABLES,
  PLATFORM_TABLES,
  USERS_KEY,
} from "./catalog";

export type Severity = "blocking" | "info";
export type Finding = { code: string; severity: Severity; message: string };
export type Component = "complete" | "missing" | "partial" | "invalid";
export type PlanStatement = { sql: string; verdict: "benign" | "blocking"; reason: string };
export type PreflightState = "REVIEWED_SQL_COMPLETE" | "REVIEWED_SQL_NOT_APPLIED" | "PARTIAL_PUSH_CREATED" | "PARTIAL_OR_DRIFTED" | "UNSUPPORTED_TARGET";
export type PreflightResult = {
  verdict: "PUSH_SAFE" | "BLOCKED";
  state: PreflightState;
  intent: "push" | "migrate";
  components: { po01a: Component; po02a: Component; f1: Component; po02d1a: Component };
  counts: { orgs: number; users: number };
  plan: PlanStatement[];
  migrate: { exit: number | null; state: string };
  findings: Finding[];
};

const q = async <T = Record<string, unknown>>(c: Client, sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows as T[];

/** The reviewed objects push must never create, change or drop (they belong to the reviewed SQL). */
const REVIEWED_NAMES = [...PLATFORM_OWNED_TABLES, USERS_KEY.name, "sessions_org_active_idx", "platform_audit_events_entity_idx"];
const touchesReviewed = (sql: string) => REVIEWED_NAMES.some((n) => sql.includes(`"${n}"`));
/** PO-02A's 28 constraints are reviewed; these are its five foreign keys, exactly as PostgreSQL prints them. */
const PO02A_CONSTRAINT_COUNT = 28;
const PO02A_FKS: Record<string, string> = {
  organization_invitations_accepted_org_fk: "FOREIGN KEY (accepted_org_id) REFERENCES orgs(id) ON DELETE RESTRICT",
  organization_invitations_invited_by_fk: "FOREIGN KEY (invited_by_platform_admin_id) REFERENCES platform_admins(id) ON DELETE RESTRICT",
  organization_invitations_revoked_by_fk: "FOREIGN KEY (revoked_by_platform_admin_id) REFERENCES platform_admins(id) ON DELETE RESTRICT",
  tenant_access_controls_changed_by_fk: "FOREIGN KEY (changed_by_platform_admin_id) REFERENCES platform_admins(id) ON DELETE RESTRICT",
  tenant_access_controls_org_fk: "FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE RESTRICT",
};
/** The reviewed SQL's private scratch schemas: they exist only inside its transaction. */
const SCRATCH_SCHEMAS = ["po02a_reference", "po02d1_reference"];
const CREATE_TABLE = /^CREATE TABLE "([^"]+)"/;
const MISSING_FK = "the declared foreign key";
const DROP_CONSTRAINT = /^ALTER TABLE "([^"]+)" DROP CONSTRAINT "([^"]+)";?$/;

/** `ADD CONSTRAINT … FOREIGN KEY` text as drizzle-kit prints it → the definition PostgreSQL prints (for identity checks). */
function normalizeAddedFk(sql: string): { table: string; name: string; def: string } | null {
  const m = sql.match(/^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" (FOREIGN KEY .*?);?$/);
  if (!m) return null;
  const def = m[3]
    .replace(/"public"\./g, "")
    .replace(/"/g, "")
    .replace(/,/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/ ON DELETE no action/i, "")
    .replace(/ ON UPDATE no action/i, "")
    .replace(/ ON DELETE (cascade|restrict|set null|set default)/i, (_, a: string) => ` ON DELETE ${a.toUpperCase()}`)
    .replace(/ ON UPDATE (cascade|restrict|set null|set default)/i, (_, a: string) => ` ON UPDATE ${a.toUpperCase()}`)
    .trim();
  return { table: m[1], name: m[2].slice(0, 63), def };
}

async function loadSchemaModule(): Promise<Record<string, unknown>> {
  return (await import("../../src/db/schema")) as Record<string, unknown>;
}

/** drizzle-kit's push plan for the branch schema, computed read-only and never applied. */
export async function computePushPlan(c: Client): Promise<string[]> {
  const [{ pushSchema }, { PgDialect }, schema] = await Promise.all([import("drizzle-kit/api"), import("drizzle-orm/pg-core"), loadSchemaModule()]);
  const dialect = new PgDialect();
  // drizzle-kit introspects with parallel queries; one connection serves them one at a time.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = (text: string) => {
    const run = queue.then(() => c.query(text));
    queue = run.catch(() => undefined);
    return run;
  };
  const readOnlyDb = {
    execute: async (query: Parameters<InstanceType<typeof PgDialect>["sqlToQuery"]>[0]) => {
      const text = dialect.sqlToQuery(query).sql;
      // drizzle-kit's data-loss heuristics ask for row counts and then PROMPT (or plan a TRUNCATE); answer 0 so no
      // prompt can open and no TRUNCATE is planned — classifyPlan judges every statement with the REAL counts.
      if (/^\s*select count\(\*\) as count from /i.test(text)) return { rows: [{ count: 0 }] };
      return { rows: (await serial(text)).rows };
    },
  };
  // drizzle-kit draws a progress spinner on stdout; keep stdout for this tool's own report (--json stays parseable).
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    const plan = await pushSchema(schema, readOnlyDb as never);
    return plan.statementsToExecute.map((s: string) => s.trim());
  } finally {
    process.stdout.write = write;
  }
}

/** Classify every planned statement; anything not provably harmless blocks (fail closed). */
export async function classifyPlan(c: Client, statements: string[], rowCount: (table: string) => Promise<number>): Promise<PlanStatement[]> {
  const out: PlanStatement[] = [];
  const existingDef = async (table: string, name: string) =>
    (await q<{ def: string }>(c, `select pg_get_constraintdef(con.oid) as def from pg_constraint con where con.conrelid = to_regclass($1) and con.conname = $2`, [`public."${table}"`, name]))[0]?.def ?? null;
  for (let i = 0; i < statements.length; i++) {
    const sql = statements[i];
    const tableOf = (sql.match(/^(?:ALTER TABLE|CREATE TABLE|DROP TABLE)(?: IF EXISTS)? "([^"]+)"/i) ?? [])[1] ?? null;
    let verdict: PlanStatement["verdict"] = "blocking";
    let reason = "a pending schema change: review required before any push (fail closed)";
    if (/^truncate\b/i.test(sql)) reason = "a TRUNCATE";
    else if (/^DROP (TABLE|SCHEMA|VIEW|MATERIALIZED VIEW|TYPE|SEQUENCE|INDEX|POLICY|ROLE)\b/i.test(sql)) reason = "a DROP of an existing object";
    else if (/ DROP COLUMN /i.test(sql)) reason = "a DROP COLUMN";
    else if (/ SET DATA TYPE /i.test(sql)) reason = `a column type change${tableOf ? ` on ${tableOf} (${await rowCount(tableOf)} rows: drizzle-kit push would TRUNCATE a non-empty table)` : ""}`;
    else if (touchesReviewed(sql) && CREATE_TABLE.test(sql))
      reason = `push would CREATE ${tableOf}, a reviewed Platform Owner table, outside the reviewed SQL (push creates none of its triggers or guard functions and is not atomic) — run the reviewed SQL first (H-2)`;
    else if (/ ADD CONSTRAINT "[^"]+" (UNIQUE|PRIMARY KEY)/i.test(sql) && tableOf && (await rowCount(tableOf)) > 0)
      reason = `a new unique key on ${tableOf}, which holds ${await rowCount(tableOf)} rows: drizzle-kit push stops at a prompt offering to TRUNCATE ${tableOf} (H-1)`;
    else if (/ ADD COLUMN .* NOT NULL/i.test(sql) && !/ DEFAULT /i.test(sql) && tableOf && (await rowCount(tableOf)) > 0)
      reason = `a NOT NULL column without a default on ${tableOf} (${await rowCount(tableOf)} rows: drizzle-kit push offers to TRUNCATE it)`;
    else if (touchesReviewed(sql)) reason = "a change to a reviewed Platform Owner object (owned by the reviewed SQL, never by push)";
    else {
      const drop = sql.match(DROP_CONSTRAINT);
      if (drop) {
        const name = drop[2].slice(0, 63);
        const add = statements.slice(i + 1).map(normalizeAddedFk).find((a) => a && a.table === drop[1] && a.name === name);
        const current = await existingDef(drop[1], name);
        if (add && current && add.def === current) {
          verdict = "benign";
          reason = `drop + re-create of ${drop[1]}.${name} with the identical definition (drizzle-kit 0.31 compares the untruncated name)`;
        } else reason = `a DROP CONSTRAINT not re-created identically (current: ${current ?? "absent"}; re-added: ${add?.def ?? "none"})`;
      } else {
        const add = normalizeAddedFk(sql);
        if (add) {
          const current = await existingDef(add.table, add.name);
          const droppedFirst = statements.slice(0, i).some((s) => {
            const d = s.match(DROP_CONSTRAINT);
            return d !== null && d[1] === add.table && d[2].slice(0, 63) === add.name;
          });
          if (droppedFirst && current === add.def) {
            verdict = "benign";
            reason = `re-creation of ${add.table}.${add.name} with its identical definition`;
          } else if (droppedFirst) reason = `a destructive replacement: ${add.table}.${add.name} would be re-created with a DIFFERENT definition (current: ${current ?? "absent"}; new: ${add.def})`;
          else if (current === null)
            reason = `${MISSING_FK} ${add.table}.${add.name} (${add.def}) is missing from the database, so ${add.table} has no referential integrity for it — the signature of an interrupted push; restore it explicitly after checking for orphan rows`;
          else reason = `a foreign key change on ${add.table}.${add.name}: review required before any push (fail closed)`;
        }
      }
    }
    out.push({ sql, verdict, reason });
  }
  return out;
}

/** The drizzle-kit journal's last snapshot against the Drizzle schema source (table names; D-6). */
export async function journalSchemaComparison(root = process.cwd()): Promise<{ snapshot: string; journalTables: string[]; schemaTables: string[]; onlyInSchema: string[]; onlyInJournal: string[] }> {
  const journal = JSON.parse(readFileSync(join(root, "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
  const last = journal.entries[journal.entries.length - 1];
  const snapshot = `${String(last.idx).padStart(4, "0")}_snapshot.json`;
  const snap = JSON.parse(readFileSync(join(root, "drizzle", "meta", snapshot), "utf8")) as { tables: Record<string, unknown> };
  const { generateDrizzleJson } = await import("drizzle-kit/api");
  const cur = generateDrizzleJson(await loadSchemaModule()) as { tables: Record<string, unknown> };
  const journalTables = Object.keys(snap.tables).sort();
  const schemaTables = Object.keys(cur.tables).sort();
  return { snapshot, journalTables, schemaTables, onlyInSchema: schemaTables.filter((t) => !journalTables.includes(t)), onlyInJournal: journalTables.filter((t) => !schemaTables.includes(t)) };
}

/** The whole preflight on an open, read-only, guard-checked client. */
export async function runPreflightOn(c: Client, opts: { intent?: "push" | "migrate"; databaseUrl?: string } = {}): Promise<PreflightResult> {
  const intent = opts.intent ?? "push";
  const findings: Finding[] = [];
  const block = (code: string, message: string) => findings.push({ code, severity: "blocking", message });
  const note = (code: string, message: string) => findings.push({ code, severity: "info", message });
  const none: PreflightResult["components"] = { po01a: "missing", po02a: "missing", f1: "missing", po02d1a: "missing" };

  // T — target identity (the guard already refused anything but a loopback *_test_only_* database).
  const ro = (await q<{ v: string }>(c, `select current_setting('default_transaction_read_only') as v`))[0].v;
  if (ro !== "on") throw new Error("the preflight session is not read-only; refusing to continue");
  const server = (await q<{ version: string; encoding: string; standby: boolean; schema: string }>(
    c,
    `select current_setting('server_version_num') as version, current_setting('server_encoding') as encoding, pg_is_in_recovery() as standby, current_schema() as schema`,
  ))[0];
  if (Number(server.version) < 140000) block("T-01", `PostgreSQL ${server.version} is unsupported (14 or newer required)`);
  if (server.standby) block("T-04", "the target is a standby in recovery: push would fail part-way on a read-only server");
  if (server.schema !== "public") block("T-05", `the session's current schema is ${server.schema}, not public (search_path differs from the application's)`);
  if (server.encoding !== "UTF8") block("T-06", `server encoding ${server.encoding}: Elite ERP stores Arabic text and requires UTF8`);
  const identity = await q<{ t: string; c: string }>(
    c,
    `select cl.relname as t, a.attname as c from pg_attribute a
     join pg_class cl on cl.oid = a.attrelid join pg_namespace n on n.oid = cl.relnamespace
     where n.nspname = 'public' and cl.relkind = 'r' and not a.attisdropped
       and (cl.relname, a.attname) in (('orgs','id'),('users','id'),('users','org_id'),('users','email'),('sessions','org_id'))`,
  );
  if (identity.length !== 5) {
    block("T-02", `not an Elite ERP database (orgs.id, users.id, users.org_id, users.email, sessions.org_id: found ${identity.length} of 5) — unsupported target`);
    return { verdict: "BLOCKED", state: "UNSUPPORTED_TARGET", intent, components: none, counts: { orgs: 0, users: 0 }, plan: [], migrate: { exit: null, state: "not run" }, findings };
  }
  const leftovers = (await q<{ s: string }>(c, `select nspname as s from pg_namespace where nspname = any($1) order by 1`, [SCRATCH_SCHEMAS])).map((r) => r.s);
  if (leftovers.length) block("T-03", `a reviewed-SQL scratch schema exists outside its transaction (${leftovers.join(", ")}): a run was interrupted outside the reviewed runner`);

  // C — customer records (what makes H-1 possible).
  const counts = (await q<{ orgs: number; users: number }>(c, `select (select count(*) from orgs)::int as orgs, (select count(*) from users)::int as users`))[0];
  note("C-01", `customer records present: ${counts.orgs} organizations, ${counts.users} users`);
  const rowCache = new Map<string, number>();
  const rowCount = async (t: string) => {
    if (!rowCache.has(t)) {
      const exists = (await q<{ x: boolean }>(c, `select to_regclass($1) is not null as x`, [`public."${t}"`]))[0].x;
      rowCache.set(t, exists ? Number((await q<{ n: number }>(c, `select count(*)::int as n from public."${t.replace(/"/g, "")}"`))[0].n) : 0);
    }
    return rowCache.get(t) as number;
  };

  // P1 / P2 / F1 / D1 — the reviewed objects, judged by catalog semantics.
  const present = async (names: readonly string[]) =>
    (await q<{ t: string }>(c, `select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname = any($1)`, [names])).map((r) => r.t);
  const p1Present = await present(PLATFORM_TABLES);
  const p1 = await checkPlatformObjects(c);
  const rejectFn = Number((await q<{ n: number }>(c, `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'platform_reject_mutation'`))[0].n);
  const po01a: Component = p1Present.length === 0 ? "missing" : p1.ok ? "complete" : p1Present.length === PLATFORM_TABLES.length ? "invalid" : "partial";
  if (po01a !== "complete") block("P1-01", `PO-01A ${po01a}: ${p1.findings.join("; ") || "no platform table"}`);

  const p2Present = await present(COMPANY_TABLES);
  const p2 = await checkCompanyFoundation(c);
  const cons = await q<{ name: string; def: string; validated: boolean; deferrable: boolean }>(
    c,
    `select con.conname as name, pg_get_constraintdef(con.oid) as def, con.convalidated as validated, con.condeferrable as deferrable
     from pg_constraint con join pg_class cl on cl.oid = con.conrelid join pg_namespace n on n.oid = cl.relnamespace
     where n.nspname = 'public' and cl.relname = any($1) and con.contype <> 'n'`,
    [COMPANY_TABLES],
  );
  const p2Shape: string[] = [];
  if (p2Present.length === COMPANY_TABLES.length) {
    if (cons.length !== PO02A_CONSTRAINT_COUNT) p2Shape.push(`${cons.length} constraints on the company tables, ${PO02A_CONSTRAINT_COUNT} reviewed`);
    for (const x of cons.filter((k) => !k.validated || k.deferrable)) p2Shape.push(`constraint ${x.name} is ${x.validated ? "DEFERRABLE" : "NOT VALID"}`);
    for (const [name, def] of Object.entries(PO02A_FKS)) {
      const got = cons.find((k) => k.name === name);
      if (!got || got.def !== def) p2Shape.push(`foreign key ${name} ${got ? `differs: ${got.def}` : "missing"}`);
    }
  }
  const po02a: Component =
    p2Present.length === 0 && p2.findings.length === COMPANY_TABLES.length + 2
      ? "missing"
      : p2.ok && p2Shape.length === 0
        ? "complete"
        : p2Present.length === COMPANY_TABLES.length
          ? "invalid"
          : "partial";
  if (po02a !== "complete") block("P2-01", `PO-02A ${po02a}: ${[...p2.findings, ...p2Shape].join("; ")}`);

  const key = (
    await q<{ def: string; ok: boolean; deferrable: boolean; validated: boolean; idx: string | null }>(
      c,
      `select pg_get_constraintdef(con.oid) as def, coalesce(ix.indisvalid and ix.indisready, false) as ok, con.condeferrable as deferrable, con.convalidated as validated, pg_get_indexdef(con.conindid) as idx
       from pg_constraint con left join pg_index ix on ix.indexrelid = con.conindid
       where con.conrelid = to_regclass('public.users') and con.conname = $1`,
      [USERS_KEY.name],
    )
  )[0];
  const bareIndex = (await q<{ ok: boolean }>(c, `select ix.indisvalid and ix.indisready as ok from pg_index ix where ix.indexrelid = to_regclass($1)`, [`public.${USERS_KEY.name}`]))[0];
  const f1: Component = key
    ? key.def === USERS_KEY.def && key.ok && !key.deferrable && key.validated && key.idx === USERS_KEY.indexDef
      ? "complete"
      : "invalid"
    : bareIndex
      ? "partial"
      : "missing";
  if (f1 === "missing") block("F1-01", `F1 ${USERS_KEY.name} is missing on users`);
  else if (f1 === "partial") block("F1-02", `F1 exists only as a bare ${bareIndex.ok ? "valid" : "INVALID"} index (the runbook's attach step has not run)`);
  else if (f1 === "invalid") block("F1-03", `F1 differs: ${key.def}${key.ok ? "" : " (index INVALID)"}`);

  const d1Present = await present(ONBOARDING_TABLES);
  const d1 = await checkOnboardingFoundation(c);
  const triggers = Number(
    (await q<{ n: number }>(c, `select count(*)::int as n from pg_trigger tg join pg_class cl on cl.oid = tg.tgrelid join pg_namespace n on n.oid = cl.relnamespace where n.nspname = 'public' and not tg.tgisinternal and cl.relname = any($1)`, [ONBOARDING_TABLES]))[0].n,
  );
  const fns = Number((await q<{ n: number }>(c, `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1)`, [ONBOARDING_FUNCTIONS]))[0].n);
  const po02d1a: Component =
    d1Present.length === 0 && fns === 0 && triggers === 0
      ? "missing"
      : d1.ok
        ? "complete"
        : d1Present.length === ONBOARDING_TABLES.length && fns === ONBOARDING_FUNCTIONS.length
          ? "invalid"
          : "partial";
  const isTrigger = (f: string) => /^(missing trigger|unexpected trigger|trigger )/.test(f);
  if (po02d1a === "missing") block("D1-00", "PO-02D1A is not installed (no onboarding table, function or trigger)");
  else if (po02d1a !== "complete") {
    block("D1-01", `PO-02D1A ${po02d1a}: ${d1Present.length}/${ONBOARDING_TABLES.length} tables, ${fns}/${ONBOARDING_FUNCTIONS.length} functions, ${triggers}/10 triggers`);
    const trig = d1.findings.filter(isTrigger);
    if (trig.length) block("D1-02", `triggers missing, disabled or different: ${trig.join("; ")}`);
    const other = d1.findings.filter((f) => !isTrigger(f));
    if (other.length) block("D1-03", other.join("; "));
  }

  // O — migration ordering signatures.
  if (po02a !== "missing" && po01a === "missing") block("O-01", "PO-02A objects exist without PO-01A (invalid order)");
  if (po02d1a !== "missing" && po02a !== "complete") block("O-02", "PO-02D1A objects exist without a complete PO-02A (invalid order)");
  const d1PushCreated = d1Present.length > 0 && triggers === 0 && fns === 0;
  const p1PushCreated = p1Present.length > 0 && rejectFn === 0;
  if (d1PushCreated) block("O-03", "onboarding tables exist without any trigger or guard function: drizzle-kit push ran before the reviewed SQL (H-2 signature)");
  if (d1Present.length > 0 && f1 !== "complete") block("O-04", "onboarding tables exist without the users key: the composite primary-owner foreign key cannot exist (H-2 signature)");
  if (p1PushCreated) block("O-05", "platform tables exist without platform_reject_mutation(): drizzle-kit push created them before the reviewed PO-01A SQL (H-2 signature)");

  // J — the drizzle-kit journal against the schema and the bookkeeping (decision D-6; only `migrate` reads the journal).
  const journal = await journalSchemaComparison();
  if (journal.onlyInSchema.length || journal.onlyInJournal.length)
    (intent === "migrate" ? block : note)(
      "J-02",
      `the drizzle-kit journal (last snapshot ${journal.snapshot}: ${journal.journalTables.length} tables) does not describe the Drizzle schema (${journal.schemaTables.length} tables; ${journal.onlyInSchema.length} only in the schema, ${journal.onlyInJournal.length} only in the journal): \`drizzle-kit migrate\` cannot build this schema (D-6)`,
    );
  let migrate = { exit: null as number | null, state: "not run" };
  if (opts.databaseUrl) {
    const r = spawnSync("npm", ["run", "-s", "db:preflight"], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: opts.databaseUrl }, encoding: "utf8", timeout: 300_000 });
    const stateLine = `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n").find((l) => l.startsWith("STATE:")) ?? "STATE: unknown";
    migrate = { exit: r.status, state: stateLine.replace(/^STATE:\s*/, "") };
    // db:preflight exits 0 OK, 10 BASELINE_RECONCILIATION_REQUIRED, 20 INCONSISTENT; anything else (1 tool error,
    // 30 reference stale, no exit status) means it could not judge — and then nothing it would have said is known.
    if (r.status === 10 || r.status === 20) (intent === "migrate" ? block : note)("J-01", `drizzle-kit migrate is refused by db:preflight (${migrate.state}, exit ${r.status}): the journal and bookkeeping do not describe this database (D-6)`);
    else if (r.status === 0) {
      if (intent === "push") block("J-03", "db:preflight reports this database as migration-managed (OK): a push would apply changes outside the journal and mix the two mechanisms (D-6 is open)");
    } else block("J-00", `the journal gate (db:preflight) could not judge this database (exit ${r.status ?? "none"}${r.error ? `, ${r.error.message}` : ""}) — fail closed`);
  } else block("J-00", "the journal gate could not be consulted (no database URL)");

  // X — drizzle-kit's push plan, computed read-only, classified with the real row counts.
  let plan: PlanStatement[] = [];
  try {
    plan = await classifyPlan(c, await computePushPlan(c), rowCount);
  } catch (e) {
    block("X-99", `drizzle-kit's push plan could not be computed (${e instanceof Error ? e.message.split("\n")[0].slice(0, 200) : String(e)})`);
  }
  for (const s of plan.filter((p) => p.verdict === "blocking")) block("X-01", `push would run: ${s.sql.split("\n")[0].slice(0, 160)} — ${s.reason}`);
  const benign = plan.filter((p) => p.verdict === "benign").length;
  if (benign)
    note(
      "X-02",
      `push would re-create ${benign / 2} existing customer foreign key(s) with identical definitions (drizzle-kit 0.31 compares untruncated names; the live db:push does this today): no data change, but push is not transactional — each key is dropped first and re-added at the end (a validating scan under SHARE ROW EXCLUSIVE), so a push that fails in between leaves it dropped; run push in a maintenance window and re-run this preflight afterwards`,
    );
  const missingFks = plan.filter((p) => p.reason.startsWith(MISSING_FK) && !touchesReviewed(p.sql));
  if (missingFks.length)
    block("O-06", `${missingFks.length} declared customer foreign key(s) are missing from the database (${missingFks.map((p) => normalizeAddedFk(p.sql)?.name).join(", ")}): the signature of an interrupted push (it drops them before it fails); restore them explicitly, after checking for orphan rows`);
  for (const p of plan.filter((s) => / ADD CONSTRAINT "[^"]+" (UNIQUE|PRIMARY KEY)/.test(s.sql))) {
    const table = (p.sql.match(/^ALTER TABLE "([^"]+)"/) ?? [])[1] ?? "";
    const n = table ? await rowCount(table) : 0;
    if (n > 0) block("H-1", `${table} holds ${n} rows and push would add a unique key to it: drizzle-kit push stops at a prompt offering to TRUNCATE ${table} (cascade) — never accept it; apply the reviewed SQL first`);
  }
  if (plan.some((p) => (PLATFORM_OWNED_TABLES as readonly string[]).includes((p.sql.match(CREATE_TABLE) ?? [])[1] ?? "")))
    block("H-2", "drizzle-kit push would create reviewed Platform Owner tables outside the reviewed SQL — no trigger or guard function, and it fails half-way at the composite foreign key (not atomic) — apply the reviewed SQL first");

  // State: the reviewed SQL installs PO-01A → PO-02A → F1 → PO-02D1A; every not-yet-applied state is a prefix of that
  // order (complete…complete, missing…missing). Anything else is a partial or drifted state.
  const seq = [po01a, po02a, f1, po02d1a];
  const firstMissing = seq.indexOf("missing");
  const isPrefix = firstMissing !== -1 && seq.every((s, i) => (i < firstMissing ? s === "complete" : s === "missing"));
  const state: PreflightState = seq.every((s) => s === "complete")
    ? "REVIEWED_SQL_COMPLETE"
    : d1PushCreated || p1PushCreated
      ? "PARTIAL_PUSH_CREATED"
      : isPrefix
        ? "REVIEWED_SQL_NOT_APPLIED"
        : "PARTIAL_OR_DRIFTED";
  const blocking = findings.filter((f) => f.severity === "blocking");
  return { verdict: blocking.length ? "BLOCKED" : "PUSH_SAFE", state, intent, components: { po01a, po02a, f1, po02d1a }, counts, plan, migrate, findings };
}

/** Guard, open a READ-ONLY connection, run, close. */
export async function runPreflight(databaseUrl: string | undefined, opts: { intent?: "push" | "migrate" } = {}): Promise<PreflightResult> {
  const target = assertDisposableLocalDatabaseUrl(databaseUrl);
  const client = new Client({ connectionString: databaseUrl, options: "-c default_transaction_read_only=on -c lock_timeout=2s -c statement_timeout=60s", application_name: "platform-release-preflight" });
  await client.connect();
  try {
    await assertDisposableLocalServer(client, target);
    return await runPreflightOn(client, { ...opts, databaseUrl });
  } finally {
    await client.end();
  }
}

export const RECOVERY: Record<PreflightState, string> = {
  REVIEWED_SQL_COMPLETE: "every reviewed Platform Owner object is present and valid",
  REVIEWED_SQL_NOT_APPLIED:
    "run the reviewed SQL first, in order (platform:db:apply; on a large users table F1 through PO02D1_users_org_id_id_concurrently.sql, and M4 through PO02A_m4_sessions_index_concurrently.sql), then this preflight again",
  PARTIAL_PUSH_CREATED:
    "push ran before the reviewed SQL: (1) if the half-built onboarding tables are empty, PO02D1_rollback.sql (step 1) removes them; (2) restore every customer foreign key O-06 names with its exact declared definition (after checking for orphan rows); (3) the reviewed SQL; (4) this preflight again — never let push 'finish' the job",
  PARTIAL_OR_DRIFTED: "investigate every finding; never let push repair a reviewed object; any change needs an owner-approved plan",
  UNSUPPORTED_TARGET: "not an Elite ERP database this tool can judge",
};

async function main() {
  const json = process.argv.includes("--json");
  const intent = process.argv.includes("--intent=migrate") ? "migrate" : "push";
  try {
    const target = assertDisposableLocalDatabaseUrl(process.env.DATABASE_URL);
    if (!json) console.log(`platform:db:preflight → ${describeTarget(target)} (read-only; intent ${intent})`);
    const r = await runPreflight(process.env.DATABASE_URL, { intent });
    if (json) console.log(JSON.stringify(r));
    else {
      console.log(`  STATE: ${r.state} — ${RECOVERY[r.state]}`);
      console.log(`  components: PO-01A ${r.components.po01a} · PO-02A ${r.components.po02a} · F1 ${r.components.f1} · PO-02D1A ${r.components.po02d1a}; customer rows: ${r.counts.orgs} orgs, ${r.counts.users} users`);
      console.log(`  push plan: ${r.plan.length} statement(s), ${r.plan.filter((p) => p.verdict === "benign").length} benign, ${r.plan.filter((p) => p.verdict === "blocking").length} blocking`);
      for (const f of r.findings) console.log(`  ${f.severity === "blocking" ? "BLOCK" : "info "} ${f.code} ${f.message}`);
      console.log(`  drizzle-kit migrate: ${r.migrate.exit === 0 ? "permitted by db:preflight" : `REFUSED by db:preflight (${r.migrate.state})`}`);
      console.log(`VERDICT: ${r.verdict}`);
    }
    process.exitCode = r.verdict === "PUSH_SAFE" ? 0 : 3;
  } catch (err) {
    if (err instanceof UnsafeDatabaseTargetError) {
      console.error(`REFUSED [${err.reasonCode}] ${err.message}`);
      process.exitCode = 2;
      return;
    }
    console.error(`platform:db:preflight failed (fail closed): ${err instanceof Error ? err.message.replace(/postgres(ql)?:\/\/\S+/g, "<redacted-url>") : String(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && /release-preflight\.ts$/.test(process.argv[1])) void main();
