import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, orgsTable, type Tx } from "@/db";
import { PlatformError } from "./errors";
import { isCustomerSeatEnforcementEnabled } from "./flags";
import { readSeatAccounting, reservationsAmong, type SeatAccounting } from "./seat-accounting";

// ---------------------------------------------------------------------------------------------
// Platform Owner PO-03D (sub-batch B) — user-seat ENFORCEMENT: THE one check that allows or refuses a new seat. Every
// path that adds a customer user or reserves a seat calls it, inside its own transaction, under the company's row lock:
//   • a Platform Owner user-invitation create and re-issue (src/lib/platform/user-invitation-actions.ts),
//   • a public user-invitation acceptance (src/lib/platform/user-invitation-acceptance.ts),
//   • the customer Team "add member" (src/app/(app)/settings/team/actions.ts → src/lib/team/member-add.ts, through the
//     Team ownership gate).
// The numbers are the read-only seat accounting's (seat-accounting.ts — ONE rule: users active and disabled + open,
// unexpired invitations whose e-mail no user holds), read FRESH inside the transaction after the lock; nothing a client
// or an earlier preview supplied is ever trusted.
//
// The lock: the company row FOR NO KEY UPDATE, taken DIRECTLY (never FOR SHARE first and upgraded later), after the
// path's e-mail advisory lock and before any invitation or user row. It is the row and the mode of the PO-02C access
// change and of every PO-03A/PO-03B/PO-03C customer-user change, it conflicts with the FOR SHARE of PO-02C.1 session
// issuance, and it never blocks the KEY SHARE locks of ordinary foreign-key inserts. So all seat changes of one company
// queue on one row: two allocations can never both take the last seat. A future subscription change must take the same
// lock before it changes a company's subscription (documented contract), so an allocation decides on the allowance as
// committed. Lock waits are bounded (SEAT_LOCK_TIMEOUT); a timeout or a deadlock rolls the caller's transaction back.
//
// The policy (provisional, development only — docs/platform-owner/PO03D_DEVELOPMENT.md §G, §J), while
// CUSTOMER_SEAT_ENFORCEMENT_ENABLED is exactly "true":
//   • a current subscription: occupied (without the rows this transaction replaces or converts) + adds ≤ seats_snapshot,
//     else SEAT_LIMIT — a company already above its allowance keeps its users but gets no new seat;
//   • no current subscription (a legacy or /register company): the Team keeps working as before; a user invitation —
//     create, re-issue or acceptance — is refused (SUBSCRIPTION_REQUIRED);
//   • a missing, partial or malformed foundation is never read as "unlimited": SEAT_ENFORCEMENT_UNAVAILABLE.
// While the flag is off nothing is refused here (seats are counted and shown only — the behaviour before PO-03D).
// ---------------------------------------------------------------------------------------------

/** The bounded lock wait of every seat-allocating transaction (the same as the customer-user service's). */
export const SEAT_LOCK_TIMEOUT = "5s";

export const SEAT_CHANGE_PATHS = ["invitation_create", "invitation_reissue", "invitation_accept", "team_add"] as const;
export type SeatChangePath = (typeof SEAT_CHANGE_PATHS)[number];

declare const companySeatLockBrand: unique symbol;
/** Proof that THIS transaction holds the company row FOR NO KEY UPDATE (only lockCompanyForSeatChange makes one). */
export type CompanySeatLock = { readonly orgId: number; readonly [companySeatLockBrand]: true };

export type SeatRefusalCode = "SEAT_LIMIT" | "SUBSCRIPTION_REQUIRED" | "SEAT_ENFORCEMENT_UNAVAILABLE";
export type SeatVerdict =
  | { ok: true; enforced: false; reason: "enforcement_off" | "legacy_no_subscription" }
  | { ok: true; enforced: true; seats: number; occupiedBefore: number; occupiedAfter: number }
  | { ok: false; code: SeatRefusalCode; seats: number | null; occupiedBefore: number | null };
export type SeatDecision = Extract<SeatVerdict, { ok: true }>;
export type SeatCheckContext = {
  path: SeatChangePath;
  /** The decision time (read after the locks) — the same instant every reservation is judged at. */
  at: Date;
  /** Invitations this transaction revokes or converts (a re-issued source, the accepted invitation). */
  replacingInvitationIds?: readonly string[];
};

/** Whether seat enforcement is switched on in this environment (CUSTOMER_SEAT_ENFORCEMENT_ENABLED, exactly "true"). */
export function seatEnforcementEnabled(): boolean {
  return isCustomerSeatEnforcementEnabled();
}

/** Bound every later lock wait of this transaction (idempotent; also called before a path's e-mail lock). */
export async function boundSeatLockWait(tx: Tx): Promise<void> {
  await tx.execute(sql`select set_config('lock_timeout', ${SEAT_LOCK_TIMEOUT}, true)`);
}

