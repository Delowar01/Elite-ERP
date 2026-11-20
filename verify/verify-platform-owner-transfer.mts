/**
 * Platform Owner PO-03C, sub-batch A — the primary-owner transfer and the console's role control, on real PostgreSQL:
 * src/lib/platform/customer-user-actions.ts (transferPrimaryOwnerCore, changeCustomerUserRoleCore), the read model's
 * role state and transfer options (src/lib/platform/customer-users.ts) and the shared customer-user mutation service
 * (src/lib/team/customer-user-core.ts — the ONE role write and the ONE demotion rule).
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://…/<admin db with _test_only_> npm run verify:platform-owner-transfer
 *
 * One disposable database (dropped at the end): the reviewed schema and platform SQL plus the PO-02D1B Trial seed.
 * Fictional companies, users, sessions and operators only; TEST-ONLY secrets generated in memory and never printed. Every
 * race runs in a known interleaving: a barrier (a held transaction or row lock) is observed waiting in pg_stat_activity
 * before it is released.
 *
 * Categories (docs/platform-owner/PO03C_DEVELOPMENT.md §C, §D, §I): X1 authorization · X2 the transfer options ·
 * X3 a transfer · X4 transfer refusals · X5 legacy and missing mappings · X6 concurrent transfers, transfer vs disable ·
 * X7 stale pages · X8 audit / evidence failure and an interrupted transaction roll everything back · R1 a role change ·
 * R2 role refusals (primary owner, last active owner, invalid roles, cross-company ids, stale data, a consumed code) ·
 * R3 two operators changing one role · P no business record changed, nothing secret printed or audited.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { connectDisposable, createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { describeError, ok, section, summary } from "./platform/harness";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const testDbName = disposableName("po03c_transfer");
process.env.DATABASE_URL = databaseUrlFor(testDbName);
process.env.PLATFORM_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.FIELD_ENCRYPTION_KEYS = `1:${randomBytes(32).toString("base64")}`;
process.env.PLATFORM_CONSOLE_ENABLED = "true";
process.env.PLATFORM_TRUSTED_PROXY_HOPS = "1";
process.env.TENANT_ACCESS_ENFORCEMENT = "enabled";
delete process.env.CUSTOMER_LEGACY_TOKENS;
delete process.env.PLATFORM_INVITATIONS_ENABLED;
delete process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED;

let created = false;
await createPlatformTestDatabase("po03c_transfer", testDbName);
created = true;
{
  const { runSeed } = await import("../scripts/platform/trial-seed");
  const seeded = await runSeed(process.env.DATABASE_URL);
  if (seeded.check.state !== "complete") throw new Error(`the Trial seed did not complete: ${seeded.check.state}`);
}

const { db, pool, platformAdminsTable } = await import("../src/db");
const auth = await import("../src/lib/platform/auth");
const mfa = await import("../src/lib/platform/mfa");
const totp = await import("../src/lib/platform/totp");
const { platformClock } = await import("../src/lib/platform/clock");
const console_ = await import("../src/lib/platform/console");
const guards = await import("../src/lib/platform/guards");
const controls = await import("../src/lib/platform/customer-user-actions");
const tenantAuth = await import("../src/lib/auth");
{
  const require = createRequire(import.meta.url);
  const navPath = require.resolve("next/navigation");
  require.cache[navPath] = { id: navPath, filename: navPath, loaded: true, exports: require("next/dist/api/navigation.react-server.js") } as unknown as NodeJS.Module;
}
const customerSession = await import("../src/lib/session");
type Role = import("../src/db").Role;
(pool as unknown as { options: { max: number } }).options.max = 30;
pool.on("error", () => undefined);
pool.on("connect", (client) => client.on("error", () => undefined));

const logged: string[] = [];
for (const level of ["log", "info", "warn", "error"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
    original(...(args as []));
  };
}

// ---- helpers -------------------------------------------------------------------------------------------------------
const q = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
const one = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await q<T>(text, values))[0];
const n = async (text: string, values: unknown[] = []) => Number((await one<{ n: number }>(text, values))?.n ?? 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
let seq = 0;
const tag = () => `${Date.now().toString(36)}${++seq}`;

let nowMs = Math.floor(Date.now() / 1000) * 1000;
platformClock.now = () => new Date(nowMs);
const nextStep = () => {
  nowMs = (totp.totpStepAt(new Date(nowMs)) + 1) * 30_000 + 1_000;
};
const HOST = "console.erp.test";
const headersFor = (ip: string, over: Record<string, string | null> = {}) => {
  const h = new Headers({ host: HOST, origin: `https://${HOST}`, "sec-fetch-site": "same-origin", "user-agent": "verify-platform-owner-transfer", "x-forwarded-for": ip });
  for (const [k, v] of Object.entries(over)) if (v === null) h.delete(k);
  else h.set(k, v);
  return h;
};
const OPERATOR_IP = "203.0.113.61";

const STRONG = "Lantern-Copse-48!q";
const secretsSeen: string[] = [STRONG];
type Admin = { id: string; email: string; secret: string; displayName: string; token: string };
async function createAdmin(email: string, displayName: string): Promise<Admin> {
  const { secret } = mfa.createTotpEnrollment(email);
  const { codes, hashes } = await mfa.createRecoveryCodeSet();
  const at = new Date(nowMs);
  const [row] = await db
    .insert(platformAdminsTable)
    .values({ emailNormalized: email, displayName, passwordHash: await auth.hashPlatformPassword(STRONG), isActive: true, mfaSecretEncrypted: mfa.encryptTotpSecret(secret), mfaRecoveryHashes: hashes, mfaEnrolledAt: at, passwordChangedAt: at, createdAt: at, updatedAt: at })
    .returning({ id: platformAdminsTable.id });
  secretsSeen.push(secret, ...codes);
  const a: Admin = { id: row.id, email, secret, displayName, token: "" };
  nextStep();
  const r = await console_.signInCore({ email, password: STRONG, totpCode: codeFor(a) }, { headers: headersFor(OPERATOR_IP) });
  if (!r.ok) throw new Error(`fixture sign-in failed: ${r.code}`);
  secretsSeen.push(r.token);
  a.token = r.token;
  nextStep();
  return a;
}
const codeFor = (a: Admin, offset = 0) => totp.hotpCode(a.secret, totp.totpStepAt(new Date(nowMs)) + offset);
const lastStep = async (a: Admin) => Number((await one<{ s: string | null }>("select mfa_last_totp_step::text as s from platform_admins where id = $1", [a.id]))?.s ?? -1);
const req = (a: Admin, over: Record<string, string | null> = {}) => ({ headers: headersFor(OPERATOR_IP, over), token: a.token });
const REASON = "Fixture: ownership change requested in writing by the company";

const bcryptPad = (stem: string) => "$2b$10$" + (stem + "Q".repeat(53)).slice(0, 53);
const CANARY = { hash: bcryptPad("CanaryTransferHashP3"), mfa: "v1:CANARY_TRANSFER_MFA_ENVELOPE_P3", rec: "v1:CANARY_TRANSFER_RECOVERY_ENVELOPE_P3" };
async function newOrg(name = `Transfer Fixture ${tag()}`): Promise<number> {
  return Number((await one<{ id: number }>(`insert into orgs (name, country, currency) values ($1, 'Saudi Arabia', 'SAR') returning id`, [name]))!.id);
}
async function newUser(orgId: number, role: Role, label: string = role, active = true): Promise<number> {
  const t1 = tag();
  const row = await one<{ id: number }>(
    `insert into users (org_id, email, password_hash, name, role, is_active, mfa_secret, mfa_recovery_codes) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [orgId, `${label}.${t1}@transfer-fixture.test`, CANARY.hash, `Fixture ${label} ${t1}`, role, active, CANARY.mfa, CANARY.rec],
  );
  return Number(row!.id);
}
const mapPrimary = (orgId: number, userId: number) => q(`insert into tenant_primary_owners (org_id, user_id) values ($1, $2)`, [orgId, userId]);
type Tenant = { token: string; tokenHash: string };
async function sessionFor(orgId: number, userId: number): Promise<Tenant> {
  const jti = randomBytes(24).toString("base64url");
  const tokenHash = sha256(jti);
  await q(`insert into sessions (org_id, user_id, token_hash, ip_address, user_agent, expires_at) values ($1, $2, $3, '192.0.2.61', 'TransferFixtureAgent/1', $4)`, [orgId, userId, tokenHash, new Date(Date.now() + 30 * 86_400_000)]);
  const token = await tenantAuth.signSessionToken({ userId, orgId, jti });
  secretsSeen.push(jti, token, tokenHash);
  return { token, tokenHash };
}
const stateOf = async (token: string) => (await customerSession.resolveSessionToken(token)).status;
const reasonOf = async (tokenHash: string) => (await one<{ r: string | null }>(`select revoked_reason as r from sessions where token_hash = $1`, [tokenHash]))?.r ?? null;
const userRow = (id: number) => one<{ role: string; is_active: boolean }>(`select role, is_active from users where id = $1`, [id]);
const mapped = async (orgId: number) => (await one<{ user_id: number }>(`select user_id from tenant_primary_owners where org_id = $1`, [orgId]))?.user_id ?? null;
async function versionOf(userId: number): Promise<string> {
  return (await one<{ v: string }>(`select to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') as v from users where id = $1`, [userId]))!.v;
}
type Outcome = { ok: true } | { ok: false; code: string };
const codeOf = (o: Outcome) => (o.ok ? "OK" : o.code);

async function transfer(a: Admin, orgId: number, fromUserId: number, toUserId: number, over: Partial<{ reason: string; totpCode: string; fromVersion: string; toVersion: string; headers: Record<string, string | null> }> = {}) {
  nextStep();
  const fromVersion = over.fromVersion ?? (await versionOf(fromUserId));
  const toVersion = over.toVersion ?? (await versionOf(toUserId));
  return controls.transferPrimaryOwnerCore(req(a, over.headers ?? {}), {
    orgId: String(orgId),
    fromUserId: String(fromUserId),
    toUserId: String(toUserId),
    fromVersion,
    toVersion,
    reason: over.reason ?? REASON,
    totpCode: over.totpCode ?? codeFor(a),
  });
}
async function setRole(a: Admin, userId: number, orgId: number, role: string, over: Partial<{ reason: string; totpCode: string; version: string }> = {}) {
  nextStep();
  const version = over.version ?? (await versionOf(userId));
  return controls.changeCustomerUserRoleCore(req(a), { userId: String(userId), orgId: String(orgId), role, reason: over.reason ?? REASON, totpCode: over.totpCode ?? codeFor(a), version });
}
const companyAudits = (orgId: number) => q<{ action: string; result: string; before_safe: Record<string, unknown> | null; after_safe: Record<string, unknown> | null }>(`select action, result, before_safe, after_safe from platform_audit_events where entity_type = 'company' and entity_id = $1 order by id`, [String(orgId)]);
const userAudits = (userId: number) => q<{ action: string; result: string; before_safe: Record<string, unknown> | null; after_safe: Record<string, unknown> | null }>(`select action, result, before_safe, after_safe from platform_audit_events where entity_type = 'customer_user' and entity_id = $1 order by id`, [String(userId)]);
const evidence = (userId: number) =>
  q<{ type: string; metadata: Record<string, unknown> | null; ip_address: string | null; user_agent: string | null; browser: string | null; os: string | null; device: string | null }>(
    `select type, metadata, ip_address, user_agent, browser, os, device from security_events where user_id = $1 and type like '%by_platform' order by id`,
    [userId],
  );

// ---- barriers ------------------------------------------------------------------------------------------------------
type Blocker = { release: (commit?: boolean) => Promise<void> };
async function blocker(lockSql: string, values: unknown[] = []): Promise<Blocker> {
  const client: pg.Client = await connectDisposable(process.env.DATABASE_URL!);
  client.on("error", () => undefined);
  await client.query("begin");
  await client.query(lockSql, values);
  return {
    release: async (commit = false) => {
      await client.query(commit ? "commit" : "rollback").catch(() => undefined);
      await client.end().catch(() => undefined);
    },
  };
}
async function lockWaiters(re: RegExp): Promise<number> {
  const rows = await q<{ query: string }>(`select query from pg_stat_activity where datname = current_database() and state = 'active' and wait_event_type = 'Lock'`);
  return rows.filter((r) => re.test(r.query)).length;
}
async function until(cond: () => Promise<boolean>, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return true;
    await sleep(25);
  }
  return false;
}
const ORG_ROW_LOCK = /from "orgs"[\s\S]*for (no key update|share)/i;

const NOT_BUSINESS = new Set(["users", "sessions", "security_events", "activity_logs"]);
async function businessChecksum(): Promise<string> {
  const tables = (await q<{ t: string }>(`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`)).map((r) => r.t).filter((t) => !NOT_BUSINESS.has(t) && !t.startsWith("platform_") && t !== "tenant_primary_owners");
  const parts: string[] = [];
  for (const t of tables) {
    const r = await one<{ c: number; h: string | null }>(`select count(*)::int as c, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from "${t}" x`);
    parts.push(`${t}:${r?.c}:${r?.h}`);
  }
  return sha256(parts.join("\n"));
}
async function failingInsert(table: "platform_audit_events" | "security_events", on: boolean, when = "true") {
  const fn = `po03c_test_only_fail_${table}`;
  if (on) {
    await q(`create or replace function ${fn}() returns trigger language plpgsql as $$ begin if ${when} then raise exception 'injected outage (test only)'; end if; return new; end $$`);
    await q(`create trigger ${fn} before insert on ${table} for each row execute function ${fn}()`);
  } else {
    await q(`drop trigger if exists ${fn} on ${table}`);
    await q(`drop function if exists ${fn}()`);
  }
}

async function main() {
  const operator = await createAdmin("operator@transfer-fixture.test", "Fixture Operator");
  const second = await createAdmin("second@transfer-fixture.test", "Second Operator");

  // Company A: a mapped primary owner, a second owner, an admin, staff and a disabled staff.
  const A = await newOrg("Transfer Fixture Alpha");
  const aPrimary = await newUser(A, "owner", "aprimary");
  await mapPrimary(A, aPrimary);
  const aOwner2 = await newUser(A, "owner", "aowner2");
  const aAdmin = await newUser(A, "admin", "aadmin");
  const aStaff = await newUser(A, "staff", "astaff");
  const aDisabled = await newUser(A, "staff", "adisabled", false);
  // Company B (another company) and a legacy company L (no mapping).
  const B = await newOrg("Transfer Fixture Beta");
  const bPrimary = await newUser(B, "owner", "bprimary");
  await mapPrimary(B, bPrimary);
  const bStaff = await newUser(B, "staff", "bstaff");
  const L = await newOrg("Transfer Fixture Legacy");
  const lOwner = await newUser(L, "owner", "lowner");
  const lStaff = await newUser(L, "staff", "lstaff");
  // Companies for the races and rollbacks.
  const C = await newOrg("Transfer Fixture Gamma");
  const cPrimary = await newUser(C, "owner", "cprimary");
  await mapPrimary(C, cPrimary);
  const cOne = await newUser(C, "staff", "cone");
  const cTwo = await newUser(C, "admin", "ctwo");
  const D = await newOrg("Transfer Fixture Delta");
  const dPrimary = await newUser(D, "owner", "dprimary");
  await mapPrimary(D, dPrimary);
  const dTarget = await newUser(D, "staff", "dtarget");
  const E = await newOrg("Transfer Fixture Epsilon");
  const ePrimary = await newUser(E, "owner", "eprimary");
  await mapPrimary(E, ePrimary);
  const eTarget = await newUser(E, "staff", "etarget");
  const rUser = await newUser(A, "staff", "rstaff", true);
  const G = await newOrg("Transfer Fixture Eta");
  const gPrimary = await newUser(G, "owner", "gprimary");
  await mapPrimary(G, gPrimary);
  const gTarget = await newUser(G, "staff", "gtarget");
  const F = await newOrg("Transfer Fixture Phi");
  const fPrimary = await newUser(F, "owner", "fprimary");
  await mapPrimary(F, fPrimary);
  const fTarget = await newUser(F, "staff", "ftarget");
  const businessBefore = await businessChecksum();

  // ===================================================================================================================
  section("X1. Authorization (server-side, in order)");
  {
    const noSession = await controls.transferPrimaryOwnerCore({ headers: headersFor(OPERATOR_IP), token: null }, { orgId: String(A), fromUserId: String(aPrimary), toUserId: String(aStaff), fromVersion: "x", toVersion: "x", reason: REASON, totpCode: "000000" });
    const forged = await controls.changeCustomerUserRoleCore({ headers: headersFor(OPERATOR_IP), token: "forged.token.value" }, { userId: String(aStaff), orgId: String(A), role: "admin", reason: REASON, totpCode: "000000", version: "x" });
    const customerTok = await sessionFor(A, aAdmin);
    const asCustomer = await controls.changeCustomerUserRoleCore({ headers: headersFor(OPERATOR_IP), token: customerTok.token }, { userId: String(aStaff), orgId: String(A), role: "owner", reason: REASON, totpCode: "000000", version: "x" });
    const crossSite = await controls.changeCustomerUserRoleCore(req(operator, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }), { userId: String(aStaff), orgId: String(A), role: "owner", reason: REASON, totpCode: codeFor(operator), version: await versionOf(aStaff) });
    ok("X1a no session, a forged token and a CUSTOMER token are UNAUTHORIZED; a cross-site request is FORBIDDEN — before anything is read or spent", codeOf(noSession) === "UNAUTHORIZED" && codeOf(forged) === "UNAUTHORIZED" && codeOf(asCustomer) === "UNAUTHORIZED" && codeOf(crossSite) === "FORBIDDEN", [noSession, forged, asCustomer, crossSite].map(codeOf).join(","));
    process.env.PLATFORM_CONSOLE_ENABLED = "false";
    const off = await setRole(operator, aStaff, A, "admin");
    const offRead = await controls.readPrimaryOwnerTransferOptionsCore(req(operator), String(A));
    process.env.PLATFORM_CONSOLE_ENABLED = "true";
    ok("X1b with the console switched off, the role control, the transfer and their reads are refused (CONSOLE_DISABLED)", codeOf(off) === "CONSOLE_DISABLED" && codeOf(offRead) === "CONSOLE_DISABLED");
    const src = readFileSync(join(ROOT, "src/lib/platform/customer-user-actions.ts"), "utf8");
    ok("X1c both changes check platform.users.manage_roles (a permission of the single owner role), never the read or the PO-03B manage permission", guards.PLATFORM_PERMISSIONS.includes("platform.users.manage_roles") && /authorizePlatformToken\(req\.token, "platform\.users\.manage_roles"\)/.test(src) && (src.match(/await authorizeRoleManagement\(req\)/g) ?? []).length === 2);
    ok("X1d …and nothing was changed by any refused request", (await mapped(A)) === aPrimary && (await userRow(aStaff))!.role === "staff");
  }

  // ===================================================================================================================
  section("X2. The transfer options (what the dialog confirms against)");
  {
    const r = await controls.readPrimaryOwnerTransferOptionsCore(req(operator), String(A));
    const o = r.ok ? r.options : null;
    ok("X2a a designated company: the current primary owner and, as candidates, its ACTIVE users other than the primary owner — never a disabled user or another company's", !!o && o.designation === "designated" && o.primaryOwner?.userId === aPrimary && same(o.candidates.map((c) => c.userId).sort((x, y) => x - y), [aOwner2, aAdmin, aStaff, rUser].sort((x, y) => x - y)) && !o.candidates.some((c) => c.userId === aDisabled || c.userId === bStaff));
    ok("X2b …each entry is exactly: id, name, e-mail, role and change marker (no hash, MFA, session or token field)", !!o && [o.primaryOwner!, ...o.candidates].every((c) => same(Object.keys(c).sort(), ["email", "name", "role", "userId", "version"])) && !JSON.stringify(o).includes(CANARY.hash) && !JSON.stringify(o).includes(CANARY.mfa));
    const legacy = await controls.readPrimaryOwnerTransferOptionsCore(req(operator), String(L));
    ok("X2c a legacy company: 'not designated', no primary owner and no candidates — nothing is inferred", legacy.ok && legacy.options.designation === "not_designated" && legacy.options.primaryOwner === null && legacy.options.candidates.length === 0);
    const bad = await Promise.all(["0", "abc", "999999999", "-1"].map((id) => controls.readPrimaryOwnerTransferOptionsCore(req(operator), id).then(codeOf)));
    ok("X2d unknown and malformed company ids are NOT_FOUND (one answer)", bad.every((c) => c === "NOT_FOUND"), bad.join(","));
  }

  // ===================================================================================================================
  section("X3. A transfer: atomic roles, mapping, sessions, evidence and audit");
  {
    const pSession = await sessionFor(A, aPrimary);
    const tSession = await sessionFor(A, aStaff);
    const bystander = await sessionFor(A, aAdmin);
    const elsewhere = await sessionFor(B, bStaff);
    const r = await transfer(operator, A, aPrimary, aStaff);
    ok("X3a the transfer succeeds: the mapping names the new primary owner, who is now an active owner; the previous primary owner is now admin", r.ok && (await mapped(A)) === aStaff && (await userRow(aStaff))!.role === "owner" && (await userRow(aStaff))!.is_active && (await userRow(aPrimary))!.role === "admin");
    ok("X3b …BOTH accounts' sessions are ended (reason owner_transfer): both must sign in again", (await reasonOf(pSession.tokenHash)) === "owner_transfer" && (await reasonOf(tSession.tokenHash)) === "owner_transfer" && (await stateOf(pSession.token)) !== "active" && (await stateOf(tSession.token)) !== "active");
    ok("X3c …another user of the company and a user of another company keep their sessions", (await stateOf(bystander.token)) === "active" && (await stateOf(elsewhere.token)) === "active");
    const evP = await evidence(aPrimary);
    const evT = await evidence(aStaff);
    ok("X3d …each account's own security log records the transfer (released → admin / gained → owner) with no IP, user agent, browser, OS or device", evP.length === 1 && evT.length === 1 && evP[0].type === "account.ownership_transferred_by_platform" && evP[0].metadata?.primary === "released" && evP[0].metadata?.toRole === "admin" && evT[0].metadata?.primary === "gained" && evT[0].metadata?.toRole === "owner" && [...evP, ...evT].every((e) => e.ip_address === null && e.user_agent === null && e.browser === null && e.os === null && e.device === null));
    const audits = (await companyAudits(A)).filter((x) => x.result === "success");
    ok("X3e …the platform audit records company.primary_owner_transferred with the previous and new primary owner and the roles", audits.length === 1 && audits[0].action === "company.primary_owner_transferred" && audits[0].before_safe?.primaryOwnerUserId === aPrimary && audits[0].after_safe?.primaryOwnerUserId === aStaff && audits[0].after_safe?.previousOwnerRole === "admin");
    const fresh = await sessionFor(A, aStaff);
    const resolved = await customerSession.resolveSessionToken(fresh.token);
    ok("X3f …a new sign-in of the new primary owner carries the owner role", resolved.status === "active" && resolved.session.role === "owner");
    // Transfer back from the new owner to a co-owner (already an owner): roles stay owner for the target.
    const back = await transfer(operator, A, aStaff, aOwner2);
    ok("X3g a transfer to an existing co-owner keeps them an owner and makes the previous primary owner admin", back.ok && (await mapped(A)) === aOwner2 && (await userRow(aOwner2))!.role === "owner" && (await userRow(aStaff))!.role === "admin");
  }

  // ===================================================================================================================
  section("X4. Transfer refusals change nothing");
  {
    const before = await mapped(A);
    const stepBefore = await lastStep(operator);
    const self = await transfer(operator, A, aOwner2, aOwner2);
    const other = await transfer(operator, A, aOwner2, bStaff);
    const unknown = await controls.transferPrimaryOwnerCore(req(operator), { orgId: String(A), fromUserId: String(aOwner2), toUserId: "987654321", fromVersion: await versionOf(aOwner2), toVersion: await versionOf(aOwner2), reason: REASON, totpCode: codeFor(operator) });
    ok("X4a the same account, another company's user and an unknown user are refused before any code is spent (TRANSFER_TARGET_INVALID / NOT_FOUND)", codeOf(self) === "TRANSFER_TARGET_INVALID" && codeOf(other) === "TRANSFER_TARGET_INVALID" && codeOf(unknown) === "NOT_FOUND" && (await lastStep(operator)) === stepBefore);
    const disabled = await transfer(operator, A, aOwner2, aDisabled);
    ok("X4b a disabled user is refused (TRANSFER_TARGET_INVALID) inside the transaction; the code was rolled back with it", codeOf(disabled) === "TRANSFER_TARGET_INVALID" && (await lastStep(operator)) === stepBefore && (await userRow(aDisabled))!.role === "staff");
    const wrongCode = await transfer(operator, A, aOwner2, aAdmin, { totpCode: String((Number(codeFor(operator)) + 1) % 1_000_000).padStart(6, "0") });
    nextStep();
    const used = codeFor(operator);
    const spend = await controls.changeCustomerUserRoleCore(req(operator), { userId: String(aAdmin), orgId: String(A), role: "staff", reason: REASON, totpCode: used, version: await versionOf(aAdmin) });
    const replay = await controls.transferPrimaryOwnerCore(req(operator), { orgId: String(A), fromUserId: String(aOwner2), toUserId: String(aAdmin), fromVersion: await versionOf(aOwner2), toVersion: await versionOf(aAdmin), reason: REASON, totpCode: used });
    ok("X4c a wrong code and a replayed code are refused (MFA_INVALID)", codeOf(wrongCode) === "MFA_INVALID" && spend.ok && codeOf(replay) === "MFA_INVALID");
    await setRole(operator, aAdmin, A, "admin");
    const malformed = await Promise.all([
      controls.transferPrimaryOwnerCore(req(operator), { orgId: String(A), fromUserId: String(aOwner2), toUserId: String(aAdmin), fromVersion: "yesterday", toVersion: await versionOf(aAdmin), reason: REASON, totpCode: codeFor(operator) }).then(codeOf),
      controls.transferPrimaryOwnerCore(req(operator), { orgId: String(A), fromUserId: String(aOwner2), toUserId: String(aAdmin), fromVersion: await versionOf(aOwner2), toVersion: await versionOf(aAdmin), reason: "short", totpCode: codeFor(operator) }).then(codeOf),
      controls.transferPrimaryOwnerCore(req(operator), { orgId: "A1", fromUserId: String(aOwner2), toUserId: String(aAdmin), fromVersion: await versionOf(aOwner2), toVersion: await versionOf(aAdmin), reason: REASON, totpCode: codeFor(operator) }).then(codeOf),
    ]);
    ok("X4d malformed requests (version, reason, company id) are refused (VALIDATION_FAILED / NOT_FOUND) and spend nothing", same(malformed, ["VALIDATION_FAILED", "VALIDATION_FAILED", "NOT_FOUND"]), malformed.join(","));
    ok("X4e …after every refusal the mapping is unchanged", (await mapped(A)) === before);
    const rejectedStages = (await companyAudits(A)).filter((x) => x.result === "rejected").map((x) => x.after_safe?.stage);
    ok("X4f …each refusal is recorded as a rejected attempt with its stage", ["same_owner", "other_company", "not_found", "invalid_target", "mfa", "replay"].every((s) => rejectedStages.includes(s)), rejectedStages.join(","));
  }

  // ===================================================================================================================
  section("X5. Legacy companies and missing mappings");
  {
    const legacy = await transfer(operator, L, lOwner, lStaff);
    ok("X5a a legacy company (no mapping) is refused (OWNER_NOT_DESIGNATED): nothing is inferred, assigned or changed", codeOf(legacy) === "OWNER_NOT_DESIGNATED" && (await mapped(L)) === null && (await userRow(lStaff))!.role === "staff" && (await userRow(lOwner))!.role === "owner");
    const stale = await transfer(operator, A, aPrimary, aAdmin);
    ok("X5b a request naming an owner that is no longer the primary owner is refused as stale (VERSION_CONFLICT)", codeOf(stale) === "VERSION_CONFLICT" && (await mapped(A)) === aOwner2);
  }

  // ===================================================================================================================
  section("X6. Concurrent transfers; a transfer against a disable");
  {
    // Two operators transfer company C to two different users at once: both wait at the company row; exactly one wins.
    const held = await blocker(`select id from orgs where id = $1 for no key update`, [C]);
    const [v1, v2, vp] = [await versionOf(cOne), await versionOf(cTwo), await versionOf(cPrimary)];
    nextStep();
    const p1 = controls.transferPrimaryOwnerCore(req(operator), { orgId: String(C), fromUserId: String(cPrimary), toUserId: String(cOne), fromVersion: vp, toVersion: v1, reason: REASON, totpCode: codeFor(operator) });
    const p2 = controls.transferPrimaryOwnerCore(req(second), { orgId: String(C), fromUserId: String(cPrimary), toUserId: String(cTwo), fromVersion: vp, toVersion: v2, reason: REASON, totpCode: codeFor(second) });
    const bothWait = await until(async () => (await lockWaiters(ORG_ROW_LOCK)) >= 2);
    await held.release();
    const [r1, r2] = await Promise.all([p1, p2]);
    const winners = [r1, r2].filter((r) => r.ok).length;
    const loser = [r1, r2].find((r) => !r.ok);
    const owners = await n(`select count(*)::int as n from users where org_id = $1 and role = 'owner'`, [C]);
    ok("X6a two transfers of one company at once: both wait at the company row", bothWait);
    ok("X6b …exactly one applies; the other is refused as stale (VERSION_CONFLICT) — the mapping names exactly the winner, and exactly one owner remains", winners === 1 && codeOf(loser as Outcome) === "VERSION_CONFLICT" && [cOne, cTwo].includes((await mapped(C))!) && owners === 1 && (await userRow(cPrimary))!.role === "admin");
    // A disable of the target that commits first: the transfer that waited sees a changed target and is refused.
    const heldD = await blocker(`select id from orgs where id = $1 for no key update`, [D]);
    nextStep();
    const vT = await versionOf(dTarget);
    const vP = await versionOf(dPrimary);
    const disable = controls.setCustomerUserStatusCore(req(second), { userId: String(dTarget), target: "disabled", reason: REASON, totpCode: codeFor(second), version: vT });
    await until(async () => (await lockWaiters(ORG_ROW_LOCK)) >= 1);
    const tr = controls.transferPrimaryOwnerCore(req(operator), { orgId: String(D), fromUserId: String(dPrimary), toUserId: String(dTarget), fromVersion: vP, toVersion: vT, reason: REASON, totpCode: codeFor(operator) });
    await until(async () => (await lockWaiters(ORG_ROW_LOCK)) >= 2);
    await heldD.release();
    const [rd, rt] = await Promise.all([disable, tr]);
    ok("X6c a disable of the target queued FIRST and a transfer to it queued behind: the disable applies; the transfer sees the changed account and is refused (VERSION_CONFLICT) — ownership never moves to a disabled account", rd.ok && codeOf(rt) === "VERSION_CONFLICT" && (await mapped(D)) === dPrimary && !(await userRow(dTarget))!.is_active && (await userRow(dPrimary))!.role === "owner", `${codeOf(rd)} / ${codeOf(rt)}`);
    // The mirrored order: the transfer queued first, the disable of its target behind it.
    const heldG = await blocker(`select id from orgs where id = $1 for no key update`, [G]);
    nextStep();
    const gT = await versionOf(gTarget);
    const gP = await versionOf(gPrimary);
    const trG = controls.transferPrimaryOwnerCore(req(operator), { orgId: String(G), fromUserId: String(gPrimary), toUserId: String(gTarget), fromVersion: gP, toVersion: gT, reason: REASON, totpCode: codeFor(operator) });
    await until(async () => (await lockWaiters(ORG_ROW_LOCK)) >= 1);
    const disG = controls.setCustomerUserStatusCore(req(second), { userId: String(gTarget), target: "disabled", reason: REASON, totpCode: codeFor(second), version: gT });
    await until(async () => (await lockWaiters(ORG_ROW_LOCK)) >= 2);
    await heldG.release();
    const [rtG, rdG] = await Promise.all([trG, disG]);
    ok("X6c2 the mirrored order (transfer queued first): the transfer applies; the disable of the new primary owner is refused (VERSION_CONFLICT / LAST_PRIMARY_OWNER) — the new owner stays active", rtG.ok && ["VERSION_CONFLICT", "LAST_PRIMARY_OWNER"].includes(codeOf(rdG)) && (await mapped(G)) === gTarget && (await userRow(gTarget))!.is_active && (await userRow(gTarget))!.role === "owner", `${codeOf(rtG)} / ${codeOf(rdG)}`);
    // A transfer that commits first: the new primary owner is then protected from the disable.
    const toE = await transfer(operator, E, ePrimary, eTarget);
    nextStep();
    const disableNew = await controls.setCustomerUserStatusCore(req(second), { userId: String(eTarget), target: "disabled", reason: REASON, totpCode: codeFor(second), version: await versionOf(eTarget) });
    ok("X6d after a transfer, the new primary owner is protected from disabling (LAST_PRIMARY_OWNER) and the previous one is an ordinary admin", toE.ok && codeOf(disableNew) === "LAST_PRIMARY_OWNER" && (await userRow(ePrimary))!.role === "admin");
  }

  // ===================================================================================================================
  section("X7. Stale pages");
  {
    const vOld = await versionOf(aAdmin);
    await setRole(second, aAdmin, A, "staff");
    const staleTransfer = await transfer(operator, A, aOwner2, aAdmin, { toVersion: vOld });
    ok("X7a a transfer confirmed against an account that changed since the page loaded is refused (VERSION_CONFLICT); nothing moves", codeOf(staleTransfer) === "VERSION_CONFLICT" && (await mapped(A)) === aOwner2);
    const staleRole = await setRole(operator, aAdmin, A, "owner", { version: vOld });
    ok("X7b …and so is a role change made on a stale page", codeOf(staleRole) === "VERSION_CONFLICT" && (await userRow(aAdmin))!.role === "staff");
    await setRole(operator, aAdmin, A, "admin");
  }

  // ===================================================================================================================
  section("X8. An audit or evidence failure, or an interrupted transaction, rolls everything back");
  {
    const s1 = await sessionFor(F, fPrimary);
    const stepBefore = await lastStep(operator);
    await failingInsert("platform_audit_events", true);
    let audit: Outcome;
    try {
      audit = await transfer(operator, F, fPrimary, fTarget);
    } finally {
      await failingInsert("platform_audit_events", false);
    }
    ok("X8a the audit trail refuses the record → AUDIT_UNAVAILABLE: mapping, roles and sessions unchanged; the code was not consumed", codeOf(audit) === "AUDIT_UNAVAILABLE" && (await mapped(F)) === fPrimary && (await userRow(fTarget))!.role === "staff" && (await userRow(fPrimary))!.role === "owner" && (await stateOf(s1.token)) === "active" && (await lastStep(operator)) === stepBefore);
    // The customer evidence for the SECOND account fails — after the roles, the mapping and the first evidence were written.
    await failingInsert("security_events", true, "(new.metadata->>'primary') = 'gained'");
    let evid: Outcome;
    try {
      evid = await transfer(operator, F, fPrimary, fTarget);
    } finally {
      await failingInsert("security_events", false);
    }
    ok("X8b an interruption late in the transfer (the second account's evidence fails after the roles, mapping and first evidence were written) leaves NOTHING: mapping, both roles, sessions and evidence as before", !evid.ok && (await mapped(F)) === fPrimary && (await userRow(fTarget))!.role === "staff" && (await userRow(fPrimary))!.role === "owner" && (await stateOf(s1.token)) === "active" && (await evidence(fPrimary)).length === 0);
    // A disconnection before COMMIT (the backend is terminated while the transfer waits for a lock).
    const held = await blocker(`select id from orgs where id = $1 for no key update`, [F]);
    const p = transfer(operator, F, fPrimary, fTarget);
    await until(async () => (await lockWaiters(ORG_ROW_LOCK)) >= 1);
    await q(`select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and state = 'active' and wait_event_type = 'Lock' and query ~* 'from "orgs"'`);
    const cut = await p;
    await held.release();
    ok("X8c a connection lost before COMMIT applies nothing (the transfer reports a failure; mapping and roles unchanged)", !cut.ok && (await mapped(F)) === fPrimary && (await userRow(fTarget))!.role === "staff");
    const ok8 = await transfer(operator, F, fPrimary, fTarget);
    ok("X8d …and the same transfer succeeds afterwards", ok8.ok && (await mapped(F)) === fTarget);
  }

  // ===================================================================================================================
  section("R1. A role change: the shared role write, the sessions, the evidence, the audit");
  {
    const s = await sessionFor(A, rUser);
    const other = await sessionFor(A, aAdmin);
    const r = await setRole(operator, rUser, A, "admin");
    ok("R1a staff → admin succeeds and ends the account's sessions (reason role_change); another user's session is untouched", r.ok && (await userRow(rUser))!.role === "admin" && (await reasonOf(s.tokenHash)) === "role_change" && (await stateOf(s.token)) !== "active" && (await stateOf(other.token)) === "active");
    const ev = (await evidence(rUser)).filter((e) => e.type === "account.role_changed_by_platform");
    const au = (await userAudits(rUser)).filter((x) => x.action === "customer_user.role_changed" && x.result === "success");
    ok("R1b …the customer's own log records account.role_changed_by_platform (staff → admin, no network identity) and the platform audit records customer_user.role_changed (before → after)", ev.length === 1 && ev[0].metadata?.fromRole === "staff" && ev[0].metadata?.toRole === "admin" && ev[0].ip_address === null && ev[0].user_agent === null && au.length === 1 && au[0].before_safe?.role === "staff" && au[0].after_safe?.role === "admin");
    const up = await setRole(operator, rUser, A, "owner");
    const down = await setRole(operator, rUser, A, "staff");
    ok("R1c promotion to owner and demotion of a non-primary owner (another active owner remains) both work", up.ok && down.ok && (await userRow(rUser))!.role === "staff");
    const fresh = await sessionFor(A, rUser);
    const resolved = await customerSession.resolveSessionToken(fresh.token);
    ok("R1d …a new sign-in after the change carries the new role", resolved.status === "active" && resolved.session.role === "staff");
  }

  // ===================================================================================================================
  section("R2. Role refusals");
  {
    const primary = (await mapped(A))!;
    const demotePrimary = await setRole(operator, primary, A, "admin");
    ok("R2a the mapped primary owner cannot be demoted (LAST_PRIMARY_OWNER — transfer first)", codeOf(demotePrimary) === "LAST_PRIMARY_OWNER" && (await userRow(primary))!.role === "owner");
    const lastOwner = await setRole(operator, lOwner, L, "admin");
    ok("R2b a legacy company's last active owner cannot be demoted (LAST_ACTIVE_OWNER)", codeOf(lastOwner) === "LAST_ACTIVE_OWNER" && (await userRow(lOwner))!.role === "owner");
    const invalid = await Promise.all(["superadmin", "Owner", "", "platform_owner"].map((role) => setRole(operator, aStaff, A, role).then(codeOf)));
    ok("R2c invalid roles are refused (VALIDATION_FAILED): only owner, admin and staff exist", invalid.every((c) => c === "VALIDATION_FAILED"), invalid.join(","));
    const crossCompany = await setRole(operator, bStaff, A, "owner");
    ok("R2d a user id from ANOTHER company than the one the page showed is refused (NOT_FOUND) — no cross-company substitution", codeOf(crossCompany) === "NOT_FOUND" && (await userRow(bStaff))!.role === "staff");
    const sameRole = await setRole(operator, rUser, A, "staff");
    ok("R2e a change to the role the account already has is refused (CONFLICT)", codeOf(sameRole) === "CONFLICT");
    nextStep();
    const code = codeFor(operator);
    const first = await controls.changeCustomerUserRoleCore(req(operator), { userId: String(rUser), orgId: String(A), role: "admin", reason: REASON, totpCode: code, version: await versionOf(rUser) });
    const replayed = await controls.changeCustomerUserRoleCore(req(operator), { userId: String(rUser), orgId: String(A), role: "staff", reason: REASON, totpCode: code, version: await versionOf(rUser) });
    ok("R2f a consumed TOTP code cannot approve a second change (MFA_INVALID)", first.ok && codeOf(replayed) === "MFA_INVALID" && (await userRow(rUser))!.role === "admin");
    const stages = (await userAudits(rUser)).filter((x) => x.result === "rejected").map((x) => x.after_safe?.stage);
    ok("R2g …each refusal is recorded as a rejected attempt with its stage", ["state", "replay"].every((st) => stages.includes(st)) && (await userAudits(aOwner2)).some((x) => x.result === "rejected" && x.after_safe?.stage === "primary_owner") && (await userAudits(lOwner)).some((x) => x.result === "rejected" && x.after_safe?.stage === "last_owner"), stages.join(","));
  }

  // ===================================================================================================================
  section("R3. Two operators changing one role");
  {
    const held = await blocker(`select id from orgs where id = $1 for no key update`, [A]);
    const v = await versionOf(rUser);
    nextStep();
    const p1 = controls.changeCustomerUserRoleCore(req(operator), { userId: String(rUser), orgId: String(A), role: "staff", reason: REASON, totpCode: codeFor(operator), version: v });
    const p2 = controls.changeCustomerUserRoleCore(req(second), { userId: String(rUser), orgId: String(A), role: "owner", reason: REASON, totpCode: codeFor(second), version: v });
    const bothWait = await until(async () => (await lockWaiters(ORG_ROW_LOCK)) >= 2);
    await held.release();
    const [r1, r2] = await Promise.all([p1, p2]);
    ok("R3a both wait at the company row; exactly one applies and the other is refused as stale (VERSION_CONFLICT) — neither bypasses the other", bothWait && [r1, r2].filter((r) => r.ok).length === 1 && [r1, r2].some((r) => codeOf(r) === "VERSION_CONFLICT"));
  }

  // ===================================================================================================================
  section("P. No business record changed; nothing secret printed or audited");
  {
    ok("P1 every business table is byte-identical to before (checksum over all rows)", (await businessChecksum()) === businessBefore);
    const audits = JSON.stringify(await q(`select reason, before_safe, after_safe, actor_label, user_agent, ip_address from platform_audit_events`));
    const leaked = secretsSeen.filter((s) => s.length >= 6 && audits.includes(s));
    ok("P2 no password, TOTP secret, recovery code, platform token, customer token or session id / hash appears in any audit record", leaked.length === 0, `${leaked.length} leaked`);
    ok("P3 …nor any canary authentication value", ![CANARY.hash, CANARY.mfa, CANARY.rec].some((c) => audits.includes(c)));
    const printed = secretsSeen.concat([CANARY.hash, CANARY.mfa, CANARY.rec]).filter((s) => s.length >= 6 && logged.some((l) => l.includes(s)));
    ok("P4 nothing the suite captured from the console output contains a secret or canary", printed.length === 0, `${printed.length} printed`);
  }
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-owner-transfer");
} catch (err) {
  ok("the suite completed without an exception", false, describeError(err));
  exitCode = summary("verify:platform-owner-transfer");
} finally {
  await pool.end().catch(() => undefined);
  if (created && !process.env.PLATFORM_TEST_KEEP_DATABASES) await dropDisposableDatabase(testDbName).catch(() => undefined);
}
process.exit(exitCode);
