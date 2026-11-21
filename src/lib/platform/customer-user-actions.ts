import "server-only";
import { and, eq } from "drizzle-orm";
import { db, tenantPrimaryOwnersTable } from "@/db";
import {
  companyOfCustomerUser,
  CUSTOMER_ROLES,
  deactivationBlock,
  demotionBlock,
  endCustomerUserSessions,
  isOwnerProtectionUnavailable,
  lockCompanyUsers,
  lockCustomerUsers,
  OWNER_TRANSFER_REVOKE_REASON,
  PLATFORM_REVOKED_REASON,
  recordPlatformChangeEvidence,
  ROLE_CHANGE_REVOKE_REASON,
  setCustomerUserActive,
  setCustomerUserRole,
  USER_DISABLED_REVOKE_REASON,
  USER_REENABLED_REVOKE_REASON,
  type CustomerRole,
} from "@/lib/team/customer-user-core";
import { assertPlatformAuditProtection, recordPlatformAudit } from "./audit";
import { platformClock } from "./clock";
import { normalizeAccessReason } from "./company-access-actions";
import { requestMeta, type ConsoleFailure, type ConsoleRequest } from "./console";
import {
  parseCompanyIdParam,
  parseCustomerUserId,
  readCustomerUserRoleState,
  readCustomerUserState,
  readPrimaryOwnerTransferOptions,
  type CustomerUserRoleState,
  type CustomerUserState,
  type PrimaryOwnerTransferOptions,
} from "./customer-users";
import { isPlatformError, PlatformError } from "./errors";
import { assertPlatformConsoleEnabled } from "./flags";
import { authorizePlatformToken } from "./guards";
import { errorClass, reportSecurityIncident } from "./incident";
import { consumeTotpCode } from "./mfa";
import { assertConsoleHost, assertSameOrigin } from "./origin";
import type { PlatformSessionContext } from "./session";
import { activeLoginBlock, recordLoginAttempt, throttleKeys } from "./throttle";

// ---------------------------------------------------------------------------------------------
// Platform Owner PO-03B — the customer-user controls: disable / enable one customer user, and revoke one customer
// user's live sessions. The changes themselves are made by the SHARED customer-user mutation service
// (src/lib/team/customer-user-core.ts — the lock order, the owner rules, the status write, the session end and the
// customer's own evidence), the same code the customer Team actions use; this module adds what is specific to the
// console. This is the ONE platform module that imports that service (rule 47).
//
// A change is accepted only in this order:
//   1. console enabled → 2. same-origin (CSRF) → 3. live Platform Owner session (the PLATFORM token; a customer ERP
//      session is never read) → 4. platform.users.manage
//   → the audit trail must be protected (a change that could not be recorded is never made)
//   → request FORMAT (no database, spends nothing): user id, target, reason 10–500 characters, code shape and — for
//     disable / enable — the account version the operator saw
//   → the user's company (unlocked: only to know which company row to lock first; unknown → NOT_FOUND, recorded)
//   → 5. step-up: the durable throttle shared with sign-in, then — inside the transaction — a fresh TOTP code consumed
//      with replay protection (an invalid or replayed code changes nothing and counts against the throttle)
//   → 6. ONE READ COMMITTED transaction in the shared lock order: company row FOR NO KEY UPDATE → the user row FOR NO
//      KEY UPDATE → (disable / enable) the primary-owner mapping FOR SHARE, fail closed — then, on the locked rows:
//      the version the operator saw (else VERSION_CONFLICT: a stale page never overwrites a newer decision), the
//      requested state (else CONFLICT), and for a disable the owner rules (the mapped primary owner → LAST_PRIMARY_OWNER;
//      the company's last active owner → LAST_ACTIVE_OWNER)
//   → 7. the change: the status (scoped to the user AND the company), every live session of that one user ended — on
//      disable (reason "disabled") and on enable too ("reenabled"), so no session a racing sign-in created can come
//      back to life — then the customer's own security event, then 8. the platform audit record: one transaction,
//      all or nothing. A revocation ends the user's live sessions ("platform_revoked") with the same evidence.
//
// Concurrency: changes to one company's users serialize on its organization row (shared with the customer Team
// changes and the PO-02C access change). A customer sign-in with enforcement on takes a SHARE lock on the same row for
// its session insert (PO-02C.1), so a revocation either waits for an in-flight sign-in and ends the session it
// created, or the sign-in waits and starts after the revocation (a new sign-in — disabling the account is what stops
// those, and every customer request re-checks is_active). Every refusal decided inside the transaction rolls it back
// — the TOTP code included — and is recorded as a rejected attempt afterwards.
// ---------------------------------------------------------------------------------------------

