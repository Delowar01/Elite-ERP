import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, subscriptionPackagesTable, subscriptionPackageVersionsTable, tenantSubscriptionsTable, usersTable, type Tx } from "@/db";

// ---------------------------------------------------------------------------------------------
// Platform Owner PO-03A — READ-ONLY user-seat accounting: THE one service that counts a company's seats.
// Used by the customer Team page (through src/lib/team/ownership-gate.ts, for the session's own company only), by
// the Platform Owner company detail (companies.ts, behind platform.companies.read) and (PO-03B) by the Platform Owner
// user directory (customer-users.ts, behind platform.users.read — readSeatAccountingForCompanies, the same rule).
//
//  • Occupied seats = every customer user of the company, active AND disabled, plus pending customer-user invitations.
//    Customer-user invitations do not exist yet (PO-00 M6), so that term is 0 — none is fabricated.
//  • Allowance = the CURRENT subscription's immutable seats_snapshot (superseded_at IS NULL; at most one per company).
//    Without a current subscription there is NO allowance: nothing is inferred from the package catalogue and no
//    subscription is created (legacy and /register companies stay unsubscribed — Schema §11.7, decision R-2).
//  • Display only. `enforced` is always false: nothing refuses, blocks or hides a user because of these numbers
//    (enforcement is a later, separately approved phase — docs/platform-owner/PO03A_DEVELOPMENT.md §H.4).
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
  /** Pending customer-user invitations — always 0 until that system exists (PO-00 M6). */
  pendingInvitations: number;
  /** total users (active + disabled) + pending invitations */
  occupied: number;
  allowance: SeatAllowance;
  /** seats − occupied, never below 0; null without an allowance */
  remaining: number | null;
  /** occupied − seats when above the allowance, else 0 */
  overBy: number;
  overLimit: boolean;
  /** PO-03A: display only. */
  enforced: false;
};

/** The pure rule (one place): who occupies a seat and how the allowance compares. */
export function computeSeatAccounting(orgId: number, users: { total: number; active: number }, pendingInvitations: number, allowance: SeatAllowance): SeatAccounting {
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
    enforced: false,
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

/**
 * One company's seat accounting. The caller decides WHICH company: the customer gate passes the session's own
 * organization only; the platform read model passes the authorized company detail's id.
 */
export async function readSeatAccounting(executor: Executor, orgId: number): Promise<SeatAccounting> {
  if (!Number.isSafeInteger(orgId) || orgId <= 0) throw new Error("readSeatAccounting: invalid organization id");
  const [counts] = await executor
    .select({ total: sql<number>`count(*)::int`, active: sql<number>`(count(*) filter (where ${usersTable.isActive}))::int` })
    .from(usersTable)
    .where(eq(usersTable.orgId, orgId));
  const allowance = await currentAllowance(executor, orgId);
  return computeSeatAccounting(orgId, { total: Number(counts?.total ?? 0), active: Number(counts?.active ?? 0) }, 0, allowance);
}

/**
 * PO-03B — the seat accounting of several companies at once, for the Platform Owner user directory: the same rule
 * (computeSeatAccounting), a fixed number of queries whatever the page size (counts, the foundation probe, the
 * allowances). Display only; the caller passes the companies of the rows it is showing.
 */
export async function readSeatAccountingForCompanies(executor: Executor, orgIds: number[]): Promise<Map<number, SeatAccounting>> {
  const ids = [...new Set(orgIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return new Map();
  const counts = await executor
    .select({ orgId: usersTable.orgId, total: sql<number>`count(*)::int`, active: sql<number>`(count(*) filter (where ${usersTable.isActive}))::int` })
    .from(usersTable)
    .where(inArray(usersTable.orgId, ids))
    .groupBy(usersTable.orgId);
  const allowances = await currentAllowances(executor, ids);
  const byOrg = new Map(counts.map((c) => [c.orgId, c]));
  return new Map(
    ids.map((orgId) => {
      const c = byOrg.get(orgId);
      return [orgId, computeSeatAccounting(orgId, { total: Number(c?.total ?? 0), active: Number(c?.active ?? 0) }, 0, allowances.get(orgId) ?? { state: "none" })];
    }),
  );
}
