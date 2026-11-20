import "server-only";
import { sql } from "drizzle-orm";
import { db, usersTable, type Role, type Tx } from "@/db";
import { logActivity } from "@/lib/activity";
import { hashPassword } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n/dict";
import { recordSecurityEvent } from "@/lib/security/audit";
import type { Session } from "@/lib/session";
import { canAssignRole } from "@/lib/tenant";
import { lockCompanyUsers } from "./customer-user-core";
import { TEAM_MESSAGES, type TeamChangeResult } from "./member-changes";
import { assertTeamMemberSeat, lockTeamMemberAdd, TeamSeatRefusal } from "./ownership-gate";

// ---------------------------------------------------------------------------------------------
// PO-03D (sub-batch C) — the Team's Add Member (src/app/(app)/settings/team/actions.ts calls this after requireRole
// owner/admin). The existing rules and messages, in the existing order — name, e-mail and password required, a password
// of at least 8 characters, a valid role, never a role above your own, an e-mail no user has — now localized, then ONE
// READ COMMITTED transaction in the shared lock order of every seat change:
//   1. bounded waits → the e-mail advisory lock (the key of company and user invitations and of their acceptance, so the
//      same e-mail queues across every path) → the company row FOR NO KEY UPDATE (the seat lock) — the platform's lock
//      order, through the Team ownership gate;
//   2. the acting member's own row FOR NO KEY UPDATE (the shared customer-user core): still an active owner or admin of
//      THIS company, still allowed to grant the role;
//   3. no customer user holds the e-mail in ANY letter case (under the e-mail lock);
//   4. the ONE shared seat check (seat-enforcement.ts, through the gate): while CUSTOMER_SEAT_ENFORCEMENT_ENABLED is on, a
//      company at or above its allowance gets no new member; a company without a subscription keeps the legacy rule;
//   5. the user; 6. its activity record (team.member-added, as before) — in the same transaction.
// The password is hashed BEFORE the transaction (no lock is held while it is computed). A refusal at the user limit
// commits exactly one customer security event (team.member_add_refused) and nothing else; every other refusal or failure
// rolls back whole and answers a localized message. No session, no e-mail, no invitation.
// ---------------------------------------------------------------------------------------------

/** English is the dictionary key (src/lib/i18n/dict.ts holds the Saudi Arabic); the first three are the existing messages. */
export const TEAM_ADD_MESSAGES = {
  required: "Name, email, and password are required.",
  password: "Password must be at least 8 characters.",
  emailTaken: "A user with this email already exists.",
  seatLimit: "This company has reached its user limit. Nothing was changed. Free a seat, or ask your Elite ERP contact about more seats.",
  seatUnavailable: "User limits can't be checked right now. Nothing was changed. Try again later.",
} as const;

const READ_COMMITTED = { isolationLevel: "read committed" } as const;
const VALID_ROLES: Role[] = ["owner", "admin", "staff"];
const MANAGERS: Role[] = ["owner", "admin"];

/** A refusal decided inside the transaction (rolled back). */
class AddRefusal extends Error {
  constructor(readonly en: string) {
    super("team add refused");
    this.name = "AddRefusal";
  }
}

/** Whether a customer user holds this e-mail in ANY letter case (every application writer stores it lower-cased). */
async function emailTaken(executor: Tx | typeof db, email: string): Promise<boolean> {
  const [row] = await executor.select({ id: usersTable.id }).from(usersTable).where(sql`lower(${usersTable.email}) = lower(${email})`).limit(1);
  return Boolean(row);
}

function pgError(err: unknown): { code: string; constraint: string } | null {
  for (let e: unknown = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return { code, constraint: String((e as { constraint?: unknown }).constraint ?? "") };
  }
  return null;
}

/** Add one member to the signed-in user's OWN company (owner/admin only; never above your own role). */
export async function addTeamMember(session: Session, input: { name: string; email: string; password: string; role: string }, locale: Locale): Promise<TeamChangeResult> {
  const say = (en: string): TeamChangeResult => ({ error: t(locale, en) });
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  const role = input.role as Role;
  // The pre-checks of the existing action, in its order and with its messages.
  if (!name || !email || !password) return say(TEAM_ADD_MESSAGES.required);
  if (password.length < 8) return say(TEAM_ADD_MESSAGES.password);
  if (!VALID_ROLES.includes(role)) return say(TEAM_MESSAGES.invalidRole);
  if (!canAssignRole(session.role, role)) return say(TEAM_MESSAGES.aboveOwn);
  // A taken e-mail costs no password hash; the transaction checks again, under the e-mail lock.
  if (await emailTaken(db, email)) return say(TEAM_ADD_MESSAGES.emailTaken);
  const passwordHash = await hashPassword(password);

  let refusedAtLimit = false;
  try {
    await db.transaction(async (tx) => {
      const lock = await lockTeamMemberAdd(tx, session.orgId, email);
      if (!lock) throw new AddRefusal(TEAM_MESSAGES.notManager);
      const [actor] = (await lockCompanyUsers(tx, session.orgId, [session.userId])) ?? [];
      if (!actor || !actor.isActive || !MANAGERS.includes(actor.role as Role)) throw new AddRefusal(TEAM_MESSAGES.notManager);
      if (!canAssignRole(actor.role as Role, role)) throw new AddRefusal(TEAM_MESSAGES.aboveOwn);
      if (await emailTaken(tx, email)) throw new AddRefusal(TEAM_ADD_MESSAGES.emailTaken);
      try {
        await assertTeamMemberSeat(tx, lock, new Date());
      } catch (err) {
        if (err instanceof TeamSeatRefusal && err.reason === "limit") {
          // The one record of a refused add: committed alone (no user is written).
          await recordSecurityEvent(
            { orgId: session.orgId, userId: session.userId, email: session.email, type: "team.member_add_refused", severity: "low", detail: "seat_limit", metadata: { role } },
            tx,
          );
          refusedAtLimit = true;
          return;
        }
        throw err;
      }
      const [user] = await tx.insert(usersTable).values({ orgId: session.orgId, name, email, passwordHash, role }).returning({ id: usersTable.id });
      await logActivity(session, { type: "team.member-added", description: `Added team member "${name}" (${role})`, entityType: "user", entityId: user.id }, tx);
    }, READ_COMMITTED);
  } catch (err) {
    if (err instanceof AddRefusal) return say(err.en);
    if (err instanceof TeamSeatRefusal) return say(TEAM_ADD_MESSAGES.seatUnavailable);
    const pg = pgError(err);
    if (pg?.code === "23505" && /users_email/.test(pg.constraint)) return say(TEAM_ADD_MESSAGES.emailTaken);
    if (pg?.code === "55P03" || pg?.code === "40P01") return say(TEAM_MESSAGES.busy);
    console.error(`[team] add member failed (rolled back): ${pg ? `SQLSTATE ${pg.code}` : err instanceof Error ? err.name : "unknown"}`);
    return say(TEAM_MESSAGES.failed);
  }
  return refusedAtLimit ? say(TEAM_ADD_MESSAGES.seatLimit) : {};
}
