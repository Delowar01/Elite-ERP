/**
 * Platform Owner PO-02D3 — invitation acceptance (src/lib/platform/invitation-acceptance.ts, the customer orchestrator
 * src/lib/onboarding/invitation-acceptance.ts, the shared bootstrap src/lib/org-bootstrap.ts), in-process, on real
 * PostgreSQL.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *     npm run verify:platform-invitation-acceptance
 *
 * One disposable `_test_only_` database (dropped at the end): the full branch schema with the reviewed PO-01A → PO-02A →
 * PO-02D1A SQL, then the reviewed PO-02D1B Trial seed through its guarded runner; fictional operators, invitations,
 * companies and users only. TEST-ONLY secrets are generated in memory and never printed; no token is printed. The real
 * customer orchestrator runs inside an emulated Next.js request scope (verify/platform/request-scope.ts), so the request
 * headers, the customer audit and the security events are the production code paths. Concurrency uses deterministic
 * barriers: an external session holds the lock a step needs, the suite waits until the expected backends are observed
 * waiting (pg_stat_activity), then releases it. Failures are injected with temporary triggers on the disposable database.
 * Tags A1 … A31 are the PO-02D3 categories (docs/platform-owner/PO02D3_DEVELOPMENT.md §K); the UI is
 * verify:platform-invitation-acceptance-browser.
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import type { Client } from "pg";
import bcrypt from "bcryptjs";
import { connectDisposable, createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { section, ok, summary, describeError } from "./platform/harness";
import { withRequest } from "./platform/request-scope";

const ROOT = process.cwd();
const testDbName = disposableName("po02d3_accept");
process.env.DATABASE_URL = databaseUrlFor(testDbName);
process.env.PLATFORM_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.FIELD_ENCRYPTION_KEYS = `1:${randomBytes(32).toString("base64")}`;
// Acceptance is independent of the console flags: they stay OFF for the whole suite.
delete process.env.PLATFORM_CONSOLE_ENABLED;
delete process.env.PLATFORM_INVITATIONS_ENABLED;
process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED = "true";
process.env.PLATFORM_TRUSTED_PROXY_HOPS = "1";
const ORIGIN = "https://customer.erp.test";
const HOST = "customer.erp.test";
process.env.CUSTOMER_PUBLIC_ORIGIN = ORIGIN;
delete process.env.PLATFORM_INVITATIONS_LOOPBACK_ORIGIN;

let created = false;
await createPlatformTestDatabase("po02d3_accept", testDbName);
created = true;
{
  const { runSeed } = await import("../scripts/platform/trial-seed");
  const seeded = await runSeed(process.env.DATABASE_URL);
  if (seeded.check.state !== "complete") throw new Error(`the Trial seed did not complete: ${seeded.check.state}`);
}

const { db, pool, orgsTable, usersTable } = await import("../src/db");
const { platformClock } = await import("../src/lib/platform/clock");
const invitations = await import("../src/lib/platform/invitations");
const core = await import("../src/lib/platform/invitation-acceptance");
const platformAudit = await import("../src/lib/platform/audit");
const orchestrator = await import("../src/lib/onboarding/invitation-acceptance");
const { bootstrapOrganization } = await import("../src/lib/org-bootstrap");
const { seedOrgDefaults } = await import("../src/lib/seed-org");
const { headers: nextHeaders } = await import("next/headers");
(pool as unknown as { options: { max: number } }).options.max = 40;
pool.on("error", () => undefined);
pool.on("connect", (client) => client.on("error", () => undefined));

// ---- deterministic platform clock ----------------------------------------------------------------------------------
let nowMs = Date.parse("2026-11-19T09:00:00.000Z");
platformClock.now = () => new Date(nowMs);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// ---- every console line is captured (none may hold a token or a password) -----------------------------------------
const logged: string[] = [];
for (const level of ["log", "info", "warn", "error", "debug"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    logged.push(args.map((a) => (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(" "));
    original(...(args as []));
  };
}
// ---- outbound connections and fetch() are recorded: only the loopback test database may be reached (no delivery) ---
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

// ---- helpers ----------------------------------------------------------------------------------------------------------
const q = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
const one = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await q<T>(text, values))[0];
const n = async (text: string, values: unknown[] = []) => Number((await one<{ n: number }>(text, values))?.n ?? 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tokensSeen: string[] = [];
const PASSWORD = "Fjord-Lantern-58!q";

// Every call gets its own fictional client IP unless a test names one: the durable per-IP throttle is exercised on
// purpose in A26, and must not turn unrelated refusals elsewhere into "throttled".
let ipSeq = 0;
const freshIp = () => {
  ipSeq += 1;
  return `10.20.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
};
const request = (ip = freshIp(), over: Record<string, string | null> = {}) => {
  const h: Record<string, string> = { host: HOST, origin: ORIGIN, "sec-fetch-site": "same-origin", "user-agent": "verify-invitation-acceptance", "x-forwarded-for": ip };
  for (const [k, v] of Object.entries(over)) if (v === null) delete h[k];
  else h[k] = v;
  return h;
};
const check = (token: unknown, ip?: string, over?: Record<string, string | null>) => withRequest(request(ip, over), () => orchestrator.checkInvitationLink(token));
const accept = (input: { token: unknown; ownerName?: unknown; password?: unknown; confirm?: unknown }, ip?: string, over?: Record<string, string | null>) =>
  withRequest(request(ip, over), () =>
    orchestrator.acceptInvitationLink({ ownerName: "Fixture Invitee", password: PASSWORD, confirm: input.password ?? PASSWORD, ...input }),
  );

let seq = 0;
const tag = () => `${Date.now().toString(36)}${++seq}`;
const trialV1 = (await one<{ id: string }>(`select v.id from subscription_package_versions v join subscription_packages p on p.id = v.package_id where p.is_default_trial and v.version_number = 1`))!.id;
const admin = (
  await one<{ id: string }>(
    `insert into platform_admins (email_normalized, display_name, password_hash, mfa_secret_encrypted, mfa_enrolled_at) values ('operator@acceptance-fixture.test', 'Fictional Operator', $1, 'v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB==:CCCCCCCC', now()) returning id`,
    [await bcrypt.hash("Fictional-Passw0rd!x", 4)],
  )
)!.id;

type Fixture = { id: string; token: string; email: string; company: string };
/** A pending invitation written exactly as PO-02D2 writes it (token generator, sha256, terms row), on the test clock. */
async function newInvitation(opts: { email?: string; company?: string; createdAgoMs?: number; ttlMs?: number; versionId?: string | null; cycle?: string; isTrial?: boolean } = {}): Promise<Fixture> {
  const { token, tokenHash } = invitations.newInvitationToken();
  tokensSeen.push(token);
  const t = tag();
  const email = opts.email ?? `owner.${t}@acceptance-fixture.test`;
  const company = opts.company ?? `Acceptance Fixture ${t}`;
  const createdAt = new Date(nowMs - (opts.createdAgoMs ?? HOUR));
  const expiresAt = new Date(createdAt.getTime() + (opts.ttlMs ?? 72 * HOUR));
  const row = await one<{ id: string }>(
    `insert into organization_invitations (company_name, industry, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash, expires_at,
       invited_by_platform_admin_id, created_at, updated_at)
     values ($1, 'Exhibitions', $2, 'Saudi Arabia', 'SAR', 'Fixture Invitee', $3, $4, $5, $6, $7, $7) returning id`,
    [company, `contact.${t}@acceptance-fixture.test`, email, tokenHash, expiresAt, admin, createdAt],
  );
  if (opts.versionId !== null) {
    await q(`insert into organization_invitation_terms (invitation_id, initial_package_version_id, initial_is_trial, initial_cycle) values ($1, $2, $3, $4)`, [
      row!.id,
      opts.versionId ?? trialV1,
      opts.isTrial ?? true,
      opts.cycle ?? "trial",
    ]);
  }
  return { id: row!.id, token, email, company };
}

