/**
 * Platform Owner PO-01A — apply drizzle/platform/PO01_platform_identity.sql.
 *
 *   DATABASE_URL=postgres://…@127.0.0.1:<port>/<name containing _test_only_> npm run platform:db:apply
 *
 * PO-01A authorizes ONLY loopback-hosted, disposable `*_test_only_*` databases; every other target
 * is refused before a connection is opened (scripts/platform/local-db-guard.ts) or immediately
 * after (server-side loopback checks). Production application is a separate owner decision (D-6).
 * The SQL is idempotent; after applying, the platform objects and the decoy-resistant audit
 * protection are verified and the exit code reflects the result.
 *
 * Exit: 0 applied + verified · 1 verification failed / error · 2 unsafe target refused.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { assertDisposableLocalDatabaseUrl, assertDisposableLocalServer, describeTarget, UnsafeDatabaseTargetError } from "./local-db-guard";
import { PLATFORM_SQL_PATH, checkPlatformObjects } from "./catalog";

export async function applyPlatformSql(databaseUrl: string | undefined): Promise<{ ok: boolean; findings: string[] }> {
  const target = assertDisposableLocalDatabaseUrl(databaseUrl);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await assertDisposableLocalServer(client, target);
    await client.query(readFileSync(PLATFORM_SQL_PATH, "utf8"));
    const report = await checkPlatformObjects(client);
    return { ok: report.ok, findings: report.findings };
  } finally {
    await client.end();
  }
}

async function main() {
  try {
    const target = assertDisposableLocalDatabaseUrl(process.env.DATABASE_URL);
    console.log(`platform:db:apply → ${describeTarget(target)}`);
    const result = await applyPlatformSql(process.env.DATABASE_URL);
    if (!result.ok) {
      for (const f of result.findings) console.error(`  FAIL ${f}`);
      process.exitCode = 1;
      return;
    }
    console.log("  applied PO01_platform_identity.sql; 4 platform tables present; audit trail append-only (UPDATE/DELETE/TRUNCATE rejected)");
  } catch (err) {
    if (err instanceof UnsafeDatabaseTargetError) {
      console.error(`REFUSED [${err.reasonCode}] ${err.message}`);
      process.exitCode = 2;
      return;
    }
    console.error(`platform:db:apply failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && /apply-platform-sql\.ts$/.test(process.argv[1])) void main();
