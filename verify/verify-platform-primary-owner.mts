/**
 * Platform Owner PO-03A — primary-owner protection (decision O-3) on real PostgreSQL: the Team-change service
 * (src/lib/team/member-changes.ts), its ownership gate (src/lib/team/ownership-gate.ts) and the platform mapping core
 * (src/lib/platform/primary-owners.ts), with deterministic lock barriers on independent connections.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://…/<admin db with _test_only_> npm run verify:platform-primary-owner
 *
 * One disposable database (dropped at the end): the reviewed schema, the reviewed platform SQL (guard triggers) and the
 * PO-02D1B Trial seed. Fictional companies: one created by the REAL PO-02D3 acceptance path (its owner is mapped) and
 * several legacy-shaped ones (no mapping, no subscription — decision O-2). Every barrier is observed waiting in
 * pg_stat_activity before it is released, so each race runs in a known interleaving. TEST-ONLY secrets are generated in
 * memory and never printed.
 *
 * Categories (docs/platform-owner/PO03A_DEVELOPMENT.md §J): A mapped owner cannot be demoted · B … disabled · C … deleted
 * or moved · D cross-company ids · E role restrictions preserved · F last active owner preserved · G concurrency
 * (simultaneous demotions, deactivation vs role change, mapping vs deactivation, recently accepted company, stale page,
 * removing every owner, interruption, lock timeout, audit failure, sign-in and suspension locks) · H acceptance-created
 * owner · I legacy companies unchanged · J no automatic backfill · K lock order · L staged rollout (fail closed) ·
 * M localized messages · N inventory.
 */
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import bcrypt from "bcryptjs";
import pg from "pg";
import { connectDisposable, createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { describeError, ok, section, summary } from "./platform/harness";
import { withRequest } from "./platform/request-scope";

const ROOT = process.cwd();
const testDbName = disposableName("po03a_owner");
process.env.DATABASE_URL = databaseUrlFor(testDbName);
process.env.PLATFORM_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.FIELD_ENCRYPTION_KEYS = `1:${randomBytes(32).toString("base64")}`;
delete process.env.PLATFORM_CONSOLE_ENABLED;
delete process.env.PLATFORM_INVITATIONS_ENABLED;
// The real acceptance path creates the mapped company (H); acceptance is a feature that creates mappings, so while it
// is on, a missing mapping table must fail closed (L).
process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED = "true";
process.env.PLATFORM_TRUSTED_PROXY_HOPS = "1";
const ORIGIN = "https://customer.erp.test";
process.env.CUSTOMER_PUBLIC_ORIGIN = ORIGIN;
delete process.env.PLATFORM_INVITATIONS_LOOPBACK_ORIGIN;

let created = false;
await createPlatformTestDatabase("po03a_owner", testDbName);
created = true;
{
  const { runSeed } = await import("../scripts/platform/trial-seed");
  const seeded = await runSeed(process.env.DATABASE_URL);
  if (seeded.check.state !== "complete") throw new Error(`the Trial seed did not complete: ${seeded.check.state}`);
}

const { pool } = await import("../src/db");
const changes = await import("../src/lib/team/member-changes");
const gate = await import("../src/lib/team/ownership-gate");
const invitations = await import("../src/lib/platform/invitations");
const orchestrator = await import("../src/lib/onboarding/invitation-acceptance");
const { lockOrgAccessForSessionIssue } = await import("../src/lib/security/tenant-access-gate");
const { t } = await import("../src/lib/i18n/dict");
const { db } = await import("../src/db");
type Session = import("../src/lib/session").Session;
type Role = import("../src/db").Role;
(pool as unknown as { options: { max: number } }).options.max = 30;
pool.on("error", () => undefined);
pool.on("connect", (client) => client.on("error", () => undefined));

// ---- console capture (incident lines; nothing may print a password hash or a token) ---------------------------------
const logged: string[] = [];
for (const level of ["log", "info", "warn", "error"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
    original(...(args as []));
  };
}

// ---- helpers ----------------------------------------------------------------------------------------------------------
const q = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
const one = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await q<T>(text, values))[0];
const n = async (text: string, values: unknown[] = []) => Number((await one<{ n: number }>(text, values))?.n ?? 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HEADERS = { host: "customer.erp.test", origin: ORIGIN, "sec-fetch-site": "same-origin", "user-agent": "verify-primary-owner", "x-forwarded-for": "198.51.100.31" };
const inRequest = <T,>(fn: () => Promise<T>) => withRequest(HEADERS, fn);
const M = changes.TEAM_MESSAGES;
const err = (m: string) => ({ error: m });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

let seq = 0;
const tag = () => `${Date.now().toString(36)}${++seq}`;
async function newOrg(name = `Legacy Fixture ${tag()}`): Promise<number> {
  return Number((await one<{ id: number }>(`insert into orgs (name, country, currency) values ($1, 'Saudi Arabia', 'SAR') returning id`, [name]))!.id);
}
async function newUser(orgId: number, role: Role | string, active = true, label = "member"): Promise<number> {
  const t1 = tag();
  return Number(
    (await one<{ id: number }>(`insert into users (org_id, email, password_hash, name, role, is_active) values ($1, $2, 'x', $3, $4, $5) returning id`, [orgId, `${label}.${t1}@owner-fixture.test`, `Fixture ${label} ${t1}`, role, active]))!.id,
  );
}
/** The session the request would carry for this user (as resolveSessionToken builds it: role and status from the row). */
async function sessionOf(userId: number, override: Partial<Session> = {}): Promise<Session> {
  const r = await one<{ id: number; org_id: number; name: string; email: string; role: string; is_active: boolean; org_name: string }>(
    `select u.id, u.org_id, u.name, u.email, u.role, u.is_active, o.name as org_name from users u join orgs o on o.id = u.org_id where u.id = $1`,
    [userId],
  );
  if (!r) throw new Error("no such fixture user");
  return {
    userId: r.id, orgId: r.org_id, name: r.name, email: r.email, role: r.role as Role, isActive: r.is_active, orgName: r.org_name, orgLogoUrl: null, orgPrimaryColor: "#000000",
    orgAccentColor: "#000000", orgColorThemeMode: "light", orgGradientFrom: "#000000", orgGradientTo: "#000000", orgThemeOverrides: null, orgCurrency: "SAR", orgCountry: "Saudi Arabia",
    orgCustomCurrencySymbol: null, orgNumberDigitGrouping: "standard", orgNumberDecimalPlaces: 2, orgRoundQuantities: false, orgRoundRates: false, ...override,
  };
}
const roleOf = (actor: Session, target: number, role: Role, locale: "en" | "ar" = "en") => inRequest(() => changes.changeTeamMemberRole(actor, target, role, locale));
const activeOf = (actor: Session, target: number, active: boolean, locale: "en" | "ar" = "en") => inRequest(() => changes.setTeamMemberActive(actor, target, active, locale));
const userRow = (id: number) => one<{ role: string; is_active: boolean; org_id: number; updated_at: Date }>(`select role, is_active, org_id, updated_at from users where id = $1`, [id]);
const teamLogs = (orgId: number) => n(`select count(*)::int as n from activity_logs where org_id = $1 and type like 'team.%'`, [orgId]);
const protectedEvents = (orgId: number) => n(`select count(*)::int as n from security_events where org_id = $1 and type = 'team.primary_owner_protected'`, [orgId]);
const activeOwners = (orgId: number) => n(`select count(*)::int as n from users where org_id = $1 and role = 'owner' and is_active`, [orgId]);

// ---- barriers: an independent connection that holds a lock until released --------------------------------------------
type Blocker = { client: pg.Client; release: (commit?: boolean) => Promise<void>; pid: number };
async function blocker(lockSql: string, values: unknown[] = []): Promise<Blocker> {
  const client = await connectDisposable(process.env.DATABASE_URL!);
  client.on("error", () => undefined);
  await client.query("begin");
  await client.query(lockSql, values);
  const pid = Number((await client.query("select pg_backend_pid() as pid")).rows[0].pid);
  return {
    client,
    pid,
    release: async (commit = false) => {
      await client.query(commit ? "commit" : "rollback").catch(() => undefined);
      await client.end().catch(() => undefined);
    },
  };
}
/** Wait until `count` backends of this database wait for a lock while running a statement matching `like`. */
async function waiters(like: string, count: number, timeoutMs = 10_000): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await q<{ pid: number }>(
      `select pid from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query ilike $1 and pid <> pg_backend_pid()`,
      [like],
    );
    if (rows.length >= count) return rows.map((r) => Number(r.pid));
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${count} lock waiter(s) on ${like} (saw ${rows.length})`);
    await sleep(25);
  }
}
const ORG_LOCK = `%from "orgs"%for no key update%`;
const USER_LOCK = `%from "users"%for no key update%`;

// ---- statement capture (lock-order probe) -------------------------------------------------------------------------------
const statements: string[] = [];
let capturing = false;
const originalClientQuery = pg.Client.prototype.query;
(pg.Client.prototype as unknown as { query: (...a: unknown[]) => unknown }).query = function (this: pg.Client, ...args: unknown[]) {
  if (capturing) {
    const first = args[0] as string | { text?: string };
    statements.push(typeof first === "string" ? first : (first?.text ?? ""));
  }
  return (originalClientQuery as unknown as (...a: unknown[]) => unknown).apply(this, args);
} as typeof pg.Client.prototype.query;

// ---- fixtures (assigned inside the try block, so a failed set-up still drops the database) --------------------------
let trialV1 = "";
let operator = "";
async function baseFixtures(): Promise<void> {
  trialV1 = (await one<{ id: string }>(`select v.id from subscription_package_versions v join subscription_packages p on p.id = v.package_id where p.is_default_trial and v.version_number = 1`))!.id;
  operator = (
    await one<{ id: string }>(
      `insert into platform_admins (email_normalized, display_name, password_hash, mfa_secret_encrypted, mfa_enrolled_at) values ('operator@owner-fixture.test', 'Fictional Operator', $1, 'v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB==:CCCC', now()) returning id`,
      [await bcrypt.hash("Fictional-Passw0rd!x", 4)],
    )
  )!.id;
}

/** A company created by the REAL PO-02D3 acceptance path: returns its id and its (mapped) primary owner. */
async function acceptedCompany(): Promise<{ orgId: number; ownerId: number }> {
  const { token, tokenHash } = invitations.newInvitationToken();
  const tg = tag();
  const inv = (await one<{ id: string }>(
    `insert into organization_invitations (company_name, industry, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash, expires_at, invited_by_platform_admin_id, created_at, updated_at)
     values ($1, 'Exhibitions', $2, 'Saudi Arabia', 'SAR', 'Fixture Invitee', $3, $4, now() + interval '3 days', $5, now(), now()) returning id`,
    [`Accepted Fixture ${tg}`, `contact.${tg}@owner-fixture.test`, `primary.${tg}@owner-fixture.test`, tokenHash, operator],
  ))!.id;
  await q(`insert into organization_invitation_terms (invitation_id, initial_package_version_id, initial_is_trial, initial_cycle) values ($1, $2, true, 'trial')`, [inv, trialV1]);
  const out = await withRequest({ ...HEADERS, "x-forwarded-for": `10.31.0.${(seq % 200) + 1}` }, () =>
    orchestrator.acceptInvitationLink({ token, ownerName: "Fixture Primary Owner", password: "Fjord-Lantern-58!q", confirm: "Fjord-Lantern-58!q" }),
  );
  if (!out.ok) throw new Error(`fixture acceptance failed: ${JSON.stringify(out)}`);
  const row = (await one<{ org_id: number; user_id: number }>(`select p.org_id, p.user_id from tenant_primary_owners p join organization_invitations i on i.accepted_org_id = p.org_id where i.id = $1`, [inv]))!;
  return { orgId: Number(row.org_id), ownerId: Number(row.user_id) };
}

let exitCode = 1;
try {
  await baseFixtures();
  // =====================================================================================================================
  section("N. Inventory — every production code path that writes customer users or a primary-owner mapping");
  {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|mts|mjs|js)$/.test(name)) files.push(p);
      }
    };
    walk(join(ROOT, "src"));
    const rel = (p: string) => relative(ROOT, p);
    const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    const writers = (re: RegExp) => files.filter((f) => re.test(code(f))).map(rel).sort();
    ok("N1 exactly two modules insert users: the shared organization bootstrap and the Team add-member action",
      same(writers(/\.insert\(\s*usersTable\s*\)/), ["src/app/(app)/settings/team/actions.ts", "src/lib/org-bootstrap.ts"]), writers(/\.insert\(\s*usersTable\s*\)/).join(", "));
    ok("N2 nothing in src deletes a user (no ORM delete, no raw DELETE FROM users)", writers(/\.delete\(\s*usersTable\s*\)/).length === 0 && writers(/\bdelete\s+from\s+"?users"?\b/i).length === 0);
    const roleWriters = files.filter((f) => /\.update\(\s*usersTable\s*\)\s*\.set\(\{[^}]*\brole\b/.test(code(f).replace(/\s+/g, " "))).map(rel);
    const activeWriters = files.filter((f) => /\.update\(\s*usersTable\s*\)\s*\.set\(\{[^}]*\bisActive\b/.test(code(f).replace(/\s+/g, " "))).map(rel);
    // PO-03B: the status write moved into the shared customer-user mutation service (used by the Team actions AND the
    // Platform Owner user controls); the role write stays in the Team-change service. Still exactly one writer each.
    const activeWriterCode = code(join(ROOT, "src/lib/team/customer-user-core.ts"));
    // PO-03C: the role write moved into the same shared service (setCustomerUserRole — used by the Team role change, the
    // console's role control and the primary-owner transfer). Still exactly one writer of each column, one update each.
    ok("N3 users.role and users.is_active are each written by the shared customer-user mutation service ONLY (PO-03B the status, PO-03C the role) — one update each; the Team-change service writes users no more",
      same(roleWriters, ["src/lib/team/customer-user-core.ts"]) && same(activeWriters, ["src/lib/team/customer-user-core.ts"]) &&
        (activeWriterCode.match(/\.update\(\s*usersTable\s*\)/g) ?? []).length === 2 && (code(join(ROOT, "src/lib/team/member-changes.ts")).match(/\.update\(\s*usersTable\s*\)/g) ?? []).length === 0,
      `${roleWriters} | ${activeWriters}`);
    ok("N4 nothing updates users.org_id (no ORM .set({ orgId }) on users, no raw UPDATE users … org_id)",
      !files.some((f) => /\.update\(\s*usersTable\s*\)\s*\.set\(\{[^}]*\borgId\b/.test(code(f).replace(/\s+/g, " "))) && writers(/\bupdate\s+"?users"?\s+set\b/i).length === 0);
    // PO-03C: the primary-owner transfer (src/lib/platform/customer-user-actions.ts) moves an existing mapping with ONE
    // update, scoped by company AND previous owner; the mapping's guard re-checks the new user. Still no delete anywhere.
    const transferCode = code(join(ROOT, "src/lib/platform/customer-user-actions.ts"));
    ok("N5 the only writers of a primary-owner mapping are the PO-02D3 acceptance core (one insert) and (PO-03C) the primary-owner transfer (one update, by company AND previous owner); nothing else updates one and nothing deletes one",
      same(writers(/\.insert\(\s*tenantPrimaryOwnersTable\s*\)/), ["src/lib/platform/invitation-acceptance.ts"]) && same(writers(/\.update\(\s*tenantPrimaryOwnersTable\s*\)/), ["src/lib/platform/customer-user-actions.ts"]) &&
        (transferCode.match(/\.update\(\s*tenantPrimaryOwnersTable\s*\)/g) ?? []).length === 1 &&
        /\.update\(tenantPrimaryOwnersTable\)\s*\.set\(\{ userId: to\.id, assignedAt: now, assignedByPlatformAdminId: ctx\.adminId \}\)\s*\.where\(and\(eq\(tenantPrimaryOwnersTable\.orgId, orgId\), eq\(tenantPrimaryOwnersTable\.userId, from\.id\)\)\)/.test(transferCode) &&
        writers(/\.delete\(\s*tenantPrimaryOwnersTable\s*\)/).length === 0 && writers(/\b(insert\s+into|update|delete\s+from)\s+"?tenant_primary_owners"?/i).length === 0);
    ok("N6 the Team actions no longer write users themselves for role or status (they call the service)",
      /changeTeamMemberRole\(session, userId, role, await getLocale\(\)\)/.test(code(join(ROOT, "src/app/(app)/settings/team/actions.ts"))) &&
        /setTeamMemberActive\(session, userId, isActive, await getLocale\(\)\)/.test(code(join(ROOT, "src/app/(app)/settings/team/actions.ts"))) &&
        (code(join(ROOT, "src/app/(app)/settings/team/actions.ts")).match(/\.update\(usersTable\)/g) ?? []).length === 0);
    // PO-03C (sub-batch C): customer-user invitations now exist as a STAGED table (src/db/staged, outside the platform SQL
    // chain): its symbol appears only in that declaration, the user-invitation read model and write core, and the seat
    // core — which counts an open, unexpired invitation as a pending seat (display only; verify:platform-user-invitations T).
    const uinvFiles = files.filter((f) => /\buser_invitations\b|\buserInvitationsTable\b/.test(code(f))).map((f) => relative(ROOT, f)).sort();
    ok("N7 the customer-user invitation system is only the staged table (PO-03C): its declaration, read model, write core and the seat core name it — nothing else (no Team or customer code); a pending invitation occupies a seat only in the display",
      same(uinvFiles, ["src/db/staged/platform-user-invitations.ts", "src/lib/platform/seat-accounting.ts", "src/lib/platform/user-invitation-actions.ts", "src/lib/platform/user-invitations.ts"]), uinvFiles.join(", "));
  }

  // =====================================================================================================================
  section("H. A company created by the real acceptance path: its owner is mapped and protected");
  const M1 = await acceptedCompany();
  const P = M1.ownerId;
  const Q = await newUser(M1.orgId, "owner", true, "second-owner");
  const A = await newUser(M1.orgId, "admin", true, "admin");
  const S = await newUser(M1.orgId, "staff", true, "staff");
  {
    const mapping = await one<{ user_id: number }>(`select user_id from tenant_primary_owners where org_id = $1`, [M1.orgId]);
    ok("H1 acceptance mapped its new owner (an active owner of the same company)", Number(mapping?.user_id) === P && (await userRow(P))?.role === "owner" && (await userRow(P))?.is_active === true);
    const sq = await sessionOf(Q);
    const before = await userRow(P);
    const logs0 = await teamLogs(M1.orgId);
    const ev0 = await protectedEvents(M1.orgId);
    const r1 = await roleOf(sq, P, "admin");
    const r2 = await roleOf(sq, P, "staff");
    ok("A1 another owner cannot demote the primary owner (to admin or staff): refused with the protection message", same(r1, err(M.primaryRole)) && same(r2, err(M.primaryRole)), `${JSON.stringify(r1)} ${JSON.stringify(r2)}`);
    const after = await userRow(P);
    ok("A2 …the primary owner is unchanged (role, status, updated_at) and no activity record was written", after?.role === "owner" && after?.is_active === true && after?.updated_at.getTime() === before?.updated_at.getTime() && (await teamLogs(M1.orgId)) === logs0);
    ok("A3 …each refused attempt commits exactly one security event (team.primary_owner_protected, medium, role_change)",
      (await protectedEvents(M1.orgId)) === ev0 + 2 &&
        (await n(`select count(*)::int as n from security_events where org_id = $1 and type = 'team.primary_owner_protected' and severity = 'medium' and detail = 'role_change' and user_id = $2 and (metadata->>'targetUserId')::int = $3`, [M1.orgId, Q, P])) === 2);
    const noOp = await roleOf(sq, P, "owner");
    ok("A4 a request that leaves the primary owner an owner is allowed (it changes nothing protected)", same(noOp, {}) && (await userRow(P))?.role === "owner");
    const b1 = await activeOf(sq, P, false);
    const b2 = await activeOf(await sessionOf(A), P, false);
    ok("B1 neither an owner nor an admin can deactivate the primary owner", same(b1, err(M.primaryDeactivate)) && same(b2, err(M.primaryDeactivate)), `${JSON.stringify(b1)} ${JSON.stringify(b2)}`);
    ok("B2 …the primary owner stays an active owner; two deactivation events recorded", (await userRow(P))?.is_active === true &&
      (await n(`select count(*)::int as n from security_events where org_id = $1 and type = 'team.primary_owner_protected' and detail = 'deactivation'`, [M1.orgId])) === 2);
    ok("B3 the primary owner can still change others (an active owner of its company)", same(await roleOf(await sessionOf(P), S, "admin"), {}) && (await userRow(S))?.role === "admin");
    await roleOf(await sessionOf(P), S, "staff");
  }

  // =====================================================================================================================
  section("C. A primary owner can be neither deleted nor moved to another company");
  {
    const other = await newOrg();
    const del = await q(`delete from users where id = $1`, [P]).then(() => null, (e) => e);
    ok("C1 no code path deletes users (N2); a direct DELETE of the mapped user is refused by the database (23503, mapping FK RESTRICT)", (del as { code?: string } | null)?.code === "23503", describeError(del));
    const move = await q(`update users set org_id = $1 where id = $2`, [other, P]).then(() => null, (e) => e);
    ok("C2 moving the mapped user to another company is refused by the composite foreign key (23503); no code path changes users.org_id (N4)", (move as { code?: string } | null)?.code === "23503", describeError(move));
    const orgDel = await q(`delete from orgs where id = $1`, [M1.orgId]).then(() => null, (e) => e);
    ok("C3 deleting the company itself is refused while it has a mapping (23503); no code path deletes a company", (orgDel as { code?: string } | null)?.code === "23503", describeError(orgDel));
    const mapDel = await q(`delete from tenant_primary_owners where org_id = $1`, [M1.orgId]).then(() => null, (e) => e);
    ok("C4 the mapping itself cannot be deleted (guard trigger: transferred, never deleted)", (mapDel as { code?: string } | null)?.code === "23001", describeError(mapDel));
    ok("C5 …and nothing changed", (await userRow(P))?.org_id === M1.orgId && (await n(`select count(*)::int as n from tenant_primary_owners where org_id = $1 and user_id = $2`, [M1.orgId, P])) === 1);
  }

  // =====================================================================================================================
  section("D. Cross-company user ids are refused (and nothing of the other company is touched or locked)");
  const L1 = await newOrg();
  const L1owner = await newUser(L1, "owner", true, "legacy-owner");
  const L1owner2 = await newUser(L1, "owner", true, "legacy-owner2");
  const L1admin = await newUser(L1, "admin", true, "legacy-admin");
  const L1staff = await newUser(L1, "staff", true, "legacy-staff");
  {
    const s = await sessionOf(L1owner);
    const pBefore = await userRow(P);
    const d1 = await roleOf(s, P, "staff");
    const d2 = await activeOf(s, P, false);
    const d3 = await activeOf(s, Q, false);
    ok("D1 an owner of another company targeting the primary owner's id → \"User not found.\" (role and deactivation)", same(d1, err(M.notFound)) && same(d2, err(M.notFound)) && same(d3, err(M.notFound)), `${JSON.stringify([d1, d2, d3])}`);
    ok("D2 …the other company's users are unchanged and no protection event was recorded for either company", same(await userRow(P), pBefore) && (await userRow(Q))?.is_active === true && (await protectedEvents(L1)) === 0);
    // While the other company's user row is locked by a blocker, the cross-company request still answers at once:
    // the service only locks rows of the actor's own company.
    const b = await blocker(`select id from users where id = $1 for update`, [Q]);
    try {
      const t0 = Date.now();
      const d4 = await activeOf(s, Q, false);
      ok("D3 …without ever locking (or waiting for) the other company's row", same(d4, err(M.notFound)) && Date.now() - t0 < 2_000, `${Date.now() - t0} ms`);
    } finally {
      await b.release();
    }
    const bogus = [0, -1, 1.5, Number.NaN, "12" as unknown as number, null as unknown as number];
    const outs = await Promise.all(bogus.map((v) => roleOf(s, v, "staff")));
    ok("D4 malformed ids (0, negative, fractional, NaN, string, null) → \"User not found.\" without a query", outs.every((o) => same(o, err(M.notFound))));
  }

  // =====================================================================================================================
  section("E. The existing role restrictions are preserved (same rules, same messages)");
  {
    const admin = await sessionOf(L1admin);
    const owner = await sessionOf(L1owner);
    ok("E1 an admin cannot make anyone an owner", same(await roleOf(admin, L1staff, "owner"), err(M.aboveOwn)));
    ok("E2 an admin cannot change an owner's role", same(await roleOf(admin, L1owner2, "staff"), err(M.memberRole)));
    ok("E3 nobody changes their own role or deactivates their own account", same(await roleOf(owner, L1owner, "admin"), err(M.ownRole)) && same(await activeOf(owner, L1owner, false), err(M.ownAccount)) && same(await activeOf(owner, L1owner, true), err(M.ownAccount)));
    ok("E4 an unknown role is refused", same(await roleOf(owner, L1staff, "superuser" as Role), err(M.invalidRole)));
    ok("E5 an admin can still promote staff to admin and back (and an owner can demote another, non-primary owner)",
      same(await roleOf(admin, L1staff, "admin"), {}) && same(await roleOf(admin, L1staff, "staff"), {}) && same(await roleOf(owner, L1owner2, "admin"), {}) && same(await roleOf(owner, L1owner2, "owner"), {}));
    ok("E6 (pre-existing, preserved) an admin can deactivate a non-primary owner while another owner stays active — and reactivate them", same(await activeOf(admin, L1owner2, false), {}) && same(await activeOf(admin, L1owner2, true), {}));
    const staff = await sessionOf(L1staff);
    ok("E7 a session whose user is not an owner or admin (now) is refused inside the transaction", same(await roleOf(staff, L1admin, "staff"), err(M.notManager)) && same(await activeOf(staff, L1admin, false), err(M.notManager)));
    const staleOwner = await sessionOf(L1admin, { role: "owner" });
    ok("E8 a stale session that still says owner is judged by the CURRENT row (admin): it cannot make an owner", same(await roleOf(staleOwner, L1staff, "owner"), err(M.aboveOwn)) && (await userRow(L1staff))?.role === "staff");
    ok("E9 every permitted change wrote exactly one activity record, in its own transaction (identical xmin)",
      (await n(`select count(*)::int as n from activity_logs where org_id = $1 and type like 'team.%'`, [L1])) === 6 &&
        (await n(`select count(*)::int as n from users u join activity_logs l on l.entity_id = u.id and l.org_id = u.org_id where u.id = $1 and l.id = (select max(id) from activity_logs where entity_id = $1 and org_id = $2) and l.xmin = u.xmin`, [L1owner2, L1])) === 1);
  }

  // =====================================================================================================================
  section("F. The last-active-owner safeguard is preserved");
  const L2 = await newOrg();
  const L2owner = await newUser(L2, "owner", true, "only-owner");
  const L2oldOwner = await newUser(L2, "owner", false, "disabled-owner");
  const L2admin = await newUser(L2, "admin", true, "admin");
  {
    const admin = await sessionOf(L2admin);
    ok("F1 the only active owner cannot be deactivated (a disabled owner does not count)", same(await activeOf(admin, L2owner, false), err(M.lastOwner)) && (await userRow(L2owner))?.is_active === true);
    // The existing rule, unchanged: an OWNER target is refused when no OTHER active owner would remain — so a company
    // whose owners are all disabled (PO-00 class D) refuses even re-deactivating one, while reactivating is allowed.
    const D = await newOrg();
    const Downer = await newUser(D, "owner", false, "only-disabled-owner");
    const Dadmin = await newUser(D, "admin", true, "admin");
    ok("F2 (as before) with no active owner at all, deactivating a disabled owner is refused; reactivating it is allowed",
      same(await activeOf(await sessionOf(Dadmin), Downer, false), err(M.lastOwner)) && same(await activeOf(await sessionOf(Dadmin), Downer, true), {}) && (await activeOwners(D)) === 1);
    ok("F3 reactivating the disabled owner is allowed; then either owner may be deactivated", same(await activeOf(admin, L2oldOwner, true), {}) && same(await activeOf(admin, L2oldOwner, false), {}));
    ok("F4 the company keeps exactly one active owner", (await activeOwners(L2)) === 1);
  }

  // =====================================================================================================================
  section("G. Concurrency — deterministic barriers (each contender observed waiting before release)");
  {
    // G0 the baseline (1d036d6) Team actions, replayed statement by statement: no transaction, no lock — each request's
    // check passes on what it read, then both writes land. This is the race PO-03A closes (and the O-3 gap).
    const org = await newOrg();
    const X = await newUser(org, "owner", true, "x");
    const Y = await newUser(org, "owner", true, "y");
    const checkX = await one<{ role: string }>(`select role from users where id = $1 and org_id = $2`, [Y, org]); // X's request: may X change Y? (Y is an owner; X is one too)
    const checkY = await one<{ role: string }>(`select role from users where id = $1 and org_id = $2`, [X, org]); // Y's request, interleaved
    await q(`update users set role = 'admin' where id = $1`, [Y]);
    await q(`update users set role = 'admin' where id = $1`, [X]);
    ok("G0 (baseline replay) two owners demoting each other with the PO-02D3 statements leave the company with NO owner — the race exists without PO-03A", checkX?.role === "owner" && checkY?.role === "owner" && (await activeOwners(org)) === 0);
  }
  {
    // G1 two simultaneous demotions: X demotes Y while Y demotes X.
    const org = await newOrg();
    const X = await newUser(org, "owner", true, "x");
    const Y = await newUser(org, "owner", true, "y");
    const [sx, sy] = [await sessionOf(X), await sessionOf(Y)];
    const b = await blocker(`select id from orgs where id = $1 for no key update`, [org]);
    const p1 = roleOf(sx, Y, "admin");
    const p2 = roleOf(sy, X, "admin");
    await waiters(ORG_LOCK, 2);
    await b.release();
    const [r1, r2] = await Promise.all([p1, p2]);
    const wins = [r1, r2].filter((r) => same(r, {})).length;
    ok("G1 two owners demoting each other at the same instant: exactly one succeeds; the other is refused on the locked rows", wins === 1 && [r1, r2].some((r) => same(r, err(M.memberRole))), `${JSON.stringify([r1, r2])}`);
    ok("G1 …the company keeps one active owner (never zero)", (await activeOwners(org)) === 1);
  }
  {
    // G2 deactivation versus role change: X deactivates Y while Y demotes X.
    const org = await newOrg();
    const X = await newUser(org, "owner", true, "x");
    const Y = await newUser(org, "owner", true, "y");
    const b = await blocker(`select id from orgs where id = $1 for no key update`, [org]);
    const p1 = activeOf(await sessionOf(X), Y, false);
    const p2 = roleOf(await sessionOf(Y), X, "staff");
    await waiters(ORG_LOCK, 2);
    await b.release();
    const [r1, r2] = await Promise.all([p1, p2]);
    ok("G2 deactivation versus role change between two owners: exactly one applies", [r1, r2].filter((r) => same(r, {})).length === 1, JSON.stringify([r1, r2]));
    ok("G2 …and an active owner always remains", (await activeOwners(org)) === 1);
  }
  {
    // G3 two changes that would together remove every active owner: admins deactivate the two owners at once.
    const org = await newOrg();
    const X = await newUser(org, "owner", true, "x");
    const Y = await newUser(org, "owner", true, "y");
    const Z = await newUser(org, "admin", true, "z");
    const W = await newUser(org, "admin", true, "w");
    const b = await blocker(`select id from orgs where id = $1 for no key update`, [org]);
    const p1 = activeOf(await sessionOf(Z), X, false);
    const p2 = activeOf(await sessionOf(W), Y, false);
    await waiters(ORG_LOCK, 2);
    await b.release();
    const [r1, r2] = await Promise.all([p1, p2]);
    ok("G3 two admins deactivating the two owners at once: one succeeds, the other gets the last-owner message", [r1, r2].filter((r) => same(r, {})).length === 1 && [r1, r2].some((r) => same(r, err(M.lastOwner))), JSON.stringify([r1, r2]));
    ok("G3 …one active owner remains", (await activeOwners(org)) === 1);
    // Without the company-row serialization both would have passed their check (they lock different user rows):
    ok("G3 …the two requests locked different user rows — only the company-row lock serialized them", X !== Y && Z !== W);
  }
  {
    // G4 a primary-owner mapping written out of band (a future, owner-approved backfill) versus a deactivation.
    const org = await newOrg();
    const Pm = await newUser(org, "owner", true, "to-be-mapped");
    const Qm = await newUser(org, "owner", true, "other-owner");
    const Am = await newUser(org, "admin", true, "admin");
    // Order 1: the mapping write is in progress (its guard holds the user row FOR SHARE); the deactivation waits on
    // that row, then reads the mapping after it committed — and refuses.
    const mapper = await blocker(`insert into tenant_primary_owners (org_id, user_id) values ($1, $2)`, [org, Pm]);
    const p = activeOf(await sessionOf(Am), Pm, false);
    await waiters(USER_LOCK, 1);
    await mapper.release(true);
    const r = await p;
    ok("G4 mapping in progress, then deactivation: the deactivation waits on the user row, sees the committed mapping and refuses", same(r, err(M.primaryDeactivate)) && (await userRow(Pm))?.is_active === true, JSON.stringify(r));
    // Order 2: a Team change holds the user row (same statements, same order) and deactivates; a mapping write for that
    // user waits in its guard, then re-checks the row and is refused by the database.
    const team = await connectDisposable(process.env.DATABASE_URL!);
    team.on("error", () => undefined);
    await team.query("begin isolation level read committed");
    await team.query(`select id from orgs where id = $1 for no key update`, [org]);
    await team.query(`select id from users where org_id = $1 and id in ($2, $3) order by id for no key update`, [org, Am, Qm]);
    await team.query(`update users set is_active = false where id = $1`, [Qm]);
    const org2 = await newOrg();
    void org2;
    const mapper2 = connectDisposable(process.env.DATABASE_URL!).then(async (c) => {
      c.on("error", () => undefined);
      try {
        await c.query(`update tenant_primary_owners set user_id = $1 where org_id = $2`, [Qm, org]);
        return null;
      } catch (e) {
        return e;
      } finally {
        await c.end().catch(() => undefined);
      }
    });
    await waiters(`%update tenant_primary_owners%`, 1);
    await team.query("commit");
    await team.end();
    const e2 = (await mapper2) as { code?: string } | null;
    ok("G4 deactivation holding the row, then a mapping write naming that user: the guard waits, re-checks and refuses (23514)", e2?.code === "23514", describeError(e2));
    ok("G4 …the mapping still names the original owner, who is still an active owner", Number((await one<{ user_id: number }>(`select user_id from tenant_primary_owners where org_id = $1`, [org]))?.user_id) === Pm && (await userRow(Pm))?.is_active === true);
  }
  {
    // G5 concurrent actions against a recently accepted company.
    const C = await acceptedCompany();
    const Q2 = await newUser(C.orgId, "owner", true, "second-owner");
    const b = await blocker(`select id from orgs where id = $1 for no key update`, [C.orgId]);
    const sq = await sessionOf(Q2);
    const p1 = activeOf(sq, C.ownerId, false);
    const p2 = roleOf(sq, C.ownerId, "staff");
    await waiters(ORG_LOCK, 2);
    await b.release();
    const [r1, r2] = await Promise.all([p1, p2]);
    ok("G5 right after acceptance, a deactivation and a demotion of its owner at the same instant are both refused", same(r1, err(M.primaryDeactivate)) && same(r2, err(M.primaryRole)), JSON.stringify([r1, r2]));
    ok("G5 …the accepted company's owner is still its active, mapped owner", (await userRow(C.ownerId))?.role === "owner" && (await userRow(C.ownerId))?.is_active === true);
  }
  {
    // G6 stale Team page: the page offered "Make Admin" for a staff member who has since been made an owner.
    const org = await newOrg();
    const O = await newUser(org, "owner", true, "owner");
    const Ad = await newUser(org, "admin", true, "admin");
    const T = await newUser(org, "staff", true, "target");
    const adminSession = await sessionOf(Ad); // loaded with the page
    ok("G6 (setup) the owner promotes the member to owner after the admin's page loaded", same(await roleOf(await sessionOf(O), T, "owner"), {}));
    ok("G6 the admin's stale \"Make Admin\" submission is judged on the current row and refused", same(await roleOf(adminSession, T, "admin"), err(M.memberRole)) && (await userRow(T))?.role === "owner");
  }
  {
    // G7 interruption: a Team change waiting for the company lock is terminated mid-transaction.
    const org = await newOrg();
    const O = await newUser(org, "owner", true, "owner");
    const T = await newUser(org, "admin", true, "target");
    const before = await userRow(T);
    const b = await blocker(`select id from orgs where id = $1 for no key update`, [org]);
    const p = roleOf(await sessionOf(O), T, "staff");
    const [pid] = await waiters(ORG_LOCK, 1);
    await q(`select pg_terminate_backend($1)`, [pid]);
    const r = await p;
    await b.release();
    ok("G7 a terminated Team-change backend → \"The change couldn't be saved. Nothing was changed.\"", same(r, err(M.failed)), JSON.stringify(r));
    ok("G7 …nothing changed and no record was written", same(await userRow(T), before) && (await teamLogs(org)) === 0);
    // A terminated connection reaches the client as a connection error without a SQLSTATE: logged by its class alone.
    ok("G7 …the failure is logged by SQLSTATE or error class only — never its message", logged.some((l) => /^\[team\] change failed \(rolled back\): (SQLSTATE 57P01|Error)$/.test(l)) && !logged.some((l) => /^\[team\].*(terminat|select|update|insert)/i.test(l)));
  }
  {
    // G8 lock timeout: the company row is held longer than TEAM_LOCK_TIMEOUT.
    const org = await newOrg();
    const O = await newUser(org, "owner", true, "owner");
    const T = await newUser(org, "admin", true, "target");
    const b = await blocker(`select id from orgs where id = $1 for share`, [org]); // what a sign-in holds (PO-02C.1)
    const t0 = Date.now();
    const r = await roleOf(await sessionOf(O), T, "staff");
    const ms = Date.now() - t0;
    await b.release();
    ok(`G8 a company row held for longer than ${changes.TEAM_LOCK_TIMEOUT} → the "in progress, try again" message after the bounded wait`, same(r, err(M.busy)) && ms >= 4_500 && ms < 9_000, `${JSON.stringify(r)} after ${ms} ms`);
    ok("G8 …nothing changed", (await userRow(T))?.role === "admin" && (await teamLogs(org)) === 0);
  }
  {
    // G9 audit failure: the activity record cannot be written → the whole change rolls back.
    const org = await newOrg();
    const O = await newUser(org, "owner", true, "owner");
    const T = await newUser(org, "admin", true, "target");
    await q(`create or replace function po03a_fail_activity() returns trigger language plpgsql as $$ begin if new.org_id = ${org} then raise exception 'injected activity failure'; end if; return new; end $$`);
    await q(`create trigger po03a_fail_activity before insert on activity_logs for each row execute function po03a_fail_activity()`);
    const r = await roleOf(await sessionOf(O), T, "staff");
    const r2 = await activeOf(await sessionOf(O), T, false);
    await q(`drop trigger po03a_fail_activity on activity_logs`);
    ok("G9 the activity record fails → the change is refused (\"couldn't be saved\") and NOT applied", same(r, err(M.failed)) && same(r2, err(M.failed)) && (await userRow(T))?.role === "admin" && (await userRow(T))?.is_active === true);
    ok("G9 …and with the failure gone the same change succeeds with its record", same(await roleOf(await sessionOf(O), T, "staff"), {}) && (await teamLogs(org)) === 1);
    // The protected-owner refusal's security event fails → nothing is committed at all.
    await q(`create or replace function po03a_fail_sec() returns trigger language plpgsql as $$ begin if new.type = 'team.primary_owner_protected' then raise exception 'injected security-event failure'; end if; return new; end $$`);
    await q(`create trigger po03a_fail_sec before insert on security_events for each row execute function po03a_fail_sec()`);
    const ev0 = await protectedEvents(M1.orgId);
    const r3 = await activeOf(await sessionOf(Q), P, false);
    await q(`drop trigger po03a_fail_sec on security_events`);
    ok("G9 the protection's security event fails → the answer is \"couldn't be saved\", nothing changed and no event exists", same(r3, err(M.failed)) && (await userRow(P))?.is_active === true && (await protectedEvents(M1.orgId)) === ev0);
    await q(`drop function po03a_fail_activity(); drop function po03a_fail_sec();`);
  }
  {
    // G10 the company-row lock against PO-02C.1 session issuance and the PO-02C access change: they queue, never deadlock.
    const org = await newOrg();
    const O = await newUser(org, "owner", true, "owner");
    const T = await newUser(org, "admin", true, "target");
    const signIn = await connectDisposable(process.env.DATABASE_URL!);
    signIn.on("error", () => undefined);
    await signIn.query("begin isolation level read committed");
    await signIn.query(`select id from orgs where id = $1 for share`, [org]); // PO-02C.1 statement 1
    const p = roleOf(await sessionOf(O), T, "staff");
    await waiters(ORG_LOCK, 1);
    await signIn.query(`select id from users where id = $1 for no key update`, [O]); // the sign-in's user-row lock (company first, then user)
    await signIn.query("commit");
    await signIn.end();
    ok("G10 a sign-in holding the company row (FOR SHARE, then the user row) delays the Team change, which then completes — no deadlock", same(await p, {}));
    // And the real session-issue lock helper, in a transaction, against a waiting Team change:
    const p2 = db.transaction(async (tx) => {
      const state = await lockOrgAccessForSessionIssue(tx, org);
      await sleep(300);
      return state;
    });
    await sleep(50);
    const r2 = await roleOf(await sessionOf(O), T, "admin");
    ok("G10 …and with PO-02C.1's own lockOrgAccessForSessionIssue holding the row, both complete", (await p2) === "active" && same(r2, {}));
    // A Team change of one company never waits for another company's lock.
    const other = await newOrg();
    const b = await blocker(`select id from orgs where id = $1 for no key update`, [other]); // e.g. a PO-02C access change elsewhere
    const t0 = Date.now();
    const r3 = await roleOf(await sessionOf(O), T, "staff");
    await b.release();
    ok("G10 …a Team change is not delayed by a lock on ANOTHER company's row", same(r3, {}) && Date.now() - t0 < 2_000);
  }

  // =====================================================================================================================
  section("I. A legacy company (no mapping, no subscription) works exactly as before");
  {
    const s = await gate.readTeamOwnershipSummary(L1);
    ok("I1 its primary owner is \"not designated\" — never guessed from role = owner", s.primaryOwner.state === "not_designated" && (await activeOwners(L1)) === 2);
    const owner = await sessionOf(L1owner);
    ok("I2 an owner can demote and restore another owner, deactivate and reactivate a member", same(await roleOf(owner, L1owner2, "admin"), {}) && same(await roleOf(owner, L1owner2, "owner"), {}) && same(await activeOf(owner, L1staff, false), {}) && same(await activeOf(owner, L1staff, true), {}));
    ok("I3 no protection event and no mapping were created for it", (await protectedEvents(L1)) === 0 && (await n(`select count(*)::int as n from tenant_primary_owners where org_id = $1`, [L1])) === 0);
  }

  // =====================================================================================================================
  section("J. No automatic backfill");
  {
    const legacyMapped = await n(`select count(*)::int as n from tenant_primary_owners p where not exists (select 1 from organization_invitations i where i.accepted_org_id = p.org_id)`);
    ok("J1 every mapping in the database belongs to an invitation-accepted company (the out-of-band G4 fixture excepted)", legacyMapped === 1);
    ok("J2 no Team change, read or summary created a mapping or a subscription for a legacy company",
      (await n(`select count(*)::int as n from tenant_primary_owners where org_id in ($1, $2)`, [L1, L2])) === 0 && (await n(`select count(*)::int as n from tenant_subscriptions where org_id in ($1, $2)`, [L1, L2])) === 0);
  }

  // =====================================================================================================================
  section("K. Lock order (captured statements of one permitted change)");
  {
    const org = await newOrg();
    const O = await newUser(org, "owner", true, "owner");
    const T = await newUser(org, "staff", true, "target");
    statements.length = 0;
    capturing = true;
    const r = await activeOf(await sessionOf(O), T, false);
    capturing = false;
    const flat = statements.map((s) => s.replace(/\s+/g, " ").trim().toLowerCase());
    const at = (re: RegExp) => flat.findIndex((s) => re.test(s));
    const idx = [
      at(/^begin isolation level read committed/),
      at(/set_config\('lock_timeout'/),
      at(/from "orgs" where "orgs"\."id" = \$1 for no key update/),
      at(/from "users" where \("users"\."org_id" = \$1 and "users"\."id" in \(\$2, \$3\)\) order by "users"\."id" asc for no key update/),
      at(/to_regclass\('tenant_primary_owners'\)/),
      at(/from "tenant_primary_owners" where "tenant_primary_owners"\."org_id" = \$1 limit \$2 for share/),
      at(/^update "users" set "is_active"/),
      at(/^insert into "activity_logs"/),
      at(/^commit/),
    ];
    ok("K1 one READ COMMITTED transaction: lock timeout → company row → user rows (ascending id) → mapping FOR SHARE → update → activity record → COMMIT",
      same(r, {}) && idx.every((i) => i >= 0) && idx.every((i, k) => k === 0 || i > idx[k - 1]), JSON.stringify(idx));
    ok("K2 the lock timeout is bounded (5s) and set for this transaction only", changes.TEAM_LOCK_TIMEOUT === "5s" && flat.some((s) => /set_config\('lock_timeout', \$1, true\)/.test(s)));
  }

  // =====================================================================================================================
  section("L. Staged rollout — the foundation is consulted explicitly and fails CLOSED");
  {
    const org = await newOrg();
    const O = await newUser(org, "owner", true, "owner");
    const T = await newUser(org, "admin", true, "target");
    const so = await sessionOf(O);
    // L1 the mapping table present but a mapping-creating feature switched OFF: protection still applies (flag-independent).
    process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED = "false";
    ok("L1 with acceptance switched off, an existing mapping is still enforced", same(await activeOf(await sessionOf(Q), P, false), err(M.primaryDeactivate)));
    // L2 table absent (a database before the D-6 migration) and the feature off: no mapping can exist → the Team works as before.
    await q(`alter table tenant_primary_owners rename to po03a_hidden_primary_owners`);
    try {
      ok("L2 mapping table absent, acceptance off → the Team works exactly as before", same(await roleOf(so, T, "staff"), {}) && same(await roleOf(so, T, "admin"), {}));
      const summary = await gate.readTeamOwnershipSummary(org);
      ok("L2 …and the Team page says \"not designated\" (true: no mapping can exist)", summary.primaryOwner.state === "not_designated");
      // L3 table absent while acceptance (which CREATES mappings) is on: a deployment-order error → every protected change refused.
      process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED = "true";
      const logs0 = await teamLogs(org);
      const r3a = await roleOf(so, T, "staff");
      const r3b = await activeOf(so, T, false);
      ok("L3 mapping table absent, acceptance on → \"Team changes are unavailable … Nothing was changed\"", same(r3a, err(M.unavailable)) && same(r3b, err(M.unavailable)), JSON.stringify([r3a, r3b]));
      ok("L3 …nothing changed, no record, and an incident line was logged", (await userRow(T))?.role === "admin" && (await userRow(T))?.is_active === true && (await teamLogs(org)) === logs0 &&
        logged.some((l) => l.includes("[team-ownership] primary-owner protection unavailable — team change refused (fail closed)")));
      ok("L3 …and the Team page shows the primary owner as unavailable, not \"not designated\"", (await gate.readTeamOwnershipSummary(org)).primaryOwner.state === "unavailable");
    } finally {
      await q(`alter table po03a_hidden_primary_owners rename to tenant_primary_owners`);
    }
    // L4 a malformed foundation (a column missing) fails closed whatever the flag: the SQL error is never read as "no mapping".
    await q(`alter table tenant_primary_owners rename column user_id to po03a_user_id`);
    try {
      for (const flag of ["false", "true"]) {
        process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED = flag;
        const r4 = await activeOf(so, T, false);
        ok(`L4 malformed mapping table (column missing), acceptance ${flag === "true" ? "on" : "off"} → refused as unavailable, nothing changed`, same(r4, err(M.unavailable)) && (await userRow(T))?.is_active === true, JSON.stringify(r4));
      }
    } finally {
      await q(`alter table tenant_primary_owners rename column po03a_user_id to user_id`);
      process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED = "true";
    }
    ok("L5 with the foundation restored, the same change succeeds", same(await activeOf(so, T, false), {}) && same(await activeOf(so, T, true), {}));
  }

  // =====================================================================================================================
  section("M. Clear, localized messages");
  {
    const missing = Object.entries(M).filter(([, en]) => t("ar", en) === en || !/[؀-ۿ]/.test(t("ar", en)));
    ok("M1 every Team-change message has a Saudi Arabic translation in the shared dictionary", missing.length === 0, missing.map(([k]) => k).join(", "));
    const ar1 = await activeOf(await sessionOf(Q), P, false, "ar");
    const ar2 = await activeOf(await sessionOf(L2admin), L2owner, false, "ar");
    ok("M2 in Arabic, the protection and last-owner refusals answer in Arabic", same(ar1, err(t("ar", M.primaryDeactivate))) && same(ar2, err(t("ar", M.lastOwner))) && /[؀-ۿ]/.test(ar1.error ?? ""));
    ok("M3 the existing English messages are unchanged, word for word", M.invalidRole === "Invalid role." && M.aboveOwn === "You can't assign a role above your own." && M.ownRole === "You can't change your own role." &&
      M.notFound === "User not found." && M.memberRole === "You can't change this member's role." && M.ownAccount === "You can't deactivate your own account." && M.lastOwner === "The organization must keep at least one active owner.");
    ok("M4 no log line holds a password hash or bcrypt material", !logged.some((l) => /\$2[aby]\$/.test(l)));
  }

  exitCode = summary("verify:platform-primary-owner");
} catch (e) {
  ok("suite ran to completion", false, describeError(e));
  exitCode = summary("verify:platform-primary-owner");
} finally {
  await pool.end().catch(() => undefined);
  if (created && !process.env.PLATFORM_TEST_KEEP_DATABASES) await dropDisposableDatabase(testDbName).catch(() => undefined);
}
process.exit(exitCode);
