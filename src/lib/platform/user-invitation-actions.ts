import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, orgsTable, platformAdminsTable, type Tx } from "@/db";
import { userInvitationsTable } from "@/db/staged/platform-user-invitations";
import { verifyPlatformPassword } from "./auth";
import { assertPlatformAuditProtection, recordPlatformAudit } from "./audit";
import { platformClock } from "./clock";
import { orgReference } from "./companies";
import { lockTenantAccessForSessionIssue, getTenantAccess } from "./company-access";
import { requestMeta, type ConsoleRequest } from "./console";
import { isPlatformError, PlatformError, type PlatformErrorCode } from "./errors";
import { assertPlatformUserInvitationsEnabled } from "./flags";
import { authorizePlatformToken } from "./guards";
import { errorClass, reportSecurityIncident } from "./incident";
import { customerEmailInUse, customerPublicOrigin, lockInvitationEmail, newInvitationToken } from "./invitations";
import { consumeTotpCode } from "./mfa";
import { assertSameOrigin } from "./origin";
import { readSeatAccounting, type SeatAccounting } from "./seat-accounting";
import type { PlatformSessionContext } from "./session";
import { activeLoginBlock, recordLoginAttempt, throttleKeys, type ThrottleKeys } from "./throttle";
import {
  assertUserInvitationsInstalled,
  normalizeUserInvitationReason,
  parseUserInvitationFields,
  parseUserInvitationId,
  pendingCompanyInvitationFor,
  recentUserInvitationsBy,
  USER_INVITATION_ENTITY,
  USER_INVITATION_LIMITS,
  USER_INVITATION_RATE_LIMIT,
  USER_INVITATION_TTL_MS,
  userInvitationLink,
  userInvitationReference,
  userInvitationSlotHolder,
  userInvitationState,
  type UserInvitationFields,
  type UserInvitationFieldsInput,
  type UserInvitationRole,
  type UserInvitationState,
} from "./user-invitations";

// ---------------------------------------------------------------------------------------------
// Platform Owner PO-03C (sub-batch C) — create, revoke and re-issue CUSTOMER-USER invitations. The ONLY code that writes
// user_invitations. It creates no user, session or subscription, sends nothing (no e-mail, SMS, WhatsApp or other
// delivery: copy link only), implements no acceptance and enforces no seat limit (both PO-04).
//
// Every change is accepted only in this order (the PO-02D2 order):
//   1. both flags (PLATFORM_CONSOLE_ENABLED and PLATFORM_USER_INVITATIONS_ENABLED, each exactly "true")
//   → 2. same-origin (CSRF) → 3. live Platform Owner session (the PLATFORM token) → 4. platform.users.invite
//   → create / re-issue: CUSTOMER_PUBLIC_ORIGIN must be valid (else CONFIG_ERROR before anything is spent)
//   → the staged table must exist (else USER_INVITATIONS_NOT_INSTALLED) and the audit trail must be protected
//   → request FORMAT (no database; a malformed request spends no second-factor code)
//   → read-only pre-checks, so a request that must fail spends nothing either: the hourly limit, the company (it
//     exists and its access is active), an unexpired invitation for the e-mail, a customer user with the e-mail (any
//     letter case, any company), a pending COMPANY invitation for the e-mail; the invitation's state (revoke / re-issue)
//   → 5. step-up: the durable throttle shared with sign-in, the password (create and re-issue only), then — inside the
//     transaction — a fresh TOTP code consumed with replay protection
//   → 6. ONE READ COMMITTED transaction, lock order: platform_admins row (the TOTP compare-and-set) → the e-mail's
//     advisory lock (THE SAME lock as company invitations: one queue per e-mail across both kinds) → the company row FOR
//     SHARE with its access re-read (a suspension waits for, or is seen by, this transaction — the PO-02C.1 lock) →
//     user_invitations row(s) FOR UPDATE → insert. Every pre-check is repeated authoritatively here; the change and its
//     audit record commit together, so an audit failure rolls the whole operation back (AUDIT_UNAVAILABLE) and a
//     disconnection before COMMIT leaves nothing.
//
// One open invitation per e-mail is the partial unique index (user_invitations_open_email_uq); the e-mail lock makes
// concurrent requests queue instead of colliding, and a 23505 from the index is still reported as CONFLICT. The hourly
// limit is exact (the operator's row serializes every create and re-issue; the count reads committed rows). A response
// lost after COMMIT cannot be recovered — the link is never stored — so the operator re-issues it.
//
// Seats: an open, unexpired invitation RESERVES a seat (seat-accounting.ts counts it). Nothing here refuses because of
// seats: the preview shows the company's seats after the invitation (display only). Enforcement — under the company row
// lock, at create and at acceptance — is PO-04.
// ---------------------------------------------------------------------------------------------

