import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, subscriptionPackagesTable, subscriptionPackageVersionsTable, tenantSubscriptionsTable, usersTable, type Tx } from "@/db";
import { userInvitationsTable } from "@/db/staged/platform-user-invitations";

// ---------------------------------------------------------------------------------------------
// Platform Owner PO-03A — READ-ONLY user-seat accounting: THE one service that counts a company's seats.
// Used by the customer Team page (through src/lib/team/ownership-gate.ts, for the session's own company only), by
// the Platform Owner company detail (companies.ts, behind platform.companies.read) and (PO-03B) by the Platform Owner
// user directory (customer-users.ts, behind platform.users.read — readSeatAccountingForCompanies, the same rule).
//
//  • Occupied seats = every customer user of the company, active AND disabled, plus pending customer-user invitations.
//    PO-03C: a pending invitation is an OPEN (unaccepted, unrevoked), UNEXPIRED row of the staged user_invitations table
//    whose e-mail belongs to no customer user (any letter case) — so nobody is counted twice, and a revoked, expired or
//    accepted invitation reserves nothing. Where the table does not exist (it is staged, not in the platform SQL
//    chain) the term is 0 — none is fabricated.
//  • Allowance = the CURRENT subscription's immutable seats_snapshot (superseded_at IS NULL; at most one per company).
//    Without a current subscription there is NO allowance: nothing is inferred from the package catalogue and no
//    subscription is created (legacy and /register companies stay unsubscribed — Schema §11.7, decision R-2).
//  • Read-only. PO-03D: `enforced` says whether these numbers are ENFORCED for the company — true only when the caller
//    says enforcement is on (CUSTOMER_SEAT_ENFORCEMENT_ENABLED, read by the caller, never here) AND the company has a
//    current subscription. The enforcing check itself is src/lib/platform/seat-enforcement.ts, under the company lock;
//    nothing here refuses, blocks or hides a user.
//  • Writes nothing and locks nothing. The staged rollout is asked of the catalog explicitly (to_regclass on the
//    unqualified names); a failing query is never turned into "no subscription" — errors propagate.
// ---------------------------------------------------------------------------------------------

type Executor = Tx | typeof db;

export type SeatAllowance =
  /** The current subscription's snapshot. */
  | {
      state: "assigned";
      seats: number;
      packageName: string;
      versionNumber: number;
      isTrial: boolean;
      cycle: string;
      lifecycleState: string;
      startDate: string;
      endDate: string;
    }
  /** The company has no current subscription (a legacy or /register company): no allowance exists. */
  | { state: "none" }
  /** The subscription foundation is not installed in this database: no subscription can exist. */
  | { state: "not_installed" };

export type SeatAccounting = {
  orgId: number;
  users: { total: number; active: number; disabled: number };
  /** PO-03C: open, unexpired customer-user invitations whose e-mail no user holds (0 where the staged table is absent). */
  pendingInvitations: number;
  /** total users (active + disabled) + pending invitations */
  occupied: number;
  allowance: SeatAllowance;
  /** seats − occupied, never below 0; null without an allowance */
  remaining: number | null;
  /** occupied − seats when above the allowance, else 0 */
  overBy: number;
  overLimit: boolean;
  /** PO-03D: true only while enforcement is on (the caller's input) AND the company has a current subscription. */
  enforced: boolean;
};

/** The pure rule (one place): who occupies a seat and how the allowance compares. */
export function computeSeatAccounting(orgId: number, users: { total: number; active: number }, pendingInvitations: number, allowance: SeatAllowance, enforcement = false): SeatAccounting {
  const total = Math.max(0, Math.trunc(users.total));
  const active = Math.min(total, Math.max(0, Math.trunc(users.active)));
  const pending = Math.max(0, Math.trunc(pendingInvitations));
  const occupied = total + pending;
  const seats = allowance.state === "assigned" ? allowance.seats : null;
  const overBy = seats === null ? 0 : Math.max(0, occupied - seats);
  return {
    orgId,
    users: { total, active, disabled: total - active },
    pendingInvitations: pending,
    occupied,
    allowance,
    remaining: seats === null ? null : Math.max(0, seats - occupied),
    overBy,
    overLimit: overBy > 0,
    enforced: enforcement === true && seats !== null,
  };
}

export type SubscriptionFoundation = "installed" | "absent" | "partial";

