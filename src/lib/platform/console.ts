import "server-only";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, platformAdminsTable } from "@/db";
import { verifyPlatformPassword } from "./auth";
import { assertPlatformAuditProtection, recordPlatformAudit } from "./audit";
import { platformClock } from "./clock";
import { clientIpFromHeaders, type HeaderSource } from "./client-ip";
import { PLATFORM_SESSION_POLICY } from "./config";
import { isPlatformError, PlatformError, type PlatformErrorCode } from "./errors";
import { assertPlatformConsoleEnabled } from "./flags";
import { authorizePlatformToken, type PlatformPermission } from "./guards";
import { platformLogin } from "./login";
import { consumeTotpCode, replaceRecoveryCodes } from "./mfa";
import { assertSameOrigin } from "./origin";
import { listActivePlatformSessions, logoutPlatformSession, revokeAllPlatformSessions, revokePlatformSession, type PlatformSessionContext, type RequestMeta } from "./session";
import { activeLoginBlock, recordLoginAttempt, throttleKeys } from "./throttle";

// ---------------------------------------------------------------------------------------------
// Platform console operations (PO-01B). Each takes the request's headers and the platform token
// explicitly, so the server actions in src/app/(platform) are thin wrappers and every rule here is
// testable without a Next.js request. Authorization never depends on the UI having rendered:
// every state-changing operation re-checks, in order,
//   feature flag → same-origin (CSRF) → live database session + permission
// and returns a typed, user-safe error code. Internal failures are reported as CONFIG_ERROR
// ("temporarily unavailable"), never with their details.
// ---------------------------------------------------------------------------------------------

export type ConsoleRequest = { headers: HeaderSource; token?: string | null };
export type ConsoleFailure = { ok: false; code: PlatformErrorCode };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function requestMeta(headers: HeaderSource): RequestMeta {
  const ua = (headers.get("user-agent") ?? "").slice(0, 512);
  return { ipAddress: clientIpFromHeaders(headers), userAgent: ua || null, requestId: randomUUID() };
}

function failure(err: unknown): ConsoleFailure {
  if (isPlatformError(err)) return { ok: false, code: err.code };
  // Never surface internal detail to the browser; keep a bounded server-side trace without payloads.
  const name = err instanceof Error ? err.name : "UnknownError";
  console.error(`[platform-console] internal failure: ${name}`);
  return { ok: false, code: "CONFIG_ERROR" };
}

async function authorizeMutation(req: ConsoleRequest, permission: PlatformPermission): Promise<PlatformSessionContext> {
  assertPlatformConsoleEnabled();
  assertSameOrigin(req.headers);
  return authorizePlatformToken(req.token, permission);
}

// ---- sign in -----------------------------------------------------------------------------------

export type SignInInput = { email: string; password: string; totpCode?: string | null; recoveryCode?: string | null };
export type SignInOutcome =
  | { ok: true; token: string; expiresAt: Date; method: "totp" | "recovery_code"; remainingRecoveryCodes?: number }
  | ConsoleFailure;

export async function signInCore(input: SignInInput, req: ConsoleRequest): Promise<SignInOutcome> {
  try {
    assertPlatformConsoleEnabled();
    assertSameOrigin(req.headers);
    const result = await platformLogin({ ...input, ...requestMeta(req.headers) });
    return { ok: true, token: result.token, expiresAt: result.expiresAt, method: result.method, remainingRecoveryCodes: result.remainingRecoveryCodes };
  } catch (err) {
    return failure(err);
  }
}

// ---- sign out (current session) -----------------------------------------------------------------

