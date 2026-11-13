import "server-only";
import { sql } from "drizzle-orm";
import { db, platformAuditEventsTable, type Tx } from "@/db";
import { AUDIT_PROTECTION_QUERY, evaluateAuditProtection, type AuditProtectionRow } from "./audit-protection";
import { platformClock } from "./clock";
import { PlatformError } from "./errors";
import { errorClass } from "./incident";

// ---------------------------------------------------------------------------------------------
// Append-only Platform Owner audit (PR #11 Schema.md §3.4). This module can only INSERT: there is
// deliberately no update or delete helper, and the database rejects UPDATE/DELETE/TRUNCATE.
// Snapshots are redacted by construction — keys that could carry credentials are refused.
// ---------------------------------------------------------------------------------------------

export type PlatformAuditResult = "success" | "rejected" | "failed";

export type PlatformAuditInput = {
  actorAdminId?: string | null;
  /** Display snapshot, e.g. the operator's name, "anonymous" or "system". */
  actorLabel: string;
  /** Dotted lowercase code, e.g. "auth.login.succeeded". */
  action: string;
  entityType: string;
  entityId: string;
  orgId?: number | null;
  reason?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  result: PlatformAuditResult;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

const ACTION = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FORBIDDEN_KEY = /pass(word)?|secret|token|jti|totp|otp|mfa_?code|recovery|hash|cookie|authorization|credential|private/i;
const MAX_SNAPSHOT_BYTES = 8192;

function assertSafeValue(value: unknown, path: string, depth: number): void {
  if (depth > 6) throw new PlatformError("VALIDATION_FAILED", `audit snapshot too deep at ${path}`);
  if (value === null || typeof value === "number" || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.length > 1000) throw new PlatformError("VALIDATION_FAILED", `audit snapshot string too long at ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertSafeValue(v, `${path}[${i}]`, depth + 1));
    return;
  }
  if (typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY.test(key)) throw new PlatformError("VALIDATION_FAILED", `audit snapshot key "${key}" is not allowed`);
      assertSafeValue(v, `${path}.${key}`, depth + 1);
    }
    return;
  }
  throw new PlatformError("VALIDATION_FAILED", `audit snapshot value at ${path} is not JSON`);
}

function safeSnapshot(value: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new PlatformError("VALIDATION_FAILED", "audit snapshot must be an object");
  assertSafeValue(value, "$", 0);
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_SNAPSHOT_BYTES) throw new PlatformError("VALIDATION_FAILED", "audit snapshot too large");
  return value;
}

const clip = (value: string | null | undefined, max: number) => (value ? value.slice(0, max) : null);

/**
 * Insert one audit event (inside the caller's transaction when `executor` is a Tx).
 *
 * PO-01B.1: a failed INSERT is reported as PlatformError("AUDIT_UNAVAILABLE") — the database error
 * itself (which may quote values) is never surfaced. Callers that change state write the change and
 * this record in ONE transaction, so this error always means "nothing was applied".
 */
export async function recordPlatformAudit(input: PlatformAuditInput, executor: Tx | typeof db = db): Promise<number> {
  if (!ACTION.test(input.action)) throw new PlatformError("VALIDATION_FAILED", `invalid audit action "${input.action}"`);
  if (input.requestId && !UUID.test(input.requestId)) throw new PlatformError("VALIDATION_FAILED", "requestId must be a UUID");
  const values = {
    actorPlatformAdminId: input.actorAdminId ?? null,
    actorLabel: clip(input.actorLabel, 200) || "system",
    action: input.action,
    entityType: clip(input.entityType, 100) || "unknown",
    entityId: clip(input.entityId, 200) || "unknown",
    orgId: input.orgId ?? null,
    reason: clip(input.reason, 2000),
    beforeSafe: safeSnapshot(input.before),
    afterSafe: safeSnapshot(input.after),
    result: input.result,
    requestId: input.requestId ?? null,
    ipAddress: clip(input.ipAddress, 64),
    userAgent: clip(input.userAgent, 512),
    createdAt: platformClock.now(),
  };
  let row: { id: number } | undefined;
  try {
    [row] = await executor.insert(platformAuditEventsTable).values(values).returning({ id: platformAuditEventsTable.id });
  } catch (err) {
    throw new PlatformError("AUDIT_UNAVAILABLE", `audit insert failed (${errorClass(err)})`);
  }
  if (!row) throw new PlatformError("AUDIT_UNAVAILABLE", "audit insert returned no row");
  return row.id;
}

// Positive verdicts are cached briefly so a disabled or dropped trigger is noticed within minutes
// without a catalog query on every request. A negative verdict is never cached.
const PROTECTION_CACHE_MS = 5 * 60 * 1000;
let protectionVerifiedAt = 0;

/**
 * Fail closed unless the append-only triggers are really in force on platform_audit_events
 * (decoy-resistant: table binding, timing, events, enabled state and function body).
 */
export async function assertPlatformAuditProtection(options: { force?: boolean } = {}): Promise<void> {
  const nowMs = Date.now();
  if (!options.force && protectionVerifiedAt && nowMs - protectionVerifiedAt < PROTECTION_CACHE_MS) return;
  const result = await db.execute(sql.raw(AUDIT_PROTECTION_QUERY));
  const verdict = evaluateAuditProtection(result.rows as unknown as AuditProtectionRow[]);
  if (!verdict.ok) {
    protectionVerifiedAt = 0;
    throw new PlatformError("CONFIG_ERROR", `platform audit protection missing: ${verdict.missing.join("; ")}`);
  }
  protectionVerifiedAt = nowMs;
}
