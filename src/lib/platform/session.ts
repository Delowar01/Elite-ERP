import "server-only";
import { and, desc, eq, gt, gte, isNull, ne, sql } from "drizzle-orm";
import { db, platformAdminsTable, platformSessionsTable, type Tx } from "@/db";
import { hashSessionJti, newSessionJti, signPlatformToken, verifyPlatformToken } from "./auth";
import { recordPlatformAudit } from "./audit";
import { platformClock } from "./clock";
import { PLATFORM_SESSION_POLICY } from "./config";
import { PlatformError } from "./errors";
import { errorClass, reportSecurityIncident } from "./incident";

// ---------------------------------------------------------------------------------------------
// Database-backed, revocable Platform Owner sessions (PR #11 Schema.md §3.2).
//  • The browser token is a signed JWT carrying an opaque jti; only SHA-256(jti) is stored.
//  • A session row is created only after MFA succeeds — there is no "password-only" session.
//  • Validation on EVERY privileged operation: signature/claims, live row, not revoked, admin
//    active with enrolled MFA, absolute expiry (12 h) and idle expiry (30 min) — both provisional.
//  • Idle/absolute expiry revokes the row, so a session can never be revived by clock changes.
//
// PO-01B.1 — atomicity. Every session change and its audit record(s) commit in ONE transaction
// (a caller's transaction is joined). If the audit insert fails the change is rolled back and
// AUDIT_UNAVAILABLE is thrown, so no session is ever revoked half-way or without its record:
//   revokePlatformSession · logoutPlatformSession · revokeAllPlatformSessions (logout-all and the
//   administrative reasons) · idle/absolute expiry (enforced by time either way, see endExpired).
// The ONLY unaudited writes are the two EMERGENCY CONTAINMENT functions below (containPlatform*):
// access-reducing by construction, called by the console only after the audited path failed with
// AUDIT_UNAVAILABLE, always reported as a security incident and never reported as audited; the
// revocation is then recorded in the audit trail late (reconcileUnauditedRevocations).
// No code path ever clears revoked_at: a revoked session cannot regain access.
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

/** Run `fn` in the caller's transaction when one is given, otherwise in a new one. */
function atomically<T>(executor: Tx | typeof db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return executor === db ? db.transaction(fn) : fn(executor as Tx);
}

/**
 * Idle / absolute expiry. Expiry is enforced by TIME — the caller refuses the session whatever
 * happens here. The revocation and its audit record commit together; if the audit trail is
 * unavailable neither is written (an incident is reported and the next request retries), so
 * expiry never depends on the audit system and never leaves an unaudited revocation behind.
 */
async function endExpiredSession(row: { sessionId: string; adminId: string; displayName: string }, reason: "expired" | "idle_timeout", now: Date): Promise<void> {
  const action = reason === "expired" ? "session.expired" : "session.idle_timeout";
  try {
    await db.transaction(async (tx) => {
      if (await revokeRow(row.sessionId, reason, now, tx)) {
        await recordPlatformAudit(
          { actorAdminId: row.adminId, actorLabel: row.displayName, action, entityType: "platform_session", entityId: row.sessionId, after: { revokedReason: reason }, result: "success" },
          tx,
        );
      }
    });
  } catch (err) {
    reportSecurityIncident({ type: "audit_write_failed", action, actorAdminId: row.adminId, sessionIds: [row.sessionId], error: errorClass(err) });
  }
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
    await endExpiredSession(row, "expired", now);
    throw new PlatformError("SESSION_EXPIRED", "absolute lifetime reached");
  }
  if (now.getTime() - row.lastSeenAt.getTime() > PLATFORM_SESSION_POLICY.idleMs) {
    await endExpiredSession(row, "idle_timeout", now);
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

/** Revoke one of the admin's own sessions (e.g. from the security settings list). Atomic with its audit record. */
export async function revokePlatformSession(ctx: PlatformSessionContext, sessionId: string, meta: RequestMeta = {}): Promise<boolean> {
  const now = platformClock.now();
  const reason: RevokeReason = sessionId === ctx.sessionId ? "logout" : "revoked";
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(platformSessionsTable)
      .set({ revokedAt: now, revokedReason: reason })
      .where(and(eq(platformSessionsTable.id, sessionId), eq(platformSessionsTable.platformAdminId, ctx.adminId), isNull(platformSessionsTable.revokedAt)))
      .returning({ id: platformSessionsTable.id });
    if (updated.length !== 1) return false;
    await recordPlatformAudit(
      { actorAdminId: ctx.adminId, actorLabel: ctx.displayName, action: "session.revoked", entityType: "platform_session", entityId: sessionId, after: { revokedReason: reason }, result: "success", ...meta },
      tx,
    );
    return true;
  });
}

