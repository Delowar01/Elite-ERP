/**
 * Copy objects from the legacy PUBLIC SOURCE store into the PRIVATE DESTINATION store, at the same
 * pathname. Nothing is deleted, no pathname changes, and no database row is touched.
 *
 *   npm run blob:migrate                                       # dry run (the default)
 *   npm run blob:migrate -- --execute [--folder f] [--limit n] [--state f.jsonl]
 *   npm run blob:migrate -- --paths-file p.txt [--execute] [--state f.jsonl]
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
 * EXACT-PATH SELECTION. `--paths-file` takes a file of one exact pathname per line and migrates
 * THOSE OBJECTS AND NOTHING ELSE. Matching is exact string equality: no prefix, no wildcard, no
 * folder inference. It exists because "migrate everything under organizations/" is the wrong scope
 * for two different callers — a verification run, which must create nothing it has not recorded in
 * advance, and a production operator, who wants a deterministic slice they can review before and
 * audit after. `--folder` and `--limit` narrow a sweep; `--paths-file` replaces it, and combining
 * them is refused rather than silently intersected, because "the file said these three and the
 * folder filter quietly removed one" is precisely the ambiguity this flag exists to remove.
 *
 * A path that is not in the source is reported and the run exits non-zero. It is never skipped:
 * asking for an object that is not there means the caller's model of the store is wrong.
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
 *              refusal and yields `failed`, never `verified`. An object that was ALREADY in the
 *              destination goes through the identical four conditions; matching bytes alone are
 *              never enough.
 *   conflict   the destination already held DIFFERENT content, or identical bytes under a
 *              different content type — left untouched, reported
 *   failed     any error, with its reason; never swallowed
 *
 * An earlier version of this comment also listed `pending` and `copied`. Neither is ever written:
 * an object is attempted and lands on a terminal state in one step, so recording intermediates
 * would mean adding a write and a crash-window purely to make the state machine look richer. That
 * would be complexity for appearance.
 *
 * CRASH RECOVERY DOES NOT NEED THEM, which is why the simpler design is the right one. If the copy
 * succeeds and the process dies before verification, nothing is recorded, so the rerun treats the
 * object as unattempted — reads the source, finds the destination already present, compares bytes
 * and content type, AND RE-PROVES PRIVACY before recording `verified`. The unrecorded half-step is
 * recovered by re-deriving every condition rather than by remembering, which matters most here:
 * the step most likely to be missing after a crash is the privacy probe itself.
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
const pathsFile = arg("paths-file");

/**
 * Read an exact-path selection. Every rejection here is a refusal to guess: a malformed list means
 * the caller does not have the set they think they have, and migrating "most of it" would be worse
 * than migrating none of it.
 */
export function readPathsFile(file: string, read: (f: string) => string = (f) => readFileSync(f, "utf8")): string[] {
  const raw = read(file);
  const out: string[] = [];
  const seen = new Set<string>();
  raw.split("\n").forEach((line, i) => {
    const n = i + 1;
    const p = line.trim();
    if (!p || p.startsWith("#")) return;
    if (p !== line.trim() || /\s/.test(p)) throw new Error(`${file}:${n}: pathname contains whitespace`);
    if (!p.startsWith("organizations/")) throw new Error(`${file}:${n}: "${p}" is not under organizations/`);
    if (p.includes("*") || p.includes("?")) throw new Error(`${file}:${n}: "${p}" looks like a pattern — only exact pathnames are accepted`);
    if (p.includes("..")) throw new Error(`${file}:${n}: "${p}" contains ".."`);
    if (p.split("/").length < 4) throw new Error(`${file}:${n}: "${p}" is not a complete object pathname`);
    if (seen.has(p)) throw new Error(`${file}:${n}: "${p}" is listed more than once`);
    seen.add(p);
    out.push(p);
  });
  if (!out.length) throw new Error(`${file}: no pathnames`);
  return out;
}

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

/**
 * Every DESTINATION read in a migration bypasses the CDN.
 *
 * Both of them exist to answer "what is in the destination right now", and a cached answer is the
 * wrong answer to that question in two different directions. Read-before-write: a stale copy of an
 * older object would be compared as if it were current, so a genuine CONFLICT could be missed or an
 * already-correct copy mis-reported. Immediate post-write verification: a stale absence makes a copy
 * that did land look like it did not.
 *
 * A live provider run showed the second case — one fixture reported `state=verified` and then read
 * back absent moments later, while read-only inspection afterwards found it present in both stores
 * with the expected sha256. A consistent read removes that ambiguity; a sleep or a retry would only
 * hide it, and would turn "eventually correct" into evidence of "immediately correct", which is a
 * different and weaker claim.
 *
 * The SOURCE read is deliberately left on the default cached path: nothing writes to the public
 * source during a migration, so there is no newer version for a cache to be stale about, and paying
 * origin transfer for every object of a full migration to prove that would be waste. Application
 * reads stay cached for the same reason — see BlobGetOptions.
 */
