/**
 * Cleanup for the real-provider harness.
 *
 *   npm run verify:blob-provider:cleanup -- --run-id <id>
 *
 * A SEPARATE COMMAND on purpose. If cleanup ran automatically at the end of the verification, a
 * failure partway through would destroy the objects the failure needs to be diagnosed from — and a
 * crash before the report was written would take the evidence with it. Evidence first, always.
 *
 * DELETION IS MANIFEST-DRIVEN. Only a pathname this run RECORDED AS CREATED is deleted. There is no
 * prefix sweep anywhere in this file, because a prefix sweep is correct on a disposable store and
 * catastrophic on any other, and a safety design has to hold when an assumption turns out to be
 * wrong. An object that is in the store but not in the manifest is left alone and reported.
 *
 * It does NOT delete Blob stores or databases. Destroying the disposable resources themselves stays
 * an operator action, after the objects and rows are gone.
 */
import { Client } from "pg";
import { armOrRefuse, reportArmingFailure } from "./provider-harness/guards.mjs";
import { installRedactedCrashHandler, say } from "./provider-harness/redact.mjs";
import { loadManifest, saveManifestFor } from "./provider-harness/manifest.mjs";
import { cleanupManifestObjects, cleanupTestOrgs } from "./provider-harness/cleanup.mjs";

installRedactedCrashHandler();

const i = process.argv.indexOf("--run-id");
const runId = i >= 0 ? process.argv[i + 1] : undefined;
if (!runId) { console.error("usage: npm run verify:blob-provider:cleanup -- --run-id <id>"); process.exit(1); }

// The same guards as the verification run: cleanup deletes things, so it must be just as certain
// which resources it is pointed at.
try { armOrRefuse(); } catch (e) { reportArmingFailure(e); }

const manifest = loadManifest(runId!);
say(`cleaning up run ${runId}: ${manifest.objects.length} planned objects (${manifest.objects.filter((o) => o.state === "created").length} confirmed created), ${manifest.testOrgs.length} test organizations`);
say("only objects this run is PROVEN to own are deleted — never a prefix scan, and never a merely-planned\npathname whose bytes have not been matched\n");

const { destinationStore, sourceStore } = await import("../src/lib/storage/blob-client");
const dest = destinationStore();
const src = sourceStore();

const result = await cleanupManifestObjects(manifest, { destination: dest, source: src }, saveManifestFor);
for (const line of result.log) say(`  ${line}`);
const { deleted, alreadyGone, failed } = result;

// Test organizations, in the disposable database the guards already identified. Rooted at the org
// because the schema cascades (measured: 52 of 53 FKs to orgs are ON DELETE CASCADE, the exception
// being audit_logs.org_id which is SET NULL by design), and VERIFIED across every fixture table
// afterwards rather than trusted.
let dbFailed = 0;
if (manifest.testOrgs.length) {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const dbRes = await cleanupTestOrgs(manifest, db, saveManifestFor);
  for (const line of dbRes.log) say(`  ${line}`);
  dbFailed = dbRes.failed;
  await db.end();
}

say(`\nblob: ${deleted} deleted, ${alreadyGone} already gone, ${result.skippedNotOwned} skipped (not ours), ${result.inconclusive} inconclusive, ${failed} failed`);
say(`database: ${dbFailed} failed`);
say("Blob stores and the database itself were NOT deleted — that remains an operator action.");
// EITHER kind of failure fails the command. A database cleanup failure that still exited 0 would
// leave disposable rows behind while reporting success.
process.exit(failed + dbFailed + result.inconclusive > 0 ? 1 : 0);
