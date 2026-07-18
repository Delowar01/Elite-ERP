// Stage 11 Part 11 — committed, headless access-control / API-security regression (no server).
// Scans the server-action + route surface and asserts the authorization and tenant-isolation
// invariants that every mutating entry point must uphold. Runs in CI alongside crypto-policy.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : "  -> " + extra}`); };

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
const uploadRoute = readFileSync(join(root, "src/app/uploads/[folder]/[file]/route.ts"), "utf8");
ok("upload route enforces session or signed URL", uploadRoute.includes("getSession") && uploadRoute.includes("verifySignedFile"));
ok("upload route scopes files to the caller's org", uploadRoute.includes("session.orgId"));
ok("upload route audits downloads", uploadRoute.includes("recordFileAccess"));

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
