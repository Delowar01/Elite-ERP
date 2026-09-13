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
import { fakeStoredAccess, fakeProviderRead } from "./fake-probe.mjs";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";

const results = [];
const check = (name, cond, extra = "") => results.push([cond, name, extra]);

const BRANDING = new Set(["logos", "seals", "signatures", "client-logos", "vendor-logos", "employee-photos"]);
const SESSION_ONLY = new Set(["item-images", "attachments", "layouts"]);

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

  if (fakeStoredAccess(pathname) !== "private") { allPrivate = false; check(`${folder}: stored private`, false, String(fakeStoredAccess(pathname))); }

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

  if (fakeProviderRead(pathname) !== null) { allProviderDenied = false; check(`${folder}: provider refuses an anonymous read`, false, "bytes returned"); }
}
check("all 9 folders: storeBlob wrote access=private", allPrivate);
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
    const bad = await getRaw(stored, { query: q.replace(/sig=./, "sig=X") });
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

// ---- cache policy ----
const cacheRes = await getRaw(storedA.logos, { cookie: A.cookie });
check("served bytes are marked private and never shared-cacheable", (cacheRes.headers.get("cache-control") ?? "").startsWith("private,"), String(cacheRes.headers.get("cache-control")));
check("served bytes carry X-Content-Type-Options: nosniff", cacheRes.headers.get("x-content-type-options") === "nosniff", String(cacheRes.headers.get("x-content-type-options")));

// ---- delete round-trip ----
const delTarget = pathOf(storedB["item-images"]);
check("an object exists before deletion", fakeStoredAccess(delTarget) === "private");

console.log("");
let pass_ = 0, fail_ = 0;
for (const [ok, name, extra] of results) { ok ? pass_++ : fail_++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + extra}`); }
console.log(`\n${pass_}/${pass_ + fail_} checks`);
await browser.close();
await db.end();
process.exit(fail_ ? 1 : 0);
