// Stage 11 Part 11 — committed, headless access-control / API-security regression (no server).
// Scans the server-action + route surface and asserts the authorization and tenant-isolation
// invariants that every mutating entry point must uphold. Runs in CI alongside crypto-policy.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : "  -> " + extra}`); };

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const appDir = join(root, "src/app/(app)");
const files = walk(appDir);

// ---- 1. Every mutating server-action file gates on requireSession/requireRole ----
const MUTATION = /\bdb\.(insert|update|delete|transaction)\b|\btx\.(insert|update|delete)\b/;
const GATE = /require(Session|Role)\s*\(/;
const serverActionFiles = files.filter((f) => {
  const src = readFileSync(f, "utf8");
  return src.includes('"use server"') || src.includes("'use server'");
});
ok("found server-action files to audit", serverActionFiles.length > 10, String(serverActionFiles.length));

const ungated = serverActionFiles.filter((f) => {
  const src = readFileSync(f, "utf8");
  return MUTATION.test(src) && !GATE.test(src);
});
ok("every mutating server-action file authorizes (requireSession/requireRole)", ungated.length === 0, ungated.map((f) => f.replace(root, "")).join(", "));

// ---- 2. Tenant isolation helper is the single source of org scoping ----
const tenantSrc = readFileSync(join(root, "src/lib/tenant.ts"), "utf8");
ok("tenantScope filters by orgId", tenantSrc.includes("eq(table.orgId, orgId)"));
ok("tenantScope applies soft-delete default", tenantSrc.includes('ne(table.recordState, "deleted")'));
ok("role assignment prevents self-escalation", tenantSrc.includes("canAssignRole") && tenantSrc.includes("ROLE_RANK[actorRole] >= ROLE_RANK[targetRole]"));

// tenantScope is actually used across the app-action surface (not bypassed with bare selects)
const usesTenantScope = serverActionFiles.filter((f) => readFileSync(f, "utf8").includes("tenantScope")).length;
ok("tenantScope is used broadly in server actions", usesTenantScope >= 5, String(usesTenantScope));

// ---- 3. Private file route requires a session OR a verified signature ----
// The route was restructured from [folder]/[file] to a catch-all [...path] segment; this test kept
// the old path and threw ENOENT here, taking the whole suite down at assertion 7 of 17 and skipping
// CI's db:push and production build with it. Resolve the route by walking src/app/uploads instead of
// naming any segment, so the next restructure fails an ASSERTION instead of crashing the file.
//
// walk() rather than fs.globSync: globSync landed in node:fs in Node 22, and CI pins Node 20, where
// importing it is a SyntaxError that kills the suite before a single assertion runs — the same
// db:push-and-build skip as before, just moved from assertion 7 to assertion 0. The lookup also has
// to survive the directory being absent: walk() would throw ENOENT, so existsSync gates it and the
// empty result is reported as a failed assertion instead.
const uploadsDir = join(root, "src/app/uploads");
const uploadRouteFiles = existsSync(uploadsDir) ? walk(uploadsDir).filter((f) => basename(f) === "route.ts") : [];
ok(
  "exactly one upload route resolved under src/app/uploads",
  uploadRouteFiles.length === 1,
  uploadRouteFiles.length === 0
    ? `no route.ts found under ${uploadsDir.replace(root, "")} (directory ${existsSync(uploadsDir) ? "exists but holds none" : "does not exist"})`
    : `expected exactly 1, found ${uploadRouteFiles.length}: ${uploadRouteFiles.map((f) => f.replace(root, "")).join(", ")}`,
);
// Only read when the resolution is unambiguous; otherwise the three assertions below fail on an
// empty string rather than this line throwing on undefined.
const uploadRoute = uploadRouteFiles.length === 1 ? readFileSync(uploadRouteFiles[0], "utf8") : "";
ok("upload route enforces session or signed URL", uploadRoute.includes("getSession") && uploadRoute.includes("verifySignedFile"));
ok("upload route scopes files to the caller's org", uploadRoute.includes("session.orgId"));
ok("upload route audits downloads", uploadRoute.includes("recordFileAccess"));

// ---- 3b. Storage itself is private, and the read path does not go round the front ----
// These are structural rather than behavioural on purpose: this suite runs in CI with no database,
// no server and no storage. The behaviour they stand for is executed in verify-private-storage.mjs
// (9 folders x owner/cross-tenant/anonymous/signed) and verify-pdf-branding.mjs. What is worth
// catching HERE is the specific regression that created F-3 — storage quietly going back to public,
// or the route quietly going back to reading a provider URL — because either one silently reopens
// the hole while every behavioural test that runs against a live app still passes.
const storageSrc = readFileSync(join(root, "src/lib/storage/blob-storage.ts"), "utf8");
ok("uploads are stored with private access", /BLOB_ACCESS\s*=\s*"private"/.test(storageSrc), storageSrc.match(/BLOB_ACCESS\s*=\s*"[a-z]+"/)?.[0] ?? "no BLOB_ACCESS");
ok("the upload route never fetches a provider URL", !/fetch\(`?\$\{?blobBaseUrl/.test(uploadRoute) && !uploadRoute.includes("blob.vercel-storage.com"));
// Matching `readBlob(` alone would pass on the IMPORT line, which is an assertion that cannot
// fail — removing the call and keeping the import left this green. Require the actual invocation.
ok("the upload route reads through the token-authenticated helper", /await\s+readBlob\(\s*pathname\s*\)/.test(uploadRoute));
ok("no provider URL is constructed anywhere under src/", files.every((f) => !/public\.blob\.vercel-storage\.com/.test(readFileSync(f, "utf8"))));
ok("the test storage driver is opt-in only and never the default", /process\.env\.STORAGE_DRIVER === "fake"/.test(readFileSync(join(root, "src/lib/storage/blob-client.ts"), "utf8")));

// ---- 4. Signed URLs use HMAC + constant-time compare + expiry ----
const signedSrc = readFileSync(join(root, "src/lib/security/signed-url.ts"), "utf8");
ok("signed URLs use HMAC-SHA256", signedSrc.includes('createHmac("sha256"'));
ok("signed URLs verify in constant time", signedSrc.includes("timingSafeEqual"));
ok("signed URLs enforce expiry", signedSrc.includes("exp <") || signedSrc.includes("< Math.floor(Date.now()"));

// ---- 5. Login flow rate-limits + records security events (brute-force defence) ----
const loginActions = readFileSync(join(root, "src/app/(auth)/actions.ts"), "utf8");
ok("login records failed-login security events", loginActions.includes("login.failed") || loginActions.includes("rate_limited"));
ok("login enforces MFA challenge when enabled", loginActions.includes("mfaEnabled") && loginActions.includes("MFA_REQUIRED"));

// ---- 6. No committed secrets / insecure fallbacks ----
const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
ok(".env is gitignored", /\.env/.test(gitignore));
const authSrc = readFileSync(join(root, "src/lib/auth.ts"), "utf8");
ok("no insecure AUTH_SECRET fallback", !/AUTH_SECRET\s*\|\|\s*["']/.test(authSrc));

console.log(`\n${pass}/${pass + fail} access-control checks passed`);
process.exit(fail ? 1 : 0);