/** The catalog's answer for the three tables the allowance is read from (PO-02D1 installs them together). */
export async function subscriptionFoundation(executor: Executor = db): Promise<SubscriptionFoundation> {
  const result = await executor.execute(
    sql`select to_regclass('tenant_subscriptions') is not null as s, to_regclass('subscription_package_versions') is not null as v, to_regclass('subscription_packages') is not null as p`,
  );
  const row = result.rows[0] as { s?: unknown; v?: unknown; p?: unknown } | undefined;
  if (!row || typeof row.s !== "boolean" || typeof row.v !== "boolean" || typeof row.p !== "boolean") throw new Error("subscription foundation probe returned no answer");
  if (row.s && row.v && row.p) return "installed";
  if (!row.s && !row.v && !row.p) return "absent";
  return "partial";
}

const sub = tenantSubscriptionsTable;
const ver = subscriptionPackageVersionsTable;
const pkg = subscriptionPackagesTable;

// The allowance columns of a current subscription — one list for the single-company and the directory reads.
const ALLOWANCE_FIELDS = {
  seats: sub.seatsSnapshot,
  isTrial: sub.isTrial,
  cycle: sub.cycle,
  lifecycleState: sub.lifecycleState,
  startDate: sub.startDate,
  endDate: sub.endDate,
  versionNumber: ver.versionNumber,
  packageName: pkg.name,
};
type AllowanceRow = { seats: number; isTrial: boolean; cycle: string; lifecycleState: string; startDate: string; endDate: string; versionNumber: number; packageName: string };

/** A current subscription row → its allowance; a missing or non-positive seats snapshot is a malformed foundation. */
function assignedAllowance(r: AllowanceRow): SeatAllowance {
  if (!Number.isSafeInteger(r.seats) || r.seats <= 0) throw new Error("the current subscription has no valid seats snapshot");
  return { state: "assigned", seats: r.seats, packageName: r.packageName, versionNumber: r.versionNumber, isTrial: r.isTrial, cycle: r.cycle, lifecycleState: r.lifecycleState, startDate: r.startDate, endDate: r.endDate };
}

/** The company's current subscription allowance as committed (no lock). */
async function currentAllowance(executor: Executor, orgId: number): Promise<SeatAllowance> {
  const foundation = await subscriptionFoundation(executor);
  if (foundation === "absent") return { state: "not_installed" };
  // Only some of the tables: not what PO-02D1 installs (one transaction) — never guessed around.
  if (foundation === "partial") throw new Error("the subscription foundation is only partly installed");
  const rows = await executor
    .select(ALLOWANCE_FIELDS)
    .from(sub)
    .innerJoin(ver, eq(ver.id, sub.packageVersionId))
    .innerJoin(pkg, eq(pkg.id, ver.packageId))
    .where(and(eq(sub.orgId, orgId), isNull(sub.supersededAt)))
    .limit(2);
  // tenant_subscriptions_current_uq allows one current row per company: two mean a malformed foundation.
  if (rows.length > 1) throw new Error("more than one current subscription for one company");
  const r = rows[0];
  if (!r) return { state: "none" };
  return assignedAllowance(r);
}

/** PO-03B — the current allowances of several companies as committed (no lock): one probe and one query. */
async function currentAllowances(executor: Executor, orgIds: number[]): Promise<Map<number, SeatAllowance>> {
  const foundation = await subscriptionFoundation(executor);
  if (foundation === "absent") return new Map(orgIds.map((id) => [id, { state: "not_installed" } as SeatAllowance]));
  if (foundation === "partial") throw new Error("the subscription foundation is only partly installed");
  const rows = await executor
    .select({ orgId: sub.orgId, ...ALLOWANCE_FIELDS })
    .from(sub)
    .innerJoin(ver, eq(ver.id, sub.packageVersionId))
    .innerJoin(pkg, eq(pkg.id, ver.packageId))
    .where(and(inArray(sub.orgId, orgIds), isNull(sub.supersededAt)));
  const out = new Map<number, SeatAllowance>(orgIds.map((id) => [id, { state: "none" } as SeatAllowance]));
  const seen = new Set<number>();
  for (const r of rows) {
    if (seen.has(r.orgId)) throw new Error("more than one current subscription for one company");
    seen.add(r.orgId);
    out.set(r.orgId, assignedAllowance(r));
  }
  return out;
}

/** PO-03C: whether the staged user_invitations table exists in this database (the catalog's answer). */
export async function userInvitationReservationsInstalled(executor: Executor = db): Promise<boolean> {
  const result = await executor.execute(sql`select to_regclass('user_invitations') is not null as present`);
  const present = (result.rows[0] as { present?: unknown } | undefined)?.present;
  if (typeof present !== "boolean") throw new Error("user_invitations probe returned no answer");
  return present;
}

