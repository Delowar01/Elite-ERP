/**
 * Safety tests for the real-provider harness itself.
 *
 * THESE ARE NOT REAL-PROVIDER ACCEPTANCE EVIDENCE. They prove the harness refuses to run against
 * the wrong resources, redacts what it prints, records what it creates, and deletes only what it
 * recorded. Running the harness against real disposable stores is a separate act that produces
 * separate evidence; Batch 3 stays REAL PROVIDER VERIFICATION PENDING until that happens.
 *
 * Worth testing precisely because the harness is the one component that holds live read-write
 * credentials for two stores and a database: its guards are the only thing standing between a
 * mistyped variable and writing to production.
 */
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const results: [boolean, string, string][] = [];
const ok = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);

const { ARMING_VALUE, armOrRefuse, ArmingError, storeIdFromToken, dbIdentity } = await import("./provider-harness/guards.mjs");
const { redact, redactDeep } = await import("./provider-harness/redact.mjs");

// Plausible-looking but entirely fictional credentials. Nothing here addresses a real store.
const PRIVATE_TOKEN = "vercel_blob_rw_PRIVSTORE001_aaaaaaaaaaaaaaaaaaaaaaaa";
const PUBLIC_TOKEN = "vercel_blob_rw_PUBSTORE002_bbbbbbbbbbbbbbbbbbbbbbbb";
const DB_URL = "postgresql://tester:sup3rs3cr3tpw@disposable.example.invalid:5432/batch3_test";

const GOOD = {
  BATCH3_PROVIDER_TEST: ARMING_VALUE,
  BATCH3_PREVIEW_BASE_URL: "https://preview-batch3.example.invalid",
  BATCH3_EXPECT_COMMIT_SHA: "0".repeat(40),
  BATCH3_EXPECT_PRIVATE_STORE_ID: "PRIVSTORE001",
  BATCH3_EXPECT_PUBLIC_STORE_ID: "PUBSTORE002",
  BATCH3_EXPECT_DB_HOST: "disposable.example.invalid",
  BATCH3_EXPECT_DB_NAME: "batch3_test",
  BATCH3_KNOWN_PRODUCTION_HOST: "erp.example.invalid",
  BATCH3_PREVIEW_DATABASE_VERIFIED_DISPOSABLE: "YES",
  BATCH3_PREVIEW_PRIVATE_STORE_VERIFIED_DISPOSABLE: "YES",
  BATCH3_PREVIEW_PUBLIC_STORE_VERIFIED_DISPOSABLE: "YES",
  BATCH3_PREVIEW_SHA_VERIFIED_EXTERNALLY: "YES",
  BATCH3_SIGNING_SECRET_MATCHES_PREVIEW: "YES",
  BLOB_READ_WRITE_TOKEN: PRIVATE_TOKEN,
  BLOB_PUBLIC_SOURCE_READ_WRITE_TOKEN: PUBLIC_TOKEN,
  DATABASE_URL: DB_URL,
};

