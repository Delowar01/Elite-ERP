/**
 * Platform Owner PO-03D (sub-batch C) — user-seat enforcement on EVERY seat-allocating path, on real PostgreSQL: the
 * Platform Owner user-invitation create and re-issue cores (src/lib/platform/user-invitation-actions.ts), the public
 * acceptance (src/lib/onboarding/user-invitation-acceptance.ts → src/lib/platform/user-invitation-acceptance.ts) and the
 * customer Team's Add Member (src/lib/team/member-add.ts, through the Team ownership gate) — all through the ONE shared
 * check (src/lib/platform/seat-enforcement.ts) under the company row lock.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://…/<admin db with _test_only_> npm run verify:platform-seat-paths
 *
 * Disposable databases only (all dropped at the end): the reviewed schema and platform SQL chain plus the PO-02D1B
 * Trial seed, then the staged PO-03C user_invitations SQL applied by THIS suite (it is not in the chain). Fictional
 * companies, users and operators; TEST-ONLY secrets generated in memory and never printed. Every race runs in a known
 * interleaving: a barrier (a held lock) is observed waiting in pg_stat_activity before it is released.
 *
 * Categories (docs/platform-owner/PO03D_DEVELOPMENT.md §G, §I, §J, §K): E each path enforced (create, re-issue, Team
 * add, acceptance; no subscription; over the limit) · D what the displays are told (enforced only with a subscription) ·
 * N switched off: every path as before · K races (§13 cases 7–17, 19; Team-path cases of 21, 23, 25) · X no other
 * tenant changed; nothing secret printed.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { connectDisposable, createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { describeError, ok, section, summary } from "./platform/harness";
import { withRequest } from "./platform/request-scope";

const ROOT = process.cwd();
const testDbName = disposableName("po03d_seatpaths");
process.env.DATABASE_URL = databaseUrlFor(testDbName);
process.env.PLATFORM_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.FIELD_ENCRYPTION_KEYS = `1:${randomBytes(32).toString("base64")}`;
process.env.PLATFORM_CONSOLE_ENABLED = "true";
process.env.PLATFORM_USER_INVITATIONS_ENABLED = "true";
process.env.CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED = "true";
process.env.CUSTOMER_SEAT_ENFORCEMENT_ENABLED = "true";
process.env.PLATFORM_TRUSTED_PROXY_HOPS = "1";
const CUSTOMER_ORIGIN = "https://customer.erp.test";
process.env.CUSTOMER_PUBLIC_ORIGIN = CUSTOMER_ORIGIN;
delete process.env.PLATFORM_INVITATIONS_ENABLED;
delete process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED;
delete process.env.CUSTOMER_LEGACY_TOKENS;

let created = false;
await createPlatformTestDatabase("po03d_seatpaths", testDbName);
created = true;
{
  const { runSeed } = await import("../scripts/platform/trial-seed");
  const seeded = await runSeed(process.env.DATABASE_URL);
  if (seeded.check.state !== "complete") throw new Error(`the Trial seed did not complete: ${seeded.check.state}`);
}
{
  const c = await connectDisposable(process.env.DATABASE_URL!);
  try {
    await c.query(readFileSync(join(ROOT, "drizzle/platform/PO03C_user_invitations.sql"), "utf8"));
  } finally {
    await c.end();
  }
}

const { db, pool, platformAdminsTable } = await import("../src/db");
const auth = await import("../src/lib/platform/auth");
const mfa = await import("../src/lib/platform/mfa");
const totp = await import("../src/lib/platform/totp");
const { platformClock } = await import("../src/lib/platform/clock");
const console_ = await import("../src/lib/platform/console");
const actions = await import("../src/lib/platform/user-invitation-actions");
const seatAccounting = await import("../src/lib/platform/seat-accounting");
const bridge = await import("../src/lib/onboarding/user-invitation-acceptance");
const memberAdd = await import("../src/lib/team/member-add");
const gate = await import("../src/lib/team/ownership-gate");
(pool as unknown as { options: { max: number } }).options.max = 40;
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
let seq = 0;
const tag = () => `${Date.now().toString(36)}${++seq}`;

let nowMs = Math.floor(Date.now() / 1000) * 1000;
platformClock.now = () => new Date(nowMs);
const nextStep = () => {
  nowMs = (totp.totpStepAt(new Date(nowMs)) + 1) * 30_000 + 1_000;
};
const CONSOLE_HOST = "console.erp.test";
const consoleHeaders = (ip: string) => new Headers({ host: CONSOLE_HOST, origin: `https://${CONSOLE_HOST}`, "sec-fetch-site": "same-origin", "user-agent": "verify-platform-seat-paths", "x-forwarded-for": ip });
const OPERATOR_IP = "203.0.113.81";
let customerIpSeq = 0;
const customerHeaders = () => {
  customerIpSeq += 1;
  return { host: "customer.erp.test", origin: CUSTOMER_ORIGIN, "sec-fetch-site": "same-origin", "user-agent": "verify-platform-seat-paths", "x-forwarded-for": `10.40.${Math.floor(customerIpSeq / 250)}.${(customerIpSeq % 250) + 1}` };
};

const STRONG = "Saffron-Lattice-58!q";
const MEMBER_PASSWORD = "Juniper-Ledger-27!m";
const secretsSeen: string[] = [STRONG, MEMBER_PASSWORD];
type Admin = { id: string; email: string; secret: string; token: string };
const codeFor = (a: Admin) => totp.hotpCode(a.secret, totp.totpStepAt(new Date(nowMs)));
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
  const r = await console_.signInCore({ email, password: STRONG, totpCode: codeFor(a) }, { headers: consoleHeaders(OPERATOR_IP) });
  if (!r.ok) throw new Error(`fixture sign-in failed: ${r.code}`);
  secretsSeen.push(r.token);
  a.token = r.token;
  nextStep();
  return a;
}
const req = (a: Admin) => ({ headers: consoleHeaders(OPERATOR_IP), token: a.token });
type Outcome = { ok: true } | { ok: false; code: string };
const codeOf = (o: Outcome) => (o.ok ? "OK" : o.code);
/** Start a create at the CURRENT step (call nextStep() first when several run at once — each admin has its own counter). */
const startCreate = (a: Admin, orgId: number, email: string, role = "staff") => actions.createUserInvitation(req(a), { orgId: String(orgId), name: "Fixture Invitee", email, role, password: STRONG, totpCode: codeFor(a) });
async function create(a: Admin, orgId: number, email: string, role = "staff") {
  nextStep();
  return startCreate(a, orgId, email, role);
}
async function reissue(a: Admin, invitationId: string) {
  nextStep();
  return actions.reissueUserInvitation(req(a), { invitationId, password: STRONG, totpCode: codeFor(a) });
}
async function revoke(a: Admin, invitationId: string) {
  nextStep();
  return actions.revokeUserInvitation(req(a), { invitationId, reason: "Fixture: withdrawn to free a seat for the test", totpCode: codeFor(a) });
}
/** An open invitation written directly (a fixture whose window may lie partly in the past); returns its id. */
async function directInvitation(orgId: number, email: string, adminId: string, createdAgoMs: number, ttlMs = 72 * 3_600_000) {
  const createdAt = new Date(nowMs - createdAgoMs);
  return (await one<{ id: string }>(
    `insert into user_invitations (org_id, name, email_normalized, requested_role, token_hash, expires_at, invited_by_platform_admin_id, created_at) values ($1, 'Fixture Invitee', $2, 'staff', $3, $4, $5, $6) returning id`,
    [orgId, email, sha256(randomBytes(32).toString("base64url")), new Date(createdAt.getTime() + ttlMs), adminId, createdAt],
  ))!.id;
}
const tokenOf = (link: string) => {
  const m = /#t=([A-Za-z0-9_-]{43})$/.exec(link);
  if (!m) throw new Error("no token in the link");
  secretsSeen.push(m[1]);
  return m[1];
};
const accept = (token: string, name = "Fixture Joiner") => withRequest(customerHeaders(), () => bridge.acceptJoinLink({ token, name, password: MEMBER_PASSWORD, confirm: MEMBER_PASSWORD }));
const reasonOf = (r: { ok: boolean; reason?: string }) => (r.ok ? "OK" : (r.reason ?? "?"));

