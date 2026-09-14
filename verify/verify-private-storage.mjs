/**
 * Private Blob storage: the write is private, and the application read path is the only way in.
 *
 * Every object is created by the REAL storeBlob() (via private-storage-writer.mts, which runs under
 * the react-server condition so the production module graph is the one exercised), then read back
 * over HTTP through the REAL /uploads/[...path] route on a running production build.
 *
 * WHAT THIS SUITE DOES NOT PROVE. It runs against the test storage driver, so the provider
 * assertions below show that THIS APPLICATION stores private and never falls back to an anonymous
 * URL read. Whether a real Vercel private object refuses an anonymous GET is provider behaviour:
 * REAL PROVIDER VERIFICATION PENDING, to be settled on a Preview deployment against a real store.
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { execFileSync } from "node:child_process";
import { signFileUrl } from "./sign-file-url.mjs";
import { existsIn, bytesIn, anonymousRead, listIn } from "./fake-probe.mjs";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";

const results = [];
const check = (name, cond, extra = "") => results.push([cond, name, extra]);

const BRANDING = new Set(["logos", "seals", "signatures", "client-logos", "vendor-logos", "employee-photos"]);
const SESSION_ONLY = new Set(["item-images", "attachments", "layouts"]);

// This suite drives the test storage driver. Run against the real Vercel Blob client it would
// either fail obscurely (no token here) or, worse, write to a real store. Refuse plainly instead.
if (process.env.STORAGE_DRIVER !== "fake") {
  console.error("STORAGE_DRIVER=fake is required for this suite (set it in .env). Refusing to run against real Vercel Blob.");
  process.exit(1);
}

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await assertFreshBuild(BASE);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });

async function registerOrg(label) {
  const email = `${label}${Date.now()}@example.com`;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/register`);
  await page.fill('input[name="orgName"]', `${label} Co`);
  await page.fill('input[name="name"]', "Owner");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', pass);
  const cf = page.locator('input[name="confirmPassword"]');
  if (await cf.count()) await cf.fill(pass);
  await pickCountry(page);
  await page.getByRole("button", { name: /register|create|sign up/i }).first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 30000 });
  const cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  const orgId = (await db.query("select org_id from users where email=$1", [email])).rows[0].org_id;
  return { orgId, cookie };
}

const A = await registerOrg("orga");
const B = await registerOrg("orgb");
check("two separate organizations exist for the isolation tests", A.orgId !== B.orgId, `${A.orgId} / ${B.orgId}`);

// ---- create one object per folder through the REAL storeBlob() ----
const writeFor = (orgId) =>
  JSON.parse(execFileSync("npx", ["tsx", "--env-file-if-exists=.env", "--conditions=react-server", "verify/private-storage-writer.mts", String(orgId)], { encoding: "utf8" }).trim().split("\n").pop());

const storedA = writeFor(A.orgId);
const storedB = writeFor(B.orgId);
const folders = Object.keys(storedA);
check("storeBlob produced an object for every declared folder", folders.length === 9, `${folders.length}: ${folders.join(",")}`);

const pathOf = (stored) => stored.replace(/^\/uploads\//, "");
const getRaw = (stored, { cookie, query = "" } = {}) =>
  fetch(`${BASE}${stored}${query}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });

// ---- per-folder matrix ----
let allPrivate = true, allAuthOk = true, allCrossDenied = true, allAnonDenied = true, allProviderDenied = true;
for (const folder of folders) {
  const stored = storedA[folder];
  const pathname = pathOf(stored);

  if (!existsIn("private", pathname)) { allPrivate = false; check(`${folder}: written to the PRIVATE destination store`, false, "absent from the private store"); }
  if (existsIn("public", pathname)) { allPrivate = false; check(`${folder}: no public copy was written`, false, "also present in the public store"); }

  const ok = await getRaw(stored, { cookie: A.cookie });
  const body = ok.status === 200 ? Buffer.from(await ok.arrayBuffer()) : Buffer.alloc(0);
  const expectPdf = folder === "attachments";
  const typeOk = ok.headers.get("content-type") === (expectPdf ? "application/pdf" : "image/png");
  const dispOk = (ok.headers.get("content-disposition") ?? "") === (expectPdf ? "attachment" : "inline");
  const bytesOk = body.length > 0 && (expectPdf ? body.subarray(0, 4).toString("latin1") === "%PDF" : body[1] === 0x50 && body[2] === 0x4e);
  if (!(ok.status === 200 && typeOk && dispOk && bytesOk)) {
    allAuthOk = false;
    check(`${folder}: owner read returns the right bytes and headers`, false, `status=${ok.status} type=${ok.headers.get("content-type")} disp=${ok.headers.get("content-disposition")} bytes=${body.length}`);
  }

  const cross = await getRaw(stored, { cookie: B.cookie });
  if (cross.status === 200) { allCrossDenied = false; check(`${folder}: cross-tenant read denied`, false, `status=${cross.status}`); }

  const anon = await getRaw(stored);
  if (anon.status === 200) { allAnonDenied = false; check(`${folder}: unauthenticated read denied`, false, `status=${anon.status}`); }

  if (anonymousRead("private", pathname) !== null) { allProviderDenied = false; check(`${folder}: the private store refuses an anonymous read`, false, "bytes returned"); }
}
check("all 9 folders: the upload went ONLY to the private destination store", allPrivate);
check("all 9 folders: the owning session reads the exact bytes, type and disposition", allAuthOk);
check("all 9 folders: a different organization's session is denied", allCrossDenied);
check("all 9 folders: no session is denied", allAnonDenied);
check("all 9 folders: an anonymous provider read returns nothing [application-side; REAL PROVIDER VERIFICATION PENDING]", allProviderDenied);

// ---- signed path (a preserved capability; nothing in the app mints these today) ----
let signedOk = true, signedExpired = true, signedTampered = true, signedBad = true, signedNonBranding = true;
for (const folder of folders) {
  const stored = storedA[folder];
  const pathname = pathOf(stored);
  const valid = signFileUrl(pathname, 600);
  const q = valid.slice(valid.indexOf("?"));
  const res = await getRaw(stored, { query: q });
  if (BRANDING.has(folder)) {
    if (res.status !== 200) { signedOk = false; check(`${folder}: valid signature serves the file`, false, `status=${res.status}`); }
    const exp = await getRaw(stored, { query: signFileUrl(pathname, -60).slice(signFileUrl(pathname, -60).indexOf("?")) });
    if (exp.status === 200) { signedExpired = false; check(`${folder}: expired signature denied`, false, ""); }
    const other = pathOf(storedA[folders.find((f) => f !== folder)]);
    const tampered = await getRaw(stored, { query: signFileUrl(other, 600).slice(signFileUrl(other, 600).indexOf("?")) });
    if (tampered.status === 200) { signedTampered = false; check(`${folder}: a signature minted for another path denied`, false, ""); }
    // Flip the first signature character to a DIFFERENT one. Replacing it with a constant "X" is a
    // no-op whenever the signature already starts with X — base64url contains it — so that version
    // passed on luck and failed roughly one run in eleven across six branding folders.
    const sigVal = new URLSearchParams(q).get("sig");
    const corrupted = (sigVal[0] === "A" ? "B" : "A") + sigVal.slice(1);
    const bad = await getRaw(stored, { query: q.replace(`sig=${sigVal}`, `sig=${corrupted}`) });
    if (bad.status === 200) { signedBad = false; check(`${folder}: corrupted signature denied`, false, ""); }
  } else if (SESSION_ONLY.has(folder) && res.status === 200) {
    signedNonBranding = false;
    check(`${folder}: a signature does NOT substitute for a session`, false, `status=${res.status}`);
  }
}
check("branding folders: a valid unexpired signature serves the file", signedOk);
check("branding folders: an expired signature is denied", signedExpired);
check("branding folders: a signature minted for a different path is denied", signedTampered);
check("branding folders: a corrupted signature is denied", signedBad);
check("item-images / attachments / layouts: a signature is NOT accepted in place of a session", signedNonBranding);

// ---- audit ----
const logged = (await db.query("select folder, count(*)::int as c from file_access_logs where org_id=$1 group by folder", [A.orgId])).rows;
check("every folder served wrote a file_access_logs row", logged.length === 9, JSON.stringify(logged.map((r) => r.folder).sort()));
const anonLogged = (await db.query("select count(*)::int as c from file_access_logs where org_id=$1 and user_id is null", [A.orgId])).rows[0].c;
check("a signed (sessionless) serve is audited with a null user", anonLogged > 0, String(anonLogged));

// ---- path substitution ----
const subs = [
  ["another org's id in the path", `/uploads/organizations/${B.orgId}/logos/${pathOf(storedA.logos).split("/").pop()}`],
  ["a folder outside the allowlist", `/uploads/organizations/${A.orgId}/secrets/${pathOf(storedA.logos).split("/").pop()}`],
  ["a hand-written filename", `/uploads/organizations/${A.orgId}/logos/anything.png`],
  ["a pdf outside attachments", `/uploads/organizations/${A.orgId}/logos/${A.orgId}-1789000000000-0123456789abcdef.pdf`],
  ["a short path", `/uploads/organizations/${A.orgId}/logos`],
];
let subsDenied = true;
for (const [label, p] of subs) {
  const r = await getRaw(p, { cookie: A.cookie });
  if (r.status === 200) { subsDenied = false; check(`path substitution refused: ${label}`, false, `status=${r.status}`); }
}
check("path substitution is refused in all five shapes", subsDenied);

// ---- signed responses must not outlive their signature in the browser cache ----
{
  const pathname = pathOf(storedA.logos);
  const short = signFileUrl(pathname, 60);
  const r = await getRaw(storedA.logos, { query: short.slice(short.indexOf("?")) });
  const cc = r.headers.get("cache-control") ?? "";
  const maxAge = Number(/max-age=(\d+)/.exec(cc)?.[1] ?? -1);
  check("a signed response caps max-age at the signature's remaining validity", r.status === 200 && maxAge >= 0 && maxAge <= 60, `${cc} (signature had 60s left)`);
  const sess = await getRaw(storedA.logos, { cookie: A.cookie });
  const sessMaxAge = Number(/max-age=(\d+)/.exec(sess.headers.get("cache-control") ?? "")?.[1] ?? -1);
  check("a session response is NOT penalised by that cap", sessMaxAge === 3600, String(sess.headers.get("cache-control")));
}

// ---- cache policy ----
const cacheRes = await getRaw(storedA.logos, { cookie: A.cookie });
check("served bytes are marked private and never shared-cacheable", (cacheRes.headers.get("cache-control") ?? "").startsWith("private,"), String(cacheRes.headers.get("cache-control")));
check("served bytes carry X-Content-Type-Options: nosniff", cacheRes.headers.get("x-content-type-options") === "nosniff", String(cacheRes.headers.get("x-content-type-options")));

// ---- the store holds nothing it should not ----
check("the public source store is empty — nothing new was ever written there", listIn("public").length === 0, JSON.stringify(listIn("public").slice(0, 5)));
check("every object the suite created is in the private store", listIn("private").length >= folders.length * 2, String(listIn("private").length));
const sample = pathOf(storedB["item-images"]);
check("bytes in the private store match what the route served", Boolean(bytesIn("private", sample)), sample);

console.log("");
let pass_ = 0, fail_ = 0;
for (const [ok, name, extra] of results) { ok ? pass_++ : fail_++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + extra}`); }
console.log(`\n${pass_}/${pass_ + fail_} checks`);
await browser.close();
await db.end();
process.exit(fail_ ? 1 : 0);
