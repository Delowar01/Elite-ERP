/**
 * Batch 3 — REAL PROVIDER VERIFICATION HARNESS.
 *
 *   npm run verify:blob-provider
 *
 * Runs the real-provider acceptance matrix against DISPOSABLE resources: a disposable PRIVATE Blob
 * store, a disposable PUBLIC Blob store, a disposable database, and a Preview deployment of this
 * branch. It CONSUMES those resources; it never provisions, deletes or reconfigures them, and it
 * never deploys or promotes anything. That keeps the blast radius to objects and rows it created
 * itself and recorded in a manifest.
 *
 * It adds NO test-only route, no auth bypass, no debug endpoint and no hardcoded credential. Every
 * application assertion goes through the same /uploads/[...path] route and the same server actions a
 * real user would.
 *
 * Every guard in guards.mts runs BEFORE the first write. Every line of output passes through
 * redact.mts. Cleanup is a separate command and deletes only what the manifest records.
 *
 * THE HARNESS IS NOT EVIDENCE. Running it produces evidence; existing in the repository does not.
 * Until an operator runs it against real disposable stores, Batch 3 remains
 * REAL PROVIDER VERIFICATION PENDING.
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { armOrRefuse, printSafetySummary, reportArmingFailure, type Identities } from "./provider-harness/guards.mjs";
import { installRedactedCrashHandler, redact, say } from "./provider-harness/redact.mjs";
import { Run, runDir, sha256 } from "./provider-harness/manifest.mjs";
import { pickCountry } from "./register-org.mjs";

installRedactedCrashHandler();

let identities: Identities;
try {
  identities = armOrRefuse();
} catch (e) {
  reportArmingFailure(e);
}
printSafetySummary(identities);

const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
const run = new Run(runId, identities.expectedCommitSha, {
  previewBaseUrl: identities.previewBaseUrl,
  privateStoreId: identities.privateStoreId,
  publicStoreId: identities.publicStoreId,
  dbHost: identities.dbHost,
  dbName: identities.dbName,
  previewShaProof: "PREVIEW_SHA_VERIFIED_EXTERNALLY (operator attestation)",
});
say(`\nrun id: ${runId}\nmanifest: ${join(runDir(runId), "manifest.json")}\n`);

const notes: string[] = [];
const BASE = identities.previewBaseUrl.replace(/\/+$/, "");
const pass = "Qx7#vLm2$Rt9wZp4";

const { destinationStore, sourceStore, assertPrivatelyStored } = await import("../src/lib/storage/blob-client");
const { storeBlob, readBlob, deleteStoredBlob, pathnameFromStored, BLOB_FOLDERS } = await import("../src/lib/storage/blob-storage");
const { signFileUrl } = await import("../src/lib/security/signed-url");

const dest = destinationStore();
const src = sourceStore();
if (!src) reportArmingFailure(new Error("sourceStore() is null — BLOB_PUBLIC_SOURCE_READ_WRITE_TOKEN did not resolve"));

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const one = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd4000000004945", "hex");
const PDF = Buffer.from("255044462d312e340a25e2e3cfd30a312030206f626a0a3c3c2f547970652f436174616c6f673e3e0a656e646f626a0a", "hex");
const appPath = (orgId: number, folder: string, ext = "png") => `organizations/${orgId}/${folder}/${orgId}-${Date.now()}-${randomBytes(8).toString("hex")}.${ext}`;

/** Write through a store, recording it in the manifest FIRST so cleanup can never miss it. */
async function seed(store: typeof dest, role: "public-source" | "private-destination", pathname: string, bytes: Buffer, purpose: string, contentType = "image/png") {
  run.willCreate(role, pathname, purpose, bytes);
  await store.put(pathname, bytes, { contentType, allowOverwrite: true });
}

