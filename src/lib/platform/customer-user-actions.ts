import "server-only";
import { db } from "@/db";
import {
  companyOfCustomerUser,
  deactivationBlock,
  endCustomerUserSessions,
  isOwnerProtectionUnavailable,
  lockCompanyUsers,
  lockCustomerUsers,
  PLATFORM_REVOKED_REASON,
  recordPlatformChangeEvidence,
  setCustomerUserActive,
  USER_DISABLED_REVOKE_REASON,
  USER_REENABLED_REVOKE_REASON,
} from "@/lib/team/customer-user-core";
import { assertPlatformAuditProtection, recordPlatformAudit } from "./audit";
import { platformClock } from "./clock";
import { normalizeAccessReason } from "./company-access-actions";
import { requestMeta, type ConsoleFailure, type ConsoleRequest } from "./console";
import { parseCustomerUserId, readCustomerUserState, type CustomerUserState } from "./customer-users";
import { isPlatformError, PlatformError } from "./errors";
import { assertPlatformConsoleEnabled } from "./flags";
import { authorizePlatformToken } from "./guards";
import { errorClass, reportSecurityIncident } from "./incident";
import { consumeTotpCode } from "./mfa";
import { assertSameOrigin } from "./origin";
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
  const stages: Partial<Record<string, string>> = { NOT_FOUND: "not_found", CONFLICT: "state", VERSION_CONFLICT: "stale", LAST_PRIMARY_OWNER: "primary_owner", LAST_ACTIVE_OWNER: "last_owner" };
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
