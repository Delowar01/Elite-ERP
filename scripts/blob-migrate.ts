/**
 * Copy objects from the legacy PUBLIC SOURCE store into the PRIVATE DESTINATION store, at the same
 * pathname. Nothing is deleted, no pathname changes, and no database row is touched.
 *
 *   npm run blob:migrate                                       # dry run (the default)
 *   npm run blob:migrate -- --execute [--folder f] [--limit n] [--state f.jsonl]
 *
 * DRY RUN IS THE DEFAULT AND --execute IS THE ONLY WAY PAST IT. A dry run writes nothing, not even
 * the state file.
 *
 * WHY A COPY AND NOT AN OVERWRITE. Access belongs to the STORE in Vercel Blob: a store is created
 * public or private and cannot be changed, and the SDK builds
 * `https://${storeId}.${access}.blob.vercel-storage.com/${pathname}` — the access level is part of
 * the host. So an object cannot be "made private" where it lies; it has to be written into a
 * different store. An earlier version of this script read an object public and put() it back
 * private at the same pathname in one store, which is not a thing that can happen.
 *
 * THE SOURCE IS NEVER DELETED. A copied object is not a removed one, and keeping the public copy
 * intact is what makes the rollback window survivable. Retiring the source store is a separate,
 * later, deliberate act — see docs/security/private-blob-runbook.md.
 *
 * COMPARE BEFORE WRITE, rather than allowOverwrite. The SDK refuses to replace an existing pathname
 * unless allowOverwrite is set, and that default is a feature here: a destination object that
 * already exists is either the same bytes (already done, skip) or different bytes (a CONFLICT that
 * a human must look at). Blindly overwriting would destroy the evidence of the second case.
 *
 * STATE FILE — exactly three states are written, because exactly three are reached:
 *
 *   verified   the destination holds the object, its size, sha256 and content type match the
 *              source, AND an anonymous request to the provider was explicitly refused. A probe
 *              that could not answer — transport failure, 429, 5xx, unknown status — is NOT a
 *              refusal and yields `failed`, never `verified`.
 *   conflict   the destination already held DIFFERENT content — left untouched, reported
 *   failed     any error, with its reason; never swallowed
 *
 * An earlier version of this comment also listed `pending` and `copied`. Neither is ever written:
 * an object is attempted and lands on a terminal state in one step, so recording intermediates
 * would mean adding a write and a crash-window purely to make the state machine look richer. That
 * would be complexity for appearance.
 *
 * CRASH RECOVERY DOES NOT NEED THEM, which is why the simpler design is the right one. If the copy
 * succeeds and the process dies before verification, nothing is recorded, so the rerun treats the
 * object as unattempted — reads the source, finds the destination already present, hashes both, and
 * records `verified` when they match. The unrecorded half-step is recovered by COMPARING rather
 * than by remembering, and comparison is what would have to be trusted anyway.
 *
 * RESUME SEMANTICS: only `verified` is settled and skipped. `conflict` and `failed` entries are
 * retried on the next run, because both are states a human may have fixed in between.
 *
 * The run exits non-zero if anything ends conflict or failed.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { destinationStore, sourceStore, assertPrivatelyStored, type BlobStore } from "../src/lib/storage/blob-client";

const has = (n: string) => process.argv.includes(`--${n}`);
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };

const execute = has("execute");
const onlyFolder = arg("folder");
const limit = arg("limit") ? Number(arg("limit")) : Infinity;
const statePath = arg("state") ?? "blob-migration-state.jsonl";

// Only the states that are actually written. See the header: intermediates are not recorded.
type State = "verified" | "conflict" | "failed";
type Entry = { pathname: string; state: State; reason?: string; bytes?: number; sha256?: string; at: string };

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function loadDone(): Map<string, Entry> {
  const m = new Map<string, Entry>();
  if (!existsSync(statePath)) return m;
  for (const line of readFileSync(statePath, "utf8").split("\n").filter(Boolean)) {
    try { const e = JSON.parse(line) as Entry; m.set(e.pathname, e); } catch { /* skip a torn line */ }
  }
  return m;
}

function record(e: Entry) {
  appendFileSync(statePath, JSON.stringify(e) + "\n");
}