// ─── §9 PROVIDER LEVEL ────────────────────────────────────────────────────────────────────────
// The only part that tests Vercel rather than this application. It uses the URL the SDK RETURNS,
// never a hand-built host: a manufactured URL that 404s proves the URL was wrong, not that the
// object is private.
say("\n§9 provider level");
{
  const { put, head } = await import("@vercel/blob");
  const pubPath = `batch3-verification/${runId}/public-probe.png`;
  run.willCreate("public-source", pubPath, "provider-level: public store must be anonymously readable", PNG);
  const pubPut = await put(pubPath, PNG, { access: "public", addRandomSuffix: false, contentType: "image/png", token: process.env.BLOB_PUBLIC_SOURCE_READ_WRITE_TOKEN });
  const pubRes = await fetch(pubPut.url, { cache: "no-store" });
  const pubBytes = Buffer.from(await pubRes.arrayBuffer());
  run.record("§9", "public store: anonymous GET of the SDK-returned URL succeeds", "REAL PROVIDER PROVEN",
    pubRes.status === 200 && sha256(pubBytes) === sha256(PNG), `status=${pubRes.status} sha=${sha256(pubBytes).slice(0, 12)} expected=${sha256(PNG).slice(0, 12)}`);

  const privPath = `batch3-verification/${runId}/private-probe.png`;
  run.willCreate("private-destination", privPath, "provider-level: private store must refuse anonymous access", PNG);
  const privPut = await put(privPath, PNG, { access: "private", addRandomSuffix: false, contentType: "image/png", token: process.env.BLOB_READ_WRITE_TOKEN });
  const privHead = await head(privPath, { token: process.env.BLOB_READ_WRITE_TOKEN });
  run.record("§9", "private store: authenticated access proves the object exists", "REAL PROVIDER PROVEN",
    privHead.size === PNG.length && privHead.pathname === privPath, `size=${privHead.size} pathname=${privHead.pathname}`);

  // Only now is the anonymous result meaningful: a 404 from a provider that we have just proven
  // holds this exact object is a refusal, not an absence.
  let anonStatus: number | string;
  try {
    const r = await fetch(privPut.url, { cache: "no-store", redirect: "manual" });
    anonStatus = r.status;
    const denied = r.status === 401 || r.status === 403 || r.status === 404;
    if (r.status >= 200 && r.status < 300) {
      run.record("§9", "private store: anonymous GET of the SDK-returned URL is refused", "REAL PROVIDER PROVEN", false, `SECURITY DEFECT: status=${r.status} — the object was served to an anonymous caller`);
    } else if (denied) {
      run.record("§9", "private store: anonymous GET of the SDK-returned URL is refused", "REAL PROVIDER PROVEN", true, `status=${r.status} (authenticated existence already established)`);
    } else {
      run.record("§9", "private store: anonymous GET of the SDK-returned URL is refused", "NOT RUN / NOT PROVEN", null, `INCONCLUSIVE: status=${r.status} is neither an answer nor a refusal`);
    }
  } catch (e) {
    anonStatus = "transport failure";
    run.record("§9", "private store: anonymous GET of the SDK-returned URL is refused", "NOT RUN / NOT PROVEN", null, `INCONCLUSIVE: ${redact(e)}`);
  }
  say(`  (private anonymous status recorded: ${anonStatus})`);
}