export async function signOutCore(req: ConsoleRequest): Promise<{ ok: true } | ConsoleFailure> {
  try {
    assertPlatformConsoleEnabled();
    assertSameOrigin(req.headers);
    await logoutPlatformSession(req.token, requestMeta(req.headers)); // idempotent; an invalid token is a no-op
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

// ---- security settings: read -------------------------------------------------------------------

export type SecurityOverview = {
  operator: { name: string; email: string };
  current: { sessionId: string; createdAt: Date; lastSeenAt: Date; expiresAt: Date };
  sessions: { id: string; createdAt: Date; lastSeenAt: Date; expiresAt: Date; ipAddress: string | null; userAgent: string | null; current: boolean }[];
  recoveryCodesRemaining: number;
  mfaEnrolledAt: Date | null;
  policy: { absoluteHours: number; idleMinutes: number };
};

/** Read-only (no origin check needed); throws PlatformError for the page's error/denied states. */
export async function securityOverviewCore(req: ConsoleRequest): Promise<SecurityOverview> {
  const ctx = await authorizePlatformToken(req.token, "platform.sessions.manage");
  const sessions = await listActivePlatformSessions(ctx.adminId);
  const [admin] = await db
    .select({ remaining: sql<number>`jsonb_array_length(${platformAdminsTable.mfaRecoveryHashes})::int`, mfaEnrolledAt: platformAdminsTable.mfaEnrolledAt })
    .from(platformAdminsTable)
    .where(eq(platformAdminsTable.id, ctx.adminId));
  return {
    operator: { name: ctx.displayName, email: ctx.email },
    current: { sessionId: ctx.sessionId, createdAt: ctx.createdAt, lastSeenAt: ctx.lastSeenAt, expiresAt: ctx.expiresAt },
    sessions: sessions.map((s) => ({ ...s, current: s.id === ctx.sessionId })),
    recoveryCodesRemaining: admin?.remaining ?? 0,
    mfaEnrolledAt: admin?.mfaEnrolledAt ?? null,
    policy: { absoluteHours: PLATFORM_SESSION_POLICY.absoluteMs / 3_600_000, idleMinutes: PLATFORM_SESSION_POLICY.idleMs / 60_000 },
  };
}

// ---- security settings: revoke one / sign out others -------------------------------------------

/** Revokes one of the CALLER's sessions. Another administrator's session id is indistinguishable from an unknown one. */
export async function revokeSessionCore(req: ConsoleRequest, sessionId: string): Promise<{ ok: true; signedOutCurrent: boolean } | ConsoleFailure> {
  try {
    const ctx = await authorizeMutation(req, "platform.sessions.manage");
    if (typeof sessionId !== "string" || !UUID.test(sessionId)) throw new PlatformError("VALIDATION_FAILED", "session id is not a UUID");
    const revoked = await revokePlatformSession(ctx, sessionId, requestMeta(req.headers));
    if (!revoked) throw new PlatformError("NOT_FOUND", "no live session with this id for the caller");
    return { ok: true, signedOutCurrent: sessionId === ctx.sessionId };
  } catch (err) {
    return failure(err);
  }
}

export async function signOutOtherSessionsCore(req: ConsoleRequest): Promise<{ ok: true; count: number } | ConsoleFailure> {
  try {
    const ctx = await authorizeMutation(req, "platform.sessions.manage");
    const count = await revokeAllPlatformSessions(ctx.adminId, "logout_all", { exceptSessionId: ctx.sessionId, actorLabel: ctx.displayName, meta: requestMeta(req.headers) });
    return { ok: true, count };
  } catch (err) {
    return failure(err);
  }
}

// ---- security settings: recovery-code regeneration (step-up) ----------------------------------

/**
 * Re-authentication (password + a FRESH TOTP code) and replacement of all recovery codes. The TOTP
 * step is consumed and the codes replaced in ONE transaction; a failed password or second factor
 * changes nothing. Failures count against the same durable account/IP throttle as sign-in.
 */
export async function regenerateRecoveryCodesCore(
  req: ConsoleRequest,
  input: { password: string; totpCode: string },
): Promise<{ ok: true; codes: string[] } | ConsoleFailure> {
  try {
    const ctx = await authorizeMutation(req, "platform.mfa.manage");
    // A credential change fails closed while the audit trail is unprotected, as sign-in does. The
    // access-REDUCING actions above (revoke, sign out) stay available so an incident can be contained.
    await assertPlatformAuditProtection();
    const meta = requestMeta(req.headers);
    const now = platformClock.now();
    const keys = throttleKeys(ctx.email, meta.ipAddress);
    const base = { actorAdminId: ctx.adminId, actorLabel: ctx.displayName, entityType: "platform_admin", entityId: ctx.adminId, ...meta };

    if (await activeLoginBlock(keys, now)) {
      await recordLoginAttempt(keys, "blocked", now);
      await recordPlatformAudit({ ...base, action: "mfa.recovery_codes.blocked", result: "rejected" });
      throw new PlatformError("RATE_LIMITED", "step-up blocked by throttle");
    }

    const [admin] = await db.select({ passwordHash: platformAdminsTable.passwordHash, isActive: platformAdminsTable.isActive }).from(platformAdminsTable).where(eq(platformAdminsTable.id, ctx.adminId));
    const passwordOk = await verifyPlatformPassword(String(input.password ?? ""), admin?.isActive ? admin.passwordHash : null);
    if (!passwordOk) {
      await recordLoginAttempt(keys, "failure", now);
      await recordPlatformAudit({ ...base, action: "mfa.recovery_codes.reauth_failed", after: { stage: "password" }, result: "rejected" });
      throw new PlatformError("INVALID_CREDENTIALS", "step-up password check failed");
    }

    const outcome = await db.transaction(async (tx) => {
      const verified = await consumeTotpCode(tx, ctx.adminId, String(input.totpCode ?? ""), now);
      if (!verified.ok) return { ok: false as const, reason: verified.reason };
      const codes = await replaceRecoveryCodes(tx, ctx.adminId, now);
      await recordPlatformAudit({ ...base, action: "mfa.recovery_codes.regenerated", after: { backupCodesIssued: codes.length }, result: "success" }, tx);
      return { ok: true as const, codes };
    });
    if (!outcome.ok) {
      await recordLoginAttempt(keys, "failure", now);
      await recordPlatformAudit({ ...base, action: outcome.reason === "replayed" ? "mfa.recovery_codes.replay_rejected" : "mfa.recovery_codes.reauth_failed", after: { stage: "mfa" }, result: "rejected" });
      throw new PlatformError("MFA_INVALID", "step-up second factor failed");
    }
    return { ok: true, codes: outcome.codes };
  } catch (err) {
    return failure(err);
  }
}