const TOTP_SHAPE = /^\d{6}$/;
const uinv = userInvitationsTable;

/** A typed refusal that can carry the reference of the invitation holding the slot. */
class UserInvitationRefusal extends PlatformError {
  constructor(
    code: PlatformErrorCode,
    detail: string,
    readonly extra: { pendingReference?: string; companyInvitationReference?: string } = {},
  ) {
    super(code, detail);
  }
}

export type UserInvitationFailure = { ok: false; code: PlatformErrorCode; pendingReference?: string; companyInvitationReference?: string };
export type UserInvitationCreated = { ok: true; id: string; reference: string; link: string; expiresAt: Date; replacedReference: string | null };
export type UserInvitationReissued = { ok: true; id: string; reference: string; previousReference: string; link: string; expiresAt: Date };
export type UserInvitationRevoked = { ok: true; id: string; reference: string; revokedAt: Date };
export type UserInvitationPreview = {
  ok: true;
  fields: UserInvitationFields;
  company: { orgId: number; name: string; reference: string; access: "active" | "suspended" };
  pendingReference: string | null;
  expiredReference: string | null;
  emailInUse: boolean;
  companyInvitationReference: string | null;
  rateLimited: boolean;
  /** The company's seats now (display only — nothing is refused because of them). */
  seats: SeatAccounting | null;
};
export type UserInvitationCurrent = { ok: true; id: string; reference: string; state: UserInvitationState; orgId: number; companyName: string; name: string; email: string; role: UserInvitationRole; expiresAt: Date };

export type CreateUserInvitationInput = UserInvitationFieldsInput & { password: unknown; totpCode: unknown };
export type RevokeUserInvitationInput = { invitationId: unknown; reason: unknown; totpCode: unknown };
export type ReissueUserInvitationInput = { invitationId: unknown; password: unknown; totpCode: unknown };

/** flags → same-origin (CSRF) → live platform session → platform.users.invite. */
async function authorizeUserInvitationChange(req: ConsoleRequest): Promise<PlatformSessionContext> {
  assertPlatformUserInvitationsEnabled();
  assertSameOrigin(req.headers);
  return authorizePlatformToken(req.token, "platform.users.invite");
}

/** Typed codes pass through (with their conflict detail); anything else is CONFIG_ERROR without detail. */
function failure(err: unknown, action: string): UserInvitationFailure {
  if (isPlatformError(err, "AUDIT_UNAVAILABLE")) {
    reportSecurityIncident({ type: "audit_write_failed", action, error: errorClass(err) });
    return { ok: false, code: "AUDIT_UNAVAILABLE" };
  }
  if (err instanceof UserInvitationRefusal) return { ok: false, code: err.code, ...err.extra };
  if (isPlatformError(err)) return { ok: false, code: err.code };
  console.error(`[platform-user-invitations] internal failure: ${errorClass(err)}`);
  return { ok: false, code: "CONFIG_ERROR" };
}

function stepUpCode(value: unknown): string {
  if (typeof value !== "string" || !TOTP_SHAPE.test(value)) throw new PlatformError("VALIDATION_FAILED", "a six-digit authenticator code is required");
  return value;
}
function stepUpPassword(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 1024) throw new PlatformError("VALIDATION_FAILED", "password required");
  return value;
}

