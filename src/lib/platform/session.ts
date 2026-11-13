import "server-only";
import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { db, platformAdminsTable, platformSessionsTable, type Tx } from "@/db";
import { hashSessionJti, newSessionJti, signPlatformToken, verifyPlatformToken } from "./auth";
import { recordPlatformAudit } from "./audit";
import { platformClock } from "./clock";
import { PLATFORM_SESSION_POLICY } from "./config";
import { PlatformError } from "./errors";

// ---------------------------------------------------------------------------------------------
// Database-backed, revocable Platform Owner sessions (PR #11 Schema.md §3.2).
//  • The browser token is a signed JWT carrying an opaque jti; only SHA-256(jti) is stored.
//  • A session row is created only after MFA succeeds — there is no "password-only" session.
//  • Validation on EVERY privileged operation: signature/claims, live row, not revoked, admin
//    active with enrolled MFA, absolute expiry (12 h) and idle expiry (30 min) — both provisional.
//  • Idle/absolute expiry revokes the row, so a session can never be revived by clock changes.
// ---------------------------------------------------------------------------------------------

export type RevokeReason = "logout" | "logout_all" | "revoked" | "idle_timeout" | "expired" | "password_change" | "mfa_change" | "admin_disabled";

export type PlatformSessionContext = {
  sessionId: string;
  adminId: string;
  email: string;
  displayName: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
};

export type RequestMeta = { ipAddress?: string | null; userAgent?: string | null; requestId?: string | null };

const clip = (value: string | null | undefined, max: number) => (value ? value.slice(0, max) : null);

/** Create a session for an admin whose password AND second factor were verified at `now`. */
export async function createPlatformSession(
  input: { adminId: string; now: Date; meta?: RequestMeta },
  executor: Tx | typeof db = db,
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const jti = newSessionJti();
  const expiresAt = new Date(input.now.getTime() + PLATFORM_SESSION_POLICY.absoluteMs);
  const [row] = await executor
    .insert(platformSessionsTable)
    .values({
      platformAdminId: input.adminId,
      tokenHash: hashSessionJti(jti),
      mfaVerifiedAt: input.now,
      createdAt: input.now,
      lastSeenAt: input.now,
      expiresAt,
      ipAddress: clip(input.meta?.ipAddress, 64),
      userAgent: clip(input.meta?.userAgent, 512),
    })
    .returning({ id: platformSessionsTable.id });
  const token = await signPlatformToken({ adminId: input.adminId, jti, issuedAt: input.now, expiresAt });
  return { token, sessionId: row.id, expiresAt };
}

async function revokeRow(sessionId: string, reason: RevokeReason, now: Date, executor: Tx | typeof db = db): Promise<boolean> {
  const updated = await executor
    .update(platformSessionsTable)
    .set({ revokedAt: now, revokedReason: reason })
    .where(and(eq(platformSessionsTable.id, sessionId), isNull(platformSessionsTable.revokedAt)))
    .returning({ id: platformSessionsTable.id });
  return updated.length === 1;
}

/**
 * Validate a presented token against the live session row. Throws UNAUTHORIZED for anything
 * forged, unknown, revoked or belonging to an inactive admin, and SESSION_EXPIRED (after revoking
 * the row) for absolute or idle expiry. Refreshes last_seen_at at most once per touch interval.
 */
export async function validatePlatformSession(token: string | null | undefined, options: { touch?: boolean } = {}): Promise<PlatformSessionContext> {
  if (!token) throw new PlatformError("UNAUTHORIZED", "no platform session token");
  const claims = await verifyPlatformToken(token);
  const now = platformClock.now();
  const [row] = await db
    .select({
      sessionId: platformSessionsTable.id,
      adminId: platformSessionsTable.platformAdminId,
      mfaVerifiedAt: platformSessionsTable.mfaVerifiedAt,
      createdAt: platformSessionsTable.createdAt,
      lastSeenAt: platformSessionsTable.lastSeenAt,
      expiresAt: platformSessionsTable.expiresAt,
      revokedAt: platformSessionsTable.revokedAt,
      email: platformAdminsTable.emailNormalized,
      displayName: platformAdminsTable.displayName,
      adminActive: platformAdminsTable.isActive,
      mfaEnrolledAt: platformAdminsTable.mfaEnrolledAt,
    })
    .from(platformSessionsTable)
    .innerJoin(platformAdminsTable, eq(platformAdminsTable.id, platformSessionsTable.platformAdminId))
    .where(eq(platformSessionsTable.tokenHash, hashSessionJti(claims.jti)));

  if (!row || row.adminId !== claims.adminId || row.revokedAt) throw new PlatformError("UNAUTHORIZED", "session not live");
  if (!row.adminActive || !row.mfaEnrolledAt || !row.mfaVerifiedAt) throw new PlatformError("UNAUTHORIZED", "admin not eligible");

  if (now.getTime() >= row.expiresAt.getTime()) {
    if (await revokeRow(row.sessionId, "expired", now)) {
      await recordPlatformAudit({ actorAdminId: row.adminId, actorLabel: row.displayName, action: "session.expired", entityType: "platform_session", entityId: row.sessionId, result: "success" });
    }
    throw new PlatformError("SESSION_EXPIRED", "absolute lifetime reached");
  }
  if (now.getTime() - row.lastSeenAt.getTime() > PLATFORM_SESSION_POLICY.idleMs) {
    if (await revokeRow(row.sessionId, "idle_timeout", now)) {
      await recordPlatformAudit({ actorAdminId: row.adminId, actorLabel: row.displayName, action: "session.idle_timeout", entityType: "platform_session", entityId: row.sessionId, result: "success" });
    }
    throw new PlatformError("SESSION_EXPIRED", "idle timeout");
  }

  let lastSeenAt = row.lastSeenAt;
  if (options.touch !== false && now.getTime() - row.lastSeenAt.getTime() >= PLATFORM_SESSION_POLICY.touchIntervalMs) {
    const touched = await db
      .update(platformSessionsTable)
      .set({ lastSeenAt: now })
      .where(and(eq(platformSessionsTable.id, row.sessionId), isNull(platformSessionsTable.revokedAt)))
      .returning({ id: platformSessionsTable.id });
    if (touched.length !== 1) throw new PlatformError("UNAUTHORIZED", "session revoked concurrently");
    lastSeenAt = now;
  }
  return {
    sessionId: row.sessionId,
    adminId: row.adminId,
    email: row.email,
    displayName: row.displayName,
    createdAt: row.createdAt,
    lastSeenAt,
    expiresAt: row.expiresAt,
  };
}

