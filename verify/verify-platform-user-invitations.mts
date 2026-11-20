/**
 * Platform Owner PO-03C, sub-batch C — customer-user invitations on real PostgreSQL: the staged schema
 * (drizzle/platform/PO03C_user_invitations.sql, its rollback and the staged Drizzle declaration
 * src/db/staged/platform-user-invitations.ts), the read model (src/lib/platform/user-invitations.ts), the create /
 * revoke / re-issue cores (src/lib/platform/user-invitation-actions.ts) and the seat reservations
 * (src/lib/platform/seat-accounting.ts).
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://…/<admin db with _test_only_> npm run verify:platform-user-invitations
 *
 * Disposable databases only (all dropped at the end): the reviewed schema and platform SQL chain plus the PO-02D1B
 * Trial seed, then the PO-03C SQL applied by THIS suite (it is not in the chain). Fictional companies, users and
 * operators; TEST-ONLY secrets generated in memory and never printed. Every race runs in a known interleaving: a
 * barrier (a held lock) is observed waiting in pg_stat_activity before it is released.
 *
 * Categories (docs/platform-owner/PO03C_DEVELOPMENT.md §F–§I): S schema (create / verify / guard / Drizzle equivalence /
 * rollback / not in the chain) · F flags and installation · Z authorization · C create (token entropy, hash-only storage,
 * link, audit, refusals, durable throttle, an expired holder replaced) · R revoke · I re-issue (pending, expired, revoked;
 * lineage) · K concurrency (simultaneous issuance, revoke vs re-issue, create vs suspension) · A audit rollback ·
 * X cross-company isolation · T seat reservations (read-only) · O no outbound communication, no acceptance · P nothing
 * secret stored, printed or audited; no business record changed.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { connectDisposable, createDisposableDatabase, createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { PLATFORM_SQL_FILES, projectCatalog } from "../scripts/platform/catalog";
import { describeError, ok, section, summary } from "./platform/harness";

const ROOT = process.cwd();
const SQL_FILE = join(ROOT, "drizzle/platform/PO03C_user_invitations.sql");
const ROLLBACK_FILE = join(ROOT, "drizzle/platform/PO03C_user_invitations_rollback.sql");
const STAGED_MODULE = join(ROOT, "src/db/staged/platform-user-invitations.ts");
const testDbName = disposableName("po03c_uinv");
const extraDbs: string[] = [];
process.env.DATABASE_URL = databaseUrlFor(testDbName);
process.env.PLATFORM_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.FIELD_ENCRYPTION_KEYS = `1:${randomBytes(32).toString("base64")}`;
process.env.PLATFORM_CONSOLE_ENABLED = "true";
process.env.PLATFORM_USER_INVITATIONS_ENABLED = "true";
process.env.PLATFORM_TRUSTED_PROXY_HOPS = "1";
process.env.CUSTOMER_PUBLIC_ORIGIN = "https://erp.example.test";
delete process.env.PLATFORM_INVITATIONS_ENABLED;
delete process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED;
delete process.env.CUSTOMER_LEGACY_TOKENS;
// PO-03D: this suite verifies the administration with seat enforcement OFF (its default); enforcement on every path is
// verify:platform-seat-paths, acceptance verify:platform-user-acceptance.
delete process.env.CUSTOMER_SEAT_ENFORCEMENT_ENABLED;
delete process.env.CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED;

const sqlText = readFileSync(SQL_FILE, "utf8");
const rollbackText = readFileSync(ROLLBACK_FILE, "utf8");
async function applyFile(url: string, text: string): Promise<{ ok: true; steps: string[] } | { ok: false; code: string; message: string }> {
  const c = await connectDisposable(url);
  try {
    const r = await c.query(text);
    const steps = (Array.isArray(r) ? r : [r]).flatMap((x: { rows?: Record<string, unknown>[] }) => x.rows ?? []).map((row) => Object.values(row).join(" "));
    return { ok: true, steps };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    await c.query("rollback").catch(() => undefined);
    return { ok: false, code: err.code ?? "", message: err.message ?? "" };
  } finally {
    await c.end().catch(() => undefined);
  }
}
/** drizzle-kit push of the full schema PLUS the staged module (the staged table's source of truth). */
function pushWithStaged(url: string, verbose = false): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "po03c-drizzle-"));
  const config = join(dir, "drizzle.push.config.ts");
  writeFileSync(config, `export default { dialect: "postgresql", schema: ${JSON.stringify([join(ROOT, "src/db/schema/index.ts"), STAGED_MODULE])}, dbCredentials: { url: process.env.DATABASE_URL as string }${verbose ? ", verbose: true, strict: false" : ""} };\n`);
  try {
    const res = spawnSync(join(ROOT, "node_modules", ".bin", "drizzle-kit"), ["push", "--config", config, ...(verbose ? ["--verbose"] : [])], { cwd: ROOT, env: { ...process.env, DATABASE_URL: url }, encoding: "utf8", timeout: 300_000 });
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`.replace(/postgres(ql)?:\/\/\S+/g, "<redacted-url>").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
    return { ok: res.status === 0 && /Changes applied|No changes detected/.test(output), output };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let created = false;
await createPlatformTestDatabase("po03c_uinv", testDbName);
created = true;
{
  const { runSeed } = await import("../scripts/platform/trial-seed");
  const seeded = await runSeed(process.env.DATABASE_URL);
  if (seeded.check.state !== "complete") throw new Error(`the Trial seed did not complete: ${seeded.check.state}`);
}
// The staged table is NOT in the chain: before this suite applies its SQL, the test database has none.
const absentBefore = await (async () => {
  const c = await connectDisposable(process.env.DATABASE_URL!);
  try {
    return (await c.query(`select to_regclass('user_invitations') is null as absent`)).rows[0].absent === true;
  } finally {
    await c.end();
  }
})();
const firstApply = await applyFile(process.env.DATABASE_URL!, sqlText);
const secondApply = await applyFile(process.env.DATABASE_URL!, sqlText);

const { db, pool, platformAdminsTable } = await import("../src/db");
const auth = await import("../src/lib/platform/auth");
const mfa = await import("../src/lib/platform/mfa");
const totp = await import("../src/lib/platform/totp");
const { platformClock } = await import("../src/lib/platform/clock");
const console_ = await import("../src/lib/platform/console");
const guards = await import("../src/lib/platform/guards");
const reads = await import("../src/lib/platform/user-invitations");
const actions = await import("../src/lib/platform/user-invitation-actions");
const seats = await import("../src/lib/platform/seat-accounting");
const tenantAuth = await import("../src/lib/auth");
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
const sqlState = async (text: string, values: unknown[] = []) => {
  try {
    await pool.query(text, values);
    return "OK";
  } catch (e) {
    return (e as { code?: string }).code ?? "ERR";
  }
};

let nowMs = Math.floor(Date.now() / 1000) * 1000;
platformClock.now = () => new Date(nowMs);
const nextStep = () => {
  nowMs = (totp.totpStepAt(new Date(nowMs)) + 1) * 30_000 + 1_000;
};
const HOST = "console.erp.test";
const headersFor = (ip: string, over: Record<string, string | null> = {}) => {
  const h = new Headers({ host: HOST, origin: `https://${HOST}`, "sec-fetch-site": "same-origin", "user-agent": "verify-platform-user-invitations", "x-forwarded-for": ip });
  for (const [k, v] of Object.entries(over)) if (v === null) h.delete(k);
  else h.set(k, v);
  return h;
};
const OPERATOR_IP = "203.0.113.71";

