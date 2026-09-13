/**
 * Re-store existing PUBLIC Blob objects as PRIVATE, without changing any pathname or any DB row.
 *
 *   npm run blob:migrate                                  # dry run (the default)
 *   npm run blob:migrate -- --execute [--folder f] [--limit n] [--state f.log]
 *
 * DRY RUN IS THE DEFAULT AND --execute IS THE ONLY WAY PAST IT. A dry run writes nothing at all,
 * not even the state file.
 *
 * MECHANISM, and why this one. Vercel Blob has no in-place permission change, so an object's access
 * can only be set when it is written. `copy(from, to, { access })` exists, but every safe use of it
 * needs a second pathname and therefore either a same-path copy whose behaviour is not documented,
 * or a delete-and-restore window in which the original does not exist. This uses only operations
 * whose semantics are certain:
 *
 *     get(pathname, { access: "public" })   ->  bytes
 *     put(pathname, bytes, { access: "private", addRandomSuffix: false })
 *
 * `put` at an existing pathname with addRandomSuffix disabled overwrites that object, so the
 * pathname never changes, no DB row moves, and nothing is deleted at any point — the object is only
 * ever rewritten in place. That is the property that keeps this reversible-by-re-running and keeps
 * the application's stored `/uploads/...` paths stable.
 *
 * IF PATHNAMES EVER HAVE TO CHANGE, STOP. That would mean rewriting DB rows in the same operation
 * as rewriting storage, which is a materially larger risk than this, and it is out of scope here.
 *
 * IDEMPOTENT: an object that already refuses an anonymous read is skipped, so a rerun is a no-op
 * over work already done. RESUMABLE: every completed pathname is appended to the state file and
 * skipped on the next run. FAILURES ARE RECORDED, never swallowed, and never silently skipped — the
 * run ends non-zero if any object failed.
 *
 * ATTACHMENT ORPHANS ARE MIGRATED LIKE ANYTHING ELSE AND NEVER DELETED. Objects under
 * organizations/{orgId}/attachments/ with no DB reference may be lost attachments from the
 * pre-d3694a6 persistence defect; making them private is exactly what should happen to them.
 * Nothing in this script removes an object under any circumstances.
 */
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { blobClient } from "../src/lib/storage/blob-client";


const has = (n: string) => process.argv.includes(`--${n}`);
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };

const execute = has("execute");
const onlyFolder = arg("folder");
const limit = arg("limit") ? Number(arg("limit")) : Infinity;
const statePath = arg("state") ?? "blob-migration-state.log";

async function main() {
  // Without a token this script cannot tell which objects are still public, so it cannot even
  // PLAN — a dry run would report an empty, falsely reassuring list. Fail loudly and specifically
  // rather than letting a stack trace stand in for the explanation.
  const client = blobClient();
  if (!process.env.BLOB_READ_WRITE_TOKEN && process.env.STORAGE_DRIVER !== "fake") {
    console.error(
      "BLOB_READ_WRITE_TOKEN is not set.\n" +
      "This script needs it to list the store and to probe each object anonymously; without it the\n" +
      "public/private question cannot be answered and a dry run would report nothing to do, which\n" +
      "would be misleading rather than safe. Set it and re-run.",
    );
    process.exit(1);
  }
  const done = new Set(existsSync(statePath) ? readFileSync(statePath, "utf8").split("\n").filter(Boolean) : []);

  const all: { pathname: string; size: number }[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.list({ prefix: "organizations/", cursor, limit: 1000 });
    for (const o of page.objects) {
      const folder = o.pathname.split("/")[2];
      if (onlyFolder && folder !== onlyFolder) continue;
      all.push({ pathname: o.pathname, size: o.size });
    }
    cursor = page.cursor;
  } while (cursor);

  const pending: typeof all = [];
  for (const o of all) {
    if (done.has(o.pathname)) continue;
    if (!(await client.probePublic(o.pathname))) continue; // already private
    pending.push(o);
    if (pending.length >= limit) break;
  }

  console.log(`${execute ? "EXECUTE" : "DRY RUN"} — ${all.length} objects listed, ${done.size} already recorded done, ${pending.length} publicly readable and pending`);
  if (onlyFolder) console.log(`folder filter: ${onlyFolder}`);
  if (!execute) {
    for (const o of pending) console.log(`  would re-store private: ${o.pathname} (${o.size} bytes)`);
    console.log(`\nDry run. Nothing was written. Re-run with --execute to perform ${pending.length} rewrites.`);
    return;
  }

  let ok = 0;
  const failures: { pathname: string; reason: string }[] = [];
  for (const o of pending) {
    try {
      const src = await client.get(o.pathname, { access: "public" });
      if (!src) { failures.push({ pathname: o.pathname, reason: "source unreadable as public" }); continue; }
      if (src.bytes.length !== o.size) { failures.push({ pathname: o.pathname, reason: `size mismatch before write: listed ${o.size}, read ${src.bytes.length}` }); continue; }

      await client.put(o.pathname, src.bytes, { contentType: src.contentType, access: "private" });

      const after = await client.head(o.pathname);
      if (!after) { failures.push({ pathname: o.pathname, reason: "object missing after write" }); continue; }
      if (after.size !== o.size) { failures.push({ pathname: o.pathname, reason: `size mismatch after write: was ${o.size}, now ${after.size}` }); continue; }
      const stillPublic = await client.probePublic(o.pathname);
      if (stillPublic) { failures.push({ pathname: o.pathname, reason: "still publicly readable after rewrite" }); continue; }

      appendFileSync(statePath, `${o.pathname}\n`);
      ok++;
      console.log(`  private: ${o.pathname} (${o.size} bytes)`);
    } catch (e) {
      failures.push({ pathname: o.pathname, reason: String(e) });
    }
  }

  console.log(`\n${ok} re-stored private, ${failures.length} failed.`);
  for (const f of failures) console.log(`  FAILED ${f.pathname}: ${f.reason}`);
  if (failures.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