/** Step-up, part 1: the durable throttle (shared with sign-in), then — when asked for — the password. */
async function stepUpOutsideTransaction(ctx: PlatformSessionContext, keys: ThrottleKeys, password: string | null, now: Date, rejected: (stage: string) => Promise<unknown>) {
  if (await activeLoginBlock(keys, now)) {
    await recordLoginAttempt(keys, "blocked", now);
    await rejected("throttle");
    throw new PlatformError("RATE_LIMITED", "step-up blocked by throttle");
  }
  if (password === null) return;
  const [admin] = await db.select({ passwordHash: platformAdminsTable.passwordHash, isActive: platformAdminsTable.isActive }).from(platformAdminsTable).where(eq(platformAdminsTable.id, ctx.adminId));
  if (!(await verifyPlatformPassword(password, admin?.isActive ? admin.passwordHash : null))) {
    await recordLoginAttempt(keys, "failure", now);
    await rejected("password");
    throw new PlatformError("INVALID_CREDENTIALS", "step-up password check failed");
  }
}

/** The company as committed (no lock): its name, reference and effective access, or NOT_FOUND. */
async function companyFor(executor: Tx | typeof db, orgId: number) {
  const [org] = await executor.select({ id: orgsTable.id, name: orgsTable.name }).from(orgsTable).where(eq(orgsTable.id, orgId)).limit(1);
  if (!org) throw new PlatformError("NOT_FOUND", "no company with this id");
  const access = await getTenantAccess(orgId, executor);
  return { orgId: org.id, name: org.name, reference: orgReference(org.id), access: access?.status === "active" ? ("active" as const) : ("suspended" as const) };
}

/** revoked_at never precedes created_at, even if this server's clock is behind the one that created the row. */
const notBeforeCreation = (now: Date) => sql`greatest(${now.toISOString()}::timestamptz, ${uinv.createdAt})`;

async function revokeRow(tx: Tx, id: string, adminId: string, now: Date): Promise<Date> {
  const [row] = await tx
    .update(uinv)
    .set({ revokedAt: notBeforeCreation(now), revokedByPlatformAdminId: adminId })
    .where(and(eq(uinv.id, id), isNull(uinv.acceptedAt), isNull(uinv.revokedAt)))
    .returning({ revokedAt: uinv.revokedAt });
  if (!row?.revokedAt) throw new PlatformError("CONFLICT", "the invitation changed while it was locked");
  return row.revokedAt;
}

/** A new invitation row: the token's SHA-256 only (the token is returned to the caller once and never stored). */
async function insertUserInvitation(tx: Tx, fields: UserInvitationFields, adminId: string, now: Date): Promise<{ id: string; token: string; expiresAt: Date }> {
  const { token, tokenHash } = newInvitationToken();
  const expiresAt = new Date(now.getTime() + USER_INVITATION_TTL_MS);
  try {
    const [row] = await tx
      .insert(uinv)
      .values({ orgId: fields.orgId, name: fields.name, emailNormalized: fields.email, requestedRole: fields.role, tokenHash, expiresAt, invitedByPlatformAdminId: adminId, createdAt: now })
      .returning({ id: uinv.id });
    return { id: row.id, token, expiresAt };
  } catch (err) {
    // The partial unique index is the database guarantee of one open invitation per e-mail.
    if (pgCode(err) === "23505") throw new PlatformError("CONFLICT", "another open invitation holds this e-mail");
    throw err;
  }
}

