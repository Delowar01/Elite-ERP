import "server-only";
import { db, type Role, type Tx } from "@/db";
import { logActivity } from "@/lib/activity";
import { t, type Locale } from "@/lib/i18n/dict";
import { recordSecurityEvent } from "@/lib/security/audit";
import type { Session } from "@/lib/session";
import { canAssignRole } from "@/lib/tenant";
import {
  CUSTOMER_USER_LOCK_TIMEOUT,
  deactivationBlock,
  endCustomerUserSessions,
  hasOtherActiveOwner,
  lockCompanyPrimaryOwner,
  lockCompanyUsers,
  ROLE_CHANGE_REVOKE_REASON,
  setCustomerUserActive,
  setCustomerUserRole,
  USER_DISABLED_REVOKE_REASON,
  USER_REENABLED_REVOKE_REASON,
  type LockedCustomerUser,
} from "./customer-user-core";
import { TeamProtectionUnavailableError } from "./ownership-gate";

// ---------------------------------------------------------------------------------------------
// Team changes that can affect a company's ownership (PO-03A, decision O-3): a member's ROLE and whether the member
// is ACTIVE. The two Team actions (src/app/(app)/settings/team/actions.ts) call these after requireRole; adding a
// member is unchanged and does not come through here.
//
// Each change is ONE READ COMMITTED transaction with a fixed lock order — the same for every customer-user mutation:
//   1. the company row (orgs) FOR NO KEY UPDATE — serializes every Team change of the company. It is the row and
//      the mode of the PO-02C access change (they queue), it conflicts with the FOR SHARE that PO-02C.1 session
//      issuance takes, and it never blocks the KEY SHARE locks of ordinary foreign-key inserts;
//   2. the actor's and the target's user rows FOR NO KEY UPDATE, in ascending id order, of THIS company only;
//   3. the primary-owner mapping FOR SHARE (through the ownership gate), read after the user rows — the mapping's
//      guard trigger locks the user row it names before it accepts a write, so no mapping can appear for a user this
//      transaction holds without being seen here;
//   4. every check again on the locked rows (the actor is still an active owner or admin of this company; the
//      target belongs to it; role rules; the primary owner; the last active owner);
//   5. the update, then 6. its activity record — in the same transaction.
// PO-03C (sub-batch B): a deactivation ends the member's live sessions in that same transaction (reason "disabled"), a
// reactivation ends any session left from before (reason "reenabled" — a reactivated member signs in again; nothing is
// revived), and a role change ends the member's sessions (reason "role_change"), so no session issued under the old
// role or status outlives the change. When sessions were ended, the customer's own security log records it
// (team.member_sessions_ended) in the same transaction. Every other member's sessions are untouched.
// A lock wait longer than TEAM_LOCK_TIMEOUT, a deadlock or any failure rolls everything back and answers a clear,
// localized message; nothing is ever half-applied. A refused change to the primary owner commits exactly one
// security event (team.primary_owner_protected) and nothing else.
// ---------------------------------------------------------------------------------------------

export type TeamChangeResult = { error?: string };

const READ_COMMITTED = { isolationLevel: "read committed" } as const;
// PO-03B: the lock order, the owner rules and the status write live in the shared customer-user mutation service
// (./customer-user-core.ts), which the Platform Owner user controls use too; this service keeps the Team-specific
// parts — the acting member's authority, the role rules, the localized answers and the activity record.
export const TEAM_LOCK_TIMEOUT = CUSTOMER_USER_LOCK_TIMEOUT;
const VALID_ROLES: Role[] = ["owner", "admin", "staff"];
const MANAGERS: Role[] = ["owner", "admin"];