const bcryptPad = (stem: string) => "$2b$10$" + (stem + "Q".repeat(53)).slice(0, 53);
const HASH = bcryptPad("SeatPathsFixtureHash");
type Member = { id: number; orgId: number; email: string; name: string; role: "owner" | "admin" | "staff" };
async function newOrg(name = `Seat Path Fixture ${tag()}`): Promise<number> {
  return Number((await one<{ id: number }>(`insert into orgs (name, country, currency) values ($1, 'Saudi Arabia', 'SAR') returning id`, [name]))!.id);
}
async function newUser(orgId: number, role: Member["role"], email = `${role}.${tag()}@seatpath-fixture.test`, active = true): Promise<Member> {
  const name = `Fixture ${role} ${tag()}`;
  const id = Number((await one<{ id: number }>(`insert into users (org_id, email, password_hash, name, role, is_active) values ($1, $2, $3, $4, $5, $6) returning id`, [orgId, email, HASH, name, role, active]))!.id);
  return { id, orgId, email, name, role };
}
const trialV1 = (await one<{ id: string }>(`select v.id from subscription_package_versions v join subscription_packages p on p.id = v.package_id where p.is_default_trial and v.version_number = 1`))!.id;
const NEW_CURRENT_SQL = `insert into tenant_subscriptions (org_id, package_version_id, version_state, is_trial, cycle, lifecycle_state, start_date, end_date, price_snapshot_sar, seats_snapshot, storage_snapshot_gb, module_groups_snapshot, assignment_source)
  values ($1, $2, 'published', true, 'trial', 'trialing', current_date, current_date + 13, 0, $3, 5, '[]'::jsonb, 'invitation_acceptance')`;
