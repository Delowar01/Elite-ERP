import "server-only";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db, orgsTable, platformAdminsTable, sessionsTable, tenantAccessControlsTable } from "@/db";
import { verifyPlatformPassword } from "./auth";
import { assertPlatformAuditProtection, recordPlatformAudit } from "./audit";
import { platformClock } from "./clock";
import { ORG_SUSPENDED_REVOKE_REASON, resolveTenantAccess, tenantAccessEnforcementEnabled, type TenantAccess, type TenantAccessStatus } from "./company-access";
import { orgReference, parseOrgId } from "./companies";
import { requestMeta, type ConsoleFailure, type ConsoleRequest } from "./console";
import { isPlatformError, PlatformError } from "./errors";
import { assertPlatformConsoleEnabled } from "./flags";
import { authorizePlatformToken } from "./guards";
import { errorClass, reportSecurityIncident } from "./incident";
import { consumeTotpCode } from "./mfa";
import { assertSameOrigin } from "./origin";
import type { PlatformSessionContext } from "./session";
import { activeLoginBlock, recordLoginAttempt, throttleKeys } from "./throttle";

// ---------------------------------------------------------------------------------------------
// Platform Owner PO-02C — company access: suspend, reactivate, read (PR #11 PRD P-04, TRD §4, §7.2,
// §8; Schema.md §4.1). The ONLY code that writes tenant_access_controls, and the only platform code
// that touches customer sessions — solely to END them, for one company, inside the change.
//
// A change is accepted only in this order:
//   1. console enabled → 2. same-origin (CSRF) → 3. live Platform Owner session (the PLATFORM token;
//      a customer ERP session is never read) → 4. platform.companies.manage_access
//   → the audit trail must be protected (a change that could not be recorded is never made)
//   → request FORMAT is checked (no database; reveals nothing, so a malformed request never spends a
//     second-factor code): target, typed reference = ORG-…, reason 10–500 characters, code shape
//   → a suspension is refused while customer enforcement is switched off (it would be recorded but
//     not applied) — reactivation stays possible
//   → 5. fresh step-up: the durable throttle, the password, then — inside the transaction — a TOTP code
//     consumed with replay protection
//   → 6. company validation, in the transaction, after the step-up: the organization row is locked
//     (FOR NO KEY UPDATE — it serializes access changes without blocking the foreign-key checks of the
//     company's own inserts), the effective state resolved by the PO-02A rule, and a change to the
//     state the company is already in refused (CONFLICT)
//   → 7. the change: tenant_access_controls upserted with operator, reason and timestamps; every live
//     customer session of the company ended (reason org_suspended) — on reactivation too, so a session
//     created by a sign-in that raced the suspension can never become usable: every user signs in again
//   → 8. the audit record, in the SAME transaction — if it cannot be written, nothing is applied.
//
// Concurrency: two changes for one company serialize on the organization row; the second sees the
// first's committed state and fails with CONFLICT, so a transition is recorded as successful once.
// The same TOTP code cannot approve two changes (its time step is consumed under the admin row lock).
// Idempotency: there is no request-key table (PO-02A schema; no schema change without approval), so a
// retried request is not recognized as a duplicate — it is refused instead (CONFLICT or a used code),
// never applied twice. Subscription state is never read or changed here: only this explicit,
// attributed action changes a company's access.
// ---------------------------------------------------------------------------------------------

export const ACCESS_REASON_MIN = 10;
export const ACCESS_REASON_MAX = 500;
const TOTP_SHAPE = /^\d{6}$/;
// C0/C1 controls, and the bidirectional embedding / override / isolate controls that could disguise
// an audit line (the ordinary RLM/LRM marks Arabic text uses are allowed).
const DISALLOWED_IN_REASON = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

const tac = tenantAccessControlsTable;

/** Whitespace runs (line breaks included) become one space; then trimmed. Null when not acceptable. */
export function normalizeAccessReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.replace(/\s+/g, " ").trim();
  if (DISALLOWED_IN_REASON.test(reason)) return null;
  if (reason.length < ACCESS_REASON_MIN || reason.length > ACCESS_REASON_MAX) return null;
  return reason;
}

export type CompanyAccessChangeInput = { orgId: unknown; target: unknown; reference: unknown; reason: unknown; password: unknown; totpCode: unknown };
export type CompanyAccessChanged = { ok: true; orgId: number; status: TenantAccessStatus; changedAt: Date; sessionsEnded: number };
export type CompanyAccessState = TenantAccess & { reference: string; changedAt: Date | null; changedBy: string | null; enforced: boolean };

