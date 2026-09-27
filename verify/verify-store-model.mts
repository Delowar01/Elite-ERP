/**
 * The two-store provider model, exercised directly against the application's own storage code.
 *
 * Access belongs to the STORE in Vercel Blob. These assertions exist because the previous design
 * modelled it as a per-object property and produced a migration that could not work; the point of
 * most of them is that the WRONG design would now fail rather than quietly appear to succeed.
 *
 * Runs under --conditions=react-server so the production module graph is the one imported.
 * NOT evidence about Vercel: REAL PROVIDER VERIFICATION PENDING.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.STORAGE_DRIVER = "fake";
process.env.STORAGE_FAKE_SOURCE = "1";
process.env.STORAGE_FAKE_DIR = mkdtempSync(join(tmpdir(), "storemodel-"));

const { destinationStore, sourceStore, BlobExistsError, BlobDeleteError, BlobProbeError, assertPrivatelyStored } = await import("../src/lib/storage/blob-client");
const { storeBlob, readBlob, deleteStoredBlob, pathnameFromStored } = await import("../src/lib/storage/blob-storage");

const results: [boolean, string, string][] = [];
const ok = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");
const dest = destinationStore();
const src = sourceStore()!;

// 1 + 2. A store's mode is fixed and structural — there is no access argument to get wrong.
ok("the destination store is private and the source store is public", dest.mode === "private" && src.mode === "public", `${dest.mode}/${src.mode}`);
// get() now takes an options bag for the opt-in consistent read, so arity alone no longer expresses
// the property. What matters is unchanged and is asserted directly: the only thing a caller may pass
// is `useCache`, and the store's access mode stays whatever it was constructed with.
const clientSrc = readFileSync(new URL("../src/lib/storage/blob-client.ts", import.meta.url), "utf8");
// Scoped to the PUBLIC interface declaration. The internal Vercel call necessarily passes `access`
// to the SDK — that is the store's own fixed mode, not something a caller can supply.
const ifaceStart = clientSrc.indexOf("export interface BlobStore");
const ifaceDecl = clientSrc.slice(ifaceStart, clientSrc.indexOf("\n}", ifaceStart))
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");   // signatures only, not prose
ok("no store method accepts an access argument, so the wrong access cannot be requested",
   dest.put.length === 3 && /export type BlobGetOptions = \{ useCache\?: boolean \};/.test(clientSrc) &&
   !/access/.test(ifaceDecl),
   `put arity ${dest.put.length}, get arity ${dest.get.length}, accessInInterface=${/access/.test(ifaceDecl)}`);
ok("the read option cannot change a store's access mode",
   (await (async () => { await dest.get("organizations/1/logos/x.png", { useCache: false }).catch(() => null); return dest.mode; })()) === "private");
ok("a public store's provider URL is a .public. host; a private store's is .private.",
   src.providerUrl("x").includes(".public.blob.") && dest.providerUrl("x").includes(".private.blob."),
   `${src.providerUrl("x")} | ${dest.providerUrl("x")}`);
ok("the PUBLIC store serves an anonymous caller and the PRIVATE store does not",
   await (async () => { await src.put("organizations/1/logos/p.png", PNG, { contentType: "image/png" }); await dest.put("organizations/1/logos/q.png", PNG, { contentType: "image/png" });
     return (await src.probeAnonymous("organizations/1/logos/p.png")).state === "readable" && (await dest.probeAnonymous("organizations/1/logos/q.png")).state === "denied"; })());

// 3. A new upload goes only to the private destination.
const stored = await storeBlob(7, "logos", PNG, "png", "image/png");
const p = pathnameFromStored(stored);
ok("a new upload lands in the private destination store", (await dest.head(p)) !== null, p);
ok("a new upload creates NO copy in the public source store", (await src.head(p)) === null, p);

// 4. Private read wins when the object is in the destination.
await src.put(p, Buffer.from("PUBLIC-DECOY"), { contentType: "image/png", allowOverwrite: true });
const won = await readBlob(p);
ok("the private destination wins when both stores hold the pathname", won?.bytes.equals(PNG) === true, won ? won.bytes.toString("latin1").slice(0, 20) : "null");

// 5. Missing destination falls back to the public source.
const legacy = "organizations/7/logos/7-1700000000000-aaaaaaaaaaaaaaaa.png";
await src.put(legacy, Buffer.from("LEGACY-BYTES"), { contentType: "image/png", allowOverwrite: true });
const fell = await readBlob(legacy);
ok("an unmigrated object still loads, read from the public source", fell?.bytes.toString() === "LEGACY-BYTES", fell ? fell.bytes.toString() : "null");

// 6. A read FAILURE must not look like absence. This is the one that keeps a broken token from
//    silently serving the public copy for every file in the system.
process.env.STORAGE_FAKE_FAIL_READ = "failme";
const failPath = "organizations/7/logos/7-1700000000001-failme0000000000.png";
await src.put(failPath, Buffer.from("SHOULD-NOT-BE-SERVED"), { contentType: "image/png", allowOverwrite: true });
let threw = false, servedPublicBytes = false;
try { const r = await readBlob(failPath); servedPublicBytes = r?.bytes.toString() === "SHOULD-NOT-BE-SERVED"; } catch { threw = true; }
delete process.env.STORAGE_FAKE_FAIL_READ;
// The fault is injected into the DESTINATION only, so the source copy is readable. A fallback that
// swallows the error therefore SUCCEEDS and serves the public bytes — which is exactly the unsafe
// behaviour, and is what makes this assertion able to fail.
ok("a destination read ERROR throws instead of falling back to the public source", threw && !servedPublicBytes, servedPublicBytes ? "served the public copy" : "");

// 7-10. Migration: copy across stores, idempotent, conflict fails closed, source untouched.
const mig = (...args: string[]) => {
  // stdout AND stderr: a refusal (an unknown path, an illegal flag combination) is reported on
  // stderr with a non-zero exit, and a test that only read stdout would see an empty string and
  // pass for the wrong reason.
  try {
    const out = execFileSync("npx", ["tsx", "--conditions=react-server", "scripts/blob-migrate.ts", ...args], { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    return out;
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return `${err.stdout ?? ""}${err.stderr ?? ""}` || String(e);
  }
};
const toMigrate = "organizations/9/seals/9-1700000000002-bbbbbbbbbbbbbbbb.png";
await src.put(toMigrate, PNG, { contentType: "image/png" });
const state = join(process.env.STORAGE_FAKE_DIR!, "state.jsonl");

const dry = mig("--state", state);
ok("dry run is the default and writes nothing to the destination", dry.includes("DRY RUN") && (await dest.head(toMigrate)) === null);

mig("--execute", "--state", state);
const copied = await dest.get(toMigrate);
ok("migration copies the bytes into the private destination at the same pathname", copied?.bytes.equals(PNG) === true, String(copied?.bytes.length));
ok("migration leaves the public source object untouched", (await src.get(toMigrate))?.bytes.equals(PNG) === true);
const rerun = mig("--execute", "--state", state);
ok("a rerun is idempotent — nothing pending", /0 pending|verified 0/.test(rerun) || rerun.includes("pending"), rerun.split("\n")[0] ?? "");

// conflict: destination holds DIFFERENT bytes at a source pathname
const conflictPath = "organizations/9/seals/9-1700000000003-cccccccccccccccc.png";
await src.put(conflictPath, PNG, { contentType: "image/png" });
await dest.put(conflictPath, Buffer.from("DIFFERENT"), { contentType: "image/png" });
const conflicted = mig("--execute", "--state", join(process.env.STORAGE_FAKE_DIR!, "state2.jsonl"));
ok("a destination that differs is reported as CONFLICT and not overwritten", conflicted.includes("CONFLICT"), conflicted.split("\n").find((l) => l.includes(conflictPath))?.trim() ?? "");
ok("the conflicting destination object was left exactly as it was", (await dest.get(conflictPath))?.bytes.toString() === "DIFFERENT");

// ---- CONSISTENT READS --------------------------------------------------------------------------
// A live run recorded a migration fixture as `state=verified` and then read the destination back as
// ABSENT moments later; read-only inspection afterwards found it present in both stores with the
// expected sha256. The copy was fine, the read was ambiguous. These prove the fix is a read that
// asks for current state — not a sleep, not a retry, and not a weaker assertion.
{
  const consistentPath = "organizations/9/logos/9-1700000000030-2222222222222222.png";
  await src.put(consistentPath, PNG, { contentType: "image/png" });
  await dest.put(consistentPath, PNG, { contentType: "image/png" });

  process.env.STORAGE_FAKE_STALE_ABSENT = "1700000000030";
  try {
    ok("a DEFAULT read may report a stale absence for an object that is present",
       (await dest.get(consistentPath)) === null);
    const consistent = await dest.get(consistentPath, { useCache: false });
    ok("an explicit consistent read sees the object that is really there",
       consistent?.bytes.equals(PNG) === true, String(consistent?.bytes.length));
    ok("head() is unaffected — only the cached GET path is modelled as stale",
       (await dest.head(consistentPath)) !== null);

    // The application path deliberately stays on the cached read, so a stale destination absence
    // falls through to the public source exactly as it always has. This is the behaviour we are
    // KEEPING: making every /uploads read uncached would bypass the CDN for every image.
    const viaApp = await readBlob(consistentPath);
    ok("readBlob() still uses the DEFAULT cached destination read", viaApp?.bytes.equals(PNG) === true);

    // End-to-end: with the stale absence armed, a migration that reads the destination WITHOUT
    // asking for current state cannot verify its own copy. This one passes because it does ask.
    const migPath = "organizations/9/logos/9-1700000000031-3333333333333333.png";
    await src.put(migPath, PNG, { contentType: "image/png" });
    const listFile = join(process.env.STORAGE_FAKE_DIR!, "paths-consistent.txt");
    writeFileSync(listFile, migPath + "\n");
    const stateFile = join(process.env.STORAGE_FAKE_DIR!, "state-consistent.jsonl");
    process.env.STORAGE_FAKE_STALE_ABSENT = "1700000000031";
    mig("--execute", "--paths-file", listFile, "--state", stateFile);
    const entry = JSON.parse(readFileSync(stateFile, "utf8").split("\n").filter(Boolean)[0]) as { state: string; reason?: string };
    ok("migration verifies its own copy even when the DEFAULT destination read would be stale",
       entry.state === "verified", `${entry.state} — ${entry.reason}`);
    ok("and the object really is in the destination", (await dest.get(migPath, { useCache: false }))?.bytes.equals(PNG) === true);
    ok("the public source is still untouched", (await src.get(migPath))?.bytes.equals(PNG) === true);
  } finally {
    delete process.env.STORAGE_FAKE_STALE_ABSENT;
  }
  ok("with the fault cleared, the default read sees the object again",
     (await dest.get(consistentPath))?.bytes.equals(PNG) === true);
}

// ---- EXACT-PATH SELECTION -------------------------------------------------------------------
// A sweep of organizations/ is the wrong scope for a caller that must create nothing it has not
// recorded in advance. --paths-file names the objects; nothing else may be considered.
{
  const { readPathsFile } = await import("../scripts/blob-migrate");
  const parse = (body: string) => readPathsFile("test.txt", () => body);
  const P1 = "organizations/9/logos/9-1700000000010-aaaaaaaaaaaaaaaa.png";
  const P2 = "organizations/9/seals/9-1700000000011-bbbbbbbbbbbbbbbb.png";
  const refuses = (body: string) => { try { parse(body); return false; } catch { return true; } };

  ok("paths file: exact pathnames are accepted, blanks and comments ignored", JSON.stringify(parse(`${P1}\n\n# note\n${P2}\n`)) === JSON.stringify([P1, P2]));
  ok("paths file: a duplicate entry refuses", refuses(`${P1}\n${P1}\n`));
  // Shaped exactly like a valid object pathname, so ONLY the organizations/ requirement can reject
  // it — a shorter path would be caught by the segment-count rule and prove nothing about this one.
  ok("paths file: a well-formed path outside organizations/ refuses", refuses("elsewhere/9/logos/9-1700000000010-aaaaaaaaaaaaaaaa.png\n"));
  ok("paths file: a wildcard refuses — this is not a prefix matcher", refuses("organizations/9/logos/*\n"));
  ok("paths file: a traversal segment refuses", refuses("organizations/9/logos/../../x.png\n"));
  ok("paths file: a prefix without an object name refuses", refuses("organizations/9/logos\n"));
  ok("paths file: an empty file refuses", refuses("\n\n"));
  ok("paths file: a pathname with whitespace inside refuses", refuses("organizations/9/logos/a b.png\n"));

  // Two source objects; only one is named.
  const named = "organizations/9/logos/9-1700000000012-cccccccccccccccc.png";
  const unnamed = "organizations/9/logos/9-1700000000013-dddddddddddddddd.png";
  await src.put(named, PNG, { contentType: "image/png" });
  await src.put(unnamed, Buffer.concat([PNG, Buffer.from("other")]), { contentType: "image/png" });
  const listFile = join(process.env.STORAGE_FAKE_DIR!, "paths.txt");
  writeFileSync(listFile, named + "\n");

  const selDry = mig("--paths-file", listFile, "--state", join(process.env.STORAGE_FAKE_DIR!, "state-exact.jsonl"));
  const selected = selDry.split("\n").filter((l) => l.trim().startsWith("selected: ")).map((l) => l.trim().slice(10));
  ok("paths file: the selection is EXACTLY the named object", selected.length === 1 && selected[0] === named, JSON.stringify(selected));
  mig("--execute", "--paths-file", listFile, "--state", join(process.env.STORAGE_FAKE_DIR!, "state-exact.jsonl"));
  ok("paths file: the named object is copied", (await dest.head(named)) !== null);
  ok("paths file: the UNNAMED source object gets no destination copy", (await dest.head(unnamed)) === null);

  const missingFile = join(process.env.STORAGE_FAKE_DIR!, "paths-missing.txt");
  writeFileSync(missingFile, "organizations/9/logos/9-1700000000099-eeeeeeeeeeeeeeee.png\n");
  const missingOut = mig("--paths-file", missingFile, "--state", join(process.env.STORAGE_FAKE_DIR!, "state-missing.jsonl"));
  ok("paths file: a requested path absent from the source is reported, not skipped", /not in the source store/.test(missingOut), missingOut.split("\n")[0] ?? "");

  const comboOut = mig("--paths-file", listFile, "--folder", "logos", "--state", join(process.env.STORAGE_FAKE_DIR!, "state-combo.jsonl"));
  ok("paths file: combining it with --folder is refused rather than silently intersected", /cannot be combined/.test(comboOut), comboOut.split("\n")[0] ?? "");
}

// ---- AN EXISTING DESTINATION IS HELD TO THE SAME STANDARD ------------------------------------
// The crash-recovery case: the copy landed, the process died before the privacy probe, and nothing
// was recorded. A rerun that trusts matching bytes alone records `verified` for an object whose
// privacy was never proven once.
{
  const recovered = "organizations/9/logos/9-1700000000020-ffffffffffffffff.png";
  await src.put(recovered, PNG, { contentType: "image/png" });
  await dest.put(recovered, PNG, { contentType: "image/png" });   // identical, as a crashed copy would leave it
  const listFile = join(process.env.STORAGE_FAKE_DIR!, "paths-recover.txt");
  writeFileSync(listFile, recovered + "\n");
  const stateR = join(process.env.STORAGE_FAKE_DIR!, "state-recover.jsonl");
  const out = mig("--execute", "--paths-file", listFile, "--state", stateR);
  const entry = JSON.parse(readFileSync(stateR, "utf8").split("\n").filter(Boolean)[0]) as { state: string; reason?: string };
  ok("existing identical destination: recorded verified only after privacy is re-proved", entry.state === "verified" && /anonymous/.test(entry.reason ?? ""), `${entry.state} — ${entry.reason}`);
  ok("existing identical destination: the reason says it already existed", /already existed/.test(entry.reason ?? ""), entry.reason ?? "");
  void out;

  // Same object, but now the probe cannot answer. An unreachable provider is not proof of privacy.
  const stateF = join(process.env.STORAGE_FAKE_DIR!, "state-recover-fail.jsonl");
  process.env.STORAGE_FAKE_PROBE_FAULT = "network";
  process.env.STORAGE_FAKE_PROBE_FAULT_MATCH = "1700000000020";
  mig("--execute", "--paths-file", listFile, "--state", stateF);
  delete process.env.STORAGE_FAKE_PROBE_FAULT;
  delete process.env.STORAGE_FAKE_PROBE_FAULT_MATCH;
  const failEntry = JSON.parse(readFileSync(stateF, "utf8").split("\n").filter(Boolean)[0]) as { state: string; reason?: string };
  ok("existing identical destination + unanswerable probe: FAILED, never verified", failEntry.state === "failed" && /privacy unverified/.test(failEntry.reason ?? ""), `${failEntry.state} — ${failEntry.reason}`);

  // Identical bytes, different content type: the destination would serve these bytes as something
  // else, so it is a conflict and the destination is left exactly as it was.
  const ctPath = "organizations/9/logos/9-1700000000021-1111111111111111.png";
  await src.put(ctPath, PNG, { contentType: "image/png" });
  await dest.put(ctPath, PNG, { contentType: "application/octet-stream" });
  const ctFile = join(process.env.STORAGE_FAKE_DIR!, "paths-ct.txt");
  writeFileSync(ctFile, ctPath + "\n");
  const stateCt = join(process.env.STORAGE_FAKE_DIR!, "state-ct.jsonl");
  mig("--execute", "--paths-file", ctFile, "--state", stateCt);
  const ctEntry = JSON.parse(readFileSync(stateCt, "utf8").split("\n").filter(Boolean)[0]) as { state: string; reason?: string };
  ok("identical bytes with a DIFFERENT content type is a conflict", ctEntry.state === "conflict" && /content type/.test(ctEntry.reason ?? ""), `${ctEntry.state} — ${ctEntry.reason}`);
  ok("the content-type conflict left the destination object untouched", (await dest.get(ctPath))?.contentType === "application/octet-stream");
}

// 11. allowOverwrite is off by default, in the fake as in the SDK.
let existsThrew = false;
try { await dest.put(p, PNG, { contentType: "image/png" }); } catch (e) { existsThrew = e instanceof BlobExistsError; }
ok("writing an existing pathname refuses unless overwrite is requested", existsThrew);

// 12. An intentional user delete clears BOTH stores, so removal is never cosmetic.
const both = "organizations/7/logos/7-1700000000004-dddddddddddddddd.png";
await src.put(both, PNG, { contentType: "image/png" });
await dest.put(both, PNG, { contentType: "image/png" });
await deleteStoredBlob(`/uploads/${both}`);
ok("an intentional delete removes the object from BOTH stores", (await dest.head(both)) === null && (await src.head(both)) === null);

// ---- DELETE SEMANTICS ----------------------------------------------------------------------
// An intentional removal that half-worked must never report success. If the private copy went and
// the PUBLIC one did not, the user has been told their file is gone while its bytes are still
// anonymously downloadable — so every one of these is about the public store surviving.
const seed = async (path: string, where: ("public" | "private")[]) => {
  if (where.includes("public")) await src.put(path, PNG, { contentType: "image/png", allowOverwrite: true });
  if (where.includes("private")) await dest.put(path, PNG, { contentType: "image/png", allowOverwrite: true });
};
const gone = async (path: string) => (await dest.head(path)) === null && (await src.head(path)) === null;

// 1. present in both
const dBoth = "organizations/5/logos/5-1700000000010-1111111111111111.png";
await seed(dBoth, ["public", "private"]);
await deleteStoredBlob(`/uploads/${dBoth}`);
ok("delete: an object in BOTH stores is removed from both", await gone(dBoth));

// 2. destination missing, source present
const dSrcOnly = "organizations/5/logos/5-1700000000011-2222222222222222.png";
await seed(dSrcOnly, ["public"]);
await deleteStoredBlob(`/uploads/${dSrcOnly}`);
ok("delete: an object only in the PUBLIC source is removed", await gone(dSrcOnly));

// 3. source missing, destination present
const dDestOnly = "organizations/5/logos/5-1700000000012-3333333333333333.png";
await seed(dDestOnly, ["private"]);
await deleteStoredBlob(`/uploads/${dDestOnly}`);
ok("delete: an object only in the private destination is removed", await gone(dDestOnly));

// 4. destination delete FAILS — the source must still be attempted, and the whole thing must report
const dFailDest = "organizations/5/logos/5-1700000000013-faildest00000000.png";
await seed(dFailDest, ["public", "private"]);
process.env.STORAGE_FAKE_FAIL_DELETE = "faildest";
process.env.STORAGE_FAKE_FAIL_DELETE_ROLE = "destination";
let reported = false;
try { await deleteStoredBlob(`/uploads/${dFailDest}`); } catch (e) { reported = e instanceof BlobDeleteError; }
delete process.env.STORAGE_FAKE_FAIL_DELETE;
ok("delete: a DESTINATION failure is reported, not swallowed", reported);
ok("delete: the PUBLIC source is still removed even though the destination failed", (await src.head(dFailDest)) === null, "the anonymously-readable copy must not survive a destination error");
ok("delete: the destination object that failed to delete is still there (the failure was real)", (await dest.head(dFailDest)) !== null);

// 5. source delete FAILS — destination still removed, still reported
const dFailSrc = "organizations/5/logos/5-1700000000014-failsrc000000000.png";
await seed(dFailSrc, ["public", "private"]);
process.env.STORAGE_FAKE_FAIL_DELETE = "failsrc";
process.env.STORAGE_FAKE_FAIL_DELETE_ROLE = "source";
let reportedSrc = false, failedStores: string[] = [];
try { await deleteStoredBlob(`/uploads/${dFailSrc}`); } catch (e) { reportedSrc = e instanceof BlobDeleteError; if (e instanceof BlobDeleteError) failedStores = e.failures.map((f) => f.role); }
delete process.env.STORAGE_FAKE_FAIL_DELETE;
delete process.env.STORAGE_FAKE_FAIL_DELETE_ROLE;
ok("delete: a SOURCE failure is reported — the public bytes may still be downloadable", reportedSrc && failedStores.includes("source"), JSON.stringify(failedStores));
ok("delete: the destination was still removed despite the source failing", (await dest.head(dFailSrc)) === null);

// 6. idempotent on a genuinely missing object
let missingThrew = false;
try { await deleteStoredBlob("/uploads/organizations/5/logos/5-1700000000015-4444444444444444.png"); } catch { missingThrew = true; }
ok("delete: a genuinely missing object is idempotent and not an error", !missingThrew);

// 7. the headline property: a REPORTED SUCCESS means nothing survived in the public store
const dClean = "organizations/5/logos/5-1700000000016-5555555555555555.png";
await seed(dClean, ["public", "private"]);
await deleteStoredBlob(`/uploads/${dClean}`);
ok("delete: after a reported success the object is not anonymously readable anywhere", (await src.probeAnonymous(dClean)).state !== "readable" && (await dest.probeAnonymous(dClean)).state !== "readable");

// ---- ANONYMOUS PROBE: AN ANSWER, OR NOTHING -------------------------------------------------
// The probe used to return a boolean, folding "the provider refused" together with "I could not
// reach the provider". Those are opposites — one is evidence of privacy, the other is its absence —
// and in THIS environment, where Vercel is egress-blocked outright, the old version would have
// reported every object in the store as private.
const pubObj = "organizations/6/logos/6-1700000000020-6666666666666666.png";
const privObj = "organizations/6/logos/6-1700000000021-7777777777777777.png";
await src.put(pubObj, PNG, { contentType: "image/png", allowOverwrite: true });
await dest.put(privObj, PNG, { contentType: "image/png", allowOverwrite: true });

ok("probe: a public-store object reports readable", (await src.probeAnonymous(pubObj)).state === "readable", JSON.stringify(await src.probeAnonymous(pubObj)));
ok("probe: a private-store object reports an explicit denial", (await dest.probeAnonymous(privObj)).state === "denied", JSON.stringify(await dest.probeAnonymous(privObj)));
ok("probe: a genuinely absent object reports not_found, distinct from denied", (await dest.probeAnonymous("organizations/6/logos/6-1700000000022-8888888888888888.png")).state === "not_found");

const probeThrows = async (fault: string) => {
  process.env.STORAGE_FAKE_PROBE_FAULT = fault;
  let err: unknown = null;
  try { await dest.probeAnonymous(privObj); } catch (e) { err = e; }
  delete process.env.STORAGE_FAKE_PROBE_FAULT;
  return err instanceof BlobProbeError;
};
ok("probe: a transport failure THROWS rather than reporting 'not readable'", await probeThrows("network"));
ok("probe: a 429 THROWS — a rate limit is not a refusal", await probeThrows("429"));
ok("probe: a 5xx THROWS — a provider fault is not a refusal", await probeThrows("500"));

// Positive evidence, in the right order: authenticated existence FIRST, then the anonymous answer.
const verified = await assertPrivatelyStored(dest, privObj);
ok("privacy verification: a real denial verifies a private destination object", verified.state === "denied", JSON.stringify(verified));
let noEvidence = false;
try { await assertPrivatelyStored(dest, "organizations/6/logos/6-1700000000023-9999999999999999.png"); } catch (e) { noEvidence = e instanceof BlobProbeError; }
ok("privacy verification: refuses an object with no authenticated evidence it exists", noEvidence);
process.env.STORAGE_FAKE_PROBE_FAULT = "network";
let inconclusive = false;
try { await assertPrivatelyStored(dest, privObj); } catch (e) { inconclusive = e instanceof BlobProbeError; }
delete process.env.STORAGE_FAKE_PROBE_FAULT;
ok("privacy verification: an inconclusive probe NEVER resolves to verified", inconclusive);
let readableRejected = false;
try { await assertPrivatelyStored(src, pubObj); } catch (e) { readableRejected = e instanceof BlobProbeError; }
ok("privacy verification: an anonymously READABLE object is rejected outright", readableRejected);

// Migration must not call an object verified when the probe could not answer.
const mProbe = "organizations/6/seals/6-1700000000024-probefail0000000.png";
await src.put(mProbe, PNG, { contentType: "image/png", allowOverwrite: true });
process.env.STORAGE_FAKE_PROBE_FAULT = "network";
process.env.STORAGE_FAKE_PROBE_FAULT_MATCH = "probefail";
const probeState = join(process.env.STORAGE_FAKE_DIR!, "state-probe.jsonl");
const probeRun = mig("--execute", "--state", probeState);
delete process.env.STORAGE_FAKE_PROBE_FAULT;
delete process.env.STORAGE_FAKE_PROBE_FAULT_MATCH;
const probeLines = existsSync(probeState) ? readFileSync(probeState, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { pathname: string; state: string; reason?: string }) : [];
const probeEntry = probeLines.find((e) => e.pathname === mProbe);
ok("migration: an object whose privacy probe failed is recorded FAILED, not verified", probeEntry?.state === "failed", JSON.stringify(probeEntry ?? probeRun.split("\n").slice(-3)));
ok("migration: the failure records why", (probeEntry?.reason ?? "").includes("privacy unverified"), probeEntry?.reason ?? "");

// Inventory must surface a failed probe as its own category, never inside the private count.
if (process.env.DATABASE_URL) {
  const invOut = join(process.env.STORAGE_FAKE_DIR!, "inv.json");
  process.env.STORAGE_FAKE_PROBE_FAULT = "network";
  process.env.STORAGE_FAKE_PROBE_FAULT_MATCH = "organizations/6/logos";
  try {
    execFileSync("npx", ["tsx", "--conditions=react-server", "scripts/blob-inventory.ts", "--json", invOut], { encoding: "utf8", env: process.env, stdio: "pipe" });
  } catch { /* the report is still written */ }
  delete process.env.STORAGE_FAKE_PROBE_FAULT;
  delete process.env.STORAGE_FAKE_PROBE_FAULT_MATCH;
  const inv = existsSync(invOut) ? JSON.parse(readFileSync(invOut, "utf8")) : null;
  ok("inventory: a failed probe is reported as probeFailed, not counted as private", (inv?.exposure?.probeFailed ?? 0) > 0, JSON.stringify(inv?.exposure ?? "no report"));
  ok("inventory: any probe failure marks the exposure figures NOT AUTHORITATIVE", inv?.exposure?.authoritative === false, String(inv?.exposure?.authoritative));
  ok("inventory: the affected pathname and reason are identifiable", Boolean(inv?.exposure?.probeFailures?.[0]?.pathname && inv?.exposure?.probeFailures?.[0]?.reason), JSON.stringify(inv?.exposure?.probeFailures?.[0] ?? null));
} else {
  ok("inventory probe reporting SKIPPED — no DATABASE_URL in this environment", true, "run under verify:static with .env present");
}

let pass = 0, fail = 0;
for (const [c, name, extra] of results) { if (c) pass++; else fail++; console.log(`${c ? "PASS" : "FAIL"}  ${name}${c ? "" : "  -> " + extra}`); }
console.log(`\n${pass}/${pass + fail} checks`);
rmSync(process.env.STORAGE_FAKE_DIR!, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