const COUNTED_TABLES = [
  "orgs", "users", "sessions", "accounts", "document_sequences", "tax_presets", "tenant_access_controls", "tenant_primary_owners",
  "tenant_subscriptions", "subscription_events", "audit_logs", "security_events",
] as const;
async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of COUNTED_TABLES) out[t] = await n(`select count(*)::int as n from ${t}`);
  out.accepted = await n(`select count(*)::int as n from organization_invitations where accepted_at is not null`);
  return out;
}
const same = (a: Record<string, number>, b: Record<string, number>) => JSON.stringify(a) === JSON.stringify(b);
const diff = (a: Record<string, number>, b: Record<string, number>) =>
  Object.keys(b).filter((k) => a[k] !== b[k]).map((k) => `${k} ${a[k]}→${b[k]}`).join(", ") || "none";
const auditRows = (invitationId: string) =>
  q<{ action: string; result: string; after_safe: Record<string, unknown> | null; org_id: number | null; actor_label: string }>(
    `select action, result, after_safe, org_id, actor_label from platform_audit_events where entity_type = 'organization_invitation' and entity_id = $1 order by id`,
    [invitationId],
  );
const stageOf = async (invitationId: string) => ((await auditRows(invitationId)).at(-1)?.after_safe?.stage as string | undefined) ?? null;

/** External session for barriers. */
async function external(): Promise<Client> {
  const c = await connectDisposable(process.env.DATABASE_URL!);
  c.on("error", () => undefined);
  return c;
}
async function waitForWaiters(count: number, excludePid: number, timeoutMs = 15_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if ((await n(`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and pid <> $1`, [excludePid])) >= count) return true;
    await sleep(10);
  }
  return false;
}
const pidOf = async (c: Client) => Number((await c.query(`select pg_backend_pid() as p`)).rows[0].p);
/** Hold the published version row so an acceptance blocks INSIDE its transaction at the subscription insert (FK KEY SHARE). */
async function holdVersion(c: Client, versionId = trialV1) {
  await c.query("begin");
  await c.query(`select id from subscription_package_versions where id = $1 for update`, [versionId]);
}
async function inject(name: string, table: string, condition: string) {
  await q(`create or replace function po02d3_inject_${name}() returns trigger language plpgsql as $f$ begin if ${condition} then raise exception 'injected failure (${name})'; end if; return new; end $f$`);
  await q(`create trigger po02d3_inject_${name} before insert on ${table} for each row execute function po02d3_inject_${name}()`);
}
async function uninject(name: string, table: string) {
  await q(`drop trigger if exists po02d3_inject_${name} on ${table}`);
  await q(`drop function if exists po02d3_inject_${name}()`);
}
const acceptedOrg = async (invitationId: string) => (await one<{ o: number | null }>(`select accepted_org_id as o from organization_invitations where id = $1`, [invitationId]))?.o ?? null;