type ParsedChange = { orgId: number; target: TenantAccessStatus; reason: string; password: string; totpCode: string };

const invalid = (detail: string) => new PlatformError("VALIDATION_FAILED", detail);

function parseChange(input: CompanyAccessChangeInput): ParsedChange {
  const orgId = parseOrgId(input.orgId);
  if (input.target !== "suspended" && input.target !== "active") throw invalid("target must be suspended or active");
  if (typeof input.reference !== "string" || input.reference.trim() !== orgReference(orgId)) throw invalid("the typed reference does not match the company");
  const reason = normalizeAccessReason(input.reason);
  if (reason === null) throw invalid(`reason must be ${ACCESS_REASON_MIN}–${ACCESS_REASON_MAX} characters without control characters`);
  if (typeof input.password !== "string" || !input.password) throw invalid("password required");
  if (typeof input.totpCode !== "string" || !TOTP_SHAPE.test(input.totpCode)) throw invalid("a six-digit authenticator code is required");
  return { orgId, target: input.target, reason, password: input.password, totpCode: input.totpCode };
}

async function authorizeAccessChange(req: ConsoleRequest): Promise<PlatformSessionContext> {
  assertPlatformConsoleEnabled();
  assertSameOrigin(req.headers);
  return authorizePlatformToken(req.token, "platform.companies.manage_access");
}

/** The same mapping as the console's: typed codes pass through; anything else is CONFIG_ERROR without detail. */
function failure(err: unknown, action: string): ConsoleFailure {
  if (isPlatformError(err, "AUDIT_UNAVAILABLE")) {
    reportSecurityIncident({ type: "audit_write_failed", action, error: errorClass(err) });
    return { ok: false, code: "AUDIT_UNAVAILABLE" };
  }
  if (isPlatformError(err)) return { ok: false, code: err.code };
  console.error(`[platform-company-access] internal failure: ${errorClass(err)}`);
  return { ok: false, code: "CONFIG_ERROR" };
}

/** The organization's id when it exists — used only to attribute a rejected attempt in the audit trail. */
async function existingOrgId(orgId: number): Promise<number | null> {
  const [row] = await db.select({ id: orgsTable.id }).from(orgsTable).where(eq(orgsTable.id, orgId)).limit(1);
  return row?.id ?? null;
}

/**
 * Suspend (`target: "suspended"`) or reactivate (`target: "active"`) one company's access. Returns
 * the new state and how many customer sessions were ended, or a typed failure code. See the header
 * for the order of checks and the transaction.
 */
