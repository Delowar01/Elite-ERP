import "server-only";
import { and, asc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, orgsTable, securityEventsTable, sessionsTable, usersTable, type Tx } from "@/db";
import { lockPrimaryOwnerForTeamChange, TeamProtectionUnavailableError } from "./ownership-gate";

// ---------------------------------------------------------------------------------------------
// The shared customer-user mutation service (PO-03B). ONE implementation of what every change to a customer user's
// standing must respect, used by both callers that make such changes:
//   • the customer Team-change service (src/lib/team/member-changes.ts — the Team tab's role and status actions), and
//   • the Platform Owner user controls (src/lib/platform/customer-user-actions.ts — disable / enable and session
//     revocation from the console; the ONE platform module that imports this file).
// Neither has its own lock order, owner rule, status write or session revocation: both call these. PO-03C adds the ONE
// role write (setCustomerUserRole), used by the Team role change, the console's role control and the primary-owner
// transfer; every role or status change now ends the affected account's sessions in the same transaction.
//
// The lock order (PO-03A §F.1), inside the caller's ONE READ COMMITTED transaction:
//   1. a bounded lock wait (this transaction only);
//   2. the company row FOR NO KEY UPDATE — it serializes every user change of the company, queues behind / ahead of the
//      PO-02C access change (same row, same mode) and conflicts with the FOR SHARE that PO-02C.1 session issuance takes,
//      while never blocking the KEY SHARE locks of the company's ordinary foreign-key inserts;
//   3. the affected user rows of THIS company, by ascending id, FOR NO KEY UPDATE — another company's id is simply
//      not found (and never locked);
//   4. the primary-owner mapping FOR SHARE, through the Team ownership gate (fail closed when the foundation is
//      required but missing or malformed), read after the user rows;
//   5. the caller's checks on the locked rows, then the mutation and its evidence — in the same transaction.
// The rules are the same for both callers: the mapped primary owner is never deactivated, and the company's last
// active owner is never deactivated. The customer-side evidence (the customer's own security log) is written here,
// in the caller's transaction, so a change that could not be recorded is never applied.
// ---------------------------------------------------------------------------------------------

export const CUSTOMER_USER_LOCK_TIMEOUT = "5s";

/** Session end reasons (the documented values of sessions.revoked_reason). PO-03C: the Team actions use them too. */
export const USER_DISABLED_REVOKE_REASON = "disabled";
export const USER_REENABLED_REVOKE_REASON = "reenabled";
export const PLATFORM_REVOKED_REASON = "platform_revoked";
/** PO-03C: a role change ends the account's sessions (Team or console), and so does a primary-owner transfer (both accounts). */
export const ROLE_CHANGE_REVOKE_REASON = "role_change";
export const OWNER_TRANSFER_REVOKE_REASON = "owner_transfer";

/** The three customer roles (the ERP's role model; no custom roles). */
export type CustomerRole = "owner" | "admin" | "staff";
export const CUSTOMER_ROLES: readonly CustomerRole[] = ["owner", "admin", "staff"];

/**
 * The account row's change marker: its exact updated_at, to the microsecond, as text. Every status, role or password
 * change moves it (a sign-in does not), so a decision made on a page that showed an older marker is refused.
 */
