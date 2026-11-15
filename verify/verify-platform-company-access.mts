/**
 * Platform Owner PO-02C — company access: the suspend / reactivate action
 * (src/lib/platform/company-access-actions.ts) and the customer tenant-access gate
 * (src/lib/security/tenant-access-gate.ts, src/lib/session.ts), in-process.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *   [PO02C_EVIDENCE_DIR=<dir for timings and plans>] npm run verify:platform-company-access
 *
 * One disposable `_test_only_` database (dropped at the end): 1,000 SYNTHETIC organizations
 * (scripts/platform/company-fixtures.ts) plus hand-made fictional companies, users and customer sessions.
 * Secrets are generated in memory and never printed. Proves: the switches are off by default; the
 * authorization order (flag → origin → live platform session → manage_access; customer tokens refused);
 * input validation that spends nothing; the step-up (password, fresh TOTP, replay, durable throttle);
 * the atomic transaction (state, operator, reason, timestamps, ended sessions, audit — all or nothing,
 * audit / upsert / session failures injected); serialized concurrent changes with one successful audit;
 * reactivation that never recreates a session; the customer gate for every session shape (legacy,
 * jti-less, ownership mismatch, missed revocation, missing table / column, drifted status, switch off);
 * races against validation, sign-in, signed files and business writes; business data untouched;
 * performance at 1,000 organizations; no secret in any audit record.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { connectDisposable, createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { section, ok, summary, describeError, sqlState } from "./platform/harness";

const testDbName = disposableName("po02c_access");
process.env.DATABASE_URL = databaseUrlFor(testDbName);
process.env.PLATFORM_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.FIELD_ENCRYPTION_KEYS = `1:${randomBytes(32).toString("base64")}`;
process.env.PLATFORM_CONSOLE_ENABLED = "true";
process.env.PLATFORM_TRUSTED_PROXY_HOPS = "1";
process.env.TENANT_ACCESS_ENFORCEMENT = "enabled";
delete process.env.CUSTOMER_LEGACY_TOKENS;
const EVIDENCE = process.env.PO02C_EVIDENCE_DIR || "";
if (EVIDENCE) mkdirSync(EVIDENCE, { recursive: true });

let created = false;
await createPlatformTestDatabase("po02c_access", testDbName);
created = true;

const { db, pool, platformAdminsTable, orgsTable, usersTable, sessionsTable } = await import("../src/db");
const { eq } = await import("drizzle-orm");
const auth = await import("../src/lib/platform/auth");
const mfa = await import("../src/lib/platform/mfa");
const totp = await import("../src/lib/platform/totp");
const { platformClock } = await import("../src/lib/platform/clock");
const { PLATFORM_ERROR_MESSAGES } = await import("../src/lib/platform/errors");
const console_ = await import("../src/lib/platform/console");
const audit = await import("../src/lib/platform/audit");
const { PLATFORM_THROTTLE_POLICY } = await import("../src/lib/platform/throttle");
const access = await import("../src/lib/platform/company-access");
const actions = await import("../src/lib/platform/company-access-actions");
const companies = await import("../src/lib/platform/companies");
const tenantAuth = await import("../src/lib/auth");
// Inside Next, server code resolves next/navigation to its react-server build; the package's root file is the
// CLIENT build (React contexts), which cannot load here. Resolve it the way Next does for src/lib/session.ts.
{
  const require = createRequire(import.meta.url);
  const navPath = require.resolve("next/navigation");
  require.cache[navPath] = { id: navPath, filename: navPath, loaded: true, exports: require("next/dist/api/navigation.react-server.js") } as unknown as NodeJS.Module;
}
const customerSession = await import("../src/lib/session");
const gate = await import("../src/lib/security/tenant-access-gate");
const { seedSyntheticCompanies } = await import("../scripts/platform/company-fixtures");

// ---- deterministic platform clock (TOTP steps, throttle windows, audit and access timestamps) ----
let nowMs = Math.floor(Date.now() / 1000) * 1000;
platformClock.now = () => new Date(nowMs);
const nextStep = () => {
  nowMs = (totp.totpStepAt(new Date(nowMs)) + 1) * 30_000 + 1_000;
};
const MIN = 60_000;
const DAY = 86_400_000;
const HOST = "access.erp.test";
const headersFor = (ip: string, over: Record<string, string | null> = {}) => {
  const h = new Headers({ host: HOST, origin: `https://${HOST}`, "sec-fetch-site": "same-origin", "user-agent": "verify-platform-company-access", "x-forwarded-for": ip });
  for (const [k, v] of Object.entries(over)) if (v === null) h.delete(k);
  else h.set(k, v);
  return h;
};
const q = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** jsonb does not keep key order: compare snapshots key by key. */
const canon = (o: Record<string, unknown> | null | undefined) => JSON.stringify(Object.fromEntries(Object.entries(o ?? {}).sort(([a], [b]) => a.localeCompare(b))));
const sameJson = (a: Record<string, unknown> | null | undefined, b: Record<string, unknown>) => canon(a) === canon(b);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- SQL capture (query counts per operation) ------------------------------------------------------
let capturing = false;
let capturedTexts: string[] = [];
const originalQuery = pool.query.bind(pool) as (...args: unknown[]) => unknown;
(pool as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
  if (capturing) {
    const first = args[0] as string | { text: string };
    capturedTexts.push(typeof first === "string" ? first : first.text);
  }
  return originalQuery(...args);
};
async function capture<T>(fn: () => Promise<T>): Promise<{ value: T; texts: string[] }> {
  capturedTexts = [];
  capturing = true;
  try {
    return { value: await fn(), texts: [...capturedTexts] };
  } finally {
    capturing = false;
  }
}

// ---- fictional operators ----------------------------------------------------------------------------
const STRONG = "Harbor-Quill-73!m";
const secretsSeen: string[] = [STRONG];
type Admin = { id: string; email: string; secret: string; displayName: string };
async function createAdmin(email: string, displayName: string): Promise<Admin> {
  const { secret } = mfa.createTotpEnrollment(email);
  const { codes, hashes } = await mfa.createRecoveryCodeSet();
  const at = new Date(nowMs);
  const [row] = await db
    .insert(platformAdminsTable)
    .values({ emailNormalized: email, displayName, passwordHash: await auth.hashPlatformPassword(STRONG), isActive: true, mfaSecretEncrypted: mfa.encryptTotpSecret(secret), mfaRecoveryHashes: hashes, mfaEnrolledAt: at, passwordChangedAt: at, createdAt: at, updatedAt: at })
    .returning({ id: platformAdminsTable.id });
  secretsSeen.push(secret, ...codes);
  return { id: row.id, email, secret, displayName };
}
const codeFor = (a: Admin, offset = 0) => totp.hotpCode(a.secret, totp.totpStepAt(new Date(nowMs)) + offset);
async function signIn(a: Admin, ip: string): Promise<string> {
  nextStep();
  const r = await console_.signInCore({ email: a.email, password: STRONG, totpCode: codeFor(a) }, { headers: headersFor(ip) });
  if (!r.ok) throw new Error(`fixture sign-in failed: ${r.code}`);
  secretsSeen.push(r.token);
  nextStep(); // the sign-in consumed this step; the next step-up needs a fresh one
  return r.token;
}
const lastStep = async (a: Admin) => Number((await q<{ s: string | null }>("select mfa_last_totp_step::text as s from platform_admins where id = $1", [a.id]))[0].s ?? -1);
const failuresRecorded = async () => Number((await q<{ n: number }>("select count(*)::int as n from platform_login_attempts where outcome = 'failure'"))[0].n);