const SUPERSEDE_SQL = `update tenant_subscriptions set superseded_at = now(), updated_at = now() where org_id = $1 and superseded_at is null`;
const subscribe = (orgId: number, seats: number) => q(NEW_CURRENT_SQL, [orgId, trialV1, seats]);
/** A company with an owner (the Team actor), `others` more users, and a subscription of `seats` (null: none). */
async function company(seats: number | null, others = 0, label = "Seat Path Fixture") {
  const orgId = await newOrg(`${label} ${tag()}`);
  const owner = await newUser(orgId, "owner");
  for (let i = 0; i < others; i++) await newUser(orgId, "staff");
  if (seats !== null) await subscribe(orgId, seats);
  return { orgId, owner };
}
const sessionOf = (m: Member) => ({ userId: m.id, orgId: m.orgId, name: m.name, email: m.email, role: m.role, isActive: true }) as unknown as Parameters<typeof memberAdd.addTeamMember>[0];
const teamAdd = (actor: Member, email: string, role = "staff", name = "Fixture Member") =>
  withRequest(customerHeaders(), () => memberAdd.addTeamMember(sessionOf(actor), { name, email, password: MEMBER_PASSWORD, role }, "en"));
const usersIn = (orgId: number) => n(`select count(*)::int as n from users where org_id = $1`, [orgId]);
const usersWith = (email: string) => n(`select count(*)::int as n from users where lower(email) = lower($1)`, [email]);
const openInvitations = (orgId: number) => n(`select count(*)::int as n from user_invitations where org_id = $1 and accepted_at is null and revoked_at is null and expires_at > $2`, [orgId, new Date(nowMs)]);
const occupied = async (orgId: number) => (await seatAccounting.readSeatAccounting(db, orgId, new Date(nowMs), true)).occupied;
const rejectedStage = async (entityAction: string) => (await one<{ s: string }>(`select after_safe->>'stage' as s from platform_audit_events where action = $1 order by id desc limit 1`, [entityAction]))?.s;
const SEAT_LIMIT_MSG = "This company has reached its user limit. Nothing was changed. Free a seat, or ask your Elite ERP contact about more seats.";

