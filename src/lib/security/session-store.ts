import "server-only";
import { createHash, randomBytes } from "crypto";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { db, sessionsTable } from "@/db";
import { getRequestContext } from "./request-context";

// ---------------------------------------------------------------------------
// Stage 11 Part 1 — server-side session records. The JWT carries a random jti;
// we store only its SHA-256 hash. This lets us list devices, terminate one
// session, log out everywhere, and hard-invalidate on password/role/disable/MFA
// changes — none of which a stateless JWT can do on its own.
// ---------------------------------------------------------------------------

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function hashJti(jti: string): string {
  return createHash("sha256").update(jti).digest("hex");
}

/** Create a session row and return the random jti to embed in the JWT. */
export async function createSession(userId: number, orgId: number): Promise<string> {
  const jti = randomBytes(24).toString("base64url");
  const ctx = await getRequestContext();
  await db.insert(sessionsTable).values({
    orgId,
    userId,
    tokenHash: hashJti(jti),
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    browser: ctx.browser,
    os: ctx.os,
    device: ctx.device,
    expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
  });
  return jti;
}

/** True if the session behind this jti is still valid (exists, not revoked, not expired). */
export async function isSessionValid(jti: string): Promise<boolean> {
  const [row] = await db
    .select({ id: sessionsTable.id, revokedAt: sessionsTable.revokedAt, expiresAt: sessionsTable.expiresAt })
    .from(sessionsTable)
    .where(eq(sessionsTable.tokenHash, hashJti(jti)))
    .limit(1);
  if (!row) return false;
  if (row.revokedAt) return false;
  if (row.expiresAt.getTime() < Date.now()) return false;
  return true;
}

/** Throttled last-activity touch (avoids a write on every request). */
export async function touchSession(jti: string): Promise<void> {
  const hash = hashJti(jti);
  const [row] = await db.select({ lastActivityAt: sessionsTable.lastActivityAt }).from(sessionsTable).where(eq(sessionsTable.tokenHash, hash)).limit(1);
  if (!row) return;
  if (Date.now() - row.lastActivityAt.getTime() > 5 * 60 * 1000) {
    await db.update(sessionsTable).set({ lastActivityAt: new Date() }).where(eq(sessionsTable.tokenHash, hash));
  }
}

export async function listActiveSessions(userId: number) {
  return db
    .select()
    .from(sessionsTable)
    .where(and(eq(sessionsTable.userId, userId), isNull(sessionsTable.revokedAt)))
    .orderBy(desc(sessionsTable.lastActivityAt));
}

/** Revoke one session by id, scoped to the owning user. */
export async function revokeSession(userId: number, sessionId: number, reason = "logout"): Promise<boolean> {
  const res = await db
    .update(sessionsTable)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, userId), isNull(sessionsTable.revokedAt)))
    .returning({ id: sessionsTable.id });
  return res.length > 0;
}

/** Revoke the current session by its jti (normal logout). */
export async function revokeCurrentSession(jti: string, reason = "logout"): Promise<void> {
  await db.update(sessionsTable).set({ revokedAt: new Date(), revokedReason: reason }).where(eq(sessionsTable.tokenHash, hashJti(jti)));
}

/**
 * Revoke all of a user's sessions. Auto-invalidation entry point for
 * password change / disable / role change / MFA change. `exceptJti` keeps the
 * caller's own session alive (e.g. "log out all *other* devices").
 */
export async function revokeUserSessions(userId: number, reason: string, exceptJti?: string): Promise<number> {
  const base = and(eq(sessionsTable.userId, userId), isNull(sessionsTable.revokedAt));
  const where = exceptJti ? and(base, ne(sessionsTable.tokenHash, hashJti(exceptJti))) : base;
  const res = await db.update(sessionsTable).set({ revokedAt: new Date(), revokedReason: reason }).where(where).returning({ id: sessionsTable.id });
  return res.length;
}
