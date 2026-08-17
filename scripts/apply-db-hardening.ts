/**
 * Install the database-level protections that `drizzle-kit push` does not: the append-only triggers
 * on `audit_logs` and `security_events`.
 *
 * Run:      npm run db:harden            (chained automatically by `npm run db:push`)
 * Verify:   npm run db:harden -- --check (asserts only; installs nothing, exits 1 if missing)
 *
 * ## Why this file exists
 *
 * `drizzle/immutable_audit.sql` was written, committed, reviewed, and covered by a test that reads
 * the FILE — and it was never installed. Not in development, and (checked) not in production. A
 * control whose installation depends on someone remembering a checklist line is not a control.
 *
 * This is deliberately Node + `pg` rather than a `psql` invocation: `psql` is not installed on every
 * machine or CI image that can run this app, and a hardening step that silently no-ops where the
 * client binary is missing would reproduce the original failure in a new costume. Anything that can
 * run the app can run this.
 *
 * Idempotent: `CREATE OR REPLACE FUNCTION`, and each trigger is dropped before it is created. Safe
 * against a populated database — the triggers only reject UPDATE/DELETE on two append-only tables,
 * and nothing in `src/` or `scripts/` issues either against them.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

const CHECK_ONLY = process.argv.includes("--check");
const TRIGGERS = ["audit_logs_immutable", "security_events_immutable"];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function installed(): Promise<string[]> {
  const { rows } = await pool.query<{ tgname: string }>(
    `select tgname from pg_trigger where tgname = any($1::text[])`,
    [TRIGGERS],
  );
  return rows.map((r) => r.tgname);
}

async function main() {
  const before = await installed();

  if (CHECK_ONLY) {
    const missing = TRIGGERS.filter((t) => !before.includes(t));
    if (missing.length === 0) {
      console.log(`DB hardening: both append-only triggers present (${TRIGGERS.join(", ")}).`);
      return;
    }
    console.error(`DB hardening MISSING: ${missing.join(", ")}`);
    console.error("Run `npm run db:harden` (or paste drizzle/immutable_audit.sql into the SQL console).");
    process.exitCode = 1;
    return;
  }

  const sql = readFileSync(join(process.cwd(), "drizzle", "immutable_audit.sql"), "utf8");
  await pool.query(sql);

  const after = await installed();
  const missing = TRIGGERS.filter((t) => !after.includes(t));
  if (missing.length > 0) {
    console.error(`DB hardening FAILED — still missing: ${missing.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    before.length === TRIGGERS.length
      ? `DB hardening: already present, re-applied cleanly (${after.join(", ")}).`
      : `DB hardening: installed ${after.join(", ")}.`,
  );
}

main()
  .then(() => pool.end())
  .catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