export async function setCompanyAccessCore(req: ConsoleRequest, input: CompanyAccessChangeInput): Promise<CompanyAccessChanged | ConsoleFailure> {
  let action = "company.access_changed";
  try {
    const ctx = await authorizeAccessChange(req);
    await assertPlatformAuditProtection();
    const change = parseChange(input);
    const verb = change.target === "suspended" ? "suspend" : "reactivate";
    action = change.target === "suspended" ? "company.suspended" : "company.reactivated";
    const meta = requestMeta(req.headers);
    const now = platformClock.now();
    const base = { actorAdminId: ctx.adminId, actorLabel: ctx.displayName, entityType: "organization", entityId: String(change.orgId), reason: change.reason, ...meta };
    const rejected = async (stage: string, orgId?: number) =>
      recordPlatformAudit({ ...base, orgId: orgId ?? (await existingOrgId(change.orgId)), action: `company.${verb}.rejected`, after: { stage }, result: "rejected" });

    if (change.target === "suspended" && !tenantAccessEnforcementEnabled()) {
      await rejected("enforcement_disabled");
      throw new PlatformError("ENFORCEMENT_DISABLED", "customer enforcement is switched off");
    }

    // Step-up, part 1: the durable throttle shared with sign-in, then the password.
    const keys = throttleKeys(ctx.email, meta.ipAddress);
    if (await activeLoginBlock(keys, now)) {
      await recordLoginAttempt(keys, "blocked", now);
      await rejected("throttle");
      throw new PlatformError("RATE_LIMITED", "step-up blocked by throttle");
    }
    const [admin] = await db.select({ passwordHash: platformAdminsTable.passwordHash, isActive: platformAdminsTable.isActive }).from(platformAdminsTable).where(eq(platformAdminsTable.id, ctx.adminId));
    if (!(await verifyPlatformPassword(change.password, admin?.isActive ? admin.passwordHash : null))) {
      await recordLoginAttempt(keys, "failure", now);
      await rejected("password");
      throw new PlatformError("INVALID_CREDENTIALS", "step-up password check failed");
    }

    let outcome: { ok: true; sessionsEnded: number } | { ok: false; stage: "mfa" | "replay" };
    try {
      outcome = await db.transaction(async (tx) => {
        // Step-up, part 2: a fresh TOTP code, consumed with this change or not at all.
        const totp = await consumeTotpCode(tx, ctx.adminId, change.totpCode, now);
        if (!totp.ok) return { ok: false as const, stage: totp.reason === "replayed" ? ("replay" as const) : ("mfa" as const) };

        const [org] = await tx.select({ id: orgsTable.id }).from(orgsTable).where(eq(orgsTable.id, change.orgId)).for("no key update");
        if (!org) throw new PlatformError("NOT_FOUND", "no organization with this id");
        const [row] = await tx.select({ accessStatus: tac.accessStatus }).from(tac).where(eq(tac.orgId, change.orgId)).for("update");
        const before = resolveTenantAccess(row ? { accessStatus: row.accessStatus } : null);
        if (before.status === change.target) throw new PlatformError("CONFLICT", "the company is already in the requested state");

        // changed_at / updated_at never precede created_at, even if this server's clock is behind the one that created the row.
        const notBeforeCreation = sql`greatest(${now}::timestamptz, ${tac.createdAt})`;
        await tx
          .insert(tac)
          .values({ orgId: change.orgId, accessStatus: change.target, reason: change.reason, changedByPlatformAdminId: ctx.adminId, changedAt: now, createdAt: now, updatedAt: now })
          .onConflictDoUpdate({
            target: tac.orgId,
            set: { accessStatus: change.target, reason: change.reason, changedByPlatformAdminId: ctx.adminId, changedAt: notBeforeCreation, updatedAt: notBeforeCreation },
          });
        const ended = await tx
          .update(sessionsTable)
          .set({ revokedAt: now, revokedReason: ORG_SUSPENDED_REVOKE_REASON })
          .where(and(eq(sessionsTable.orgId, change.orgId), isNull(sessionsTable.revokedAt), gt(sessionsTable.expiresAt, now)))
          .returning({ id: sessionsTable.id });
        await recordPlatformAudit(
          {
            ...base,
            orgId: change.orgId,
            action,
            before: { accessStatus: before.status, source: before.source },
            after: { accessStatus: change.target, sessionsEnded: ended.length },
            result: "success",
          },
          tx,
        );
        return { ok: true as const, sessionsEnded: ended.length };
      });
    } catch (err) {
      // Rolled back (the code included); the attempt is still recorded.
      if (isPlatformError(err, "NOT_FOUND")) await rejected("not_found");
      else if (isPlatformError(err, "CONFLICT")) await rejected("state", change.orgId);
      throw err;
    }
    if (!outcome.ok) {
      await recordLoginAttempt(keys, "failure", now);
      await rejected(outcome.stage);
      throw new PlatformError("MFA_INVALID", "step-up second factor failed");
    }
    return { ok: true, orgId: change.orgId, status: change.target, changedAt: now, sessionsEnded: outcome.sessionsEnded };
  } catch (err) {
    return failure(err, action);
  }
}

/**
 * The current access state of one company, from ONE statement (the organization LEFT JOIN its
 * access row and the responsible operator), plus whether customer enforcement is switched on.
 * Read-only; the confirmation dialog uses it to act on the state as it is now, not as the page was.
 */
export async function readCompanyAccessCore(req: ConsoleRequest, rawOrgId: unknown): Promise<{ ok: true; state: CompanyAccessState } | ConsoleFailure> {
  try {
    assertPlatformConsoleEnabled();
    await authorizePlatformToken(req.token, "platform.companies.manage_access");
    const orgId = parseOrgId(rawOrgId);
    const [row] = await db
      .select({ orgId: orgsTable.id, accessRowOrgId: tac.orgId, accessStatus: tac.accessStatus, changedAt: tac.changedAt, changedBy: platformAdminsTable.displayName })
      .from(orgsTable)
      .leftJoin(tac, eq(tac.orgId, orgsTable.id))
      .leftJoin(platformAdminsTable, eq(platformAdminsTable.id, tac.changedByPlatformAdminId))
      .where(eq(orgsTable.id, orgId))
      .limit(1);
    if (!row) throw new PlatformError("NOT_FOUND", "no organization with this id");
    const access = resolveTenantAccess(row.accessRowOrgId === null ? null : { accessStatus: row.accessStatus });
    return { ok: true, state: { ...access, reference: orgReference(orgId), changedAt: row.changedAt ?? null, changedBy: row.changedBy ?? null, enforced: tenantAccessEnforcementEnabled() } };
  } catch (err) {
    return failure(err, "company.access_read");
  }
}
