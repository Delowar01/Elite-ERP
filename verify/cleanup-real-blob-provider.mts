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
import { installRedactedCrashHandler, redact, say } from "./provider-harness/redact.mjs";
import { loadManifest, saveManifestFor } from "./provider-harness/manifest.mjs";
import { cleanupManifestObjects } from "./provider-harness/cleanup.mjs";

installRedactedCrashHandler();

const i = process.argv.indexOf("--run-id");
const runId = i >= 0 ? process.argv[i + 1] : undefined;
if (!runId) { console.error("usage: npm run verify:blob-provider:cleanup -- --run-id <id>"); process.exit(1); }

// The same guards as the verification run: cleanup deletes things, so it must be just as certain
// which resources it is pointed at.
try { armOrRefuse(); } catch (e) { reportArmingFailure(e); }

const manifest = loadManifest(runId!);
say(`cleaning up run ${runId}: ${manifest.objects.length} objects, ${manifest.dbRows.length} database rows`);
say("only pathnames recorded in this manifest are deleted — never a prefix scan\n");

const { destinationStore, sourceStore } = await import("../src/lib/storage/blob-client");
const dest = destinationStore();
const src = sourceStore();

const result = await cleanupManifestObjects(manifest, { destination: dest, source: src }, saveManifestFor);
for (const line of result.log) say(`  ${line}`);
const { deleted, alreadyGone, failed } = result;

// Database rows, in the disposable database only — the guards already proved which one that is.
if (manifest.dbRows.length) {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  for (const row of manifest.dbRows) {
    try {
      const [col, val] = row.identifier.split("=");
      if (row.table === "users" && col === "email") await db.query("delete from users where email=$1", [val]);
      else if (row.table === "orgs" && col === "id") await db.query("delete from orgs where id=$1", [Number(val)]);
      else { row.cleanupStatus = "failed"; continue; }
      row.cleanupStatus = "deleted";
      say(`  deleted row: ${row.table} ${row.identifier}`);
    } catch (e) {
      row.cleanupStatus = "failed";
      say(`  FAILED row: ${row.table} ${row.identifier} — ${redact(e)}`);
    }
  }
  saveManifestFor(manifest);
  await db.end();
}

say(`\n${deleted} deleted, ${alreadyGone} already gone, ${failed} failed`);
say("Blob stores and the database itself were NOT deleted — that remains an operator action.");
process.exit(failed ? 1 : 0);