export const USER_REASON_MIN = 10;
export const USER_REASON_MAX = 500;
const TOTP_SHAPE = /^\d{6}$/;
const VERSION_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/;
const ENTITY = "customer_user";

export type CustomerUserStatusInput = { userId: unknown; target: unknown; reason: unknown; totpCode: unknown; version: unknown };
export type CustomerUserSessionsInput = { userId: unknown; reason: unknown; totpCode: unknown };
export type CustomerUserStatusChanged = { ok: true; userId: number; orgId: number; status: "active" | "disabled"; changedAt: Date; sessionsEnded: number };
export type CustomerUserSessionsRevoked = { ok: true; userId: number; orgId: number; revokedAt: Date; sessionsEnded: number };

const invalid = (detail: string) => new PlatformError("VALIDATION_FAILED", detail);

function parseReason(value: unknown): string {
  const reason = normalizeAccessReason(value);
  if (reason === null) throw invalid(`reason must be ${USER_REASON_MIN}–${USER_REASON_MAX} characters without control characters`);
  return reason;
}
function parseCode(value: unknown): string {
  if (typeof value !== "string" || !TOTP_SHAPE.test(value)) throw invalid("a six-digit authenticator code is required");
  return value;
}

async function authorizeUserManagement(req: ConsoleRequest): Promise<PlatformSessionContext> {
  assertPlatformConsoleEnabled();
  assertConsoleHost(req.headers);
  assertSameOrigin(req.headers);
  return authorizePlatformToken(req.token, "platform.users.manage");
}

