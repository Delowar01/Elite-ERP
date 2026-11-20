/**
 * Platform Owner PO-02D2 — company invitation administration (src/lib/platform/invitation-actions.ts and the read
 * models in src/lib/platform/invitations.ts), in-process, on real PostgreSQL.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *     npm run verify:platform-invitations
 *
 * One disposable `_test_only_` database (dropped at the end): the full branch schema with the reviewed PO-01A → PO-02A →
 * PO-02D1A SQL, then the reviewed PO-02D1B Trial seed through its guarded runner (preflight gate included), fictional
 * operators, companies and users only. TEST-ONLY secrets are generated in memory and never printed; no token or link is
 * printed either. Concurrency uses deterministic barriers: an external session holds the lock a step needs, the suite
 * waits until the expected backends are observed waiting on it (pg_stat_activity), then releases it.
 * Tags #1 … #23 are the PO-02D2 test categories (#24, the UI, is verify:platform-invitations-browser).
 */
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import type { Client } from "pg";
import { connectDisposable, createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { section, ok, summary, describeError } from "./platform/harness";

const ROOT = process.cwd();
const testDbName = disposableName("po02d2_invite");
process.env.DATABASE_URL = databaseUrlFor(testDbName);
process.env.PLATFORM_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.FIELD_ENCRYPTION_KEYS = `1:${randomBytes(32).toString("base64")}`;
process.env.PLATFORM_CONSOLE_ENABLED = "true";
process.env.PLATFORM_INVITATIONS_ENABLED = "true";
process.env.PLATFORM_TRUSTED_PROXY_HOPS = "1";
const ORIGIN = "https://customer.erp.test";
process.env.CUSTOMER_PUBLIC_ORIGIN = ORIGIN;
delete process.env.PLATFORM_INVITATIONS_LOOPBACK_ORIGIN;

let created = false;
await createPlatformTestDatabase("po02d2_invite", testDbName);
created = true;
{
  // The reviewed PO-02D1B seed through its guarded runner (local-db-guard, release preflight, the SQL's own guard).
  const { runSeed } = await import("../scripts/platform/trial-seed");
  const seeded = await runSeed(process.env.DATABASE_URL);
  if (seeded.check.state !== "complete") throw new Error(`the Trial seed did not complete: ${seeded.check.state}`);
}

const { db, pool, platformAdminsTable, orgsTable, usersTable } = await import("../src/db");
const auth = await import("../src/lib/platform/auth");
const mfa = await import("../src/lib/platform/mfa");
const totp = await import("../src/lib/platform/totp");
const audit = await import("../src/lib/platform/audit");
const { platformClock } = await import("../src/lib/platform/clock");
const console_ = await import("../src/lib/platform/console");
const guards = await import("../src/lib/platform/guards");
const flags = await import("../src/lib/platform/flags");
const invitations = await import("../src/lib/platform/invitations");
const actions = await import("../src/lib/platform/invitation-actions");
const companies = await import("../src/lib/platform/companies");
const tenantAuth = await import("../src/lib/auth");
const { PLATFORM_ERROR_MESSAGES } = await import("../src/lib/platform/errors");
(pool as unknown as { options: { max: number } }).options.max = 40;
// A backend terminated on purpose (section 16) must not crash the suite: idle and checked-out clients both get a listener.
pool.on("error", () => undefined);
pool.on("connect", (client) => client.on("error", () => undefined));

// ---- deterministic platform clock (TOTP steps, throttle windows, session idle time, invitation timestamps) ----
let nowMs = Math.floor(Date.now() / 1000) * 1000;
platformClock.now = () => new Date(nowMs);
const nextStep = () => {
  nowMs = (totp.totpStepAt(new Date(nowMs)) + 1) * 30_000 + 1_000;
};
const HOUR = 3_600_000;
const HOST = "console.erp.test";
const headersFor = (ip: string, over: Record<string, string | null> = {}) => {
  const h = new Headers({ host: HOST, origin: `https://${HOST}`, "sec-fetch-site": "same-origin", "user-agent": "verify-platform-invitations", "x-forwarded-for": ip });
  for (const [k, v] of Object.entries(over)) if (v === null) h.delete(k);
  else h.set(k, v);
  return h;
};
const q = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const secretsSeen: string[] = [];
const tokensSeen: string[] = [];

// ---- every console line written during the run is captured (none may hold a token, a link or a secret) ----
const logged: string[] = [];
for (const level of ["log", "info", "warn", "error", "debug"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    logged.push(
      args
        .map((a) => {
          if (typeof a === "string") return a;
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join(" "),
    );
    original(...(args as []));
  };
}
// ---- outbound connections and fetch() are recorded: only the loopback test database may be reached (no delivery) ----
const outbound: string[] = [];
const dbPort = Number(new URL(process.env.DATABASE_URL!).port || 5432);
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  const first = args[0] as { port?: number | string; host?: string; path?: string } | number | string;
  const port = typeof first === "object" && first !== null ? Number(first.port) : Number(first);
  const hostArg = typeof first === "object" && first !== null ? (first.host ?? first.path ?? "") : typeof args[1] === "string" ? args[1] : "";
  if (!(port === dbPort && ["127.0.0.1", "localhost", "::1", ""].includes(String(hostArg)))) outbound.push(`${hostArg}:${Number.isFinite(port) ? port : "?"}`);
  return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
} as typeof net.Socket.prototype.connect;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
  outbound.push(`fetch ${String(args[0]).slice(0, 80)}`);
  return originalFetch(...args);
}) as typeof fetch;

// ---- fictional operators --------------------------------------------------------------------------------
const STRONG = "Lantern-Quarry-58!v";
const WRONG = "Wrong-Password-11!x";
secretsSeen.push(STRONG);
type Admin = { id: string; email: string; secret: string; displayName: string; token: string; ip: string };
async function createAdmin(email: string, displayName: string, ip: string): Promise<Admin> {
  const { secret } = mfa.createTotpEnrollment(email);
  const { codes, hashes } = await mfa.createRecoveryCodeSet();
  const at = new Date(nowMs);
  const [row] = await db
    .insert(platformAdminsTable)
    .values({ emailNormalized: email, displayName, passwordHash: await auth.hashPlatformPassword(STRONG), isActive: true, mfaSecretEncrypted: mfa.encryptTotpSecret(secret), mfaRecoveryHashes: hashes, mfaEnrolledAt: at, passwordChangedAt: at, createdAt: at, updatedAt: at })
    .returning({ id: platformAdminsTable.id });
  secretsSeen.push(secret, ...codes);
  return { id: row.id, email, secret, displayName, token: "", ip };
}
const codeFor = (a: Admin, offset = 0) => totp.hotpCode(a.secret, totp.totpStepAt(new Date(nowMs)) + offset);
/** A six-digit code that matches NO step in the verification window (−1 … +1) at the current clock. */
function wrongCodeFor(a: Admin): string {
  for (let i = 0; ; i++) {
    const c = String((123457 + i * 7919) % 1_000_000).padStart(6, "0");
    if (totp.matchTotpStep(a.secret, c, new Date(nowMs), 1) === null) return c;
  }
}
async function signIn(a: Admin): Promise<void> {
  nextStep();
  const r = await console_.signInCore({ email: a.email, password: STRONG, totpCode: codeFor(a) }, { headers: headersFor(a.ip) });
  if (!r.ok) throw new Error(`fixture sign-in failed: ${r.code}`);
  a.token = r.token;
  secretsSeen.push(r.token);
}
const everyone: Admin[] = [];
/** Re-validate every operator's session (it touches last_seen_at), so the 30-minute idle limit never ends one mid-suite. */
async function keepAlive() {
  for (const a of everyone) await guards.authorizePlatformToken(a.token);
}
/** Move the clock past the hourly invitation window and sign every operator in again (fresh sessions, fresh throttle windows). */
async function newHour() {
  nowMs += HOUR + 60_000;
  for (const a of everyone) await signIn(a);
}
const reqOf = (a: Admin, over: Record<string, string | null> = {}, token: string | null = a.token) => ({ headers: headersFor(a.ip, over), token });
const lastStep = async (a: Admin) => Number((await q<{ s: string | null }>("select mfa_last_totp_step::text as s from platform_admins where id = $1", [a.id]))[0].s ?? -1);
const failuresRecorded = async () => Number((await q<{ n: number }>("select count(*)::int as n from platform_login_attempts where outcome = 'failure'"))[0].n);

let seq = 0;
const fields = (over: Record<string, unknown> = {}) => {
  seq++;
  return {
    companyName: `Fixture Trading ${seq}`,
    industry: "Exhibitions",
    companyEmail: `office${seq}@company-fixture.test`,
    country: "Saudi Arabia",
    currency: "SAR",
    ownerName: `Fixture Owner ${seq}`,
    ownerEmail: `owner${seq}@company-fixture.test`,
    ...over,
  };
};
type Created = Awaited<ReturnType<typeof actions.createCompanyInvitation>>;
type Outcome = { ok: boolean; code?: string };
const codeOf = (o: Outcome) => (o.ok ? "OK" : (o.code ?? "?"));
function keep(o: { ok: boolean; link?: string }) {
  if (o.ok && o.link) tokensSeen.push(o.link.split("#t=")[1]);
}
async function create(a: Admin, over: Record<string, unknown> = {}, opts: { password?: string; code?: string; confirm?: boolean; headers?: Record<string, string | null>; token?: string | null } = {}): Promise<Created> {
  nextStep();
  const o = await actions.createCompanyInvitation(reqOf(a, opts.headers ?? {}, opts.token === undefined ? a.token : opts.token), {
    ...fields(over),
    confirmDuplicateName: opts.confirm ?? false,
    password: opts.password ?? STRONG,
    totpCode: opts.code ?? codeFor(a),
  });
  keep(o);
  return o;
}
async function created1(a: Admin, over: Record<string, unknown> = {}): Promise<Extract<Created, { ok: true }>> {
  const o = await create(a, over);
  if (!o.ok) throw new Error(`fixture create failed: ${o.code}`);
  return o;
}
const revoke = (a: Admin, invitationId: string, reason = "Fixture: no longer needed", code?: string) => {
  nextStep();
  return actions.revokeCompanyInvitation(reqOf(a), { invitationId, reason, totpCode: code ?? codeFor(a) });
};
async function reissue(a: Admin, invitationId: string, opts: { password?: string; code?: string } = {}) {
  nextStep();
  const o = await actions.reissueCompanyInvitation(reqOf(a), { invitationId, password: opts.password ?? STRONG, totpCode: opts.code ?? codeFor(a) });
  keep(o);
  return o;
}
type InvRow = { id: string; token_hash: string; owner_email_normalized: string; revoked_at: Date | null; revoked_by_platform_admin_id: string | null; accepted_at: Date | null; expires_at: Date; created_at: Date; invited_by_platform_admin_id: string; company_name: string };
const invRow = async (id: string) =>
  (await q<InvRow>("select id, token_hash, owner_email_normalized, revoked_at, revoked_by_platform_admin_id, accepted_at, expires_at, created_at, invited_by_platform_admin_id, company_name from organization_invitations where id = $1", [id]))[0];