// ---- barriers ------------------------------------------------------------------------------------------------------
type Blocker = { client: pg.Client; release: (commit?: boolean) => Promise<void> };
async function blocker(statements: { text: string; values?: unknown[] }[]): Promise<Blocker> {
  const client: pg.Client = await connectDisposable(process.env.DATABASE_URL!);
  client.on("error", () => undefined);
  await client.query("begin");
  for (const s of statements) await client.query(s.text, s.values ?? []);
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
const ORG_LOCK = /from "orgs"[\s\S]*for no key update/i;
const orgRow = (orgId: number) => ({ text: `select id from orgs where id = $1 for no key update`, values: [orgId] });
async function tenantChecksum(orgIds: number[]): Promise<string> {
  const rows = await q<{ t: string }>(
    `select md5(string_agg(x, '|' order by x)) as t from (
       select 'u:' || id || ':' || org_id || ':' || email || ':' || role || ':' || is_active || ':' || updated_at::text as x from users where org_id = any($1)
       union all select 'i:' || id || ':' || coalesce(accepted_at::text, '') || ':' || coalesce(revoked_at::text, '') from user_invitations where org_id = any($1)
       union all select 's:' || id || ':' || seats_snapshot || ':' || coalesce(superseded_at::text, '') from tenant_subscriptions where org_id = any($1)
     ) z`,
    [orgIds],
  );
  return rows[0]?.t ?? "";
}

async function main() {
  const operator = await createAdmin("operator.seatpaths@platform-fixture.test", "Fixture Operator");
  const second = await createAdmin("second.seatpaths@platform-fixture.test", "Fixture Second Operator");
  const bystander = await company(5, 2, "Seat Path Bystander");
  const bystanderBefore = await tenantChecksum([bystander.orgId]);

  // ===================================================================================================================
  section("E. Each path, with enforcement on (CUSTOMER_SEAT_ENFORCEMENT_ENABLED=true)");
  {
    // A company at 2 of 3 (owner + 1): exactly one more seat.
    const c = await company(3, 1);
    const first = await create(operator, c.orgId, `first.${tag()}@seatpath-fixture.test`);
    const stepBefore = Number((await one<{ s: string | null }>("select mfa_last_totp_step::text as s from platform_admins where id = $1", [operator.id]))?.s ?? -1);
    const full = await create(operator, c.orgId, `full.${tag()}@seatpath-fixture.test`);
    const stepAfter = Number((await one<{ s: string | null }>("select mfa_last_totp_step::text as s from platform_admins where id = $1", [operator.id]))?.s ?? -1);
    ok("E1 (§13 cases 16, 17) create: 2 of 3 occupied allows exactly one more invitation (3 of 3, the reservation counted); the next is SEAT_LIMIT, refused by the read-only pre-check — no second-factor code spent, nothing written, audited (seat_limit)",
      first.ok && codeOf(full) === "SEAT_LIMIT" && stepAfter === stepBefore && (await openInvitations(c.orgId)) === 1 && (await occupied(c.orgId)) === 3 && (await rejectedStage("user_invitation.create.rejected")) === "seat_limit",
      `${codeOf(first)} ${codeOf(full)}`);
    const createdAudit = first.ok ? await one<{ seats: { enforced?: boolean; seats?: number; occupied?: number } }>(`select after_safe->'seats' as seats from platform_audit_events where entity_id = $1 and action = 'user_invitation.created'`, [first.id]) : null;
    ok("E2 the created invitation's audit records the enforced seat decision (counts only)", createdAudit?.seats?.enforced === true && createdAudit.seats.seats === 3 && createdAudit.seats.occupied === 3, JSON.stringify(createdAudit));
    const preview = await actions.previewUserInvitation(req(operator), { orgId: String(c.orgId), name: "Preview Person", email: `preview.${tag()}@seatpath-fixture.test`, role: "staff" });
    ok("E3 the create preview says why it would be refused (SEAT_LIMIT) and that the company's seats are enforced — before any code is asked for", preview.ok && preview.seatRefusal === "SEAT_LIMIT" && preview.seats?.enforced === true, JSON.stringify(preview.ok ? { r: preview.seatRefusal, e: preview.seats?.enforced } : preview));
    // Re-issue in the full company: a PENDING source replaces its own reservation (net 0); an EXPIRED one needs a seat.
    const re = first.ok ? await reissue(operator, first.id) : ({ ok: false, code: "fixture" } as const);
    ok("E4 re-issue of a PENDING invitation in a full company works (its own reservation is replaced — still 3 of 3)", re.ok && (await occupied(c.orgId)) === 3 && (await openInvitations(c.orgId)) === 1, codeOf(re));
    // Expiry frees a seat at the boundary (§13 case 13): a reservation that ends 90 s from now, in a second company at
    // 3 of 3. (The clock moves by minutes only — the operators' sessions stay valid.)
    const c5 = await company(3, 1);
    const soon = await directInvitation(c5.orgId, `soon.${tag()}@seatpath-fixture.test`, operator.id, 72 * 3_600_000 - 90_000);
    const beforeExpiry = await occupied(c5.orgId);
    const refusedBefore = await create(operator, c5.orgId, `wait.${tag()}@seatpath-fixture.test`);
    nowMs += 120_000; // the reservation has ended
    const afterExpiry = await occupied(c5.orgId);
    const third = await create(operator, c5.orgId, `third.${tag()}@seatpath-fixture.test`);
    const reExpired = await reissue(operator, soon);
    ok("E5 (§13 case 13) an invitation frees its seat at its expiry: refused while the reservation lasts (3 of 3), the freed seat is taken by a new invitation after it; re-issuing the EXPIRED one then needs a seat of its own and is refused (SEAT_LIMIT)",
      beforeExpiry === 3 && codeOf(refusedBefore) === "SEAT_LIMIT" && afterExpiry === 2 && third.ok && codeOf(reExpired) === "SEAT_LIMIT" && (await rejectedStage("user_invitation.reissue.rejected")) === "seat_limit",
      `${beforeExpiry} ${codeOf(refusedBefore)} ${afterExpiry} ${codeOf(third)} ${codeOf(reExpired)}`);
    // Revoke frees a seat immediately (§13 case 12).
    const rv = third.ok ? await revoke(operator, third.id) : ({ ok: false, code: "fixture" } as const);
    const afterRevoke = await occupied(c5.orgId);
    const fourth = await create(operator, c5.orgId, `fourth.${tag()}@seatpath-fixture.test`);
    ok("E6 (§13 case 12) a revoked invitation frees its seat at once: after the revocation the next invitation fits", rv.ok && afterRevoke === 2 && fourth.ok, `${codeOf(rv)} ${afterRevoke} ${codeOf(fourth)}`);

    // Team add: 2 of 3 → one more member; at 3 of 3 refused, with ONE security event committed and no user.
    const t = await company(3, 1);
    const added = await teamAdd(t.owner, `member.${tag()}@seatpath-fixture.test`);
    const eventsBefore = await n(`select count(*)::int as n from security_events where org_id = $1 and type = 'team.member_add_refused'`, [t.orgId]);
    const refusedEmail = `refused.${tag()}@seatpath-fixture.test`;
    const refused = await teamAdd(t.owner, refusedEmail);
    const refusalEvents = await q<{ detail: string; severity: string; user_id: number }>(`select detail, severity, user_id from security_events where org_id = $1 and type = 'team.member_add_refused'`, [t.orgId]);
    ok("E7 Team add: 2 of 3 occupied takes exactly one more member; the next is refused with the localized limit message, no user is created, and exactly ONE customer security event (team.member_add_refused, seat_limit) is committed",
      !added.error && refused.error === SEAT_LIMIT_MSG && (await usersIn(t.orgId)) === 3 && (await usersWith(refusedEmail)) === 0 && eventsBefore === 0 && refusalEvents.length === 1 && refusalEvents[0].detail === "seat_limit" && refusalEvents[0].user_id === t.owner.id,
      `${added.error ?? "OK"} / ${refused.error ?? "OK"} / ${refusalEvents.length}`);
    const ar = await withRequest(customerHeaders(), () => memberAdd.addTeamMember(sessionOf(t.owner), { name: "X", email: `ar.${tag()}@seatpath-fixture.test`, password: MEMBER_PASSWORD, role: "staff" }, "ar"));
    ok("E8 the limit message is Saudi Arabic in Arabic", ar.error === "بلغت هذه الشركة حد المستخدمين، ولم يتغيّر شيء. حرّر مقعدًا، أو تواصل مع جهة الاتصال لديك في Elite ERP بشأن مقاعد إضافية.", ar.error);
    const memberRow = await one<{ xmin: string; id: number }>(`select xmin::text as xmin, id from users where org_id = $1 and email like 'member.%'`, [t.orgId]);
    const activity = await one<{ xmin: string }>(`select xmin::text as xmin from activity_logs where entity_id = $1 and type = 'team.member-added'`, [memberRow!.id]);
    ok("E9 the added member and its activity record share ONE transaction (one xmin) — the activity is no longer written after the fact", !!memberRow && memberRow.xmin === activity?.xmin);

    // Disabled users keep their seat (§13 case 14): owner + 1 active + 1 disabled = 3 of 3.
    const d = await company(3, 1);
    await newUser(d.orgId, "staff", `disabled.${tag()}@seatpath-fixture.test`, false);
    const dAdd = await teamAdd(d.owner, `nope.${tag()}@seatpath-fixture.test`);
    const dCreate = await create(operator, d.orgId, `nope.inv.${tag()}@seatpath-fixture.test`);
    ok("E10 (§13 case 14) a disabled user keeps a seat: owner + active + disabled = 3 of 3 refuses a Team add and an invitation", dAdd.error === SEAT_LIMIT_MSG && codeOf(dCreate) === "SEAT_LIMIT" && (await usersIn(d.orgId)) === 3);

    // Over the limit (§13 case 15): 4 users on a 3-seat plan (e.g. after a downgrade) keep their accounts, get nothing new.
    const o = await company(3, 3);
    const oBefore = await tenantChecksum([o.orgId]);
    const oAdd = await teamAdd(o.owner, `over.${tag()}@seatpath-fixture.test`);
    const oCreate = await create(operator, o.orgId, `over.inv.${tag()}@seatpath-fixture.test`);
    ok("E11 (§13 case 15) a company above its allowance (4 of 3) keeps every user unchanged but gets no new member and no invitation",
      oAdd.error === SEAT_LIMIT_MSG && codeOf(oCreate) === "SEAT_LIMIT" && (await usersIn(o.orgId)) === 4 && (await tenantChecksum([o.orgId])) === oBefore);

    // No subscription: the Team keeps the legacy rule; user invitations need a subscription.
    const l = await company(null, 4);
    const lAdd = await teamAdd(l.owner, `legacy.${tag()}@seatpath-fixture.test`);
    const lCreate = await create(operator, l.orgId, `legacy.inv.${tag()}@seatpath-fixture.test`);
    ok("E12 a company without a subscription: the Team adds members as before (legacy), but no user invitation is created (SUBSCRIPTION_REQUIRED — never read as unlimited)",
      !lAdd.error && codeOf(lCreate) === "SUBSCRIPTION_REQUIRED" && (await usersIn(l.orgId)) === 6 && (await rejectedStage("user_invitation.create.rejected")) === "no_subscription");

    // Acceptance converts its own reservation (§13 case 18 is in verify:platform-user-acceptance R5); here: a full
    // company's pending invitation is accepted (3 of 3 stays 3 of 3), then nothing more fits.
    const a = await company(3, 1);
    const inv = await create(operator, a.orgId, `joiner.${tag()}@seatpath-fixture.test`);
    const joined = inv.ok ? await accept(tokenOf(inv.link)) : { ok: false as const, reason: "fixture" };
    const aAdd = await teamAdd(a.owner, `after.join.${tag()}@seatpath-fixture.test`);
    ok("E13 acceptance turns the reserved seat into the user (3 of 3 before and after); the company is then full for the Team as well", reasonOf(joined) === "OK" && (await usersIn(a.orgId)) === 3 && (await occupied(a.orgId)) === 3 && aAdd.error === SEAT_LIMIT_MSG, `${reasonOf(joined)} ${aAdd.error}`);
  }

  // ===================================================================================================================
  section("D. What the displays are told");
  {
    const c = await company(3, 1);
    await create(operator, c.orgId, `display.${tag()}@seatpath-fixture.test`);
    const summary = await gate.readTeamOwnershipSummary(c.orgId);
    const l = await company(null, 1);
    const legacySummary = await gate.readTeamOwnershipSummary(l.orgId);
    ok("D1 the Team summary: 2 users + 1 pending invitation = 3 of 3 occupied, enforced (a subscription and the switch on); a company without a subscription is NEVER shown as enforced",
      summary.seats.available && summary.seats.users.total === 2 && summary.seats.pending === 1 && summary.seats.occupied === 3 && summary.seats.enforced === true && summary.seats.remaining === 0 &&
        legacySummary.seats.available && legacySummary.seats.enforced === false,
      JSON.stringify(summary.seats));
    process.env.CUSTOMER_SEAT_ENFORCEMENT_ENABLED = "false";
    const offSummary = await gate.readTeamOwnershipSummary(c.orgId);
    process.env.CUSTOMER_SEAT_ENFORCEMENT_ENABLED = "true";
    ok("D2 with the switch off the same company is shown, not enforced", offSummary.seats.available && offSummary.seats.enforced === false && offSummary.seats.occupied === 3);
  }

  // ===================================================================================================================
  section("N. Switched off (the default): every path as before PO-03D");
  {
    process.env.CUSTOMER_SEAT_ENFORCEMENT_ENABLED = "";
    const c = await company(1, 2); // already 3 of 1
    const cr = await create(operator, c.orgId, `off.${tag()}@seatpath-fixture.test`);
    const ad = await teamAdd(c.owner, `off.member.${tag()}@seatpath-fixture.test`);
    const ac = cr.ok ? await accept(tokenOf(cr.link)) : { ok: false as const, reason: "fixture" };
    const l = await company(null, 0);
    const lc = await create(operator, l.orgId, `off.legacy.${tag()}@seatpath-fixture.test`);
    const re = lc.ok ? await reissue(operator, lc.id) : ({ ok: false, code: "fixture" } as const);
    process.env.CUSTOMER_SEAT_ENFORCEMENT_ENABLED = "true";
    ok("N1 (§13 case 24) enforcement off: an invitation, a Team add and an acceptance all go through above the allowance, and a company without a subscription can be invited into and re-issued — exactly the PO-03C behaviour",
      cr.ok && !ad.error && reasonOf(ac) === "OK" && lc.ok && re.ok && (await usersIn(c.orgId)) === 5, `${codeOf(cr)} ${ad.error ?? "OK"} ${reasonOf(ac)} ${codeOf(lc)} ${codeOf(re)}`);
  }

  // ===================================================================================================================
  section("K. Races on the last seat (deterministic barriers on the company row)");
  {
    // §13 case 8 — two creates (two operators, two e-mails) for the last seat.
    const k8 = await company(3, 1);
    const hold8 = await blocker([orgRow(k8.orgId)]);
    nextStep();
    const c1 = startCreate(operator, k8.orgId, `race8a.${tag()}@seatpath-fixture.test`);
    const c2 = startCreate(second, k8.orgId, `race8b.${tag()}@seatpath-fixture.test`);
    const waits8 = await until(async () => (await lockWaiters(ORG_LOCK)) === 2);
    await hold8.release();
    const r8 = [codeOf(await c1), codeOf(await c2)].sort();
    ok("K8 (§13 case 8) two invitations for the last seat at once: both queue on the company row; exactly one is created, the other is SEAT_LIMIT — 3 of 3, never 4", waits8 && JSON.stringify(r8) === '["OK","SEAT_LIMIT"]' && (await occupied(k8.orgId)) === 3, r8.join(","));

    // §13 case 9 — two Team adds for the last seat.
    const k9 = await company(3, 1);
    const hold9 = await blocker([orgRow(k9.orgId)]);
    const a1 = teamAdd(k9.owner, `race9a.${tag()}@seatpath-fixture.test`);
    const a2 = teamAdd(k9.owner, `race9b.${tag()}@seatpath-fixture.test`);
    const waits9 = await until(async () => (await lockWaiters(ORG_LOCK)) === 2);
    await hold9.release();
    const r9 = [(await a1).error ?? "OK", (await a2).error ?? "OK"].sort();
    ok("K9 (§13 case 9) two Team adds for the last seat at once: both queue on the company row; exactly one member is added, the other is refused at the limit", waits9 && r9.includes("OK") && r9.includes(SEAT_LIMIT_MSG) && (await usersIn(k9.orgId)) === 3, r9.join(" | "));

    // §13 case 10 — an invitation and a Team add for the last seat.
    const k10 = await company(3, 1);
    const hold10 = await blocker([orgRow(k10.orgId)]);
    nextStep();
    const p10c = startCreate(operator, k10.orgId, `race10.inv.${tag()}@seatpath-fixture.test`);
    const p10a = teamAdd(k10.owner, `race10.member.${tag()}@seatpath-fixture.test`);
    const waits10 = await until(async () => (await lockWaiters(ORG_LOCK)) === 2);
    await hold10.release();
    const r10c = codeOf(await p10c);
    const r10a = (await p10a).error ?? "OK";
    ok("K10 (§13 case 10) an invitation and a Team add for the last seat at once: exactly one of them takes it; the other is refused — 3 of 3",
      waits10 && ((r10c === "OK" && r10a === SEAT_LIMIT_MSG) || (r10c === "SEAT_LIMIT" && r10a === "OK")) && (await occupied(k10.orgId)) === 3, `${r10c} | ${r10a}`);

    // §13 case 7 — an acceptance and a Team add of the SAME e-mail: one account, whichever queues first.
    const k7 = await company(5, 0);
    const email7 = `same.email.${tag()}@seatpath-fixture.test`;
    const inv7 = await create(operator, k7.orgId, email7);
    const token7 = inv7.ok ? tokenOf(inv7.link) : "";
    const hold7 = await blocker([{ text: `select pg_advisory_xact_lock(hashtextextended('platform-invitation-email:' || $1, 0))`, values: [email7] }]);
    const p7a = accept(token7);
    const p7t = teamAdd(k7.owner, email7);
    const waits7 = await until(async () => (await lockWaiters(EMAIL_LOCK)) === 2);
    await hold7.release();
    const r7a = reasonOf(await p7a);
    const r7t = (await p7t).error ?? "OK";
    ok("K7 (§13 case 7) an acceptance and a Team add of the same e-mail at once: both queue on the SAME e-mail lock; exactly one account exists — the other answers neutrally (`unavailable`) or 'already exists'",
      waits7 && (await usersWith(email7)) === 1 && ((r7a === "OK" && r7t === "A user with this email already exists.") || (r7a === "unavailable" && r7t === "OK")), `${r7a} | ${r7t}`);

    // §13 case 11 — re-issue vs acceptance in a full company: never more than the allowance.
    // 3 users on a 4-seat plan + one pending invitation = 4 of 4: the company is full with the reservation counted.
    const k11 = await company(4, 2);
    const inv11 = await create(operator, k11.orgId, `race11.${tag()}@seatpath-fixture.test`);
    const token11 = inv11.ok ? tokenOf(inv11.link) : "";
    const email11 = inv11.ok ? (await one<{ e: string }>(`select email_normalized as e from user_invitations where id = $1`, [inv11.id]))!.e : "";
    const hold11 = await blocker([{ text: `select pg_advisory_xact_lock(hashtextextended('platform-invitation-email:' || $1, 0))`, values: [email11] }]);
    nextStep();
    const p11r = inv11.ok ? actions.reissueUserInvitation(req(operator), { invitationId: inv11.id, password: STRONG, totpCode: codeFor(operator) }) : Promise.resolve({ ok: false as const, code: "fixture" });
    const p11a = accept(token11);
    const waits11 = await until(async () => (await lockWaiters(EMAIL_LOCK)) === 2);
    await hold11.release();
    const r11r = codeOf(await p11r);
    const r11a = reasonOf(await p11a);
    // When the acceptance wins, the re-issue's own re-checks under the e-mail lock refuse it — first the e-mail (now a
    // user's: EMAIL_CONFLICT), else the invitation row (accepted: INVITE_USED); nothing is written either way.
    ok("K11 (§13 case 11) a re-issue and an acceptance of the same invitation in a full company: they queue on its e-mail lock; either the acceptance wins (the re-issue is refused: EMAIL_CONFLICT / INVITE_USED) or the re-issue wins (the old link: invalid) — never above 4 of 4, never a second open invitation",
      waits11 && ((r11a === "OK" && (r11r === "EMAIL_CONFLICT" || r11r === "INVITE_USED")) || (r11a === "invalid" && r11r === "OK")) && (await occupied(k11.orgId)) === 4 &&
        (await n(`select count(*)::int as n from user_invitations where org_id = $1 and accepted_at is null and revoked_at is null`, [k11.orgId])) === (r11a === "OK" ? 0 : 1),
      `${r11r} | ${r11a}`);

    // §13 case 19 — the subscription changes while an allocation waits: decided on the allowance as committed.
    const k19 = await company(5, 2);
    const writer = await blocker([orgRow(k19.orgId), { text: SUPERSEDE_SQL, values: [k19.orgId] }, { text: NEW_CURRENT_SQL, values: [k19.orgId, trialV1, 3] }]);
    const p19 = teamAdd(k19.owner, `race19.down.${tag()}@seatpath-fixture.test`);
    const waits19 = await until(async () => (await lockWaiters(ORG_LOCK)) === 1);
    await writer.release(true);
    const r19 = (await p19).error ?? "OK";
    const writerUp = await blocker([orgRow(k19.orgId), { text: SUPERSEDE_SQL, values: [k19.orgId] }, { text: NEW_CURRENT_SQL, values: [k19.orgId, trialV1, 6] }]);
    const p19b = teamAdd(k19.owner, `race19.up.${tag()}@seatpath-fixture.test`);
    const waits19b = await until(async () => (await lockWaiters(ORG_LOCK)) === 1);
    await writerUp.release(true);
    const r19b = (await p19b).error ?? "OK";
    ok("K19 (§13 case 19) a subscription change (taking the company row first — the documented contract) while a Team add waits: a downgrade to 3 seats committed first refuses the 4th member; an upgrade to 6 committed first lets it in",
      waits19 && r19 === SEAT_LIMIT_MSG && waits19b && r19b === "OK" && (await usersIn(k19.orgId)) === 4, `${r19} | ${r19b}`);

    // §13 case 23 (the Team path) — a lock held longer than the bound: the add answers "busy" and writes nothing.
    const k23 = await company(5, 0);
    const long = await blocker([orgRow(k23.orgId)]);
    const t0 = Date.now();
    const r23 = await teamAdd(k23.owner, `race23.${tag()}@seatpath-fixture.test`);
    const waited = Date.now() - t0;
    await long.release();
    ok("K23 (§13 case 23) a company row held beyond the 5 s bound: the Team add answers the localized 'busy' message after ~5 s and writes nothing (no user, no activity)",
      r23.error === "Another change to this team is in progress. Try again in a moment." && waited >= 4_500 && (await usersIn(k23.orgId)) === 1, `${r23.error} ${waited}ms`);

    // §13 case 21 (the Team path) — mixed case: an account in another letter case refuses the add.
    const k21 = await company(5, 0);
    const mixed = `Mixed.Case.${tag()}@SeatPath-Fixture.test`;
    const elsewhere = await company(5, 0, "Seat Path Elsewhere");
    await q(`insert into users (org_id, email, password_hash, name, role) values ($1, $2, $3, 'Fixture External', 'staff')`, [elsewhere.orgId, mixed, HASH]);
    const r21 = await teamAdd(k21.owner, mixed.toLowerCase());
    ok("K21 (§13 case 21, the Team path) an account whose e-mail differs only in letter case refuses the add ('already exists'); nothing is created", r21.error === "A user with this email already exists." && (await usersWith(mixed)) === 1);
  }

  // ===================================================================================================================
  section("Z. A missing or malformed foundation is never 'unlimited' (§13 case 25, the Team and create paths)");
  {
    const c = await company(5, 0);
    await q(`alter table tenant_subscriptions rename to tenant_subscriptions_po03d_away`);
    const zAdd = await teamAdd(c.owner, `z.${tag()}@seatpath-fixture.test`);
    const zCreate = await create(operator, c.orgId, `z.inv.${tag()}@seatpath-fixture.test`);
    process.env.CUSTOMER_SEAT_ENFORCEMENT_ENABLED = "";
    const zOff = await teamAdd(c.owner, `z.off.${tag()}@seatpath-fixture.test`);
    process.env.CUSTOMER_SEAT_ENFORCEMENT_ENABLED = "true";
    await q(`alter table tenant_subscriptions_po03d_away rename to tenant_subscriptions`);
    ok("Z1 subscription records missing, enforcement on: the Team add answers 'can't be checked' and the invitation SEAT_ENFORCEMENT_UNAVAILABLE — nothing created; enforcement off: the Team works as before",
      zAdd.error === "User limits can't be checked right now. Nothing was changed. Try again later." && codeOf(zCreate) === "SEAT_ENFORCEMENT_UNAVAILABLE" && !zOff.error && (await usersIn(c.orgId)) === 2, `${zAdd.error} | ${codeOf(zCreate)} | ${zOff.error ?? "OK"}`);
  }

  // ===================================================================================================================
  section("X. No other tenant changed; nothing secret printed");
  {
    ok("X1 the bystander company's users, invitations and subscription are byte-identical", (await tenantChecksum([bystander.orgId])) === bystanderBefore);
    const out = logged.join("\n");
    ok("X2 no password, TOTP secret, recovery code, platform token or invitation token appears in any console line", !secretsSeen.some((s) => s.length >= 6 && out.includes(s)));
    const audits = JSON.stringify(await q(`select reason, before_safe, after_safe, actor_label from platform_audit_events`));
    ok("X3 no secret and no invitation token appears in any platform audit record", !secretsSeen.some((s) => s.length >= 6 && audits.includes(s)) && !secretsSeen.some((s) => audits.includes(sha256(s))));
  }
}

let crashed = false;
try {
  await main();
} catch (e) {
  crashed = true;
  ok("the suite ran to completion", false, describeError(e));
} finally {
  await pool.end().catch(() => undefined);
  if (created) await dropDisposableDatabase(testDbName).catch(() => undefined);
}
summary("verify:platform-seat-paths");
if (crashed) process.exitCode = 1;