const CONSISTENT = { useCache: false } as const;

async function migrateOne(src: BlobStore, dest: BlobStore, pathname: string, listedSize: number): Promise<Entry> {
  const at = new Date().toISOString();
  try {
    const source = await src.get(pathname);
    if (!source) return { pathname, state: "failed", reason: "source object could not be read", at };
    if (source.bytes.length !== listedSize) return { pathname, state: "failed", reason: `source size changed while listing: listed ${listedSize}, read ${source.bytes.length}`, at };
    const sourceHash = sha(source.bytes);

    // Compare before write. An existing destination reaches `verified` only through the SAME four
    // conditions a fresh copy does — bytes, content type, authenticated existence, and an explicit
    // anonymous refusal. Returning `verified` on matching bytes alone opened a real crash-recovery
    // hole: copy succeeds, the process dies before the privacy probe, the rerun sees identical
    // bytes and records `verified` for an object whose privacy was never proven once.
    const existing = await dest.get(pathname, CONSISTENT);
    if (existing) {
      if (sha(existing.bytes) !== sourceHash) {
        return { pathname, state: "conflict", reason: `destination exists with different content (source sha ${sourceHash.slice(0, 12)}, destination sha ${sha(existing.bytes).slice(0, 12)})`, at };
      }
      if (existing.contentType !== source.contentType) {
        // Same bytes, different content type is still a conflict: the destination would serve these
        // bytes as something else. Left untouched — overwriting would destroy the evidence.
        return { pathname, state: "conflict", reason: `destination holds identical bytes with a different content type (source ${source.contentType}, destination ${existing.contentType}) — left untouched`, at };
      }
      return await verifyPrivate(dest, pathname, source.bytes.length, sourceHash, at, "destination already existed with identical bytes and content type");
    }

    await dest.put(pathname, source.bytes, { contentType: source.contentType });

    const after = await dest.get(pathname, CONSISTENT);
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
    return await verifyPrivate(dest, pathname, source.bytes.length, sourceHash, at, "copied");
  } catch (e) {
    return { pathname, state: "failed", reason: String(e), at };
  }
}

/**
 * The single place `verified` is produced, so a freshly copied object and a pre-existing identical
 * one are held to the same standard. assertPrivatelyStored proves the object exists through an
 * authenticated read first, then requires the provider to say something explicit about the
 * anonymous request; an inconclusive probe throws and the object is recorded FAILED. "I could not
 * reach the provider" must never become "verified private".
 */
async function verifyPrivate(dest: BlobStore, pathname: string, bytes: number, sourceHash: string, at: string, how: string): Promise<Entry> {
  try {
    const probe = await assertPrivatelyStored(dest, pathname);
    return { pathname, state: "verified", bytes, sha256: sourceHash, reason: `${how}; anonymous ${probe.state} (${probe.status})`, at };
  } catch (e) {
    return { pathname, state: "failed", reason: `destination privacy unverified (${how}): ${String(e)}`, at };
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

  if (pathsFile && (onlyFolder || arg("limit"))) {
    console.error("--paths-file cannot be combined with --folder or --limit: the file IS the selection, and\nquietly removing an entry from it would defeat the point of naming the objects exactly.");
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

  // Exact selection, applied to the listing only to learn each object's size. The listing decides
  // nothing about WHICH objects are migrated once a paths file is given.
  let selected = all;
  if (pathsFile) {
    const wanted = readPathsFile(pathsFile);
    const bySize = new Map(all.map((o) => [o.pathname, o.size]));
    const missing = wanted.filter((p) => !bySize.has(p));
    if (missing.length) {
      console.error(`${missing.length} requested pathname(s) are not in the source store:`);
      for (const p of missing) console.error(`  ${p}`);
      process.exit(1);
    }
    selected = wanted.map((p) => ({ pathname: p, size: bySize.get(p)! }));
  }

  const settled = (p: string) => done.get(p)?.state === "verified";
  const pending = selected.filter((o) => !settled(o.pathname)).slice(0, limit === Infinity ? undefined : limit);

  console.log(`${execute ? "EXECUTE" : "DRY RUN"} — source ${src.mode} store: ${all.length} objects listed, ${selected.length} selected, ${[...done.values()].filter((e) => e.state === "verified").length} already verified, ${pending.length} pending`);
  if (pathsFile) {
    console.log(`exact path selection from ${pathsFile} — no other object is considered:`);
    for (const o of selected) console.log(`  selected: ${o.pathname}`);
  }
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

if (process.argv[1] && process.argv[1].endsWith("blob-migrate.ts")) main().catch((e) => { console.error(e); process.exit(1); });
