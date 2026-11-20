/**
 * Platform Owner PO-03D — user-seat ENFORCEMENT on real PostgreSQL: the one enforcing check
 * (src/lib/platform/seat-enforcement.ts) over the read-only seat accounting (src/lib/platform/seat-accounting.ts).
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://…/<admin db with _test_only_> npm run verify:platform-seat-enforcement
 *
 * Disposable databases only (all dropped at the end): the reviewed schema and platform SQL chain plus the PO-02D1B
 * Trial seed, then the staged PO-03C user_invitations SQL applied by THIS suite (it is not in the chain). Fictional
 * companies and users; TEST-ONLY secrets generated in memory and never printed. Every race runs in a known
 * interleaving: a barrier (a held lock) is observed waiting in pg_stat_activity before it is released.
 *
 * Categories (docs/platform-owner/PO03D_DEVELOPMENT.md §F, §G, §J): P the pure policy · L the company lock (mode, what
 * it blocks and what it never blocks, the bounded wait) · E the enforcing check on real rows (who occupies a seat,
 * exclusions, expiry, legacy companies, the switch, fresh values under the lock) · Z fail closed (a missing, partial or
 * malformed foundation is never "unlimited").
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { connectDisposable, createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { describeError, ok, section, summary } from "./platform/harness";

const ROOT = process.cwd();
const testDbName = disposableName("po03d_seats");
process.env.DATABASE_URL = databaseUrlFor(testDbName);
process.env.PLATFORM_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.FIELD_ENCRYPTION_KEYS = `1:${randomBytes(32).toString("base64")}`;
process.env.CUSTOMER_SEAT_ENFORCEMENT_ENABLED = "true";
delete process.env.PLATFORM_CONSOLE_ENABLED;
delete process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED;
delete process.env.CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED;
delete process.env.CUSTOMER_LEGACY_TOKENS;

let created = false;
await createPlatformTestDatabase("po03d_seats", testDbName);
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

const { db, pool } = await import("../src/db");
const seats = await import("../src/lib/platform/seat-accounting");
const enforcement = await import("../src/lib/platform/seat-enforcement");
const { PlatformError } = await import("../src/lib/platform/errors");
(pool as unknown as { options: { max: number } }).options.max = 30;
pool.on("error", () => undefined);
pool.on("connect", (client) => client.on("error", () => undefined));

// ---- helpers -------------------------------------------------------------------------------------------------------
const q = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
const one = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await q<T>(text, values))[0];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
let seq = 0;
const tag = () => `${Date.now().toString(36)}${++seq}`;
/** A PlatformError's code, else the SQLSTATE of the (possibly wrapped) database error, else the class. */
function codeOfError(e: unknown): string {
  if (e instanceof PlatformError) return e.code;
  for (let x: unknown = e, depth = 0; x && depth < 5; x = (x as { cause?: unknown }).cause, depth++) {
    const code = (x as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return e instanceof Error ? e.name : "ERR";
}

const bcryptPad = (stem: string) => "$2b$10$" + (stem + "Q".repeat(53)).slice(0, 53);
const HASH = bcryptPad("SeatEnforcementFixtureHash");
async function newOrg(name = `Seat Fixture ${tag()}`): Promise<number> {
  return Number((await one<{ id: number }>(`insert into orgs (name, country, currency) values ($1, 'Saudi Arabia', 'SAR') returning id`, [name]))!.id);
}
async function newUser(orgId: number, role: string, email: string, active = true): Promise<number> {
  return Number((await one<{ id: number }>(`insert into users (org_id, email, password_hash, name, role, is_active) values ($1, $2, $3, $4, $5, $6) returning id`, [orgId, email, HASH, `Fixture ${role} ${tag()}`, role, active]))!.id);
}
const trialV1 = async () => (await one<{ id: string }>(`select v.id from subscription_package_versions v join subscription_packages p on p.id = v.package_id where p.is_default_trial and v.version_number = 1`))!.id;
async function subscribe(orgId: number, seatsSnapshot: number) {
  await q(
    `insert into tenant_subscriptions (org_id, package_version_id, version_state, is_trial, cycle, lifecycle_state, start_date, end_date, price_snapshot_sar, seats_snapshot, storage_snapshot_gb, module_groups_snapshot, assignment_source)
     values ($1, $2, 'published', true, 'trial', 'trialing', current_date, current_date + 13, 0, $3, 5, '[]'::jsonb, 'invitation_acceptance')`,
    [orgId, await trialV1(), seatsSnapshot],
  );
}
/** A subscription change as the documented contract requires: the company row FOR NO KEY UPDATE first. */
const SUPERSEDE_SQL = `update tenant_subscriptions set superseded_at = now(), updated_at = now() where org_id = $1 and superseded_at is null`;
const NEW_CURRENT_SQL = `insert into tenant_subscriptions (org_id, package_version_id, version_state, is_trial, cycle, lifecycle_state, start_date, end_date, price_snapshot_sar, seats_snapshot, storage_snapshot_gb, module_groups_snapshot, assignment_source)
  values ($1, $2, 'published', true, 'trial', 'trialing', current_date, current_date + 13, 0, $3, 5, '[]'::jsonb, 'invitation_acceptance')`;
let keeperAdmin = "";
async function directInvitation(orgId: number, email: string, opts: { createdAgoMs?: number; ttlMs?: number } = {}) {
  const createdAt = new Date(Date.now() - (opts.createdAgoMs ?? 0));
  const expiresAt = new Date(createdAt.getTime() + (opts.ttlMs ?? 72 * 3_600_000));
  return (await one<{ id: string }>(
    `insert into user_invitations (org_id, name, email_normalized, requested_role, token_hash, expires_at, invited_by_platform_admin_id, created_at) values ($1, 'Fixture Invitee', $2, 'staff', $3, $4, $5, $6) returning id`,
    [orgId, email, sha256(randomBytes(32).toString("base64url")), expiresAt, keeperAdmin, createdAt],
  ))!.id;
}
const revokeDirect = (id: string) => q(`update user_invitations set revoked_at = greatest(now(), created_at), revoked_by_platform_admin_id = $2 where id = $1`, [id, keeperAdmin]);

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
const ORG_NO_KEY = /from "orgs"[\s\S]*for no key update/i;

/** Run `fn` inside one READ COMMITTED transaction of the application pool, rolled back unless `commit`. */
async function inTx<T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>, commit = false): Promise<{ ok: true; value: T } | { ok: false; code: string }> {
  const ROLLBACK = Symbol("rollback");
  let value: T | undefined;
  try {
    await db.transaction(async (tx) => {
      value = await fn(tx);
      if (!commit) throw ROLLBACK;
    }, { isolationLevel: "read committed" });
    return { ok: true, value: value as T };
  } catch (e) {
    if (e === ROLLBACK) return { ok: true, value: value as T };
    return { ok: false, code: codeOfError(e) };
  }
}
/** The enforcing check for one company, as every path calls it: the lock, then the check. */
async function check(orgId: number, path: (typeof enforcement.SEAT_CHANGE_PATHS)[number], adds = 1, replacing: string[] = [], at = new Date()) {
  return inTx(async (tx) => {
    const lock = await enforcement.lockCompanyForSeatChange(tx, orgId);
    if (!lock) throw new Error("no company");
    return enforcement.assertUserSeatAvailable(tx, lock, adds, { path, at, replacingInvitationIds: replacing });
  });
}
const outcome = (r: Awaited<ReturnType<typeof check>>) => (r.ok ? (r.value.enforced ? `OK ${r.value.occupiedAfter}/${r.value.seats}` : `OK legacy:${r.value.reason}`) : r.code);

async function main() {
  keeperAdmin = (await one<{ id: string }>(
    `insert into platform_admins (email_normalized, display_name, password_hash, is_active, created_at, updated_at) values ('keeper@seats-fixture.test', 'Fixture Keeper', $1, false, now(), now()) returning id`,
    [HASH],
  ))!.id;

  // ===================================================================================================================
  section("P. The pure policy (seatVerdict): one rule for the locked check and the read-only previews");
  {
    const allowance = (s: number) => ({ state: "assigned" as const, seats: s, packageName: "Trial", versionNumber: 1, isTrial: true, cycle: "trial", lifecycleState: "trialing", startDate: "2026-11-20", endDate: "2026-12-03" });
    const acc = (occupied: number, a: Parameters<typeof seats.computeSeatAccounting>[3]) => seats.computeSeatAccounting(1, { total: occupied, active: occupied }, 0, a, true);
    const v = enforcement.seatVerdict;
    const paths = enforcement.SEAT_CHANGE_PATHS;
    ok("P1 switch off: every path is allowed and nothing is enforced, whatever the numbers (even unreadable)", paths.every((p) => { const r = v(false, null, p, 1, 0); return r.ok && !r.enforced && r.reason === "enforcement_off"; }) && v(false, acc(9, allowance(3)), "team_add", 1, 0).ok);
    ok("P2 seats that cannot be read (a malformed or partial foundation) refuse EVERY path — never 'unlimited'", paths.every((p) => { const r = v(true, null, p, 1, 0); return !r.ok && r.code === "SEAT_ENFORCEMENT_UNAVAILABLE"; }));
    ok("P3 a foundation that is not installed refuses every path too", paths.every((p) => { const r = v(true, acc(1, { state: "not_installed" }), p, 1, 0); return !r.ok && r.code === "SEAT_ENFORCEMENT_UNAVAILABLE"; }));
    const legacy = acc(5, { state: "none" });
    ok("P4 no current subscription: the Team keeps working as before (legacy, not enforced); a user invitation — create, re-issue or acceptance — is refused SUBSCRIPTION_REQUIRED",
      (() => { const t = v(true, legacy, "team_add", 1, 0); return t.ok && !t.enforced && t.reason === "legacy_no_subscription"; })() &&
        (["invitation_create", "invitation_reissue", "invitation_accept"] as const).every((p) => { const r = v(true, legacy, p, 1, 0); return !r.ok && r.code === "SUBSCRIPTION_REQUIRED"; }));
    const two = v(true, acc(2, allowance(3)), "invitation_create", 1, 0);
    const three = v(true, acc(3, allowance(3)), "team_add", 1, 0);
    ok("P5 3 seats: two occupied allow exactly one more (3 of 3); three occupied refuse a fourth SEAT_LIMIT", two.ok && two.enforced && two.occupiedAfter === 3 && !three.ok && three.code === "SEAT_LIMIT" && three.seats === 3 && three.occupiedBefore === 3);
    const convert = v(true, acc(3, allowance(3)), "invitation_accept", 1, 1);
    const reissuePending = v(true, acc(3, allowance(3)), "invitation_reissue", 1, 1);
    ok("P6 a reservation the change replaces or converts is not counted twice: acceptance and a pending re-issue on a full company stay at 3 of 3", convert.ok && convert.enforced && convert.occupiedBefore === 2 && convert.occupiedAfter === 3 && reissuePending.ok && reissuePending.enforced && reissuePending.occupiedAfter === 3);
    const over = acc(4, allowance(3));
    ok("P7 a company already above its allowance keeps its users but gets no new seat: create, Team add and even the conversion of a reservation are refused", [v(true, over, "invitation_create", 1, 0), v(true, over, "team_add", 1, 0), v(true, over, "invitation_accept", 1, 1), v(true, over, "invitation_reissue", 1, 1)].every((r) => !r.ok && r.code === "SEAT_LIMIT"));
    const zero = v(true, acc(3, allowance(3)), "invitation_reissue", 0, 0);
    ok("P8 a change that adds nothing is allowed exactly while the company is within its allowance", zero.ok && !v(true, acc(4, allowance(3)), "invitation_reissue", 0, 0).ok);
    let refusedAdds = 0;
    for (const n of [2, -1, 1.5]) {
      try {
        await enforcement.previewUserSeat(db, 1, n, { path: "team_add", at: new Date() });
      } catch {
        refusedAdds++;
      }
    }
    ok("P9 one seat at most per change: 2, −1 and 1.5 are programming errors, refused before any query", refusedAdds === 3);
    const e1 = seats.computeSeatAccounting(1, { total: 1, active: 1 }, 0, allowance(3), true);
    const e2 = seats.computeSeatAccounting(1, { total: 1, active: 1 }, 0, { state: "none" }, true);
    const e3 = seats.computeSeatAccounting(1, { total: 1, active: 1 }, 0, allowance(3), false);
    const e4 = seats.computeSeatAccounting(1, { total: 1, active: 1 }, 0, allowance(3));
    ok("P10 the accounting says `enforced` only when the caller's switch is on AND a subscription exists (no false 'enforced' badge; the default is off)", e1.enforced && !e2.enforced && !e3.enforced && !e4.enforced);
  }

  // ===================================================================================================================
  section("L. The company lock: FOR NO KEY UPDATE, taken directly, bounded");
  {
    const A = await newOrg("Seat Fixture Lock");
    const ownerA = await newUser(A, "owner", `owner.lock.${tag()}@seats-fixture.test`);
    await subscribe(A, 3);
    // Hold the lock through the module, then probe it from other connections.
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    let lockedOrg = 0;
    const holder = db.transaction(async (tx) => {
      const lock = await enforcement.lockCompanyForSeatChange(tx, A);
      lockedOrg = lock?.orgId ?? 0;
      await held;
    });
    await until(async () => lockedOrg === A);
    const share = blocker([]);
    const shareClient = await share;
    const shareQuery = shareClient.client.query(`select id from orgs where id = $1 for share`, [A]);
    const shareWaits = await until(async () => (await lockWaiters(/from orgs where id = \$1 for share/i)) === 1);
    const noKey = await blocker([]);
    const noKeyQuery = noKey.client.query(`select id from orgs where id = $1 for no key update`, [A]);
    const noKeyWaits = await until(async () => (await lockWaiters(/from orgs where id = \$1 for no key update/i)) === 1);
    // A foreign-key insert referencing the company takes KEY SHARE only: never blocked by the seat lock.
    const fk = await blocker([]);
    let fkDone = false;
    const fkQuery = fk.client.query(`insert into users (org_id, email, password_hash, name, role) values ($1, $2, $3, 'Fixture FK', 'staff')`, [A, `fk.${tag()}@seats-fixture.test`, HASH]).then(() => (fkDone = true));
    const fkFree = await until(async () => fkDone, 3_000);
    ok("L1 the seat lock is the company row FOR NO KEY UPDATE: PO-02C.1 session issuance (FOR SHARE) and every other user change of the company (FOR NO KEY UPDATE) wait for it", lockedOrg === A && shareWaits && noKeyWaits);
    ok("L2 …and it never blocks the KEY SHARE lock of an ordinary foreign-key insert into the company", fkFree);
    release();
    await holder;
    // Release the probes in the order they queue: the SHARE probe is granted first; the NO KEY UPDATE probe then waits
    // for the SHARE probe's transaction, so that one must end before the second can be awaited.
    await shareQuery.catch(() => undefined);
    await shareClient.release();
    await noKeyQuery.catch(() => undefined);
    await noKey.release();
    await fkQuery.catch(() => undefined);
    await fk.release();
    // A bounded wait: a holder that keeps the row longer than SEAT_LOCK_TIMEOUT makes the change fail cleanly.
    const longHolder = await blocker([{ text: `select id from orgs where id = $1 for no key update`, values: [A] }]);
    const t0 = Date.now();
    const timedOut = await check(A, "team_add");
    const waited = Date.now() - t0;
    await longHolder.release();
    ok("L3 a lock wait is bounded (SEAT_LOCK_TIMEOUT 5s): a company row held longer fails the change with lock_not_available (55P03), nothing waits forever", enforcement.SEAT_LOCK_TIMEOUT === "5s" && !timedOut.ok && timedOut.code === "55P03" && waited >= 4_500 && waited < 15_000, `${JSON.stringify(timedOut)} ${waited}ms`);
    const missing = await inTx(async (tx) => [await enforcement.lockCompanyForSeatChange(tx, 2_000_000_000), await enforcement.lockCompanyForSeatChange(tx, 0), await enforcement.lockCompanyForSeatChange(tx, -5)]);
    ok("L4 an unknown or invalid company id locks nothing and yields no lock", missing.ok && missing.value.every((x) => x === null));
    void ownerA;
  }

  // ===================================================================================================================
  section("E. The enforcing check on real rows (CUSTOMER_SEAT_ENFORCEMENT_ENABLED=true)");
  {
    // Company A: 3 seats — an active owner and a DISABLED staff member (2), one pending invitation (3), plus an expired
    // one, a revoked one and one whose e-mail a user (of another company) already holds: none of those three counts.
    const A = await newOrg("Seat Fixture Alpha");
    await newUser(A, "owner", `owner.alpha.${tag()}@seats-fixture.test`);
    await newUser(A, "staff", `disabled.alpha.${tag()}@seats-fixture.test`, false);
    await subscribe(A, 3);
    const pending = await directInvitation(A, `pending.alpha.${tag()}@seats-fixture.test`);
    const expired = await directInvitation(A, `expired.alpha.${tag()}@seats-fixture.test`, { createdAgoMs: 80 * 3_600_000 });
    const revoked = await directInvitation(A, `revoked.alpha.${tag()}@seats-fixture.test`);
    await revokeDirect(revoked);
    const B = await newOrg("Seat Fixture Beta");
    const heldEmail = `held.${tag()}@seats-fixture.test`;
    await newUser(B, "owner", heldEmail.toUpperCase());
    await directInvitation(A, heldEmail);

    const acc = await seats.readSeatAccounting(db, A, new Date(), true);
    ok("E1 who occupies a seat: active AND disabled users plus the open, unexpired invitation no user holds — 1 + 1 + 1 = 3 of 3 (the expired, the revoked and the user-held invitation reserve nothing)",
      acc.users.total === 2 && acc.users.disabled === 1 && acc.pendingInvitations === 1 && acc.occupied === 3 && acc.allowance.state === "assigned" && acc.allowance.seats === 3 && acc.remaining === 0 && acc.enforced, JSON.stringify(acc).slice(0, 300));
    const create = await check(A, "invitation_create");
    const team = await check(A, "team_add");
    ok("E2 three of three occupied: a new invitation and a Team addition are both refused SEAT_LIMIT", outcome(create) === "SEAT_LIMIT" && outcome(team) === "SEAT_LIMIT");
    const accept = await check(A, "invitation_accept", 1, [pending]);
    const reissuePending = await check(A, "invitation_reissue", 1, [pending]);
    ok("E3 converting or re-issuing the pending invitation replaces its own reservation: allowed at 3 of 3 (counted once)", outcome(accept) === "OK 3/3" && outcome(reissuePending) === "OK 3/3");
    const reissueExpired = await check(A, "invitation_reissue", 1, [expired]);
    const reissueRevoked = await check(A, "invitation_reissue", 1, [revoked]);
    ok("E4 re-issuing an EXPIRED or a REVOKED invitation creates a new reservation and needs a free seat: refused at 3 of 3", outcome(reissueExpired) === "SEAT_LIMIT" && outcome(reissueRevoked) === "SEAT_LIMIT");
    const otherCompany = await check(A, "invitation_accept", 1, [await directInvitation(B, `beta.${tag()}@seats-fixture.test`)]);
    ok("E5 an invitation of ANOTHER company is never subtracted from this company's seats", outcome(otherCompany) === "SEAT_LIMIT");
    await revokeDirect(pending);
    const afterRevoke = await check(A, "invitation_create");
    ok("E6 a revoked invitation frees its seat at once: 2 occupied → one more allowed (3 of 3)", outcome(afterRevoke) === "OK 3/3");

    // Expiry is a time boundary: judged at the decision time.
    const C = await newOrg("Seat Fixture Expiry");
    await newUser(C, "owner", `owner.expiry.${tag()}@seats-fixture.test`);
    await newUser(C, "admin", `admin.expiry.${tag()}@seats-fixture.test`);
    await subscribe(C, 3);
    const expiring = await directInvitation(C, `expiring.${tag()}@seats-fixture.test`, { createdAgoMs: 60_000, ttlMs: 3_600_000 });
    const exp = (await one<{ e: Date }>(`select expires_at as e from user_invitations where id = $1`, [expiring]))!.e;
    const justBefore = await check(C, "invitation_create", 1, [], new Date(exp.getTime() - 1));
    const atBoundary = await check(C, "invitation_create", 1, [], new Date(exp.getTime()));
    ok("E7 an invitation reserves its seat until its expiry instant: one millisecond before it the company is full (refused); at it the seat is free (allowed)", outcome(justBefore) === "SEAT_LIMIT" && outcome(atBoundary) === "OK 3/3");

    // A disabled user keeps occupying a seat.
    const D = await newOrg("Seat Fixture Disabled");
    await newUser(D, "owner", `owner.disabled.${tag()}@seats-fixture.test`);
    await newUser(D, "staff", `d1.${tag()}@seats-fixture.test`, false);
    await newUser(D, "staff", `d2.${tag()}@seats-fixture.test`, false);
    await subscribe(D, 3);
    ok("E8 deactivated users keep their seats: one active owner and two disabled members fill 3 seats (a fourth is refused)", outcome(await check(D, "team_add")) === "SEAT_LIMIT");

    // A company over its allowance (grandfathered): keeps its users, gets nothing new.
    const O = await newOrg("Seat Fixture Over");
    for (let i = 0; i < 4; i++) await newUser(O, i === 0 ? "owner" : "staff", `over${i}.${tag()}@seats-fixture.test`);
    await subscribe(O, 3);
    const overAcc = await seats.readSeatAccounting(db, O, new Date(), true);
    ok("E9 a company already above its allowance (4 users, 3 seats) is shown over by 1, keeps all 4 users and gets no new seat on any path",
      overAcc.overBy === 1 && overAcc.users.total === 4 && outcome(await check(O, "invitation_create")) === "SEAT_LIMIT" && outcome(await check(O, "team_add")) === "SEAT_LIMIT" &&
        Number((await one<{ n: number }>(`select count(*)::int as n from users where org_id = $1`, [O]))!.n) === 4);

    // No current subscription: a legacy company.
    const L = await newOrg("Seat Fixture Legacy");
    await newUser(L, "owner", `owner.legacy.${tag()}@seats-fixture.test`);
    ok("E10 a company without a current subscription: the Team adds as before (legacy, not enforced); an invitation is refused SUBSCRIPTION_REQUIRED",
      outcome(await check(L, "team_add")) === "OK legacy:legacy_no_subscription" && outcome(await check(L, "invitation_create")) === "SUBSCRIPTION_REQUIRED" && outcome(await check(L, "invitation_accept")) === "SUBSCRIPTION_REQUIRED");

    // The switch.
    process.env.CUSTOMER_SEAT_ENFORCEMENT_ENABLED = "TRUE";
    const offUpper = await check(D, "team_add");
    process.env.CUSTOMER_SEAT_ENFORCEMENT_ENABLED = "";
    const offEmpty = await check(D, "team_add");
    delete process.env.CUSTOMER_SEAT_ENFORCEMENT_ENABLED;
    const offUnset = await check(D, "invitation_create");
    const offAcc = await seats.readSeatAccounting(db, D, new Date(), enforcement.seatEnforcementEnabled());
    process.env.CUSTOMER_SEAT_ENFORCEMENT_ENABLED = "true";
    ok("E11 only the exact string \"true\" switches enforcement on: unset, empty or 'TRUE' allow everything and the accounting shows nothing as enforced",
      [offUpper, offEmpty, offUnset].every((r) => outcome(r) === "OK legacy:enforcement_off") && !offAcc.enforced && offAcc.overBy === 0 && offAcc.occupied === 3);

    // The preview: the same policy, read-only, no lock.
    const holder = await blocker([{ text: `select id from orgs where id = $1 for no key update`, values: [D] }]);
    const t0 = Date.now();
    const preview = await enforcement.previewUserSeat(db, D, 1, { path: "team_add", at: new Date() });
    const fast = Date.now() - t0 < 2_000;
    await holder.release();
    ok("E12 the preview applies the same policy without a lock (it never waits for a held company row) and decides nothing", fast && !preview.ok && preview.code === "SEAT_LIMIT" && preview.seats === 3 && preview.occupiedBefore === 3);

    // Fresh values under the lock: a subscription change that followed the contract (company row first) is seen.
    const S = await newOrg("Seat Fixture Upgrade");
    await newUser(S, "owner", `owner.upgrade.${tag()}@seats-fixture.test`);
    await newUser(S, "staff", `s1.${tag()}@seats-fixture.test`);
    await newUser(S, "staff", `s2.${tag()}@seats-fixture.test`);
    await subscribe(S, 3);
    const v1 = await trialV1();
    const change = await blocker([
      { text: `select id from orgs where id = $1 for no key update`, values: [S] },
      { text: SUPERSEDE_SQL, values: [S] },
      { text: NEW_CURRENT_SQL, values: [S, v1, 5] },
    ]);
    const racing = check(S, "team_add");
    const waits = await until(async () => (await lockWaiters(ORG_NO_KEY)) === 1);
    await change.release(true);
    const afterUpgrade = await racing;
    ok("E13 fresh values under the lock: an allocation waiting behind a subscription change (5 seats, committed while it waited) decides on the NEW allowance (4 of 5)", waits && outcome(afterUpgrade) === "OK 4/5", outcome(afterUpgrade));
    const down = await blocker([
      { text: `select id from orgs where id = $1 for no key update`, values: [S] },
      { text: SUPERSEDE_SQL, values: [S] },
      { text: NEW_CURRENT_SQL, values: [S, v1, 3] },
    ]);
    const racing2 = check(S, "invitation_create");
    const waits2 = await until(async () => (await lockWaiters(ORG_NO_KEY)) === 1);
    await down.release(true);
    ok("E14 …and a downgrade committed while it waited (back to 3 seats, 3 occupied) refuses it SEAT_LIMIT", waits2 && outcome(await racing2) === "SEAT_LIMIT");
  }

  // ===================================================================================================================
  section("Z. Fail closed: a missing, partial or malformed foundation is never read as unlimited");
  {
    const Z = await newOrg("Seat Fixture Foundation");
    await newUser(Z, "owner", `owner.found.${tag()}@seats-fixture.test`);
    await subscribe(Z, 3);
    // Partial: one of the three allowance tables renamed away (committed DDL on this disposable database), then back.
    await q(`alter table subscription_packages rename to subscription_packages_po03d_away`);
    const partialOn = await check(Z, "team_add");
    const partialAcc = await seats.readSeatAccounting(db, Z).then(() => "read", (e: unknown) => describeError(e));
    process.env.CUSTOMER_SEAT_ENFORCEMENT_ENABLED = "false";
    const partialOff = await check(Z, "team_add");
    process.env.CUSTOMER_SEAT_ENFORCEMENT_ENABLED = "true";
    await q(`alter table subscription_packages_po03d_away rename to subscription_packages`);
    ok("Z1 a PARTIAL foundation (one allowance table missing) refuses every enforced change SEAT_ENFORCEMENT_UNAVAILABLE; with the switch off the Team works as before",
      outcome(partialOn) === "SEAT_ENFORCEMENT_UNAVAILABLE" && /partly installed/.test(partialAcc) && outcome(partialOff) === "OK legacy:enforcement_off");
    // Absent: all three renamed away — a database without the PO-02 foundation.
    for (const t of ["tenant_subscriptions", "subscription_package_versions", "subscription_packages"]) await q(`alter table ${t} rename to ${t}_po03d_away`);
    const absentOn = await Promise.all((["team_add", "invitation_create", "invitation_accept", "invitation_reissue"] as const).map((p) => check(Z, p)));
    process.env.CUSTOMER_SEAT_ENFORCEMENT_ENABLED = "false";
    const absentOff = await check(Z, "team_add");
    process.env.CUSTOMER_SEAT_ENFORCEMENT_ENABLED = "true";
    for (const t of ["tenant_subscriptions", "subscription_package_versions", "subscription_packages"]) await q(`alter table ${t}_po03d_away rename to ${t}`);
    ok("Z2 NO foundation at all: with enforcement on every path is refused SEAT_ENFORCEMENT_UNAVAILABLE (a missing table is never 'no limit'); switched off, the Team adds as before",
      absentOn.every((r) => outcome(r) === "SEAT_ENFORCEMENT_UNAVAILABLE") && outcome(absentOff) === "OK legacy:enforcement_off");
    // Malformed: a current subscription with a non-positive seats snapshot (the CHECK dropped on this disposable DB).
    await q(`alter table tenant_subscriptions drop constraint tenant_subscriptions_seats_chk`);
    await q(SUPERSEDE_SQL, [Z]);
    await q(NEW_CURRENT_SQL, [Z, await trialV1(), 0]);
    const malformed = await check(Z, "team_add");
    ok("Z3 a MALFORMED current subscription (a seats snapshot of 0) refuses the change SEAT_ENFORCEMENT_UNAVAILABLE — never read as 'no limit'", outcome(malformed) === "SEAT_ENFORCEMENT_UNAVAILABLE");
    await q(SUPERSEDE_SQL, [Z]);
    await q(NEW_CURRENT_SQL, [Z, await trialV1(), 3]);
    await q(`alter table tenant_subscriptions add constraint tenant_subscriptions_seats_chk check (seats_snapshot > 0) not valid`);
    ok("Z4 the refusal changed nothing: the company's users are as before", Number((await one<{ n: number }>(`select count(*)::int as n from users where org_id = $1`, [Z]))!.n) === 1);
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
summary("verify:platform-seat-enforcement");
if (crashed) process.exitCode = 1;
