/**
 * Platform Owner PO-01A / PO-02A — apply the reviewed platform SQL, in order:
 * drizzle/platform/PO01_platform_identity.sql, then PO02A_company_foundation.sql.
 *
 *   DATABASE_URL=postgres://…@127.0.0.1:<port>/<name containing _test_only_> npm run platform:db:apply
 *
 * PO-01A authorizes ONLY loopback-hosted, disposable `*_test_only_*` databases; every other target
 * is refused before a connection is opened (scripts/platform/local-db-guard.ts) or immediately
 * after (server-side loopback checks). Production application is a separate owner decision (D-6).
 * Both files are retry-safe (PO02A refuses any pre-existing object whose shape differs, and runs
 * as one transaction); after applying, the platform objects, the decoy-resistant audit protection
 * and the PO-02A company objects are verified and the exit code reflects the result.
 *
 * Exit: 0 applied + verified · 1 verification failed / error · 2 unsafe target refused.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { assertDisposableLocalDatabaseUrl, assertDisposableLocalServer, describeTarget, UnsafeDatabaseTargetError } from "./local-db-guard";
import { PLATFORM_SQL_FILES, PO02A_SQL_PATH, checkCompanyFoundation, checkPlatformObjects } from "./catalog";

/**
 * Apply `files` (default: every reviewed platform migration, in order) to a disposable database.
 * A failing file's transaction is rolled back and the error rethrown; nothing after it runs.
 */
export async function applyPlatformSql(
  databaseUrl: string | undefined,
  files: readonly string[] = PLATFORM_SQL_FILES,
): Promise<{ ok: boolean; findings: string[] }> {
  const target = assertDisposableLocalDatabaseUrl(databaseUrl);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await assertDisposableLocalServer(client, target);
    for (const file of files) {
      try {
        await client.query(readFileSync(file, "utf8"));
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      }
    }
    const report = await checkPlatformObjects(client);
    const findings = [...report.findings];
    if (files.includes(PO02A_SQL_PATH)) findings.push(...(await checkCompanyFoundation(client)).findings);
    return { ok: findings.length === 0, findings };
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
    console.log("  applied PO01_platform_identity.sql + PO02A_company_foundation.sql; 4 platform tables present; audit trail append-only (UPDATE/DELETE/TRUNCATE rejected); company tables and PO-02A indexes present and valid");
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