/**
 * PO-03C — the seats reserved by pending customer-user invitations, per company: open (unaccepted, unrevoked) and
 * unexpired at `at`, and only when no customer user holds the e-mail (any letter case) — such an invitation can never
 * be accepted, and its person may already be counted as a user. Read-only, no lock; nothing where the table is absent.
 * PO-03D: `onlyIds` narrows the count to the given invitations — the SAME rule, for the enforcing check's exclusions.
 */
async function pendingReservations(executor: Executor, orgIds: number[], at: Date, onlyIds?: readonly string[]): Promise<Map<number, number>> {
  if (!(await userInvitationReservationsInstalled(executor))) return new Map();
  const ui = userInvitationsTable;
  const rows = await executor
    .select({ orgId: ui.orgId, n: sql<number>`count(*)::int` })
    .from(ui)
    .where(
      and(
        inArray(ui.orgId, orgIds),
        isNull(ui.acceptedAt),
        isNull(ui.revokedAt),
        sql`${ui.expiresAt} > ${at.toISOString()}::timestamptz`,
        sql`not exists (select 1 from ${usersTable} u where lower(u.email) = ${ui.emailNormalized})`,
        ...(onlyIds ? [inArray(ui.id, [...onlyIds])] : []),
      ),
    )
    .groupBy(ui.orgId);
  return new Map(rows.map((r) => [r.orgId, Number(r.n)]));
}

/**
 * PO-03D — how many of the given invitations currently reserve one of THIS company's seats (the same rule as the
 * count): the invitations a transaction is about to replace or convert, so the enforcing check never counts a seat twice.
 */
export async function reservationsAmong(executor: Executor, orgId: number, invitationIds: readonly string[], at: Date): Promise<number> {
  const ids = [...new Set(invitationIds)];
  if (!ids.length) return 0;
  return (await pendingReservations(executor, [orgId], at, ids)).get(orgId) ?? 0;
}

/**
 * One company's seat accounting. The caller decides WHICH company: the customer gate passes the session's own
 * organization only; the platform read model passes the authorized company detail's id. PO-03C: pending invitations
 * are counted at `at` (default: now). PO-03D: `enforcement` is the caller's reading of the enforcement switch.
 */
export async function readSeatAccounting(executor: Executor, orgId: number, at: Date = new Date(), enforcement = false): Promise<SeatAccounting> {
  if (!Number.isSafeInteger(orgId) || orgId <= 0) throw new Error("readSeatAccounting: invalid organization id");
  const [counts] = await executor
    .select({ total: sql<number>`count(*)::int`, active: sql<number>`(count(*) filter (where ${usersTable.isActive}))::int` })
    .from(usersTable)
    .where(eq(usersTable.orgId, orgId));
  const allowance = await currentAllowance(executor, orgId);
  const pending = (await pendingReservations(executor, [orgId], at)).get(orgId) ?? 0;
  return computeSeatAccounting(orgId, { total: Number(counts?.total ?? 0), active: Number(counts?.active ?? 0) }, pending, allowance, enforcement);
}

/**
 * PO-03B — the seat accounting of several companies at once, for the Platform Owner user directory: the same rule
 * (computeSeatAccounting), a fixed number of queries whatever the page size (counts, the foundation probe, the
 * allowances; PO-03C: the invitation-table probe and the reservations). Display only; the caller passes the companies
 * of the rows it is showing.
 */
export async function readSeatAccountingForCompanies(executor: Executor, orgIds: number[], at: Date = new Date(), enforcement = false): Promise<Map<number, SeatAccounting>> {
  const ids = [...new Set(orgIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return new Map();
  const counts = await executor
    .select({ orgId: usersTable.orgId, total: sql<number>`count(*)::int`, active: sql<number>`(count(*) filter (where ${usersTable.isActive}))::int` })
    .from(usersTable)
    .where(inArray(usersTable.orgId, ids))
    .groupBy(usersTable.orgId);
  const allowances = await currentAllowances(executor, ids);
  const reserved = await pendingReservations(executor, ids, at);
  const byOrg = new Map(counts.map((c) => [c.orgId, c]));
  return new Map(
    ids.map((orgId) => {
      const c = byOrg.get(orgId);
      return [orgId, computeSeatAccounting(orgId, { total: Number(c?.total ?? 0), active: Number(c?.active ?? 0) }, reserved.get(orgId) ?? 0, allowances.get(orgId) ?? { state: "none" }, enforcement)];
    }),
  );
}