async function main() {
  // =================================================================================================================
  section("A1. Valid acceptance — every record, one transaction");
  {
    const inv = await newInvitation();
    const before = await counts();
    const view = await check(inv.token);
    ok("A1 the link check returns what is being accepted (company, owner e-mail, the offered Trial v1 terms)",
      view.ok && view.invitation.companyName === inv.company && view.invitation.ownerEmail === inv.email && view.invitation.trial.trialDays === 14 && view.invitation.trial.seats === 3 &&
        view.invitation.trial.storageGb === 5 && view.invitation.trial.modules.length === 9 && view.invitation.trial.price === "0.00" && view.invitation.trial.currency === "SAR" && view.invitation.trial.cycle === "trial",
      JSON.stringify(view).slice(0, 300));
    ok("A1 …the preview carries only the allow-listed fields (no id, token, hash, org or user data)",
      view.ok && JSON.stringify(Object.keys(view.invitation).sort()) === JSON.stringify(["companyName", "countryName", "currencyCode", "expiresAt", "expiresAtText", "ownerEmail", "ownerName", "reference", "trial"]) &&
        !JSON.stringify(view).includes(inv.token) && !JSON.stringify(view).includes(inv.id));
    ok("A1 …a check writes nothing", same(before, await counts()));
    const res = await accept({ token: inv.token, ownerName: "  Fixture   Invitee  Confirmed " });
    ok("A1 acceptance succeeds and returns the owner e-mail and the Trial dates", res.ok && res.ownerEmail === inv.email && Boolean(res.ok && res.startDateText.en && res.endDateText.ar), JSON.stringify(res));
    const after = await counts();
    ok("A1 exactly one company, one owner, one access row, one primary owner, one subscription, one event, one accepted invitation, one customer audit and one security event",
      after.orgs === before.orgs + 1 && after.users === before.users + 1 && after.tenant_access_controls === before.tenant_access_controls + 1 && after.tenant_primary_owners === before.tenant_primary_owners + 1 &&
        after.tenant_subscriptions === before.tenant_subscriptions + 1 && after.subscription_events === before.subscription_events + 1 && after.accepted === before.accepted + 1 &&
        after.audit_logs === before.audit_logs + 1 && after.security_events === before.security_events + 1 && after.sessions === before.sessions,
      diff(before, after));
    const orgId = await acceptedOrg(inv.id);
    const org = await one<Record<string, unknown>>(`select name, country, currency, industry, email, base_currency_confirmed_at is not null as confirmed, mfa_required_for_privileged, xmin::text as x from orgs where id = $1`, [orgId]);
    ok("A2 the organization: the invited name, country, base currency (confirmed), industry and company e-mail",
      org?.name === inv.company && org?.country === "Saudi Arabia" && org?.currency === "SAR" && org?.industry === "Exhibitions" && /^contact\..*@acceptance-fixture\.test$/.test(String(org?.email)) && org?.confirmed === true, JSON.stringify(org));
    const user = await one<Record<string, unknown>>(`select id, email, name, role, is_active, mfa_enabled, mfa_secret, password_hash, xmin::text as x from users where org_id = $1`, [orgId]);
    ok("A2 the owner: the invitation's normalized e-mail, the CONFIRMED name (white space collapsed), role owner, active, no MFA secret",
      user?.email === inv.email && user?.name === "Fixture Invitee Confirmed" && user?.role === "owner" && user?.is_active === true && user?.mfa_enabled === false && user?.mfa_secret === null, JSON.stringify({ ...user, password_hash: "…" }));
    ok("A2 …the password is stored only as the existing bcrypt hash, and it verifies", typeof user?.password_hash === "string" && (user.password_hash as string).startsWith("$2") && (await bcrypt.compare(PASSWORD, user.password_hash as string)));
    const defaults = await one<Record<string, number>>(
      `select (select count(*)::int from accounts where org_id = $1) as accounts, (select count(*)::int from document_sequences where org_id = $1) as sequences,
              (select count(*)::int from tax_presets where org_id = $1) as tax, (select count(*)::int from bank_accounts where org_id = $1) as banks,
              (select count(*)::int from departments where org_id = $1) as departments`, [orgId]);
    ok("A2 …the existing organization defaults are seeded (chart of accounts, sequences, presets, cash account, departments)", Number(defaults?.accounts) > 10 && Number(defaults?.sequences) > 5 && Number(defaults?.tax) === 2 && Number(defaults?.banks) === 1 && Number(defaults?.departments) === 3, JSON.stringify(defaults));
    const access = await one<Record<string, unknown>>(`select access_status, reason, changed_by_platform_admin_id, changed_at, xmin::text as x from tenant_access_controls where org_id = $1`, [orgId]);
    ok("A21 the company-access row: active, unattributed (no operator, no reason, no change time)", access?.access_status === "active" && access?.reason === null && access?.changed_by_platform_admin_id === null && access?.changed_at === null, JSON.stringify(access));
    const owner = await one<Record<string, unknown>>(`select user_id, org_id, assigned_by_platform_admin_id, xmin::text as x from tenant_primary_owners where org_id = $1`, [orgId]);
    ok("A22 the primary owner is the new owner of the new company (no operator)", Number(owner?.user_id) === Number(user?.id) && Number(owner?.org_id) === Number(orgId) && owner?.assigned_by_platform_admin_id === null);
    const sub = await one<Record<string, unknown>>(
      `select package_version_id, version_state, is_trial, cycle, lifecycle_state, start_date::text as s, end_date::text as e, price_snapshot_sar::text as price, seats_snapshot, storage_snapshot_gb,
              module_groups_snapshot, assignment_source, created_by_platform_admin_id, superseded_at, xmin::text as x from tenant_subscriptions where org_id = $1`, [orgId]);
    const version = await one<Record<string, unknown>>(`select included_seats, storage_allowance_gb, module_groups, trial_days, monthly_price::text as price from subscription_package_versions where id = $1`, [trialV1]);
    ok("A19 the Trial subscription: the terms' published v1, trialing, cycle trial, snapshots equal to the version (3 users, 5 GB, nine module labels, SAR 0.00)",
      sub?.package_version_id === trialV1 && sub?.version_state === "published" && sub?.is_trial === true && sub?.cycle === "trial" && sub?.lifecycle_state === "trialing" &&
        sub?.price === "0.00" && sub?.seats_snapshot === version?.included_seats && sub?.storage_snapshot_gb === version?.storage_allowance_gb &&
        JSON.stringify(sub?.module_groups_snapshot) === JSON.stringify(version?.module_groups) && (sub?.module_groups_snapshot as string[]).length === 9 &&
        sub?.assignment_source === "invitation_acceptance" && sub?.created_by_platform_admin_id === null && sub?.superseded_at === null, JSON.stringify(sub));
    ok("A19 …dates: start = the acceptance day in Asia/Riyadh (2026-11-19), inclusive end = start + 13 (2026-12-02)", sub?.s === "2026-11-19" && sub?.e === "2026-12-02", `${sub?.s} … ${sub?.e}`);
    const event = await one<Record<string, unknown>>(`select event_type, actor_platform_admin_id, actor_label, after_safe, request_id, xmin::text as x from subscription_events where org_id = $1`, [orgId]);
    ok("A1 the subscription event: `assigned` by the invitee (no operator), with a request id and a safe snapshot",
      event?.event_type === "assigned" && event?.actor_platform_admin_id === null && event?.actor_label === "invitee" && Boolean(event?.request_id) && (event?.after_safe as Record<string, unknown>)?.cycle === "trial");
    const invRow = await one<Record<string, unknown>>(`select accepted_at is not null as accepted, accepted_org_id, revoked_at, xmin::text as x from organization_invitations where id = $1`, [inv.id]);
    ok("A1 the invitation is accepted and linked to the new company", invRow?.accepted === true && Number(invRow?.accepted_org_id) === Number(orgId) && invRow?.revoked_at === null);
    const pAudit = (await auditRows(inv.id)).find((a) => a.action === "invitation.accepted");
    const pAuditX = await one<{ x: string }>(`select xmin::text as x from platform_audit_events where entity_id = $1 and action = 'invitation.accepted'`, [inv.id]);
    ok("A1 the platform audit `invitation.accepted` (success, actor invitee, the new company id) holds no token, hash or password",
      pAudit?.result === "success" && pAudit?.actor_label === "invitee" && Number(pAudit?.org_id) === Number(orgId) && !JSON.stringify(pAudit).includes(inv.token) && !/hash|password|token/i.test(Object.keys(pAudit?.after_safe ?? {}).join(",")));
    const cAudit = await one<Record<string, unknown>>(`select action, new_value, xmin::text as x from audit_logs where org_id = $1`, [orgId]);
    const sEvent = await one<Record<string, unknown>>(`select type, detail, email, xmin::text as x from security_events where org_id = $1`, [orgId]);
    ok("A1 the customer evidence: audit `org.registered` (source invitation) and security event `account.created`",
      cAudit?.action === "org.registered" && (cAudit?.new_value as Record<string, unknown>)?.source === "invitation" && sEvent?.type === "account.created" && sEvent?.detail === "organization owner (invitation)" && sEvent?.email === inv.email);
    const xs = new Set([org?.x, user?.x, access?.x, owner?.x, sub?.x, event?.x, invRow?.x, pAuditX?.x, cAudit?.x, sEvent?.x]);
    ok("A1 ATOMIC: all ten rows were written by ONE transaction (identical xmin)", xs.size === 1 && !xs.has(undefined), [...xs].join(","));
    ok("A27 no customer session was issued (sessions unchanged; the invitee signs in through /login)", after.sessions === before.sessions);
  }

  // =================================================================================================================
  section("A2–A6. Invalid, expired, revoked, used and replayed links");
  {
    const before = await counts();
    const results = [
      await check(""), await check("short"), await check(42), await check(null), await check(`${"A".repeat(43)}`), await check(`${"a".repeat(42)}!`),
      await accept({ token: randomBytes(32).toString("base64url") }),
    ];
    ok("A2 malformed, unknown, empty and non-string tokens: 'invalid', and nothing is created", results.every((r) => !r.ok && r.reason === "invalid") && same(before, await counts()), JSON.stringify(results.map((r) => (r.ok ? "ok" : r.reason))));
    const expired = await newInvitation({ createdAgoMs: 80 * HOUR });
    const e1 = await check(expired.token);
    const e2 = await accept({ token: expired.token });
    ok("A3 an expired invitation: 'expired' (check and accept), audited with stage expired, nothing created", !e1.ok && e1.reason === "expired" && !e2.ok && e2.reason === "expired" && (await stageOf(expired.id)) === "expired" && (await acceptedOrg(expired.id)) === null);
    const revoked = await newInvitation();
    await q(`update organization_invitations set revoked_at = $2, revoked_by_platform_admin_id = $3, updated_at = $2 where id = $1`, [revoked.id, new Date(nowMs), admin]);
    const r1 = await check(revoked.token);
    const r2 = await accept({ token: revoked.token });
    ok("A4 a revoked invitation: the neutral 'invalid' (not distinguished from an unknown link), audited with stage revoked", !r1.ok && r1.reason === "invalid" && !r2.ok && r2.reason === "invalid" && (await stageOf(revoked.id)) === "revoked");
    const used = await newInvitation();
    const first = await accept({ token: used.token }, "203.0.113.20");
    const again = await accept({ token: used.token }, "203.0.113.21");
    const view = await check(used.token, "203.0.113.22");
    ok("A5/A6 replay: the first acceptance succeeds; the same token again is 'used' (accept and check), and no second company appears",
      first.ok && !again.ok && again.reason === "used" && !view.ok && view.reason === "used" && (await n(`select count(*)::int as n from orgs where name = $1`, [used.company])) === 1);
  }

  // =================================================================================================================
  section("A7. Concurrent double acceptance (barrier on the owner e-mail lock)");
  {
    const inv = await newInvitation();
    const ext = await external();
    const extPid = await pidOf(ext);
    await ext.query(`select pg_advisory_lock(hashtextextended($1, 0))`, [`platform-invitation-email:${inv.email}`]);
    const a = accept({ token: inv.token }, "203.0.113.31");
    const b = accept({ token: inv.token }, "203.0.113.32");
    ok("A7 both acceptances are observed waiting on the e-mail lock", await waitForWaiters(2, extPid));
    await ext.query(`select pg_advisory_unlock(hashtextextended($1, 0))`, [`platform-invitation-email:${inv.email}`]);
    const [ra, rb] = await Promise.all([a, b]);
    await ext.end();
    const oks = [ra, rb].filter((r) => r.ok).length;
    const used = [ra, rb].filter((r) => !r.ok && r.reason === "used").length;
    ok("A7 exactly one succeeds; the other is 'used'; one company, one subscription", oks === 1 && used === 1 &&
      (await n(`select count(*)::int as n from orgs where name = $1`, [inv.company])) === 1 && (await n(`select count(*)::int as n from tenant_subscriptions where org_id = $1`, [await acceptedOrg(inv.id)])) === 1,
      JSON.stringify([ra, rb].map((r) => (r.ok ? "ok" : r.reason))));
  }

  // =================================================================================================================
  section("A8–A9. Acceptance vs revocation and vs re-issue (PO-02D2 lock order: e-mail lock, then the invitation row)");
  const revokeTx = async (c: Client, inv: Fixture) => {
    // The statements of PO-02D2's revoke transaction after its TOTP step: e-mail lock → row FOR UPDATE → refuse accepted → revoke.
    await c.query("begin isolation level read committed");
    await c.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`platform-invitation-email:${inv.email}`]);
    const row = (await c.query(`select accepted_at, revoked_at from organization_invitations where id = $1 for update`, [inv.id])).rows[0];
    if (row.accepted_at || row.revoked_at) {
      await c.query("rollback");
      return "refused (already accepted or revoked)";
    }
    await c.query(`update organization_invitations set revoked_at = $2, revoked_by_platform_admin_id = $3, updated_at = $2 where id = $1`, [inv.id, new Date(nowMs), admin]);
    await c.query("commit");
    return "revoked";
  };
  {
    // Revocation first: it commits before the acceptance reaches its lock → the acceptance is refused.
    const inv = await newInvitation();
    const rev = await external();
    const outcome = await revokeTx(rev, inv);
    const res = await accept({ token: inv.token });
    await rev.end();
    ok("A8 revocation commits first → the acceptance is refused ('invalid'); nothing is created", outcome === "revoked" && !res.ok && res.reason === "invalid" && (await acceptedOrg(inv.id)) === null);
  }
  {
    // Acceptance first: blocked INSIDE its transaction (version row held) while holding the e-mail lock and the row lock.
    const inv = await newInvitation();
    const holder = await external();
    const holderPid = await pidOf(holder);
    await holdVersion(holder);
    const acc = accept({ token: inv.token });
    ok("A8 the acceptance is observed waiting inside its transaction (at the subscription insert)", await waitForWaiters(1, holderPid));
    const rev = await external();
    const revoking = revokeTx(rev, inv);
    ok("A8 …a concurrent revocation queues behind it on the e-mail lock", await waitForWaiters(2, holderPid));
    await holder.query("rollback");
    await holder.end();
    const [res, outcome] = await Promise.all([acc, revoking]);
    await rev.end();
    ok("A8 the acceptance commits and the revocation then finds it accepted and changes nothing", res.ok && outcome.startsWith("refused") && (await acceptedOrg(inv.id)) !== null &&
      (await one<{ r: Date | null }>(`select revoked_at as r from organization_invitations where id = $1`, [inv.id]))?.r === null);
  }
  {
    // Re-issue first (PO-02D2: revoke the old row + insert the new one in one transaction) → the OLD token fails, the NEW works.
    const inv = await newInvitation();
    const ri = await external();
    await ri.query("begin isolation level read committed");
    await ri.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`platform-invitation-email:${inv.email}`]);
    await ri.query(`select id from organization_invitations where id = $1 for update`, [inv.id]);
    await ri.query(`update organization_invitations set revoked_at = $2, revoked_by_platform_admin_id = $3, updated_at = $2 where id = $1`, [inv.id, new Date(nowMs), admin]);
    const fresh = invitations.newInvitationToken();
    tokensSeen.push(fresh.token);
    const newId = (
      await ri.query(
        `insert into organization_invitations (company_name, industry, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash, expires_at, invited_by_platform_admin_id, created_at, updated_at)
         select company_name, industry, company_email, country_name, currency_code, owner_name, owner_email_normalized, $2, $3, invited_by_platform_admin_id, $4, $4 from organization_invitations where id = $1 returning id`,
        [inv.id, fresh.tokenHash, new Date(nowMs + 72 * HOUR), new Date(nowMs)],
      )
    ).rows[0].id as string;
    await ri.query(`insert into organization_invitation_terms (invitation_id, initial_package_version_id, initial_is_trial, initial_cycle) values ($1, $2, true, 'trial')`, [newId, trialV1]);
    const riPid = await pidOf(ri);
    const acc = accept({ token: inv.token });
    const queued = await waitForWaiters(1, riPid);
    await ri.query("commit");
    await ri.end();
    const old = await acc;
    const renewed = await accept({ token: fresh.token });
    ok("A9 re-issue vs acceptance of the OLD link: the acceptance queues on the e-mail lock, then fails ('invalid' — revoked); the NEW link is accepted",
      queued && !old.ok && old.reason === "invalid" && renewed.ok && (await acceptedOrg(newId)) !== null && (await acceptedOrg(inv.id)) === null);
  }
  {
    // Acceptance first, re-issue second: the re-issue's row lock waits, then it finds the invitation accepted.
    const inv = await newInvitation();
    const holder = await external();
    const holderPid = await pidOf(holder);
    await holdVersion(holder);
    const acc = accept({ token: inv.token });
    await waitForWaiters(1, holderPid);
    const ri = await external();
    const reissue = (async () => {
      await ri.query("begin isolation level read committed");
      await ri.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`platform-invitation-email:${inv.email}`]);
      const row = (await ri.query(`select accepted_at from organization_invitations where id = $1 for update`, [inv.id])).rows[0];
      await ri.query("rollback");
      return row.accepted_at ? "refused: accepted" : "would re-issue";
    })();
    const queued = await waitForWaiters(2, holderPid);
    await holder.query("rollback");
    await holder.end();
    const [res, outcome] = await Promise.all([acc, reissue]);
    await ri.end();
    ok("A9 acceptance first: the re-issue queues behind it, then sees the invitation accepted and does nothing", queued && res.ok && outcome === "refused: accepted");
  }

  // =================================================================================================================
  section("A10–A11. Acceptance vs public /register for the same e-mail (and case variants)");
  const register = (email: string, name = `Registration Fixture ${tag()}`) =>
    // registerAction's transaction exactly: the shared bootstrap inside db.transaction (default READ COMMITTED).
    db.transaction(async (tx) => bootstrapOrganization(tx, { orgName: name, country: "Saudi Arabia", currency: "SAR", ownerName: "Registered Owner", ownerEmail: email, passwordHash: "$2a$04$fixturefixturefixturefixtureu" }));
  {
    const inv = await newInvitation();
    await register(inv.email);
    const before = await counts();
    const res = await accept({ token: inv.token });
    ok("A10 /register committed first → acceptance refused with the neutral 'unavailable' (no 'account exists' signal); nothing created; invitation still pending",
      !res.ok && res.reason === "unavailable" && same(before, await counts()) && (await acceptedOrg(inv.id)) === null && (await stageOf(inv.id)) === "email_conflict");
  }
  {
    // /register in flight (uncommitted owner row) when the acceptance inserts its owner: the acceptance waits on the index entry.
    const inv = await newInvitation();
    const reg = await external();
    const regPid = await pidOf(reg);
    await reg.query("begin isolation level read committed");
    const orgRow = (await reg.query(`insert into orgs (name, country, currency) values ($1, 'Saudi Arabia', 'SAR') returning id`, [`Registration Fixture ${tag()}`])).rows[0];
    await reg.query(`insert into users (org_id, email, password_hash, name, role) values ($1, $2, 'x', 'Registered Owner', 'owner')`, [orgRow.id, inv.email]);
    const before = await counts();
    const acc = accept({ token: inv.token });
    const waited = await waitForWaiters(1, regPid);
    await reg.query("commit");
    await reg.end();
    const res = await acc;
    const after = await counts();
    ok("A10 /register in flight: the acceptance waits on the users_email_unique entry, then fails with 23505 → 'unavailable', and its WHOLE transaction rolls back",
      waited && !res.ok && res.reason === "unavailable" && after.orgs === before.orgs + 1 && after.users === before.users + 1 && after.tenant_subscriptions === before.tenant_subscriptions &&
        after.accepted === before.accepted && (await acceptedOrg(inv.id)) === null && (await stageOf(inv.id)) === "email_conflict",
      diff(before, after));
  }
  {
    // Acceptance in flight (owner inserted, blocked at the version) when /register inserts the same e-mail: /register loses.
    const inv = await newInvitation();
    const holder = await external();
    const holderPid = await pidOf(holder);
    await holdVersion(holder);
    const acc = accept({ token: inv.token });
    await waitForWaiters(1, holderPid);
    const regDone = register(inv.email).then(() => null, (e) => e);
    const regWaited = await waitForWaiters(2, holderPid);
    await holder.query("rollback");
    await holder.end();
    const [res, regErr] = await Promise.all([acc, regDone]);
    ok("A10 acceptance in flight: /register waits on the owner e-mail's index entry, then fails with 23505 and rolls back whole; one account, the invited company",
      regWaited && res.ok && String((regErr as { code?: string })?.code ?? (regErr as { cause?: { code?: string } })?.cause?.code) === "23505" &&
        (await n(`select count(*)::int as n from users where lower(email) = $1`, [inv.email])) === 1 && (await n(`select count(*)::int as n from orgs where name like 'Registration Fixture%' and id not in (select org_id from users)`)) === 0,
      describeError(regErr));
  }
  {
    // A legacy mixed-case account (written by a non-normalizing writer) still blocks the invitation for its address.
    const inv = await newInvitation();
    const legacyOrg = (await one<{ id: number }>(`insert into orgs (name, country, currency) values ($1, 'Saudi Arabia', 'SAR') returning id`, [`Legacy Fixture ${tag()}`]))!.id;
    await q(`insert into users (org_id, email, password_hash, name, role) values ($1, $2, 'x', 'Legacy Owner', 'owner')`, [legacyOrg, inv.email.replace(/^owner/, "Owner").toUpperCase()]);
    const before = await counts();
    const res = await accept({ token: inv.token });
    ok("A11 a case-variant of the owner e-mail held by an existing account refuses the acceptance ('unavailable'), nothing created",
      !res.ok && res.reason === "unavailable" && same(before, await counts()) && (await stageOf(inv.id)) === "email_conflict");
    const inv2 = await newInvitation();
    const done = await accept({ token: inv2.token });
    const regErr = await register(inv2.email.toUpperCase().trim().toLowerCase()).then(() => null, (e) => e);
    ok("A11 after an acceptance, /register of the same address in another letter case is normalized and refused by users_email_unique (23505)",
      done.ok && String((regErr as { code?: string })?.code ?? (regErr as { cause?: { code?: string } })?.cause?.code) === "23505");
  }

  // =================================================================================================================
  section("A12–A14. Failure injection: platform audit, customer audit, security event, transaction interruption");
  const failures: [string, string, string, string][] = [
    ["platform_audit", "platform_audit_events", "NEW.action = 'invitation.accepted'", "audit"],
    ["customer_audit", "audit_logs", "NEW.action = 'org.registered' AND NEW.new_value->>'source' = 'invitation'", "evidence"],
    ["security_event", "security_events", "NEW.detail = 'organization owner (invitation)'", "evidence"],
    ["subscription_event", "subscription_events", "NEW.actor_label = 'invitee'", "subscription_event"],
    ["primary_owner", "tenant_primary_owners", "true", "primary_owner"],
    ["access_row", "tenant_access_controls", "NEW.access_status = 'active' AND NEW.changed_by_platform_admin_id IS NULL", "access"],
    ["defaults", "departments", "NEW.name = 'Operations'", "bootstrap"],
  ];
  for (const [name, table, condition, expectedStage] of failures) {
    const inv = await newInvitation();
    await inject(name, table, condition);
    const before = await counts();
    const res = await accept({ token: inv.token });
    const after = await counts();
    await uninject(name, table);
    ok(`A12 failure at ${name}: 'unavailable', and NOTHING survives (no company, owner, defaults, mapping, subscription, accepted status or success record)`,
      !res.ok && res.reason === "unavailable" && same(before, after) && (await acceptedOrg(inv.id)) === null &&
        !(await auditRows(inv.id)).some((a) => a.action === "invitation.accepted") && (await stageOf(inv.id)) === expectedStage,
      `${diff(before, after)}; stage ${await stageOf(inv.id)}`);
    const retry = await accept({ token: inv.token });
    ok(`A12 …the same link is accepted once the failure is gone (${name})`, retry.ok);
  }
  {
    // Transaction interruption: the backend running the acceptance is terminated while it waits inside the transaction.
    const inv = await newInvitation();
    const holder = await external();
    const holderPid = await pidOf(holder);
    await holdVersion(holder);
    const before = await counts();
    const acc = accept({ token: inv.token });
    await waitForWaiters(1, holderPid);
    const victim = await one<{ pid: number }>(`select pid from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and pid <> $1 limit 1`, [holderPid]);
    await q(`select pg_terminate_backend($1)`, [victim!.pid]);
    const res = await acc;
    await holder.query("rollback");
    await holder.end();
    await sleep(50);
    ok("A14 a backend terminated mid-transaction: 'unavailable', nothing survives, the invitation stays pending", !res.ok && res.reason === "unavailable" && same(before, await counts()) && (await acceptedOrg(inv.id)) === null);
  }

  // =================================================================================================================
  section("A15–A16. Invitee fields: password policy, name, MFA policy");
  {
    const inv = await newInvitation();
    const before = await counts();
    const cases: [string, Record<string, unknown>, string][] = [
      ["too short", { password: "Ab1!x" }, "password"],
      ["no uppercase", { password: "lowercase-58!q" }, "password"],
      ["no number", { password: "No-Numbers-Here!" }, "password"],
      ["no symbol", { password: "NoSymbol58q" }, "password"],
      ["common", { password: "Password123!" }, "password"],
      ["mismatch", { password: PASSWORD, confirm: `${PASSWORD}x` }, "confirm"],
      ["empty name", { ownerName: "   " }, "ownerName"],
      ["control character in name", { ownerName: "Fixture\u0007Invitee" }, "ownerName"],
      ["direction override in name", { ownerName: "Fixture‮Invitee" }, "ownerName"],
      ["name over 200 characters", { ownerName: "x".repeat(201) }, "ownerName"],
      ["non-string password", { password: 12345678 }, "password"],
    ];
    const results = [];
    for (const [label, over, field] of cases) results.push([label, await accept({ token: inv.token, ...over }), field] as const);
    ok("A15 every policy or field violation is refused on its field (the /register DEFAULT_POLICY), and nothing is created",
      results.every(([, r, f]) => !r.ok && r.reason === "validation" && r.field === f) && same(before, await counts()),
      JSON.stringify(results.map(([l, r]) => [l, r.ok ? "ok" : r.reason === "validation" ? r.field : r.reason])));
    ok("A15 …validation failures do not count against the invitee (the link still works)", (await accept({ token: inv.token })).ok);
    const orgId = await acceptedOrg(inv.id);
    const mfa = await one<{ enabled: boolean; secret: string | null; required: boolean }>(`select u.mfa_enabled as enabled, u.mfa_secret as secret, o.mfa_required_for_privileged as required from users u join orgs o on o.id = u.org_id where u.org_id = $1`, [orgId]);
    ok("A16 MFA: the existing customer policy requires no enrolment at account creation (as /register): no secret is set, enrolment stays in the Security Center, and the company gets the default 'MFA required for privileged roles' setting",
      mfa?.enabled === false && mfa?.secret === null && mfa?.required === true);
  }

  // =================================================================================================================
  section("A17–A20. Terms and the Trial snapshot");
  {
    // A17: the database refuses terms that name a draft version, and acceptance refuses terms that are not a Trial.
    const draft = await one<{ id: string }>(
      `insert into subscription_package_versions (package_id, version_number, publish_state, is_trial, monthly_price, annual_price, included_seats, storage_allowance_gb, module_groups, trial_days)
       select package_id, 99, 'draft', true, 0, 0, 3, 5, module_groups, 14 from subscription_package_versions where id = $1 returning id`, [trialV1]);
    const inv = await newInvitation({ versionId: null });
    const fkErr = await q(`insert into organization_invitation_terms (invitation_id, initial_package_version_id, initial_is_trial, initial_cycle) values ($1, $2, true, 'trial')`, [inv.id, draft!.id]).then(() => null, (e) => e);
    ok("A17 the database refuses invitation terms that name an UNPUBLISHED (draft) version (composite foreign key)", String((fkErr as { code?: string })?.code) === "23503", describeError(fkErr));
    const before = await counts();
    const r1 = await check(inv.token);
    const r2 = await accept({ token: inv.token });
    ok("A18 an invitation WITHOUT terms: 'unavailable' (check and accept), audited stage terms, nothing created", !r1.ok && r1.reason === "unavailable" && !r2.ok && r2.reason === "unavailable" && same(before, await counts()) && (await stageOf(inv.id)) === "terms");
    const paidPkg = await one<{ id: string }>(`insert into subscription_packages (code, name, status, is_trial, created_by_platform_admin_id) values ('fixture-paid', 'Fixture Paid', 'active', false, $1) returning id`, [admin]);
    const paid = await one<{ id: string }>(
      `insert into subscription_package_versions (package_id, version_number, publish_state, is_trial, monthly_price, annual_price, included_seats, storage_allowance_gb, module_groups, trial_days, published_at, created_by_platform_admin_id)
       values ($1, 1, 'published', false, 100, 1000, 5, 10, '["Dashboard"]'::jsonb, 0, now(), $2) returning id`, [paidPkg!.id, admin]);
    const paidInv = await newInvitation({ versionId: paid!.id, isTrial: false, cycle: "monthly" });
    const r3 = await accept({ token: paidInv.token });
    ok("A17 terms naming a PAID published version (cycle monthly): refused 'unavailable' — acceptance assigns the Trial only (P-5); nothing created", !r3.ok && r3.reason === "unavailable" && (await stageOf(paidInv.id)) === "terms" && (await acceptedOrg(paidInv.id)) === null);
  }
  {
    // A19: an older invitation keeps ITS version even after a newer Trial version is published.
    const v2 = await one<{ id: string }>(
      `insert into subscription_package_versions (package_id, version_number, publish_state, is_trial, monthly_price, annual_price, included_seats, storage_allowance_gb, module_groups, trial_days, published_at)
       select package_id, 2, 'published', true, 0, 0, 7, 9, '["Dashboard","Sales"]'::jsonb, 30, now() from subscription_package_versions where id = $1 returning id`, [trialV1]);
    const older = await newInvitation();
    const res = await accept({ token: older.token });
    const sub = await one<{ v: string; seats: number; storage: number; mods: string[]; s: string; e: string }>(
      `select package_version_id as v, seats_snapshot as seats, storage_snapshot_gb as storage, module_groups_snapshot as mods, start_date::text as s, end_date::text as e from tenant_subscriptions where org_id = $1`, [await acceptedOrg(older.id)]);
    ok("A19 an invitation whose terms name v1 is assigned v1 even though v2 (30 days, 7 users) is now the newest published Trial — no silent switch",
      res.ok && sub?.v === trialV1 && sub?.seats === 3 && sub?.storage === 5 && sub?.mods.length === 9 && sub?.e === "2026-12-02", JSON.stringify(sub));
    const newer = await newInvitation({ versionId: v2!.id });
    const res2 = await accept({ token: newer.token });
    const sub2 = await one<{ v: string; seats: number; s: string; e: string }>(`select package_version_id as v, seats_snapshot as seats, start_date::text as s, end_date::text as e from tenant_subscriptions where org_id = $1`, [await acceptedOrg(newer.id)]);
    ok("A19 …and an invitation naming v2 gets v2's snapshots (30 days: end = start + 29)", res2.ok && sub2?.v === v2!.id && sub2?.seats === 7 && sub2?.s === "2026-11-19" && sub2?.e === "2026-12-18", JSON.stringify(sub2));
  }
  {
    // A20: the Riyadh business-date boundary (UTC+3, no daylight saving).
    const saved = nowMs;
    nowMs = Date.parse("2026-11-19T20:59:59.000Z"); // 23:59:59 in Riyadh, 19 Nov
    const late = await newInvitation();
    const r1 = await accept({ token: late.token });
    const s1 = await one<{ s: string; e: string }>(`select start_date::text as s, end_date::text as e from tenant_subscriptions where org_id = $1`, [await acceptedOrg(late.id)]);
    nowMs = Date.parse("2026-11-19T21:00:00.000Z"); // 00:00:00 in Riyadh, 20 Nov
    const midnight = await newInvitation();
    const r2 = await accept({ token: midnight.token });
    const s2 = await one<{ s: string; e: string }>(`select start_date::text as s, end_date::text as e from tenant_subscriptions where org_id = $1`, [await acceptedOrg(midnight.id)]);
    nowMs = saved;
    ok("A20 accepted at 23:59:59 Riyadh (20:59:59 UTC): the Trial runs 2026-11-19 … 2026-12-02", r1.ok && s1?.s === "2026-11-19" && s1?.e === "2026-12-02", JSON.stringify(s1));
    ok("A20 accepted at 00:00:00 Riyadh (21:00:00 UTC, still 19 Nov in UTC): the Trial runs 2026-11-20 … 2026-12-03", r2.ok && s2?.s === "2026-11-20" && s2?.e === "2026-12-03", JSON.stringify(s2));
    ok("A20 …the business-date helper agrees across the year (Riyadh has no daylight saving)", core.riyadhBusinessDate(new Date("2026-03-29T21:30:00Z")) === "2026-03-30" && core.riyadhBusinessDate(new Date("2026-10-25T20:59:00Z")) === "2026-10-25");
  }

  // =================================================================================================================
  section("A22–A24. Primary owner, cross-company keys, tenant isolation");
  {
    const a = await newInvitation();
    const b = await newInvitation();
    await accept({ token: a.token });
    await accept({ token: b.token });
    const orgA = await acceptedOrg(a.id);
    const orgB = await acceptedOrg(b.id);
    const userB = (await one<{ id: number }>(`select id from users where org_id = $1`, [orgB]))!.id;
    const dup = await q(`insert into tenant_primary_owners (user_id, org_id) values ($1, $2)`, [userB, orgB]).then(() => null, (e) => e);
    ok("A22 a company has ONE primary owner (a second mapping is refused)", String((dup as { code?: string })?.code) === "23505");
    const cross = await q(`insert into tenant_primary_owners (user_id, org_id) values ($1, $2)`, [userB, orgA]).then(() => null, (e) => e);
    ok("A23 a user of company B can never be mapped as company A's primary owner (composite foreign key / guard)", ["23503", "23505", "23514"].includes(String((cross as { code?: string })?.code)), describeError(cross));
    const subA = (await one<{ id: string }>(`select id from tenant_subscriptions where org_id = $1`, [orgA]))!.id;
    const crossEvent = await q(`insert into subscription_events (tenant_subscription_id, org_id, event_type, actor_label) values ($1, $2, 'assigned', 'invitee')`, [subA, orgB]).then(() => null, (e) => e);
    ok("A23 a subscription event can never be filed under another company (composite foreign key)", String((crossEvent as { code?: string })?.code) === "23503");
    const view = await check(b.token);
    ok("A24 a used link reveals nothing about either company (only the neutral 'used')", !view.ok && view.reason === "used" && Object.keys(view).length === 2);
    const conflictInv = await newInvitation({ email: a.email });
    const res = await accept({ token: conflictInv.token });
    ok("A24 an e-mail held by ANOTHER company's owner is refused with the same neutral 'unavailable' (no account-existence signal, no data)", !res.ok && res.reason === "unavailable" && Object.keys(res).length === 2);
  }

  // =================================================================================================================
  section("A25–A29. Request checks, rate limits, flag, no delivery, no session");
  {
    const inv = await newInvitation();
    const variants: [string, Record<string, string | null>][] = [
      ["no Origin", { origin: null }],
      ["a foreign Origin", { origin: "https://attacker.example" }],
      ["a cross-site fetch", { "sec-fetch-site": "cross-site" }],
      ["a non-canonical host (Origin = Host, but not the customer origin)", { host: "other.erp.test", origin: "https://other.erp.test" }],
    ];
    const results = [];
    for (const [label, over] of variants) results.push([label, await check(inv.token, "203.0.113.40", over)] as const);
    ok("A25 cross-origin, cross-site and non-canonical requests are refused ('unavailable') before the token is read", results.every(([, r]) => !r.ok && r.reason === "unavailable"), JSON.stringify(results.map(([l, r]) => [l, r.ok ? "ok" : r.reason])));
    const saved = process.env.CUSTOMER_PUBLIC_ORIGIN;
    delete process.env.CUSTOMER_PUBLIC_ORIGIN;
    const noOrigin = await check(inv.token);
    process.env.CUSTOMER_PUBLIC_ORIGIN = "http://customer.erp.test";
    const httpOrigin = await check(inv.token, "203.0.113.40", { origin: "http://customer.erp.test" });
    process.env.CUSTOMER_PUBLIC_ORIGIN = saved;
    ok("A25 a missing or non-https CUSTOMER_PUBLIC_ORIGIN fails closed ('unavailable')", !noOrigin.ok && noOrigin.reason === "unavailable" && !httpOrigin.ok && httpOrigin.reason === "unavailable");
    await q(`alter table platform_audit_events disable trigger user`);
    await platformAudit.assertPlatformAuditProtection({ force: true }).catch(() => undefined);
    const unprotected = await check(inv.token);
    await q(`alter table platform_audit_events enable trigger user`);
    await platformAudit.assertPlatformAuditProtection({ force: true });
    ok("A25 an unprotected platform audit trail refuses every request ('unavailable')", !unprotected.ok && unprotected.reason === "unavailable");
    ok("A25 headers() throws outside a request scope (the test emulation cannot make a check pass silently)", await (async () => nextHeaders())().then(() => false, () => true));
  }
  {
    // A26: durable per-IP limit (10 failures / 15 min → 15-minute block), checked BEFORE any token lookup.
    const ip = "198.51.100.77";
    const valid = await newInvitation();
    const results = [];
    for (let i = 0; i < 10; i++) results.push(await check(randomBytes(32).toString("base64url"), ip));
    const blocked = await check(valid.token, ip);
    const otherIp = await check(valid.token, "198.51.100.78");
    ok("A26 ten unknown links from one IP → the IP is blocked: even a VALID link from it is refused 'throttled'; another IP is unaffected",
      results.every((r) => !r.ok && r.reason === "invalid") && !blocked.ok && blocked.reason === "throttled" && otherIp.ok);
    const stored = await q<{ email_hash: string | null; ip_hash: string | null }>(`select email_hash, ip_hash from platform_login_attempts where outcome = 'failure'`);
    ok("A26 the throttle stores keyed digests only (no plaintext IP, e-mail or token)", stored.length > 0 && stored.every((r) => (!r.ip_hash || /^[0-9a-f]{64}$/.test(r.ip_hash)) && (!r.email_hash || /^[0-9a-f]{64}$/.test(r.email_hash))) &&
      !JSON.stringify(stored).includes(ip));
    const loginDigest = (await import("../src/lib/platform/config")).platformKeyedDigest("login-ip", ip);
    ok("A26 …acceptance keys never equal a Platform Owner sign-in key (separate digest purposes)", !stored.some((r) => r.ip_hash === loginDigest));
    const child = spawnSync(process.execPath, [join(ROOT, "node_modules", ".bin", "tsx"), "--conditions=react-server", join(ROOT, "verify/platform/acceptance-throttle-child.mts"), ip, new Date(nowMs).toISOString()], {
      env: { ...process.env }, encoding: "utf8", timeout: 60_000,
    });
    ok("A26 DURABLE: a separate process sees the same block (state in PostgreSQL, not process memory)", /"blocked":true/.test(child.stdout), (child.stdout + child.stderr).slice(-300));
    nowMs += 16 * MINUTE;
    const later = await check(valid.token, ip);
    ok("A26 …the block lifts after 15 minutes", later.ok);
  }
  {
    // A26: per-invitation limit (5 counted failures / 15 min), from different IPs: only a link holder can reach it.
    const inv = await newInvitation();
    const holderOrg = (await one<{ id: number }>(`insert into orgs (name, country, currency) values ($1, 'Saudi Arabia', 'SAR') returning id`, [`Holder Fixture ${tag()}`]))!.id;
    await q(`insert into users (org_id, email, password_hash, name, role) values ($1, $2, 'x', 'Holder', 'owner')`, [holderOrg, inv.email]);
    const tries = [];
    for (let i = 0; i < 5; i++) tries.push(await accept({ token: inv.token }, `192.0.2.${10 + i}`));
    const next = await check(inv.token, "192.0.2.99");
    ok("A26 five refused acceptances of ONE invitation (from five IPs) block that invitation: 'throttled'", tries.every((r) => !r.ok && r.reason === "unavailable") && !next.ok && next.reason === "throttled");
    const other = await newInvitation();
    ok("A26 …other invitations are unaffected", (await check(other.token, "192.0.2.99")).ok);
    nowMs += 16 * MINUTE;
  }
  {
    // Unknown client IP (no trusted proxy): per-IP limits are skipped and nothing is written for unknown links.
    process.env.PLATFORM_TRUSTED_PROXY_HOPS = "0";
    const rows = await n(`select count(*)::int as n from platform_login_attempts`);
    for (let i = 0; i < 12; i++) await check(randomBytes(32).toString("base64url"), "198.51.100.200");
    const still = await newInvitation();
    const res = await check(still.token, "198.51.100.200");
    process.env.PLATFORM_TRUSTED_PROXY_HOPS = "1";
    ok("A26 without a trusted proxy the IP is unknown: no per-IP key is stored for unknown links and nothing is blocked (as the sign-in throttle)", (await n(`select count(*)::int as n from platform_login_attempts`)) === rows && res.ok);
  }
  {
    // A27: the flag. Off unless exactly "true"; nothing is read or written.
    const inv = await newInvitation();
    const rows = await n(`select count(*)::int as n from platform_login_attempts`);
    const before = await counts();
    const values = [undefined, "", "TRUE", "True", "1", "yes", " true", "true "];
    const results = [];
    for (const v of values) {
      if (v === undefined) delete process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED;
      else process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED = v;
      results.push(await check(inv.token), await accept({ token: inv.token }));
    }
    process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED = "true";
    ok("A27 flag OFF (unset, empty, TRUE, True, 1, yes, ' true', 'true '): every check and acceptance is 'disabled'", results.every((r) => !r.ok && r.reason === "disabled"));
    ok("A27 …and nothing is read into or written: no company, no throttle row, the invitation still pending", same(before, await counts()) && (await n(`select count(*)::int as n from platform_login_attempts`)) === rows && (await acceptedOrg(inv.id)) === null);
    ok("A27 acceptance does not depend on the console flags (both OFF for this whole suite)", !process.env.PLATFORM_CONSOLE_ENABLED && !process.env.PLATFORM_INVITATIONS_ENABLED);
  }
  {
    // A28: no delivery, no session — statically and at run time.
    const MODULES = ["src/lib/platform/invitation-acceptance.ts", "src/lib/platform/acceptance-throttle.ts", "src/lib/onboarding/invitation-acceptance.ts", "src/app/(invite)/register/accept/actions.ts", "src/app/(invite)/register/accept/page.tsx", "src/app/(invite)/register/accept/accept-invitation.tsx"];
    const text = MODULES.map((m) => readFileSync(join(ROOT, m), "utf8")).join("\n");
    ok("A28 the acceptance modules import no mail, SMS, messaging or HTTP client and call no fetch()", !/nodemailer|@sendgrid|twilio|whatsapp|resend|mailgun|postmark|\bsmtp\b|from "(node:)?https?"|axios|\bfetch\(/i.test(text));
    ok("A28 …and never create a session or set a cookie (no createSession / issueSession / signSessionToken / cookies())", !/createSession|issueSession|signSessionToken|cookies\(\)/.test(text));
    ok("A28 at run time nothing but the loopback test database was contacted", outbound.length === 0, outbound.slice(0, 5).join(", "));
  }

  // =================================================================================================================
  section("A29. No token, hash or password in logs, audit records or any table");
  {
    const joinedLogs = logged.join("\n");
    ok("A29 no token or the test password appears in any captured log line", tokensSeen.every((t) => !joinedLogs.includes(t)) && !joinedLogs.includes(PASSWORD), `${logged.length} lines`);
    const tables = await q<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`);
    let hit = "";
    for (const { table_name } of tables) {
      const rows = await q<{ t: string }>(`select t::text as t from "${table_name}" t`);
      const text = rows.map((r) => r.t).join("\n");
      const found = tokensSeen.find((tk) => text.includes(tk)) ?? (text.includes(PASSWORD) ? "password" : "");
      if (found) {
        hit = `${table_name}`;
        break;
      }
    }
    ok("A29 a full-database text scan finds no plaintext token and no plaintext password in any table", hit === "", hit);
    const audits = await q<{ s: string }>(`select coalesce(after_safe::text, '') || coalesce(before_safe::text, '') as s from platform_audit_events where action like 'invitation.accept%'`);
    ok("A29 platform audit records of acceptance hold no token, token hash or link", audits.length > 5 && audits.every((a) => !/[0-9a-f]{64}/.test(a.s) && !/register\/accept/.test(a.s)));
  }

  // =================================================================================================================
  section("A30. /register regression — the shared bootstrap is the baseline registration transaction");
  {
    // The oracle: registerAction's transaction body exactly as it was at 49510ec (before the shared helper).
    const baselineTx = async (input: { orgName: string; country: string; currency: string; name: string; email: string; passwordHash: string }) =>
      db.transaction(async (tx) => {
        const [org] = await tx.insert(orgsTable).values({ name: input.orgName, country: input.country, currency: input.currency, baseCurrencyConfirmedAt: new Date() }).returning();
        const [user] = await tx.insert(usersTable).values({ orgId: org.id, email: input.email, passwordHash: input.passwordHash, name: input.name, role: "owner" }).returning();
        await seedOrgDefaults(tx, org.id, input.country);
        return { userId: user.id, orgId: org.id };
      });
    const TABLES = ["accounts", "document_sequences", "tax_presets", "payment_term_presets", "units", "bank_accounts", "departments", "product_categories", "leave_types", "expense_categories"];
    const snapshot = async (orgId: number) => {
      const strip = (r: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(r).filter(([k]) => !["id", "org_id", "created_at", "updated_at", "gl_account_id", "base_currency_confirmed_at", "password_changed_at", "email", "name_unique"].includes(k)));
      const out: Record<string, unknown> = {
        org: strip({ ...(await one(`select * from orgs where id = $1`, [orgId]))!, name: "·" }),
        confirmed: (await one<{ c: boolean }>(`select base_currency_confirmed_at is not null as c from orgs where id = $1`, [orgId]))!.c,
        user: strip((await one(`select * from users where org_id = $1`, [orgId]))!),
        xmins: (await one<{ n: number }>(
          `select count(distinct x)::int as n from (select xmin::text as x from orgs where id = $1 union all select xmin::text from users where org_id = $1 union all select xmin::text from accounts where org_id = $1 union all select xmin::text from expense_categories where org_id = $1) s`, [orgId]))!.n,
      };
      for (const t of TABLES) out[t] = (await q(`select * from ${t} where org_id = $1 order by id`, [orgId])).map(strip);
      return JSON.stringify(out);
    };
    let equal = 0;
    const countries = [["Saudi Arabia", "SAR"], ["United Arab Emirates", "AED"], ["Bangladesh", "BDT"]];
    for (const [country, currency] of countries) {
      const t1 = tag();
      const base = await baselineTx({ orgName: `Equivalence ${t1}`, country, currency, name: "Equivalence Owner", email: `eq.base.${t1}@register-fixture.test`, passwordHash: "$2a$04$equivalenceequivalenceequivalen" });
      const next = await db.transaction(async (tx) =>
        bootstrapOrganization(tx, { orgName: `Equivalence ${t1}`, country, currency, ownerName: "Equivalence Owner", ownerEmail: `eq.next.${t1}@register-fixture.test`, passwordHash: "$2a$04$equivalenceequivalenceequivalen" }),
      );
      if ((await snapshot(base.orgId)) === (await snapshot(next.orgId))) equal++;
    }
    ok("A30 for three countries the shared bootstrap writes exactly what the baseline registration transaction wrote (org, owner, every seeded default row), in one transaction", equal === countries.length, `${equal}/${countries.length}`);
    const nonNormalized = await db.transaction(async (tx) => bootstrapOrganization(tx, { orgName: "x", country: "Saudi Arabia", currency: "SAR", ownerName: "x", ownerEmail: "Not.Normalized@register-fixture.test", passwordHash: "x" })).then(() => null, (e) => e);
    ok("A30 the shared bootstrap refuses a non-normalized owner e-mail before writing anything", nonNormalized instanceof Error && /normalized/.test(nonNormalized.message));
    const actions = readFileSync(join(ROOT, "src/app/(auth)/actions.ts"), "utf8");
    ok("A30 registerAction keeps its order: check → hash → ONE transaction (bootstrap) → audit + security event after commit → session → /dashboard",
      /const \[existing\][\s\S]*?const passwordHash = await hashPassword\(password\);[\s\S]*?await db\.transaction\(async \(tx\) =>\s*bootstrapOrganization\(tx, \{ orgName, country, currency, ownerName: name, ownerEmail: email, passwordHash \}\),\s*\);\s*\n\s*await recordAudit\(\{ orgId, userId, userName: name \}, \{ action: "org\.registered"[\s\S]*?await recordSecurityEvent\([\s\S]*?await issueSession\(userId, orgId\);\s*redirect\("\/dashboard"\);/.test(actions));
  }

  // =================================================================================================================
  section("A31. Every string of the acceptance page has its Saudi Arabic entry (src/app/(invite)/register/accept/copy.ts)");
  {
    const copyModule = await import("../src/app/(invite)/register/accept/copy");
    const { validatePassword, DEFAULT_POLICY } = await import("../src/lib/security/password-policy");
    const pageText = readFileSync(join(ROOT, "src/app/(invite)/register/accept/accept-invitation.tsx"), "utf8");
    const orchestratorText = readFileSync(join(ROOT, "src/lib/onboarding/invitation-acceptance.ts"), "utf8");
    const used = new Set<string>();
    const lit = String.raw`"((?:[^"\\]|\\.)*)"`;
    for (const re of [new RegExp(String.raw`\bc\(` + lit + String.raw`\)`, "g"), new RegExp(String.raw`\bfill\(locale, ` + lit, "g"), new RegExp(String.raw`\b(?:title|body): ` + lit, "g"), new RegExp(String.raw`return ` + lit + ";", "g"), new RegExp(String.raw`next\.\w+ = ` + lit + ";", "g")]) {
      for (const m of pageText.matchAll(re)) used.add(m[1]);
    }
    for (const m of orchestratorText.matchAll(new RegExp(String.raw`message: ` + lit, "g"))) used.add(m[1]);
    // The shared /register policy (DEFAULT_POLICY): every message the server can return for a password.
    for (const pw of ["", "a", "aaaaaaaa", "AAAAAAAA", "Aaaaaaaa", "Aaaaaaa1", "Password1!"]) for (const msg of validatePassword(pw, DEFAULT_POLICY)) used.add(msg);
    const missing = [...used].filter((k) => !copyModule.ACCEPTANCE_COPY_KEYS.includes(k));
    ok(`A31 all ${used.size} English strings the page can show (labels, notes, refusals, client and server validation, the password policy) have an Arabic entry`, used.size >= 50 && missing.length === 0, missing.slice(0, 5).join(" | "));
    ok("A31 …and every entry is Arabic text, not a copy of the English", copyModule.ACCEPTANCE_COPY_KEYS.every((k) => /[\u0600-\u06FF]/.test(copyModule.copy("ar", k)) && copyModule.copy("ar", k) !== k));
    ok("A31 …placeholders survive translation ({n}, {start}, {end} appear in the Arabic exactly as in the English)", copyModule.ACCEPTANCE_COPY_KEYS.every((k) => JSON.stringify((k.match(/\{\w+\}/g) ?? []).sort()) === JSON.stringify((copyModule.copy("ar", k).match(/\{\w+\}/g) ?? []).sort())));
  }
}

let exit = 1;
try {
  await main();
} catch (e) {
  ok("suite ran to completion", false, describeError(e));
} finally {
  await pool.end().catch(() => undefined);
  if (created) await dropDisposableDatabase(testDbName).catch(() => undefined);
  exit = summary("verify:platform-invitation-acceptance");
}
process.exit(exit);