/** Revoke one of the admin's own sessions (e.g. from the security settings list). */
export async function revokePlatformSession(ctx: PlatformSessionContext, sessionId: string, meta: RequestMeta = {}): Promise<boolean> {
  const now = platformClock.now();
  const updated = await db
    .update(platformSessionsTable)
    .set({ revokedAt: now, revokedReason: sessionId === ctx.sessionId ? "logout" : "revoked" })
    .where(and(eq(platformSessionsTable.id, sessionId), eq(platformSessionsTable.platformAdminId, ctx.adminId), isNull(platformSessionsTable.revokedAt)))
    .returning({ id: platformSessionsTable.id });
  if (updated.length !== 1) return false;
  await recordPlatformAudit({ actorAdminId: ctx.adminId, actorLabel: ctx.displayName, action: "session.revoked", entityType: "platform_session", entityId: sessionId, result: "success", ...meta });
  return true;
}

/** Logout: revoke the session behind this token. Idempotent; an invalid token is a no-op. */
export async function logoutPlatformSession(token: string | null | undefined, meta: RequestMeta = {}): Promise<boolean> {
  if (!token) return false;
  let jti: string;
  let adminId: string;
  try {
    ({ jti, adminId } = await verifyPlatformToken(token));
  } catch {
    return false;
  }
  const now = platformClock.now();
  const updated = await db
    .update(platformSessionsTable)
    .set({ revokedAt: now, revokedReason: "logout" })
    .where(and(eq(platformSessionsTable.tokenHash, hashSessionJti(jti)), eq(platformSessionsTable.platformAdminId, adminId), isNull(platformSessionsTable.revokedAt)))
    .returning({ id: platformSessionsTable.id });
  if (updated.length !== 1) return false;
  await recordPlatformAudit({ actorAdminId: adminId, actorLabel: "platform admin", action: "session.logout", entityType: "platform_session", entityId: updated[0].id, result: "success", ...meta });
  return true;
}

/**
 * Revoke all of an admin's live sessions (logout-all; also used for password/MFA change and admin
 * disable). `exceptSessionId` keeps the caller's current session alive.
 */
export async function revokeAllPlatformSessions(
  adminId: string,
  reason: RevokeReason,
  options: { exceptSessionId?: string; actorLabel?: string; meta?: RequestMeta } = {},
  executor: Tx | typeof db = db,
): Promise<number> {
  const now = platformClock.now();
  const conditions = [eq(platformSessionsTable.platformAdminId, adminId), isNull(platformSessionsTable.revokedAt)];
  if (options.exceptSessionId) conditions.push(ne(platformSessionsTable.id, options.exceptSessionId));
  const updated = await executor
    .update(platformSessionsTable)
    .set({ revokedAt: now, revokedReason: reason })
    .where(and(...conditions))
    .returning({ id: platformSessionsTable.id });
  await recordPlatformAudit(
    {
      actorAdminId: adminId,
      actorLabel: options.actorLabel ?? "platform admin",
      action: reason === "logout_all" ? "session.logout_all" : "session.revoked_all",
      entityType: "platform_admin",
      entityId: adminId,
      after: { reason, count: updated.length, keptCurrent: Boolean(options.exceptSessionId) },
      result: "success",
      ...options.meta,
    },
    executor,
  );
  return updated.length;
}

/** Live sessions for the security settings list. Token hashes are never returned. */
export async function listActivePlatformSessions(adminId: string) {
  const now = platformClock.now();
  return db
    .select({
      id: platformSessionsTable.id,
      createdAt: platformSessionsTable.createdAt,
      lastSeenAt: platformSessionsTable.lastSeenAt,
      expiresAt: platformSessionsTable.expiresAt,
      ipAddress: platformSessionsTable.ipAddress,
      userAgent: platformSessionsTable.userAgent,
    })
    .from(platformSessionsTable)
    .where(and(eq(platformSessionsTable.platformAdminId, adminId), isNull(platformSessionsTable.revokedAt), gt(platformSessionsTable.expiresAt, now)))
    .orderBy(desc(platformSessionsTable.lastSeenAt));
}