/** English is the dictionary key (src/lib/i18n/dict.ts holds the Saudi Arabic); the first seven are the existing messages. */
export const TEAM_MESSAGES = {
  invalidRole: "Invalid role.",
  aboveOwn: "You can't assign a role above your own.",
  ownRole: "You can't change your own role.",
  notFound: "User not found.",
  memberRole: "You can't change this member's role.",
  ownAccount: "You can't deactivate your own account.",
  lastOwner: "The organization must keep at least one active owner.",
  notManager: "You no longer have permission to manage the team.",
  primaryRole: "This member is the company's primary owner. Their role can't be changed.",
  primaryDeactivate: "This member is the company's primary owner and can't be deactivated.",
  busy: "Another change to this team is in progress. Try again in a moment.",
  unavailable: "Team changes are unavailable right now. Nothing was changed. Try again later.",
  failed: "The change couldn't be saved. Nothing was changed.",
} as const;
type MessageKey = keyof typeof TEAM_MESSAGES;

/** A refusal decided inside the transaction (it rolls back unless `commit` — only the protected-owner event). */
class TeamRefusal extends Error {
  constructor(
    readonly key: MessageKey,
    readonly commit = false,
  ) {
    super(key);
    this.name = "TeamRefusal";
  }
}

/** Steps 1–3 (shared core), the actor/target checks on the locked rows, then step 4 (shared core). */
async function lockTeamChange(tx: Tx, session: Session, targetId: number) {
  const rows = await lockCompanyUsers(tx, session.orgId, [session.userId, targetId]);
  if (!rows) throw new TeamRefusal("notManager");
  const actor = rows.find((r) => r.id === session.userId);
  const target = rows.find((r) => r.id === targetId);
  if (!actor || !actor.isActive || !MANAGERS.includes(actor.role as Role)) throw new TeamRefusal("notManager");
  if (!target) throw new TeamRefusal("notFound");
  const primaryOwnerId = await lockCompanyPrimaryOwner(tx, session.orgId);
  return { actor: { ...actor, role: actor.role as Role }, target, primaryOwnerId };
}

async function protectedOwnerRefusal(tx: Tx, session: Session, targetId: number, change: "role_change" | "deactivation"): Promise<never> {
  await recordSecurityEvent(
    { orgId: session.orgId, userId: session.userId, email: session.email, type: "team.primary_owner_protected", severity: "medium", detail: change, metadata: { targetUserId: targetId } },
    tx,
  );
  throw new TeamRefusal(change === "role_change" ? "primaryRole" : "primaryDeactivate", true);
}