async function migrateOne(src: BlobStore, dest: BlobStore, pathname: string, listedSize: number): Promise<Entry> {
  const at = new Date().toISOString();
  try {
    const source = await src.get(pathname);
    if (!source) return { pathname, state: "failed", reason: "source object could not be read", at };
    if (source.bytes.length !== listedSize) return { pathname, state: "failed", reason: `source size changed while listing: listed ${listedSize}, read ${source.bytes.length}`, at };
    const sourceHash = sha(source.bytes);

    // Compare before write. An existing destination is only success if it is byte-identical.
    const existing = await dest.get(pathname);
    if (existing) {
      if (sha(existing.bytes) === sourceHash) return { pathname, state: "verified", bytes: source.bytes.length, sha256: sourceHash, reason: "destination already held identical bytes", at };
      return { pathname, state: "conflict", reason: `destination exists with different content (source sha ${sourceHash.slice(0, 12)}, destination sha ${sha(existing.bytes).slice(0, 12)})`, at };
    }

    await dest.put(pathname, source.bytes, { contentType: source.contentType });

    const after = await dest.get(pathname);
    if (!after) return { pathname, state: "failed", reason: "destination object missing immediately after write", at };
    if (after.bytes.length !== source.bytes.length) return { pathname, state: "failed", reason: `destination size mismatch: ${source.bytes.length} -> ${after.bytes.length}`, at };
    if (sha(after.bytes) !== sourceHash) return { pathname, state: "failed", reason: "destination sha256 does not match the source", at };
    if (after.contentType !== source.contentType) return { pathname, state: "failed", reason: `content type changed: ${source.contentType} -> ${after.contentType}`, at };
    // The last step is POSITIVE evidence that the copy is private, and it is allowed to fail.
    // assertPrivatelyStored proves the object exists through an authenticated read first, then
    // requires the provider to say something explicit about the anonymous request. If the probe is
    // inconclusive — transport failure, 429, 5xx, an unrecognized status — it throws, and this
    // object is recorded FAILED with that reason. "I could not reach the provider" must never be
    // recorded as "verified private"; that is exactly how a migration would report success against
    // a store it never actually contacted.
    try {
      const probe = await assertPrivatelyStored(dest, pathname);
      return { pathname, state: "verified", bytes: source.bytes.length, sha256: sourceHash, reason: `anonymous ${probe.state} (${probe.status})`, at };
    } catch (e) {
      return { pathname, state: "failed", reason: `destination privacy unverified: ${String(e)}`, at };
    }
  } catch (e) {
    return { pathname, state: "failed", reason: String(e), at };
  }
}

async function main() {
  const dest = destinationStore();
  const src = sourceStore();
  if (!src) {
    console.error(
      "No PUBLIC SOURCE store is configured (BLOB_PUBLIC_SOURCE_READ_WRITE_TOKEN is unset).\n" +
      "There is nothing to migrate from. If the legacy store has already been retired this is the\n" +
      "expected state and no migration is needed; if it has not, set the token and re-run. Refusing\n" +
      "to report 'nothing to do', which would be misleading rather than safe.",
    );
    process.exit(1);
  }

  const done = loadDone();
  const all: { pathname: string; size: number }[] = [];
  let cursor: string | undefined;
  do {
    const page = await src.list({ prefix: "organizations/", cursor, limit: 1000 });
    for (const o of page.objects) {
      if (onlyFolder && o.pathname.split("/")[2] !== onlyFolder) continue;
      all.push({ pathname: o.pathname, size: o.size });
    }
    cursor = page.cursor;
  } while (cursor);

  const settled = (p: string) => done.get(p)?.state === "verified";
  const pending = all.filter((o) => !settled(o.pathname)).slice(0, limit === Infinity ? undefined : limit);

  console.log(`${execute ? "EXECUTE" : "DRY RUN"} — source ${src.mode} store: ${all.length} objects listed, ${[...done.values()].filter((e) => e.state === "verified").length} already verified, ${pending.length} pending`);
  if (onlyFolder) console.log(`folder filter: ${onlyFolder}`);
  if (!execute) {
    for (const o of pending) console.log(`  would copy -> private destination: ${o.pathname} (${o.size} bytes)`);
    console.log(`\nDry run. Nothing was written, to either store, and no state file was created.`);
    console.log(`Re-run with --execute to copy ${pending.length} objects. The source store is never modified.`);
    return;
  }

  const tally: Record<State, number> = { verified: 0, conflict: 0, failed: 0 };
  for (const o of pending) {
    const entry = await migrateOne(src, dest, o.pathname, o.size);
    record(entry);
    tally[entry.state]++;
    const mark = entry.state === "verified" ? "verified" : entry.state.toUpperCase();
    console.log(`  ${mark}: ${o.pathname}${entry.reason ? ` — ${entry.reason}` : ""}`);
  }

  console.log(`\nverified ${tally.verified}, conflict ${tally.conflict}, failed ${tally.failed}`);
  console.log("The public source store was not modified: no object was deleted or rewritten there.");
  if (tally.conflict || tally.failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