function pgCode(err: unknown): string {
  for (let e: unknown = err, depth = 0; e && depth < 5; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return "";
}

const createdAfter = (fields: UserInvitationFields, reference: string, expiresAt: Date) => ({
  reference,
  orgId: fields.orgId,
  companyReference: orgReference(fields.orgId),
  email: fields.email,
  role: fields.role,
  expiresAt: expiresAt.toISOString(),
});

/**
 * The checks every create and re-issue repeats inside its transaction, after the e-mail and company locks: the
 * company's access is active, no customer user has the e-mail, no pending company invitation holds it.
 */
async function lockedChecks(tx: Tx, fields: UserInvitationFields, now: Date) {
  const access = await lockTenantAccessForSessionIssue(tx, fields.orgId);
  if (!access) throw new PlatformError("NOT_FOUND", "no company with this id");
  if (access.status !== "active") throw new PlatformError("COMPANY_SUSPENDED", "the company's access is suspended");
  if (await customerEmailInUse(tx, fields.email)) throw new PlatformError("EMAIL_CONFLICT", "a customer user has this e-mail");
  const companyInvitation = await pendingCompanyInvitationFor(tx, fields.email, now);
  if (companyInvitation) throw new UserInvitationRefusal("CONFLICT", "a pending company invitation holds this e-mail", { companyInvitationReference: companyInvitation });
}

// ---- preview and current state (read-only; no step-up) -------------------------------------------

/**
 * Validates the form and reports what a create would meet — the company and its access, an unexpired or an expired
 * invitation holding the e-mail, a customer user with that e-mail, a pending company invitation, the hourly limit, and
 * the company's seats (display only) — so the operator never spends a second-factor code on a request that must fail.
 * Writes nothing and decides nothing: the create transaction repeats every check.
 */
export async function previewUserInvitation(req: ConsoleRequest, input: UserInvitationFieldsInput): Promise<UserInvitationPreview | UserInvitationFailure> {
  try {
    const ctx = await authorizeUserInvitationChange(req);
    await assertUserInvitationsInstalled(db);
    const fields = parseUserInvitationFields(input);
    const now = platformClock.now();
    const company = await companyFor(db, fields.orgId);
    const [holder, emailInUse, companyInvitationReference, recent, seats] = await Promise.all([
      userInvitationSlotHolder(db, fields.email, false),
      customerEmailInUse(db, fields.email),
      pendingCompanyInvitationFor(db, fields.email, now),
      recentUserInvitationsBy(db, ctx.adminId, now),
      readSeatAccounting(db, fields.orgId, now).catch(() => null),
    ]);
    const unexpired = holder && holder.expiresAt.getTime() > now.getTime();
    return {
      ok: true,
      fields,
      company,
      pendingReference: unexpired ? userInvitationReference(holder.id) : null,
      expiredReference: holder && !unexpired ? userInvitationReference(holder.id) : null,
      emailInUse,
      companyInvitationReference,
      rateLimited: recent >= USER_INVITATION_RATE_LIMIT.max,
      seats,
    };
  } catch (err) {
    return failure(err, "user_invitation.preview");
  }
}

/** One invitation's current state, for a dialog to act on the state as it is now (not as the page was). */
export async function readUserInvitation(req: ConsoleRequest, rawId: unknown): Promise<UserInvitationCurrent | UserInvitationFailure> {
  try {
    await authorizeUserInvitationChange(req);
    await assertUserInvitationsInstalled(db);
    const id = parseUserInvitationId(rawId);
    const [row] = await db
      .select({ id: uinv.id, orgId: uinv.orgId, companyName: orgsTable.name, name: uinv.name, email: uinv.emailNormalized, role: uinv.requestedRole, expiresAt: uinv.expiresAt, acceptedAt: uinv.acceptedAt, revokedAt: uinv.revokedAt })
      .from(uinv)
      .innerJoin(orgsTable, eq(orgsTable.id, uinv.orgId))
      .where(eq(uinv.id, id))
      .limit(1);
    if (!row) throw new PlatformError("NOT_FOUND", "no user invitation with this id");
    return {
      ok: true,
      id: row.id,
      reference: userInvitationReference(row.id),
      state: userInvitationState(row, platformClock.now()),
      orgId: row.orgId,
      companyName: row.companyName,
      name: row.name,
      email: row.email,
      role: row.role as UserInvitationRole,
      expiresAt: row.expiresAt,
    };
  } catch (err) {
    return failure(err, "user_invitation.read");
  }
}

// ---- create --------------------------------------------------------------------------------------

/** Create one user invitation; returns its reference and the one-time link (the only time it exists). */
export async function createUserInvitation(req: ConsoleRequest, input: CreateUserInvitationInput): Promise<UserInvitationCreated | UserInvitationFailure> {
  const action = "user_invitation.created";
  try {
    const ctx = await authorizeUserInvitationChange(req);
    const origin = customerPublicOrigin();
    await assertUserInvitationsInstalled(db);
    await assertPlatformAuditProtection();
    const fields = parseUserInvitationFields(input);
    const password = stepUpPassword(input.password);
    const totpCode = stepUpCode(input.totpCode);
    const meta = requestMeta(req.headers);
    const now = platformClock.now();
    const base = { actorAdminId: ctx.adminId, actorLabel: ctx.displayName, entityType: USER_INVITATION_ENTITY, orgId: fields.orgId, ...meta };
    const rejected = (stage: string, extra: Record<string, unknown> = {}) =>
      recordPlatformAudit({ ...base, entityId: "new", action: "user_invitation.create.rejected", after: { stage, orgId: fields.orgId, email: fields.email, role: fields.role, ...extra }, result: "rejected" });

    // Read-only pre-checks: a request that must fail spends nothing (the transaction repeats each one).
    if ((await recentUserInvitationsBy(db, ctx.adminId, now)) >= USER_INVITATION_RATE_LIMIT.max) {
      await rejected("rate_limit");
      throw new PlatformError("RATE_LIMITED", "hourly user-invitation limit reached");
    }
    const company = await companyFor(db, fields.orgId);
    if (company.access !== "active") {
      await rejected("company_suspended");
      throw new PlatformError("COMPANY_SUSPENDED", "the company's access is suspended");
    }
    const holder = await userInvitationSlotHolder(db, fields.email, false);
    if (holder && holder.expiresAt.getTime() > now.getTime()) {
      const pendingReference = userInvitationReference(holder.id);
      await rejected("pending_conflict", { pending: pendingReference });
      throw new UserInvitationRefusal("CONFLICT", "an unexpired invitation holds this e-mail", { pendingReference });
    }
    if (await customerEmailInUse(db, fields.email)) {
      await rejected("email_conflict");
      throw new PlatformError("EMAIL_CONFLICT", "a customer user has this e-mail");
    }
    const companyInvitation = await pendingCompanyInvitationFor(db, fields.email, now);
    if (companyInvitation) {
      await rejected("company_invitation_conflict", { companyInvitation });
      throw new UserInvitationRefusal("CONFLICT", "a pending company invitation holds this e-mail", { companyInvitationReference: companyInvitation });
    }

    const keys = throttleKeys(ctx.email, meta.ipAddress);
    await stepUpOutsideTransaction(ctx, keys, password, now, rejected);

    let outcome: { ok: true; id: string; token: string; expiresAt: Date; replacedReference: string | null } | { ok: false; stage: "mfa" | "replay" };
    try {
      outcome = await db.transaction(
        async (tx) => {
          // Step-up, part 2: a fresh TOTP code, consumed with this change or not at all.
          const totp = await consumeTotpCode(tx, ctx.adminId, totpCode, now);
          if (!totp.ok) return { ok: false as const, stage: totp.reason === "replayed" ? ("replay" as const) : ("mfa" as const) };
          await lockInvitationEmail(tx, fields.email);
          if ((await recentUserInvitationsBy(tx, ctx.adminId, now)) >= USER_INVITATION_RATE_LIMIT.max) throw new PlatformError("RATE_LIMITED", "hourly user-invitation limit reached");
          await lockedChecks(tx, fields, now);
          const current = await userInvitationSlotHolder(tx, fields.email, true);
          if (current && current.expiresAt.getTime() > now.getTime()) {
            throw new UserInvitationRefusal("CONFLICT", "an unexpired invitation holds this e-mail", { pendingReference: userInvitationReference(current.id) });
          }
          // An EXPIRED holder (of this or another company) gives up its slot in this transaction, attributed and audited.
          let replacedReference: string | null = null;
          if (current) {
            await revokeRow(tx, current.id, ctx.adminId, now);
            replacedReference = userInvitationReference(current.id);
          }
          const created = await insertUserInvitation(tx, fields, ctx.adminId, now);
          const reference = userInvitationReference(created.id);
          if (current && replacedReference) {
            await recordPlatformAudit(
              { ...base, orgId: current.orgId, entityId: current.id, action: "user_invitation.revoked", reason: `Expired; replaced by ${reference}`, before: { state: "expired" }, after: { state: "revoked", replacedBy: reference }, result: "success" },
              tx,
            );
          }
          await recordPlatformAudit(
            { ...base, entityId: created.id, action, after: { ...createdAfter(fields, reference, created.expiresAt), ...(replacedReference ? { replaces: replacedReference } : {}) }, result: "success" },
            tx,
          );
          return { ok: true as const, id: created.id, token: created.token, expiresAt: created.expiresAt, replacedReference };
        },
        { isolationLevel: "read committed" },
      );
    } catch (err) {
      // Rolled back (the code included); the attempt is still recorded.
      if (err instanceof UserInvitationRefusal && err.extra.pendingReference) await rejected("pending_conflict", { pending: err.extra.pendingReference });
      else if (err instanceof UserInvitationRefusal && err.extra.companyInvitationReference) await rejected("company_invitation_conflict", { companyInvitation: err.extra.companyInvitationReference });
      else if (isPlatformError(err, "CONFLICT")) await rejected("pending_conflict");
      else if (isPlatformError(err, "EMAIL_CONFLICT")) await rejected("email_conflict");
      else if (isPlatformError(err, "COMPANY_SUSPENDED")) await rejected("company_suspended");
      else if (isPlatformError(err, "RATE_LIMITED")) await rejected("rate_limit");
      throw err;
    }
    if (!outcome.ok) {
      await recordLoginAttempt(keys, "failure", now);
      await rejected(outcome.stage);
      throw new PlatformError("MFA_INVALID", "step-up second factor failed");
    }
    return { ok: true, id: outcome.id, reference: userInvitationReference(outcome.id), link: userInvitationLink(origin, outcome.token), expiresAt: outcome.expiresAt, replacedReference: outcome.replacedReference };
  } catch (err) {
    return failure(err, action);
  }
}

// ---- revoke --------------------------------------------------------------------------------------

/** Revoke one pending (or expired) invitation: a fresh TOTP code and a reason. Its link can never be used. */
export async function revokeUserInvitation(req: ConsoleRequest, input: RevokeUserInvitationInput): Promise<UserInvitationRevoked | UserInvitationFailure> {
  const action = "user_invitation.revoked";
  try {
    const ctx = await authorizeUserInvitationChange(req);
    await assertUserInvitationsInstalled(db);
    await assertPlatformAuditProtection();
    const id = parseUserInvitationId(input.invitationId);
    const reason = normalizeUserInvitationReason(input.reason);
    if (reason === null) throw new PlatformError("VALIDATION_FAILED", `reason must be ${USER_INVITATION_LIMITS.reasonMin}–${USER_INVITATION_LIMITS.reasonMax} characters without control characters`);
    const totpCode = stepUpCode(input.totpCode);
    const meta = requestMeta(req.headers);
    const now = platformClock.now();
    const [before] = await db.select({ email: uinv.emailNormalized, orgId: uinv.orgId, acceptedAt: uinv.acceptedAt, revokedAt: uinv.revokedAt }).from(uinv).where(eq(uinv.id, id)).limit(1);
    if (!before) throw new PlatformError("NOT_FOUND", "no user invitation with this id");
    const base = { actorAdminId: ctx.adminId, actorLabel: ctx.displayName, entityType: USER_INVITATION_ENTITY, entityId: id, orgId: before.orgId, ...meta };
    const rejected = (stage: string) => recordPlatformAudit({ ...base, action: "user_invitation.revoke.rejected", reason, after: { stage }, result: "rejected" });
    if (before.acceptedAt) {
      await rejected("accepted");
      throw new PlatformError("INVITE_USED", "the invitation was accepted");
    }
    if (before.revokedAt) throw new PlatformError("CONFLICT", "the invitation is already revoked");

    const keys = throttleKeys(ctx.email, meta.ipAddress);
    await stepUpOutsideTransaction(ctx, keys, null, now, rejected);

    let outcome: { ok: true; revokedAt: Date } | { ok: false; stage: "mfa" | "replay" };
    try {
      outcome = await db.transaction(
        async (tx) => {
          const totp = await consumeTotpCode(tx, ctx.adminId, totpCode, now);
          if (!totp.ok) return { ok: false as const, stage: totp.reason === "replayed" ? ("replay" as const) : ("mfa" as const) };
          await lockInvitationEmail(tx, before.email);
          const [row] = await tx.select({ acceptedAt: uinv.acceptedAt, revokedAt: uinv.revokedAt, expiresAt: uinv.expiresAt }).from(uinv).where(eq(uinv.id, id)).for("update");
          if (!row) throw new PlatformError("NOT_FOUND", "no user invitation with this id");
          if (row.acceptedAt) throw new PlatformError("INVITE_USED", "the invitation was accepted");
          if (row.revokedAt) throw new PlatformError("CONFLICT", "the invitation is already revoked");
          const state = userInvitationState(row, now);
          const revokedAt = await revokeRow(tx, id, ctx.adminId, now);
          await recordPlatformAudit({ ...base, action, reason, before: { state }, after: { state: "revoked" }, result: "success" }, tx);
          return { ok: true as const, revokedAt };
        },
        { isolationLevel: "read committed" },
      );
    } catch (err) {
      if (isPlatformError(err, "INVITE_USED")) await rejected("accepted");
      throw err;
    }
    if (!outcome.ok) {
      await recordLoginAttempt(keys, "failure", now);
      await rejected(outcome.stage);
      throw new PlatformError("MFA_INVALID", "step-up second factor failed");
    }
    return { ok: true, id, reference: userInvitationReference(id), revokedAt: outcome.revokedAt };
  } catch (err) {
    return failure(err, action);
  }
}

// ---- re-issue ------------------------------------------------------------------------------------

/**
 * Re-issue one invitation — pending, expired or revoked (never an accepted one): a new invitation for the same company,
 * invitee and role, with a new token and a new 72-hour expiry, attributed to the re-issuing operator. An OPEN source
 * (pending or expired) is revoked in the same transaction (its token can never be used); a revoked source stays as it
 * is. If ANOTHER open invitation holds the e-mail, an unexpired one is a CONFLICT and an expired one gives up its slot.
 * The lineage is in the audit trail (replaces / replacedBy). Returns only the new link.
 */
export async function reissueUserInvitation(req: ConsoleRequest, input: ReissueUserInvitationInput): Promise<UserInvitationReissued | UserInvitationFailure> {
  const action = "user_invitation.reissued";
  try {
    const ctx = await authorizeUserInvitationChange(req);
    const origin = customerPublicOrigin();
    await assertUserInvitationsInstalled(db);
    await assertPlatformAuditProtection();
    const id = parseUserInvitationId(input.invitationId);
    const password = stepUpPassword(input.password);
    const totpCode = stepUpCode(input.totpCode);
    const meta = requestMeta(req.headers);
    const now = platformClock.now();
    const [before] = await db
      .select({ email: uinv.emailNormalized, orgId: uinv.orgId, name: uinv.name, role: uinv.requestedRole, acceptedAt: uinv.acceptedAt, revokedAt: uinv.revokedAt, expiresAt: uinv.expiresAt })
      .from(uinv)
      .where(eq(uinv.id, id))
      .limit(1);
    if (!before) throw new PlatformError("NOT_FOUND", "no user invitation with this id");
    const base = { actorAdminId: ctx.adminId, actorLabel: ctx.displayName, entityType: USER_INVITATION_ENTITY, orgId: before.orgId, ...meta };
    const rejected = (stage: string, extra: Record<string, unknown> = {}) => recordPlatformAudit({ ...base, entityId: id, action: "user_invitation.reissue.rejected", after: { stage, ...extra }, result: "rejected" });
    if (before.acceptedAt) {
      await rejected("accepted");
      throw new PlatformError("INVITE_USED", "the invitation was accepted");
    }
    const fields: UserInvitationFields = { orgId: before.orgId, name: before.name, email: before.email, role: before.role as UserInvitationRole };
    if ((await recentUserInvitationsBy(db, ctx.adminId, now)) >= USER_INVITATION_RATE_LIMIT.max) {
      await rejected("rate_limit");
      throw new PlatformError("RATE_LIMITED", "hourly user-invitation limit reached");
    }
    const company = await companyFor(db, fields.orgId);
    if (company.access !== "active") {
      await rejected("company_suspended");
      throw new PlatformError("COMPANY_SUSPENDED", "the company's access is suspended");
    }
    if (await customerEmailInUse(db, fields.email)) {
      await rejected("email_conflict");
      throw new PlatformError("EMAIL_CONFLICT", "a customer user has this e-mail");
    }
    const holder = await userInvitationSlotHolder(db, fields.email, false);
    if (holder && holder.id !== id && holder.expiresAt.getTime() > now.getTime()) {
      const pendingReference = userInvitationReference(holder.id);
      await rejected("pending_conflict", { pending: pendingReference });
      throw new UserInvitationRefusal("CONFLICT", "another unexpired invitation holds this e-mail", { pendingReference });
    }

    const keys = throttleKeys(ctx.email, meta.ipAddress);
    await stepUpOutsideTransaction(ctx, keys, password, now, rejected);

    let outcome: { ok: true; id: string; token: string; expiresAt: Date; previousReference: string } | { ok: false; stage: "mfa" | "replay" };
    try {
      outcome = await db.transaction(
        async (tx) => {
          const totp = await consumeTotpCode(tx, ctx.adminId, totpCode, now);
          if (!totp.ok) return { ok: false as const, stage: totp.reason === "replayed" ? ("replay" as const) : ("mfa" as const) };
          await lockInvitationEmail(tx, fields.email);
          if ((await recentUserInvitationsBy(tx, ctx.adminId, now)) >= USER_INVITATION_RATE_LIMIT.max) throw new PlatformError("RATE_LIMITED", "hourly user-invitation limit reached");
          // The shared lock order: the company row (FOR SHARE) BEFORE any invitation row.
          await lockedChecks(tx, fields, now);
          const [old] = await tx.select({ acceptedAt: uinv.acceptedAt, revokedAt: uinv.revokedAt, expiresAt: uinv.expiresAt }).from(uinv).where(eq(uinv.id, id)).for("update");
          if (!old) throw new PlatformError("NOT_FOUND", "no user invitation with this id");
          if (old.acceptedAt) throw new PlatformError("INVITE_USED", "the invitation was accepted");
          const previousState = userInvitationState(old, now);
          const previousReference = userInvitationReference(id);
          // Another open invitation for the e-mail (the source itself was revoked): unexpired → CONFLICT; expired → replaced.
          const current = await userInvitationSlotHolder(tx, fields.email, true);
          if (current && current.id !== id && current.expiresAt.getTime() > now.getTime()) {
            throw new UserInvitationRefusal("CONFLICT", "another unexpired invitation holds this e-mail", { pendingReference: userInvitationReference(current.id) });
          }
          const toRevoke = current ? [{ id: current.id, orgId: current.orgId, state: current.id === id ? previousState : ("expired" as const) }] : [];
          for (const r of toRevoke) await revokeRow(tx, r.id, ctx.adminId, now);
          const created = await insertUserInvitation(tx, fields, ctx.adminId, now);
          const reference = userInvitationReference(created.id);
          for (const r of toRevoke) {
            await recordPlatformAudit(
              { ...base, orgId: r.orgId, entityId: r.id, action: "user_invitation.revoked", reason: r.id === id ? `Re-issued as ${reference}` : `Expired; replaced by ${reference}`, before: { state: r.state }, after: { state: "revoked", replacedBy: reference }, result: "success" },
              tx,
            );
          }
          await recordPlatformAudit({ ...base, entityId: created.id, action, after: { ...createdAfter(fields, reference, created.expiresAt), replaces: previousReference, previousState }, result: "success" }, tx);
          return { ok: true as const, id: created.id, token: created.token, expiresAt: created.expiresAt, previousReference };
        },
        { isolationLevel: "read committed" },
      );
    } catch (err) {
      if (isPlatformError(err, "INVITE_USED")) await rejected("accepted");
      else if (err instanceof UserInvitationRefusal && err.extra.pendingReference) await rejected("pending_conflict", { pending: err.extra.pendingReference });
      else if (err instanceof UserInvitationRefusal && err.extra.companyInvitationReference) await rejected("company_invitation_conflict", { companyInvitation: err.extra.companyInvitationReference });
      else if (isPlatformError(err, "EMAIL_CONFLICT")) await rejected("email_conflict");
      else if (isPlatformError(err, "COMPANY_SUSPENDED")) await rejected("company_suspended");
      else if (isPlatformError(err, "RATE_LIMITED")) await rejected("rate_limit");
      throw err;
    }
    if (!outcome.ok) {
      await recordLoginAttempt(keys, "failure", now);
      await rejected(outcome.stage);
      throw new PlatformError("MFA_INVALID", "step-up second factor failed");
    }
    return { ok: true, id: outcome.id, reference: userInvitationReference(outcome.id), previousReference: outcome.previousReference, link: userInvitationLink(origin, outcome.token), expiresAt: outcome.expiresAt };
  } catch (err) {
    return failure(err, action);
  }
}