const pendingFor = async (email: string) => q<{ id: string }>("select id from organization_invitations where owner_email_normalized = $1 and accepted_at is null and revoked_at is null", [email]);
const invCount = async () => Number((await q<{ n: number }>("select count(*)::int as n from organization_invitations"))[0].n);
const termsCount = async () => Number((await q<{ n: number }>("select count(*)::int as n from organization_invitation_terms"))[0].n);
const auditOf = async (entityId: string) =>
  q<{ action: string; result: string; reason: string | null; after_safe: Record<string, unknown> | null; before_safe: Record<string, unknown> | null; actor_platform_admin_id: string | null }>(
    "select action, result, reason, after_safe, before_safe, actor_platform_admin_id from platform_audit_events where entity_type = 'organization_invitation' and entity_id = $1 order by id",
    [entityId],
  );
const auditCount = async (action: string) => Number((await q<{ n: number }>("select count(*)::int as n from platform_audit_events where action = $1", [action]))[0].n);
const stageCount = async (stage: string, adminId?: string) =>
  Number((await q<{ n: number }>(`select count(*)::int as n from platform_audit_events where entity_type = 'organization_invitation' and after_safe->>'stage' = $1${adminId ? " and actor_platform_admin_id = $2" : ""}`, adminId ? [stage, adminId] : [stage]))[0].n);