function sqlStateOf(err: unknown): string | undefined {
  for (let e: unknown = err, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/** A refusal decided inside the transaction → its typed error and the stage recorded with the rejected attempt. */
function refusal(err: unknown): { error: PlatformError; stage: string } | null {
  if (isOwnerProtectionUnavailable(err)) return { error: new PlatformError("OWNER_PROTECTION_UNAVAILABLE", "primary-owner check unavailable"), stage: "protection_unavailable" };
  const code = sqlStateOf(err);
  // lock_not_available (the bounded lock wait) / deadlock_detected
  if (code === "55P03" || code === "40P01") return { error: new PlatformError("CHANGE_IN_PROGRESS", `lock conflict (SQLSTATE ${code})`), stage: "busy" };
  if (!isPlatformError(err)) return null;
  const stages: Partial<Record<string, string>> = { NOT_FOUND: "not_found", CONFLICT: "state", VERSION_CONFLICT: "stale", LAST_PRIMARY_OWNER: "primary_owner", LAST_ACTIVE_OWNER: "last_owner", OWNER_NOT_DESIGNATED: "not_designated", TRANSFER_TARGET_INVALID: "invalid_target" };
  const stage = stages[err.code];
  return stage ? { error: err, stage } : null;
}

/** The same mapping as the console's: typed codes pass through; anything else is CONFIG_ERROR without detail. */
function failure(err: unknown, action: string): ConsoleFailure {
  if (isPlatformError(err, "AUDIT_UNAVAILABLE")) {
    reportSecurityIncident({ type: "audit_write_failed", action, error: errorClass(err) });
    return { ok: false, code: "AUDIT_UNAVAILABLE" };
  }
  if (isPlatformError(err)) return { ok: false, code: err.code };
  console.error(`[platform-users] internal failure: ${errorClass(err)}`);
  return { ok: false, code: "CONFIG_ERROR" };
}

type Step = { ok: false; stage: "mfa" | "replay" };

/**
 * Disable (`target: "disabled"`) or enable (`target: "active"`) one customer user. Returns the new status and how
 * many of the user's sessions were ended, or a typed failure code. See the header for the order and the transaction.
 */
export async function setCustomerUserStatusCore(req: ConsoleRequest, input: CustomerUserStatusInput): Promise<CustomerUserStatusChanged | ConsoleFailure> {
  let action = "customer_user.status_changed";
  try {
    const ctx = await authorizeUserManagement(req);
    await assertPlatformAuditProtection();
    const userId = parseCustomerUserId(input.userId);
    if (input.target !== "disabled" && input.target !== "active") throw invalid("target must be disabled or active");
    const target = input.target;
    const reason = parseReason(input.reason);
    const totpCode = parseCode(input.totpCode);
    if (typeof input.version !== "string" || !VERSION_SHAPE.test(input.version)) throw invalid("the account version the page showed is required");
    const version = input.version;
    const verb = target === "disabled" ? "disable" : "enable";
    action = target === "disabled" ? "customer_user.disabled" : "customer_user.enabled";
    const meta = requestMeta(req.headers);
    const now = platformClock.now();
    const orgId = await companyOfCustomerUser(db, userId);
    const base = { actorAdminId: ctx.adminId, actorLabel: ctx.displayName, entityType: ENTITY, entityId: String(userId), orgId, reason, ...meta };
    const rejected = (stage: string) => recordPlatformAudit({ ...base, action: `customer_user.${verb}.rejected`, after: { stage }, result: "rejected" });
    if (orgId === null) {
      await rejected("not_found");
      throw new PlatformError("NOT_FOUND", "no customer user with this id");
    }

    const keys = throttleKeys(ctx.email, meta.ipAddress);
    if (await activeLoginBlock(keys, now)) {
      await recordLoginAttempt(keys, "blocked", now);
      await rejected("throttle");
      throw new PlatformError("RATE_LIMITED", "step-up blocked by throttle");
    }

    let outcome: { ok: true; sessionsEnded: number } | Step;
    try {
      outcome = await db.transaction(
        async (tx) => {
          const totp = await consumeTotpCode(tx, ctx.adminId, totpCode, now);
          if (!totp.ok) return { ok: false as const, stage: totp.reason === "replayed" ? ("replay" as const) : ("mfa" as const) };
          // The shared lock order: company → user → primary-owner mapping (fail closed).
          const locked = await lockCustomerUsers(tx, orgId, [userId]);
          const user = locked?.users[0];
          if (!locked || !user) throw new PlatformError("NOT_FOUND", "no customer user with this id in its company");
          if (user.version !== version) throw new PlatformError("VERSION_CONFLICT", "the account changed after the page was loaded");
          if (user.isActive === (target === "active")) throw new PlatformError("CONFLICT", "the account is already in the requested state");
          if (target === "disabled") {
            const block = await deactivationBlock(tx, user, locked.primaryOwnerId);
            if (block === "primary_owner") throw new PlatformError("LAST_PRIMARY_OWNER", "the mapped primary owner is never disabled");
            if (block === "last_owner") throw new PlatformError("LAST_ACTIVE_OWNER", "the company's last active owner is never disabled");
          }
          await setCustomerUserActive(tx, user, target === "active");
          const sessionsEnded = await endCustomerUserSessions(tx, user, target === "disabled" ? USER_DISABLED_REVOKE_REASON : USER_REENABLED_REVOKE_REASON, now);
          await recordPlatformChangeEvidence(tx, user, { type: target === "disabled" ? "account.disabled_by_platform" : "account.enabled_by_platform", sessionsEnded });
          await recordPlatformAudit(
            { ...base, action, before: { isActive: user.isActive, role: user.role }, after: { isActive: target === "active", sessionsEnded }, result: "success" },
            tx,
          );
          return { ok: true as const, sessionsEnded };
        },
        { isolationLevel: "read committed" },
      );
    } catch (err) {
      // Rolled back (the code included); a refusal is still recorded.
      const refused = refusal(err);
      if (refused) {
        await rejected(refused.stage);
        throw refused.error;
      }
      throw err;
    }
    if (!outcome.ok) {
      await recordLoginAttempt(keys, "failure", now);
      await rejected(outcome.stage);
      throw new PlatformError("MFA_INVALID", "step-up second factor failed");
    }
    return { ok: true, userId, orgId, status: target, changedAt: now, sessionsEnded: outcome.sessionsEnded };
  } catch (err) {
    return failure(err, action);
  }
}

/**
 * End every live session of one customer user (reason "platform_revoked"); the account itself is unchanged. Returns
 * how many sessions were ended (possibly none), or a typed failure code.
 */
export async function revokeCustomerUserSessionsCore(req: ConsoleRequest, input: CustomerUserSessionsInput): Promise<CustomerUserSessionsRevoked | ConsoleFailure> {
  const action = "customer_user.sessions_revoked";
  try {
    const ctx = await authorizeUserManagement(req);
    await assertPlatformAuditProtection();
    const userId = parseCustomerUserId(input.userId);
    const reason = parseReason(input.reason);
    const totpCode = parseCode(input.totpCode);
    const meta = requestMeta(req.headers);
    const now = platformClock.now();
    const orgId = await companyOfCustomerUser(db, userId);
    const base = { actorAdminId: ctx.adminId, actorLabel: ctx.displayName, entityType: ENTITY, entityId: String(userId), orgId, reason, ...meta };
    const rejected = (stage: string) => recordPlatformAudit({ ...base, action: "customer_user.sessions_revoke.rejected", after: { stage }, result: "rejected" });
    if (orgId === null) {
      await rejected("not_found");
      throw new PlatformError("NOT_FOUND", "no customer user with this id");
    }

    const keys = throttleKeys(ctx.email, meta.ipAddress);
    if (await activeLoginBlock(keys, now)) {
      await recordLoginAttempt(keys, "blocked", now);
      await rejected("throttle");
      throw new PlatformError("RATE_LIMITED", "step-up blocked by throttle");
    }

    let outcome: { ok: true; sessionsEnded: number } | Step;
    try {
      outcome = await db.transaction(
        async (tx) => {
          const totp = await consumeTotpCode(tx, ctx.adminId, totpCode, now);
          if (!totp.ok) return { ok: false as const, stage: totp.reason === "replayed" ? ("replay" as const) : ("mfa" as const) };
          // The shared lock order, steps 1–3 (no owner rule applies to ending sessions, so the mapping is not needed).
          const users = await lockCompanyUsers(tx, orgId, [userId]);
          const user = users?.[0];
          if (!users || !user) throw new PlatformError("NOT_FOUND", "no customer user with this id in its company");
          const sessionsEnded = await endCustomerUserSessions(tx, user, PLATFORM_REVOKED_REASON, now);
          await recordPlatformChangeEvidence(tx, user, { type: "sessions.revoked_by_platform", sessionsEnded });
          await recordPlatformAudit({ ...base, action, before: { isActive: user.isActive }, after: { sessionsEnded }, result: "success" }, tx);
          return { ok: true as const, sessionsEnded };
        },
        { isolationLevel: "read committed" },
      );
    } catch (err) {
      const refused = refusal(err);
      if (refused) {
        await rejected(refused.stage);
        throw refused.error;
      }
      throw err;
    }
    if (!outcome.ok) {
      await recordLoginAttempt(keys, "failure", now);
      await rejected(outcome.stage);
      throw new PlatformError("MFA_INVALID", "step-up second factor failed");
    }
    return { ok: true, userId, orgId, revokedAt: now, sessionsEnded: outcome.sessionsEnded };
  } catch (err) {
    return failure(err, action);
  }
}

/** The account as it is now — the confirmation dialogs act on this, not on what the page showed. */
export async function readCustomerUserStateCore(req: ConsoleRequest, rawUserId: unknown): Promise<{ ok: true; state: CustomerUserState } | ConsoleFailure> {
  try {
    return { ok: true, state: await readCustomerUserState(req, rawUserId) };
  } catch (err) {
    return failure(err, "customer_user.state_read");
  }
}

// ---------------------------------------------------------------------------------------------
// PO-03C (sub-batch A) — role changes and the primary-owner transfer, behind platform.users.manage_roles. The same order
// as the controls above (flag → same-origin → live platform session → permission → audit protection → request format →
// the company → the durable step-up throttle → ONE READ COMMITTED transaction: a fresh TOTP code consumed with replay
// protection, then the shared lock order company row → the affected user rows by ascending id → the primary-owner
// mapping), every rule re-checked on the locked rows, and the change, the session ends, the customer's evidence and the
// platform audit record in that one transaction. The role write is the shared service's (setCustomerUserRole); the ONE
// write this module makes itself is the primary-owner mapping's UPDATE in a transfer (by company AND previous owner).
// ---------------------------------------------------------------------------------------------

export type CustomerUserRoleInput = { userId: unknown; orgId: unknown; role: unknown; reason: unknown; totpCode: unknown; version: unknown };
export type CustomerUserRoleChanged = { ok: true; userId: number; orgId: number; role: CustomerRole; changedAt: Date; sessionsEnded: number };
export type PrimaryOwnerTransferInput = { orgId: unknown; fromUserId: unknown; toUserId: unknown; fromVersion: unknown; toVersion: unknown; reason: unknown; totpCode: unknown };
export type PrimaryOwnerTransferred = { ok: true; orgId: number; fromUserId: number; toUserId: number; transferredAt: Date; sessionsEnded: number };

async function authorizeRoleManagement(req: ConsoleRequest): Promise<PlatformSessionContext> {
  assertPlatformConsoleEnabled();
  assertConsoleHost(req.headers);
  assertSameOrigin(req.headers);
  return authorizePlatformToken(req.token, "platform.users.manage_roles");
}

function parseRole(value: unknown): CustomerRole {
  if (typeof value !== "string" || !(CUSTOMER_ROLES as readonly string[]).includes(value)) throw invalid("role must be owner, admin or staff");
  return value as CustomerRole;
}
function parseVersion(value: unknown, what: string): string {
  if (typeof value !== "string" || !VERSION_SHAPE.test(value)) throw invalid(`the ${what} version the page showed is required`);
  return value;
}

/**
 * Change one customer user's role (owner / admin / staff). The page's company and account version travel with the
 * request, so an id from another company or a stale page is refused; the mapped primary owner keeps the owner role (a
 * transfer moves the designation first) and the company's last active owner is never demoted (the shared rule). The
 * account's sessions end (reason "role_change") — a new sign-in picks up the new role.
 */
export async function changeCustomerUserRoleCore(req: ConsoleRequest, input: CustomerUserRoleInput): Promise<CustomerUserRoleChanged | ConsoleFailure> {
  const action = "customer_user.role_changed";
  try {
    const ctx = await authorizeRoleManagement(req);
    await assertPlatformAuditProtection();
    const userId = parseCustomerUserId(input.userId);
    const expectedOrgId = parseCompanyIdParam(input.orgId);
    const role = parseRole(input.role);
    const reason = parseReason(input.reason);
    const totpCode = parseCode(input.totpCode);
    const version = parseVersion(input.version, "account");
    const meta = requestMeta(req.headers);
    const now = platformClock.now();
    const orgId = await companyOfCustomerUser(db, userId);
    const base = { actorAdminId: ctx.adminId, actorLabel: ctx.displayName, entityType: ENTITY, entityId: String(userId), orgId, reason, ...meta };
    const rejected = (stage: string) => recordPlatformAudit({ ...base, action: "customer_user.role_change.rejected", after: { stage, role }, result: "rejected" });
    // An id that is not in the company the page showed is refused like an unknown one (no cross-company substitution).
    if (orgId === null || orgId !== expectedOrgId) {
      await rejected("not_found");
      throw new PlatformError("NOT_FOUND", "no customer user with this id in this company");
    }

    const keys = throttleKeys(ctx.email, meta.ipAddress);
    if (await activeLoginBlock(keys, now)) {
      await recordLoginAttempt(keys, "blocked", now);
      await rejected("throttle");
      throw new PlatformError("RATE_LIMITED", "step-up blocked by throttle");
    }

    let outcome: { ok: true; sessionsEnded: number } | Step;
    try {
      outcome = await db.transaction(
        async (tx) => {
          const totp = await consumeTotpCode(tx, ctx.adminId, totpCode, now);
          if (!totp.ok) return { ok: false as const, stage: totp.reason === "replayed" ? ("replay" as const) : ("mfa" as const) };
          const locked = await lockCustomerUsers(tx, orgId, [userId]);
          const user = locked?.users[0];
          if (!locked || !user) throw new PlatformError("NOT_FOUND", "no customer user with this id in its company");
          if (user.version !== version) throw new PlatformError("VERSION_CONFLICT", "the account changed after the page was loaded");
          if (user.role === role) throw new PlatformError("CONFLICT", "the account already has this role");
          const block = await demotionBlock(tx, user, locked.primaryOwnerId, role);
          if (block === "primary_owner") throw new PlatformError("LAST_PRIMARY_OWNER", "the mapped primary owner keeps the owner role (transfer first)");
          if (block === "last_owner") throw new PlatformError("LAST_ACTIVE_OWNER", "the company's last active owner is never demoted");
          await setCustomerUserRole(tx, user, role);
          const sessionsEnded = await endCustomerUserSessions(tx, user, ROLE_CHANGE_REVOKE_REASON, now);
          await recordPlatformChangeEvidence(tx, user, { type: "account.role_changed_by_platform", sessionsEnded, detail: { fromRole: user.role, toRole: role } });
          await recordPlatformAudit({ ...base, action, before: { role: user.role, isActive: user.isActive }, after: { role, sessionsEnded }, result: "success" }, tx);
          return { ok: true as const, sessionsEnded };
        },
        { isolationLevel: "read committed" },
      );
    } catch (err) {
      const refused = refusal(err);
      if (refused) {
        await rejected(refused.stage);
        throw refused.error;
      }
      throw err;
    }
    if (!outcome.ok) {
      await recordLoginAttempt(keys, "failure", now);
      await rejected(outcome.stage);
      throw new PlatformError("MFA_INVALID", "step-up second factor failed");
    }
    return { ok: true, userId, orgId, role, changedAt: now, sessionsEnded: outcome.sessionsEnded };
  } catch (err) {
    return failure(err, action);
  }
}

/**
 * Transfer a company's primary ownership to another ACTIVE user of the SAME company (Stage 2: PRD l.126, TRD §6,
 * appflow §6.3). Development-only policy pending owner approval: the previous primary owner becomes "admin". In one
 * transaction, on the locked rows: the mapping still names the owner the page showed (else stale), both accounts are
 * as the page showed them, the new owner is active and of this company (never the same account, a disabled one or
 * another company's); then the new owner becomes "owner", the mapping moves (its guard re-checks an active owner of the
 * same company), the previous owner becomes "admin", and BOTH accounts' sessions end (reason "owner_transfer").
 * A company with no mapping (a legacy company) is refused: its owner is never inferred or assigned here.
 */
export async function transferPrimaryOwnerCore(req: ConsoleRequest, input: PrimaryOwnerTransferInput): Promise<PrimaryOwnerTransferred | ConsoleFailure> {
  const action = "company.primary_owner_transferred";
  try {
    const ctx = await authorizeRoleManagement(req);
    await assertPlatformAuditProtection();
    const orgId = parseCompanyIdParam(input.orgId);
    const fromUserId = parseCustomerUserId(input.fromUserId);
    const toUserId = parseCustomerUserId(input.toUserId);
    const fromVersion = parseVersion(input.fromVersion, "current owner's");
    const toVersion = parseVersion(input.toVersion, "new owner's");
    const reason = parseReason(input.reason);
    const totpCode = parseCode(input.totpCode);
    const meta = requestMeta(req.headers);
    const now = platformClock.now();
    const base = { actorAdminId: ctx.adminId, actorLabel: ctx.displayName, entityType: "company", entityId: String(orgId), orgId, reason, ...meta };
    const rejected = (stage: string) => recordPlatformAudit({ ...base, action: "company.primary_owner_transfer.rejected", after: { stage, fromUserId, toUserId }, result: "rejected" });
    if (fromUserId === toUserId) {
      await rejected("same_owner");
      throw new PlatformError("TRANSFER_TARGET_INVALID", "the new primary owner must be another account");
    }
    const targetOrg = await companyOfCustomerUser(db, toUserId);
    if (targetOrg === null) {
      await rejected("not_found");
      throw new PlatformError("NOT_FOUND", "no customer user with this id");
    }
    if (targetOrg !== orgId) {
      await rejected("other_company");
      throw new PlatformError("TRANSFER_TARGET_INVALID", "the new primary owner belongs to another company");
    }

    const keys = throttleKeys(ctx.email, meta.ipAddress);
    if (await activeLoginBlock(keys, now)) {
      await recordLoginAttempt(keys, "blocked", now);
      await rejected("throttle");
      throw new PlatformError("RATE_LIMITED", "step-up blocked by throttle");
    }

    let outcome: { ok: true; sessionsEnded: number } | Step;
    try {
      outcome = await db.transaction(
        async (tx) => {
          const totp = await consumeTotpCode(tx, ctx.adminId, totpCode, now);
          if (!totp.ok) return { ok: false as const, stage: totp.reason === "replayed" ? ("replay" as const) : ("mfa" as const) };
          // The shared lock order: company row → both users (ascending id) → the mapping (FOR SHARE, fail closed).
          const locked = await lockCustomerUsers(tx, orgId, [fromUserId, toUserId]);
          if (!locked) throw new PlatformError("NOT_FOUND", "no company with this id");
          if (locked.primaryOwnerId === null) throw new PlatformError("OWNER_NOT_DESIGNATED", "this company has no primary-owner mapping");
          if (locked.primaryOwnerId !== fromUserId) throw new PlatformError("VERSION_CONFLICT", "the primary owner changed after the page was loaded");
          const from = locked.users.find((u) => u.id === fromUserId);
          const to = locked.users.find((u) => u.id === toUserId);
          if (!to) throw new PlatformError("TRANSFER_TARGET_INVALID", "the new primary owner is not a user of this company");
          if (!from || from.version !== fromVersion || to.version !== toVersion) throw new PlatformError("VERSION_CONFLICT", "an account changed after the page was loaded");
          if (!to.isActive) throw new PlatformError("TRANSFER_TARGET_INVALID", "the new primary owner must be active");
          if (to.role !== "owner") await setCustomerUserRole(tx, to, "owner");
          const moved = await tx
            .update(tenantPrimaryOwnersTable)
            .set({ userId: to.id, assignedAt: now, assignedByPlatformAdminId: ctx.adminId })
            .where(and(eq(tenantPrimaryOwnersTable.orgId, orgId), eq(tenantPrimaryOwnersTable.userId, from.id)))
            .returning({ orgId: tenantPrimaryOwnersTable.orgId });
          if (moved.length !== 1) throw new PlatformError("VERSION_CONFLICT", "the primary-owner mapping changed during the transfer");
          if (from.role !== "admin") await setCustomerUserRole(tx, from, "admin");
          const endedFrom = await endCustomerUserSessions(tx, from, OWNER_TRANSFER_REVOKE_REASON, now);
          const endedTo = await endCustomerUserSessions(tx, to, OWNER_TRANSFER_REVOKE_REASON, now);
          await recordPlatformChangeEvidence(tx, from, { type: "account.ownership_transferred_by_platform", sessionsEnded: endedFrom, detail: { fromRole: from.role, toRole: "admin", primary: "released" } });
          await recordPlatformChangeEvidence(tx, to, { type: "account.ownership_transferred_by_platform", sessionsEnded: endedTo, detail: { fromRole: to.role, toRole: "owner", primary: "gained" } });
          await recordPlatformAudit(
            {
              ...base,
              action,
              before: { primaryOwnerUserId: from.id, previousOwnerRole: from.role, newOwnerRole: to.role },
              after: { primaryOwnerUserId: to.id, previousOwnerRole: "admin", newOwnerRole: "owner", sessionsEnded: endedFrom + endedTo },
              result: "success",
            },
            tx,
          );
          return { ok: true as const, sessionsEnded: endedFrom + endedTo };
        },
        { isolationLevel: "read committed" },
      );
    } catch (err) {
      const refused = refusal(err);
      if (refused) {
        await rejected(refused.stage);
        throw refused.error;
      }
      throw err;
    }
    if (!outcome.ok) {
      await recordLoginAttempt(keys, "failure", now);
      await rejected(outcome.stage);
      throw new PlatformError("MFA_INVALID", "step-up second factor failed");
    }
    return { ok: true, orgId, fromUserId, toUserId, transferredAt: now, sessionsEnded: outcome.sessionsEnded };
  } catch (err) {
    return failure(err, action);
  }
}

/** The account as it is now, for the role control (platform.users.manage_roles). */
export async function readCustomerUserRoleStateCore(req: ConsoleRequest, rawUserId: unknown): Promise<{ ok: true; state: CustomerUserRoleState } | ConsoleFailure> {
  try {
    return { ok: true, state: await readCustomerUserRoleState(req, rawUserId) };
  } catch (err) {
    return failure(err, "customer_user.role_state_read");
  }
}

/** A company's transfer options as they are now (platform.users.manage_roles). */
export async function readPrimaryOwnerTransferOptionsCore(req: ConsoleRequest, rawOrgId: unknown): Promise<{ ok: true; options: PrimaryOwnerTransferOptions } | ConsoleFailure> {
  try {
    return { ok: true, options: await readPrimaryOwnerTransferOptions(req, rawOrgId) };
  } catch (err) {
    return failure(err, "company.transfer_options_read");
  }
}
