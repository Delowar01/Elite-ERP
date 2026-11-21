/**
 * Platform Owner PO-06 — the AUTOMATED staging-readiness checklist (Prompt 6 §12). Green only when every item holds;
 * every check fails closed, and the self-tests at the end prove each check can fail (a check that cannot fail proves
 * nothing).
 *
 *   npx tsx --conditions=react-server verify/verify-po06-staging-readiness.mts                     no database needed
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=… npx tsx --conditions=react-server verify/verify-po06-staging-readiness.mts --with-rehearsals
 *
 * Covers:
 *   - the D-6 manifest against the repository;
 *   - the dependency versions of the PO-05 baseline;
 *   - no application, schema, dependency or lockfile change since the PO-06 base (08511d0);
 *   - every switch off by default; the env template naming every environment variable the code reads;
 *   - the D-7 bundle's recorded SHA-256; the PO-06 documents and their required sections;
 *   - the decision sheet's coverage and its "defaults are not authorization" rule;
 *   - the classified open findings; secrets, credentials and production hosts absent from every PO-06 file;
 *   - the guard on every PO-06 database path.
 * With --with-rehearsals it also runs verify-po06-migration-rehearsal and verify-po06-data-safety. The regression of
 * STAGING_REGRESSION_SPEC.md and the complete `next build` are run and recorded separately (the PO-06 handover §I).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { assertDisposableLocalDatabaseUrl, UnsafeDatabaseTargetError } from "../scripts/platform/local-db-guard";
import { loadManifest, verifyManifestFiles } from "../scripts/platform/release-manifest";
import { ok, section, summary } from "./platform/harness";

const ROOT = process.cwd();
const PO06_BASE = "08511d0";
const DOCS = join(ROOT, "docs/platform-owner/po06");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const git = (args: string[]) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (n === "node_modules" || n.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// ── checks as pure functions (so the self-tests can feed them broken inputs) ──────────────────────────────────────

/** Every environment variable name the code reads. */
export function envNamesInCode(files: string[]): Set<string> {
  const names = new Set<string>();
  for (const f of files) {
    const t = readFileSync(f, "utf8");
    for (const re of [/process\.env\.([A-Z][A-Z0-9_]*)/g, /\benv\.([A-Z][A-Z0-9_]*)/g, /process\.env\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g, /_TOKEN_ENV\s*=\s*["']([A-Z][A-Z0-9_]*)["']/g])
      for (const mm of t.matchAll(re)) names.add(mm[1]);
    if (f.endsWith(".sh")) for (const mm of t.matchAll(/\$\{([A-Z][A-Z0-9_]*)(?::[-?=])?/g)) names.add(mm[1]);
  }
  return names;
}
/** Names the template covers: exact `NAME` tokens, or `PREFIX*` wildcards. */
export function uncoveredEnvNames(names: Set<string>, template: string): string[] {
  const tokens = [...template.matchAll(/`([A-Z][A-Z0-9_]*\*?)`/g)].map((mm) => mm[1]);
  const exact = new Set(tokens.filter((x) => !x.endsWith("*")));
  const prefixes = tokens.filter((x) => x.endsWith("*")).map((x) => x.slice(0, -1));
  const shellOnly = new Set(["PATH", "HOME", "PWD", "BASH_SOURCE"]);
  return [...names].filter((n) => !shellOnly.has(n) && !exact.has(n) && !prefixes.some((p) => n.startsWith(p))).sort();
}
/** Secrets, credentials or production endpoints in a text. */
export function secretFindings(text: string): string[] {
  const f: string[] = [];
  const rules: [string, RegExp][] = [
    ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ["connection string with a password", /postgres(ql)?:\/\/[^\s:@/]+:[^\s@/]+@/i],
    ["Neon host", /\.neon\.tech\b/i],
    ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./],
    ["blob token", /vercel_blob_rw_[A-Za-z0-9]{8,}/],
    ["AWS key", /\bAKIA[0-9A-Z]{16}\b/],
    ["live payment key", /\b(sk|rk)_live_[A-Za-z0-9]{8,}/],
    ["a personal mail domain", /@(gmail|yahoo|hotmail|outlook|icloud)\.com\b/i],
    ["a public IPv4 address", /\b(?!127\.0\.0\.1\b)(?!0\.0\.0\.0\b)(?!203\.0\.113\.)(?!10\.)(?:\d{1,3}\.){3}\d{1,3}\b/],
  ];
  for (const [name, re] of rules) if (re.test(text)) f.push(name);
  return f;
}
/** Decision ids the sheet must hold as table rows. */
export const REQUIRED_DECISIONS = [
  ...Array.from({ length: 10 }, (_, i) => `L-${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `P-${i + 1}`),
  ...Array.from({ length: 7 }, (_, i) => `N-${i + 1}`),
  "D-6", "D-7", "E-1", "R-1", "T",
  ...Array.from({ length: 8 }, (_, i) => `S-${i + 1}`),
];
export const missingDecisions = (sheet: string) => REQUIRED_DECISIONS.filter((id) => !new RegExp(`^\\| ${id.replace("-", "\\-")} \\|`, "m").test(sheet));
export const REQUIRED_FINDINGS = ["HF-1", "N-2", "N-3", "D6-F1", "D6-F2", "D6-F3", "D6-F4", "EI-1", "RB-1", "RB-2", "RB-3", "RB-4", "RB-5", "RB-6", "RB-7", "RB-8", "N-5", "L-8"];
export const unclassified = (matrix: string) => REQUIRED_FINDINGS.filter((id) => !new RegExp(`^\\| ${id} \\|[^\\n]*\\|[^\\n]*\\|[^\\n]*\\|[^\\n]*\\|`, "m").test(matrix));
export const recordedD7Sha = (procedure: string) => /\| SHA-256 \| `([0-9a-f]{64})` \|/.exec(procedure)?.[1] ?? null;

const REQUIRED_DOCS: Record<string, RegExp[]> = {
  "docs/platform-owner/PO06_STAGING_PREPARATION.md": "ABCDEFGHIJKLMN".split("").map((l) => new RegExp(`^## ${l}\\. `, "m")),
  "docs/platform-owner/po06/README.md": [/D6_MIGRATION_MANIFEST\.json/],
  "docs/platform-owner/po06/D6_MIGRATION_RUNBOOK.md": [/## 2\. Order and checksums/, /## 3\. PostgreSQL version and prerequisites/, /## 4\. Expected schema state/, /## 6\. Per step: retry, locks, preflight, verification, failure, rollback/, /## 7\. Rollback order/],
  "docs/platform-owner/po06/D6_REHEARSAL_RESULTS.md": "ABCDEFGHIJKLMNO".split("").map((l) => new RegExp(`\\| ${l} \\|`)),
  "docs/platform-owner/po06/D7_AUDIT_PROCEDURE.md": [/## 1\. What it measures/, /## 2\. Safety/, /## 3\. Owner execution and approval procedure/],
  "docs/platform-owner/po06/EMAIL_LOWER_UNIQUE_PROPOSAL.md": Array.from({ length: 10 }, (_, i) => new RegExp(`^## ${i + 1}\\. `, "m")),
  "docs/platform-owner/po06/STAGING_INFRASTRUCTURE.md": [/## 2\. Hosting/, /## 3\. Database/, /## 4\. Applications/, /## 5\. External services/],
  "docs/platform-owner/po06/STAGING_ENV_TEMPLATE.md": [/## 1\. Rules for every secret/, /## 3\. Feature switches/, /## 7\. Generating and storing the secrets/],
  "docs/platform-owner/po06/SECURITY_AND_FLAG_MATRIX.md": [/## 1\. The switches/, /## 2\. The activation order/, /## 4\. Open security findings, classified/],
  "docs/platform-owner/po06/BACKUP_RESTORE_EVIDENCE.md": [/## 4\. RECOVERY/, /## 5\. ROLLBACK/],
  "docs/platform-owner/po06/STAGING_DEPLOYMENT_RUNBOOK.md": Array.from({ length: 20 }, (_, i) => new RegExp(`^\\| ${i + 1} \\|`, "m")),
  "docs/platform-owner/po06/STAGING_REGRESSION_SPEC.md": [/verify:platform/, /verify:static/, /verify:server/, /next build/],
  "docs/platform-owner/po06/OWNER_DECISION_SHEET.md": [/default, not an authorization/],
  "docs/platform-owner/po06/PROMPT7_APPROVAL_CHECKLIST.md": [/## 1\. Owner decisions/, /## 3\. Automated readiness/],
  "docs/platform-owner/po06/STAGING_ENV_TEMPLATE.md#names-only": [/deliberately not named `\.env\*`/],
};
export function docFindings(texts: Record<string, string | null>): string[] {
  const f: string[] = [];
  for (const [path, needs] of Object.entries(REQUIRED_DOCS)) {
    const text = texts[path.split("#")[0]];
    if (text == null) {
      f.push(`${path}: missing`);
      continue;
    }
    for (const re of needs) if (!re.test(text)) f.push(`${path}: lacks ${re.source.slice(0, 50)}`);
  }
  return f;
}

// ── the checklist ─────────────────────────────────────────────────────────────────────────────────────────────────

section("1. The Next.js security build baseline and the dependency versions (PO-05)");
const pkg = JSON.parse(read("package.json"));
const installed = (name: string) => JSON.parse(read(`node_modules/${name}/package.json`)).version as string;
ok("package.json pins next 16.4.6, eslint-config-next 16.4.6, react / react-dom 19.2.4", pkg.dependencies.next === "16.4.6" && pkg.devDependencies["eslint-config-next"] === "16.4.6" && pkg.dependencies.react === "19.2.4" && pkg.dependencies["react-dom"] === "19.2.4");
ok("…and node_modules holds exactly those versions", installed("next") === "16.4.6" && installed("eslint-config-next") === "16.4.6" && installed("react") === "19.2.4");
const po05 = spawnSync(join(ROOT, "node_modules/.bin/tsx"), ["verify/verify-po05-security-update.mts"], { cwd: ROOT, encoding: "utf8", timeout: 300_000 });
ok("verify-po05-security-update (the PO-05 change record and its checks) passes", po05.status === 0, (po05.stdout ?? "").split("\n").filter((l) => /FAIL|passed/.test(l)).join(" | ").slice(0, 300));

section("2. Change control: PO-06 changed no application, schema, dependency or lockfile");
const changed = git(["diff", "--name-only", PO06_BASE, "--", "src", "drizzle", "package.json", "package-lock.json", "next.config.ts", "drizzle.config.ts", "scripts/backup.sh", "scripts/restore.sh", "scripts/apply-db-hardening.ts"]);
const untracked = git(["ls-files", "--others", "--exclude-standard", "--", "src", "drizzle"]);
ok(`nothing under src/, drizzle/, package.json, the lockfile, the configs or the backup/restore/hardening scripts differs from the PO-06 base ${PO06_BASE}`, changed.status === 0 && changed.stdout.trim() === "" && untracked.stdout.trim() === "", `${changed.stdout} ${untracked.stdout}`);
const added = git(["diff", "--name-only", "--diff-filter=A", PO06_BASE, "--"]).stdout.trim().split("\n").filter(Boolean);
const addedUntracked = git(["ls-files", "--others", "--exclude-standard"]).stdout.trim().split("\n").filter(Boolean);
const allNew = [...new Set([...added, ...addedUntracked])];
ok("every file PO-06 adds is a script, a test or a document (scripts/platform, verify, docs/platform-owner)", allNew.every((f) => /^(scripts\/platform\/|verify\/|docs\/platform-owner\/)/.test(f)), allNew.filter((f) => !/^(scripts\/platform\/|verify\/|docs\/platform-owner\/)/.test(f)).join(", "));
// A pre-existing, tracked template (`.env.example`, from long before the Platform Owner work) is allowed; PO-06 may not add or change any.
const trackedEnv = git(["ls-files"]).stdout.split("\n").filter((f) => /(^|\/)\.env/.test(f));
const envDiff = trackedEnv.length > 0 ? git(["diff", "--name-only", PO06_BASE, "--", ...trackedEnv]).stdout.trim() : "";
ok(`PO-06 adds no file named .env*, and the pre-existing tracked one(s) (${trackedEnv.join(", ") || "none"}) are unchanged since ${PO06_BASE}`, !allNew.some((f) => /(^|\/)\.env/.test(f)) && envDiff === "", `${allNew.filter((f) => /(^|\/)\.env/.test(f)).join(", ")} ${envDiff}`);

section("3. The D-6 manifest");
const m = loadManifest();
const mf = verifyManifestFiles(m);
ok(`the manifest matches the repository: ${m.files.length} files — SHA-256, size, declared timeouts, step order, every drizzle/platform file covered`, mf.length === 0, mf.join("; "));
const rm = read("scripts/platform/release-manifest.ts");
ok("the manifest tool opens connections only through both guard steps, and never runs push, migrate or generate itself", /assertDisposableLocalDatabaseUrl/.test(rm) && /assertDisposableLocalServer/.test(rm) && !/drizzle-kit/.test(rm.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")) && !/["'`](push|migrate|generate)["'`]/.test(rm));
for (const url of ["postgres://app@db.example.invalid:5432/elite_test_only_x", "postgres://app@127.0.0.1:5432/elite_erp", "postgres://app:pw@ep-cool-name.eu-central-1.aws.neon.tech/neondb"]) {
  let refused = false;
  try {
    assertDisposableLocalDatabaseUrl(url);
  } catch (e) {
    refused = e instanceof UnsafeDatabaseTargetError;
  }
  ok(`the guard refuses a ${/neon/.test(url) ? "Neon" : /invalid/.test(url) ? "non-loopback" : "non-test"} target before any connection`, refused);
}

section("4. Switches: every feature switch is off unless exactly \"true\" (TENANT_ACCESS_ENFORCEMENT: \"enabled\")");
const flags = read("src/lib/platform/flags.ts");
const SWITCHES = ["PLATFORM_CONSOLE_ENABLED", "PLATFORM_INVITATIONS_ENABLED", "PLATFORM_USER_INVITATIONS_ENABLED", "CUSTOMER_INVITE_ACCEPTANCE_ENABLED", "CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED", "CUSTOMER_SEAT_ENFORCEMENT_ENABLED"];
ok("each console / acceptance / seat switch is compared only with === \"true\" (or !== \"true\" in its assert) in flags.ts", SWITCHES.every((s) => new RegExp(`process\\.env\\.${s} [!=]== "true"`).test(flags) && !new RegExp(`process\\.env\\.${s}\\s*(\\|\\||\\?\\?)`).test(flags)));
ok("company-access enforcement is on only for exactly \"enabled\"", /process\.env\.TENANT_ACCESS_ENFORCEMENT === "enabled"/.test(read("src/lib/platform/company-access.ts")));
ok("none of the switches is set in this process's environment", [...SWITCHES, "TENANT_ACCESS_ENFORCEMENT"].every((s) => process.env[s] === undefined), [...SWITCHES, "TENANT_ACCESS_ENFORCEMENT"].filter((s) => process.env[s] !== undefined).join(","));
const template = read("docs/platform-owner/po06/STAGING_ENV_TEMPLATE.md");
ok("the env template lists every switch as off at deployment", SWITCHES.every((s) => new RegExp(`\`${s}\`[^\\n]*\\*\\*off\\*\\*`).test(template)) && /`TENANT_ACCESS_ENFORCEMENT`[^\n]*\*\*off\*\*/.test(template));

section("5. Secrets and URLs planned: the env template covers every variable the code reads");
const codeFiles = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "scripts"))].filter((f) => /\.(ts|tsx|mts|js|mjs|sh)$/.test(f));
const names = envNamesInCode(codeFiles);
const missing = uncoveredEnvNames(names, template);
ok(`all ${names.size} environment variable names read by src/ and scripts/ appear in STAGING_ENV_TEMPLATE.md (exactly or by a documented PREFIX* family)`, missing.length === 0, missing.join(", "));
ok("the template names how each secret is generated and stored, and never contains a value", /openssl rand -base64 48/.test(template) && /openssl rand -base64 32/.test(template) && /0600/.test(template) && secretFindings(template).length === 0);

section("6. D-7 and the e-mail decision are reported honestly");
const procedure = read("docs/platform-owner/po06/D7_AUDIT_PROCEDURE.md");
const bundle = readFileSync(join(DOCS, "sql/d7_readonly_production_audit.sql"));
ok("the D-7 procedure records the bundle's exact SHA-256", recordedD7Sha(procedure) === sha256(bundle), `${recordedD7Sha(procedure)} vs ${sha256(bundle)}`);
ok("…and says plainly it was not run against production and that running it needs separate approval", /Not executed against production/.test(procedure) && /separate written approval/.test(procedure));
const email = read("docs/platform-owner/po06/EMAIL_LOWER_UNIQUE_PROPOSAL.md");
ok("the e-mail proposal is not installed: no file under src/db or drizzle names users_email_lower_uq; the guarded proposal still refuses as committed", git(["grep", "-l", "users_email_lower_uq", "--", "src/db", "drizzle"]).stdout.trim() === "" && /RAISE EXCEPTION 'PO-02D3 PROPOSAL — not approved for execution/.test(read("docs/platform-owner/po02d3/proposal/users_email_lower_unique.proposal.sql")) && /Not installed anywhere but disposable/.test(email));
const sheet = read("docs/platform-owner/po06/OWNER_DECISION_SHEET.md");
const md = missingDecisions(sheet);
ok(`the decision sheet holds every decision as a row: L-1…L-10, P-1…P-10, N-1…N-7, D-6, D-7, E-1, R-1, T, S-1…S-8 (${REQUIRED_DECISIONS.length})`, md.length === 0, md.join(","));
ok("…and states that the development defaults are not the owner's authorization", /default, not an authorization/.test(sheet));
const matrix = read("docs/platform-owner/po06/SECURITY_AND_FLAG_MATRIX.md");
const uc = unclassified(matrix);
ok(`every open security finding is classified (severity, blocks staging, blocks production, owner): ${REQUIRED_FINDINGS.length} findings`, uc.length === 0, uc.join(","));

section("7. The documents");
const texts: Record<string, string | null> = {};
for (const p of Object.keys(REQUIRED_DOCS).map((k) => k.split("#")[0])) texts[p] = existsSync(join(ROOT, p)) ? read(p) : null;
const df = docFindings(texts);
ok("every PO-06 document exists with its required sections (handover A–N; scenarios A–O; the 10 e-mail points; the 20 runbook steps; recovery and rollback apart …)", df.length === 0, df.join("; "));
// every PO-06 file except this checklist itself (it holds the planted strings its self-tests feed to the scan)
const po06Files = [...walk(DOCS), join(ROOT, "docs/platform-owner/PO06_STAGING_PREPARATION.md"), join(ROOT, "scripts/platform/release-manifest.ts"), ...walk(join(ROOT, "verify")).filter((f) => /po06/.test(f) && !/verify-po06-staging-readiness\.mts$/.test(f))].filter((f) => existsSync(f));
const leaks = po06Files.map((f) => [relative(ROOT, f), secretFindings(readFileSync(f, "utf8"))] as const).filter(([, l]) => l.length > 0);
ok(`no secret, credential, private key, personal address, Neon host or public IP in any of the ${po06Files.length} PO-06 files`, leaks.length === 0, leaks.map(([f, l]) => `${f}: ${l.join(",")}`).join("; "));

section("8. No production resource accessed; no real customer record modified (structural)");
const dbSuites = ["verify/verify-po06-migration-rehearsal.mts", "verify/verify-po06-data-safety.mts", "verify/platform/po06-email-child.mts"];
ok("the PO-06 suites never open a raw connection: only connectDisposable / withAdmin (both guard steps) and the guarded tools", dbSuites.every((f) => !/new (Client|Pool)\(/.test(read(f))));
ok("the email child asserts the guard before it imports the application's database module", /assertDisposableLocalDatabaseUrl\(process\.env\.DATABASE_URL\);[\s\S]*await import\("\.\.\/\.\.\/src\/db"\)/.test(read("verify/platform/po06-email-child.mts")));
ok("the D-7 bundle is executed by the suites only against databases they created (newDb → disposableName → *_test_only_*)", /const P1 = await newDb\(/.test(read("verify/verify-po06-data-safety.mts")) && /disposableName\(prefix\)/.test(read("verify/verify-po06-data-safety.mts")));

section("9. Self-tests: each check can fail");
ok("an env name the template lacks is reported", uncoveredEnvNames(new Set(["AUTH_SECRET", "PO06_UNLISTED_NAME"]), "`AUTH_SECRET`").join() === "PO06_UNLISTED_NAME");
ok("a PREFIX* family covers its members and nothing else", uncoveredEnvNames(new Set(["STORAGE_FAKE_FAIL_READ", "STORAGE_FAKEX"]), "`STORAGE_FAKE_FAIL_*`").join() === "STORAGE_FAKEX");
ok("the secret scan flags a planted connection password, a private key header, a Neon host and a personal address", ["postgres://u:secretpw@127.0.0.1/x_test_only_y", "-----BEGIN OPENSSH PRIVATE KEY-----", "ep-x.neon.tech", "someone@gmail.com"].every((s) => secretFindings(s).length > 0));
ok("a recorded D-7 SHA-256 that differs from the file is caught", recordedD7Sha("| SHA-256 | `" + "0".repeat(64) + "` |") !== sha256(bundle));
ok("a decision sheet missing L-7 is caught", missingDecisions(sheet.replace(/^\| L-7 \|/m, "| L-7x |")).join() === "L-7");
ok("a finding without its classification columns is caught", unclassified(matrix.replace(/^\| RB-7 \|.*$/m, "| RB-7 | text only |")).join() === "RB-7");
ok("a handover without section K is caught", docFindings({ ...texts, "docs/platform-owner/PO06_STAGING_PREPARATION.md": (texts["docs/platform-owner/PO06_STAGING_PREPARATION.md"] ?? "").replace(/^## K\. /m, "## K ") }).some((f) => /PO06_STAGING_PREPARATION/.test(f)));

if (process.argv.includes("--with-rehearsals")) {
  section("10. The rehearsals (disposable databases)");
  for (const suite of ["verify/verify-po06-migration-rehearsal.mts", "verify/verify-po06-data-safety.mts"]) {
    const r = spawnSync(join(ROOT, "node_modules/.bin/tsx"), ["--conditions=react-server", suite], { cwd: ROOT, encoding: "utf8", timeout: 3_000_000 });
    const line = (r.stdout ?? "").split("\n").find((l) => /checks passed/.test(l)) ?? "no summary";
    ok(`${suite}: ${line.trim()}`, r.status === 0, (r.stdout ?? "").split("\n").filter((l) => /FAIL/.test(l)).join(" | ").slice(0, 400));
  }
}

process.exit(summary("verify-po06-staging-readiness"));
