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
  BATCH3_PREVIEW_SHA_VERIFIED_EXTERNALLY: "YES",
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
ok("a preview URL matching a known production host refuses", refuses({ BATCH3_KNOWN_PRODUCTION_HOST: "preview-batch3.example.invalid" }).refused);
ok("a missing external SHA attestation refuses", refuses({ BATCH3_PREVIEW_SHA_VERIFIED_EXTERNALLY: undefined }).refused);
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

// ---- manifest and cleanup, against the fake stores
const dir = mkdtempSync(join(tmpdir(), "harness-"));
process.env.STORAGE_DRIVER = "fake";
process.env.STORAGE_FAKE_SOURCE = "1";
process.env.STORAGE_FAKE_DIR = join(dir, "store");
const cwd = process.cwd();
process.chdir(dir);

const { Run, runDir, loadManifest } = await import("./provider-harness/manifest.mjs");
const { cleanupManifestObjects } = await import("./provider-harness/cleanup.mjs");
const { destinationStore, sourceStore } = await import("../src/lib/storage/blob-client");
const dest = destinationStore();
const src = sourceStore()!;

const run = new Run("selftest", "0".repeat(40), { previewBaseUrl: "https://preview.example.invalid", note: `token was ${PRIVATE_TOKEN}` });
const BYTES = Buffer.from("harness-object");
const listed = "organizations/1/logos/1-1700000000000-1111111111111111.png";
const unlisted = "organizations/1/logos/1-1700000000000-2222222222222222.png";
run.willCreate("private-destination", listed, "selftest: recorded object", BYTES);
await dest.put(listed, BYTES, { contentType: "image/png" });
// Deliberately NOT recorded — it stands in for anything already in the store that this run did not
// create, which cleanup must never touch.
await dest.put(unlisted, BYTES, { contentType: "image/png" });

const saved = loadManifest("selftest");
ok("the manifest records exactly what was created, with sha256 and size", saved.objects.length === 1 && saved.objects[0].pathname === listed && saved.objects[0].size === BYTES.length, JSON.stringify(saved.objects.map((o) => o.pathname)));
ok("the manifest file itself carries no secret", !readFileSync(join(runDir("selftest"), "manifest.json"), "utf8").includes(PRIVATE_TOKEN));

const cleanup = await cleanupManifestObjects(saved, { destination: dest, source: src });
ok("cleanup deletes the manifest object", (await dest.head(listed)) === null, `deleted=${cleanup.deleted}`);
ok("an object NOT in the manifest survives cleanup", (await dest.head(unlisted)) !== null, "the unrecorded object must be left alone");
ok("cleanup verifies each deletion rather than assuming it", saved.objects[0].cleanupStatus === "verified-gone", saved.objects[0].cleanupStatus);

// A second pass models resuming after a partial run: already-gone entries are idempotent.
const again = await cleanupManifestObjects(saved, { destination: dest, source: src });
ok("cleanup is resumable — a second pass is idempotent and reports nothing failed", again.failed === 0 && again.deleted === 0 && again.alreadyGone === 1, JSON.stringify(again));

run.record("selftest", "example finding", "APPLICATION-LEVEL TEST PROVEN", true, `detail mentioning ${PRIVATE_TOKEN}`);
run.writeReport("B — INCONCLUSIVE (self-test)", [`note mentioning ${DB_URL}`]);
const reportJson = readFileSync(join(runDir("selftest"), "report.json"), "utf8");
const reportMd = readFileSync(join(runDir("selftest"), "report.md"), "utf8");
ok("report.json contains no secret value", !reportJson.includes(PRIVATE_TOKEN) && !reportJson.includes("sup3rs3cr3tpw"), "");
ok("report.md contains no secret value", !reportMd.includes(PRIVATE_TOKEN) && !reportMd.includes("sup3rs3cr3tpw"), "");
ok("the report keeps classifications separate rather than summing them", reportMd.includes("REAL PROVIDER PROVEN: 0") && reportMd.includes("APPLICATION-LEVEL TEST PROVEN: 1"), "");
ok("both report files were written", existsSync(join(runDir("selftest"), "report.json")) && existsSync(join(runDir("selftest"), "report.md")));

process.chdir(cwd);
rmSync(dir, { recursive: true, force: true });

let pass = 0, fail = 0;
for (const [c, name, extra] of results) { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${name}${c ? "" : "  -> " + extra}`); }
console.log(`\n${pass}/${pass + fail} checks`);
process.exit(fail ? 1 : 0);