async function checksum(table: string): Promise<string> {
  const r = await q<{ h: string; n: number }>(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as h, count(*)::int as n from "${table}" t`);
  return `${r[0].n}:${r[0].h}`;
}
const trialVersionId = async () => (await q<{ id: string }>("select v.id from subscription_package_versions v join subscription_packages p on p.id = v.package_id where p.code = 'trial' and v.version_number = 1"))[0].id;

// ---- barriers -------------------------------------------------------------------------------------------------
const emailKey = (email: string) => `platform-invitation-email:${email}`;
async function holder(): Promise<Client> {
  const c = await connectDisposable(process.env.DATABASE_URL!);
  c.on("error", () => undefined);
  return c;
}
/** Backends of the test database waiting on a heavyweight lock of this kind (advisory, relation, tuple, transactionid). */
async function waiting(kind: string): Promise<number[]> {
  return (await q<{ pid: number }>("select pid from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and wait_event = $1 and pid <> pg_backend_pid()", [kind])).map((r) => r.pid);
}
async function untilWaiting(kind: string, n: number, timeoutMs = 60_000): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const pids = await waiting(kind);
    if (pids.length >= n) return pids;
    if (Date.now() > deadline) throw new Error(`barrier: expected ${n} backend(s) waiting on ${kind}, saw ${pids.length}`);
    await sleep(25);
  }
}
async function withEmailBarrier<T>(email: string, waiters: number, start: () => Promise<T>[]): Promise<T[]> {
  const lock = await holder();
  try {
    await lock.query("select pg_advisory_lock(hashtextextended($1, 0))", [emailKey(email)]);
    const runs = start();
    await untilWaiting("advisory", waiters);
    await lock.query("select pg_advisory_unlock(hashtextextended($1, 0))", [emailKey(email)]);
    return await Promise.all(runs);
  } finally {
    await lock.end().catch(() => undefined);
  }
}
async function injected(table: "platform_audit_events" | "organization_invitation_terms", on: boolean) {
  const name = table === "platform_audit_events" ? "po02d2_test_only_fail_audit" : "po02d2_test_only_fail_terms";
  if (on) {
    await q(`create or replace function ${name}() returns trigger language plpgsql as $$ begin raise exception 'injected failure (test only)'; end $$`);
    await q(`create trigger ${name} before insert on ${table} for each row execute function ${name}()`);
  } else {
    await q(`drop trigger if exists ${name} on ${table}`);
    await q(`drop function if exists ${name}()`);
  }
}
/** Make an invitation expired in place (created 4 days ago, expired 1 day ago) without moving the clock. */
async function expire(id: string) {
  await q("update organization_invitations set created_at = $2::timestamptz - interval '4 days', updated_at = $2::timestamptz - interval '4 days', expires_at = $2::timestamptz - interval '1 day' where id = $1", [id, new Date(nowMs).toISOString()]);
}
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

async function main() {
  const op = await createAdmin("operator@invite-fixture.test", "Fixture Operator", "198.51.100.10");
  const second = await createAdmin("second@invite-fixture.test", "Second Operator", "198.51.100.11");
  const stepper = await createAdmin("stepper@invite-fixture.test", "Step-up Operator", "198.51.100.12");
  const stepper2 = await createAdmin("stepper2@invite-fixture.test", "Step-up Operator Two", "198.51.100.13");
  const throttled = await createAdmin("throttled@invite-fixture.test", "Throttled Operator", "198.51.100.14");
  const limited = await createAdmin("limited@invite-fixture.test", "Limited Operator", "198.51.100.15");
  everyone.push(op, second, stepper, stepper2, limited);
  for (const a of [...everyone, throttled]) await signIn(a);

  // Fictional customer companies and users (the e-mail-collision, name-collision and acceptance fixtures).
  const [org] = await db.insert(orgsTable).values({ name: "Fixture Holding Group", country: "Saudi Arabia", currency: "SAR" }).returning({ id: orgsTable.id });
  const [acceptedOrg] = await db.insert(orgsTable).values({ name: "Fixture Accepted Org", country: "Saudi Arabia", currency: "SAR" }).returning({ id: orgsTable.id });
  await db.insert(orgsTable).values({ name: "  Fixture   Spaced    Holding ", country: "Saudi Arabia", currency: "SAR" });
  await db.insert(usersTable).values({ orgId: org.id, email: "Grace.Owner@Customer-Fixture.test", passwordHash: "$2a$10$abcdefghijklmnopqrstuuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZa", name: "Grace Fixture", role: "owner" });
  const TABLES = ["orgs", "users", "sessions", "tenant_access_controls", "tenant_subscriptions", "tenant_primary_owners", "subscription_events"];
  const before: Record<string, string> = {};
  for (const t of TABLES) before[t] = await checksum(t);

  // ------------------------------------------------------------------------------------------------
  section("1. Token entropy, hashing and the link format");
  {
    const many = Array.from({ length: 1000 }, () => invitations.newInvitationToken());
    ok("#1 1,000 tokens: each 43-character base64url, decoding to 32 random bytes (256 bits); the hash is sha256 as 64 hex",
      many.every((t) => /^[A-Za-z0-9_-]{43}$/.test(t.token) && Buffer.from(t.token, "base64url").length === 32 && t.tokenHash === sha256(t.token) && /^[0-9a-f]{64}$/.test(t.tokenHash)));
    ok("#1 …all 1,000 tokens and all 1,000 hashes are distinct", new Set(many.map((t) => t.token)).size === 1000 && new Set(many.map((t) => t.tokenHash)).size === 1000);
    const bytes = Buffer.concat(many.map((t) => Buffer.from(t.token, "base64url")));
    const ones = [...bytes].reduce((n, b) => n + b.toString(2).split("1").length - 1, 0) / (bytes.length * 8);
    ok("#1 …the 256,000 token bits are balanced (share of 1-bits within 0.49–0.51)", ones > 0.49 && ones < 0.51, ones.toFixed(4));
    const src = stripComments(read("src/lib/platform/invitations.ts")) + stripComments(read("src/lib/platform/invitation-actions.ts"));
    ok("#1 the token comes only from crypto.randomBytes(32).toString(\"base64url\") (no Math.random, no other source)", /randomBytes\(32\)\.toString\("base64url"\)/.test(src) && !/Math\.random|randomUUID|getRandomValues/.test(src));
    ok("#1 the link is <CUSTOMER_PUBLIC_ORIGIN>/register/accept#t=<token>: the token only in the fragment (never sent to a server)", invitations.invitationLink(ORIGIN, "abc") === `${ORIGIN}/register/accept#t=abc`);
    const all = read("src/lib/platform/invitations.ts") + read("src/lib/platform/invitation-actions.ts");
    ok("#4 invitationLink( is called exactly twice (create, re-issue) and newInvitationToken( once (the insert) — no other code can build a link",
      (stripComments(read("src/lib/platform/invitation-actions.ts")).match(/invitationLink\(/g) ?? []).length === 2 && (stripComments(all).match(/newInvitationToken\(/g) ?? []).length === 2);
  }

  // ------------------------------------------------------------------------------------------------
  section("2. Feature flags: invitations are off unless both flags are exactly \"true\" (nothing is written)");
  {
    const n0 = await invCount();
    const step0 = await lastStep(op);
    const anyId = "00000000-0000-4000-8000-000000000000";
    for (const value of [undefined, "", "TRUE", "True", "1", "yes", " true", "true "]) {
      if (value === undefined) delete process.env.PLATFORM_INVITATIONS_ENABLED;
      else process.env.PLATFORM_INVITATIONS_ENABLED = value;
      nextStep();
      const outs: Outcome[] = [
        await actions.createCompanyInvitation(reqOf(op), { ...fields(), confirmDuplicateName: false, password: STRONG, totpCode: codeFor(op) }),
        await actions.previewCompanyInvitation(reqOf(op), fields()),
        await actions.revokeCompanyInvitation(reqOf(op), { invitationId: anyId, reason: "Fixture reason text", totpCode: codeFor(op) }),
        await actions.reissueCompanyInvitation(reqOf(op), { invitationId: anyId, password: STRONG, totpCode: codeFor(op) }),
        await actions.readCompanyInvitation(reqOf(op), anyId),
      ];
      ok(`#23 PLATFORM_INVITATIONS_ENABLED=${JSON.stringify(value ?? null)} → every operation INVITATIONS_DISABLED`, outs.every((o) => !o.ok && o.code === "INVITATIONS_DISABLED") && !flags.isPlatformInvitationsEnabled(), outs.map(codeOf).join(" "));
    }
    const readCodes: string[] = [];
    for (const r of [() => invitations.listInvitationHistory(reqOf(op)), () => invitations.getInvitationHistory(reqOf(op), anyId)]) {
      try {
        await r();
        readCodes.push("OK");
      } catch (err) {
        readCodes.push((err as { code?: string }).code ?? "?");
      }
    }
    ok("#23 …and both history reads are unavailable too (INVITATIONS_DISABLED)", readCodes.every((c) => c === "INVITATIONS_DISABLED"), readCodes.join(" "));
    process.env.PLATFORM_INVITATIONS_ENABLED = "true";
    process.env.PLATFORM_CONSOLE_ENABLED = "";
    nextStep();
    const off = await actions.createCompanyInvitation(reqOf(op), { ...fields(), confirmDuplicateName: false, password: STRONG, totpCode: codeFor(op) });
    ok("#23 the console flag off → CONSOLE_DISABLED whatever the invitation flag says (the invitation flag needs the console flag)", !off.ok && off.code === "CONSOLE_DISABLED" && !flags.isPlatformInvitationsEnabled(), codeOf(off));
    process.env.PLATFORM_CONSOLE_ENABLED = "true";
    ok("#23 …with both flags exactly \"true\" the feature is on", flags.isPlatformInvitationsEnabled());
    ok("#23 …no invitation written and no second-factor code spent by any refused call", (await invCount()) === n0 && (await lastStep(op)) === step0);
    const flagSrc = stripComments(read("src/lib/platform/flags.ts"));
    // PO-02D3: flags.ts now also holds the acceptance flag, independent of this one: the invitation flag's own functions
    // still never read an acceptance flag, the acceptance flag's never read this one, and nothing touches suspension.
    const flagFn = (name: string) => (flagSrc.match(new RegExp(`export function ${name}\\(\\)[^{]*\\{[^}]*\\}`)) ?? [""])[0];
    ok("#23 the flag is read only as the exact string \"true\", and never enables an acceptance flag or changes the suspension flag",
      /process\.env\.PLATFORM_INVITATIONS_ENABLED === "true"/.test(flagSrc) && !/TENANT_ACCESS_ENFORCEMENT/.test(flagSrc) &&
        ["isPlatformInvitationsEnabled", "assertPlatformInvitationsEnabled"].every((f) => flagFn(f) !== "" && !/ACCEPT/.test(flagFn(f))) &&
        ["isCustomerInviteAcceptanceEnabled", "assertCustomerInviteAcceptanceEnabled"].every((f) => flagFn(f) !== "" && !/PLATFORM_INVITATIONS_ENABLED|isPlatformInvitationsEnabled|isPlatformConsoleEnabled/.test(flagFn(f))));
  }

  // ------------------------------------------------------------------------------------------------
  section("3. Authorization: same-origin (CSRF) → live platform session → platform.companies.invite → protected audit trail");
  {
    await keepAlive();
    const n0 = await invCount();
    const step0 = await lastStep(op);
    const anyId = "00000000-0000-4000-8000-000000000000";
    const tries: [string, () => Promise<Outcome>, string[]][] = [
      ["#8 no Origin header → FORBIDDEN (CSRF)", () => create(op, {}, { headers: { origin: null } }), ["FORBIDDEN"]],
      ["#8 a cross-site Origin → FORBIDDEN", () => create(op, {}, { headers: { origin: "https://evil.example" } }), ["FORBIDDEN"]],
      ["#8 Sec-Fetch-Site: cross-site → FORBIDDEN", () => create(op, {}, { headers: { "sec-fetch-site": "cross-site" } }), ["FORBIDDEN"]],
      ["#8 a multi-valued X-Forwarded-Host (a client value passed along) → FORBIDDEN", () => create(op, {}, { headers: { "x-forwarded-host": `${HOST}, evil.example` } }), ["FORBIDDEN"]],
      ["#8 revoke with a cross-site Origin → FORBIDDEN", () => actions.revokeCompanyInvitation(reqOf(op, { origin: "https://evil.example" }), { invitationId: anyId, reason: "Fixture reason text", totpCode: codeFor(op) }), ["FORBIDDEN"]],
      ["#8 re-issue without Origin → FORBIDDEN", () => actions.reissueCompanyInvitation(reqOf(op, { origin: null }), { invitationId: anyId, password: STRONG, totpCode: codeFor(op) }), ["FORBIDDEN"]],
      ["#8 the read-only preview with a cross-site Origin → FORBIDDEN", () => actions.previewCompanyInvitation(reqOf(op, { origin: "https://evil.example" }), fields()), ["FORBIDDEN"]],
      ["#7 no platform session → UNAUTHORIZED", () => create(op, {}, { token: null }), ["UNAUTHORIZED"]],
      ["#7 a malformed platform token → UNAUTHORIZED", () => create(op, {}, { token: "not-a-token" }), ["UNAUTHORIZED"]],
    ];
    for (const [name, run, expected] of tries) {
      const o = await run();
      ok(name, expected.includes(codeOf(o)), codeOf(o));
    }
    const customerToken = await tenantAuth.signSessionToken({ userId: 1, orgId: org.id, jti: randomBytes(24).toString("base64url") });
    secretsSeen.push(customerToken);
    const cust = await create(op, {}, { token: customerToken });
    const custRead = await actions.readCompanyInvitation(reqOf(op, {}, customerToken), anyId);
    ok("#7 a CUSTOMER ERP session token is never a platform session → UNAUTHORIZED (create and read)", !cust.ok && cust.code === "UNAUTHORIZED" && !custRead.ok && custRead.code === "UNAUTHORIZED", `${codeOf(cust)} ${codeOf(custRead)}`);
    const ended = await createAdmin("ended@invite-fixture.test", "Ended Operator", "198.51.100.16");
    await signIn(ended);
    await console_.signOutCore(reqOf(ended));
    const gone = await create(ended);
    ok("#7 a signed-out platform session → UNAUTHORIZED / SESSION_EXPIRED", !gone.ok && ["UNAUTHORIZED", "SESSION_EXPIRED"].includes(gone.code), codeOf(gone));
    // PO-03B appends platform.users.read and platform.users.manage after it (verify:platform-users); the tail is pinned whole.
    ok("#7 platform.companies.invite is a separate entry in the permission allowlist (after read and manage_access; PO-03B's two users permissions and PO-03C's platform.users.manage_roles follow it)", JSON.stringify(guards.PLATFORM_PERMISSIONS.slice(-6)) === JSON.stringify(["platform.companies.read", "platform.companies.manage_access", "platform.companies.invite", "platform.users.read", "platform.users.manage", "platform.users.manage_roles"]));
    let forbidden = "";
    try {
      await guards.authorizePlatformToken(op.token, "platform.companies.unknown" as never);
    } catch (err) {
      forbidden = (err as { code?: string }).code ?? "?";
    }
    ok("#7 a permission outside the allowlist → FORBIDDEN (the guard grants only listed permissions)", forbidden === "FORBIDDEN", forbidden);
    const actionsSrc = stripComments(read("src/lib/platform/invitation-actions.ts"));
    const readSrc = stripComments(read("src/lib/platform/invitations.ts"));
    ok("#7 every invitation change and the dialogs' current-state read require platform.companies.invite (5 entry points); the history reads platform.companies.read",
      /authorizePlatformToken\(req\.token, "platform\.companies\.invite"\)/.test(actionsSrc) && (actionsSrc.match(/await authorizeInvitationChange\(req\)/g) ?? []).length === 5 && /authorizePlatformToken\(req\.token, "platform\.companies\.read"\)/.test(readSrc));
    ok("#8 the change entry point checks the flags, then same-origin, then the session (in that order)", /assertPlatformInvitationsEnabled\(\);\s*assertSameOrigin\(req\.headers\);\s*return authorizePlatformToken/.test(actionsSrc));
    process.env.PLATFORM_TRUSTED_PROXY_HOPS = "x";
    const badHops = await create(op);
    process.env.PLATFORM_TRUSTED_PROXY_HOPS = "1";
    ok("#8 a malformed trusted-proxy setting (PLATFORM_TRUSTED_PROXY_HOPS=x) fails closed at the same-origin step → CONFIG_ERROR", !badHops.ok && badHops.code === "CONFIG_ERROR", codeOf(badHops));
    await audit.assertPlatformAuditProtection({ force: true });
    await q("alter table platform_audit_events disable trigger user");
    let unprotected = "";
    try {
      await audit.assertPlatformAuditProtection({ force: true }).catch(() => undefined);
      unprotected = codeOf(await create(op));
    } finally {
      await q("alter table platform_audit_events enable trigger user");
      await audit.assertPlatformAuditProtection({ force: true });
    }
    ok("#18 an unprotected audit trail (append-only triggers disabled) → CONFIG_ERROR before any step-up", unprotected === "CONFIG_ERROR", unprotected);
    ok("#7 #8 …no refusal wrote an invitation or spent the operator's code", (await invCount()) === n0 && (await lastStep(op)) === step0);
  }

  // ------------------------------------------------------------------------------------------------
  section("4. The canonical customer origin (I-9): configuration only, https, exactly an origin");
  {
    await keepAlive();
    const n0 = await invCount();
    const step0 = await lastStep(op);
    const bad = [undefined, "", "http://customer.erp.test", "https://customer.erp.test/path", "https://customer.erp.test/register", "https://customer.erp.test?x=1", "https://customer.erp.test#frag", "https://user:pw@customer.erp.test", "ftp://customer.erp.test", "not a url", " https://customer.erp.test", "HTTPS://CUSTOMER.ERP.TEST", "http://127.0.0.1:3000", "javascript:alert(1)"];
    for (const value of bad) {
      if (value === undefined) delete process.env.CUSTOMER_PUBLIC_ORIGIN;
      else process.env.CUSTOMER_PUBLIC_ORIGIN = value;
      const o = await create(op);
      ok(`#5 CUSTOMER_PUBLIC_ORIGIN=${JSON.stringify(value ?? null)} → CONFIG_ERROR, nothing created`, !o.ok && o.code === "CONFIG_ERROR", codeOf(o));
    }
    process.env.CUSTOMER_PUBLIC_ORIGIN = "http://127.0.0.1:3000";
    const reissueBad = await reissue(op, "00000000-0000-4000-8000-000000000000");
    ok("#5 …re-issue refuses an invalid origin the same way, before anything else (CONFIG_ERROR)", !reissueBad.ok && reissueBad.code === "CONFIG_ERROR", codeOf(reissueBad));
    process.env.PLATFORM_INVITATIONS_LOOPBACK_ORIGIN = "true";
    process.env.CUSTOMER_PUBLIC_ORIGIN = "http://10.0.0.5:3000";
    const lan = await create(op);
    ok("#5 the loopback approval never allows a NON-loopback http origin → CONFIG_ERROR", !lan.ok && lan.code === "CONFIG_ERROR", codeOf(lan));
    process.env.CUSTOMER_PUBLIC_ORIGIN = "http://127.0.0.1:3999";
    ok("#5 an http LOOPBACK origin is accepted only with PLATFORM_INVITATIONS_LOOPBACK_ORIGIN=\"true\" (explicitly approved local tests)", invitations.customerPublicOrigin() === "http://127.0.0.1:3999");
    process.env.PLATFORM_INVITATIONS_LOOPBACK_ORIGIN = "TRUE";
    let loose = "";
    try {
      invitations.customerPublicOrigin();
    } catch (err) {
      loose = (err as { code?: string }).code ?? "?";
    }
    ok("#5 …the approval is the exact string \"true\" (\"TRUE\" → CONFIG_ERROR)", loose === "CONFIG_ERROR", loose);
    delete process.env.PLATFORM_INVITATIONS_LOOPBACK_ORIGIN;
    process.env.CUSTOMER_PUBLIC_ORIGIN = "https://customer.erp.test:8443/";
    ok("#5 an https origin with a port and a trailing slash is canonicalised (no slash)", invitations.customerPublicOrigin() === "https://customer.erp.test:8443");
    process.env.CUSTOMER_PUBLIC_ORIGIN = ORIGIN;
    ok("#5 …every refused configuration created nothing and spent no code (the origin is checked before the step-up)", (await invCount()) === n0 && (await lastStep(op)) === step0);
  }

  // ------------------------------------------------------------------------------------------------
  section("5. Input validation (checked before the step-up: a malformed request spends nothing)");
  {
    await keepAlive();
    const n0 = await invCount();
    const step0 = await lastStep(op);
    const fails0 = await failuresRecorded();
    const audits0 = await auditCount("invitation.create.rejected");
    const cases: [string, Record<string, unknown>][] = [
      ["an empty company name", { companyName: "   " }],
      ["a 201-character company name", { companyName: "x".repeat(201) }],
      ["a company name with a direction override (U+202E)", { companyName: "Fixture‮Co" }],
      ["a company name with a control character", { companyName: "Fixture\u0007Co" }],
      ["a 101-character industry", { industry: "y".repeat(101) }],
      ["a company e-mail without @", { companyEmail: "office.company-fixture.test" }],
      ["a non-ASCII company e-mail", { companyEmail: "مكتب@company-fixture.test" }],
      ["a country not in the ERP catalogue", { country: "Atlantis" }],
      ["a country in lower case", { country: "saudi arabia" }],
      ["an unknown currency", { currency: "XYZ" }],
      ["a currency that is not three letters", { currency: "SARR" }],
      ["an empty owner name", { ownerName: "" }],
      ["a 201-character owner name", { ownerName: "z".repeat(201) }],
      ["an owner e-mail with a space", { ownerEmail: "owner fixture@company-fixture.test" }],
      ["an owner e-mail over 320 characters", { ownerEmail: `${"a".repeat(320)}@company-fixture.test` }],
      ["an owner e-mail with two @", { ownerEmail: "a@b@company-fixture.test" }],
      ["a non-string field", { companyName: 42 }],
    ];
    for (const [name, over] of cases) {
      const o = await create(op, over);
      ok(`#15 ${name} → VALIDATION_FAILED`, !o.ok && o.code === "VALIDATION_FAILED", codeOf(o));
    }
    const noCode = await create(op, {}, { code: "12345" });
    const noPassword = await create(op, {}, { password: "" });
    ok("#15 a five-digit code or an empty password → VALIDATION_FAILED", !noCode.ok && noCode.code === "VALIDATION_FAILED" && !noPassword.ok && noPassword.code === "VALIDATION_FAILED", `${codeOf(noCode)} ${codeOf(noPassword)}`);
    const badId = await revoke(op, "not-a-uuid");
    const shortReason = await revoke(op, "00000000-0000-4000-8000-000000000000", "too short");
    ok("#15 a malformed invitation id or a reason under 10 characters → VALIDATION_FAILED", !badId.ok && badId.code === "VALIDATION_FAILED" && !shortReason.ok && shortReason.code === "VALIDATION_FAILED", `${codeOf(badId)} ${codeOf(shortReason)}`);
    ok("#15 …nothing written, no code spent, no throttle failure, no audit record", (await invCount()) === n0 && (await lastStep(op)) === step0 && (await failuresRecorded()) === fails0 && (await auditCount("invitation.create.rejected")) === audits0);
    const normalized = invitations.parseInvitationFields(fields({ companyName: "  Fixture   Spaces  Co ", ownerEmail: "  MiXeD.Case@Company-Fixture.TEST ", currency: "sar", industry: "" }));
    ok("#15 #14 white space is collapsed, e-mails become lower(btrim()), the currency is upper-cased, an empty industry is null",
      normalized.companyName === "Fixture Spaces Co" && normalized.ownerEmail === "mixed.case@company-fixture.test" && normalized.currency === "SAR" && normalized.industry === null);
    const arabic = invitations.parseInvitationFields(fields({ companyName: "شركة المعارض الحديثة", ownerName: "سارة العتيبي" }));
    ok("#15 Arabic company and owner names are accepted as entered", arabic.companyName === "شركة المعارض الحديثة" && arabic.ownerName === "سارة العتيبي");
  }

  // ------------------------------------------------------------------------------------------------
  section("6. Create: one transaction — the invitation (token hash only), its immutable terms, the audit record");
  let first!: { id: string; reference: string; email: string };
  {
    await keepAlive();
    const email = "amina.first@company-fixture.test";
    const o = await created1(op, { ownerEmail: email, companyName: "Fixture First Co" });
    first = { id: o.id, reference: o.reference, email };
    const token = o.link.split("#t=")[1];
    const row = await invRow(o.id);
    ok("#2 the link is the configured origin + /register/accept#t=<43-character token>", o.link.startsWith(`${ORIGIN}/register/accept#t=`) && /^[A-Za-z0-9_-]{43}$/.test(token));
    ok("#2 the row holds sha256(token) — never the token itself", row.token_hash === sha256(token) && row.token_hash !== token);
    ok("#11 I-11: the display reference is INV- + the first 8 hex of the id, upper case", o.reference === `INV-${o.id.slice(0, 8).toUpperCase()}`);
    ok("#2 I-4: expiry is exactly 72 hours after creation; invited by this operator", row.expires_at.getTime() - row.created_at.getTime() === 72 * HOUR && row.invited_by_platform_admin_id === op.id);
    const t = await q<{ initial_cycle: string; initial_is_trial: boolean; initial_version_state: string; code: string; version_number: number }>(
      "select t.initial_cycle, t.initial_is_trial, t.initial_version_state, p.code, v.version_number from organization_invitation_terms t join subscription_package_versions v on v.id = t.initial_package_version_id join subscription_packages p on p.id = v.package_id where t.invitation_id = $1",
      [o.id],
    );
    ok("#2 P-5: its terms are the published default Trial (trial v1), cycle trial", t.length === 1 && t[0].code === "trial" && t[0].version_number === 1 && t[0].initial_cycle === "trial" && t[0].initial_is_trial && t[0].initial_version_state === "published");
    const events = await auditOf(o.id);
    const after = events[0]?.after_safe ?? {};
    ok("#2 one audit record invitation.created, attributed, with allow-listed metadata (reference, company, owner e-mail, package, cycle, expiry)",
      events.length === 1 && events[0].action === "invitation.created" && events[0].result === "success" && after.reference === o.reference && after.packageCode === "trial" && after.cycle === "trial" && after.ownerEmail === email && events[0].actor_platform_admin_id === op.id);
    const text = JSON.stringify(events);
    ok("#3 the audit record holds no token, no token hash and no link", !text.includes(token) && !text.includes(row.token_hash) && !text.includes("#t=") && !text.includes("register/accept"));
    let termsUpdate = "";
    try {
      await q("update organization_invitation_terms set initial_cycle = 'trial' where invitation_id = $1", [o.id]);
    } catch (err) {
      termsUpdate = describeError(err);
    }
    ok("#2 the terms are immutable once written (PO-02D1A trigger refuses an UPDATE)", termsUpdate !== "", termsUpdate.slice(0, 80));
  }

  // ------------------------------------------------------------------------------------------------
  section("7. Host spoofing: the link origin is configuration, never a request header");
  {
    await keepAlive();
    const spoofed = await create(op, {}, { headers: { host: "evil.example", origin: "https://evil.example", "x-forwarded-host": "evil.example" } });
    ok("#6 Host, Origin and X-Forwarded-Host all = evil.example (same-origin consistent) → the link still uses CUSTOMER_PUBLIC_ORIGIN", spoofed.ok && spoofed.link.startsWith(`${ORIGIN}/`) && !spoofed.link.includes("evil"), codeOf(spoofed));
    const forwarded = await create(op, {}, { headers: { "x-forwarded-host": "evil.example", origin: "https://evil.example", "x-forwarded-proto": "http" } });
    ok("#6 a forwarded host + http proto → the link is still the configured https origin", forwarded.ok && forwarded.link.startsWith(`${ORIGIN}/register/accept#t=`), codeOf(forwarded));
    const src = stripComments(read("src/lib/platform/invitations.ts")) + stripComments(read("src/lib/platform/invitation-actions.ts"));
    ok("#6 no invitation module reads Host, X-Forwarded-* or Origin to build anything (only process.env.CUSTOMER_PUBLIC_ORIGIN)", !/headers\.get\(/.test(src) && !/x-forwarded/i.test(src) && /process\.env\.CUSTOMER_PUBLIC_ORIGIN/.test(src));
  }

  // ------------------------------------------------------------------------------------------------
  section("8. Step-up (I-3): password + fresh TOTP for create / re-issue, fresh TOTP + reason for revoke; replay; throttle");
  {
    await keepAlive();
    const n0 = await invCount();
    const step0 = await lastStep(stepper);
    const fails0 = await failuresRecorded();
    const wrongPassword = await create(stepper, {}, { password: WRONG });
    ok("#9 a wrong password → INVALID_CREDENTIALS; recorded as a throttle failure; nothing created; no code spent",
      !wrongPassword.ok && wrongPassword.code === "INVALID_CREDENTIALS" && (await failuresRecorded()) === fails0 + 1 && (await invCount()) === n0 && (await lastStep(stepper)) === step0, codeOf(wrongPassword));
    nextStep();
    const wrongCode = await actions.createCompanyInvitation(reqOf(stepper), { ...fields(), confirmDuplicateName: false, password: STRONG, totpCode: wrongCodeFor(stepper) });
    ok("#9 a wrong code → MFA_INVALID; nothing created; a throttle failure recorded", !wrongCode.ok && wrongCode.code === "MFA_INVALID" && (await invCount()) === n0 && (await failuresRecorded()) === fails0 + 2, codeOf(wrongCode));
    nextStep();
    const used = codeFor(stepper);
    const good = await actions.createCompanyInvitation(reqOf(stepper), { ...fields(), confirmDuplicateName: false, password: STRONG, totpCode: used });
    keep(good);
    const usedStep = await lastStep(stepper);
    const replay = await actions.createCompanyInvitation(reqOf(stepper), { ...fields(), confirmDuplicateName: false, password: STRONG, totpCode: used });
    ok("#10 the same code a second time → MFA_INVALID (replay); only the first created an invitation", good.ok && !replay.ok && replay.code === "MFA_INVALID" && (await invCount()) === n0 + 1, `${codeOf(good)} ${codeOf(replay)}`);
    ok("#10 …the consumed step is durable (platform_admins.mfa_last_totp_step, written in the create's transaction)", usedStep === totp.totpStepAt(new Date(nowMs)) && (await lastStep(stepper)) === usedStep);
    const older = await actions.createCompanyInvitation(reqOf(stepper), { ...fields(), confirmDuplicateName: false, password: STRONG, totpCode: codeFor(stepper, -1) });
    ok("#10 an OLDER code (the previous step, still inside the window) → MFA_INVALID: steps only move forward", !older.ok && older.code === "MFA_INVALID", codeOf(older));
    ok("#9 #10 every failed step-up is an audited rejection (stages password, mfa, replay)", (await stageCount("password", stepper.id)) === 1 && (await stageCount("mfa", stepper.id)) === 1 && (await stageCount("replay", stepper.id)) === 2);
    // Re-issue and revoke step-ups (a second operator, so the account throttle below stays untouched).
    const target = await created1(stepper2);
    const badReissue = await reissue(stepper2, target.id, { password: WRONG });
    ok("#9 re-issue with a wrong password → INVALID_CREDENTIALS; the invitation is unchanged (still pending, no new row)", !badReissue.ok && badReissue.code === "INVALID_CREDENTIALS" && (await invRow(target.id)).revoked_at === null, codeOf(badReissue));
    nextStep();
    const badRevoke = await actions.revokeCompanyInvitation(reqOf(stepper2), { invitationId: target.id, reason: "Fixture: wrong code attempt", totpCode: wrongCodeFor(stepper2) });
    ok("#9 revoke with a wrong code → MFA_INVALID; the invitation is unchanged", !badRevoke.ok && badRevoke.code === "MFA_INVALID" && (await invRow(target.id)).revoked_at === null, codeOf(badRevoke));
    const goodRevoke = await revoke(stepper2, target.id, "Fixture: duplicate request, revoked");
    ok("#9 revoke needs a fresh TOTP code and a reason — and no password", goodRevoke.ok, codeOf(goodRevoke));
    // The durable throttle shared with sign-in: five failures in 15 minutes block the account (a fresh session first —
    // this operator has been idle since the start).
    await signIn(throttled);
    for (let i = 0; i < 5; i++) await create(throttled, {}, { password: WRONG });
    const blocked = await create(throttled);
    ok("#9 after five failed step-ups the durable throttle blocks even correct credentials → RATE_LIMITED (audited stage throttle)", !blocked.ok && blocked.code === "RATE_LIMITED" && (await stageCount("throttle", throttled.id)) === 1, codeOf(blocked));
    nextStep();
    const signInBlocked = await console_.signInCore({ email: throttled.email, password: STRONG, totpCode: codeFor(throttled) }, { headers: headersFor(throttled.ip) });
    ok("#9 …it is the SAME throttle as sign-in: the account cannot sign in either (RATE_LIMITED)", !signInBlocked.ok && signInBlocked.code === "RATE_LIMITED", codeOf(signInBlocked));
  }

  // ------------------------------------------------------------------------------------------------
  section("9. One pending invitation per owner e-mail (I-5); case-insensitive e-mail rules (I-7); name collisions (I-10)");
  {
    await keepAlive();
    const n0 = await invCount();
    const step0 = await lastStep(second);
    const dup = await create(second, { ownerEmail: first.email });
    ok("#12 a second invitation for a pending e-mail → CONFLICT naming the pending INV reference; nothing created; no code spent",
      !dup.ok && dup.code === "CONFLICT" && dup.pendingReference === first.reference && (await invCount()) === n0 && (await lastStep(second)) === step0, `${codeOf(dup)} ${!dup.ok ? dup.pendingReference : ""}`);
    const upper = await create(second, { ownerEmail: `  ${first.email.toUpperCase()} ` });
    ok("#14 the same e-mail in upper case with spaces is the same slot → CONFLICT", !upper.ok && upper.code === "CONFLICT" && upper.pendingReference === first.reference, codeOf(upper));
    const user = await create(second, { ownerEmail: "grace.owner@customer-fixture.test" });
    ok("#14 an e-mail a customer user holds in ANOTHER letter case (Grace.Owner@Customer-Fixture.test) → EMAIL_CONFLICT; nothing created", !user.ok && user.code === "EMAIL_CONFLICT" && (await invCount()) === n0, codeOf(user));
    const preview = await actions.previewCompanyInvitation(reqOf(second), fields({ ownerEmail: first.email }));
    ok("#12 the read-only preview reports the pending reference and the offered Trial (so no code is spent on a doomed create)", preview.ok && preview.pendingReference === first.reference && preview.trial?.packageCode === "trial" && preview.trial?.versionNumber === 1);
    const previewUser = await actions.previewCompanyInvitation(reqOf(second), fields({ ownerEmail: "GRACE.OWNER@customer-fixture.test" }));
    ok("#14 …and the customer-user collision", previewUser.ok && previewUser.emailInUse);
    ok("#12 #14 the refusals are audited (stages pending_conflict ×2, email_conflict ×1)", (await stageCount("pending_conflict", second.id)) === 2 && (await stageCount("email_conflict", second.id)) === 1);
    const named = await create(second, { companyName: "fixture  holding group" });
    ok("#15 I-10: a name matching a registered company (case and spacing ignored) needs explicit confirmation → CONFLICT with the matches; no code spent",
      !named.ok && named.code === "CONFLICT" && named.nameMatches?.organizations === 1 && (await lastStep(second)) === step0, JSON.stringify(named));
    const confirmed = await create(second, { companyName: "Fixture Holding Group" }, { confirm: true });
    ok("#15 …and is created once the operator confirms it is a different company", confirmed.ok, codeOf(confirmed));
    const spaced = await create(second, { companyName: "fixture spaced holding" });
    ok("#15 …the registered name is compared with its white space collapsed too (\"  Fixture   Spaced    Holding \" matches)", !spaced.ok && spaced.code === "CONFLICT" && spaced.nameMatches?.organizations === 1, JSON.stringify(spaced));
    const twin = await create(second, { companyName: "FIXTURE HOLDING GROUP" });
    ok("#15 …a further invitation with that name now also matches the pending one (1 company, 1 invitation)", !twin.ok && twin.code === "CONFLICT" && twin.nameMatches?.organizations === 1 && twin.nameMatches?.invitations === 1, JSON.stringify(twin));
  }

  // ------------------------------------------------------------------------------------------------
  section("10. An expired holder gives up its slot in the same transaction (I-5), attributed and audited");
  {
    await keepAlive();
    const email = "expired.slot@company-fixture.test";
    const old = await created1(op, { ownerEmail: email, companyName: "Fixture Expired Slot Co" });
    await expire(old.id);
    const preview = await actions.previewCompanyInvitation(reqOf(second), fields({ ownerEmail: email, companyName: "Fixture Expired Slot Co" }));
    ok("#13 the preview reports the expired holder that would be replaced (and its own name is not a collision)", preview.ok && preview.expiredReference === old.reference && preview.pendingReference === null && preview.nameMatches.invitations === 0);
    const fresh = await create(second, { ownerEmail: email, companyName: "Fixture Expired Slot Co" });
    ok("#13 a new invitation for the e-mail (same company, no confirmation needed) → OK, naming the replaced invitation", fresh.ok && fresh.replacedReference === old.reference, codeOf(fresh));
    const oldRow = await invRow(old.id);
    ok("#13 the expired holder is revoked, attributed to the operator who reused the slot", oldRow.revoked_at !== null && oldRow.revoked_by_platform_admin_id === second.id);
    const revoked = (await auditOf(old.id)).find((e) => e.action === "invitation.revoked");
    ok("#13 …and audited: invitation.revoked, reason \"Expired; replaced by INV-…\", before expired, after revoked + replacedBy",
      !!revoked && fresh.ok && revoked.reason === `Expired; replaced by ${fresh.reference}` && revoked.after_safe?.replacedBy === fresh.reference && revoked.before_safe?.state === "expired");
    ok("#13 …the new invitation's audit names what it replaces; exactly one pending row holds the e-mail",
      fresh.ok && (await auditOf(fresh.id)).some((e) => e.action === "invitation.created" && e.after_safe?.replaces === old.reference) && (await pendingFor(email)).length === 1);
  }

  // ------------------------------------------------------------------------------------------------
  section("11. Revocation: pending → revoked, expired → revoked, accepted → refused, twice → refused");
  {
    await keepAlive();
    const a = await created1(op);
    const r1 = await revoke(op, a.id, "Fixture: the company asked to stop");
    const row = await invRow(a.id);
    ok("#16 pending → revoked: revoked_at and revoked_by set; the token hash belongs to a row that can never be eligible", r1.ok && row.revoked_at !== null && row.revoked_by_platform_admin_id === op.id, codeOf(r1));
    const ev = (await auditOf(a.id)).filter((e) => e.action === "invitation.revoked");
    ok("#16 one audit record invitation.revoked with the reason and the previous state", ev.length === 1 && ev[0].reason === "Fixture: the company asked to stop" && ev[0].before_safe?.state === "pending" && ev[0].after_safe?.state === "revoked");
    const r2 = await revoke(op, a.id, "Fixture: second attempt to revoke");
    ok("#16 revoking it again → CONFLICT, and NO second audit record", !r2.ok && r2.code === "CONFLICT" && (await auditOf(a.id)).filter((e) => e.action === "invitation.revoked").length === 1, codeOf(r2));
    const re2 = await reissue(op, a.id);
    ok("#16 a revoked invitation cannot be re-issued → CONFLICT", !re2.ok && re2.code === "CONFLICT", codeOf(re2));
    const b = await created1(op);
    await expire(b.id);
    const r3 = await revoke(op, b.id, "Fixture: expired, tidy up");
    ok("#16 an EXPIRED invitation can be revoked (it still holds its slot); audited with before = expired", r3.ok && (await auditOf(b.id)).some((e) => e.action === "invitation.revoked" && e.before_safe?.state === "expired"), codeOf(r3));
    const c = await created1(op);
    await q("update organization_invitations set accepted_at = created_at + interval '1 minute', accepted_org_id = $2, updated_at = created_at + interval '1 minute' where id = $1", [c.id, acceptedOrg.id]);
    const r4 = await revoke(op, c.id, "Fixture: try to revoke accepted");
    const r5 = await reissue(op, c.id);
    ok("#16 an ACCEPTED invitation (simulated in SQL) → INVITE_USED for revoke and re-issue; both audited as rejected", !r4.ok && r4.code === "INVITE_USED" && !r5.ok && r5.code === "INVITE_USED" && (await auditOf(c.id)).filter((e) => e.result === "rejected").length === 2, `${codeOf(r4)} ${codeOf(r5)}`);
    const r6 = await revoke(op, "00000000-0000-4000-8000-000000000000", "Fixture: unknown invitation");
    ok("#16 an unknown invitation → NOT_FOUND", !r6.ok && r6.code === "NOT_FOUND", codeOf(r6));
    const current = await actions.readCompanyInvitation(reqOf(op), c.id);
    ok("#16 the dialogs' current-state read reports accepted (so the UI never offers an action on it)", current.ok && current.state === "accepted");
  }

  // ------------------------------------------------------------------------------------------------
  section("12. Re-issue: the old invitation revoked and a new one created — one transaction, all or nothing");
  {
    await keepAlive();
    const old = await created1(op, { companyName: "Fixture Reissue Co" });
    const oldToken = old.link.split("#t=")[1];
    const re = await reissue(second, old.id);
    ok("#17 re-issue → OK: a new reference and a new link; the previous reference named", re.ok && re.previousReference === old.reference && re.reference !== old.reference && re.link !== old.link, codeOf(re));
    if (!re.ok) throw new Error("re-issue failed");
    const oldRow = await invRow(old.id);
    const newRow = await invRow(re.id);
    ok("#17 the old row is revoked (by the re-issuing operator); the new row is pending, same company and owner, a fresh 72-hour expiry",
      oldRow.revoked_at !== null && oldRow.revoked_by_platform_admin_id === second.id && newRow.revoked_at === null && newRow.owner_email_normalized === oldRow.owner_email_normalized && newRow.company_name === "Fixture Reissue Co" && newRow.expires_at.getTime() - newRow.created_at.getTime() === 72 * HOUR && newRow.invited_by_platform_admin_id === second.id);
    ok("#17 a new token: the old token's hash now belongs only to a revoked row (never eligible again)", newRow.token_hash !== oldRow.token_hash && oldRow.token_hash === sha256(oldToken) && (await q("select id from organization_invitations where token_hash = $1 and revoked_at is null and accepted_at is null", [sha256(oldToken)])).length === 0);
    const oldEv = await auditOf(old.id);
    const newEv = await auditOf(re.id);
    ok("#17 audit: the old row's invitation.revoked (\"Re-issued as INV-…\", replacedBy) and the new row's invitation.reissued (replaces)",
      oldEv.some((e) => e.action === "invitation.revoked" && e.reason === `Re-issued as ${re.reference}` && e.after_safe?.replacedBy === re.reference) && newEv.length === 1 && newEv[0].action === "invitation.reissued" && newEv[0].after_safe?.replaces === old.reference);
    const expiredOne = await created1(op);
    await expire(expiredOne.id);
    const reExpired = await reissue(op, expiredOne.id);
    ok("#17 an EXPIRED invitation can be re-issued too (the usual way to recover a lapsed link)", reExpired.ok && (await invRow(expiredOne.id)).revoked_at !== null, codeOf(reExpired));
    // A failure after the revoke (injected at the terms insert) rolls everything back.
    const victim = await created1(op);
    const n0 = await invCount();
    const step0 = await lastStep(second);
    const audits0 = await auditCount("invitation.revoked");
    await injected("organization_invitation_terms", true);
    let failed: Outcome = { ok: false };
    try {
      failed = await reissue(second, victim.id);
    } finally {
      await injected("organization_invitation_terms", false);
    }
    ok("#17 a failure after the revoke and the new row (injected at the terms insert) → nothing changed: the old row still pending, no new row, no audit, the code not spent",
      !failed.ok && (await invRow(victim.id)).revoked_at === null && (await invCount()) === n0 && (await auditCount("invitation.revoked")) === audits0 && (await lastStep(second)) === step0, codeOf(failed));
  }

  // ------------------------------------------------------------------------------------------------
  section("13. An audit failure rolls the whole operation back (AUDIT_UNAVAILABLE)");
  {
    await keepAlive();
    const target = await created1(op);
    const n0 = await invCount();
    const t0 = await termsCount();
    const stepOp = await lastStep(op);
    await injected("platform_audit_events", true);
    let c1: Outcome = { ok: false }, c2: Outcome = { ok: false }, c3: Outcome = { ok: false };
    try {
      c1 = await create(op);
      c2 = await revoke(op, target.id, "Fixture: revoke during outage");
      c3 = await reissue(op, target.id);
    } finally {
      await injected("platform_audit_events", false);
    }
    ok("#18 create / revoke / re-issue during an audit outage → AUDIT_UNAVAILABLE", [c1, c2, c3].every((o) => !o.ok && o.code === "AUDIT_UNAVAILABLE"), [c1, c2, c3].map(codeOf).join(" "));
    ok("#18 …nothing applied: no invitation, no terms, the target still pending, no code consumed", (await invCount()) === n0 && (await termsCount()) === t0 && (await invRow(target.id)).revoked_at === null && (await lastStep(op)) === stepOp);
    ok("#18 …and each refusal logged a security incident (audit_write_failed) without detail", logged.filter((l) => l.includes("audit_write_failed") && l.includes("invitation.")).length >= 3);
  }

  // ------------------------------------------------------------------------------------------------
  section("14. The hourly limit (I-6): 20 per operator, exact under concurrency, durable across processes");
  {
    await keepAlive();
    for (let i = 0; i < 20; i++) {
      const o = await create(limited);
      if (!o.ok) throw new Error(`limit fixture create ${i} failed: ${o.code}`);
    }
    await keepAlive();
    const n0 = await invCount();
    const step0 = await lastStep(limited);
    const over = await create(limited);
    ok("#11 the 21st create within the hour → RATE_LIMITED before the step-up (no code spent), nothing created", !over.ok && over.code === "RATE_LIMITED" && (await invCount()) === n0 && (await lastStep(limited)) === step0, codeOf(over));
    const pending = (await q<{ id: string }>("select id from organization_invitations where invited_by_platform_admin_id = $1 and revoked_at is null order by created_at limit 1", [limited.id]))[0];
    const reissueOver = await reissue(limited, pending.id);
    ok("#11 a re-issue counts against the same limit → RATE_LIMITED", !reissueOver.ok && reissueOver.code === "RATE_LIMITED", codeOf(reissueOver));
    const preview = await actions.previewCompanyInvitation(reqOf(limited), fields());
    ok("#11 the preview tells the operator before any code is entered (rateLimited)", preview.ok && preview.rateLimited);
    ok("#11 the refusals are audited (stage rate_limit)", (await stageCount("rate_limit", limited.id)) >= 2);
    // Durable: a separate process (no shared memory) sees the same limit.
    const child = spawnSync(join(ROOT, "node_modules", ".bin", "tsx"), ["--conditions=react-server", join(ROOT, "verify", "platform", "invitation-limit-child.mts")], {
      cwd: ROOT,
      env: { ...process.env, PO02D2_TOKEN: limited.token, PO02D2_PASSWORD: STRONG, PO02D2_NOW: String(nowMs), PO02D2_HOST: HOST, PO02D2_IP: limited.ip },
      encoding: "utf8",
      timeout: 180_000,
    });
    const childOut = `${child.stdout ?? ""}${child.stderr ?? ""}`;
    ok("#11 a SEPARATE process (no shared memory) is refused too → RATE_LIMITED: the count is read from committed rows", /OUTCOME RATE_LIMITED/.test(childOut), childOut.replace(/postgres(ql)?:\/\/\S+/g, "<redacted>").slice(-300));
    // Exact under concurrency: at 19 of 20, two concurrent creates of one operator both pass the pre-check; the operator
    // row (the TOTP step) serializes them and the second is refused INSIDE its transaction.
    await q("update organization_invitations set created_at = created_at - interval '2 hours', updated_at = updated_at - interval '2 hours', expires_at = expires_at - interval '2 hours' where id = $1", [pending.id]);
    const rowLock = await holder();
    let outs: string[] = [];
    try {
      await rowLock.query("begin");
      await rowLock.query("select 1 from platform_admins where id = $1 for update", [limited.id]);
      nextStep();
      const pA = actions.createCompanyInvitation(reqOf(limited), { ...fields(), confirmDuplicateName: false, password: STRONG, totpCode: codeFor(limited) });
      await untilWaiting("transactionid", 1);
      const pB = actions.createCompanyInvitation(reqOf(limited), { ...fields(), confirmDuplicateName: false, password: STRONG, totpCode: codeFor(limited, 1) });
      await untilWaiting("tuple", 1);
      await rowLock.query("rollback");
      const [oA, oB] = await Promise.all([pA, pB]);
      keep(oA);
      keep(oB);
      outs = [codeOf(oA), codeOf(oB)];
    } finally {
      await rowLock.end().catch(() => undefined);
    }
    ok("#11 #19 at 19 of 20, two queued creates (barrier on the operator row) → the first OK, the second RATE_LIMITED inside its transaction", JSON.stringify(outs) === JSON.stringify(["OK", "RATE_LIMITED"]), outs.join(" "));
    ok("#11 …the operator now has exactly 20 invitations in the window", (await invitations.recentInvitationsBy(db, limited.id, new Date(nowMs))) === 20);
  }

  // ------------------------------------------------------------------------------------------------
  section("15. Concurrency with deterministic barriers (owner e-mail lock, operator row, unique index)");
  {
    await newHour();
    // Twenty operators, one e-mail, twenty simultaneous creates.
    const crowd: Admin[] = [];
    for (let i = 0; i < 20; i++) crowd.push(await createAdmin(`crowd${i}@invite-fixture.test`, `Crowd Operator ${i}`, `198.51.100.${100 + i}`));
    for (const a of crowd) await signIn(a);
    nextStep();
    const email = "crowd.target@company-fixture.test";
    const outs = await withEmailBarrier(email, 20, () => crowd.map((a) => actions.createCompanyInvitation(reqOf(a), { ...fields({ ownerEmail: email }), confirmDuplicateName: true, password: STRONG, totpCode: codeFor(a) })));
    outs.forEach(keep);
    const winner = outs.find((o) => o.ok) as Extract<Created, { ok: true }> | undefined;
    ok("#19 twenty simultaneous creates for one e-mail (all twenty observed waiting on its lock) → exactly ONE invitation, nineteen CONFLICT",
      outs.filter((o) => o.ok).length === 1 && outs.filter((o) => !o.ok && o.code === "CONFLICT").length === 19 && (await pendingFor(email)).length === 1, outs.map(codeOf).join(" "));
    ok("#19 …each CONFLICT names the winner's reference; one created audit record; the losers' codes were not consumed",
      !!winner && outs.every((o) => o.ok || o.pendingReference === winner.reference) && (await auditOf(winner.id)).filter((e) => e.action === "invitation.created").length === 1);
    await keepAlive();

    // Two creates for case variants of one e-mail.
    nextStep();
    const variants = await withEmailBarrier("case.variant@company-fixture.test", 2, () => [
      actions.createCompanyInvitation(reqOf(op), { ...fields({ ownerEmail: "Case.Variant@Company-Fixture.TEST" }), confirmDuplicateName: true, password: STRONG, totpCode: codeFor(op) }),
      actions.createCompanyInvitation(reqOf(second), { ...fields({ ownerEmail: "case.variant@company-fixture.test" }), confirmDuplicateName: true, password: STRONG, totpCode: codeFor(second) }),
    ]);
    variants.forEach(keep);
    ok("#19 #14 two concurrent creates for case variants of one e-mail → one OK, one CONFLICT; one pending row", variants.map(codeOf).sort().join(" ") === "CONFLICT OK" && (await pendingFor("case.variant@company-fixture.test")).length === 1, variants.map(codeOf).join(" "));

    // Two concurrent creates replacing the same EXPIRED holder.
    const exp = await created1(op, { ownerEmail: "expired.race@company-fixture.test" });
    await expire(exp.id);
    nextStep();
    const replacing = await withEmailBarrier("expired.race@company-fixture.test", 2, () => [
      actions.createCompanyInvitation(reqOf(op), { ...fields({ ownerEmail: "expired.race@company-fixture.test" }), confirmDuplicateName: true, password: STRONG, totpCode: codeFor(op) }),
      actions.createCompanyInvitation(reqOf(second), { ...fields({ ownerEmail: "expired.race@company-fixture.test" }), confirmDuplicateName: true, password: STRONG, totpCode: codeFor(second) }),
    ]);
    replacing.forEach(keep);
    const replacer = replacing.find((o) => o.ok) as Extract<Created, { ok: true }> | undefined;
    ok("#19 #13 two concurrent creates replacing one expired holder → one OK (it names the replaced invitation), one CONFLICT; ONE revocation audit",
      replacing.map(codeOf).sort().join(" ") === "CONFLICT OK" && replacer?.replacedReference === exp.reference && (await auditOf(exp.id)).filter((e) => e.action === "invitation.revoked").length === 1 && (await pendingFor("expired.race@company-fixture.test")).length === 1,
      replacing.map(codeOf).join(" "));

    // Two concurrent revocations of one invitation.
    const tgt = await created1(op);
    nextStep();
    const tgtEmail = (await invRow(tgt.id)).owner_email_normalized;
    const revs = await withEmailBarrier(tgtEmail, 2, () => [
      actions.revokeCompanyInvitation(reqOf(op), { invitationId: tgt.id, reason: "Fixture: concurrent revoke one", totpCode: codeFor(op) }),
      actions.revokeCompanyInvitation(reqOf(second), { invitationId: tgt.id, reason: "Fixture: concurrent revoke two", totpCode: codeFor(second) }),
    ]);
    ok("#19 two concurrent revocations → one OK, one CONFLICT; exactly one revoked audit record", revs.map(codeOf).sort().join(" ") === "CONFLICT OK" && (await auditOf(tgt.id)).filter((e) => e.action === "invitation.revoked").length === 1, revs.map(codeOf).join(" "));

    // Re-issue versus revoke.
    const rv = await created1(op);
    nextStep();
    const rvEmail = (await invRow(rv.id)).owner_email_normalized;
    const [oRe, oRv] = await withEmailBarrier<Outcome & { link?: string }>(rvEmail, 2, () => [
      actions.reissueCompanyInvitation(reqOf(op), { invitationId: rv.id, password: STRONG, totpCode: codeFor(op) }),
      actions.revokeCompanyInvitation(reqOf(second), { invitationId: rv.id, reason: "Fixture: revoke racing a re-issue", totpCode: codeFor(second) }),
    ]);
    keep(oRe);
    const pendingNow = (await pendingFor(rvEmail)).length;
    ok("#19 re-issue vs revoke → exactly one succeeds; the original is revoked once; only a re-issued row can be pending",
      [oRe.ok, oRv.ok].filter(Boolean).length === 1 && (await invRow(rv.id)).revoked_at !== null && pendingNow === (oRe.ok ? 1 : 0) && (await auditOf(rv.id)).filter((e) => e.action === "invitation.revoked").length === 1,
      `${codeOf(oRe)} ${codeOf(oRv)} pending=${pendingNow}`);

    // Re-issue versus a create for the same e-mail (the holder is EXPIRED, so both pass their pre-checks and race).
    const rc = await created1(op);
    await expire(rc.id);
    nextStep();
    const rcEmail = (await invRow(rc.id)).owner_email_normalized;
    const [oRe2, oCr] = await withEmailBarrier<Outcome & { link?: string }>(rcEmail, 2, () => [
      actions.reissueCompanyInvitation(reqOf(op), { invitationId: rc.id, password: STRONG, totpCode: codeFor(op) }),
      actions.createCompanyInvitation(reqOf(second), { ...fields({ ownerEmail: rcEmail }), confirmDuplicateName: true, password: STRONG, totpCode: codeFor(second) }),
    ]);
    keep(oRe2);
    keep(oCr);
    ok("#19 re-issue vs create for the same (expired) slot → exactly one succeeds, the other CONFLICT; one pending row; the old row revoked once",
      [codeOf(oRe2), codeOf(oCr)].sort().join(" ") === "CONFLICT OK" && (await pendingFor(rcEmail)).length === 1 && (await auditOf(rc.id)).filter((e) => e.action === "invitation.revoked").length === 1,
      `${codeOf(oRe2)} ${codeOf(oCr)}`);

    // One code, two different operations of one operator at once (barrier on the operator row): only one is approved.
    const x = await created1(op);
    nextStep();
    const shared = codeFor(op);
    const rowLock = await holder();
    let pair: Outcome[] = [];
    try {
      await rowLock.query("begin");
      await rowLock.query("select 1 from platform_admins where id = $1 for update", [op.id]);
      const p1 = actions.createCompanyInvitation(reqOf(op), { ...fields(), confirmDuplicateName: true, password: STRONG, totpCode: shared });
      const p2 = actions.revokeCompanyInvitation(reqOf(op), { invitationId: x.id, reason: "Fixture: same code, other action", totpCode: shared });
      await untilWaiting("transactionid", 1);
      await untilWaiting("tuple", 1);
      await rowLock.query("rollback");
      pair = await Promise.all([p1, p2]);
      keep(pair[0] as { ok: boolean; link?: string });
    } finally {
      await rowLock.end().catch(() => undefined);
    }
    ok("#10 #19 one TOTP code used by a create AND a revoke at once → exactly one approved, the other MFA_INVALID (replay)", pair.filter((o) => o.ok).length === 1 && pair.some((o) => !o.ok && o.code === "MFA_INVALID"), pair.map(codeOf).join(" "));

    // Double-click: the same request twice at once (same code).
    nextStep();
    const dbl = fields();
    const code = codeFor(op);
    const [d1, d2] = await Promise.all([
      actions.createCompanyInvitation(reqOf(op), { ...dbl, confirmDuplicateName: false, password: STRONG, totpCode: code }),
      actions.createCompanyInvitation(reqOf(op), { ...dbl, confirmDuplicateName: false, password: STRONG, totpCode: code }),
    ]);
    keep(d1);
    keep(d2);
    ok("#19 a double-click (two identical requests, one code) → one invitation; the other MFA_INVALID (replay) or CONFLICT", [d1, d2].filter((o) => o.ok).length === 1 && [d1, d2].some((o) => !o.ok && ["MFA_INVALID", "CONFLICT"].includes(o.code)) && (await pendingFor(dbl.ownerEmail)).length === 1, `${codeOf(d1)} ${codeOf(d2)}`);

    // The partial unique index is the backstop: a writer that bypasses the e-mail lock still cannot create a second pending row.
    const raw = await holder();
    const rawEmail = "raw.writer@company-fixture.test";
    let backstop: Outcome = { ok: false };
    const stepBefore = await lastStep(second);
    try {
      await raw.query("begin");
      const token = randomBytes(32).toString("base64url");
      tokensSeen.push(token);
      const ins = await raw.query(
        "insert into organization_invitations (company_name, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash, expires_at, invited_by_platform_admin_id, created_at, updated_at) values ('Fixture Raw Writer Co', 'raw@company-fixture.test', 'Saudi Arabia', 'SAR', 'Raw Owner', $1, $2, $3, $4, $5, $5) returning id",
        [rawEmail, sha256(token), new Date(nowMs + 72 * HOUR), op.id, new Date(nowMs)],
      );
      await raw.query("insert into organization_invitation_terms (invitation_id, initial_package_version_id, initial_version_state, initial_is_trial, initial_cycle, created_at) values ($1, $2, 'published', true, 'trial', $3)", [ins.rows[0].id, await trialVersionId(), new Date(nowMs)]);
      nextStep();
      const p = actions.createCompanyInvitation(reqOf(second), { ...fields({ ownerEmail: rawEmail }), confirmDuplicateName: true, password: STRONG, totpCode: codeFor(second) });
      await untilWaiting("transactionid", 1);
      await raw.query("commit");
      backstop = await p;
    } finally {
      await raw.end().catch(() => undefined);
    }
    ok("#12 #19 the partial unique index (organization_invitations_pending_email_uq) refuses a second pending row even when the e-mail lock is bypassed → CONFLICT, rolled back, code not consumed",
      !backstop.ok && backstop.code === "CONFLICT" && (await pendingFor(rawEmail)).length === 1 && (await lastStep(second)) === stepBefore, codeOf(backstop));
    let direct = "";
    try {
      await q("insert into organization_invitations (company_name, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash, invited_by_platform_admin_id) values ('Fixture Direct Co', 'direct@company-fixture.test', 'Saudi Arabia', 'SAR', 'Direct Owner', $1, $2, $3)", [rawEmail, sha256(randomBytes(32).toString("base64url")), op.id]);
    } catch (err) {
      direct = (err as { code?: string }).code ?? "?";
    }
    ok("#12 …and a direct second pending INSERT for that e-mail fails with 23505 (unique violation)", direct === "23505", direct);
  }

  // ------------------------------------------------------------------------------------------------
  section("16. A database disconnection before COMMIT, and a response lost after COMMIT");
  {
    await keepAlive();
    const n0 = await invCount();
    const step0 = await lastStep(op);
    const lock = await holder();
    let o: Outcome = { ok: false };
    let inFlight = -1;
    try {
      await lock.query("begin");
      await lock.query("lock table platform_audit_events in share mode");
      const email = "disconnect@company-fixture.test";
      nextStep();
      const p = actions.createCompanyInvitation(reqOf(op), { ...fields({ ownerEmail: email }), confirmDuplicateName: false, password: STRONG, totpCode: codeFor(op) });
      const [victim] = await untilWaiting("relation", 1);
      inFlight = Number((await q<{ n: number }>("select count(*)::int as n from organization_invitations where owner_email_normalized = $1", [email]))[0].n);
      await q("select pg_terminate_backend($1)", [victim]);
      o = await p;
      await lock.query("rollback");
    } finally {
      await lock.end().catch(() => undefined);
    }
    ok("#19 barrier: the create had written its rows (uncommitted: invisible, 0 seen) and was waiting on its audit insert", inFlight === 0);
    ok("#19 the backend terminated before COMMIT → a failure is returned and NOTHING survives (no row, no code consumed)", !o.ok && (await invCount()) === n0 && (await lastStep(op)) === step0, codeOf(o));
    // Lost response: the create commits; the caller never sees the link.
    const lostEmail = "lost.response@company-fixture.test";
    const lost = await created1(op, { ownerEmail: lostEmail });
    const lostToken = lost.link.split("#t=")[1];
    const retry = await create(op, { ownerEmail: lostEmail });
    ok("#19 a retry after a lost response is refused (CONFLICT naming the committed invitation) — never a duplicate", !retry.ok && retry.code === "CONFLICT" && retry.pendingReference === lost.reference && (await pendingFor(lostEmail)).length === 1, codeOf(retry));
    const views = [await invitations.getInvitationHistory(reqOf(op), lost.id), await actions.readCompanyInvitation(reqOf(op), lost.id), await invitations.listInvitationHistory(reqOf(op), { q: lost.reference }), await companies.listPendingInvitations(reqOf(op), { q: lost.reference }, { withId: true })];
    const viewText = JSON.stringify(views);
    ok("#4 no read can return the link again: the detail, the current-state read and both lists hold no token, hash or link", !viewText.includes(lostToken) && !viewText.includes(sha256(lostToken)) && !viewText.includes("#t=") && !/[0-9a-f]{64}/.test(viewText));
    const recovered = await reissue(op, lost.id);
    ok("#19 the operator recovers by re-issuing: a new link, the lost one revoked", recovered.ok && (await invRow(lost.id)).revoked_at !== null, codeOf(recovered));
  }

  // ------------------------------------------------------------------------------------------------
  section("17. The history read models: allow-listed, every state, paginated, audited views, no token material");
  {
    await keepAlive();
    const lapsed = await created1(op); // an expired invitation that keeps its slot (every earlier one was revoked or replaced)
    await expire(lapsed.id);
    const page = await invitations.listInvitationHistory(reqOf(op), {});
    ok("#4 the history lists every invitation, newest first, 25 per page with a cursor and the total", page.rows.length === 25 && page.next !== null && page.total === (await invCount()) && page.offset === 0);
    const keys = Object.keys(page.rows[0]).sort().join(",");
    ok("#4 each row is allow-listed: id, reference, company, owner e-mail, country, state and dates — no token hash", keys === "acceptedAt,companyName,country,createdAt,expiresAt,id,ownerEmail,reference,revokedAt,state", keys);
    const page2 = await invitations.listInvitationHistory(reqOf(op), { after: page.next });
    ok("#4 page 2 follows page 1 without overlap; offset 25; same total", page2.offset === 25 && page2.total === page.total && page2.rows.every((r) => !page.rows.some((p) => p.id === r.id)) && page2.rows[0].createdAt.getTime() <= page.rows[24].createdAt.getTime());
    const states = new Map<string, number>();
    for (const s of invitations.INVITATION_LIFECYCLE_STATES) states.set(s, (await invitations.listInvitationHistory(reqOf(op), { state: s })).total);
    ok("#4 the state filter covers pending, expired, revoked and accepted (each non-empty here) and the four totals add up to all invitations",
      [...states.values()].every((n) => n > 0) && [...states.values()].reduce((a, b) => a + b, 0) === page.total, JSON.stringify(Object.fromEntries(states)));
    const accepted = await invitations.listInvitationHistory(reqOf(op), { state: "accepted" });
    ok("#4 …the accepted filter returns only the accepted invitation", accepted.rows.length === 1 && accepted.rows[0].state === "accepted");
    const byRef = await invitations.listInvitationHistory(reqOf(op), { q: first.reference.toLowerCase() });
    ok("#4 search by INV reference (any case) finds the invitation", byRef.rows.some((r) => r.id === first.id));
    const wild = await invitations.listInvitationHistory(reqOf(op), { q: "%" });
    ok("#4 a LIKE wildcard in the search matches only itself (no invitation contains %)", wild.total === 0);
    let badState = "";
    try {
      await invitations.listInvitationHistory(reqOf(op), { state: "deleted" });
    } catch (err) {
      badState = (err as { code?: string }).code ?? "?";
    }
    ok("#15 an unknown state filter → VALIDATION_FAILED", badState === "VALIDATION_FAILED", badState);
    const views0 = await auditCount("invitation.viewed");
    const detail = await invitations.getInvitationHistory(reqOf(op), first.id);
    ok("#4 the detail: allow-listed fields, the offered terms and the lifecycle events; the view is audited (invitation.viewed)",
      detail.reference === first.reference && detail.terms?.packageCode === "trial" && detail.terms?.trialDays === 14 && detail.terms?.includedSeats === 3 && detail.terms?.storageGb === 5 && detail.events.some((e) => e.action === "invitation.created") && (await auditCount("invitation.viewed")) === views0 + 1);
    await injected("platform_audit_events", true);
    let outageCode = "";
    try {
      await invitations.getInvitationHistory(reqOf(op), first.id);
    } catch (err) {
      outageCode = (err as { code?: string }).code ?? "?";
    } finally {
      await injected("platform_audit_events", false);
    }
    ok("#18 a detail view whose audit record cannot be written returns nothing (AUDIT_UNAVAILABLE)", outageCode === "AUDIT_UNAVAILABLE", outageCode);
    const plain = await companies.listPendingInvitations(reqOf(op), {});
    const withId = await companies.listPendingInvitations(reqOf(op), {}, { withId: true });
    ok("#4 the PO-02B pending list keeps its exact shape by default (no id); withId adds exactly the id — never a token hash",
      plain.rows.every((r) => Object.keys(r).sort().join(",") === "companyName,country,createdAt,expiresAt,ownerEmail,reference,state") &&
        withId.rows.every((r) => Object.keys(r).sort().join(",") === "companyName,country,createdAt,expiresAt,id,ownerEmail,reference,state") &&
        !/[0-9a-f]{64}/.test(JSON.stringify(withId)));
  }

  // ------------------------------------------------------------------------------------------------
  section("18. P-5: only the PUBLISHED default Trial is ever offered");
  {
    await keepAlive();
    const vid = await trialVersionId();
    const pkg = (await q<{ id: string }>("select id from subscription_packages where code = 'trial'"))[0].id;
    // Fixture only: a newer DRAFT version (the published v1 is not changed).
    await q("insert into subscription_package_versions (package_id, version_number, publish_state, is_trial, currency_code, monthly_price, annual_price, included_seats, storage_allowance_gb, trial_days) values ($1, 2, 'draft', true, 'SAR', 0, 0, 9, 50, 30)", [pkg]);
    const withDraft = await created1(op);
    const terms = await q<{ v: string }>("select initial_package_version_id::text as v from organization_invitation_terms where invitation_id = $1", [withDraft.id]);
    ok("#2 a newer DRAFT Trial version is never offered: the invitation's terms are still the published version 1", terms[0]?.v === vid);
    let fk = "";
    try {
      const draft = (await q<{ id: string }>("select id from subscription_package_versions where package_id = $1 and version_number = 2", [pkg]))[0].id;
      const hold = await holder();
      try {
        await hold.query("begin");
        const ins = await hold.query("insert into organization_invitations (company_name, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash, invited_by_platform_admin_id) values ('Fixture Draft Terms Co', 'draft@company-fixture.test', 'Saudi Arabia', 'SAR', 'Draft Owner', 'draft.owner@company-fixture.test', $1, $2) returning id", [sha256(randomBytes(32).toString("base64url")), op.id]);
        await hold.query("insert into organization_invitation_terms (invitation_id, initial_package_version_id, initial_version_state, initial_is_trial, initial_cycle) values ($1, $2, 'published', true, 'trial')", [ins.rows[0].id, draft]);
      } catch (err) {
        fk = (err as { code?: string }).code ?? "?";
      } finally {
        await hold.query("rollback").catch(() => undefined);
        await hold.end().catch(() => undefined);
      }
    } catch (err) {
      fk = describeError(err);
    }
    ok("#2 …and the database itself refuses terms that point at a draft version (composite foreign key → 23503)", fk === "23503", fk);
    // No active default Trial at all → refused before the step-up (audited stage no_trial).
    const target = await created1(op);
    await q("update subscription_packages set status = 'draft' where code = 'trial'");
    let noTrialCreate: Outcome = { ok: false }, noTrialReissue: Outcome = { ok: false };
    let previewTrial: unknown = "unset";
    const step0 = await lastStep(op);
    try {
      noTrialCreate = await create(op);
      noTrialReissue = await reissue(op, target.id);
      const p = await actions.previewCompanyInvitation(reqOf(op), fields());
      previewTrial = p.ok ? p.trial : "failed";
    } finally {
      await q("update subscription_packages set status = 'active' where code = 'trial'");
    }
    ok("#2 with no active default Trial package: create and re-issue → CONFIG_ERROR before the step-up (no code spent), the preview offers no Trial",
      !noTrialCreate.ok && noTrialCreate.code === "CONFIG_ERROR" && !noTrialReissue.ok && noTrialReissue.code === "CONFIG_ERROR" && previewTrial === null && (await lastStep(op)) === step0 && (await stageCount("no_trial", op.id)) === 2,
      `${codeOf(noTrialCreate)} ${codeOf(noTrialReissue)}`);
    const restored = await invitations.publishedDefaultTrial();
    ok("#2 …restored: the published default Trial v1 is offered again (14 days, 3 users, 5 GB, SAR 0.00)", restored?.versionNumber === 1 && restored.trialDays === 14 && restored.includedSeats === 3 && restored.storageGb === 5 && restored.currency === "SAR" && restored.monthlyPrice === "0.00");
  }

  // ------------------------------------------------------------------------------------------------
  section("19. No token or link stored, logged or sent; no organization, user, session or subscription created");
  {
    ok("#2 tokens collected from every successful create / re-issue of this run (and the raw-writer fixture)", tokensSeen.length >= 40, String(tokensSeen.length));
    const tables = (await q<{ t: string }>("select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")).map((r) => r.t);
    let hits = 0;
    let scanned = 0;
    for (const t of tables) {
      const rows = await q<{ x: string }>(`select t::text as x from "${t}" t`);
      scanned += rows.length;
      for (const r of rows) for (const tok of tokensSeen) if (r.x.includes(tok)) hits++;
    }
    ok(`#2 a full-database text scan (${tables.length} tables, ${scanned} rows) finds none of the ${tokensSeen.length} plaintext tokens`, hits === 0 && tables.length > 50, String(hits));
    const linkRows = await q<{ n: number }>("select count(*)::int as n from platform_audit_events where coalesce(after_safe::text, '') || coalesce(before_safe::text, '') || coalesce(reason, '') like '%register/accept%'");
    ok("#3 no audit record holds a link", linkRows[0].n === 0);
    const hashes = (await q<{ h: string }>("select token_hash as h from organization_invitations")).map((r) => r.h);
    const auditText = (await q<{ x: string }>("select coalesce(after_safe::text, '') || coalesce(before_safe::text, '') || coalesce(reason, '') as x from platform_audit_events")).map((r) => r.x).join("\n");
    ok(`#3 no audit record holds any of the ${hashes.length} token hashes`, hashes.every((h) => !auditText.includes(h)));
    // The harness's own PASS / FAIL / section lines name the link format in their titles; every other line is the code's.
    const logText = logged.filter((l) => !/^\s*(PASS|FAIL)\s/.test(l) && !/^\n?== /.test(l)).join("\n");
    ok("#3 no console line written during the run holds a token, a link, a password, a TOTP secret, a recovery code or a session token",
      tokensSeen.every((t) => !logText.includes(t)) && !logText.includes("#t=") && !logText.includes("register/accept") && secretsSeen.every((s) => !logText.includes(s)), `${logged.length} lines`);
    ok("#20 no delivery: no outbound connection or fetch() other than the loopback test database during the whole run", outbound.length === 0, outbound.slice(0, 5).join(", "));
    const files = ["src/lib/platform/invitations.ts", "src/lib/platform/invitation-actions.ts", "src/app/(platform)/invitation-actions.ts", "src/components/platform/invitation-dialogs.tsx", "src/components/platform/invitations-kit.tsx"];
    const code = files.map((f) => stripComments(read(f))).join("\n");
    const specifiers = [...code.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)].map((m) => m[1]);
    ok("#20 no invitation module imports a mail, SMS, messaging or HTTP client (only @/, ./, next/*, react, zod, lucide-react, drizzle-orm, node:crypto, server-only)",
      specifiers.length > 0 && specifiers.every((s) => /^(@\/|\.\/|next\/|react$|zod$|lucide-react$|drizzle-orm$|node:crypto$|server-only$)/.test(s)), specifiers.filter((s) => !/^(@\/|\.\/|next\/|react$|zod$|lucide-react$|drizzle-orm$|node:crypto$|server-only$)/.test(s)).join(" "));
    ok("#20 …and calls no fetch, XMLHttpRequest, sendBeacon, WebSocket or mail API", !/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|sendMail|nodemailer|twilio|whatsapp/i.test(code));
    const dialogs = stripComments(read("src/components/platform/invitation-dialogs.tsx"));
    ok("#4 the dialog keeps the link in component state only: no storage, cookie, URL or log write anywhere in it",
      !/localStorage|sessionStorage|indexedDB|document\.cookie|pushState|replaceState|location\.|console\./.test(dialogs) && /navigator\.clipboard\.writeText\(result\.link\)/.test(dialogs));
    const wrappers = stripComments(read("src/app/(platform)/invitation-actions.ts"));
    ok("#4 only the create and re-issue actions return a link, and every action input is a strict schema", (wrappers.match(/link: outcome\.link/g) ?? []).length === 2 && (wrappers.match(/\.strict\(\)/g) ?? []).length === 4);
    const after: Record<string, string> = {};
    for (const t of TABLES) after[t] = await checksum(t);
    ok("#21 no organization or user was created or changed (orgs, users byte-identical)", after.orgs === before.orgs && after.users === before.users);
    ok("#22 no customer session was created or changed (sessions byte-identical)", after.sessions === before.sessions);
    ok("#21 no access control, subscription, subscription event or primary-owner row was written", ["tenant_access_controls", "tenant_subscriptions", "tenant_primary_owners", "subscription_events"].every((t) => after[t] === before[t]));
    ok("#21 no invitation was ever accepted by this code (the only accepted row is the SQL fixture)", Number((await q<{ n: number }>("select count(*)::int as n from organization_invitations where accepted_at is not null"))[0].n) === 1);
    ok("#2 every invitation row has exactly one terms row (terms are written with the invitation, in its transaction)", (await invCount()) === (await termsCount()) && (await q("select i.id from organization_invitations i left join organization_invitation_terms t on t.invitation_id = i.id where t.invitation_id is null")).length === 0);
    const err = PLATFORM_ERROR_MESSAGES.INVITATIONS_DISABLED;
    ok("#23 the INVITATIONS_DISABLED message exists in English and native Arabic", /switched off/.test(err.en) && /[؀-ۿ]/.test(err.ar));
  }
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-invitations");
} catch (err) {
  console.error(`verify:platform-invitations aborted: ${describeError(err)}`);
  exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
  if (created && process.env.PLATFORM_TEST_KEEP_DATABASES !== "1") await dropDisposableDatabase(testDbName).catch(() => undefined);
}
process.exit(exitCode);
