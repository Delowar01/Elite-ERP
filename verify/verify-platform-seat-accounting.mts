/**
 * Platform Owner PO-03A — READ-ONLY user-seat accounting on real PostgreSQL: the shared service
 * (src/lib/platform/seat-accounting.ts), its two consumers — the customer Team page's gate
 * (src/lib/team/ownership-gate.ts, the session's own company) and the Platform Owner company detail
 * (src/lib/platform/companies.ts, platform.companies.read, audited) — and the read-only legacy analysis
 * (docs/platform-owner/po03a/sql/legacy_owner_seat_analysis_readonly.sql) on both database shapes.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://…/<admin db with _test_only_> npm run verify:platform-seat-accounting
 *
 * Disposable databases only (dropped at the end): the reviewed schema with the PO-02D1B Trial seed; the exact pre-PO-02A
 * tenant shape (production today) and the full branch shape for the legacy analysis, each with the PO-02D0 fictional
 * fixtures. TEST-ONLY secrets are generated in memory and never printed.
 *
 * Categories (docs/platform-owner/PO03A_DEVELOPMENT.md §J): K Trial 1/3 · 2/3 · 3/3 · 4/3 · L disabled users occupy seats ·
 * M no current subscription / superseded / not installed / partial foundation · N nothing is enforced · O snapshots never
 * modified · T no tenant business data or other company exposed · U the legacy A–F analysis (read-only, both shapes).
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import pg from "pg";
import {
  connectDisposable,
  createDisposableDatabase,
  createPlatformTestDatabase,
  databaseUrlFor,
  disposableName,
  dropDisposableDatabase,
  pushPreCompanyTenantSchema,
} from "../scripts/platform/disposable-db";
import { describeError, ok, section, summary } from "./platform/harness";
import { withRequest } from "./platform/request-scope";

const ROOT = process.cwd();
const testDbName = disposableName("po03a_seats");
const prodShapeName = disposableName("po03a_seats_prod");
const fullShapeName = disposableName("po03a_seats_full");
process.env.DATABASE_URL = databaseUrlFor(testDbName);
process.env.PLATFORM_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.FIELD_ENCRYPTION_KEYS = `1:${randomBytes(32).toString("base64")}`;
process.env.PLATFORM_CONSOLE_ENABLED = "true";
delete process.env.PLATFORM_INVITATIONS_ENABLED;
process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED = "true";
process.env.PLATFORM_TRUSTED_PROXY_HOPS = "1";
const ORIGIN = "https://customer.erp.test";
process.env.CUSTOMER_PUBLIC_ORIGIN = ORIGIN;
delete process.env.PLATFORM_INVITATIONS_LOOPBACK_ORIGIN;

const createdDbs: string[] = [];
await createPlatformTestDatabase("po03a_seats", testDbName);
createdDbs.push(testDbName);
{
  const { runSeed } = await import("../scripts/platform/trial-seed");
  const seeded = await runSeed(process.env.DATABASE_URL);
  if (seeded.check.state !== "complete") throw new Error(`the Trial seed did not complete: ${seeded.check.state}`);
}

const { db, pool, platformAdminsTable } = await import("../src/db");
const seats = await import("../src/lib/platform/seat-accounting");
const gate = await import("../src/lib/team/ownership-gate");
const changes = await import("../src/lib/team/member-changes");
const invitations = await import("../src/lib/platform/invitations");
const orchestrator = await import("../src/lib/onboarding/invitation-acceptance");
const auth = await import("../src/lib/platform/auth");
const mfa = await import("../src/lib/platform/mfa");
const totp = await import("../src/lib/platform/totp");
const console_ = await import("../src/lib/platform/console");
const co = await import("../src/lib/platform/companies");
const { platformClock } = await import("../src/lib/platform/clock");
type Session = import("../src/lib/session").Session;
type Role = import("../src/db").Role;
(pool as unknown as { options: { max: number } }).options.max = 20;
pool.on("error", () => undefined);

const logged: string[] = [];
for (const level of ["log", "info", "warn", "error"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
    original(...(args as []));
  };
}

// ---- statement capture (which relations the seat service reads) ---------------------------------------------------------
const statements: string[] = [];
let statementsOn = false;
const originalClientQuery = pg.Client.prototype.query;
(pg.Client.prototype as unknown as { query: (...a: unknown[]) => unknown }).query = function (this: pg.Client, ...args: unknown[]) {
  if (statementsOn) {
    const first = args[0] as string | { text?: string };
    statements.push(typeof first === "string" ? first : (first?.text ?? ""));
  }
  return (originalClientQuery as unknown as (...a: unknown[]) => unknown).apply(this, args);
} as typeof pg.Client.prototype.query;

// ---- helpers ----------------------------------------------------------------------------------------------------------
const q = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
const one = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await q<T>(text, values))[0];
const n = async (text: string, values: unknown[] = []) => Number((await one<{ n: number }>(text, values))?.n ?? 0);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const HEADERS = { host: "customer.erp.test", origin: ORIGIN, "sec-fetch-site": "same-origin", "user-agent": "verify-seat-accounting", "x-forwarded-for": "198.51.100.41" };
let seq = 0;
const tag = () => `${Date.now().toString(36)}${++seq}`;
async function newOrg(name = `Seat Fixture ${tag()}`): Promise<number> {
  return Number((await one<{ id: number }>(`insert into orgs (name, country, currency) values ($1, 'Saudi Arabia', 'SAR') returning id`, [name]))!.id);
}
async function newUser(orgId: number, role: Role, active = true): Promise<number> {
  const t1 = tag();
  return Number((await one<{ id: number }>(`insert into users (org_id, email, password_hash, name, role, is_active) values ($1, $2, 'x', $3, $4, $5) returning id`, [orgId, `seat.${t1}@seat-fixture.test`, `Seat Fixture ${t1}`, role, active]))!.id);
}
async function sessionOf(userId: number): Promise<Session> {
  const r = (await one<{ id: number; org_id: number; name: string; email: string; role: string }>(`select id, org_id, name, email, role from users where id = $1`, [userId]))!;
  return { userId: r.id, orgId: r.org_id, name: r.name, email: r.email, role: r.role as Role, isActive: true } as Session;
}

let nowMs = Math.floor(Date.now() / 1000) * 1000;
platformClock.now = () => new Date(nowMs);
const nextStep = () => {
  nowMs = (totp.totpStepAt(new Date(nowMs)) + 1) * 30_000 + 1_000;
};
const STRONG = "Cedar-Lantern-58!q";
const CONSOLE_HEADERS = () => new Headers({ host: "console.erp.test", origin: "https://console.erp.test", "sec-fetch-site": "same-origin", "user-agent": "verify-seat-accounting", "x-forwarded-for": "203.0.113.41" });
async function platformToken(): Promise<string> {
  const email = `operator.${tag()}@seat-fixture.test`;
  const { secret } = mfa.createTotpEnrollment(email);
  const { hashes } = await mfa.createRecoveryCodeSet();
  const at = new Date(nowMs);
  await db.insert(platformAdminsTable).values({ emailNormalized: email, displayName: "Seat Fixture Operator", passwordHash: await auth.hashPlatformPassword(STRONG), isActive: true, mfaSecretEncrypted: mfa.encryptTotpSecret(secret), mfaRecoveryHashes: hashes, mfaEnrolledAt: at, passwordChangedAt: at, createdAt: at, updatedAt: at });
  nextStep();
  const r = await console_.signInCore({ email, password: STRONG, totpCode: totp.hotpCode(secret, totp.totpStepAt(new Date(nowMs))) }, { headers: CONSOLE_HEADERS() });
  if (!r.ok) throw new Error(`fixture sign-in failed: ${r.code}`);
  return r.token;
}

let trialV1 = "";
let operatorId = "";
async function acceptedCompany(): Promise<{ orgId: number; ownerId: number }> {
  const { token, tokenHash } = invitations.newInvitationToken();
  const tg = tag();
  // Written on the platform clock the acceptance reads (an hour ago; three days to run), as PO-02D2 writes it.
  const createdAt = new Date(nowMs - 3_600_000);
  const inv = (await one<{ id: string }>(
    `insert into organization_invitations (company_name, industry, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash, expires_at, invited_by_platform_admin_id, created_at, updated_at)
     values ($1, 'Exhibitions', $2, 'Saudi Arabia', 'SAR', 'Fixture Invitee', $3, $4, $5, $6, $7, $7) returning id`,
    [`Seat Trial ${tg}`, `contact.${tg}@seat-fixture.test`, `primary.${tg}@seat-fixture.test`, tokenHash, new Date(createdAt.getTime() + 72 * 3_600_000), operatorId, createdAt],
  ))!.id;
  await q(`insert into organization_invitation_terms (invitation_id, initial_package_version_id, initial_is_trial, initial_cycle) values ($1, $2, true, 'trial')`, [inv, trialV1]);
  const out = await withRequest({ ...HEADERS, "x-forwarded-for": `10.41.0.${(seq % 200) + 1}` }, () =>
    orchestrator.acceptInvitationLink({ token, ownerName: "Seat Primary Owner", password: "Fjord-Lantern-58!q", confirm: "Fjord-Lantern-58!q" }),
  );
  if (!out.ok) throw new Error(`fixture acceptance failed: ${JSON.stringify(out)}`);
  const row = (await one<{ org_id: number; user_id: number }>(`select p.org_id, p.user_id from tenant_primary_owners p join organization_invitations i on i.accepted_org_id = p.org_id where i.id = $1`, [inv]))!;
  return { orgId: Number(row.org_id), ownerId: Number(row.user_id) };
}

/** Run a psql file against a disposable database (connection from the environment only; nothing printed). */
function psql(url: string, file: string): { status: number | null; out: string } {
  const u = new URL(url);
  const res = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-F", "|", "-f", file], {
    env: { ...process.env, PGHOST: u.hostname, PGPORT: u.port || "5432", PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: u.pathname.slice(1), PGOPTIONS: "", PGAPPNAME: "verify-seat-accounting" },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}`.replace(/postgres(ql)?:\/\/\S+/g, "<redacted-url>") };
}
const ANALYSIS = join(ROOT, "docs/platform-owner/po03a/sql/legacy_owner_seat_analysis_readonly.sql");
const FIXTURES = join(ROOT, "docs/platform-owner/po02d0/sql/01_legacy_audit_fixtures_fictional.sql");
const rowsOf = (out: string, id: string) => out.split("\n").filter((l) => l.startsWith(`${id}|`)).map((l) => l.split("|"));
async function checksum(client: pg.Client): Promise<string> {
  const tables = (await client.query(`select tablename from pg_tables where schemaname = 'public' order by 1`)).rows.map((r) => r.tablename as string);
  let acc = "";
  for (const t1 of tables) acc += `${t1}:${(await client.query(`select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from "${t1}" x`)).rows[0].h};`;
  return acc;
}

let exitCode = 1;
try {
  trialV1 = (await one<{ id: string }>(`select v.id from subscription_package_versions v join subscription_packages p on p.id = v.package_id where p.is_default_trial and v.version_number = 1`))!.id;
  operatorId = (await one<{ id: string }>(`insert into platform_admins (email_normalized, display_name, password_hash, mfa_secret_encrypted, mfa_enrolled_at) values ('invites@seat-fixture.test', 'Seat Inviter', $1, 'v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB==:CCCC', now()) returning id`, [await auth.hashPlatformPassword(STRONG)]))!.id;
  const token = await platformToken();
  const req = { headers: CONSOLE_HEADERS(), token };
  const detailOf = (orgId: number) => co.getCompanyDetail(req, String(orgId));
  const summaryOf = (orgId: number) => gate.readTeamOwnershipSummary(orgId);

  // =====================================================================================================================
  section("K. A Trial company: 1 of 3, 2 of 3, 3 of 3 and 4 of 3 seats — the same numbers in the service, the Team page and the console");
  const T = await acceptedCompany();
  const subBefore = await q(`select id, xmin::text as xmin, seats_snapshot, storage_snapshot_gb, module_groups_snapshot::text as modules, price_snapshot_sar::text as price, start_date::text as s, end_date::text as e, lifecycle_state, superseded_at from tenant_subscriptions order by id`);
  const expect = [
    { users: 1, remaining: 2, overBy: 0 },
    { users: 2, remaining: 1, overBy: 0 },
    { users: 3, remaining: 0, overBy: 0 },
    { users: 4, remaining: 0, overBy: 1 },
  ];
  for (const [i, e] of expect.entries()) {
    if (i > 0) await newUser(T.orgId, "staff");
    const s = await seats.readSeatAccounting(db, T.orgId);
    const g = await summaryOf(T.orgId);
    const d = await detailOf(T.orgId);
    const a = s.allowance;
    const ok1 = a.state === "assigned" && a.seats === 3 && a.isTrial && a.versionNumber === 1 && s.occupied === e.users && s.remaining === e.remaining && s.overBy === e.overBy && s.overLimit === e.overBy > 0 && s.enforced === false;
    const ok2 = g.seats.available && g.seats.occupied === e.users && g.seats.allowance.state === "assigned" && g.seats.allowance.seats === 3 && g.seats.remaining === e.remaining && g.seats.overBy === e.overBy;
    const ok3 = !!d.seats && same(d.seats, s);
    ok(`K${i + 1} ${e.users} of 3 seats occupied → remaining ${e.remaining}${e.overBy ? `, over by ${e.overBy} (informational)` : ""} — service, Team page and console agree`, ok1 && ok2 && ok3, JSON.stringify({ s, g: g.seats }));
  }
  {
    const s = await seats.readSeatAccounting(db, T.orgId);
    ok("K5 the allowance is the current subscription's own seats snapshot (3), from the Trial v1 package — not the catalogue", s.allowance.state === "assigned" && s.allowance.seats === Number((await one<{ seats_snapshot: number }>(`select seats_snapshot from tenant_subscriptions where org_id = $1 and superseded_at is null`, [T.orgId]))?.seats_snapshot) &&
      s.allowance.packageName.length > 0 && s.allowance.cycle === "trial" && s.allowance.lifecycleState === "trialing");
    ok("K6 pending customer-user invitations count 0 — none exists, none is fabricated", s.pendingInvitations === 0 && s.occupied === s.users.total);
  }

  // =====================================================================================================================
  section("L. Disabled users occupy seats");
  {
    const owner = await sessionOf(T.ownerId);
    const staff = Number((await one<{ id: number }>(`select id from users where org_id = $1 and role = 'staff' order by id limit 1`, [T.orgId]))!.id);
    const before = await seats.readSeatAccounting(db, T.orgId);
    const r = await withRequest(HEADERS, () => changes.setTeamMemberActive(owner, staff, false, "en"));
    const after = await seats.readSeatAccounting(db, T.orgId);
    ok("L1 deactivating a member leaves occupied seats unchanged (4), with active − 1 and disabled + 1", same(r, {}) && after.occupied === before.occupied && after.users.active === before.users.active - 1 && after.users.disabled === before.users.disabled + 1);
    const g = await summaryOf(T.orgId);
    ok("L2 the Team page shows the same split", g.seats.available && g.seats.users.disabled === after.users.disabled && g.seats.users.active === after.users.active);
  }

  // =====================================================================================================================
  section("M. No current subscription: an honest \"no allowance\" — never inferred, never created");
  {
    const L = await newOrg();
    await newUser(L, "owner");
    await newUser(L, "staff", false);
    const s = await seats.readSeatAccounting(db, L);
    ok("M1 a legacy company: allowance none, remaining null, nothing over, both users occupy seats", s.allowance.state === "none" && s.remaining === null && s.overBy === 0 && !s.overLimit && s.occupied === 2 && s.users.disabled === 1);
    const g = await summaryOf(L);
    const d = await detailOf(L);
    ok("M2 the Team page says \"no subscription assigned\" and the console the same — and no subscription was created", g.seats.available && g.seats.allowance.state === "none" && d.seats?.allowance.state === "none" && d.primaryOwner.state === "not_designated" &&
      (await n(`select count(*)::int as n from tenant_subscriptions where org_id = $1`, [L])) === 0);
    // A company whose only subscription has been superseded (history only) has no current allowance either.
    const H = await acceptedCompany();
    // (the test's platform clock may run ahead of the database clock: never let superseded_at precede created_at)
    await q(`update tenant_subscriptions set superseded_at = greatest(now(), created_at), updated_at = greatest(now(), created_at, updated_at) where org_id = $1`, [H.orgId]);
    const sh = await seats.readSeatAccounting(db, H.orgId);
    ok("M3 only a superseded (historical) subscription → no current allowance", sh.allowance.state === "none" && sh.remaining === null);
    // The subscription foundation absent (before the D-6 migration): no subscription can exist.
    await q(`alter table tenant_subscriptions rename to po03a_hidden_subscriptions; alter table subscription_package_versions rename to po03a_hidden_versions; alter table subscription_packages rename to po03a_hidden_packages`);
    try {
      const sn = await seats.readSeatAccounting(db, T.orgId);
      ok("M4 foundation not installed → allowance \"not_installed\" (a catalog fact), the user counts still exact", sn.allowance.state === "not_installed" && sn.occupied === 4 && sn.remaining === null);
      process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED = "false";
      const gOff = await summaryOf(T.orgId);
      process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED = "true";
      const gOn = await summaryOf(T.orgId);
      ok("M5 the Team page: with no feature that needs it, \"no subscription assigned\"; with acceptance on, the absence is an error → unavailable", gOff.seats.available && gOff.seats.allowance.state === "none" && gOn.seats.available === false);
      const d = await detailOf(T.orgId);
      ok("M6 the console states the fact precisely (\"not installed\") and still serves the rest of the detail", d.seats?.allowance.state === "not_installed" && d.access.status === "active" && d.name.length > 0);
    } finally {
      await q(`alter table po03a_hidden_subscriptions rename to tenant_subscriptions; alter table po03a_hidden_versions rename to subscription_package_versions; alter table po03a_hidden_packages rename to subscription_packages`);
    }
    // Only part of the foundation: malformed — never guessed around.
    await q(`alter table subscription_packages rename to po03a_hidden_packages`);
    try {
      const thrown = await seats.readSeatAccounting(db, T.orgId).then(() => null, (e: unknown) => e);
      ok("M7 a partly installed foundation is refused by the service (it throws — no \"no subscription\" answer)", thrown instanceof Error && /partly installed/.test((thrown as Error).message));
      const g = await summaryOf(T.orgId);
      const d = await detailOf(T.orgId);
      ok("M8 …the Team page shows seat information as unavailable; the console shows it unavailable and still serves access and owners", g.seats.available === false && d.seats === null && d.access.status === "active" && Array.isArray(d.owners));
      ok("M9 …each failure is logged by its class only", logged.some((l) => l === "[team-ownership] seat summary unavailable: Error") && logged.some((l) => l === "[platform-companies] seat accounting unavailable: Error"));
    } finally {
      await q(`alter table po03a_hidden_packages rename to subscription_packages`);
    }
    // A malformed column (42703) is a database error, not "none" either.
    await q(`alter table tenant_subscriptions rename column seats_snapshot to po03a_seats`);
    try {
      const thrown = await seats.readSeatAccounting(db, T.orgId).then(() => null, (e: unknown) => e);
      ok("M10 a missing column surfaces as the database error (42703), never as \"no subscription\"", (thrown as { cause?: { code?: string }; code?: string })?.cause?.code === "42703" || (thrown as { code?: string })?.code === "42703", describeError(thrown));
    } finally {
      await q(`alter table tenant_subscriptions rename column po03a_seats to seats_snapshot`);
    }
  }

  // =====================================================================================================================
  section("N. Nothing is enforced");
  {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|mts)$/.test(name)) files.push(p);
      }
    };
    walk(join(ROOT, "src"));
    const rel = (p: string) => relative(ROOT, p);
    const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    const importers = files.filter((f) => /from "(@\/lib\/platform|\.)\/seat-accounting"/.test(code(f))).map(rel).sort();
    // PO-03B: the customer-user read model (src/lib/platform/customer-users.ts) reads it too — one batch read per directory
    // page and one for a user page, display only; the user controls never read it (N5).
    // PO-03C (sub-batch C): the user-invitation write core reads it for the create PREVIEW only (display: seats refuse nothing).
    // PO-03D (sub-batch B): and the seat-enforcement core (src/lib/platform/seat-enforcement.ts) — the SAME numbers, read
    // fresh under the company lock by the ONE enforcing check (assertUserSeatAvailable).
    // PO-03D (sub-batch A): and the user-invitation acceptance core, for its PREVIEW only (the plan and seats the invitee is
    // shown); its refusal is the enforcing check's.
    ok("N1 only the Team ownership gate, the console read model, (PO-03B) the customer-user read model, (PO-03C) the user-invitation preview and (PO-03D) the seat-enforcement core and the acceptance preview use the seat service", same(importers, ["src/lib/platform/companies.ts", "src/lib/platform/customer-users.ts", "src/lib/platform/seat-enforcement.ts", "src/lib/platform/user-invitation-acceptance.ts", "src/lib/platform/user-invitation-actions.ts", "src/lib/team/ownership-gate.ts"]), importers.join(", "));
    // PO-03D: enforcement exists now — exactly ONE function, in exactly one module; the accounting itself stays read-only.
    ok("N2 (PO-03D) the only seat-enforcement function is assertUserSeatAvailable, defined once, in src/lib/platform/seat-enforcement.ts", same(files.filter((f) => /function (assertUserSeatAvailable|enforceSeat|seatLimitExceeded)\b/i.test(code(f))).map(rel), ["src/lib/platform/seat-enforcement.ts"]) && !files.some((f) => /enforceSeat|seatLimitExceeded/i.test(code(f))));
    // PO-03D (sub-batch C): the gate also exposes the Add Member's lock, its seat check and their refusal type — calls
    // through to the platform's ONE enforcing check (seat-enforcement.ts); the accounting itself stays read-only.
    ok("N3 the service is read-only and says `enforced` only from the caller's switch AND a subscription (PO-03D: `enforced: boolean`, never an environment read here) and the gate exposes reads only — plus (PO-03D) the Add Member's lock, seat check and refusal type",
      /enforced: boolean;/.test(code(join(ROOT, "src/lib/platform/seat-accounting.ts"))) && /enforced: enforcement === true && seats !== null,/.test(code(join(ROOT, "src/lib/platform/seat-accounting.ts"))) && !/process\.env/.test(code(join(ROOT, "src/lib/platform/seat-accounting.ts"))) && same([...code(join(ROOT, "src/lib/team/ownership-gate.ts")).matchAll(/^export (?:async )?(?:function|class) (\w+)/gm)].map((m) => m[1]).sort(), ["TeamProtectionUnavailableError", "TeamSeatRefusal", "assertTeamMemberSeat", "lockPrimaryOwnerForTeamChange", "lockTeamMemberAdd", "readTeamOwnershipSummary"]));
    const before = await seats.readSeatAccounting(db, T.orgId);
    await newUser(T.orgId, "staff");
    const second = await acceptedCompany();
    const after = await seats.readSeatAccounting(db, T.orgId);
    ok("N4 above the allowance (4 of 3), a fifth user is still created and another company still onboards", before.overLimit && after.occupied === before.occupied + 1 && after.overBy === 2 && second.orgId > 0);
    // PO-03B: the user directory, the user page and their read model show the same over-the-allowance fact (display
    // only); the user controls (cores, shared service, server actions, dialog) name no seat number at all.
    const userControls = ["src/lib/platform/customer-user-actions.ts", "src/lib/team/customer-user-core.ts", "src/app/(platform)/customer-user-actions.ts", "src/components/platform/customer-user-controls.tsx"];
    ok("N5 no module refuses, hides or blocks on these numbers: overLimit/remaining are read only by the display components (company detail; PO-03B the user directory, the user page and their read model) — and the PO-03B user controls read none of them",
      files.filter((f) => /\boverLimit\b/.test(code(f))).map(rel).sort().join(",") === ["src/app/(platform)/platform/(console)/companies/[orgId]/page.tsx", "src/app/(platform)/platform/(console)/users/[userId]/page.tsx", "src/app/(platform)/platform/(console)/users/page.tsx", "src/lib/platform/customer-users.ts", "src/lib/platform/seat-accounting.ts"].join(",") &&
        !userControls.some((f) => /\b(overLimit|overBy|remaining|seat-accounting|readSeatAccounting\w*)\b/.test(code(join(ROOT, f)))));
  }

  // =====================================================================================================================
  section("O. Subscription snapshots are never modified");
  {
    const afterRows = await q(`select id, xmin::text as xmin, seats_snapshot, storage_snapshot_gb, module_groups_snapshot::text as modules, price_snapshot_sar::text as price, start_date::text as s, end_date::text as e, lifecycle_state, superseded_at from tenant_subscriptions order by id`);
    const touched = afterRows.filter((r) => {
      const b = subBefore.find((x) => x.id === r.id);
      return b && !same(b, r);
    });
    // Only M3's own fixture was superseded on purpose (a different company); every other row is byte-identical.
    ok("O1 every pre-existing subscription row is unchanged (same xmin, snapshots, dates and state) after all reads and Team changes", subBefore.length >= 1 && touched.length === 0, JSON.stringify(touched).slice(0, 300));
    ok("O2 the seat service and its consumers never write: no INSERT/UPDATE/DELETE in seat-accounting.ts, primary-owners.ts or the gate",
      ["src/lib/platform/seat-accounting.ts", "src/lib/platform/primary-owners.ts", "src/lib/team/ownership-gate.ts"].every((f) => !/\.(insert|update|delete)\(|\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i.test(readFileSync(join(ROOT, f), "utf8"))));
    ok("O3 subscription events were written only by the acceptances themselves (one 'assigned' each)", (await n(`select count(*)::int as n from subscription_events where event_type <> 'assigned'`)) === 0 && (await n(`select count(*)::int as n from subscription_events`)) === (await n(`select count(*)::int as n from tenant_subscriptions`)));
  }

  // =====================================================================================================================
  section("T. No tenant business data — and no other company — through either read model");
  {
    const A = await acceptedCompany();
    const B = await newOrg("Seat Neighbour");
    for (let i = 0; i < 6; i++) await newUser(B, "staff");
    const MARK = `SECRET-BUSINESS-${randomBytes(4).toString("hex")}`;
    await q(`insert into customers (org_id, name, email) values ($1, $2, $3)`, [A.orgId, MARK, `${MARK.toLowerCase()}@seat-fixture.test`]);
    const g = await summaryOf(A.orgId);
    const d = await detailOf(A.orgId);
    const gJson = JSON.stringify(g);
    const dJson = JSON.stringify({ seats: d.seats, primaryOwner: d.primaryOwner });
    const gB = await summaryOf(B);
    ok("T1 each Team summary holds only its own company's counts (1 user vs the neighbour's 6; the neighbour has no subscription and no owner mapping)",
      g.seats.available && g.seats.users.total === 1 && g.primaryOwner.state === "designated" && g.primaryOwner.userId === A.ownerId &&
        gB.seats.available && gB.seats.users.total === 6 && gB.seats.allowance.state === "none" && gB.primaryOwner.state === "not_designated");
    // PO-03D: plus the pending-invitation count (the breakdown) and whether the limit is enforced — counts and a flag only.
    ok("T2 the Team summary's shape is exactly the allowlist (counts, allowance, the primary owner's user id; PO-03D: the pending count and `enforced`)",
      same(Object.keys(g).sort(), ["primaryOwner", "seats"]) && g.seats.available && same(Object.keys(g.seats).sort(), ["allowance", "available", "enforced", "occupied", "overBy", "pending", "remaining", "users"]) &&
        same(Object.keys(g.seats.allowance).sort(), ["endDate", "isTrial", "packageName", "seats", "state", "versionNumber"]) && same(Object.keys(g.primaryOwner).sort(), ["state", "userId"]));
    ok("T3 the console's Users & seats part names only the primary owner's name and e-mail — no hash, MFA, session or business value",
      d.primaryOwner.state === "designated" && same(Object.keys(d.primaryOwner).sort(), ["activeOwner", "email", "name", "state"]) && !/\$2[aby]\$|mfa|password|session|token/i.test(dJson) && !dJson.includes(MARK) && !gJson.includes(MARK));
    statementsOn = true;
    statements.length = 0;
    await seats.readSeatAccounting(db, A.orgId);
    statementsOn = false;
    const relations = [...new Set(statements.flatMap((s) => [...s.matchAll(/\b(?:from|join)\s+"?([a-z_]+)"?/gi)].map((m) => m[1].toLowerCase())))].sort();
    ok("T4 the seat service reads only users, tenant_subscriptions, subscription_package_versions and subscription_packages (and the catalog probe)",
      same(relations, ["subscription_package_versions", "subscription_packages", "tenant_subscriptions", "users"]), relations.join(", "));
    const src = readFileSync(join(ROOT, "src/lib/platform/seat-accounting.ts"), "utf8");
    const cols = (alias: string) => [...new Set([...src.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, "g"))].map((m) => m[1]))].sort();
    ok("T5 the columns it names are allow-listed: users (orgId, isActive); subscription (seats, Trial, cycle, state, dates, version, org, superseded); version (id, number, package); package (id, name)",
      same(cols("usersTable"), ["isActive", "orgId"]) && same(cols("sub"), ["cycle", "endDate", "isTrial", "lifecycleState", "orgId", "packageVersionId", "seatsSnapshot", "startDate", "supersededAt"]) &&
        same(cols("ver"), ["id", "packageId", "versionNumber"]) && same(cols("pkg"), ["id", "name"]), `${cols("usersTable")} | ${cols("sub")} | ${cols("ver")} | ${cols("pkg")}`);
    const thrown = await seats.readSeatAccounting(db, 0).then(() => null, (e: unknown) => e);
    ok("T6 an invalid organization id is refused before any query", thrown instanceof Error);
    ok("T7 a company detail view is still audited (company.viewed) — the Users & seats part adds no unaudited read path", (await n(`select count(*)::int as n from platform_audit_events where action = 'company.viewed' and org_id = $1`, [A.orgId])) >= 1);
  }

  // =====================================================================================================================
  section("U. The legacy A–F analysis (read-only), on the production shape and on the full branch shape");
  {
    const EXPECT_CLASSES: Record<string, string> = {
      A_single_active_owner: "{9101,9108,9109,9110}",
      B_single_active_plus_inactive_owner: "{9102}",
      C_multiple_active_owners: "{9103}",
      D_only_inactive_owner: "{9104}",
      E_no_users: "{9105}",
      F_no_owner_role: "{9106,9107}",
    };
    // (1) The exact production tenant shape (621f156): no Platform Owner object at all.
    const prodUrl = await createDisposableDatabase(prodShapeName);
    createdDbs.push(prodShapeName);
    const push = await pushPreCompanyTenantSchema(prodUrl);
    if (!push.ok) throw new Error("production-shape push failed");
    const fx1 = psql(prodUrl, FIXTURES);
    ok("U1 the PO-02D0 fictional fixtures load into the production shape", fx1.status === 0, fx1.out.slice(-300));
    const c1 = await connectDisposable(prodUrl);
    const before1 = await checksum(c1);
    const a1 = psql(prodUrl, ANALYSIS);
    const after1 = await checksum(c1);
    await c1.end();
    const p01 = rowsOf(a1.out, "P01");
    ok("U2 production shape: it runs (exit 0) and reports the six PO-00 classes exactly as the fixtures were built", a1.status === 0 && p01.length === 6 && p01.every((r) => EXPECT_CLASSES[r[1]] === r[7]), a1.out.slice(0, 600));
    ok("U3 …platform parts are reported as not installed (no mapping, no subscription can exist) and nothing failed on their absence",
      /P02 not installed/.test(a1.out) && /P03 not installed/.test(a1.out) && same(rowsOf(a1.out, "P00")[0]?.slice(2), ["f", "f"]));
    ok("U4 …class A/B are listed as candidates only (4 + 1), seat sizing and the non-canonical role are reported",
      same(rowsOf(a1.out, "P04").map((r) => [r[1], r[2]]), [["A_single_active_owner", "4"], ["B_single_active_plus_inactive_owner", "1"]]) && rowsOf(a1.out, "P05").length === 1 && same(rowsOf(a1.out, "P06").map((r) => [r[1], r[2]]), [["Owner", "1"]]));
    ok("U5 …and it changed nothing (whole-database checksum identical)", before1 === after1 && before1.length > 0);
    // (2) The full branch shape: the foundation installed, two fixture companies with mappings (one valid, one drifted)
    // and one above its seats snapshot — written as the acceptance writes them, in a disposable database.
    const full = await createPlatformTestDatabase("po03a_seats_full", fullShapeName);
    createdDbs.push(fullShapeName);
    const c2 = await connectDisposable(full.url);
    const fx2 = psql(full.url, FIXTURES);
    ok("U6 the fixtures load into the full branch shape", fx2.status === 0, fx2.out.slice(-300));
    const { runSeed } = await import("../scripts/platform/trial-seed");
    const seeded = await runSeed(full.url);
    const v1 = (await c2.query(`select v.id from subscription_package_versions v join subscription_packages p on p.id = v.package_id where p.is_default_trial and v.version_number = 1`)).rows[0].id as string;
    await c2.query(`insert into tenant_primary_owners (org_id, user_id) values (9101, 9201)`);
    // 9103 (class C) gets a third active owner first, so the out-of-band demotion below leaves it in class C.
    await c2.query(`insert into users (org_id, email, password_hash, name, role, is_active) values (9103, 'owner3.c@fixture.test', 'x', 'Owner C3', 'owner', true)`);
    await c2.query(`insert into tenant_primary_owners (org_id, user_id) values (9103, (select min(id) from users where org_id = 9103 and role = 'owner' and is_active))`);
    await c2.query(`update users set role = 'admin' where id = (select user_id from tenant_primary_owners where org_id = 9103)`); // drift (out of band)
    await c2.query(
      `insert into tenant_subscriptions (org_id, package_version_id, version_state, is_trial, cycle, lifecycle_state, start_date, end_date, price_snapshot_sar, seats_snapshot, storage_snapshot_gb, module_groups_snapshot, assignment_source)
       values (9101, $1, 'published', true, 'trial', 'trialing', current_date, current_date + 13, 0, 1, 5, '[]'::jsonb, 'invitation_acceptance')`,
      [v1],
    );
    const before2 = await checksum(c2);
    const a2 = psql(full.url, ANALYSIS);
    const after2 = await checksum(c2);
    await c2.end();
    const p02 = Object.fromEntries(rowsOf(a2.out, "P02").map((r) => [r[1], r]));
    const p03 = Object.fromEntries(rowsOf(a2.out, "P03").map((r) => [r[1], r]));
    ok("U7 full shape: the same six classes; mappings per class with the drifted mapping identified (R02)", seeded.check.state === "complete" && a2.status === 0 &&
      rowsOf(a2.out, "P01").length === 6 && rowsOf(a2.out, "P01").every((r) => EXPECT_CLASSES[r[1]] === r[7]) &&
      p02.A_single_active_owner?.[3] === "1" && p02.A_single_active_owner?.[4] === "1" && p02.C_multiple_active_owners?.[3] === "1" && p02.C_multiple_active_owners?.[5] === "1" && p02.C_multiple_active_owners?.[6] === "{9103}", a2.out.slice(0, 900));
    ok("U8 …current subscriptions per class and the company above its seats snapshot (9101: 2 users, 1 seat) — informational", p03.A_single_active_owner?.[3] === "1" && p03.A_single_active_owner?.[5] === "1" && p03.A_single_active_owner?.[6] === "{9101}");
    ok("U9 …class A candidates exclude the mapped company (3 left), and nothing changed (checksum identical)", rowsOf(a2.out, "P04").find((r) => r[1] === "A_single_active_owner")?.[2] === "3" && before2 === after2);
    ok("U10 the analysis selects no e-mail, name, hash or token column", !/\b(email|name|password_hash|token_hash|mfa_secret)\b\s*(,|from|as)/i.test(readFileSync(ANALYSIS, "utf8").replace(/--.*$/gm, "").replace(/'[^']*'/g, "''")));
  }

  exitCode = summary("verify:platform-seat-accounting");
} catch (e) {
  ok("suite ran to completion", false, describeError(e));
  exitCode = summary("verify:platform-seat-accounting");
} finally {
  await pool.end().catch(() => undefined);
  if (!process.env.PLATFORM_TEST_KEEP_DATABASES) for (const name of createdDbs) await dropDisposableDatabase(name).catch(() => undefined);
}
process.exit(exitCode);
