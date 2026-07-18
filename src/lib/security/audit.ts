import "server-only";
import { db, auditLogsTable, securityEventsTable, fileAccessLogsTable } from "@/db";
import { getRequestContext } from "./request-context";

// ---------------------------------------------------------------------------
// Stage 11 Part 9 — immutable audit trail + Part 4 security-event feed.
//
// These modules expose ONLY inserts. There is deliberately no update/delete
// helper anywhere in the codebase for audit_logs or security_events; in
// production a DB trigger (drizzle/immutable_audit.sql) additionally rejects
// UPDATE/DELETE at the database level, so the trail is append-only end to end.
// ---------------------------------------------------------------------------

export type AuditActor = { orgId: number | null; userId: number | null; userName?: string | null };

export async function recordAudit(
  actor: AuditActor,
  entry: {
    action: string;
    entityType?: string | null;
    entityId?: number | null;
    previousValue?: unknown;
    newValue?: unknown;
  },
) {
  const ctx = await getRequestContext();
  await db.insert(auditLogsTable).values({
    orgId: actor.orgId,
    userId: actor.userId,
    userName: actor.userName ?? null,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    previousValue: entry.previousValue === undefined ? null : (entry.previousValue as object),
    newValue: entry.newValue === undefined ? null : (entry.newValue as object),
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    browser: ctx.browser,
    os: ctx.os,
    device: ctx.device,
  });
}

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export async function recordSecurityEvent(entry: {
  orgId?: number | null;
  userId?: number | null;
  email?: string | null;
  type: string;
  severity?: Severity;
  detail?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const ctx = await getRequestContext();
  await db.insert(securityEventsTable).values({
    orgId: entry.orgId ?? null,
    userId: entry.userId ?? null,
    email: entry.email ?? null,
    type: entry.type,
    severity: entry.severity ?? "info",
    detail: entry.detail ?? null,
    metadata: entry.metadata ?? null,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    browser: ctx.browser,
    os: ctx.os,
    device: ctx.device,
  });
}

// Part 3 — download auditing for the private uploads/ store. Insert-only, like
// the trail above. Best-effort: a logging failure must never block the download.
export async function recordFileAccess(entry: {
  orgId: number;
  userId: number | null;
  folder: string;
  fileName: string;
  ipAddress: string | null;
}) {
  try {
    await db.insert(fileAccessLogsTable).values({
      orgId: entry.orgId,
      userId: entry.userId,
      folder: entry.folder,
      fileName: entry.fileName,
      ipAddress: entry.ipAddress,
    });
  } catch {
    // swallow — audit logging must not affect file serving
  }
}