/**
 * The company row FOR NO KEY UPDATE, directly, with a bounded wait. Null when no such company exists. The caller reads
 * the company's access itself afterwards (a fresh statement, so a suspension that committed first is seen).
 */
export async function lockCompanyForSeatChange(tx: Tx, orgId: number): Promise<CompanySeatLock | null> {
  if (!Number.isSafeInteger(orgId) || orgId <= 0) return null;
  await boundSeatLockWait(tx);
  const [org] = await tx.select({ id: orgsTable.id }).from(orgsTable).where(eq(orgsTable.id, orgId)).for("no key update");
  if (!org) return null;
  return { orgId: org.id } as CompanySeatLock;
}

/**
 * The pure policy (ONE place, for the locked check and the read-only previews alike). `accounting` is null when it
 * could not be read (a malformed or partial foundation, or a failed query) — never "unlimited".
 */
export function seatVerdict(enforcement: boolean, accounting: SeatAccounting | null, path: SeatChangePath, adds: number, replaced: number): SeatVerdict {
  if (!enforcement) return { ok: true, enforced: false, reason: "enforcement_off" };
  if (!accounting || accounting.allowance.state === "not_installed") return { ok: false, code: "SEAT_ENFORCEMENT_UNAVAILABLE", seats: null, occupiedBefore: null };
  if (accounting.allowance.state === "none") {
    if (path === "team_add") return { ok: true, enforced: false, reason: "legacy_no_subscription" };
    return { ok: false, code: "SUBSCRIPTION_REQUIRED", seats: null, occupiedBefore: accounting.occupied };
  }
  const seats = accounting.allowance.seats;
  const occupiedBefore = Math.max(0, accounting.occupied - Math.max(0, replaced));
  const occupiedAfter = occupiedBefore + adds;
  if (occupiedAfter > seats) return { ok: false, code: "SEAT_LIMIT", seats, occupiedBefore };
  return { ok: true, enforced: true, seats, occupiedBefore, occupiedAfter };
}

function checkAdds(adds: number): void {
  if (!Number.isSafeInteger(adds) || adds < 0 || adds > 1) throw new Error("seat check: one seat at most per change");
}

/** The company's seats as committed, or null when the foundation cannot be read (missing, partial or malformed). */
async function freshAccounting(executor: Tx | typeof db, orgId: number, at: Date): Promise<SeatAccounting | null> {
  try {
    return await readSeatAccounting(executor, orgId, at, true);
  } catch {
    return null;
  }
}

/**
 * THE enforcing check, inside the caller's transaction, under the company lock: `adds` new seats (0 or 1) for `path`,
 * not counting the invitations the transaction replaces or converts. Returns the decision for the caller's evidence;
 * throws PlatformError(SEAT_LIMIT | SUBSCRIPTION_REQUIRED | SEAT_ENFORCEMENT_UNAVAILABLE), and the caller's transaction
 * rolls back. While enforcement is off it reads nothing and allows.
 */
export async function assertUserSeatAvailable(tx: Tx, lock: CompanySeatLock, adds: number, context: SeatCheckContext): Promise<SeatDecision> {
  checkAdds(adds);
  if (!seatEnforcementEnabled()) return { ok: true, enforced: false, reason: "enforcement_off" };
  const accounting = await freshAccounting(tx, lock.orgId, context.at);
  const replaced = accounting ? await reservationsAmong(tx, lock.orgId, context.replacingInvitationIds ?? [], context.at) : 0;
  const verdict = seatVerdict(true, accounting, context.path, adds, replaced);
  if (!verdict.ok) throw new PlatformError(verdict.code, `seat check refused (${context.path})`);
  return verdict;
}

/**
 * The same policy, read-only and without a lock — for a preview that must not spend anything on a change that would
 * be refused. It decides nothing: the transaction repeats the check under the lock.
 */
export async function previewUserSeat(executor: Tx | typeof db, orgId: number, adds: number, context: SeatCheckContext): Promise<SeatVerdict> {
  checkAdds(adds);
  if (!seatEnforcementEnabled()) return { ok: true, enforced: false, reason: "enforcement_off" };
  const accounting = await freshAccounting(executor, orgId, context.at);
  const replaced = accounting ? await reservationsAmong(executor, orgId, context.replacingInvitationIds ?? [], context.at).catch(() => 0) : 0;
  return seatVerdict(true, accounting, context.path, adds, replaced);
}

/** True for the three typed refusals of this module. */
export function isSeatRefusal(err: unknown): err is PlatformError & { code: SeatRefusalCode } {
  return err instanceof PlatformError && (err.code === "SEAT_LIMIT" || err.code === "SUBSCRIPTION_REQUIRED" || err.code === "SEAT_ENFORCEMENT_UNAVAILABLE");
}