// ─── §10 DISPOSABLE ORGS ──────────────────────────────────────────────────────────────────────
// Registered through the real /register flow, so the sessions are genuine and no bypass user is
// inserted. The alternative — seeding rows directly — would not produce a real session cookie and
// would make every authorization result meaningless.
say("\n§10 disposable test organizations");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
async function registerOrg(label: string) {
  const email = `batch3-${label}-${runId}@example.invalid`;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/register`);
  await page.fill('input[name="orgName"]', `Batch3 Test Org ${label}`);
  await page.fill('input[name="name"]', "Owner");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', pass);
  const cf = page.locator('input[name="confirmPassword"]');
  if (await cf.count()) await cf.fill(pass);
  await pickCountry(page);
  await page.getByRole("button", { name: /register|create|sign up/i }).first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 60000 });
  const cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  const orgId = Number((await one("select org_id from users where email=$1", [email])).org_id);
  run.willCreateDbRow("orgs", `id=${orgId}`, `disposable test org ${label}`);
  run.willCreateDbRow("users", `email=${email}`, `disposable test owner for org ${label}`);
  return { orgId, cookie, email, page };
}
const A = await registerOrg("A");
const B = await registerOrg("B");
run.record("§10", "two disposable organizations registered through the real flow", "REAL PREVIEW APPLICATION PROVEN", A.orgId !== B.orgId, `orgA=${A.orgId} orgB=${B.orgId}`);

const get = (path: string, opts: { cookie?: string; query?: string } = {}) =>
  fetch(`${BASE}${path}${opts.query ?? ""}`, { headers: opts.cookie ? { cookie: opts.cookie } : {}, redirect: "manual" });

// ─── §11 NINE FOLDERS ─────────────────────────────────────────────────────────────────────────
say("\n§11 nine-folder matrix");
const stored: Record<string, string> = {};
for (const folder of BLOB_FOLDERS) {
  const isPdf = folder === "attachments";
  const bytes = isPdf ? PDF : PNG;
  const before = await dest.list({ prefix: `organizations/${A.orgId}/${folder}/`, limit: 1000 });
  const url = await storeBlob(A.orgId, folder, bytes, isPdf ? "pdf" : "png", isPdf ? "application/pdf" : "image/png");
  const pathname = pathnameFromStored(url);
  run.willCreate("private-destination", pathname, `§11 ${folder} round-trip`, bytes);
  stored[folder] = url;
  void before;

  const inDest = await dest.head(pathname);
  const inSrc = await src!.head(pathname);
  const res = await get(url, { cookie: A.cookie });
  const body = res.status === 200 ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
  const audited = Number((await one("select count(*)::int c from file_access_logs where org_id=$1 and folder=$2", [A.orgId, folder])).c) > 0;
  const ok = Boolean(inDest) && inSrc === null && res.status === 200 && sha256(body) === sha256(bytes)
    && res.headers.get("content-type") === (isPdf ? "application/pdf" : "image/png")
    && (res.headers.get("content-disposition") ?? "") === (isPdf ? "attachment" : "inline") && audited;
  run.record("§11", `${folder}: private-only write, authorized read, exact bytes, headers, audit`, "REAL PREVIEW APPLICATION PROVEN", ok,
    `dest=${Boolean(inDest)} srcCopy=${inSrc !== null} status=${res.status} type=${res.headers.get("content-type")} disp=${res.headers.get("content-disposition")} audited=${audited}`);
}

// ─── §12 TENANT ISOLATION ─────────────────────────────────────────────────────────────────────
say("\n§12 tenant isolation");
{
  const url = stored.logos;
  const file = pathnameFromStored(url).split("/").pop()!;
  const cases: [string, string, string | undefined, boolean][] = [
    ["Org A session", url, A.cookie, true],
    ["no session", url, undefined, false],
    ["Org B session", url, B.cookie, false],
    ["wrong org in path", `/uploads/organizations/${B.orgId}/logos/${file}`, A.cookie, false],
    ["malformed filename", `/uploads/organizations/${A.orgId}/logos/not-a-generated-name.png`, A.cookie, false],
    ["unsupported folder", `/uploads/organizations/${A.orgId}/secrets/${file}`, A.cookie, false],
    ["pdf outside attachments", `/uploads/organizations/${A.orgId}/logos/${A.orgId}-1700000000000-0123456789abcdef.pdf`, A.cookie, false],
  ];
  for (const [label, path, cookie, expectOk] of cases) {
    const r = await get(path, { cookie });
    run.record("§12", `${label} → ${expectOk ? "PASS" : "DENIED"}`, "REAL PREVIEW APPLICATION PROVEN", expectOk ? r.status === 200 : r.status !== 200, `status=${r.status}`);
  }
}

// ─── §13 DESTINATION WINS ─────────────────────────────────────────────────────────────────────
say("\n§13 destination wins over a public decoy");
{
  const p = appPath(A.orgId, "logos");
  const decoy = Buffer.from("PUBLIC-DECOY-BYTES");
  const correct = Buffer.from("PRIVATE-CORRECT-BYTES");
  await seed(src!, "public-source", p, decoy, "§13 public decoy");
  await seed(dest, "private-destination", p, correct, "§13 private correct");
  const r = await get(`/uploads/${p}`, { cookie: A.cookie });
  const body = Buffer.from(await r.arrayBuffer());
  run.record("§13", "the private destination wins when both stores hold the pathname", "REAL PREVIEW APPLICATION PROVEN",
    r.status === 200 && body.toString() === "PRIVATE-CORRECT-BYTES", `status=${r.status} sha=${sha256(body).slice(0, 12)} body=${body.toString().slice(0, 24)}`);
}

// ─── §14 LEGACY PUBLIC FALLBACK ───────────────────────────────────────────────────────────────
say("\n§14 legacy public-source fallback");
{
  const p = appPath(A.orgId, "logos");
  const legacy = Buffer.from("LEGACY-PUBLIC-BYTES");
  await seed(src!, "public-source", p, legacy, "§14 legacy object, source only");
  const absent = (await dest.head(p)) === null;
  const r = await get(`/uploads/${p}`, { cookie: A.cookie });
  const body = r.status === 200 ? Buffer.from(await r.arrayBuffer()) : Buffer.alloc(0);
  const leaks = (r.headers.get("location") ?? "").includes("blob.vercel-storage.com");
  const crossTenant = await get(`/uploads/${p}`, { cookie: B.cookie });
  run.record("§14", "an unmigrated object loads from the public source through the app route", "REAL PREVIEW APPLICATION PROVEN",
    absent && r.status === 200 && body.toString() === "LEGACY-PUBLIC-BYTES" && !leaks,
    `destAbsent=${absent} status=${r.status} redirectToProvider=${leaks}`);
  run.record("§14", "the fallback is still tenant-scoped", "REAL PREVIEW APPLICATION PROVEN", crossTenant.status !== 200, `orgB status=${crossTenant.status}`);
}

// ─── §15 DESTINATION FAILURE ──────────────────────────────────────────────────────────────────
// Deliberately NOT manufactured. Producing a genuine destination auth failure means handing the
// application a broken credential, and there is no way to do that here without risking a real token
// in an env var, a log line or a crash dump. The application-side proof is load-bearing and stands.
run.record("§15", "destination read failure must not fall back to the public source", "NOT RUN / NOT PROVEN", null,
  "NOT RUN LIVE — safe provider failure injection unavailable; covered by the load-bearing 42-check store-model suite");
notes.push("§15 destination-failure injection was not manufactured live: doing so safely would require supplying a deliberately broken credential. Application-level mutation evidence retained (store-model suite, 42 checks).");

// ─── §16 SIGNED ACCESS ────────────────────────────────────────────────────────────────────────
say("\n§16 signed branding access");
{
  const brandingUrl = stored.logos;
  const p = pathnameFromStored(brandingUrl);
  const q = (u: string) => u.slice(u.indexOf("?"));
  const valid = signFileUrl(p, 60);
  const rValid = await get(`/uploads/${p}`, { query: q(valid) });
  run.record("§16", "a valid unexpired signature serves the file with no session", "REAL PREVIEW APPLICATION PROVEN", rValid.status === 200, `status=${rValid.status}`);
  const cc = rValid.headers.get("cache-control") ?? "";
  const maxAge = Number(/max-age=(\d+)/.exec(cc)?.[1] ?? -1);
  run.record("§16", "a signed response's cache lifetime never exceeds the signature's", "REAL PREVIEW APPLICATION PROVEN", maxAge >= 0 && maxAge <= 60, `${cc} (60s signature)`);
  const rSession = await get(`/uploads/${p}`, { cookie: A.cookie });
  run.record("§16", "a session response keeps the normal one-hour private cache", "REAL PREVIEW APPLICATION PROVEN",
    /max-age=3600/.test(rSession.headers.get("cache-control") ?? ""), String(rSession.headers.get("cache-control")));

  const expired = signFileUrl(p, -60);
  run.record("§16", "an expired signature is denied", "REAL PREVIEW APPLICATION PROVEN", (await get(`/uploads/${p}`, { query: q(expired) })).status !== 200);
  const sigVal = new URLSearchParams(q(valid)).get("sig")!;
  const corrupted = q(valid).replace(`sig=${sigVal}`, `sig=${(sigVal[0] === "A" ? "B" : "A") + sigVal.slice(1)}`);
  run.record("§16", "a corrupted signature is denied", "REAL PREVIEW APPLICATION PROVEN", (await get(`/uploads/${p}`, { query: corrupted })).status !== 200);
  const other = pathnameFromStored(stored.seals);
  run.record("§16", "a signature minted for a different pathname is denied", "REAL PREVIEW APPLICATION PROVEN",
    (await get(`/uploads/${p}`, { query: q(signFileUrl(other, 60)) })).status !== 200);

  for (const folder of ["attachments", "item-images", "layouts"]) {
    const fp = pathnameFromStored(stored[folder]);
    const r = await get(`/uploads/${fp}`, { query: q(signFileUrl(fp, 60)) });
    run.record("§16", `a signature does NOT authorize ${folder}`, "REAL PREVIEW APPLICATION PROVEN", r.status !== 200, `status=${r.status}`);
  }
}

// ─── §17 PDF MATRIX ───────────────────────────────────────────────────────────────────────────
// Reuses the Batch 3 PDF fixture and assertions rather than inventing a second, divergent one.
say("\n§17 PDF matrix with real private branding");
{
  await db.query("update orgs set logo_url=$1, seal_url=$2, signature_url=$3 where id=$4", [stored.logos, stored.seals, stored.signatures, A.orgId]);
  const { runPdfMatrix } = await import("./provider-harness/pdf-matrix.mjs");
  const pdf = await runPdfMatrix({ base: BASE, cookie: A.cookie, orgId: A.orgId, db, browser, seal: stored.seals, sig: stored.signatures });
  for (const f of pdf.findings) run.record("§17", f.name, "REAL PREVIEW APPLICATION PROVEN", f.passed, f.detail);
}

// ─── §18-§19 MIGRATION AND CONFLICT ───────────────────────────────────────────────────────────
say("\n§18 real cross-store migration");
const migrationPaths: string[] = [];
{
  const seeds: [string, Buffer, string][] = [
    [appPath(A.orgId, "logos"), PNG, "§18 branding object, source only"],
    [appPath(A.orgId, "attachments", "pdf"), PDF, "§18 attachment, source only"],
    [appPath(A.orgId, "item-images"), PNG, "§18 ordinary folder object, source only"],
  ];
  for (const [p, bytes, purpose] of seeds) {
    await seed(src!, "public-source", p, bytes, purpose, p.endsWith(".pdf") ? "application/pdf" : "image/png");
    migrationPaths.push(p);
    run.willCreate("private-destination", p, `${purpose} (migration destination copy)`, bytes);
  }

  const stateFile = join(runDir(runId), "migration-state.jsonl");
  const mig = (...args: string[]) => {
    try { return execFileSync("npx", ["tsx", "--conditions=react-server", "scripts/blob-migrate.ts", ...args], { encoding: "utf8", env: process.env }); }
    catch (e) { return String((e as { stdout?: string }).stdout ?? e); }
  };

  const dry = mig("--state", stateFile);
  const listedAll = migrationPaths.every((p) => dry.includes(p));
  run.record("§18", "dry run lists the objects, writes nothing, creates no state file", "REAL PREVIEW APPLICATION PROVEN",
    dry.includes("DRY RUN") && listedAll && !existsSync(stateFile), `listed=${listedAll} stateFile=${existsSync(stateFile)}`);

  mig("--execute", "--state", stateFile);
  const entries = existsSync(stateFile) ? readFileSync(stateFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { pathname: string; state: string; sha256?: string }) : [];
  for (const p of migrationPaths) {
    const e = entries.find((x) => x.pathname === p);
    const srcAfter = await src!.get(p);
    const destAfter = await dest.get(p);
    let privacy = "not checked";
    try { privacy = (await assertPrivatelyStored(dest, p)).state; } catch (err) { privacy = `INCONCLUSIVE: ${redact(err)}`; }
    const ok = e?.state === "verified" && Boolean(srcAfter) && Boolean(destAfter)
      && sha256(srcAfter!.bytes) === sha256(destAfter!.bytes) && srcAfter!.contentType === destAfter!.contentType
      && (privacy === "denied" || privacy === "not_found");
    run.record("§18", `${p.split("/").slice(2).join("/")}: copied, hashes equal, source preserved, destination refuses anonymous`, "REAL PREVIEW APPLICATION PROVEN", ok,
      `state=${e?.state} srcSha=${srcAfter ? sha256(srcAfter.bytes).slice(0, 12) : "gone"} destSha=${destAfter ? sha256(destAfter.bytes).slice(0, 12) : "absent"} privacy=${privacy}`);
  }
  const rerun = mig("--execute", "--state", stateFile);
  run.record("§18", "a rerun is idempotent — nothing pending", "REAL PREVIEW APPLICATION PROVEN", /0 pending/.test(rerun), rerun.split("\n").find((l) => l.includes("pending"))?.trim() ?? "");
}

say("\n§19 conflict");
{
  const p = appPath(A.orgId, "seals");
  const a = Buffer.from("SOURCE-BYTES-AAA");
  const b = Buffer.from("DESTINATION-BYTES-BBB");
  await seed(src!, "public-source", p, a, "§19 conflict source");
  await seed(dest, "private-destination", p, b, "§19 conflict destination (different bytes)");
  const stateFile = join(runDir(runId), "migration-conflict.jsonl");
  let exitCode = 0;
  let out = "";
  try { out = execFileSync("npx", ["tsx", "--conditions=react-server", "scripts/blob-migrate.ts", "--execute", "--state", stateFile], { encoding: "utf8", env: process.env }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); exitCode = 1; }
  const srcAfter = await src!.get(p);
  const destAfter = await dest.get(p);
  run.record("§19", "a differing destination is CONFLICT, exits non-zero, and neither store changes", "REAL PREVIEW APPLICATION PROVEN",
    out.includes("CONFLICT") && exitCode !== 0 && srcAfter?.bytes.toString() === "SOURCE-BYTES-AAA" && destAfter?.bytes.toString() === "DESTINATION-BYTES-BBB",
    `exit=${exitCode} srcIntact=${srcAfter?.bytes.toString() === "SOURCE-BYTES-AAA"} destIntact=${destAfter?.bytes.toString() === "DESTINATION-BYTES-BBB"}`);
}

// ─── §20 PROBE FAILURE ────────────────────────────────────────────────────────────────────────
run.record("§20", "probe failure yields failed / probeFailed / authoritative:false", "NOT RUN / NOT PROVEN", null,
  "NOT RUN LIVE — a genuine provider/network fault cannot be induced safely against a live store; load-bearing local mutation evidence retained");
notes.push("§20 probe-failure injection was not manufactured live. The local store-model suite proves migration records `failed` and inventory reports probeFailed with authoritative:false.");

// ─── §21 INVENTORY ────────────────────────────────────────────────────────────────────────────
say("\n§21 inventory");
{
  const orphan = appPath(A.orgId, "attachments", "pdf");
  await seed(src!, "public-source", orphan, PDF, "§21 unreferenced attachment orphan", "application/pdf");
  const invFile = join(runDir(runId), "inventory.json");
  try { execFileSync("npx", ["tsx", "--conditions=react-server", "scripts/blob-inventory.ts", "--json", invFile, "--hash"], { encoding: "utf8", env: process.env, stdio: "pipe" }); } catch { /* report still written */ }
  const inv = existsSync(invFile) ? JSON.parse(readFileSync(invFile, "utf8")) : null;
  run.record("§21", "inventory reports both stores and reconciliation categories", "REAL PREVIEW APPLICATION PROVEN",
    Boolean(inv?.stores?.publicSource?.present && inv?.stores?.privateDestination?.present && inv?.reconciliation),
    `publicOnly=${inv?.reconciliation?.publicOnly} privateOnly=${inv?.reconciliation?.privateOnly} inBoth=${inv?.reconciliation?.inBoth}`);
  run.record("§21", "exposure is split into readable / denied / probeFailed with an authoritative flag", "REAL PREVIEW APPLICATION PROVEN",
    typeof inv?.exposure?.publiclyReadable === "number" && typeof inv?.exposure?.anonymousDenied === "number" && typeof inv?.exposure?.probeFailed === "number" && typeof inv?.exposure?.authoritative === "boolean",
    JSON.stringify(inv?.exposure ? { r: inv.exposure.publiclyReadable, d: inv.exposure.anonymousDenied, f: inv.exposure.probeFailed, auth: inv.exposure.authoritative } : null));
  const orphanReported = (inv?.attachmentOrphans?.pathnames ?? []).includes(orphan);
  run.record("§21", "the unreferenced attachment is classified UNREFERENCED ATTACHMENT — PRESERVE / MANUAL REVIEW", "REAL PREVIEW APPLICATION PROVEN",
    orphanReported && inv?.attachmentOrphans?.classification === "UNREFERENCED ATTACHMENT — PRESERVE / MANUAL REVIEW", `reported=${orphanReported}`);
  run.record("§21", "the orphan still exists after inventory — nothing was deleted", "REAL PREVIEW APPLICATION PROVEN", (await src!.head(orphan)) !== null);
}

// ─── §22 DELETE MATRIX ────────────────────────────────────────────────────────────────────────
say("\n§22 delete matrix");
{
  const mk = async (where: ("public" | "private")[], purpose: string) => {
    const p = appPath(A.orgId, "client-logos");
    if (where.includes("public")) await seed(src!, "public-source", p, PNG, purpose);
    if (where.includes("private")) await seed(dest, "private-destination", p, PNG, purpose);
    return p;
  };
  const both = await mk(["public", "private"], "§22 delete: present in both");
  const publicUrl = src!.providerUrl(both);
  await deleteStoredBlob(`/uploads/${both}`);
  let stillReadable = true;
  try { const r = await fetch(publicUrl, { cache: "no-store" }); stillReadable = r.ok; } catch { stillReadable = false; }
  run.record("§22", "an object in both stores is removed from both", "REAL PREVIEW APPLICATION PROVEN",
    (await dest.head(both)) === null && (await src!.head(both)) === null, "");
  run.record("§22", "after a reported success the former public URL no longer serves the bytes", "REAL PROVIDER PROVEN", !stillReadable, `anonymous readable=${stillReadable}`);

  const srcOnly = await mk(["public"], "§22 delete: source only");
  await deleteStoredBlob(`/uploads/${srcOnly}`);
  run.record("§22", "a source-only object is removed", "REAL PREVIEW APPLICATION PROVEN", (await src!.head(srcOnly)) === null);

  const destOnly = await mk(["private"], "§22 delete: destination only");
  await deleteStoredBlob(`/uploads/${destOnly}`);
  run.record("§22", "a destination-only object is removed", "REAL PREVIEW APPLICATION PROVEN", (await dest.head(destOnly)) === null);

  let idempotent = true;
  try { await deleteStoredBlob(`/uploads/${appPath(A.orgId, "client-logos")}`); } catch { idempotent = false; }
  run.record("§22", "deleting an absent object is idempotent", "REAL PREVIEW APPLICATION PROVEN", idempotent);
  run.record("§22", "delete failure reporting (partial-failure path)", "NOT RUN / NOT PROVEN", null,
    "NOT RUN LIVE — safe provider failure injection unavailable; covered by the store-model suite's seven delete assertions");
}

// ─── verdict ──────────────────────────────────────────────────────────────────────────────────
const failed = run.findings.filter((f) => f.passed === false).length;
const notRun = run.findings.filter((f) => f.passed === null).length;
const verdict = failed > 0 ? "C — FAILED" : notRun > 0 ? "B — INCONCLUSIVE (mandatory items not run)" : "A — REAL PROVIDER VERIFICATION PASSED";
notes.push(`Cleanup has NOT run. Execute: npm run verify:blob-provider:cleanup -- --run-id ${runId}`);
run.writeReport(verdict, notes);
say(`\nVERDICT: ${verdict}`);
say(`objects recorded for cleanup: ${run.manifest.objects.length}; database rows: ${run.manifest.dbRows.length}`);
say(`CLEANUP IS A SEPARATE COMMAND and has not been run — evidence is preserved first.`);

await browser.close();
await db.end();
process.exit(failed > 0 ? 1 : 0);
