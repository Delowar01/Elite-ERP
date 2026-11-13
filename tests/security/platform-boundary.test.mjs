// Platform Owner PO-01A — static boundary checks (no database, no network).
// Run: node tests/security/platform-boundary.test.mjs   (npm run verify:platform-boundary)
//
// Encodes the separation rules between the Platform Owner foundation and the customer ERP so a
// later change cannot silently erode them. PO-01B will extend rules 3 and 9 when it adds
// src/app/(platform) and the proxy branch.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
let pass = 0;
let fail = 0;
function ok(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}
const read = (p) => readFileSync(p, "utf8");
const rel = (p) => relative(root, p);
const importsOf = (src) => [...src.matchAll(/(?:import|export)\s[^"'`]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2]);

const platformLib = walk(join(root, "src/lib/platform"));
const allSrc = walk(join(root, "src"));
const platformScripts = walk(join(root, "scripts/platform"));

// 1. Every platform library module is server-only.
const notServerOnly = platformLib.filter((f) => !/^import "server-only";/m.test(read(f).split("\n").find((l) => l.trim() && !l.startsWith("//")) ?? ""));
ok("every src/lib/platform module starts with import \"server-only\"", platformLib.length >= 12 && notServerOnly.length === 0, notServerOnly.map(rel).join(", ") || `${platformLib.length} modules`);

// 2. The platform library never imports customer identity/session code.
const TENANT_AUTH = ["@/lib/session", "@/lib/auth", "@/lib/rate-limit", "@/lib/tenant", "@/lib/security/session-store", "@/lib/security/audit"];
const tenantImports = platformLib.filter((f) => importsOf(read(f)).some((s) => TENANT_AUTH.includes(s) || s.startsWith("@/app/")));
ok("src/lib/platform imports no customer session/auth/tenant/rate-limit/audit module", tenantImports.length === 0, tenantImports.map(rel).join(", "));

// 3. Nothing in the customer app imports the platform library (PO-01A wires no route).
const importers = allSrc.filter((f) => !f.startsWith(join(root, "src/lib/platform")) && importsOf(read(f)).some((s) => s.startsWith("@/lib/platform") || s.includes("/lib/platform/")));
ok("no file outside src/lib/platform imports the platform library (routes come in PO-01B)", importers.length === 0, importers.map(rel).join(", "));
const appToScripts = allSrc.filter((f) => importsOf(read(f)).some((s) => s.includes("scripts/platform")));
ok("no src/ file imports scripts/platform (bootstrap stays out of the app bundle)", appToScripts.length === 0, appToScripts.map(rel).join(", "));

// 4. Separate secrets: the customer auth never reads PLATFORM_AUTH_SECRET; the platform reads
//    AUTH_SECRET only to refuse sharing it (config.ts).
const tenantAuthFiles = ["src/lib/auth.ts", "src/lib/session.ts", "src/proxy.ts", "src/app/(auth)/actions.ts"].map((p) => join(root, p));
ok("customer auth code never references PLATFORM_AUTH_SECRET", tenantAuthFiles.every((f) => !read(f).includes("PLATFORM_AUTH_SECRET")));
const authSecretReaders = platformLib.filter((f) => /process\.env\.AUTH_SECRET/.test(read(f)));
ok("only platform/config.ts reads AUTH_SECRET (to refuse a shared secret)", authSecretReaders.length === 1 && rel(authSecretReaders[0]) === join("src", "lib", "platform", "config.ts"), authSecretReaders.map(rel).join(", "));
const fallback = [...platformLib, ...platformScripts].filter((f) => /PLATFORM_AUTH_SECRET\s*(\|\||\?\?)\s*["'`]/.test(read(f)));
ok("no insecure PLATFORM_AUTH_SECRET fallback", fallback.length === 0, fallback.map(rel).join(", "));
const cfg = read(join(root, "src/lib/platform/config.ts"));
const cookieAssignment = (cfg.match(/export const PLATFORM_SESSION_COOKIE\s*=[^;]*;/) ?? [""])[0];
ok("platform cookie name differs from the customer session cookie", /"__Host-elite_erp_platform"/.test(cookieAssignment) && !/elite_erp_session/.test(cookieAssignment), cookieAssignment);

// 5. Append-only by construction: no update/delete of platform_audit_events anywhere in code.
const auditMutators = [...allSrc, ...platformScripts].filter((f) => /\.(update|delete)\(\s*platformAuditEventsTable/.test(read(f)));
ok("no code path updates or deletes platformAuditEventsTable", auditMutators.length === 0, auditMutators.map(rel).join(", "));

// 6. No default administrator credentials in shipped code.
// literal e-mail strings, or a quoted literal assigned to a password/hash/secret identifier
const credentialish = [...platformLib, ...platformScripts].filter((f) => /["'`][A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}["'`]/.test(read(f)) || /\b(password|passwordHash|secret|mfaSecretEncrypted)\s*[:=]\s*["'`][^"'`\s]{6,}["'`]/i.test(read(f)));
ok("no hard-coded e-mail, password or password hash in platform code/scripts", credentialish.length === 0, credentialish.map(rel).join(", "));

// 7. Database operations in platform scripts go through the fail-closed guard.
const dbScripts = platformScripts.filter((f) => /new (Client|Pool)\(/.test(read(f)));
const unguarded = dbScripts.filter((f) => !/assertDisposableLocalDatabaseUrl/.test(read(f)) || !/assertDisposableLocalServer/.test(read(f)));
ok("every platform script that opens a connection uses both guard steps", dbScripts.length >= 3 && unguarded.length === 0, unguarded.map(rel).join(", ") || `${dbScripts.length} scripts`);

// 8. Migration hygiene: historical Drizzle migrations untouched; platform SQL outside the journal.
const journal = JSON.parse(read(join(root, "drizzle/meta/_journal.json")));
ok("drizzle journal still lists exactly 0000–0004 (no generated migration)", journal.entries.length === 5 && !existsSync(join(root, "drizzle/0005")) && readdirSync(join(root, "drizzle")).filter((n) => /^\d{4}_.*\.sql$/.test(n)).length === 5);
ok("platform SQL lives outside the journal", existsSync(join(root, "drizzle/platform/PO01_platform_identity.sql")) && !JSON.stringify(journal).includes("platform"));
const sqlText = read(join(root, "drizzle/platform/PO01_platform_identity.sql"));
const alters = [...sqlText.matchAll(/ALTER\s+TABLE\s+(\w+)/gi)].map((m) => m[1]).filter((t) => !t.startsWith("platform_"));
const creates = [...sqlText.matchAll(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi)].map((m) => m[1]);
ok("platform SQL alters no existing table and creates only platform_* objects", alters.length === 0 && creates.length > 0 && creates.every((n) => n.startsWith("platform_")), alters.join(", "));

// 9. PO-01A boundary: the proxy and customer auth flow are untouched.
ok("src/proxy.ts has no platform routing yet (PO-01B)", !/platform/i.test(read(join(root, "src/proxy.ts"))));
ok("no src/app/(platform) routes yet (PO-01B)", !existsSync(join(root, "src/app/(platform)")));

console.log(`\n${pass}/${pass + fail} platform boundary checks passed`);
process.exit(fail ? 1 : 0);
