/**
 * Platform Owner PO-01A — READ-ONLY check that the platform tables exist and that the audit trail
 * is append-only, judged by catalog semantics (table binding, timing, events, enabled state and
 * function body), never by trigger name alone.
 *
 *   DATABASE_URL=postgres://…@127.0.0.1:<port>/<name containing _test_only_> npm run platform:db:check
 *
 * Restricted to loopback `*_test_only_*` databases in PO-01A (it is read-only, but production
 * access of any kind is not authorized in this phase).
 *
 * Exit: 0 ok · 1 missing objects/protection or error · 2 unsafe target refused.
 */
import { Client } from "pg";
import { assertDisposableLocalDatabaseUrl, assertDisposableLocalServer, describeTarget, UnsafeDatabaseTargetError } from "./local-db-guard";
import { checkCompanyFoundation, checkPlatformObjects } from "./catalog";

async function main() {
  try {
    const target = assertDisposableLocalDatabaseUrl(process.env.DATABASE_URL);
    console.log(`platform:db:check → ${describeTarget(target)}`);
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await assertDisposableLocalServer(client, target);
      await client.query("set default_transaction_read_only = on");
      const report = await checkPlatformObjects(client);
      const company = await checkCompanyFoundation(client);
      console.log(`  tables: ${report.tablesPresent.join(", ") || "(none)"}`);
      if (!report.ok || !company.ok) {
        for (const f of [...report.findings, ...company.findings]) console.error(`  FAIL ${f}`);
        process.exitCode = 1;
        return;
      }
      console.log("  OK: 4 platform tables present; audit trail append-only by catalog semantics; PO-02A company tables and indexes present and valid");
    } finally {
      await client.end();
    }
  } catch (err) {
    if (err instanceof UnsafeDatabaseTargetError) {
      console.error(`REFUSED [${err.reasonCode}] ${err.message}`);
      process.exitCode = 2;
      return;
    }
    console.error(`platform:db:check failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

void main();