// ---- fictional customer companies, users and sessions -------------------------------------------------
const FAKE_HASH = "$2a$10$abcdefghijklmnopqrstuuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZa";
async function tenantOrg(name: string): Promise<number> {
  const [o] = await db.insert(orgsTable).values({ name, country: "Saudi Arabia", currency: "SAR" }).returning({ id: orgsTable.id });
  return o.id;
}
async function tenantUser(orgId: number, email: string): Promise<number> {
  const [u] = await db.insert(usersTable).values({ orgId, email, passwordHash: FAKE_HASH, name: `Fixture ${email.split("@")[0]}`, role: "owner" }).returning({ id: usersTable.id });
  return u.id;
}
type Tenant = { orgId: number; userId: number; jti: string; token: string };
async function customerSessionFor(orgId: number, userId: number, opts: { expiresInMs?: number; revokedReason?: string } = {}): Promise<Tenant> {
  const jti = randomBytes(24).toString("base64url");
  await db.insert(sessionsTable).values({
    orgId,
    userId,
    tokenHash: sha256(jti),
    expiresAt: new Date(Date.now() + (opts.expiresInMs ?? 30 * DAY)),
    revokedAt: opts.revokedReason ? new Date() : null,
    revokedReason: opts.revokedReason ?? null,
  });
  const token = await tenantAuth.signSessionToken({ userId, orgId, jti });
  secretsSeen.push(jti, token);
  return { orgId, userId, jti, token };
}
const stateOf = async (token: string) => (await customerSession.resolveSessionToken(token)).status;
const tacRow = async (orgId: number) =>
  (await q<{ access_status: string; reason: string | null; changed_by_platform_admin_id: string | null; changed_at: Date | null; created_at: Date; updated_at: Date }>(
    "select access_status, reason, changed_by_platform_admin_id, changed_at, created_at, updated_at from tenant_access_controls where org_id = $1",
    [orgId],
  ))[0] ?? null;
const sessionRows = async (orgId: number) => q<{ id: string; revoked_at: Date | null; revoked_reason: string | null }>("select id::text as id, revoked_at, revoked_reason from sessions where org_id = $1 order by id", [orgId]);
type AuditRow = { action: string; result: string; org_id: number | null; reason: string | null; before_safe: Record<string, unknown> | null; after_safe: Record<string, unknown> | null; actor_platform_admin_id: string | null };
const accessEvents = async (orgId: number) =>
  q<AuditRow>("select action, result, org_id, reason, before_safe, after_safe, actor_platform_admin_id from platform_audit_events where entity_type = 'organization' and entity_id = $1 and action <> 'company.viewed' order by id", [String(orgId)]);

async function auditOutage(on: boolean) {
  if (on) {
    await q(`create or replace function po02c_test_only_fail_audit() returns trigger language plpgsql as $$ begin raise exception 'injected audit outage (test only)'; end $$`);
    await q(`create trigger po02c_test_only_fail_audit before insert on platform_audit_events for each row execute function po02c_test_only_fail_audit()`);
  } else {
    await q(`drop trigger if exists po02c_test_only_fail_audit on platform_audit_events`);
    await q(`drop function if exists po02c_test_only_fail_audit()`);
  }
}

type Outcome = Awaited<ReturnType<typeof actions.setCompanyAccessCore>>;
const codeOf = (o: Outcome) => (o.ok ? "OK" : o.code);
const REASON = "Fixture: invoices overdue, access paused for review";