function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  const all = { ...GOOD, ...overrides };
  for (const k of new Set([...Object.keys(GOOD), ...Object.keys(overrides), "STORAGE_DRIVER", "VERCEL_ENV"])) {
    saved[k] = process.env[k];
    const v = (all as Record<string, string | undefined>)[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

const refuses = (overrides: Record<string, string | undefined>) =>
  withEnv(overrides, () => { try { armOrRefuse(); return { refused: false, why: "" }; } catch (e) { return { refused: e instanceof ArmingError, why: e instanceof Error ? e.message : String(e) }; } });

// ---- arming and identity guards. All of these run BEFORE anything is written: armOrRefuse()
// performs no I/O at all, which is the structural reason a refusal cannot come too late.
ok("a correctly armed configuration is accepted", withEnv({}, () => { try { armOrRefuse(); return true; } catch { return false; } }));
ok("a missing arming flag refuses", refuses({ BATCH3_PROVIDER_TEST: undefined }).refused);
ok("a nearly-right arming value refuses", refuses({ BATCH3_PROVIDER_TEST: "YES" }).refused);
ok("VERCEL_ENV=production refuses", refuses({ VERCEL_ENV: "production" }).refused);
ok("the fake storage driver refuses — it would produce worthless provider evidence", refuses({ STORAGE_DRIVER: "fake" }).refused);
const wrongPriv = refuses({ BATCH3_EXPECT_PRIVATE_STORE_ID: "SOMEOTHERSTORE" });
ok("a private token addressing an undeclared store refuses", wrongPriv.refused, wrongPriv.why.slice(0, 80));
ok("a public token addressing an undeclared store refuses", refuses({ BATCH3_EXPECT_PUBLIC_STORE_ID: "SOMEOTHERSTORE" }).refused);
const sameStore = refuses({ BLOB_PUBLIC_SOURCE_READ_WRITE_TOKEN: PRIVATE_TOKEN, BATCH3_EXPECT_PUBLIC_STORE_ID: "PRIVSTORE001" });
ok("two tokens addressing the SAME store refuses", sameStore.refused, sameStore.why.slice(0, 80));
ok("a wrong database host refuses", refuses({ BATCH3_EXPECT_DB_HOST: "prod.example.invalid" }).refused);
ok("a wrong database name refuses", refuses({ BATCH3_EXPECT_DB_NAME: "elite_erp_production" }).refused);
ok("a missing external SHA attestation refuses", refuses({ BATCH3_PREVIEW_SHA_VERIFIED_EXTERNALLY: undefined }).refused);
// Without this the signed-access section would fail for a configuration reason and be read as an
// application defect.
ok("a missing signing-secret attestation refuses", refuses({ BATCH3_SIGNING_SECRET_MATCHES_PREVIEW: undefined }).refused);
// The Preview deployment runs every browser action with ITS OWN environment. Nothing reachable from
// here can read those values — and asking for them would mean copying production secrets into this
// environment — so the operator inspects them and attests, and the report says so.
const dbAtt = refuses({ BATCH3_PREVIEW_DATABASE_VERIFIED_DISPOSABLE: undefined });
ok("a missing Preview DATABASE attestation refuses", dbAtt.refused, dbAtt.why.split("\n")[0].slice(0, 70));
ok("a missing Preview PRIVATE-store attestation refuses", refuses({ BATCH3_PREVIEW_PRIVATE_STORE_VERIFIED_DISPOSABLE: undefined }).refused);
ok("a missing Preview PUBLIC-store attestation refuses", refuses({ BATCH3_PREVIEW_PUBLIC_STORE_VERIFIED_DISPOSABLE: undefined }).refused);
ok("a nearly-right Preview attestation value refuses", refuses({ BATCH3_PREVIEW_DATABASE_VERIFIED_DISPOSABLE: "yes please" }).refused);
ok("all three Preview attestations present allows the good configuration through", withEnv({}, () => { try { armOrRefuse(); return true; } catch { return false; } }));
ok("the refusal names the variable and what it means, without asking for any secret value",
   dbAtt.why.includes("BATCH3_PREVIEW_DATABASE_VERIFIED_DISPOSABLE") && dbAtt.why.includes("Do not copy the Preview's secret values"), "");
ok("the identities record the Preview-environment attestation for the report",
   withEnv({}, () => armOrRefuse().previewEnvironmentAttested) === true);
// The production-host declaration is MANDATORY: disposable tokens protect this process, but every
// browser action runs inside the deployment at BATCH3_PREVIEW_BASE_URL using ITS environment.
ok("a MISSING production-host declaration refuses", refuses({ BATCH3_KNOWN_PRODUCTION_HOST: undefined }).refused);
ok("an empty production-host declaration refuses", refuses({ BATCH3_KNOWN_PRODUCTION_HOST: "   " }).refused);
ok("a Preview URL whose host EQUALS the production host refuses",
   refuses({ BATCH3_KNOWN_PRODUCTION_HOST: "preview-batch3.example.invalid" }).refused);
ok("the production host matches after normalization (scheme, port, trailing dot, case)",
   refuses({ BATCH3_KNOWN_PRODUCTION_HOST: "HTTPS://Preview-Batch3.example.invalid.:443/" }).refused);
ok("one match in a LIST of production domains is enough to refuse",
   refuses({ BATCH3_KNOWN_PRODUCTION_HOST: "erp.example.invalid, preview-batch3.example.invalid; www.erp.example.invalid" }).refused);
// Substring matching would be both too weak and too strong; these two prove it is not used.
ok("a production host that is only a SUBSTRING of the Preview host does not refuse",
   !refuses({ BATCH3_KNOWN_PRODUCTION_HOST: "batch3.example.invalid" }).refused, "preview-batch3.example.invalid merely contains it");
ok("a Preview host that CONTAINS the production host as a prefix does not refuse",
   !refuses({ BATCH3_PREVIEW_BASE_URL: "https://preview-batch3.example.invalid.attacker.test", BATCH3_KNOWN_PRODUCTION_HOST: "preview-batch3.example.invalid" }).refused);
ok("a plain distinct production host is accepted", !refuses({ BATCH3_KNOWN_PRODUCTION_HOST: "erp.example.invalid" }).refused);
ok("a non-HTTPS Preview URL refuses", refuses({ BATCH3_PREVIEW_BASE_URL: "http://preview-batch3.example.invalid" }).refused);
ok("an unparseable Preview URL refuses", refuses({ BATCH3_PREVIEW_BASE_URL: "not a url" }).refused);
ok("store id is derived from the token's 4th segment", storeIdFromToken(PRIVATE_TOKEN, "x") === "PRIVSTORE001");
ok("database identity is parsed without touching the password", dbIdentity(DB_URL).host === "disposable.example.invalid" && dbIdentity(DB_URL).name === "batch3_test" && dbIdentity(DB_URL).user === "tester");

// ---- redaction
withEnv({}, () => {
  const leaky = `token=${PRIVATE_TOKEN} db=${DB_URL} auth: Bearer abc.def.ghi cookie: session=zzz`;
  const clean = redact(leaky);
  ok("redaction removes a blob token", !clean.includes(PRIVATE_TOKEN), clean.slice(0, 60));
  ok("redaction removes the database URL and its password", !clean.includes("sup3rs3cr3tpw") && !clean.includes(DB_URL));
  ok("redaction removes Authorization and cookie material", !clean.includes("abc.def.ghi") && !clean.includes("session=zzz"), clean.slice(0, 120));
  const err = new Error(`boom while using ${PRIVATE_TOKEN}`);
  ok("redaction applies to Error objects and their stacks", !redact(err).includes(PRIVATE_TOKEN));
  const deep = redactDeep({ a: { b: [`x ${PRIVATE_TOKEN}`, { c: DB_URL }] } });
  ok("deep redaction reaches nested structures", !JSON.stringify(deep).includes(PRIVATE_TOKEN) && !JSON.stringify(deep).includes("sup3rs3cr3tpw"));
});

// ---- verdict logic. The previous version could never return A, because every approved
// fault-injection omission was counted as a mandatory gap — which made the gate unwinnable.
{
  const f = (over: Partial<{ passed: boolean | null; requiredForVerdict: boolean }>) =>
    ({ section: "x", name: "y", classification: "REAL PROVIDER PROVEN" as const, passed: true, requiredForVerdict: true, detail: "", ...over });
  const { computeVerdict } = await import("./provider-harness/manifest.mjs");
  ok("all mandatory pass, no omissions → A", computeVerdict([f({}), f({})]).verdict.startsWith("A"));
  ok("all mandatory pass + APPROVED optional omission → A", computeVerdict([f({}), f({ passed: null, requiredForVerdict: false })]).verdict.startsWith("A"),
     computeVerdict([f({}), f({ passed: null, requiredForVerdict: false })]).verdict);
  ok("a MANDATORY omission → B", computeVerdict([f({}), f({ passed: null })]).verdict.startsWith("B"));
  ok("a mandatory failure → C", computeVerdict([f({ passed: false })]).verdict.startsWith("C"));
  // Policy, stated and tested: an optional check may be SKIPPED but may never CONTRADICT the design.
  ok("an OPTIONAL check that FAILED → C, not A", computeVerdict([f({}), f({ passed: false, requiredForVerdict: false })]).verdict.startsWith("C"));
  ok("a provider security defect (mandatory false) → C", computeVerdict([f({ passed: false, classification: "REAL PROVIDER PROVEN" } as never)]).verdict.startsWith("C"));
  ok("the verdict explains itself", computeVerdict([f({}), f({ passed: null, requiredForVerdict: false })]).reason.includes("fault-injection"));
}

// ---- §22 post-deletion public URL, fail-closed. The shape being guarded against is
// `catch { return "gone" }`: an unreachable provider becoming proof that the object is gone.
{
  const { classifyPostDeletionPublicUrl } = await import("./provider-harness/deletion.mjs");
  const base = { baseline: "readable" as const, authenticatedAbsence: true };
  const denied = classifyPostDeletionPublicUrl({ ...base, probe: { kind: "answered", state: "denied", status: 403 } });
  ok("§22: readable before, denied after, authenticated absence → PROVEN", denied.passed === true && denied.classification === "REAL PROVIDER PROVEN", denied.detail);
  ok("§22: readable before, not_found after → PROVEN", classifyPostDeletionPublicUrl({ ...base, probe: { kind: "answered", state: "not_found", status: 404 } }).passed === true);
  ok("§22: still readable after deletion → FAILURE, never a pass", classifyPostDeletionPublicUrl({ ...base, probe: { kind: "answered", state: "readable", status: 200 } }).passed === false);
  const unreachable = classifyPostDeletionPublicUrl({ ...base, probe: { kind: "unreachable", error: new Error("ECONNRESET") } });
  ok("§22: an UNREACHABLE provider is INCONCLUSIVE — an exception is never evidence of deletion",
     unreachable.passed === null && unreachable.classification === "NOT RUN / NOT PROVEN", `${unreachable.passed} ${unreachable.detail}`);
  ok("§22: the inconclusive detail says the provider did not answer", unreachable.detail.includes("did not answer"), unreachable.detail);
  ok("§22: an unreachable provider's error is redacted through the supplied redactor",
     classifyPostDeletionPublicUrl({ ...base, probe: { kind: "unreachable", error: new Error(`boom ${PRIVATE_TOKEN}`) }, redactError: redact }).detail.includes(PRIVATE_TOKEN) === false);
  const neverReadable = classifyPostDeletionPublicUrl({ baseline: "denied", authenticatedAbsence: true, probe: { kind: "answered", state: "denied", status: 403 } });
  ok("§22: a URL that was NEVER anonymously readable proves nothing about the delete", neverReadable.passed === null, neverReadable.detail);
  const stillThere = classifyPostDeletionPublicUrl({ baseline: "readable", authenticatedAbsence: false, probe: { kind: "answered", state: "denied", status: 403 } });
  ok("§22: without authenticated absence the public-URL question is moot, not passed", stillThere.passed === null, stillThere.detail);
}

// ---- manifest lifecycle and cleanup ownership, against the fake stores
const dir = mkdtempSync(join(tmpdir(), "harness-"));
process.env.STORAGE_DRIVER = "fake";
process.env.STORAGE_FAKE_SOURCE = "1";
process.env.STORAGE_FAKE_DIR = join(dir, "store");
const cwd = process.cwd();
process.chdir(dir);

const { Run, runDir, loadManifest } = await import("./provider-harness/manifest.mjs");
type Manifest = ReturnType<typeof loadManifest>;
const { cleanupManifestObjects, cleanupTestOrgs } = await import("./provider-harness/cleanup.mjs");
const { destinationStore, sourceStore } = await import("../src/lib/storage/blob-client");
const dest = destinationStore();
const src = sourceStore()!;

const run = new Run("selftest", "0".repeat(40), { previewBaseUrl: "https://preview.example.invalid", note: `token was ${PRIVATE_TOKEN}` });
const BYTES = Buffer.from("harness-object");
const OTHER = Buffer.from("somebody-elses-object");
const P = (n: string) => `organizations/1/logos/1-1700000000000-${n.repeat(16).slice(0, 16)}.png`;

// (a) created -> owned -> deleted
const created = P("1");
const eCreated = run.planObject("private-destination", created, "created", BYTES);
await dest.put(created, BYTES, { contentType: "image/png" });
run.markObjectCreated(eCreated);

// (b) planned but never created, and something ELSE is sitting at that pathname
const plannedOther = P("2");
const ePlannedOther = run.planObject("private-destination", plannedOther, "planned, never created", BYTES);
await dest.put(plannedOther, OTHER, { contentType: "image/png" });

// (c) ambiguous write that DID commit: the bytes match what the run intended
const ambiguousMatch = P("3");
const eAmbMatch = run.planObject("private-destination", ambiguousMatch, "ambiguous write, bytes match", BYTES);
await dest.put(ambiguousMatch, BYTES, { contentType: "image/png" });
run.markObjectCreateFailed(eAmbMatch, new Error("socket hang up"));

// (d) ambiguous write where something different is present
const ambiguousDiff = P("4");
const eAmbDiff = run.planObject("private-destination", ambiguousDiff, "ambiguous write, bytes differ", BYTES);
await dest.put(ambiguousDiff, OTHER, { contentType: "image/png" });
run.markObjectCreateFailed(eAmbDiff, new Error("socket hang up"));

// (e) never recorded at all — stands in for anything already in the store
const unlisted = P("5");
await dest.put(unlisted, OTHER, { contentType: "image/png" });

ok("the manifest distinguishes planned from created", eCreated.state === "created" && ePlannedOther.state === "planned" && eAmbMatch.state === "create-failed",
   `${eCreated.state}/${ePlannedOther.state}/${eAmbMatch.state}`);
ok("a planned entry records the sha256 the run INTENDED to write", ePlannedOther.sha256 === run.manifest.objects[0].sha256);

const saved = loadManifest("selftest");
const cleanup = await cleanupManifestObjects(saved, { destination: dest, source: src });
ok("cleanup deletes an object the run created", (await dest.head(created)) === null, `deleted=${cleanup.deleted}`);
ok("a PLANNED-only pathname holding somebody else's bytes is NOT deleted", (await dest.head(plannedOther)) !== null, "this is the case that would destroy pre-existing data");
ok("an ambiguous write whose bytes MATCH is recognised as ours and cleaned", (await dest.head(ambiguousMatch)) === null);
ok("an ambiguous write whose bytes DIFFER is never deleted", (await dest.head(ambiguousDiff)) !== null);
ok("an object never recorded at all survives cleanup", (await dest.head(unlisted)) !== null);
ok("not-owned entries are reported rather than silently skipped", cleanup.skippedNotOwned === 2, `skipped=${cleanup.skippedNotOwned}`);
ok("cleanup verifies each deletion rather than assuming it", saved.objects[0].cleanupStatus === "verified-gone", saved.objects[0].cleanupStatus);

const again = await cleanupManifestObjects(saved, { destination: dest, source: src });
ok("cleanup is resumable — a second pass deletes nothing new and reports no failure", again.failed === 0 && again.deleted === 0, JSON.stringify({ d: again.deleted, f: again.failed }));

// (f) overwrite is refused by the store itself, which is what makes the collision rule enforceable
let collided = false;
try { await dest.put(unlisted, BYTES, { contentType: "image/png" }); } catch { collided = true; }
ok("writing an occupied pathname is refused (no blind overwrite)", collided);
ok("the pre-existing object survived the refused overwrite", (await dest.get(unlisted))?.bytes.toString() === OTHER.toString());

// ---- a successfully CREATED object whose bytes were replaced afterwards. The write proved the run
// owned the pathname at that moment; it proves nothing about what is there now.
{
  const replaced = P("9");
  const mine = Buffer.from("bytes-this-run-actually-wrote!!!");
  const theirs = Buffer.from("SOMEONE-REPLACED-THESE-BYTES!!!!");
  const e = run.planObject("private-destination", replaced, "created, then overwritten by someone else", mine);
  await dest.put(replaced, mine, { contentType: "image/png" });
  run.markObjectCreated(e);
  ok("the object is recorded created", e.state === "created");

  // Same size, different content: a length check would not notice.
  await dest.del(replaced);
  await dest.put(replaced, theirs, { contentType: "image/png" });
  ok("the replacement is the same size as the recorded bytes", theirs.length === mine.length);

  const r = await cleanupManifestObjects({ ...loadManifest("selftest"), objects: [e] }, { destination: dest, source: src });
  ok("a CREATED object whose current bytes differ is NOT deleted", (await dest.get(replaced))?.bytes.toString() === theirs.toString(), JSON.stringify(r.log));
  ok("the replaced object is reported skipped-not-owned, not silently ignored", r.skippedNotOwned === 1 && r.deleted === 0, JSON.stringify({ s: r.skippedNotOwned, d: r.deleted }));
  ok("its manifest entry says the bytes are not this run's", (e.cleanupNote ?? "").includes("not the ones this run intended"), e.cleanupNote ?? "");
}

// ---- seeding: the harness must never overwrite an object it did not write
{
  const { seedObject, SeedCollisionError } = await import("./provider-harness/seed.mjs");
  const free = P("6");
  const e = await seedObject(run, dest, "private-destination", free, BYTES, "seed: free pathname");
  ok("seed writes to a free pathname and marks it created", e.state === "created" && (await dest.get(free))?.bytes.toString() === BYTES.toString(), e.state);

  const taken = P("7");
  await dest.put(taken, OTHER, { contentType: "image/png" });
  let refusedWith: unknown = null;
  try { await seedObject(run, dest, "private-destination", taken, BYTES, "seed: occupied pathname"); } catch (err) { refusedWith = err; }
  ok("seed REFUSES an occupied pathname instead of overwriting", refusedWith instanceof SeedCollisionError, String(refusedWith));
  ok("the occupying bytes are untouched after a refused seed", (await dest.get(taken))?.bytes.toString() === OTHER.toString());
  const collisionEntry = run.manifest.objects.find((o) => o.pathname === taken)!;
  ok("a refused seed is recorded as create-failed, so cleanup must prove ownership before deleting it",
     collisionEntry.state === "create-failed", collisionEntry.state);
  const afterRefusal = await cleanupManifestObjects({ ...loadManifest("selftest"), objects: [collisionEntry] }, { destination: dest, source: src });
  ok("cleanup does NOT delete the pathname a refused seed touched", (await dest.head(taken)) !== null && afterRefusal.skippedNotOwned === 1, JSON.stringify(afterRefusal.log));

  // The head() check above is check-then-write and therefore has a window. The guarantee that
  // survives that window is the provider's own refusal, so it is tested separately: an object
  // appears AFTER the pathname is seen free. allowOverwrite:true would destroy it silently.
  const raced = P("8");
  process.env.STORAGE_FAKE_RACE_CREATE = raced;
  let racedError: unknown = null;
  try { await seedObject(run, dest, "private-destination", raced, BYTES, "seed: object created during the write window"); } catch (err) { racedError = err; }
  delete process.env.STORAGE_FAKE_RACE_CREATE;
  ok("an object appearing AFTER the free-pathname check is still not overwritten", racedError !== null, String(racedError));
  ok("the raced-in bytes survive — the no-overwrite guarantee is the provider's, not the head() check",
     (await dest.get(raced))?.bytes.toString() === "raced-in-by-somebody-else", (await dest.get(raced))?.bytes.toString().slice(0, 40) ?? "absent");
  const racedEntry = run.manifest.objects.find((o) => o.pathname === raced)!;
  ok("a raced write is recorded create-failed and cleanup leaves the other party's object alone",
     racedEntry.state === "create-failed" &&
     (await cleanupManifestObjects({ ...loadManifest("selftest"), objects: [racedEntry] }, { destination: dest, source: src })).skippedNotOwned === 1 &&
     (await dest.head(raced)) !== null);
}

// ---- prefix reservations: storeBlob() chooses its own pathname, so the run reserves the prefix
// and the intended bytes. Ownership is still earned by bytes; the prefix is never a delete scope.
{
  const PREFIX = "organizations/77/logos/";
  const MINE = Buffer.from("bytes-the-application-wrote!!!!!");
  // Same LENGTH as MINE, different bytes: a size pre-filter alone must not be mistaken for proof.
  const THEIRS = Buffer.from("SOMEBODY-ELSES-BYTES-ENTIRELY!!!");
  await dest.put(`${PREFIX}77-1700000000000-aaaaaaaaaaaaaaaa.png`, THEIRS, { contentType: "image/png" });

  // (i) the application returned a pathname — the reservation becomes a concrete created object
  const resolvedEntry = run.planPrefixWrite("private-destination", PREFIX, "reservation, resolved", MINE);
  ok("a prefix reservation starts with NO pathname and confers no ownership", resolvedEntry.pathname === "" && resolvedEntry.state === "planned");
  const chosen = `${PREFIX}77-1700000000001-bbbbbbbbbbbbbbbb.png`;
  await dest.put(chosen, MINE, { contentType: "image/png" });
  run.resolvePlannedPathname(resolvedEntry, chosen);
  ok("resolving a reservation records the application's pathname", loadManifest("selftest").objects.some((o) => o.pathname === chosen && o.state === "created"));

  // (ii) the process died before the pathname came back, but the write DID land
  const lostEntry = run.planPrefixWrite("private-destination", PREFIX, "reservation, pathname lost to a crash", MINE);
  const landed = `${PREFIX}77-1700000000002-cccccccccccccccc.png`;
  await dest.put(landed, MINE, { contentType: "image/png" });

  // (iii) reserved, but the write never happened at all
  const unusedEntry = run.planPrefixWrite("private-destination", PREFIX, "reservation, never written", Buffer.from("never-written-bytes"));

  const r = await cleanupManifestObjects({ ...loadManifest("selftest"), objects: [resolvedEntry, lostEntry, unusedEntry] }, { destination: dest, source: src });
  ok("a resolved reservation is deleted", (await dest.head(chosen)) === null, JSON.stringify(r.log));
  ok("an unresolved reservation whose bytes DID land is found by matching sha256 and deleted", (await dest.head(landed)) === null, JSON.stringify(r.log));
  ok("the recovered pathname is written back into the manifest rather than left blank", lostEntry.pathname === landed, lostEntry.pathname);
  ok("a reservation that was never written reports absent, not failure", r.failed === 0 && r.alreadyGone === 1, JSON.stringify({ f: r.failed, a: r.alreadyGone }));
  ok("a pre-existing object under the SAME prefix is never deleted — the prefix is not a delete scope",
     (await dest.get(`${PREFIX}77-1700000000000-aaaaaaaaaaaaaaaa.png`))?.bytes.toString() === THEIRS.toString());
  ok("a same-SIZE object under the prefix is still not claimed — the hash decides, not the length",
     (await dest.get(`${PREFIX}77-1700000000000-aaaaaaaaaaaaaaaa.png`))?.bytes.length === MINE.length);

  // A reservation whose prefix is missing has no way to resolve itself. That is an open question,
  // not a resolved one, and must never be reported as cleaned.
  const prefixless = { ...run.planPrefixWrite("private-destination", PREFIX, "reservation with no prefix recorded", MINE), prefix: undefined };
  const pr = await cleanupManifestObjects({ ...loadManifest("selftest"), objects: [prefixless] }, { destination: dest, source: src });
  ok("a reservation with no prefix recorded is INCONCLUSIVE, never 'already gone'",
     pr.inconclusive === 1 && pr.alreadyGone === 0 && prefixless.cleanupStatus === "inconclusive", JSON.stringify({ i: pr.inconclusive, a: pr.alreadyGone, s: prefixless.cleanupStatus }));
}

// ---- registration locator, recorded before any registration happens
const orgEntry = run.planTestOrg("batch3-A-selftest@example.invalid", "disposable org A");
ok("a test organization is recorded by EMAIL before registration, with no org id yet", orgEntry.orgId === null && loadManifest("selftest").testOrgs[0].email === "batch3-A-selftest@example.invalid");
run.resolveTestOrg(orgEntry, 4242);
ok("the org id is filled in once registration resolves it", loadManifest("selftest").testOrgs[0].orgId === 4242);

// ---- database cleanup: ordering, dependency-correct verification, and failure surfacing
{
  type Row = Record<string, unknown>;
  const EMAIL = "batch3-A-selftest@example.invalid";
  type Behaviour = {
    userDeleted?: boolean;
    orgDeleted?: boolean;
    leftover?: string;          // an org-scoped table that still holds rows
    orphanChild?: string;       // a CHILD table whose captured ids survive the cascade
    failVerifyFor?: string;     // a table whose verification query throws
  };
  const mkDb = (behaviour: Behaviour) => {
    let userGone = false, orgGone = false;
    const seen: string[] = [];
    // Child ids the fixtures "created", returned by the pre-delete capture join.
    const CHILD_IDS: Record<string, number[]> = { quotation_items: [11, 12], sales_invoice_items: [21, 22, 23] };
    return {
      seen,
      async query(sql: string, params: unknown[] = []): Promise<{ rows: Row[] }> {
        seen.push(sql);
        const table = /from "([a-z_]+)"/.exec(sql)?.[1];
        // A verification query that FAILS must never be turned into "0 leftovers".
        if (behaviour.failVerifyFor && table === behaviour.failVerifyFor && /count\(\*\)/.test(sql)) {
          throw new Error(`relation "${table}" does not exist`);
        }
        if (/^select org_id from users/.test(sql)) return { rows: [{ org_id: 4242 }] };
        // Pre-delete capture: child ids reached THROUGH the parent, while the parent still exists.
        if (/^select c\.id from/.test(sql)) return { rows: (CHILD_IDS[table ?? ""] ?? []).map((id) => ({ id })) };
        if (/^delete from users/.test(sql)) { userGone = behaviour.userDeleted !== false && /email=\$1/.test(sql) && params[0] === EMAIL; return { rows: [] }; }
        if (/^delete from orgs/.test(sql)) { orgGone = behaviour.orgDeleted !== false && /id=\$1/.test(sql) && params[0] === 4242; return { rows: [] }; }
        if (/count\(\*\)::int as c from orgs/.test(sql)) return { rows: [{ c: orgGone ? 0 : 1 }] };
        if (/count\(\*\)::int as c from users/.test(sql)) return { rows: [{ c: userGone ? 0 : 1 }] };
        // Post-delete child verification, BY ID and with no join — an orphan must still be visible.
        if (/where id = any/.test(sql)) return { rows: [{ c: behaviour.orphanChild === table ? 1 : 0 }] };
        if (/where org_id/.test(sql)) return { rows: [{ c: behaviour.leftover === table ? 3 : 0 }] };
        return { rows: [{ c: 0 }] };
      },
    };
  };
  const fresh = (): Manifest => ({ ...loadManifest("selftest"), testOrgs: [{ email: EMAIL, orgId: 4242, purpose: "x", cleanupStatus: "pending" }] });

  const goodDb = mkDb({});
  const goodManifest = fresh();
  const good = await cleanupTestOrgs(goodManifest, goodDb);
  ok("db cleanup: a clean run removes the org and reports no failure", good.removed === 1 && good.failed === 0, JSON.stringify(good.log));
  ok("db cleanup: the user is deleted by its exact recorded address, passed as a parameter",
     goodDb.seen.some((q) => /^delete from users where email=\$1$/.test(q.trim())), JSON.stringify(goodDb.seen.filter((q) => q.startsWith("delete"))));
  ok("db cleanup: no statement uses LIKE or any other pattern sweep",
     !goodDb.seen.some((q) => /\blike\b/i.test(q)), JSON.stringify(goodDb.seen.filter((q) => /\blike\b/i.test(q))));

  // Child fixture rows have no org_id of their own. They are captured through the parent BEFORE the
  // delete and verified by id AFTER it — a post-delete join would find nothing precisely when an
  // orphan exists, because the parent it would join to is the row that was removed.
  const captureIdx = goodDb.seen.findIndex((q) => /^select c\.id from/.test(q));
  const deleteIdx = goodDb.seen.findIndex((q) => /^delete from orgs/.test(q));
  ok("db cleanup: child fixture ids are captured BEFORE the org is deleted", captureIdx >= 0 && captureIdx < deleteIdx, `capture@${captureIdx} delete@${deleteIdx}`);
  ok("db cleanup: the captured ids are persisted in the manifest",
     (goodManifest.testOrgs[0].childFixtureIds?.quotation_items ?? []).join(",") === "11,12",
     JSON.stringify(goodManifest.testOrgs[0].childFixtureIds));
  // Captured ids are worthless if a crash can lose them: after the delete the parent is gone, so
  // there is no second chance to find those rows. They must reach the manifest before the delete.
  {
    const persistDb = mkDb({});
    const persistManifest = fresh();
    let persistedAfterNQueries = -1;
    await cleanupTestOrgs(persistManifest, persistDb, (m) => {
      if (persistedAfterNQueries < 0 && m.testOrgs[0].childFixtureIds) persistedAfterNQueries = persistDb.seen.length;
    });
    const firstDelete = persistDb.seen.findIndex((q) => /^delete from/.test(q));
    ok("db cleanup: the captured ids are PERSISTED before the first delete, not after it",
       persistedAfterNQueries >= 0 && persistedAfterNQueries <= firstDelete,
       `persisted after ${persistedAfterNQueries} queries, first delete at ${firstDelete}`);
  }
  ok("db cleanup: child verification queries by id, with no join to the vanished parent",
     goodDb.seen.some((q) => /where id = any/.test(q) && !/join/.test(q)), "");
  ok("db cleanup: the child fixture table with the non-obvious FK is reached (invoice_id, not sales_invoice_id)",
     goodDb.seen.some((q) => /^select c\.id from "sales_invoice_items"/.test(q) && /c\."invoice_id" = p\.id/.test(q)),
     JSON.stringify(goodDb.seen.filter((q) => q.includes("sales_invoice_items"))));

  const orgLeft = await cleanupTestOrgs(fresh(), mkDb({ orgDeleted: false }));
  ok("db cleanup: user removed but ORG remains → failure", orgLeft.failed === 1, JSON.stringify(orgLeft.log));
  const userLeft = await cleanupTestOrgs(fresh(), mkDb({ userDeleted: false }));
  ok("db cleanup: org removed but USER remains → failure", userLeft.failed === 1, JSON.stringify(userLeft.log));
  const fixtureLeft = await cleanupTestOrgs(fresh(), mkDb({ leftover: "customers" }));
  ok("db cleanup: a leftover org-scoped row → failure (the cascade is verified, not assumed)", fixtureLeft.failed === 1, JSON.stringify(fixtureLeft.log));

  // The sentinel: a child row the cascade failed to remove. It has no org_id and its parent is gone,
  // so only the by-id check can see it.
  const orphanManifest = fresh();
  const orphan = await cleanupTestOrgs(orphanManifest, mkDb({ orphanChild: "sales_invoice_items" }));
  ok("db cleanup: an ORPHANED child row the cascade missed → failure", orphan.failed === 1 && orphan.removed === 0, JSON.stringify(orphan.log));
  ok("db cleanup: the orphan is named in the note, by table and by id count",
     (orphanManifest.testOrgs[0].cleanupNote ?? "").includes("sales_invoice_items=1 of 3"), orphanManifest.testOrgs[0].cleanupNote ?? "");

  // A verification query that THREW has verified nothing. The old code caught it and read it as
  // "0 leftovers", so eight tables reported themselves clean without ever being looked at.
  const brokenManifest = fresh();
  const broken = await cleanupTestOrgs(brokenManifest, mkDb({ failVerifyFor: "customers" }));
  ok("db cleanup: a FAILED verification query is a failure, never zero leftovers",
     broken.failed === 1 && broken.removed === 0, JSON.stringify(broken.log));
  ok("db cleanup: the failed org is marked cleanup-failed with the reason", brokenManifest.testOrgs[0].cleanupStatus === "cleanup-failed" && (brokenManifest.testOrgs[0].cleanupNote ?? "").includes("does not exist"), brokenManifest.testOrgs[0].cleanupNote ?? "");
  const brokenChild = await cleanupTestOrgs(fresh(), mkDb({ failVerifyFor: "quotation_items" }));
  ok("db cleanup: a failed CHILD verification query is a failure too", brokenChild.failed === 1, JSON.stringify(brokenChild.log));

  const noUser: Manifest = { ...loadManifest("selftest"), testOrgs: [{ email: "gone@example.invalid", orgId: null, purpose: "x", cleanupStatus: "pending" }] };
  const resolved = await cleanupTestOrgs(noUser, { async query(sql: string) { return /^select org_id/.test(sql) ? { rows: [] } : { rows: [{ c: 0 }] }; } });
  ok("db cleanup: an org id lost to a crash is re-resolved from the recorded email", resolved.failed === 0 && resolved.log[0].includes("no such test user"), JSON.stringify(resolved.log));
}

// ---- exit codes. A gate that exits 0 on INCONCLUSIVE tells every caller that reads only the
// status that the run passed.
{
  const { exitCodeForVerdict, EXIT_CODES } = await import("./provider-harness/manifest.mjs");
  ok("exit code: A → 0", exitCodeForVerdict("A — REAL PROVIDER VERIFICATION PASSED") === 0);
  ok("exit code: B → non-zero", exitCodeForVerdict("B — INCONCLUSIVE") === EXIT_CODES.B && Number(EXIT_CODES.B) !== 0);
  ok("exit code: C → non-zero", exitCodeForVerdict("C — FAILED") === 1);
  ok("exit code: an unrecognised verdict is never treated as a pass", exitCodeForVerdict("everything seems fine") !== 0);
  const f = (over: Partial<{ passed: boolean | null; requiredForVerdict: boolean }>) =>
    ({ section: "x", name: "y", classification: "REAL PROVIDER PROVEN" as const, passed: true, requiredForVerdict: true, detail: "", ...over });
  const { computeVerdict } = await import("./provider-harness/manifest.mjs");
  const codeOf = (findings: ReturnType<typeof f>[]) => exitCodeForVerdict(computeVerdict(findings).verdict);
  ok("exit code: all mandatory pass + approved optional omission → 0", codeOf([f({}), f({ passed: null, requiredForVerdict: false })]) === 0);
  ok("exit code: a mandatory omission → non-zero", codeOf([f({}), f({ passed: null })]) !== 0);
  ok("exit code: a mandatory failure → non-zero", codeOf([f({ passed: false })]) !== 0);
  ok("exit code: an OPTIONAL failure → non-zero", codeOf([f({}), f({ passed: false, requiredForVerdict: false })]) !== 0);
}

// The report is what outlives the run. A guard that refused at arming time proves nothing to a
// reader months later unless what it required travels with the results — and the three claims the
// harness CANNOT derive must be labelled as claims, not quietly folded in among measured facts.
const attested = new Run("selftest-report", "0".repeat(40), {
  previewBaseUrl: "https://preview-batch3.example.invalid",
  previewHost: "preview-batch3.example.invalid",
  declaredProductionHosts: "erp.example.invalid, www.erp.example.invalid",
  dbHost: "disposable.example.invalid",
  dbName: "batch3_test",
  previewShaProof: "PREVIEW_SHA_VERIFIED_EXTERNALLY — OPERATOR ATTESTATION, not automatically verified",
  previewEnvironmentProof: "the Preview deployment's own database, private destination store and public source store were each confirmed disposable — OPERATOR ATTESTATION, not automatically verified",
  signingSecretProof: "the local AUTH_SECRET matches the Preview's — OPERATOR ATTESTATION, not automatically verified",
});
attested.record("selftest", "example", "REAL PROVIDER PROVEN", true, `token ${PRIVATE_TOKEN} db ${DB_URL}`);
attested.writeReport("A — REAL PROVIDER VERIFICATION PASSED (self-test)", ["note"]);
{
  const j = readFileSync(join(runDir("selftest-report"), "report.json"), "utf8");
  const m = readFileSync(join(runDir("selftest-report"), "report.md"), "utf8");
  const both = (needle: string) => j.includes(needle) && m.includes(needle);
  ok("report: the Preview disposable-environment attestation is recorded in BOTH files", both("confirmed disposable"), "");
  ok("report: the signing-secret attestation is recorded", both("AUTH_SECRET matches the Preview"), "");
  ok("report: the Preview SHA attestation is recorded", both("PREVIEW_SHA_VERIFIED_EXTERNALLY"), "");
  ok("report: each of the three is labelled OPERATOR ATTESTATION, not a verified fact",
     (j.match(/OPERATOR ATTESTATION, not automatically verified/g) ?? []).length === 3, String((j.match(/OPERATOR ATTESTATION/g) ?? []).length));
  ok("report: the declared production hostnames are recorded", both("erp.example.invalid"), "");
  ok("report: the production hostnames are plain hostnames, carrying no credential",
     !/erp\.example\.invalid[^,\s"]*[:@]/.test(j), "");
  // The attestations are prose ABOUT secrets; none of the secrets themselves may ride along.
  for (const [what, secret] of [["blob token", PRIVATE_TOKEN], ["public token", PUBLIC_TOKEN], ["db password", "sup3rs3cr3tpw"], ["database URL", DB_URL]] as const) {
    ok(`report: no ${what} appears in report.json or report.md`, !j.includes(secret) && !m.includes(secret), "");
  }
  ok("report: the manifest for an attested run carries no secret either",
     !readFileSync(join(runDir("selftest-report"), "manifest.json"), "utf8").includes(PRIVATE_TOKEN), "");
}

// The report writer persists whatever identities it is given; these assert the HARNESS actually
// hands it all three attestations. Without this, dropping one from the live run would change
// nothing any test could see.
{
  const harnessSrc = readFileSync(join(cwd, "verify", "verify-real-blob-provider.mts"), "utf8");
  const identityBlock = harnessSrc.slice(harnessSrc.indexOf("const run = new Run("), harnessSrc.indexOf("say(`\\nrun id:"));
  for (const field of ["previewShaProof", "previewEnvironmentProof", "signingSecretProof", "declaredProductionHosts"]) {
    ok(`the live run hands ${field} to the report`, identityBlock.includes(`${field}:`), "");
  }
  ok("the live run's attestations are worded as attestations", (identityBlock.match(/OPERATOR ATTESTATION/g) ?? []).length === 3,
     String((identityBlock.match(/OPERATOR ATTESTATION/g) ?? []).length));
}

run.record("selftest", "example finding", "APPLICATION-LEVEL TEST PROVEN", true, `detail mentioning ${PRIVATE_TOKEN}`);
run.writeReport("B — INCONCLUSIVE (self-test)", [`note mentioning ${DB_URL}`]);
const reportJson = readFileSync(join(runDir("selftest"), "report.json"), "utf8");
const reportMd = readFileSync(join(runDir("selftest"), "report.md"), "utf8");
ok("report.json contains no secret value", !reportJson.includes(PRIVATE_TOKEN) && !reportJson.includes("sup3rs3cr3tpw"), "");
ok("report.md contains no secret value", !reportMd.includes(PRIVATE_TOKEN) && !reportMd.includes("sup3rs3cr3tpw"), "");
ok("the report keeps classifications separate rather than summing them", reportMd.includes("REAL PROVIDER PROVEN: 0") && reportMd.includes("APPLICATION-LEVEL TEST PROVEN: 1"), "");
ok("the report separates mandatory omissions from approved fault-injection ones", reportMd.includes("NOT RUN — MANDATORY") && reportMd.includes("approved fault injection"), "");
ok("the report marks each finding as required or not", reportMd.includes("| Required |"), "");
ok("both report files were written", existsSync(join(runDir("selftest"), "report.json")) && existsSync(join(runDir("selftest"), "report.md")));
ok("the manifest file itself carries no secret", !readFileSync(join(runDir("selftest"), "manifest.json"), "utf8").includes(PRIVATE_TOKEN));

process.chdir(cwd);
rmSync(dir, { recursive: true, force: true });

let pass = 0, fail = 0;
for (const [c, name, extra] of results) { if (c) pass++; else fail++; console.log(`${c ? "PASS" : "FAIL"}  ${name}${c ? "" : "  -> " + extra}`); }
console.log(`\n${pass}/${pass + fail} checks`);
process.exit(fail ? 1 : 0);