async function claimsOrNull(token: string | null | undefined): Promise<{ jti: string; adminId: string } | null> {
  if (!token) return null;
  try {
    const { jti, adminId } = await verifyPlatformToken(token);
    return { jti, adminId };
  } catch {
    return null;
  }
}

/** Logout: revoke the session behind this token, atomically with its audit record. Idempotent; an invalid token is a no-op. */
export async function logoutPlatformSession(token: string | null | undefined, meta: RequestMeta = {}): Promise<boolean> {
  const claims = await claimsOrNull(token);
  if (!claims) return false;
  const now = platformClock.now();
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(platformSessionsTable)
      .set({ revokedAt: now, revokedReason: "logout" })
      .where(and(eq(platformSessionsTable.tokenHash, hashSessionJti(claims.jti)), eq(platformSessionsTable.platformAdminId, claims.adminId), isNull(platformSessionsTable.revokedAt)))
      .returning({ id: platformSessionsTable.id });
    if (updated.length !== 1) return false;
    await recordPlatformAudit(
      { actorAdminId: claims.adminId, actorLabel: "platform admin", action: "session.logout", entityType: "platform_session", entityId: updated[0].id, after: { revokedReason: "logout" }, result: "success", ...meta },
      tx,
    );
    return true;
  });
}

/**
 * Revoke all of an admin's live sessions (logout-all; also the administrative invalidations:
 * password/MFA change and admin disable). `exceptSessionId` keeps the caller's current session
 * alive. Atomic: the revocations, one audit row per revoked session and the summary row commit
 * together (in the caller's transaction when one is given) — all or none.
 */
export async function revokeAllPlatformSessions(
  adminId: string,
  reason: RevokeReason,
  options: { exceptSessionId?: string; actorLabel?: string; meta?: RequestMeta } = {},
  executor: Tx | typeof db = db,
): Promise<number> {
  const now = platformClock.now();
  return atomically(executor, async (tx) => {
    const conditions = [eq(platformSessionsTable.platformAdminId, adminId), isNull(platformSessionsTable.revokedAt)];
    if (options.exceptSessionId) conditions.push(ne(platformSessionsTable.id, options.exceptSessionId));
    const updated = await tx
      .update(platformSessionsTable)
      .set({ revokedAt: now, revokedReason: reason })
      .where(and(...conditions))
      .returning({ id: platformSessionsTable.id });
    const action = reason === "logout_all" ? "session.logout_all" : "session.revoked_all";
    const actorLabel = options.actorLabel ?? "platform admin";
    for (const { id } of updated) {
      await recordPlatformAudit({ actorAdminId: adminId, actorLabel, action, entityType: "platform_session", entityId: id, after: { revokedReason: reason }, result: "success", ...options.meta }, tx);
    }
    await recordPlatformAudit(
      { actorAdminId: adminId, actorLabel, action, entityType: "platform_admin", entityId: adminId, after: { reason, count: updated.length, keptCurrent: Boolean(options.exceptSessionId) }, result: "success", ...options.meta },
      tx,
    );
    return updated.length;
  });
}

// ---- EMERGENCY CONTAINMENT (unaudited by necessity) ---------------------------------------------
// Only for when the audited path has just failed with AUDIT_UNAVAILABLE (see console.ts). Each can
// only SET revoked_at on the given admin's own LIVE sessions — it cannot grant, extend or restore
// access. The caller reports the incident and tells the operator the action was not audited.

export type ContainmentReason = Extract<RevokeReason, "logout" | "revoked" | "logout_all">;