const STRONG = "Cobalt-Orchard-63!x";
const secretsSeen: string[] = [STRONG];
type Admin = { id: string; email: string; secret: string; token: string };
async function createAdmin(email: string, displayName: string): Promise<Admin> {
  const { secret } = mfa.createTotpEnrollment(email);
  const { codes, hashes } = await mfa.createRecoveryCodeSet();
  const at = new Date(nowMs);
  const [row] = await db
    .insert(platformAdminsTable)
    .values({ emailNormalized: email, displayName, passwordHash: await auth.hashPlatformPassword(STRONG), isActive: true, mfaSecretEncrypted: mfa.encryptTotpSecret(secret), mfaRecoveryHashes: hashes, mfaEnrolledAt: at, passwordChangedAt: at, createdAt: at, updatedAt: at })
    .returning({ id: platformAdminsTable.id });
  secretsSeen.push(secret, ...codes);
  const a: Admin = { id: row.id, email, secret, token: "" };
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
const REASON = "Fixture: the company asked us to withdraw this invitation";

const bcryptPad = (stem: string) => "$2b$10$" + (stem + "Q".repeat(53)).slice(0, 53);
const CANARY = { hash: bcryptPad("CanaryUserInvitationsHashU5"), mfa: "v1:CANARY_USER_INVITATIONS_MFA_U5", rec: "v1:CANARY_USER_INVITATIONS_RECOVERY_U5" };
async function newOrg(name = `Invite Fixture ${tag()}`): Promise<number> {
  return Number((await one<{ id: number }>(`insert into orgs (name, country, currency) values ($1, 'Saudi Arabia', 'SAR') returning id`, [name]))!.id);
}
async function newUser(orgId: number, role: string, email: string, active = true): Promise<number> {
  return Number((await one<{ id: number }>(`insert into users (org_id, email, password_hash, name, role, is_active, mfa_secret, mfa_recovery_codes) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`, [orgId, email, CANARY.hash, `Fixture ${role} ${tag()}`, role, active, CANARY.mfa, CANARY.rec]))!.id);
}
async function subscribe(orgId: number, seatsSnapshot: number) {
  const v1 = (await one<{ id: string }>(`select v.id from subscription_package_versions v join subscription_packages p on p.id = v.package_id where p.is_default_trial and v.version_number = 1`))!.id;
  await q(
    `insert into tenant_subscriptions (org_id, package_version_id, version_state, is_trial, cycle, lifecycle_state, start_date, end_date, price_snapshot_sar, seats_snapshot, storage_snapshot_gb, module_groups_snapshot, assignment_source)
     values ($1, $2, 'published', true, 'trial', 'trialing', current_date, current_date + 13, 0, $3, 5, '[]'::jsonb, 'invitation_acceptance')`,
    [orgId, v1, seatsSnapshot],
  );
}
async function suspend(orgId: number, adminId: string) {
  await q(`insert into tenant_access_controls (org_id, access_status, reason, changed_by_platform_admin_id, changed_at) values ($1, 'suspended', 'Fixture: suspended for the test', $2, now())`, [orgId, adminId]);
}
const invRow = (id: string) => one<{ org_id: number; name: string; email_normalized: string; requested_role: string; token_hash: string; expires_at: Date; created_at: Date; revoked_at: Date | null; revoked_by_platform_admin_id: string | null; accepted_at: Date | null; invited_by_platform_admin_id: string }>(`select * from user_invitations where id = $1`, [id]);
const openFor = (email: string) => n(`select count(*)::int as n from user_invitations where email_normalized = $1 and accepted_at is null and revoked_at is null`, [email]);
const auditsOf = (entityId: string) => q<{ action: string; result: string; reason: string | null; before_safe: Record<string, unknown> | null; after_safe: Record<string, unknown> | null; org_id: number | null }>(`select action, result, reason, before_safe, after_safe, org_id from platform_audit_events where entity_type = 'user_invitation' and entity_id = $1 order by id`, [entityId]);
const rejectedStages = async () => (await q<{ s: string }>(`select after_safe->>'stage' as s from platform_audit_events where action like 'user_invitation.%rejected' order by id`)).map((r) => r.s);
type Outcome = { ok: true } | { ok: false; code: string };
const codeOf = (o: Outcome) => (o.ok ? "OK" : o.code);
/** An open invitation written directly (a fixture whose window may lie in the past); returns its id. */
async function directInvitation(orgId: number, email: string, adminId: string, opts: { createdAgoMs?: number; ttlMs?: number; role?: string } = {}) {
  const createdAt = new Date(nowMs - (opts.createdAgoMs ?? 0));
  const expiresAt = new Date(createdAt.getTime() + (opts.ttlMs ?? 72 * 3_600_000));
  return (await one<{ id: string }>(
    `insert into user_invitations (org_id, name, email_normalized, requested_role, token_hash, expires_at, invited_by_platform_admin_id, created_at) values ($1, 'Fixture Invitee', $2, $3, $4, $5, $6, $7) returning id`,
    [orgId, email, opts.role ?? "staff", sha256(randomBytes(32).toString("base64url")), expiresAt, adminId, createdAt],
  ))!.id;
}

async function create(a: Admin, fields: { orgId: number; name?: string; email: string; role?: string }, over: Partial<{ password: string; totpCode: string }> = {}) {
  nextStep();
  return actions.createUserInvitation(req(a), { orgId: String(fields.orgId), name: fields.name ?? "Fixture Invitee", email: fields.email, role: fields.role ?? "staff", password: over.password ?? STRONG, totpCode: over.totpCode ?? codeFor(a) });
}
async function revoke(a: Admin, invitationId: string, over: Partial<{ reason: string; totpCode: string }> = {}) {
  nextStep();
  return actions.revokeUserInvitation(req(a), { invitationId, reason: over.reason ?? REASON, totpCode: over.totpCode ?? codeFor(a) });
}
async function reissue(a: Admin, invitationId: string, over: Partial<{ password: string; totpCode: string }> = {}) {
  nextStep();
  return actions.reissueUserInvitation(req(a), { invitationId, password: over.password ?? STRONG, totpCode: over.totpCode ?? codeFor(a) });
}

// ---- barriers ------------------------------------------------------------------------------------------------------
type Blocker = { client: pg.Client; release: (commit?: boolean) => Promise<void> };
async function blocker(lockSql: string, values: unknown[] = []): Promise<Blocker> {
  const client: pg.Client = await connectDisposable(process.env.DATABASE_URL!);
  client.on("error", () => undefined);
  await client.query("begin");
  await client.query(lockSql, values);
  return {
    client,
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
const EMAIL_LOCK = /pg_advisory_xact_lock/i;
// PO-03D (sub-batch C): create and re-issue now take the company row FOR NO KEY UPDATE directly (the seat lock), no longer
// FOR SHARE — the same row, so a suspension still serializes with them.
const ORG_LOCKED = /from "orgs"[\s\S]*for no key update/i;

async function failingInsert(table: "platform_audit_events" | "user_invitations", on: boolean) {
  const fn = `po03c_test_only_fail_${table}`;
  if (on) {
    await q(`create or replace function ${fn}() returns trigger language plpgsql as $$ begin raise exception 'injected outage (test only)'; end $$`);
    await q(`create trigger ${fn} before insert on ${table} for each row execute function ${fn}()`);
  } else {
    await q(`drop trigger if exists ${fn} on ${table}`);
    await q(`drop function if exists ${fn}()`);
  }
}
const INVITATION_TABLES = new Set(["user_invitations", "organization_invitations", "organization_invitation_terms", "tenant_access_controls"]);
async function businessChecksum(): Promise<string> {
  const tables = (await q<{ t: string }>(`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`)).map((r) => r.t).filter((t) => !t.startsWith("platform_") && !INVITATION_TABLES.has(t));
  const parts: string[] = [];
  for (const t of tables) {
    const r = await one<{ c: number; h: string | null }>(`select count(*)::int as c, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from "${t}" x`);
    parts.push(`${t}:${r?.c}:${r?.h}`);
  }
  return sha256(parts.join("\n"));
}

async function main() {
  const operator = await createAdmin("operator@uinv-fixture.test", "Fixture Operator");
  const second = await createAdmin("second@uinv-fixture.test", "Second Operator");
  const limited = await createAdmin("limited@uinv-fixture.test", "Limited Operator");
  // Invitations written DIRECTLY as fixtures are attributed to this operator, who never creates one through the
  // service — so they never count against another operator's durable hourly limit.
  const keeper = await createAdmin("keeper@uinv-fixture.test", "Fixture Keeper");

  // Company A (Trial, 3 seats): an owner and an admin. Company B: an owner. Company S: suspended. Company L: no subscription.
  const A = await newOrg("Invite Fixture Alpha");
  await newUser(A, "owner", "owner.alpha@uinv-fixture.test");
  await newUser(A, "admin", "admin.alpha@uinv-fixture.test");
  await subscribe(A, 3);
  const B = await newOrg("Invite Fixture Beta");
  await newUser(B, "owner", "owner.beta@uinv-fixture.test");
  const S = await newOrg("Invite Fixture Suspended");
  await newUser(S, "owner", "owner.suspended@uinv-fixture.test");
  await suspend(S, operator.id);
  const L = await newOrg("Invite Fixture Legacy");
  await newUser(L, "owner", "owner.legacy@uinv-fixture.test");
  // A person who registered AFTER an invitation was issued for their e-mail (the invitation is written directly below).
  const lateEmail = "late.joiner@uinv-fixture.test";
  await newUser(B, "staff", "Late.Joiner@UINV-fixture.test");
  // A pending COMPANY invitation holding an e-mail.
  await q(
    `insert into organization_invitations (company_name, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash, expires_at, invited_by_platform_admin_id)
     values ('Pending Company Fixture', 'office@pending-fixture.test', 'Saudi Arabia', 'SAR', 'Pending Owner', 'pending.owner@uinv-fixture.test', $1, now() + interval '48 hours', $2)`,
    [sha256(randomBytes(32).toString("base64url")), operator.id],
  );
  // Fixtures used later (created here so the business checksum covers everything after them).
  const C = await newOrg("Invite Fixture Racing");
  await newUser(C, "owner", "owner.racing@uinv-fixture.test");
  const Tco = await newOrg("Invite Fixture Seats");
  await newUser(Tco, "owner", "owner.seats@uinv-fixture.test");
  await newUser(Tco, "staff", "disabled.seats@uinv-fixture.test", false);
  await subscribe(Tco, 3);
  const accUser = await newUser(A, "staff", "accepted.fixture.user@uinv-fixture.test");
  const businessBefore = await businessChecksum();

  // ===================================================================================================================
  section("S. The staged schema: create, verify, guard, Drizzle equivalence, rollback, not in the chain");
  {
    ok("S1 the platform SQL chain does not install the table (a fresh test database has none) and does not list the PO-03C file", absentBefore && !PLATFORM_SQL_FILES.some((f) => /PO03C/.test(f)));
    ok("S2 the first application creates the guard, the table and both triggers; a re-run only verifies them",
      firstApply.ok && same(firstApply.steps, ["fn user_invitation_guard: created", "user_invitations: created", "trigger user_invitations.user_invitations_guard: created", "trigger user_invitations.user_invitations_no_truncate: created"]) &&
        secondApply.ok && same(secondApply.steps, ["fn user_invitation_guard: verified", "user_invitations: verified", "trigger user_invitations.user_invitations_guard: verified", "trigger user_invitations.user_invitations_no_truncate: verified"]),
      JSON.stringify([firstApply, secondApply]).slice(0, 300));
    const index = readFileSync(join(ROOT, "src/db/schema/index.ts"), "utf8");
    ok("S3 the Drizzle declaration is staged: outside src/db/schema, imported by no schema module, not exported from the schema barrel", !/staged|user-invitations|userInvitations/.test(index) && !readdirSync(join(ROOT, "src/db/schema")).some((f) => /invitation-users|user-invitations/.test(f)));
    // Drizzle (full schema + staged module) on a fresh database vs the reviewed SQL on this one: the same table.
    const pName = disposableName("po03c_uinv_push");
    extraDbs.push(pName);
    const pUrl = await createDisposableDatabase(pName);
    const pushed = pushWithStaged(pUrl);
    const cP = await connectDisposable(pUrl);
    const cS = await connectDisposable(process.env.DATABASE_URL!);
    try {
      const onlyTable = (lines: string[]) => lines.filter((l) => l.startsWith("user_invitations | ")).sort();
      const projP = (await projectCatalog(cP)).other;
      const projS = (await projectCatalog(cS)).other;
      const diff = ["columns", "constraints", "indexes"].flatMap((k) => {
        const a = onlyTable(projP[k as "columns"]);
        const b = onlyTable(projS[k as "columns"]);
        return [...a.filter((x) => !b.includes(x)).map((x) => `push-only ${x}`), ...b.filter((x) => !a.includes(x)).map((x) => `sql-only ${x}`)];
      });
      ok("S4 drizzle-kit push of the staged declaration and the reviewed SQL produce the SAME table: every column, constraint and index", pushed.ok && onlyTable(projS.columns).length === 13 && onlyTable(projS.constraints).length === 15 && onlyTable(projS.indexes).length === 6 && diff.length === 0, diff.slice(0, 4).join(" | ") || pushed.output.slice(-200));
    } finally {
      await cP.end().catch(() => undefined);
      await cS.end().catch(() => undefined);
    }
    // A database built the documented way (full push + chain), then this file, then a push of the staged declaration:
    // drizzle-kit plans NOTHING for user_invitations. Its only statements are the four customer foreign keys every push
    // of today's schema re-creates (PO-02D1A.1 X-02: names longer than 63 characters), unrelated to PO-03C.
    const rpName = disposableName("po03c_uinv_rp");
    extraDbs.push(rpName);
    const rp = await createPlatformTestDatabase("po03c_uinv_rp", rpName);
    const rpApply = await applyFile(rp.url, sqlText);
    const repush = pushWithStaged(rp.url, true);
    const statements = repush.output.split("\n").map((l) => l.trim()).filter((l) => /^(ALTER|CREATE|DROP)\b/.test(l));
    const X02 = ["proforma_invoice_items", "delivery_challan_items", "sales_invoices", "advance_application_releases"];
    ok("S5 …and pushing the staged declaration onto the SQL-created table plans nothing for it: every planned statement is one of the eight known X-02 customer-key re-creations (none names user_invitations)",
      rpApply.ok && repush.ok && statements.length === 8 && statements.every((l) => X02.some((t) => l.startsWith(`ALTER TABLE "${t}"`))) && !/user_invitations/.test(repush.output),
      statements.slice(0, 3).join(" | ") || repush.output.slice(-200));
    const adm = keeper.id;
    ok("S6 a one-time token is never storable: a plaintext token, an owner role, a malformed e-mail or name are refused by the table itself (CHECK)",
      (await sqlState(`insert into user_invitations (org_id, name, email_normalized, requested_role, token_hash, invited_by_platform_admin_id) values ($1, 'X', 'x1@uinv-fixture.test', 'staff', $2, $3)`, [A, randomBytes(32).toString("base64url"), adm])) === "23514" &&
        (await sqlState(`insert into user_invitations (org_id, name, email_normalized, requested_role, token_hash, invited_by_platform_admin_id) values ($1, 'X', 'x2@uinv-fixture.test', 'owner', $2, $3)`, [A, sha256("a"), adm])) === "23514" &&
        (await sqlState(`insert into user_invitations (org_id, name, email_normalized, requested_role, token_hash, invited_by_platform_admin_id) values ($1, 'X', 'X3@uinv-fixture.test', 'staff', $2, $3)`, [A, sha256("b"), adm])) === "23514" &&
        (await sqlState(`insert into user_invitations (org_id, name, email_normalized, requested_role, token_hash, invited_by_platform_admin_id) values ($1, ' X', 'x4@uinv-fixture.test', 'staff', $2, $3)`, [A, sha256("c"), adm])) === "23514");
    const probe = await directInvitation(A, "guard.probe@uinv-fixture.test", adm);
    ok("S7 the guard: an invitation starts open, its terms never change, it is never deleted or truncated, one open invitation per e-mail",
      (await sqlState(`insert into user_invitations (org_id, name, email_normalized, requested_role, token_hash, invited_by_platform_admin_id, revoked_at, revoked_by_platform_admin_id) values ($1, 'X', 'x5@uinv-fixture.test', 'staff', $2, $3, now(), $3)`, [A, sha256("d"), adm])) === "23514" &&
        (await sqlState(`update user_invitations set requested_role = 'admin' where id = $1`, [probe])) === "23514" &&
        (await sqlState(`update user_invitations set org_id = $2 where id = $1`, [probe, B])) === "23514" &&
        (await sqlState(`update user_invitations set expires_at = expires_at + interval '1 day' where id = $1`, [probe])) === "23514" &&
        (await sqlState(`delete from user_invitations where id = $1`, [probe])) === "23001" &&
        (await sqlState(`truncate user_invitations`)) === "P0001" &&
        (await sqlState(`insert into user_invitations (org_id, name, email_normalized, requested_role, token_hash, invited_by_platform_admin_id) values ($1, 'X', 'guard.probe@uinv-fixture.test', 'admin', $2, $3)`, [B, sha256("e"), adm])) === "23505");
    const otherUser = Number((await one<{ id: number }>(`select id from users where org_id = $1 limit 1`, [B]))!.id);
    ok("S8 …acceptance (PO-03D's /join/accept — verify:platform-user-acceptance) can only ever name a user of the invitation's OWN company; a revoked or accepted invitation is final",
      (await sqlState(`update user_invitations set accepted_at = $3, accepted_user_id = $2 where id = $1`, [probe, otherUser, new Date(nowMs)])) === "23514" &&
        (await sqlState(`update user_invitations set revoked_at = $3, revoked_by_platform_admin_id = $2 where id = $1`, [probe, adm, new Date(nowMs)])) === "OK" &&
        (await sqlState(`update user_invitations set revoked_at = $2 where id = $1`, [probe, new Date(nowMs)])) === "23514");
    // Rollback: refused while a row exists (this database); on a fresh empty one it removes everything and records itself once.
    const refused = await applyFile(process.env.DATABASE_URL!, rollbackText);
    ok("S9 the rollback refuses, changing nothing, while any invitation row exists", !refused.ok && /rollback refused/.test(refused.message) && (await n(`select count(*)::int as n from pg_class where relname = 'user_invitations'`)) === 1);
    const rName = disposableName("po03c_uinv_rb");
    extraDbs.push(rName);
    const rb = await createPlatformTestDatabase("po03c_uinv_rb", rName);
    const rbApply = await applyFile(rb.url, sqlText);
    const rb1 = await applyFile(rb.url, rollbackText);
    const rb2 = await applyFile(rb.url, rollbackText);
    const cR = await connectDisposable(rb.url);
    try {
      const gone = (await cR.query(`select to_regclass('user_invitations') is null and to_regprocedure('user_invitation_guard()') is null as gone`)).rows[0].gone === true;
      const records = Number((await cR.query(`select count(*)::int as n from platform_audit_events where action = 'schema.user_invitations_removed'`)).rows[0].n);
      const reapply = await applyFile(rb.url, sqlText);
      ok("S10 on an empty database the rollback removes the table, both triggers and the guard and records ONE audit record; a repeated rollback adds nothing; the file applies again afterwards", rbApply.ok && rb1.ok && rb2.ok && gone && records === 1 && reapply.ok);
    } finally {
      await cR.end().catch(() => undefined);
    }
    ok("S11 both SQL files say they are NOT authorized for production execution; the foundation writes no row", /NOT AUTHORIZED FOR PRODUCTION EXECUTION/.test(sqlText) && /NOT AUTHORIZED FOR PRODUCTION EXECUTION/.test(rollbackText) && !/^\s*(INSERT|UPDATE|DELETE)\b/im.test(sqlText));
  }

  // ===================================================================================================================
  section("F. Flags and installation fail closed");
  {
    const stepBefore = await lastStep(operator);
    process.env.PLATFORM_USER_INVITATIONS_ENABLED = "false";
    const off = await Promise.all([
      create(operator, { orgId: A, email: "flag.off@uinv-fixture.test" }).then(codeOf),
      actions.previewUserInvitation(req(operator), { orgId: String(A), name: "X", email: "flag.off@uinv-fixture.test", role: "staff" }).then(codeOf),
      reads.listUserInvitations(req(operator)).then(() => "OK", (e: { code?: string }) => e.code ?? "ERR"),
    ]);
    delete process.env.PLATFORM_USER_INVITATIONS_ENABLED;
    const unset = await create(operator, { orgId: A, email: "flag.unset@uinv-fixture.test" });
    process.env.PLATFORM_USER_INVITATIONS_ENABLED = "true";
    ok("F1 with PLATFORM_USER_INVITATIONS_ENABLED off (or unset) every create, preview and read is refused (USER_INVITATIONS_DISABLED); nothing written, no code spent", off.every((c) => c === "USER_INVITATIONS_DISABLED") && codeOf(unset) === "USER_INVITATIONS_DISABLED" && (await openFor("flag.off@uinv-fixture.test")) === 0 && (await lastStep(operator)) === stepBefore, off.join(","));
    process.env.PLATFORM_CONSOLE_ENABLED = "false";
    const consoleOff = await create(operator, { orgId: A, email: "console.off@uinv-fixture.test" });
    process.env.PLATFORM_CONSOLE_ENABLED = "true";
    ok("F2 with the console switched off the feature is unreachable too (CONSOLE_DISABLED)", codeOf(consoleOff) === "CONSOLE_DISABLED");
    await q(`alter table user_invitations rename to po03c_test_only_hidden_invitations`);
    let notInstalled: string[] = [];
    let seatsWhileAbsent = -1;
    try {
      notInstalled = await Promise.all([
        create(operator, { orgId: A, email: "absent@uinv-fixture.test" }).then(codeOf),
        reads.listUserInvitations(req(operator)).then(() => "OK", (e: { code?: string }) => e.code ?? "ERR"),
        revoke(operator, "00000000-0000-4000-8000-000000000000").then(codeOf),
      ]);
      seatsWhileAbsent = (await seats.readSeatAccounting(db, A)).pendingInvitations;
    } finally {
      await q(`alter table po03c_test_only_hidden_invitations rename to user_invitations`);
    }
    ok("F3 where the staged table does not exist, every create, read and revoke is refused (USER_INVITATIONS_NOT_INSTALLED) and seat accounting counts no reservation", notInstalled.every((c) => c === "USER_INVITATIONS_NOT_INSTALLED") && seatsWhileAbsent === 0, notInstalled.join(","));
    ok("F4 the flag is read in exactly one module (src/lib/platform/flags.ts) and its default is off (only the exact string \"true\" enables it)",
      /process\.env\.PLATFORM_USER_INVITATIONS_ENABLED === "true"/.test(readFileSync(join(ROOT, "src/lib/platform/flags.ts"), "utf8")) && (await import("../src/lib/platform/flags")).isPlatformUserInvitationsEnabled() === true);
  }

  // ===================================================================================================================
  section("Z. Authorization (server-side, in order)");
  {
    const customerToken = await tenantAuth.signSessionToken({ userId: 1, orgId: A, jti: randomBytes(24).toString("base64url") });
    secretsSeen.push(customerToken);
    const base = { orgId: String(A), name: "X Invitee", email: "authz@uinv-fixture.test", role: "staff", password: STRONG, totpCode: "000000" };
    const got = await Promise.all([
      actions.createUserInvitation({ headers: headersFor(OPERATOR_IP), token: null }, base).then(codeOf),
      actions.createUserInvitation({ headers: headersFor(OPERATOR_IP), token: "forged.token.value" }, base).then(codeOf),
      actions.createUserInvitation({ headers: headersFor(OPERATOR_IP), token: customerToken }, base).then(codeOf),
      actions.createUserInvitation(req(operator, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }), base).then(codeOf),
    ]);
    ok("Z1 no session, a forged token and a CUSTOMER token are UNAUTHORIZED; a cross-site request is FORBIDDEN — before anything is read or spent", same(got, ["UNAUTHORIZED", "UNAUTHORIZED", "UNAUTHORIZED", "FORBIDDEN"]), got.join(","));
    const src = readFileSync(join(ROOT, "src/lib/platform/user-invitation-actions.ts"), "utf8");
    ok("Z2 every change checks platform.users.invite (a permission of the single owner role); every read platform.users.read", guards.PLATFORM_PERMISSIONS.includes("platform.users.invite") && /authorizePlatformToken\(req\.token, "platform\.users\.invite"\)/.test(src) && /authorizePlatformToken\(req\.token, "platform\.users\.read"\)/.test(readFileSync(join(ROOT, "src/lib/platform/user-invitations.ts"), "utf8")));
    process.env.CUSTOMER_PUBLIC_ORIGIN = "http://erp.example.test";
    const badOrigin = await create(operator, { orgId: A, email: "origin@uinv-fixture.test" });
    process.env.CUSTOMER_PUBLIC_ORIGIN = "https://erp.example.test";
    ok("Z3 a non-https customer origin is CONFIG_ERROR before anything is spent (the link never comes from request headers)", codeOf(badOrigin) === "CONFIG_ERROR" && (await openFor("origin@uinv-fixture.test")) === 0);
  }

  // ===================================================================================================================
  section("C. Create: one-time token, hash-only storage, link, audit");
  let firstId = "";
  let firstToken = "";
  {
    const r = await create(operator, { orgId: A, name: "Nadia Fictional", email: "  Nadia.Invitee@UINV-fixture.test ", role: "admin" });
    ok("C1 an invitation is created for an existing, active company: admin role, normalized e-mail", r.ok);
    if (!r.ok) return;
    firstId = r.id;
    const m = /^https:\/\/erp\.example\.test\/join\/accept#t=([A-Za-z0-9_-]{43})$/.exec(r.link);
    firstToken = m?.[1] ?? "";
    secretsSeen.push(firstToken, r.link);
    const row = await invRow(r.id);
    ok("C2 the link is the configured origin + /join/accept#t=<token> (the token in the fragment, never sent to a server); the token is 43 base64url characters = 256 random bits", !!m && Buffer.from(firstToken, "base64url").length === 32);
    ok("C3 ONLY sha256(token) is stored: the row holds the digest, never the token or the link", !!row && row.token_hash === sha256(firstToken) && row.email_normalized === "nadia.invitee@uinv-fixture.test" && row.requested_role === "admin" && row.org_id === A);
    const everywhere = JSON.stringify(await q(`select * from user_invitations`)) + JSON.stringify(await q(`select * from platform_audit_events`));
    ok("C4 …neither the token nor the link appears in any invitation or audit row; the digest is not in the audit trail", !everywhere.includes(firstToken) && !everywhere.includes(r.link) && !JSON.stringify(await q(`select * from platform_audit_events`)).includes(row!.token_hash));
    ok("C5 the window is exactly 72 hours from creation", row!.expires_at.getTime() - row!.created_at.getTime() === 72 * 3_600_000);
    const audit = await auditsOf(r.id);
    ok("C6 the platform audit records user_invitation.created on user_invitation/<id> with the reference, company, e-mail, role and expiry, in the company's scope", audit.length === 1 && audit[0].action === "user_invitation.created" && audit[0].org_id === A && audit[0].after_safe?.reference === r.reference && audit[0].after_safe?.email === "nadia.invitee@uinv-fixture.test" && audit[0].after_safe?.role === "admin");
    const tokens = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const x = await create(operator, { orgId: B, email: `entropy${i}@uinv-fixture.test` });
      if (x.ok) {
        tokens.add(x.link);
        secretsSeen.push(x.link, x.link.split("#t=")[1]);
      }
    }
    ok("C7 every invitation gets a different token (no reuse across invitations)", tokens.size === 3);
  }

  // ===================================================================================================================
  section("C. Create refusals change nothing");
  {
    const stepBefore = await lastStep(operator);
    const before = await n(`select count(*)::int as n from user_invitations`);
    const dup = await create(operator, { orgId: A, email: "nadia.invitee@uinv-fixture.test" });
    const dupOther = await create(operator, { orgId: B, email: "NADIA.INVITEE@uinv-fixture.test" });
    const userEmail = await create(operator, { orgId: A, email: "Admin.Alpha@uinv-fixture.test" });
    const otherCompanyUser = await create(operator, { orgId: A, email: "owner.beta@uinv-fixture.test" });
    const companyInv = await create(operator, { orgId: A, email: "pending.owner@uinv-fixture.test" });
    const suspended = await create(operator, { orgId: S, email: "into.suspended@uinv-fixture.test" });
    const unknown = await create(operator, { orgId: 987654321, email: "unknown.company@uinv-fixture.test" });
    ok("C8 an unexpired invitation for the e-mail (same or ANOTHER company) is CONFLICT naming it; an e-mail of ANY customer user (any letter case) is EMAIL_CONFLICT; a pending COMPANY invitation for it is CONFLICT naming it",
      codeOf(dup) === "CONFLICT" && !dup.ok && dup.pendingReference === reads.userInvitationReference(firstId) && codeOf(dupOther) === "CONFLICT" && codeOf(userEmail) === "EMAIL_CONFLICT" && codeOf(otherCompanyUser) === "EMAIL_CONFLICT" && codeOf(companyInv) === "CONFLICT" && !companyInv.ok && /^INV-/.test(companyInv.companyInvitationReference ?? ""));
    ok("C9 a suspended company is COMPANY_SUSPENDED; an unknown company is NOT_FOUND", codeOf(suspended) === "COMPANY_SUSPENDED" && codeOf(unknown) === "NOT_FOUND");
    const formats = await Promise.all([
      actions.createUserInvitation(req(operator), { orgId: String(A), name: "X", email: "fmt1@uinv-fixture.test", role: "owner", password: STRONG, totpCode: codeFor(operator) }).then(codeOf),
      actions.createUserInvitation(req(operator), { orgId: String(A), name: "X", email: "not-an-email", role: "staff", password: STRONG, totpCode: codeFor(operator) }).then(codeOf),
      actions.createUserInvitation(req(operator), { orgId: String(A), name: "‮X", email: "fmt3@uinv-fixture.test", role: "staff", password: STRONG, totpCode: codeFor(operator) }).then(codeOf),
      actions.createUserInvitation(req(operator), { orgId: String(A), name: "", email: "fmt4@uinv-fixture.test", role: "staff", password: STRONG, totpCode: codeFor(operator) }).then(codeOf),
      actions.createUserInvitation(req(operator), { orgId: "A1", name: "X", email: "fmt5@uinv-fixture.test", role: "staff", password: STRONG, totpCode: codeFor(operator) }).then(codeOf),
    ]);
    ok("C10 the owner role, a malformed e-mail, a name with a direction override, an empty name and a malformed company id are refused before anything is read (VALIDATION_FAILED / NOT_FOUND)", same(formats, ["VALIDATION_FAILED", "VALIDATION_FAILED", "VALIDATION_FAILED", "VALIDATION_FAILED", "NOT_FOUND"]), formats.join(","));
    ok("C11 …none of these refusals wrote an invitation or spent a code", (await n(`select count(*)::int as n from user_invitations`)) === before && (await lastStep(operator)) === stepBefore);
    const wrongPassword = await create(operator, { orgId: A, email: "stepup1@uinv-fixture.test" }, { password: "Wrong-Password-11!" });
    const wrongCode = await create(operator, { orgId: A, email: "stepup2@uinv-fixture.test" }, { totpCode: String((Number(codeFor(operator)) + 1) % 1_000_000).padStart(6, "0") });
    nextStep();
    const used = codeFor(operator);
    const spend = await actions.createUserInvitation(req(operator), { orgId: String(B), name: "Spend", email: "stepup3@uinv-fixture.test", role: "staff", password: STRONG, totpCode: used });
    const replay = await actions.createUserInvitation(req(operator), { orgId: String(B), name: "Replay", email: "stepup4@uinv-fixture.test", role: "staff", password: STRONG, totpCode: used });
    ok("C12 a wrong password is INVALID_CREDENTIALS, a wrong code and a replayed code are MFA_INVALID (each counts against the durable throttle)", codeOf(wrongPassword) === "INVALID_CREDENTIALS" && codeOf(wrongCode) === "MFA_INVALID" && spend.ok && codeOf(replay) === "MFA_INVALID" && (await openFor("stepup4@uinv-fixture.test")) === 0);
    const stages = await rejectedStages();
    ok("C13 every refusal after the format check is recorded as a rejected attempt with its stage", ["pending_conflict", "email_conflict", "company_invitation_conflict", "company_suspended", "password", "mfa", "replay"].every((s) => stages.includes(s)), stages.join(","));
  }

  // ===================================================================================================================
  section("C. The durable hourly limit; an expired holder gives up its slot");
  {
    const LIMIT = reads.USER_INVITATION_RATE_LIMIT.max;
    let made = 0;
    for (let i = 0; i < LIMIT; i++) if ((await create(limited, { orgId: B, email: `rate${i}@uinv-fixture.test` })).ok) made += 1;
    const over = await create(limited, { orgId: B, email: "rate.over@uinv-fixture.test" });
    const counted = await n(`select count(*)::int as n from user_invitations where invited_by_platform_admin_id = $1`, [limited.id]);
    ok(`C14 ${LIMIT} invitations per operator per rolling hour, counted from committed rows: the next is RATE_LIMITED (another operator is not affected)`, made === LIMIT && codeOf(over) === "RATE_LIMITED" && counted === LIMIT && (await create(second, { orgId: B, email: "rate.other@uinv-fixture.test" })).ok);
    const expired = await directInvitation(A, "expired.holder@uinv-fixture.test", keeper.id, { createdAgoMs: 100 * 3_600_000 });
    const replaced = await create(operator, { orgId: A, email: "expired.holder@uinv-fixture.test" });
    const old = await invRow(expired);
    const oldAudit = await auditsOf(expired);
    ok("C15 an EXPIRED invitation holding the e-mail is revoked by the create (attributed, audited as replaced) and the new invitation names it", replaced.ok && replaced.replacedReference === reads.userInvitationReference(expired) && !!old?.revoked_at && old.revoked_by_platform_admin_id === operator.id && oldAudit.some((x) => x.action === "user_invitation.revoked" && x.after_safe?.replacedBy === (replaced.ok ? replaced.reference : "")) && (await openFor("expired.holder@uinv-fixture.test")) === 1);
  }

  // ===================================================================================================================
  section("R. Revoke");
  {
    const target = await create(operator, { orgId: A, email: "revoke.me@uinv-fixture.test" });
    if (!target.ok) throw new Error("fixture invitation failed");
    const shortReason = await revoke(operator, target.id, { reason: "short" });
    const r1 = await revoke(operator, target.id);
    const r2 = await revoke(operator, target.id);
    const row = await invRow(target.id);
    const audit = await auditsOf(target.id);
    ok("R1 a reason of 10–500 characters is required (VALIDATION_FAILED)", codeOf(shortReason) === "VALIDATION_FAILED");
    ok("R2 revoke (fresh code + reason): the invitation is final (revoked, attributed); a second revoke is CONFLICT", r1.ok && codeOf(r2) === "CONFLICT" && !!row?.revoked_at && row.revoked_by_platform_admin_id === operator.id && (await openFor("revoke.me@uinv-fixture.test")) === 0);
    ok("R3 …audited as user_invitation.revoked with the reason and the state before (pending → revoked)", audit.some((x) => x.action === "user_invitation.revoked" && x.reason === REASON && x.before_safe?.state === "pending" && x.after_safe?.state === "revoked"));
    const exp = await directInvitation(B, "revoke.expired@uinv-fixture.test", keeper.id, { createdAgoMs: 80 * 3_600_000 });
    const rExp = await revoke(operator, exp);
    ok("R4 an expired invitation can be revoked too (expired → revoked)", rExp.ok && (await auditsOf(exp)).some((x) => x.before_safe?.state === "expired"));
    const acc = await directInvitation(A, "accepted.fixture@uinv-fixture.test", keeper.id);
    await q(`update user_invitations set accepted_at = $3, accepted_user_id = $2 where id = $1`, [acc, accUser, new Date(nowMs)]);
    const rAcc = await revoke(operator, acc);
    const iAcc = await reissue(operator, acc);
    ok("R5 an accepted invitation (written directly here; PO-03D's acceptance is verified in verify:platform-user-acceptance) can be neither revoked nor re-issued (INVITE_USED)", codeOf(rAcc) === "INVITE_USED" && codeOf(iAcc) === "INVITE_USED");
    const unknownId = await revoke(operator, "00000000-0000-4000-8000-000000000000");
    const malformedId = await revoke(operator, "not-a-uuid");
    ok("R6 an unknown or malformed invitation id is NOT_FOUND", codeOf(unknownId) === "NOT_FOUND" && codeOf(malformedId) === "NOT_FOUND");
  }

  // ===================================================================================================================
  section("I. Re-issue (pending, expired, revoked) and its lineage");
  {
    const p = await create(operator, { orgId: A, name: "Reissue Pending", email: "reissue.pending@uinv-fixture.test", role: "admin" });
    if (!p.ok) throw new Error("fixture invitation failed");
    secretsSeen.push(p.link);
    const r = await reissue(operator, p.id);
    const oldRow = await invRow(p.id);
    const newRow = r.ok ? await invRow(r.id) : undefined;
    ok("I1 re-issuing a PENDING invitation revokes it and creates a new one for the same company, invitee and role, with a new token and a new 72-hour window", r.ok && !!oldRow?.revoked_at && !!newRow && newRow.org_id === A && newRow.name === "Reissue Pending" && newRow.requested_role === "admin" && newRow.token_hash !== oldRow.token_hash && newRow.expires_at.getTime() - newRow.created_at.getTime() === 72 * 3_600_000 && (r.ok ? r.link !== p.link : false));
    ok("I2 …the lineage is in the audit trail: the old one revoked (\"Re-issued as …\", replacedBy) and the new one user_invitation.reissued (replaces)", r.ok && (await auditsOf(p.id)).some((x) => x.action === "user_invitation.revoked" && x.after_safe?.replacedBy === r.reference && /^Re-issued as UIN-/.test(x.reason ?? "")) && (await auditsOf(r.id)).some((x) => x.action === "user_invitation.reissued" && x.after_safe?.replaces === p.reference));
    const e = await directInvitation(B, "reissue.expired@uinv-fixture.test", keeper.id, { createdAgoMs: 90 * 3_600_000 });
    const re = await reissue(operator, e);
    ok("I3 re-issuing an EXPIRED invitation works the same way (expired → revoked, a new pending one)", re.ok && !!(await invRow(e))?.revoked_at && (await openFor("reissue.expired@uinv-fixture.test")) === 1);
    const v = await create(operator, { orgId: B, email: "reissue.revoked@uinv-fixture.test" });
    if (!v.ok) throw new Error("fixture invitation failed");
    await revoke(operator, v.id);
    const rv = await reissue(operator, v.id);
    ok("I4 re-issuing a REVOKED invitation creates a new pending one; the revoked one stays exactly as it was", rv.ok && (await openFor("reissue.revoked@uinv-fixture.test")) === 1 && (await auditsOf(v.id)).filter((x) => x.action === "user_invitation.revoked").length === 1);
    const blocked = await reissue(operator, v.id);
    ok("I5 …re-issuing it again while its successor is pending is CONFLICT (one open invitation per e-mail)", codeOf(blocked) === "CONFLICT" && (await openFor("reissue.revoked@uinv-fixture.test")) === 1);
    const late = await directInvitation(A, lateEmail, keeper.id);
    const lateReissue = await reissue(operator, late);
    ok("I6 an invitation whose e-mail a customer user now holds (registered later, any letter case) can't be re-issued (EMAIL_CONFLICT)", codeOf(lateReissue) === "EMAIL_CONFLICT");
    await revoke(operator, late);
  }

  // ===================================================================================================================
  section("K. Concurrency (deterministic barriers)");
  {
    // K1 — two operators issue for the same e-mail at once: both queue on the e-mail lock; exactly one invitation results.
    const email = "simultaneous@uinv-fixture.test";
    const held = await blocker(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`platform-invitation-email:${email}`]);
    nextStep();
    const c1 = actions.createUserInvitation(req(operator), { orgId: String(A), name: "Sim One", email, role: "staff", password: STRONG, totpCode: codeFor(operator) });
    const c2 = actions.createUserInvitation(req(second), { orgId: String(B), name: "Sim Two", email, role: "admin", password: STRONG, totpCode: codeFor(second) });
    const bothWait = await until(async () => (await lockWaiters(EMAIL_LOCK)) >= 2);
    await held.release();
    const [k1, k2] = await Promise.all([c1, c2]);
    ok("K1 two simultaneous invitations for one e-mail (two operators, two companies): both wait on the e-mail lock; exactly one is created, the other is CONFLICT", bothWait && [k1, k2].filter((x) => x.ok).length === 1 && [k1, k2].some((x) => codeOf(x) === "CONFLICT") && (await openFor(email)) === 1);
    // K2 — revoke and re-issue of the same pending invitation at once.
    const t = await create(operator, { orgId: A, email: "race.revoke@uinv-fixture.test" });
    if (!t.ok) throw new Error("fixture invitation failed");
    const held2 = await blocker(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, ["platform-invitation-email:race.revoke@uinv-fixture.test"]);
    nextStep();
    const pRevoke = actions.revokeUserInvitation(req(operator), { invitationId: t.id, reason: REASON, totpCode: codeFor(operator) });
    await until(async () => (await lockWaiters(EMAIL_LOCK)) >= 1);
    const pReissue = actions.reissueUserInvitation(req(second), { invitationId: t.id, password: STRONG, totpCode: codeFor(second) });
    await until(async () => (await lockWaiters(EMAIL_LOCK)) >= 2);
    await held2.release();
    const [kr, ki] = await Promise.all([pRevoke, pReissue]);
    ok("K2 revoke queued first, re-issue behind it: the revoke applies; the re-issue then works from a REVOKED source — one new pending invitation; never two open", kr.ok && ki.ok && (await openFor("race.revoke@uinv-fixture.test")) === 1 && (await n(`select count(*)::int as n from user_invitations where email_normalized = 'race.revoke@uinv-fixture.test' and revoked_at is not null`)) === 1, `${codeOf(kr)} / ${codeOf(ki)}`);
    // K3 — a create waiting on the company row while the company is being suspended.
    const held3 = await blocker(`select id from orgs where id = $1 for no key update`, [C]);
    await held3.client.query(`insert into tenant_access_controls (org_id, access_status, reason, changed_by_platform_admin_id, changed_at) values ($1, 'suspended', 'Fixture: suspended during the race', $2, now())`, [C, operator.id]);
    nextStep();
    const pc = actions.createUserInvitation(req(operator), { orgId: String(C), name: "Racer", email: "racer@uinv-fixture.test", role: "staff", password: STRONG, totpCode: codeFor(operator) });
    const waits = await until(async () => (await lockWaiters(ORG_LOCKED)) >= 1);
    await held3.release(true);
    const kc = await pc;
    ok("K3 a create waiting on the company row while a suspension commits sees the suspension (COMPANY_SUSPENDED); no invitation is written", waits && codeOf(kc) === "COMPANY_SUSPENDED" && (await openFor("racer@uinv-fixture.test")) === 0);
    // K4 — a customer user takes the e-mail while a create, its read-only pre-checks already passed, waits on the e-mail
    // lock: the transaction's own re-check (lockedChecks) must see the user and refuse, writing nothing.
    const lateEmail = "late.user@uinv-fixture.test";
    const held4 = await blocker(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`platform-invitation-email:${lateEmail}`]);
    nextStep();
    const p4 = actions.createUserInvitation(req(operator), { orgId: String(A), name: "Late User", email: lateEmail, role: "staff", password: STRONG, totpCode: codeFor(operator) });
    const waits4 = await until(async () => (await lockWaiters(EMAIL_LOCK)) >= 1);
    const lateUser = await newUser(B, "staff", lateEmail.toUpperCase());
    await held4.release();
    const k4 = await p4;
    const k4Stages = await rejectedStages();
    ok("K4 a customer user takes the e-mail (another letter case) while a create waits on the e-mail lock after its pre-checks: the in-transaction re-check refuses it (EMAIL_CONFLICT, recorded as rejected); no invitation is written",
      waits4 && codeOf(k4) === "EMAIL_CONFLICT" && (await openFor(lateEmail)) === 0 && k4Stages[k4Stages.length - 1] === "email_conflict", `${waits4} ${codeOf(k4)} ${k4Stages.slice(-1)}`);
    // The stand-in registration is the suite's own write: removed again, so P1 still proves invitations change no business table.
    await q(`delete from users where id = $1`, [lateUser]);
  }

  // ===================================================================================================================
  section("A. An audit failure or an interrupted transaction rolls everything back");
  {
    const stepBefore = await lastStep(operator);
    await failingInsert("platform_audit_events", true);
    let outage: Outcome;
    try {
      outage = await create(operator, { orgId: A, email: "audit.down@uinv-fixture.test" });
    } finally {
      await failingInsert("platform_audit_events", false);
    }
    ok("A1 the audit trail refuses the record → AUDIT_UNAVAILABLE: no invitation, no code consumed", codeOf(outage) === "AUDIT_UNAVAILABLE" && (await openFor("audit.down@uinv-fixture.test")) === 0 && (await lastStep(operator)) === stepBefore);
    await failingInsert("user_invitations", true);
    let insertFail: Outcome;
    try {
      insertFail = await create(operator, { orgId: A, email: "insert.down@uinv-fixture.test" });
    } finally {
      await failingInsert("user_invitations", false);
    }
    ok("A2 the invitation insert itself fails → a failure is reported; nothing remains (no row, no success audit, no code consumed)", !insertFail.ok && (await openFor("insert.down@uinv-fixture.test")) === 0 && (await n(`select count(*)::int as n from platform_audit_events where action = 'user_invitation.created' and after_safe->>'email' = 'insert.down@uinv-fixture.test'`)) === 0 && (await lastStep(operator)) === stepBefore);
    const pr = await create(operator, { orgId: A, email: "revoke.outage@uinv-fixture.test" });
    if (!pr.ok) throw new Error("fixture invitation failed");
    await failingInsert("platform_audit_events", true);
    let rOut: Outcome;
    try {
      rOut = await revoke(operator, pr.id);
    } finally {
      await failingInsert("platform_audit_events", false);
    }
    ok("A3 a revoke whose audit record fails is not applied (the invitation stays pending)", codeOf(rOut) === "AUDIT_UNAVAILABLE" && !(await invRow(pr.id))?.revoked_at);
  }

  // ===================================================================================================================
  section("X. Cross-company isolation");
  {
    const listA = await reads.listUserInvitations(req(operator), { org: String(A) });
    const listB = await reads.listUserInvitations(req(operator), { org: String(B) });
    ok("X1 a company's list holds only its own invitations", listA.rows.length > 0 && listA.rows.every((r) => r.orgId === A) && listB.rows.every((r) => r.orgId === B) && listA.company?.orgId === A);
    const detail = await reads.getUserInvitationDetail(req(operator), firstId);
    ok("X2 an invitation's detail names its company; its company can never change (the guard)", detail.orgId === A && detail.companyName === "Invite Fixture Alpha" && (await sqlState(`update user_invitations set org_id = $2 where id = $1`, [firstId, B])) === "23514");
    ok("X3 the list and the detail select allow-listed columns only — never the token hash", !JSON.stringify(listA).includes(firstToken) && !/token_?hash|tokenHash/i.test(JSON.stringify(detail)) && !JSON.stringify(detail).includes(sha256(firstToken)));
    const viewed = await n(`select count(*)::int as n from platform_audit_events where action = 'user_invitation.viewed' and entity_id = $1`, [firstId]);
    ok("X4 opening an invitation's detail is an audited view (user_invitation.viewed)", viewed === 1);
    const filtered = await reads.listUserInvitations(req(operator), { state: "revoked" });
    const searched = await reads.listUserInvitations(req(operator), { q: "nadia" });
    const byRef = await reads.listUserInvitations(req(operator), { q: reads.userInvitationReference(firstId) });
    ok("X5 filters and search: state, invitee name / e-mail and the UIN reference", filtered.rows.length > 0 && filtered.rows.every((r) => r.state === "revoked") && searched.rows.some((r) => r.id === firstId) && byRef.rows.length === 1 && byRef.rows[0].id === firstId);
    const badState = await reads.listUserInvitations(req(operator), { state: "approved" }).then(() => "OK", (e: { code?: string }) => e.code ?? "ERR");
    ok("X6 an unknown state is VALIDATION_FAILED", badState === "VALIDATION_FAILED");
  }

  // ===================================================================================================================
  section("T. Seat reservations (read-only)");
  {
    const s0 = await seats.readSeatAccounting(db, Tco);
    const p1 = await directInvitation(Tco, "seat.pending1@uinv-fixture.test", keeper.id);
    await directInvitation(Tco, "seat.pending2@uinv-fixture.test", keeper.id);
    const expired = await directInvitation(Tco, "seat.expired@uinv-fixture.test", keeper.id, { createdAgoMs: 100 * 3_600_000 });
    const revoked = await directInvitation(Tco, "seat.revoked@uinv-fixture.test", keeper.id);
    await q(`update user_invitations set revoked_at = $3, revoked_by_platform_admin_id = $2 where id = $1`, [revoked, operator.id, new Date(nowMs)]);
    await directInvitation(Tco, "owner.alpha@uinv-fixture.test", keeper.id);
    const s1 = await seats.readSeatAccounting(db, Tco);
    ok("T1 occupied = active + disabled users + pending unexpired invitations: 2 users + 2 pending = 4 (an expired, a revoked and one whose e-mail a user already holds count nothing)", s0.occupied === 2 && s0.pendingInvitations === 0 && s1.users.total === 2 && s1.users.disabled === 1 && s1.pendingInvitations === 2 && s1.occupied === 4, JSON.stringify({ s0: s0.occupied, s1: s1.occupied, p: s1.pendingInvitations }));
    ok("T2 the allowance is the subscription's immutable seats snapshot (3): over by 1 — flagged, NEVER enforced", s1.allowance.state === "assigned" && s1.allowance.seats === 3 && s1.overLimit && s1.overBy === 1 && s1.remaining === 0 && s1.enforced === false);
    const many = await seats.readSeatAccountingForCompanies(db, [Tco, A, L]);
    ok("T3 the directory's batched read gives the same numbers (one rule)", many.get(Tco)?.occupied === 4 && many.get(Tco)?.pendingInvitations === 2 && same(many.get(A)?.occupied, (await seats.readSeatAccounting(db, A)).occupied));
    const later = await seats.readSeatAccounting(db, Tco, new Date(Date.now() + 80 * 3_600_000));
    ok("T4 when the window ends, the reservation ends with it (read at +80 h: 0 pending)", later.pendingInvitations === 0 && later.occupied === 2);
    await q(`update user_invitations set revoked_at = $3, revoked_by_platform_admin_id = $2 where id = $1`, [p1, operator.id, new Date(nowMs)]);
    ok("T5 a revoked invitation releases its seat at once", (await seats.readSeatAccounting(db, Tco)).pendingInvitations === 1);
    const preview = await actions.previewUserInvitation(req(operator), { orgId: String(Tco), name: "Preview", email: "preview.only@uinv-fixture.test", role: "staff" });
    ok("T6 the create preview reports the company's seats (display only) and creates nothing", preview.ok && preview.seats?.occupied === 3 && (await openFor("preview.only@uinv-fixture.test")) === 0);
    const over = await create(operator, { orgId: Tco, email: "over.limit@uinv-fixture.test" });
    ok("T7 with seat enforcement switched off (the default), an invitation into a company already at its allowance is still created (PO-03D enforces it when switched on — verify:platform-seat-paths)", over.ok && (await seats.readSeatAccounting(db, Tco)).overBy === 1, `${codeOf(over)} overBy=${(await seats.readSeatAccounting(db, Tco)).overBy}`);
    const seatSrc = readFileSync(join(ROOT, "src/lib/platform/seat-accounting.ts"), "utf8");
    ok("T8 seat accounting stays read-only: no insert, update, delete or lock; no enforcement function exists", !/\.(insert|update|delete)\(|\.for\(|for update|for share/i.test(seatSrc.replace(/\/\/.*$/gm, "")) && !/assertUserSeatAvailable|enforceSeat|seatLimitExceeded/.test(seatSrc));
    void expired;
  }

  // ===================================================================================================================
  section("O. No outbound communication; acceptance only through PO-03D's /join/accept");
  {
    // Code only (comments state what is NOT done, and name the channels).
    const files = ["src/lib/platform/user-invitations.ts", "src/lib/platform/user-invitation-actions.ts", "src/app/(platform)/user-invitation-actions.ts"].map((f) => readFileSync(join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1"));
    ok("O1 the invitation code sends nothing: no mail, SMS or WhatsApp library, no network call", files.every((s) => !/nodemailer|twilio|whatsapp|sendgrid|mailgun|resend|sendMail|smtp|\bfetch\(|https?\.request\(/i.test(s)));
    const appFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? appFiles(join(dir, d.name)) : [join(dir, d.name)]));
    const routes = appFiles(join(ROOT, "src/app")).filter((f) => /\/(page|route)\.tsx?$/.test(f) && /join|accept/i.test(f.slice(join(ROOT, "src/app").length)));
    // PO-03D (sub-batch A): /join/accept now serves the link — ONE page, behind CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED (its
    // flow is verified in verify:platform-user-acceptance and pinned by boundary rule 50).
    const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    const joinRoutes = routes.filter((f) => !/register\/accept/.test(f)).map((f) => f.slice(ROOT.length + 1));
    const pathNamers = appFiles(join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f) && stripComments(readFileSync(f, "utf8")).includes("/join/accept")).map((f) => f.slice(ROOT.length + 1)).sort();
    ok("O2 the link's /join/accept is served by exactly ONE page — PO-03D's (invite)/join/accept, behind its own switch — and besides PO-02D3's /register/accept no acceptance route exists; in code (comments ignored) only the link builder (user-invitations.ts) and the customer proxy's exact-path pass name the path",
      JSON.stringify(joinRoutes) === JSON.stringify([join("src", "app", "(invite)", "join", "accept", "page.tsx")]) && JSON.stringify(pathNamers) === JSON.stringify([join("src", "lib", "platform", "user-invitations.ts"), join("src", "proxy.ts")].sort()),
      `${joinRoutes.join(", ")} | ${pathNamers.join(", ")}`);
    ok("O3 the invitation administration writes neither accepted_at nor accepted_user_id (only PO-03D's acceptance core does — verify:platform-user-acceptance): no update or insert of the invitation here names them", !files.some((s) => /\.set\(\{[^}]*\baccepted(At|UserId)\b|\.values\(\{[^}]*\baccepted(At|UserId)\b|accepted_at\s*=|accepted_user_id\s*=/.test(s.replace(/\/\/.*$/gm, ""))));
  }

  // ===================================================================================================================
  section("P. No business record changed; nothing secret stored, printed or audited");
  {
    ok("P1 no business table changed (checksum over every non-platform, non-invitation table — users included: an invitation never creates a user)", (await businessChecksum()) === businessBefore);
    const audits = JSON.stringify(await q(`select reason, before_safe, after_safe, actor_label, user_agent, ip_address from platform_audit_events`));
    const leaked = secretsSeen.filter((s) => s.length >= 6 && audits.includes(s));
    ok("P2 no password, TOTP secret, recovery code, platform or customer token, invitation token or link appears in any audit record", leaked.length === 0, `${leaked.length} leaked`);
    const stored = JSON.stringify(await q(`select * from user_invitations`));
    ok("P3 no invitation token or link is stored anywhere in user_invitations", secretsSeen.filter((s) => /#t=|^[A-Za-z0-9_-]{43}$/.test(s)).every((s) => !stored.includes(s)));
    const printed = secretsSeen.concat([CANARY.hash, CANARY.mfa, CANARY.rec]).filter((s) => s.length >= 6 && logged.some((l) => l.includes(s)));
    ok("P4 nothing the suite captured from the console output contains a secret, a token or a link", printed.length === 0, `${printed.length} printed`);
  }
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-user-invitations");
} catch (err) {
  ok("the suite completed without an exception", false, describeError(err));
  exitCode = summary("verify:platform-user-invitations");
} finally {
  await pool.end().catch(() => undefined);
  if (!process.env.PLATFORM_TEST_KEEP_DATABASES) {
    if (created) await dropDisposableDatabase(testDbName).catch(() => undefined);
    for (const name of extraDbs) await dropDisposableDatabase(name).catch(() => undefined);
  }
}
process.exit(exitCode);