async function main() {
  // Synthetic companies first (the seeder refuses a database that already holds organizations).
  const operator = await createAdmin("operator@access-fixture.test", "Fixture Operator");
  const second = await createAdmin("second@access-fixture.test", "Second Operator");
  const throttled = await createAdmin("throttled@access-fixture.test", "Throttled Operator");
  const seedClient = await connectDisposable(process.env.DATABASE_URL!);
  let seeded: Awaited<ReturnType<typeof seedSyntheticCompanies>>;
  try {
    seeded = await seedSyntheticCompanies(seedClient, { companies: 1000, adminId: operator.id, now: new Date(nowMs - 3 * DAY) });
  } finally {
    await seedClient.end();
  }
  const orgTotal = Number((await q<{ n: number }>("select count(*)::int as n from orgs"))[0].n);

  const IP = { main: "203.0.113.31", second: "203.0.113.32", throttle: "203.0.113.33", misc: "203.0.113.34" };
  let token = await signIn(operator, IP.main);
  const req = (over: Record<string, string | null> = {}, tok: string | null = token, ip = IP.main) => ({ headers: headersFor(ip, over), token: tok });
  const input = (orgId: number, target: "suspended" | "active", a: Admin, over: Record<string, unknown> = {}) => ({
    orgId: String(orgId),
    target,
    reference: companies.orgReference(orgId),
    reason: REASON,
    password: STRONG,
    totpCode: codeFor(a),
    ...over,
  });

  // ------------------------------------------------------------------------------------------------
  section("1. Off by default: both switches are exact");
  {
    const saved = process.env.TENANT_ACCESS_ENFORCEMENT;
    const offValues = [undefined, "", "true", "1", "on", "ENABLED", "enabled ", "Enabled"];
    const off = offValues.every((v) => {
      if (v === undefined) delete process.env.TENANT_ACCESS_ENFORCEMENT;
      else process.env.TENANT_ACCESS_ENFORCEMENT = v;
      return !access.tenantAccessEnforcementEnabled() && !gate.tenantAccessEnforcementEnabled();
    });
    process.env.TENANT_ACCESS_ENFORCEMENT = "enabled";
    ok("enforcement is OFF when TENANT_ACCESS_ENFORCEMENT is unset, empty, true, 1, on or any other spelling; ON only for exactly \"enabled\"", off && access.tenantAccessEnforcementEnabled() && gate.tenantAccessEnforcementEnabled());
    process.env.TENANT_ACCESS_ENFORCEMENT = saved;
    const legacyOff = [undefined, "", "true", "REJECT", "reject "].every((v) => {
      if (v === undefined) delete process.env.CUSTOMER_LEGACY_TOKENS;
      else process.env.CUSTOMER_LEGACY_TOKENS = v;
      return !gate.legacyCustomerTokensRejected();
    });
    process.env.CUSTOMER_LEGACY_TOKENS = "reject";
    const legacyOn = gate.legacyCustomerTokensRejected();
    delete process.env.CUSTOMER_LEGACY_TOKENS;
    ok("legacy (jti-less) customer tokens are rejected only for exactly CUSTOMER_LEGACY_TOKENS=reject (the D-8 proposal, default allow)", legacyOff && legacyOn);
    ok("the suspension revocation reason is one constant shared by the action and the gate", access.ORG_SUSPENDED_REVOKE_REASON === "org_suspended" && gate.ORG_SUSPENDED_REVOKE_REASON === access.ORG_SUSPENDED_REVOKE_REASON);
    ok("ENFORCEMENT_DISABLED has English and native Arabic text", /switched off/.test(PLATFORM_ERROR_MESSAGES.ENFORCEMENT_DISABLED.en) && /[؀-ۿ]/.test(PLATFORM_ERROR_MESSAGES.ENFORCEMENT_DISABLED.ar));
  }

  // Companies used below (fictional).
  const victim = await tenantOrg("Access Fixture Trading Co");
  const vUser1 = await tenantUser(victim, "owner@access-victim.test");
  const vUser2 = await tenantUser(victim, "staff@access-victim.test");
  const vLive = [await customerSessionFor(victim, vUser1), await customerSessionFor(victim, vUser1), await customerSessionFor(victim, vUser2)];
  const vExpired = await customerSessionFor(victim, vUser2, { expiresInMs: -DAY });
  const vLoggedOut = await customerSessionFor(victim, vUser1, { revokedReason: "logout" });
  const bystander = await tenantOrg("Bystander Fixture Est");
  const bUser = await tenantUser(bystander, "owner@access-bystander.test");
  const bLive = await customerSessionFor(bystander, bUser);

  // ------------------------------------------------------------------------------------------------
  section("2. Authorization: flag → same-origin → live platform session → manage_access (nothing changes on refusal)");
  {
    const step0 = await lastStep(operator);
    const refused = async (name: string, expected: string[], r: () => Promise<Outcome>) => {
      const o = await r();
      ok(name, expected.includes(codeOf(o)), codeOf(o));
    };
    process.env.PLATFORM_CONSOLE_ENABLED = "";
    await refused("console disabled → CONSOLE_DISABLED", ["CONSOLE_DISABLED"], () => actions.setCompanyAccessCore(req(), input(victim, "suspended", operator)));
    process.env.PLATFORM_CONSOLE_ENABLED = "true";
    await refused("no Origin header → FORBIDDEN (CSRF)", ["FORBIDDEN"], () => actions.setCompanyAccessCore(req({ origin: null }), input(victim, "suspended", operator)));
    await refused("a cross-site Origin → FORBIDDEN", ["FORBIDDEN"], () => actions.setCompanyAccessCore(req({ origin: "https://evil.example" }), input(victim, "suspended", operator)));
    await refused("Sec-Fetch-Site: cross-site → FORBIDDEN", ["FORBIDDEN"], () => actions.setCompanyAccessCore(req({ "sec-fetch-site": "cross-site" }), input(victim, "suspended", operator)));
    await refused("no platform session → UNAUTHORIZED", ["UNAUTHORIZED"], () => actions.setCompanyAccessCore(req({}, null), input(victim, "suspended", operator)));
    await refused("a malformed platform token → UNAUTHORIZED", ["UNAUTHORIZED"], () => actions.setCompanyAccessCore(req({}, "not-a-token"), input(victim, "suspended", operator)));
    await refused("a CUSTOMER ERP session token is never accepted → UNAUTHORIZED", ["UNAUTHORIZED"], () => actions.setCompanyAccessCore(req({}, vLive[0].token), input(victim, "suspended", operator)));
    const ended = await signIn(second, IP.second);
    await console_.signOutCore({ headers: headersFor(IP.second), token: ended });
    await refused("a signed-out platform session → UNAUTHORIZED / SESSION_EXPIRED", ["UNAUTHORIZED", "SESSION_EXPIRED"], () => actions.setCompanyAccessCore(req({}, ended, IP.second), input(victim, "suspended", second)));
    const read = await actions.readCompanyAccessCore(req({}, vLive[0].token), String(victim));
    ok("the read operation refuses a customer token too", !read.ok && read.code === "UNAUTHORIZED");
    await audit.assertPlatformAuditProtection({ force: true });
    await q("alter table platform_audit_events disable trigger user");
    let protectionCode = "";
    try {
      await audit.assertPlatformAuditProtection({ force: true }).catch(() => undefined);
      protectionCode = codeOf(await actions.setCompanyAccessCore(req(), input(victim, "suspended", operator)));
    } finally {
      await q("alter table platform_audit_events enable trigger user");
      await audit.assertPlatformAuditProtection({ force: true });
    }
    ok("an unprotected audit trail (append-only triggers disabled) → CONFIG_ERROR before anything else", protectionCode === "CONFIG_ERROR", protectionCode);
    ok("…after every refusal: no access row, no session ended, no audit record, no code consumed", (await tacRow(victim)) === null && (await sessionRows(victim)).filter((r) => r.revoked_reason === "org_suspended").length === 0 && (await accessEvents(victim)).length === 0 && (await lastStep(operator)) === step0);
  }

  // ------------------------------------------------------------------------------------------------
  section("3. Input format (checked before the step-up, so a malformed request spends nothing)");
  {
    const step0 = await lastStep(operator);
    const fails0 = await failuresRecorded();
    const other = seeded.orgIds[0];
    const bad: [string, Record<string, unknown>, string][] = [
      ["another company's reference", { reference: companies.orgReference(other) }, "VALIDATION_FAILED"],
      ["the reference in lower case", { reference: companies.orgReference(victim).toLowerCase() }, "VALIDATION_FAILED"],
      ["no reference", { reference: "" }, "VALIDATION_FAILED"],
      ["a 9-character reason", { reason: "Too short" }, "VALIDATION_FAILED"],
      ["a 501-character reason", { reason: "x".repeat(501) }, "VALIDATION_FAILED"],
      ["a reason of spaces and line breaks only", { reason: " \n\t    \n " }, "VALIDATION_FAILED"],
      ["a reason with a control character", { reason: "Fixture reason \u0007 bell" }, "VALIDATION_FAILED"],
      ["a reason with a bidirectional override", { reason: "Fixture reason ‮ reversed" }, "VALIDATION_FAILED"],
      ["a non-text reason", { reason: 1234567890123 }, "VALIDATION_FAILED"],
      ["an unknown target", { target: "paused" }, "VALIDATION_FAILED"],
      ["an empty password", { password: "" }, "VALIDATION_FAILED"],
      ["a 5-digit code", { totpCode: "12345" }, "VALIDATION_FAILED"],
      ["a non-numeric code", { totpCode: "abcdef" }, "VALIDATION_FAILED"],
      ["company id 0", { orgId: "0" }, "NOT_FOUND"],
      ["a non-numeric company id", { orgId: "abc" }, "NOT_FOUND"],
      ["an exponent company id", { orgId: "1e3" }, "NOT_FOUND"],
      ["a negative company id", { orgId: "-5" }, "NOT_FOUND"],
    ];
    for (const [name, over, expected] of bad) {
      const o = await actions.setCompanyAccessCore(req(), input(victim, "suspended", operator, over));
      ok(`${name} → ${expected}`, codeOf(o) === expected, codeOf(o));
    }
    ok("…none of them consumed a code, counted a throttle failure, wrote an audit record or changed access", (await lastStep(operator)) === step0 && (await failuresRecorded()) === fails0 && (await accessEvents(victim)).length === 0 && (await tacRow(victim)) === null);
    ok("reason rules: whitespace runs collapse, 10 and 500 characters pass, 9 and 501 do not; Arabic text with RLM marks passes", actions.normalizeAccessReason("  Fixture \n\n reason   text  ") === "Fixture reason text" && actions.normalizeAccessReason("a".repeat(10)) !== null && actions.normalizeAccessReason("a".repeat(500)) !== null && actions.normalizeAccessReason("a".repeat(9)) === null && actions.normalizeAccessReason("a".repeat(501)) === null && actions.normalizeAccessReason("تعليق مؤقت بسبب مراجعة الحساب‏") !== null);
  }

  // ------------------------------------------------------------------------------------------------
  section("4. Step-up: password, fresh TOTP code, nothing applied on failure");
  {
    const step0 = await lastStep(operator);
    const fails0 = await failuresRecorded();
    const wrongPw = await actions.setCompanyAccessCore(req(), input(victim, "suspended", operator, { password: "Wrong-Password-11!x" }));
    ok("a wrong password → INVALID_CREDENTIALS", codeOf(wrongPw) === "INVALID_CREDENTIALS", codeOf(wrongPw));
    const wrongCode = await actions.setCompanyAccessCore(req(), input(victim, "suspended", operator, { totpCode: codeFor(operator, 7) }));
    ok("a wrong authenticator code → MFA_INVALID", codeOf(wrongCode) === "MFA_INVALID", codeOf(wrongCode));
    const ev = await accessEvents(victim);
    ok("…each is recorded as a rejected attempt on the company (stage password / mfa) and counts against the durable throttle", ev.length === 2 && ev.every((e) => e.action === "company.suspend.rejected" && e.result === "rejected" && e.org_id === victim) && ev[0].after_safe?.stage === "password" && ev[1].after_safe?.stage === "mfa" && (await failuresRecorded()) === fails0 + 2, JSON.stringify(ev.map((e) => e.after_safe)));
    ok("…and nothing was applied: no access row, no session ended, no code consumed", (await tacRow(victim)) === null && (await stateOf(vLive[0].token)) === "active" && (await lastStep(operator)) === step0);
    const ghost = 2_000_000;
    const missing = await actions.setCompanyAccessCore(req(), input(ghost, "suspended", operator));
    const ghostEvents = await q<AuditRow>("select action, result, org_id, reason, before_safe, after_safe, actor_platform_admin_id from platform_audit_events where entity_id = $1", [String(ghost)]);
    ok("a company that does not exist (valid id, right credentials) → NOT_FOUND after the step-up; the attempt is recorded without an org link; the code is NOT consumed (rolled back)", codeOf(missing) === "NOT_FOUND" && ghostEvents.length === 1 && ghostEvents[0].org_id === null && ghostEvents[0].after_safe?.stage === "not_found" && (await lastStep(operator)) === step0, JSON.stringify(ghostEvents));
    token = await signIn(operator, IP.main); // a successful sign-in resets the account failure window
  }

  // ------------------------------------------------------------------------------------------------
  section("5. Suspension: one transaction — state, operator, reason, timestamps, ended sessions, audit");
  let suspendedAt = 0;
  {
    ok("before: the company has no access row (legacy default) and its sessions are usable", (await tacRow(victim)) === null && (await Promise.all(vLive.map((s) => stateOf(s.token)))).every((s) => s === "active"));
    const stepCode = codeFor(operator);
    suspendedAt = nowMs;
    const o = await actions.setCompanyAccessCore(req(), input(victim, "suspended", operator, { totpCode: stepCode, reason: `  ${REASON}\n  (second line)  ` }));
    ok("suspend → ok, status suspended, the three live sessions ended", o.ok && o.status === "suspended" && o.sessionsEnded === 3 && o.orgId === victim, JSON.stringify(o));
    const row = await tacRow(victim);
    ok("the access row: suspended, normalized reason, the operator, changed_at = created_at = updated_at = the action time", !!row && row.access_status === "suspended" && row.reason === `${REASON} (second line)` && row.changed_by_platform_admin_id === operator.id && row.changed_at?.getTime() === suspendedAt && row.created_at.getTime() === suspendedAt && row.updated_at.getTime() === suspendedAt, JSON.stringify(row));
    const reasonOf = async (t: Tenant) => (await q<{ revoked_reason: string | null; revoked_at: Date | null }>("select revoked_reason, revoked_at from sessions where token_hash = $1", [sha256(t.jti)]))[0];
    const live = await Promise.all(vLive.map(reasonOf));
    ok("…each live session revoked at the action time with reason org_suspended", live.every((r) => r.revoked_reason === "org_suspended" && r.revoked_at?.getTime() === suspendedAt), JSON.stringify(live));
    const exp = await reasonOf(vExpired);
    const out = await reasonOf(vLoggedOut);
    ok("…an already-expired session and an already-ended (logout) session are left exactly as they were", exp.revoked_at === null && exp.revoked_reason === null && out.revoked_reason === "logout");
    ok("…another company's session is untouched and usable", (await reasonOf(bLive)).revoked_at === null && (await stateOf(bLive.token)) === "active");
    const ev = (await accessEvents(victim)).filter((e) => e.result === "success");
    ok("…exactly one success record: company.suspended, by the operator, with the reason, before {active, legacy_default} and after {suspended, 3 sessions ended}",
      ev.length === 1 && ev[0].action === "company.suspended" && ev[0].org_id === victim && ev[0].actor_platform_admin_id === operator.id && ev[0].reason === `${REASON} (second line)` &&
        sameJson(ev[0].before_safe, { accessStatus: "active", source: "legacy_default" }) && sameJson(ev[0].after_safe, { accessStatus: "suspended", sessionsEnded: 3 }),
      JSON.stringify(ev));
    ok("…the code's time step is consumed", (await lastStep(operator)) === totp.totpStepAt(new Date(nowMs)));
    ok("…every session of the company now resolves to the suspended state (no usable session)", (await Promise.all(vLive.map((s) => stateOf(s.token)))).every((s) => s === "suspended"));
    const detail = await companies.getCompanyDetail(req(), String(victim));
    ok("…the company detail shows it, read in one statement: suspended (access record), reason, operator, change time, enforced", detail.access.status === "suspended" && detail.access.source === "access_control" && detail.access.reason === `${REASON} (second line)` && detail.access.changedBy === operator.displayName && detail.access.changedAt?.getTime() === suspendedAt && detail.access.enforced === true);
    const metrics = await companies.companyMetrics(req());
    ok("…and the dashboard figures count it as suspended", metrics.companies.suspended === seeded.suspended.length + 1 && metrics.companies.total === orgTotal + 2 && metrics.accessEnforced === true, JSON.stringify(metrics.companies));

    // The very same code again (a duplicate submission).
    const replay = await actions.setCompanyAccessCore(req(), input(victim, "suspended", operator, { totpCode: stepCode }));
    ok("a duplicate submission with the same code → MFA_INVALID (the step is spent), recorded as a replay", codeOf(replay) === "MFA_INVALID" && (await accessEvents(victim)).at(-1)?.after_safe?.stage === "replay", codeOf(replay));
    nextStep();
    const again = await actions.setCompanyAccessCore(req(), input(victim, "suspended", operator));
    const lastEv = (await accessEvents(victim)).at(-1);
    ok("a second suspension with a fresh code → CONFLICT, recorded (stage state, linked to the company); still exactly one success record", codeOf(again) === "CONFLICT" && lastEv?.after_safe?.stage === "state" && lastEv?.org_id === victim && (await accessEvents(victim)).filter((e) => e.result === "success").length === 1, codeOf(again));
    ok("…the conflicting attempt's code was rolled back with it (not consumed)", (await lastStep(operator)) < totp.totpStepAt(new Date(nowMs)));
    token = await signIn(operator, IP.main);
  }

  // ------------------------------------------------------------------------------------------------
  section("6. Concurrency: changes to one company serialize; one successful transition, one record");
  {
    const c1 = await tenantOrg("Concurrent Fixture One Co");
    const c1u = await tenantUser(c1, "owner@concurrent-one.test");
    const c1s = await customerSessionFor(c1, c1u);
    const secondToken = await signIn(second, IP.second);
    const [a, b] = await Promise.all([
      actions.setCompanyAccessCore(req(), input(c1, "suspended", operator)),
      actions.setCompanyAccessCore({ headers: headersFor(IP.second), token: secondToken }, input(c1, "suspended", second)),
    ]);
    const codes = [codeOf(a), codeOf(b)].sort();
    ok("two operators suspend the same company at once → exactly one OK and one CONFLICT", JSON.stringify(codes) === JSON.stringify(["CONFLICT", "OK"]), codes.join(","));
    const ev1 = await accessEvents(c1);
    ok("…exactly one success record and one rejected (state) record; one access row; the session ended once", ev1.filter((e) => e.result === "success").length === 1 && ev1.filter((e) => e.after_safe?.stage === "state").length === 1 && (await stateOf(c1s.token)) === "suspended" && (await sessionRows(c1)).filter((r) => r.revoked_reason === "org_suspended").length === 1);
    token = await signIn(operator, IP.main);
    const c2 = await tenantOrg("Concurrent Fixture Two Co");
    const dup = input(c2, "suspended", operator);
    const [x, y] = await Promise.all([actions.setCompanyAccessCore(req(), dup), actions.setCompanyAccessCore(req(), dup)]);
    const dupCodes = [codeOf(x), codeOf(y)].sort();
    ok("one operator double-submits the same request at once → exactly one OK; the other is refused (the code is single-use)", dupCodes.includes("OK") && dupCodes.filter((c) => c === "OK").length === 1 && ["MFA_INVALID", "CONFLICT"].includes(dupCodes.find((c) => c !== "OK") ?? ""), dupCodes.join(","));
    ok("…exactly one success record for that company", (await accessEvents(c2)).filter((e) => e.result === "success").length === 1);
    token = await signIn(operator, IP.main);
  }

  // ------------------------------------------------------------------------------------------------
  section("7. Atomicity: an audit, upsert or session failure applies nothing (and spends no code)");
  {
    const a1 = await tenantOrg("Atomic Fixture Co");
    const a1u = await tenantUser(a1, "owner@atomic.test");
    const a1s = await customerSessionFor(a1, a1u);
    const step0 = await lastStep(operator);
    const sameCode = codeFor(operator);
    await auditOutage(true);
    let outage: Outcome;
    try {
      outage = await actions.setCompanyAccessCore(req(), input(a1, "suspended", operator, { totpCode: sameCode }));
    } finally {
      await auditOutage(false);
    }
    ok("the audit record cannot be written → AUDIT_UNAVAILABLE", codeOf(outage) === "AUDIT_UNAVAILABLE", codeOf(outage));
    ok("…and NOTHING was applied: no access row, the session still live, no audit record, the code not consumed", (await tacRow(a1)) === null && (await stateOf(a1s.token)) === "active" && (await sessionRows(a1)).every((r) => r.revoked_at === null) && (await accessEvents(a1)).length === 0 && (await lastStep(operator)) === step0);
    const retry = await actions.setCompanyAccessCore(req(), input(a1, "suspended", operator, { totpCode: sameCode }));
    ok("once the trail works again the SAME code completes the change (its earlier use was rolled back)", retry.ok && retry.sessionsEnded === 1, codeOf(retry));
    nextStep();

    const a2 = await tenantOrg("Atomic Upsert Fixture Co");
    const a2u = await tenantUser(a2, "owner@atomic-upsert.test");
    const a2s = await customerSessionFor(a2, a2u);
    await q(`alter table tenant_access_controls add constraint po02c_test_only_block check (reason is distinct from 'Fixture: blocked change (test only)')`);
    let upsertFail: Outcome;
    try {
      upsertFail = await actions.setCompanyAccessCore(req(), input(a2, "suspended", operator, { reason: "Fixture: blocked change (test only)" }));
    } finally {
      await q(`alter table tenant_access_controls drop constraint po02c_test_only_block`);
    }
    ok("an access-row write that fails → CONFIG_ERROR (no detail); nothing applied, no audit record, the session still live", codeOf(upsertFail) === "CONFIG_ERROR" && (await tacRow(a2)) === null && (await stateOf(a2s.token)) === "active" && (await accessEvents(a2)).length === 0, codeOf(upsertFail));
    nextStep();
    await q(`create or replace function po02c_test_only_fail_sessions() returns trigger language plpgsql as $$ begin if new.revoked_reason = 'org_suspended' then raise exception 'injected session failure (test only)'; end if; return new; end $$`);
    await q(`create trigger po02c_test_only_fail_sessions before update on sessions for each row execute function po02c_test_only_fail_sessions()`);
    let sessionFail: Outcome;
    try {
      sessionFail = await actions.setCompanyAccessCore(req(), input(a2, "suspended", operator));
    } finally {
      await q(`drop trigger if exists po02c_test_only_fail_sessions on sessions`);
      await q(`drop function if exists po02c_test_only_fail_sessions()`);
    }
    ok("ending the sessions fails → CONFIG_ERROR; the access row written moments earlier is rolled back too; no audit record", codeOf(sessionFail) === "CONFIG_ERROR" && (await tacRow(a2)) === null && (await stateOf(a2s.token)) === "active" && (await accessEvents(a2)).length === 0, codeOf(sessionFail));
    token = await signIn(operator, IP.main);
  }

  // ------------------------------------------------------------------------------------------------
  section("8. Durable throttle: repeated step-up failures block the account, even with the right credentials");
  {
    const tToken = await signIn(throttled, IP.throttle);
    const tReq = { headers: headersFor(IP.throttle), token: tToken };
    const target = await tenantOrg("Throttle Fixture Co");
    const limit = PLATFORM_THROTTLE_POLICY.account[0].maxFailures;
    const results: string[] = [];
    for (let i = 0; i < limit + 1; i++) results.push(codeOf(await actions.setCompanyAccessCore(tReq, input(target, "suspended", throttled, { password: `Wrong-${i}-Password!x` }))));
    nextStep();
    const right = await actions.setCompanyAccessCore(tReq, input(target, "suspended", throttled));
    const ev = await accessEvents(target);
    ok(`after ${limit} failed step-ups the account is blocked: the next attempt → RATE_LIMITED, and so is one with the right password and code`, results.slice(0, limit).every((c) => c === "INVALID_CREDENTIALS") && results[limit] === "RATE_LIMITED" && codeOf(right) === "RATE_LIMITED", `${results.join(",")} / ${codeOf(right)}`);
    ok("…the blocked attempts are recorded (stage throttle); nothing applied", ev.filter((e) => e.after_safe?.stage === "throttle").length === 2 && (await tacRow(target)) === null);
  }

  // ------------------------------------------------------------------------------------------------
  section("9. Reactivation: same step-up, recorded, data and subscription untouched, no session recreated");
  {
    // A session created by a sign-in that raced the suspension (the missed-revocation case): not ended, but refused.
    const raced = await customerSessionFor(victim, vUser2);
    ok("a session that escaped the revocation is still refused on every request while suspended", (await stateOf(raced.token)) === "suspended");
    const liveCount = async () => Number((await q<{ n: number }>("select count(*)::int as n from sessions where org_id = $1 and revoked_at is null and expires_at > now()", [victim]))[0].n);
    const liveBefore = await liveCount();
    const reactivatedAt = nowMs;
    const r = await actions.setCompanyAccessCore(req(), input(victim, "active", operator, { reason: "Fixture: review completed, access restored" }));
    ok("reactivate → ok, status active; the escaped session was ended with it (every user signs in again)", r.ok && r.status === "active" && r.sessionsEnded === 1 && liveBefore === 1, JSON.stringify(r));
    const row = await tacRow(victim);
    ok("the access row: active, the reactivation reason and operator, changed now, created_at kept", !!row && row.access_status === "active" && row.reason === "Fixture: review completed, access restored" && row.changed_by_platform_admin_id === operator.id && row.changed_at?.getTime() === reactivatedAt && row.created_at.getTime() === suspendedAt && row.updated_at.getTime() === reactivatedAt, JSON.stringify(row));
    const ev = (await accessEvents(victim)).filter((e) => e.result === "success");
    ok("…recorded: company.reactivated with before {suspended, access_control} and after {active, 1 session ended}", ev.length === 2 && ev[1].action === "company.reactivated" && sameJson(ev[1].before_safe, { accessStatus: "suspended", source: "access_control" }) && sameJson(ev[1].after_safe, { accessStatus: "active", sessionsEnded: 1 }), JSON.stringify(ev.map((e) => e.after_safe)));
    const states = await Promise.all([...vLive, raced].map((s) => stateOf(s.token)));
    ok("…no session came back: every earlier token is signed out (the platform never recreates a session)", states.every((s) => s === "signed_out") && (await liveCount()) === 0, states.join(","));
    const fresh = await customerSessionFor(victim, vUser1);
    ok("…a fresh sign-in (a new session) is usable again", (await stateOf(fresh.token)) === "active");
    nextStep();
    const twice = await actions.setCompanyAccessCore(req(), input(victim, "active", operator));
    ok("reactivating an active company → CONFLICT", codeOf(twice) === "CONFLICT", codeOf(twice));
    token = await signIn(operator, IP.main);
  }

  // ------------------------------------------------------------------------------------------------
  section("10. Enforcement switched off: suspension refused, reactivation allowed, customer behavior as before PO-02C");
  {
    const off = await tenantOrg("Switch Off Fixture Co");
    const offU = await tenantUser(off, "owner@switch-off.test");
    const offS = await customerSessionFor(off, offU);
    const seededSuspended = seeded.suspended[0];
    const sU = await tenantUser(seededSuspended, "owner@seeded-suspended.test");
    const sS = await customerSessionFor(seededSuspended, sU);
    const step0 = await lastStep(operator);
    delete process.env.TENANT_ACCESS_ENFORCEMENT;
    try {
      const s = await actions.setCompanyAccessCore(req(), input(off, "suspended", operator));
      ok("suspend → ENFORCEMENT_DISABLED (it would be recorded but not applied), recorded as refused; no code consumed", codeOf(s) === "ENFORCEMENT_DISABLED" && (await accessEvents(off)).at(-1)?.after_safe?.stage === "enforcement_disabled" && (await lastStep(operator)) === step0 && (await tacRow(off)) === null, codeOf(s));
      ok("customer sessions behave exactly as before PO-02C: a suspended company's live session is usable, a revoked one is not", (await stateOf(sS.token)) === "active" && (await stateOf(offS.token)) === "active" && (await stateOf(vLive[0].token)) === "signed_out");
      const read = await actions.readCompanyAccessCore(req(), String(seededSuspended));
      ok("the access read reports enforced: false", read.ok && read.state.enforced === false && read.state.status === "suspended");
      const r = await actions.setCompanyAccessCore(req(), input(seededSuspended, "active", operator, { reason: "Fixture: reactivated while the switch is off" }));
      ok("reactivation stays possible while the switch is off", r.ok && r.status === "active", codeOf(r));
    } finally {
      process.env.TENANT_ACCESS_ENFORCEMENT = "enabled";
    }
    nextStep();
  }

  // ------------------------------------------------------------------------------------------------
  section("11. The customer gate (enforcement on): every session shape");
  {
    const legacyOrg = await tenantOrg("Gate Legacy Fixture Co");
    const lu = await tenantUser(legacyOrg, "owner@gate-legacy.test");
    const ls = await customerSessionFor(legacyOrg, lu);
    ok("a company without an access row (existing customer) → active", (await stateOf(ls.token)) === "active");
    const explicitOrg = seeded.explicitActive[0];
    const eu = await tenantUser(explicitOrg, "owner@gate-explicit.test");
    ok("an explicit active row → active", (await stateOf((await customerSessionFor(explicitOrg, eu)).token)) === "active");
    const susOrg = seeded.suspended[1];
    const su = await tenantUser(susOrg, "owner@gate-suspended.test");
    const missed = await customerSessionFor(susOrg, su);
    ok("a suspended company with a session the revocation MISSED (live row) → suspended: the check runs on every request", (await stateOf(missed.token)) === "suspended");
    ok("…a suspended company's session ended by the suspension → suspended (the access-suspended screen)", (await stateOf((await customerSessionFor(susOrg, su, { revokedReason: "org_suspended" })).token)) === "suspended");
    ok("…a suspended company's session ended otherwise (logout) → signed out", (await stateOf((await customerSessionFor(susOrg, su, { revokedReason: "logout" })).token)) === "signed_out");
    ok("an expired session row → signed out", (await stateOf((await customerSessionFor(legacyOrg, lu, { expiresInMs: -MIN })).token)) === "signed_out");
    const legacyActive = await tenantAuth.signSessionToken({ userId: lu, orgId: legacyOrg });
    const legacySuspended = await tenantAuth.signSessionToken({ userId: su, orgId: susOrg });
    secretsSeen.push(legacyActive, legacySuspended);
    ok("a legacy jti-less token: active company → active (allowed by default); suspended company → suspended (cannot bypass the suspension)", (await stateOf(legacyActive)) === "active" && (await stateOf(legacySuspended)) === "suspended");
    process.env.CUSTOMER_LEGACY_TOKENS = "reject";
    try {
      ok("D-8 proposal on (CUSTOMER_LEGACY_TOKENS=reject): every jti-less token → signed out; tokens with a session id are unaffected", (await stateOf(legacyActive)) === "signed_out" && (await stateOf(legacySuspended)) === "signed_out" && (await stateOf(ls.token)) === "active");
    } finally {
      delete process.env.CUSTOMER_LEGACY_TOKENS;
    }
    const lu2 = await tenantUser(legacyOrg, "staff@gate-legacy.test");
    const otherUsersRow = await tenantAuth.signSessionToken({ userId: lu2, orgId: legacyOrg, jti: ls.jti });
    const otherOrgClaim = await tenantAuth.signSessionToken({ userId: lu, orgId: explicitOrg, jti: ls.jti });
    secretsSeen.push(otherUsersRow, otherOrgClaim);
    ok("ownership mismatch: a token naming another user than its session row → signed out", (await stateOf(otherUsersRow)) === "signed_out");
    ok("ownership mismatch: a token naming another company than its session row → signed out", (await stateOf(otherOrgClaim)) === "signed_out");
    const mover = await tenantUser(legacyOrg, "mover@gate-legacy.test");
    const moverS = await customerSessionFor(legacyOrg, mover);
    await db.update(usersTable).set({ orgId: susOrg }).where(eq(usersTable.id, mover));
    ok("a user whose company changed after the token was issued → signed out", (await stateOf(moverS.token)) === "signed_out");
    const inactive = await tenantUser(legacyOrg, "inactive@gate-legacy.test");
    const inactiveS = await customerSessionFor(legacyOrg, inactive);
    await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, inactive));
    ok("a deactivated user → signed out", (await stateOf(inactiveS.token)) === "signed_out");
    const [h, p, s] = ls.token.split(".");
    ok("a tampered token signature → signed out", (await stateOf(`${h}.${p}.${s.slice(0, -2)}${s.endsWith("AA") ? "BB" : "AA"}`)) === "signed_out");

    // A drifted, unknown stored value fails closed.
    const drifted = await tenantOrg("Gate Drifted Fixture Co");
    const du = await tenantUser(drifted, "owner@gate-drifted.test");
    const ds = await customerSessionFor(drifted, du);
    await q("alter table tenant_access_controls drop constraint tenant_access_controls_status_chk");
    try {
      await q("insert into tenant_access_controls (org_id, access_status, reason, changed_by_platform_admin_id, changed_at, created_at, updated_at) values ($1, 'paused', 'Fixture: drifted value', $2, now(), now(), now())", [drifted, operator.id]);
      ok("a drifted, unknown stored status → suspended (fails closed)", (await stateOf(ds.token)) === "suspended" && (await gate.orgAccessDecision(drifted)) === "suspended");
      await q("delete from tenant_access_controls where org_id = $1", [drifted]);
    } finally {
      await q("alter table tenant_access_controls add constraint tenant_access_controls_status_chk check (access_status in ('active', 'suspended'))");
    }

    // Missing objects: never read as a missing row.
    await q("alter table tenant_access_controls rename to tenant_access_controls_hidden_test_only");
    let missingTable: string[] = [];
    try {
      missingTable = [await stateOf(ls.token), await gate.orgAccessDecision(legacyOrg), String(await gate.orgAccessAllowed(legacyOrg))];
    } finally {
      await q("alter table tenant_access_controls_hidden_test_only rename to tenant_access_controls");
    }
    ok("the access table missing → unavailable (denied, and never shown as a suspension); orgAccessAllowed false", JSON.stringify(missingTable) === JSON.stringify(["unavailable", "unavailable", "false"]), missingTable.join(","));
    await q("alter table tenant_access_controls rename column access_status to access_status_hidden_test_only");
    let missingColumn: string[] = [];
    try {
      missingColumn = [await stateOf(ls.token), await gate.orgAccessDecision(legacyOrg)];
    } finally {
      await q("alter table tenant_access_controls rename column access_status_hidden_test_only to access_status");
    }
    ok("a column missing → unavailable as well", JSON.stringify(missingColumn) === JSON.stringify(["unavailable", "unavailable"]), missingColumn.join(","));
    ok("…and once restored the same session is active again", (await stateOf(ls.token)) === "active");
  }

  // ------------------------------------------------------------------------------------------------
  section("12. Races: what completed before the commit, what starts after it");
  {
    // (a) Session validations racing the suspension.
    const r1 = await tenantOrg("Race Validation Fixture Co");
    const r1u = await tenantUser(r1, "owner@race-validation.test");
    const tokens = await Promise.all(Array.from({ length: 12 }, () => customerSessionFor(r1, r1u)));
    type Sample = { start: number; end: number; state: string };
    const samples: Sample[] = [];
    let running = true;
    const workers = Array.from({ length: 6 }, async (_, w) => {
      for (let i = 0; running || i < 3; i++) {
        const start = performance.now();
        const state = await stateOf(tokens[(w + i) % tokens.length].token);
        samples.push({ start, end: performance.now(), state });
        if (!running && i > 2) break;
      }
    });
    await sleep(60);
    const t0 = performance.now();
    const o = await actions.setCompanyAccessCore(req(), input(r1, "suspended", operator));
    const t1 = performance.now();
    await sleep(60);
    running = false;
    await Promise.all(workers);
    const before = samples.filter((s) => s.end < t0);
    const after = samples.filter((s) => s.start > t1);
    const overlap = samples.filter((s) => !(s.end < t0) && !(s.start > t1));
    ok("validations that FINISHED before the suspension started saw the company active", o.ok && before.length > 0 && before.every((s) => s.state === "active"), `${before.length} samples`);
    ok("every validation that STARTED after the suspension returned saw it suspended (no usable session after the commit)", after.length > 0 && after.every((s) => s.state === "suspended"), `${after.length} samples`);
    ok("…validations overlapping the transaction saw either state — no in-flight cutoff is claimed", overlap.every((s) => s.state === "active" || s.state === "suspended"), `${overlap.length} overlapping`);
    if (EVIDENCE) writeFileSync(join(EVIDENCE, "race-validation.json"), JSON.stringify({ before: before.length, overlapping: overlap.length, after: after.length, overlappingStates: overlap.map((s) => s.state) }, null, 2));
    nextStep();

    // (b) A sign-in racing the suspension: the access check passed just before the commit, the session row is written just after.
    const r2 = await tenantOrg("Race Sign-in Fixture Co");
    const r2u = await tenantUser(r2, "owner@race-signin.test");
    const checkedBefore = await gate.orgAccessDecision(r2);
    const s2 = await actions.setCompanyAccessCore(req(), input(r2, "suspended", operator));
    ok("issueSession's own re-check, run after the commit, refuses the company (defence in depth)", (await gate.orgAccessAllowed(r2)) === false);
    const late = await customerSessionFor(r2, r2u);
    ok("a sign-in whose check ran before the commit (active) but whose session row lands after it: the row is live, yet refused on every request", checkedBefore === "active" && s2.ok && s2.sessionsEnded === 0 && (await stateOf(late.token)) === "suspended");
    nextStep();
    const back = await actions.setCompanyAccessCore(req(), input(r2, "active", operator, { reason: "Fixture: race sign-in reactivation" }));
    ok("…and reactivation ends that escaped session, so it never becomes usable: the user signs in again", back.ok && back.sessionsEnded === 1 && (await stateOf(late.token)) === "signed_out");
    nextStep();

    // (c) A signed-file request racing the suspension (the uploads route's decision; served bytes are tested in the browser suite).
    const r3 = await tenantOrg("Race File Fixture Co");
    const fileBefore = await gate.orgAccessAllowed(r3);
    await actions.setCompanyAccessCore(req(), input(r3, "suspended", operator));
    ok("signed-file decision: served before the commit, refused for every request after it", fileBefore === true && (await gate.orgAccessAllowed(r3)) === false);
    nextStep();

    // (d) A business write racing the suspension.
    const r4 = await tenantOrg("Race Business Fixture Co");
    const r4u = await tenantUser(r4, "owner@race-business.test");
    const r4s = await customerSessionFor(r4, r4u);
    const writer = await connectDisposable(process.env.DATABASE_URL!);
    const prober = await connectDisposable(process.env.DATABASE_URL!);
    let committed = false;
    let lockEvidence = "";
    try {
      await writer.query("begin");
      await writer.query("insert into customers (org_id, name) values ($1, $2)", [r4, "Fixture customer written in flight"]); // holds FOR KEY SHARE on the org row
      await prober.query("begin");
      await prober.query("set local lock_timeout = '300ms'");
      try {
        await prober.query("select id from orgs where id = $1 for update", [r4]);
        lockEvidence = "FOR UPDATE was granted";
      } catch (e) {
        lockEvidence = sqlState(e) ?? describeError(e);
      }
      await prober.query("rollback");
      const t = performance.now();
      const s4 = await actions.setCompanyAccessCore(req(), input(r4, "suspended", operator));
      const waited = performance.now() - t;
      ok("the suspension's FOR NO KEY UPDATE lock does not wait for a business transaction that inserts rows of that company (FOR UPDATE would: lock timeout 55P03)", s4.ok && lockEvidence === "55P03" && waited < 3000, `${lockEvidence}, ${waited.toFixed(0)} ms`);
      await writer.query("commit");
      committed = true;
    } finally {
      if (!committed) await writer.query("rollback").catch(() => undefined);
      await writer.end();
      await prober.end();
    }
    const kept = await q<{ n: number }>("select count(*)::int as n from customers where org_id = $1 and name = 'Fixture customer written in flight'", [r4]);
    ok("an operation already in flight when the suspension committed completes (its row is kept) — PO-02C does not claim an in-flight cutoff", kept[0].n === 1);
    ok("an operation starting after the commit is refused at the session check", (await stateOf(r4s.token)) === "suspended");
    nextStep();
  }

  // ------------------------------------------------------------------------------------------------
  section("13. Data protection: a suspend + reactivate cycle writes nothing but its own rows");
  {
    const d = await tenantOrg("Data Protection Fixture Co");
    const du = await tenantUser(d, "owner@data-protection.test");
    await customerSessionFor(d, du);
    await q("insert into customers (org_id, name) values ($1, 'Fixture customer A'), ($1, 'Fixture customer B')", [d]);
    const tables = (await q<{ t: string }>("select tablename as t from pg_tables where schemaname = 'public' order by 1")).map((r) => r.t);
    const checksum = async (t: string, where = "") => (await q<{ h: string }>(`select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from "${t}" x ${where}`))[0].h;
    const ALLOWED = new Set(["tenant_access_controls", "platform_audit_events", "platform_admins", "platform_sessions", "platform_login_attempts", "sessions"]);
    const snap = async () => Object.fromEntries(await Promise.all(tables.filter((t) => !ALLOWED.has(t)).map(async (t) => [t, await checksum(t)] as const)));
    const sessionsElsewhere = async () => checksum("sessions", `where org_id <> ${Number(d)}`);
    const sessionsHereStable = async () => (await q<{ h: string }>(`select md5(coalesce(string_agg(row(id, org_id, user_id, token_hash, ip_address, user_agent, expires_at, created_at)::text, '|' order by id), '')) as h from sessions where org_id = $1`, [d]))[0].h;
    const before = await snap();
    const beforeElsewhere = await sessionsElsewhere();
    const beforeHere = await sessionsHereStable();
    const s = await actions.setCompanyAccessCore(req(), input(d, "suspended", operator));
    nextStep();
    const r = await actions.setCompanyAccessCore(req(), input(d, "active", operator, { reason: "Fixture: data protection cycle done" }));
    const after = await snap();
    const changed = Object.keys(before).filter((t) => before[t] !== after[t]);
    ok(`every one of the ${Object.keys(before).length} other tables (orgs, users, customers, accounting, invoices, stock, HR, documents, settings …) is byte-identical after the cycle`, s.ok && r.ok && changed.length === 0 && Object.keys(before).length > 40, changed.join(", "));
    ok("…other companies' sessions are byte-identical; this company's sessions changed only in revoked_at / revoked_reason", (await sessionsElsewhere()) === beforeElsewhere && (await sessionsHereStable()) === beforeHere);
    ok("…no customer session was created by the platform (impersonation impossible): this company's session count is unchanged", Number((await q<{ n: number }>("select count(*)::int as n from sessions where org_id = $1", [d]))[0].n) === 1);
    ok("…subscription state is not a factor: no subscription table exists yet, and none was created", !tables.some((t) => /subscription/.test(t)));
    const auditText = JSON.stringify(await q("select * from platform_audit_events"));
    const leaked = secretsSeen.filter((v) => v.length >= 8 && auditText.includes(v));
    ok("no password, TOTP secret, recovery code, platform token, customer token or session id appears in any audit record", leaked.length === 0, `${leaked.length} leaked`);
  }

  // ------------------------------------------------------------------------------------------------
  section("14. The access read: manage_access, one statement, current state");
  {
    const legacy = await tenantOrg("Read Legacy Fixture Co");
    const r1 = await capture(() => actions.readCompanyAccessCore(req(), String(legacy)));
    const orgReads = r1.texts.filter((t) => /"orgs"/.test(t));
    ok("a legacy company: active / legacy_default, its reference, enforced — from ONE statement over orgs + access row + operator", r1.value.ok && r1.value.state.status === "active" && r1.value.state.source === "legacy_default" && r1.value.state.reference === companies.orgReference(legacy) && r1.value.state.enforced === true && orgReads.length === 1 && /left join "tenant_access_controls"/.test(orgReads[0]) && /left join "platform_admins"/.test(orgReads[0]), `${orgReads.length} statements`);
    const r2 = await actions.readCompanyAccessCore(req(), String(victim));
    ok("a reactivated company: active / access_control, with the operator and change time", r2.ok && r2.state.status === "active" && r2.state.source === "access_control" && r2.state.changedBy === operator.displayName && !!r2.state.changedAt);
    const r3 = await actions.readCompanyAccessCore(req(), "2000000");
    const r4 = await actions.readCompanyAccessCore(req(), "x1");
    ok("unknown and malformed ids → NOT_FOUND", !r3.ok && r3.code === "NOT_FOUND" && !r4.ok && r4.code === "NOT_FOUND");
    const detail = await capture(() => companies.getCompanyDetail(req(), String(victim)));
    const accessReads = detail.texts.filter((t) => /"tenant_access_controls"/.test(t));
    ok("the company detail reads its access state in ONE statement (PO-02B read it twice)", accessReads.length === 1 && /"orgs"/.test(accessReads[0]), `${accessReads.length} statements`);
  }

  // ------------------------------------------------------------------------------------------------
  section("15. Performance: the session check at 1,000+ organizations, enforcement off vs on");
  {
    const owners = await q<{ org_id: number; id: number }>("select distinct on (org_id) org_id, id from users where role = 'owner' and is_active and org_id = any($1::int[]) order by org_id, id", [seeded.orgIds]);
    const pool300 = owners.filter((o) => !seeded.suspended.includes(o.org_id)).slice(0, 300);
    const toks = await Promise.all(pool300.map((o) => customerSessionFor(o.org_id, o.id)));
    const measure = async (n: number) => {
      const lat: number[] = [];
      for (let i = 0; i < n; i++) {
        const t = toks[i % toks.length].token;
        const s = performance.now();
        const st = await customerSession.resolveSessionToken(t);
        lat.push(performance.now() - s);
        if (st.status !== "active") throw new Error(`unexpected ${st.status}`);
      }
      lat.sort((a, b) => a - b);
      const pct = (p: number) => lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))];
      return { n, p50: +pct(50).toFixed(3), p95: +pct(95).toFixed(3), p99: +pct(99).toFixed(3), mean: +(lat.reduce((a, b) => a + b, 0) / lat.length).toFixed(3) };
    };
    const queriesPerCheck = async () => (await capture(() => customerSession.resolveSessionToken(toks[0].token))).texts.length;
    delete process.env.TENANT_ACCESS_ENFORCEMENT;
    await measure(60);
    const off = await measure(600);
    const qOff = await queriesPerCheck();
    process.env.TENANT_ACCESS_ENFORCEMENT = "enabled";
    await measure(60);
    const on = await measure(600);
    const qOn = await queriesPerCheck();
    const orgsNow = Number((await q<{ n: number }>("select count(*)::int as n from orgs"))[0].n);
    console.log(`  note  session check, ${orgsNow} organizations, ${toks.length} tokens: off p50 ${off.p50} ms / p95 ${off.p95} ms (${qOff} queries); on p50 ${on.p50} ms / p95 ${on.p95} ms (${qOn} queries)`);
    ok(`measured at ${orgsNow} organizations (≥ 1,000)`, orgsNow >= 1000);
    ok("enforcement adds exactly ONE query to a session check (2 → 3)", qOff === 2 && qOn === 3, `${qOff} → ${qOn}`);
    ok("…and its p95 stays within 3× the switched-off p95 + 5 ms (loopback)", on.p95 <= off.p95 * 3 + 5, JSON.stringify({ off, on }));
    // Plans: the default plan (what the planner picks at this size — a ~130-row access table may be scanned), and the
    // plan with sequential scans disabled, which proves the index path exists. Both in a rolled-back transaction.
    const explain = async (text: string, params: unknown[], indexOnly: boolean) => {
      const c = await pool.connect();
      try {
        await c.query("begin");
        if (indexOnly) await c.query("set local enable_seqscan = off");
        const rows = (await c.query(`explain ${text}`, params)).rows as { "QUERY PLAN": string }[];
        return rows.map((r) => r["QUERY PLAN"]).join("\n");
      } finally {
        await c.query("rollback").catch(() => undefined);
        c.release();
      }
    };
    const LOOKUP = "select o.id, t.org_id, t.access_status from orgs o left join tenant_access_controls t on t.org_id = o.id where o.id = $1 limit 1";
    const END = "update sessions set revoked_at = now(), revoked_reason = 'org_suspended' where org_id = $1 and revoked_at is null and expires_at > now()";
    const lookupDefault = await explain(LOOKUP, [seeded.orgIds[5]], false);
    const lookupIndexed = await explain(LOOKUP, [seeded.orgIds[5]], true);
    const endDefault = await explain(END, [seeded.orgIds[5]], false);
    const endIndexed = await explain(END, [seeded.orgIds[5]], true);
    console.log(`  note  default plans at this size — lookup: ${/Seq Scan on tenant_access_controls/.test(lookupDefault) ? "orgs_pkey + seq scan of the small access table" : "index probes"}; end sessions: ${/sessions_org_active_idx/.test(endDefault) ? "sessions_org_active_idx" : "other"}`);
    ok("the access lookup has a primary-key path for both tables (orgs_pkey, tenant_access_controls_pkey) — no full scan of orgs at any size", /orgs_pkey/.test(lookupDefault) && /orgs_pkey/.test(lookupIndexed) && /tenant_access_controls_pkey/.test(lookupIndexed), lookupIndexed.replace(/\n/g, " | "));
    ok("ending one company's sessions uses the partial index sessions_org_active_idx (PO-02A M4)", /sessions_org_active_idx/.test(endDefault) && /sessions_org_active_idx/.test(endIndexed), endDefault.replace(/\n/g, " | "));
    if (EVIDENCE) writeFileSync(join(EVIDENCE, "performance.json"), JSON.stringify({ organizations: orgsNow, tokens: toks.length, off: { ...off, queries: qOff }, on: { ...on, queries: qOn }, plans: { lookupDefault, lookupIndexed, endDefault, endIndexed } }, null, 2));
  }
}

let code = 1;
try {
  await main();
  code = summary("verify:platform-company-access");
} catch (e) {
  console.error(`verify:platform-company-access crashed: ${describeError(e)}`);
  code = 1;
} finally {
  await pool.end().catch(() => undefined);
  if (created) await dropDisposableDatabase(testDbName).catch(() => undefined);
}
process.exit(code);