/** EMERGENCY ONLY — revoke one of the admin's own sessions, or all but `allExcept`, without an audit row. */
export async function containPlatformSessions(adminId: string, scope: { sessionId: string } | { allExcept: string | null }, reason: ContainmentReason): Promise<string[]> {
  const now = platformClock.now();
  const conditions = [eq(platformSessionsTable.platformAdminId, adminId), isNull(platformSessionsTable.revokedAt)];
  if ("sessionId" in scope) conditions.push(eq(platformSessionsTable.id, scope.sessionId));
  else if (scope.allExcept) conditions.push(ne(platformSessionsTable.id, scope.allExcept));
  const updated = await db
    .update(platformSessionsTable)
    .set({ revokedAt: now, revokedReason: reason })
    .where(and(...conditions))
    .returning({ id: platformSessionsTable.id });
  return updated.map((u) => u.id);
}

/** EMERGENCY ONLY — the sign-out of the presenting session when its audited logout failed. */
export async function containPlatformSessionByToken(token: string | null | undefined): Promise<{ sessionId: string; adminId: string } | null> {
  const claims = await claimsOrNull(token);
  if (!claims) return null;
  const updated = await db
    .update(platformSessionsTable)
    .set({ revokedAt: platformClock.now(), revokedReason: "logout" })
    .where(and(eq(platformSessionsTable.tokenHash, hashSessionJti(claims.jti)), eq(platformSessionsTable.platformAdminId, claims.adminId), isNull(platformSessionsTable.revokedAt)))
    .returning({ id: platformSessionsTable.id });
  return updated.length === 1 ? { sessionId: updated[0].id, adminId: claims.adminId } : null;
}

/** Every audit action that records a session's revocation (a revoked session lacking all of them was not audited). */
export const SESSION_REVOCATION_ACTIONS = [
  "session.revoked",
  "session.logout",
  "session.logout_all",
  "session.revoked_all",
  "session.expired",
  "session.idle_timeout",
  "session.revocation_recorded_late",
] as const;
const RECONCILE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Name of the transaction-scoped advisory lock that lets only one reconciler run at a time. */
export const RECONCILE_LOCK_NAME = "elite-erp:platform-session-reconcile";

/**
 * Record — late, and labelled as such — every recent session revocation that has no audit row: an
 * emergency containment made while the audit trail was unavailable, or any out-of-band change.
 * All or nothing in one transaction. Exactly once: a transaction-scoped advisory lock, taken BEFORE
 * the select, serialises reconcilers (a concurrent one returns 0 at once — the holder records what
 * is pending), so the select's snapshot already includes every late record an earlier run
 * committed. Row locks alone cannot promise that: a lock-only row lock does not make PostgreSQL
 * re-check the NOT EXISTS condition. Returns how many were recorded.
 */
export async function reconcileUnauditedRevocations(limit = 100): Promise<number> {
  const since = new Date(platformClock.now().getTime() - RECONCILE_WINDOW_MS);
  const actions = sql.join(SESSION_REVOCATION_ACTIONS.map((a) => sql`${a}`), sql`, `);
  return db.transaction(async (tx) => {
    const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${RECONCILE_LOCK_NAME}, 0)) as "locked"`);
    if ((lock.rows[0] as { locked: boolean } | undefined)?.locked !== true) return 0;
    const result = await tx.execute(sql`
      select s.id, s.platform_admin_id as "adminId", s.revoked_at as "revokedAt", s.revoked_reason as "revokedReason"
      from platform_sessions s
      where s.revoked_at is not null and s.revoked_at > ${since}
        and not exists (
          select 1 from platform_audit_events e
          where e.entity_type = 'platform_session' and e.entity_id = s.id::text and e.action in (${actions})
        )
      order by s.revoked_at
      limit ${limit}
      for update of s skip locked`);
    const rows = result.rows as { id: string; adminId: string; revokedAt: Date | string; revokedReason: string }[];
    for (const r of rows) {
      await recordPlatformAudit(
        {
          actorAdminId: r.adminId,
          actorLabel: "system",
          action: "session.revocation_recorded_late",
          entityType: "platform_session",
          entityId: r.id,
          after: { revokedReason: r.revokedReason, revokedAt: new Date(r.revokedAt).toISOString(), recordedLate: true },
          result: "success",
        },
        tx,
      );
    }
    return rows.length;
  });
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
    .where(
      and(
        eq(platformSessionsTable.platformAdminId, adminId),
        isNull(platformSessionsTable.revokedAt),
        gt(platformSessionsTable.expiresAt, now),
        gte(platformSessionsTable.lastSeenAt, new Date(now.getTime() - PLATFORM_SESSION_POLICY.idleMs)),
      ),
    )
    .orderBy(desc(platformSessionsTable.lastSeenAt));
}
