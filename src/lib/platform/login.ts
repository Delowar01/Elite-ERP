import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, platformAdminsTable } from "@/db";
import { normalizePlatformEmail, verifyPlatformPassword, warmPlatformAuth } from "./auth";
import { assertPlatformAuditProtection, recordPlatformAudit } from "./audit";
import { platformClock } from "./clock";
import { assertPlatformConfiguration } from "./config";
import { PlatformError } from "./errors";
import { assertPlatformConsoleEnabled } from "./flags";
import { consumeRecoveryCode, consumeTotpCode } from "./mfa";
import { createPlatformSession, type RequestMeta } from "./session";
import { activeLoginBlock, recordLoginAttempt, throttleKeys } from "./throttle";

// ---------------------------------------------------------------------------------------------
// Platform Owner login (PR #11 appflow §2): password → mandatory TOTP or single-use recovery
// code → separate revocable platform session. No session of any kind exists before the second
// factor succeeds; the UI (PO-01B) re-submits the credentials with the code, as the customer
// login does, so no half-authenticated state is stored server-side.
//
// Every failure is generic. Unknown, inactive and wrong-password accounts cost the same bcrypt
// work and return the same INVALID_CREDENTIALS error; only the throttle answer (RATE_LIMITED)
// differs, and it is decided before any password is checked.
// ---------------------------------------------------------------------------------------------

export type PlatformLoginInput = {
  email: string;
  password: string;
  totpCode?: string | null;
  recoveryCode?: string | null;
} & RequestMeta;

export type PlatformLoginSuccess = {
  status: "authenticated";
  token: string;
  sessionId: string;
  expiresAt: Date;
  adminId: string;
  method: "totp" | "recovery_code";
  remainingRecoveryCodes?: number;
};

warmPlatformAuth();

export async function platformLogin(input: PlatformLoginInput): Promise<PlatformLoginSuccess> {
  assertPlatformConsoleEnabled();
  assertPlatformConfiguration();
  await assertPlatformAuditProtection();

  const now = platformClock.now();
  const meta: RequestMeta = { ipAddress: input.ipAddress ?? null, userAgent: input.userAgent ?? null, requestId: input.requestId ?? null };
  const email = normalizePlatformEmail(String(input.email ?? "").slice(0, 400));
  const password = String(input.password ?? "");
  const keys = throttleKeys(email, meta.ipAddress);

  // 1. Throttle — decided before any credential is examined.
  if (await activeLoginBlock(keys, now)) {
    const attempt = await recordLoginAttempt(keys, "blocked", now);
    await recordPlatformAudit({ actorLabel: "anonymous", action: "auth.login.blocked", entityType: "login_attempt", entityId: attempt.id, result: "rejected", ...meta });
    throw new PlatformError("RATE_LIMITED", "login blocked by throttle");
  }

  // 2. Password — constant work whether or not the account exists or is active.
  const [admin] = email
    ? await db
        .select({ id: platformAdminsTable.id, displayName: platformAdminsTable.displayName, passwordHash: platformAdminsTable.passwordHash, isActive: platformAdminsTable.isActive, mfaEnrolledAt: platformAdminsTable.mfaEnrolledAt, mfaSecretEncrypted: platformAdminsTable.mfaSecretEncrypted })
        .from(platformAdminsTable)
        .where(eq(sql`lower(${platformAdminsTable.emailNormalized})`, email))
    : [];
  const eligible = Boolean(admin && admin.isActive && admin.mfaEnrolledAt && admin.mfaSecretEncrypted);
  const passwordOk = await verifyPlatformPassword(password, eligible ? admin.passwordHash : null);
  if (!passwordOk || !eligible) {
    const attempt = await recordLoginAttempt(keys, "failure", now);
    await recordPlatformAudit({
      actorAdminId: eligible ? admin.id : null,
      actorLabel: eligible ? admin.displayName : "anonymous",
      action: "auth.login.failed",
      entityType: eligible ? "platform_admin" : "login_attempt",
      entityId: eligible ? admin.id : attempt.id,
      after: { stage: "password", blocked: attempt.blockedUntil !== null },
      result: "rejected",
      ...meta,
    });
    throw new PlatformError("INVALID_CREDENTIALS", "password check failed");
  }

  // 3. Mandatory second factor.
  const totpCode = input.totpCode ? String(input.totpCode) : "";
  const recoveryCode = input.recoveryCode ? String(input.recoveryCode) : "";
  if (!totpCode && !recoveryCode) {
    await recordLoginAttempt(keys, "mfa_required", now);
    await recordPlatformAudit({ actorAdminId: admin.id, actorLabel: admin.displayName, action: "auth.mfa.required", entityType: "platform_admin", entityId: admin.id, result: "rejected", ...meta });
    throw new PlatformError("MFA_REQUIRED", "second factor not supplied");
  }

  type Outcome = { ok: true; session: { token: string; sessionId: string; expiresAt: Date }; method: "totp" | "recovery_code"; remaining?: number } | { ok: false; reason: string };
  const outcome: Outcome = await db.transaction(async (tx) => {
    let method: "totp" | "recovery_code";
    let remaining: number | undefined;
    if (totpCode) {
      const r = await consumeTotpCode(tx, admin.id, totpCode, now);
      if (!r.ok) return { ok: false, reason: r.reason === "replayed" ? "totp_replayed" : "totp_invalid" };
      method = "totp";
    } else {
      const r = await consumeRecoveryCode(tx, admin.id, recoveryCode, now);
      if (!r.ok) return { ok: false, reason: "recovery_code_invalid" };
      method = "recovery_code";
      remaining = r.remaining;
    }
    const session = await createPlatformSession({ adminId: admin.id, now, meta }, tx);
    await tx.update(platformAdminsTable).set({ lastLoginAt: now, updatedAt: now }).where(eq(platformAdminsTable.id, admin.id));
    await recordPlatformAudit(
      { actorAdminId: admin.id, actorLabel: admin.displayName, action: "auth.login.succeeded", entityType: "platform_session", entityId: session.sessionId, after: { method }, result: "success", ...meta },
      tx,
    );
    if (method === "recovery_code") {
      await recordPlatformAudit(
        { actorAdminId: admin.id, actorLabel: admin.displayName, action: "auth.recovery_code.used", entityType: "platform_admin", entityId: admin.id, after: { remaining: remaining ?? 0 }, result: "success", ...meta },
        tx,
      );
    }
    return { ok: true, session, method, remaining };
  });

  if (!outcome.ok) {
    const attempt = await recordLoginAttempt(keys, "failure", now);
    await recordPlatformAudit({
      actorAdminId: admin.id,
      actorLabel: admin.displayName,
      action: outcome.reason === "totp_replayed" ? "auth.mfa.replay_rejected" : outcome.reason === "recovery_code_invalid" ? "auth.recovery_code.failed" : "auth.mfa.failed",
      entityType: "platform_admin",
      entityId: admin.id,
      after: { stage: "mfa", blocked: attempt.blockedUntil !== null },
      result: "rejected",
      ...meta,
    });
    throw new PlatformError("MFA_INVALID", outcome.reason);
  }

  await recordLoginAttempt(keys, "success", now);
  return {
    status: "authenticated",
    token: outcome.session.token,
    sessionId: outcome.session.sessionId,
    expiresAt: outcome.session.expiresAt,
    adminId: admin.id,
    method: outcome.method,
    remainingRecoveryCodes: outcome.remaining,
  };
}