const VERSION = sql<string>`to_char(${usersTable.updatedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

export type LockedCustomerUser = { id: number; orgId: number; role: string; isActive: boolean; version: string };
export type LockedCompanyUsers = { users: LockedCustomerUser[]; primaryOwnerId: number | null };

/** Which company a customer user belongs to (unlocked — only to know which company row to lock first), or null. */
export async function companyOfCustomerUser(executor: Tx | typeof db, userId: number): Promise<number | null> {
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  const [row] = await executor.select({ orgId: usersTable.orgId }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return row?.orgId ?? null;
}

/**
 * Steps 1–3: the bounded lock wait, the company row, then the given users of THIS company by ascending id. Null when
 * the company does not exist; a requested user who is not a member of this company is simply absent (never looked up
 * elsewhere, never locked).
 */
export async function lockCompanyUsers(tx: Tx, orgId: number, userIds: number[]): Promise<LockedCustomerUser[] | null> {
  await tx.execute(sql`select set_config('lock_timeout', ${CUSTOMER_USER_LOCK_TIMEOUT}, true)`);
  const [company] = await tx.select({ id: orgsTable.id }).from(orgsTable).where(eq(orgsTable.id, orgId)).for("no key update");
  if (!company) return null;
  return tx
    .select({ id: usersTable.id, orgId: usersTable.orgId, role: usersTable.role, isActive: usersTable.isActive, version: VERSION })
    .from(usersTable)
    .where(and(eq(usersTable.orgId, orgId), inArray(usersTable.id, userIds)))
    .orderBy(asc(usersTable.id))
    .for("no key update");
}

/** Step 4: the company's primary owner (user id) under the mapping's FOR SHARE lock, or null (fail closed via the gate). */
export async function lockCompanyPrimaryOwner(tx: Tx, orgId: number): Promise<number | null> {
  const primary = await lockPrimaryOwnerForTeamChange(tx, orgId);
  return primary?.userId ?? null;
}

/** Steps 1–4 at once, for a caller with no checks of its own between them (the Platform Owner status control). */
export async function lockCustomerUsers(tx: Tx, orgId: number, userIds: number[]): Promise<LockedCompanyUsers | null> {
  const users = await lockCompanyUsers(tx, orgId, userIds);
  if (!users) return null;
  return { users, primaryOwnerId: await lockCompanyPrimaryOwner(tx, orgId) };
}

/** True for the gate's fail-closed refusal (the primary-owner check could not be made — nothing may change). */
export function isOwnerProtectionUnavailable(err: unknown): boolean {
  return err instanceof TeamProtectionUnavailableError;
}

/** Whether the company keeps another active owner besides `exceptUserId` (read under the company-row lock). */
export async function hasOtherActiveOwner(tx: Tx, orgId: number, exceptUserId: number): Promise<boolean> {
  const others = await tx
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.orgId, orgId), eq(usersTable.role, "owner"), eq(usersTable.isActive, true), ne(usersTable.id, exceptUserId)))
    .limit(1);
  return others.length > 0;
}

/** Why deactivating `target` must be refused, or null: the mapped primary owner, or the company's last active owner. */
export async function deactivationBlock(tx: Tx, target: LockedCustomerUser, primaryOwnerId: number | null): Promise<"primary_owner" | "last_owner" | null> {
  if (target.id === primaryOwnerId) return "primary_owner";
  // As PO-03A: an owner is never deactivated while no OTHER active owner remains (even an already-disabled owner).
  if (target.role === "owner" && !(await hasOtherActiveOwner(tx, target.orgId, target.id))) return "last_owner";
  return null;
}

/**
 * Why changing `target`'s role to `role` must be refused, or null — ONE rule (PO-03C) for the Team role change and the
 * console's role control: the mapped primary owner never leaves the owner role (a primary-owner transfer moves the
 * designation first), and the company's last active owner is never demoted.
 */
export async function demotionBlock(tx: Tx, target: LockedCustomerUser, primaryOwnerId: number | null, role: CustomerRole): Promise<"primary_owner" | "last_owner" | null> {
  if (role === "owner") return null;
  if (target.id === primaryOwnerId) return "primary_owner";
  if (target.role === "owner" && target.isActive && !(await hasOtherActiveOwner(tx, target.orgId, target.id))) return "last_owner";
  return null;
}

/** The user's status — scoped to the id AND the company it was locked in. */
export async function setCustomerUserActive(tx: Tx, user: LockedCustomerUser, isActive: boolean): Promise<void> {
  await tx.update(usersTable).set({ isActive, updatedAt: new Date() }).where(and(eq(usersTable.id, user.id), eq(usersTable.orgId, user.orgId)));
}

/**
 * The user's role — the ONE role write (PO-03C), scoped to the id AND the company it was locked in. The callers (the
 * Team-change service, the console's role control and the primary-owner transfer) check every rule on the locked rows
 * before calling it, and end the account's sessions after it (a role change invalidates the sessions issued under the
 * old role).
 */
export async function setCustomerUserRole(tx: Tx, user: LockedCustomerUser, role: CustomerRole): Promise<void> {
  await tx.update(usersTable).set({ role, updatedAt: new Date() }).where(and(eq(usersTable.id, user.id), eq(usersTable.orgId, user.orgId)));
}

/**
 * Ends every live session of ONE user of ONE company (never another user's or another company's); returns how many.
 * Under the lock order a concurrent sign-in that holds the company row is waited for and its session is ended here.
 */
export async function endCustomerUserSessions(tx: Tx, user: LockedCustomerUser, reason: string, now: Date): Promise<number> {
  const ended = await tx
    .update(sessionsTable)
    .set({ revokedAt: now, revokedReason: reason })
    .where(and(eq(sessionsTable.orgId, user.orgId), eq(sessionsTable.userId, user.id), isNull(sessionsTable.revokedAt), gt(sessionsTable.expiresAt, now)))
    .returning({ id: sessionsTable.id });
  return ended.length;
}

/** The customer-visible evidence types of a platform change (PO-03B: status and sessions; PO-03C: role and transfer). */
export type PlatformChangeEvidenceType =
  | "account.disabled_by_platform"
  | "account.enabled_by_platform"
  | "sessions.revoked_by_platform"
  | "account.role_changed_by_platform"
  | "account.ownership_transferred_by_platform";

/**
 * The customer's own security evidence for a change made by the platform operator, in the caller's transaction. It
 * names the affected account and what happened — never the operator's identity or reason (those are in the platform
 * audit trail), and never the operator's network identity: the customer writer (recordSecurityEvent) stamps the
 * CURRENT request's IP address and browser, which here would be the Platform Owner's, so this ONE insert leaves
 * them empty instead.
 */
export async function recordPlatformChangeEvidence(
  tx: Tx,
  user: LockedCustomerUser,
  change: {
    type: PlatformChangeEvidenceType;
    sessionsEnded: number;
    /** PO-03C: the role change it records (role control and transfer) and, for a transfer, which side this account is on. */
    detail?: { fromRole: string; toRole: CustomerRole; primary?: "gained" | "released" };
  },
): Promise<void> {
  const [row] = await tx.select({ email: usersTable.email }).from(usersTable).where(and(eq(usersTable.id, user.id), eq(usersTable.orgId, user.orgId)));
  await tx.insert(securityEventsTable).values({
    orgId: user.orgId,
    userId: user.id,
    email: row?.email ?? null,
    type: change.type,
    severity: change.type === "account.enabled_by_platform" ? "info" : "medium",
    detail: "platform_operator",
    metadata: { sessionsEnded: change.sessionsEnded, ...(change.detail ?? {}) },
    ipAddress: null,
    userAgent: null,
    browser: null,
    os: null,
    device: null,
  });
}