function sqlStateOf(err: unknown): string | undefined {
  for (let e: unknown = err, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/**
 * PO-03C: ends the target member's live sessions for a role or status change and records it in the customer's own
 * security log when any were ended — inside the change's transaction (so a failure rolls the change back too).
 */
async function endMemberSessions(tx: Tx, session: Session, target: LockedCustomerUser, cause: "deactivated" | "reactivated" | "role_changed"): Promise<void> {
  const reason = cause === "deactivated" ? USER_DISABLED_REVOKE_REASON : cause === "reactivated" ? USER_REENABLED_REVOKE_REASON : ROLE_CHANGE_REVOKE_REASON;
  const ended = await endCustomerUserSessions(tx, target, reason, new Date());
  if (ended === 0) return;
  await recordSecurityEvent(
    { orgId: session.orgId, userId: session.userId, email: session.email, type: "team.member_sessions_ended", severity: cause === "reactivated" ? "info" : "medium", detail: cause, metadata: { targetUserId: target.id, sessionsEnded: ended } },
    tx,
  );
}

/** Runs one Team change; every outcome is a localized result, and only a completed change has any effect. */
async function runTeamChange(locale: Locale, work: (tx: Tx) => Promise<void>): Promise<TeamChangeResult> {
  const message = (key: MessageKey) => ({ error: t(locale, TEAM_MESSAGES[key]) });
  let committedRefusal: TeamRefusal | null = null;
  try {
    await db.transaction(async (tx) => {
      try {
        await work(tx);
      } catch (err) {
        // The protected-owner refusal keeps its one security event: return normally so the transaction commits it.
        if (err instanceof TeamRefusal && err.commit) {
          committedRefusal = err;
          return;
        }
        throw err;
      }
    }, READ_COMMITTED);
  } catch (err) {
    if (err instanceof TeamRefusal) return message(err.key);
    if (err instanceof TeamProtectionUnavailableError) return message("unavailable");
    const code = sqlStateOf(err);
    if (code === "55P03" || code === "40P01") return message("busy");
    console.error(`[team] change failed (rolled back): ${code && /^[0-9A-Z]{5}$/.test(code) ? `SQLSTATE ${code}` : err instanceof Error ? err.name : "unknown"}`);
    return message("failed");
  }
  const refused = committedRefusal as TeamRefusal | null;
  return refused ? message(refused.key) : {};
}

const validUserId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/** Change a member's role (owner/admin only; never your own; never above your own; never the primary owner's). */
export async function changeTeamMemberRole(session: Session, userId: number, role: Role, locale: Locale): Promise<TeamChangeResult> {
  // The pre-checks of the existing action, in its order and with its messages (no database access).
  if (!VALID_ROLES.includes(role)) return { error: t(locale, TEAM_MESSAGES.invalidRole) };
  if (!canAssignRole(session.role, role)) return { error: t(locale, TEAM_MESSAGES.aboveOwn) };
  if (userId === session.userId) return { error: t(locale, TEAM_MESSAGES.ownRole) };
  if (!validUserId(userId)) return { error: t(locale, TEAM_MESSAGES.notFound) };
  return runTeamChange(locale, async (tx) => {
    const { actor, target, primaryOwnerId } = await lockTeamChange(tx, session, userId);
    // The same rules again, on the rows as they are now (a stale page, or a change that committed meanwhile).
    if (!canAssignRole(actor.role, role)) throw new TeamRefusal("aboveOwn");
    if (!canAssignRole(actor.role, target.role as Role)) throw new TeamRefusal("memberRole");
    // O-3: the primary owner stays an owner (a request that leaves them an owner changes nothing protected).
    if (target.id === primaryOwnerId && role !== "owner") await protectedOwnerRefusal(tx, session, target.id, "role_change");
    if (target.role === "owner" && target.isActive && role !== "owner" && !(await hasOtherActiveOwner(tx, session.orgId, target.id))) throw new TeamRefusal("lastOwner");
    await setCustomerUserRole(tx, target, role);
    // PO-03C: a real role change invalidates the member's sessions (an unchanged role changes nothing else).
    if (role !== target.role) await endMemberSessions(tx, session, target, "role_changed");
    await logActivity(session, { type: "team.role-changed", description: `Changed a team member's role to ${role}`, entityType: "user", entityId: target.id }, tx);
  });
}

/** Activate or deactivate a member (owner/admin only; never yourself; never the primary owner; never the last active owner). */
export async function setTeamMemberActive(session: Session, userId: number, isActive: boolean, locale: Locale): Promise<TeamChangeResult> {
  if (userId === session.userId) return { error: t(locale, TEAM_MESSAGES.ownAccount) };
  if (!validUserId(userId)) return { error: t(locale, TEAM_MESSAGES.notFound) };
  if (typeof isActive !== "boolean") return { error: t(locale, TEAM_MESSAGES.failed) };
  return runTeamChange(locale, async (tx) => {
    const { target, primaryOwnerId } = await lockTeamChange(tx, session, userId);
    if (!isActive) {
      // The shared rules (the platform controls apply the same): never the primary owner, never the last active owner.
      const block = await deactivationBlock(tx, target, primaryOwnerId);
      if (block === "primary_owner") await protectedOwnerRefusal(tx, session, target.id, "deactivation");
      if (block === "last_owner") throw new TeamRefusal("lastOwner");
    }
    await setCustomerUserActive(tx, target, isActive);
    // PO-03C: deactivation ends the member's sessions; reactivation ends any left from before (a new sign-in is required).
    await endMemberSessions(tx, session, target, isActive ? "reactivated" : "deactivated");
    await logActivity(
      session,
      { type: isActive ? "team.member-activated" : "team.member-deactivated", description: `Marked a team member ${isActive ? "active" : "inactive"}`, entityType: "user", entityId: target.id },
      tx,
    );
  });
}
