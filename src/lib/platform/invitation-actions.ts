import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, organizationInvitationsTable, organizationInvitationTermsTable, platformAdminsTable, type Tx } from "@/db";
import { verifyPlatformPassword } from "./auth";
import { assertPlatformAuditProtection, recordPlatformAudit } from "./audit";
import { platformClock } from "./clock";
import { invitationReference } from "./companies";
import { requestMeta, type ConsoleRequest } from "./console";
import { isPlatformError, PlatformError, type PlatformErrorCode } from "./errors";
import { assertPlatformInvitationsEnabled } from "./flags";
import { authorizePlatformToken } from "./guards";
import { errorClass, reportSecurityIncident } from "./incident";
import {
  companyNameMatches,
  customerEmailInUse,
  customerPublicOrigin,
  INVITATION_ENTITY,
  INVITATION_LIMITS,
  INVITATION_RATE_LIMIT,
  INVITATION_TTL_MS,
  invitationLink,
  invitationState,
  lockInvitationEmail,
  newInvitationToken,
  normalizeInvitationReason,
  parseInvitationFields,
  parseInvitationId,
  publishedDefaultTrial,
  recentInvitationsBy,
  type DefaultTrialTerms,
  type InvitationFields,
  type InvitationFieldsInput,
  type InvitationLifecycleState,
} from "./invitations";
import { consumeTotpCode } from "./mfa";
import { assertConsoleHost, assertSameOrigin } from "./origin";
import type { PlatformSessionContext } from "./session";
import { activeLoginBlock, recordLoginAttempt, throttleKeys, type ThrottleKeys } from "./throttle";

// ---------------------------------------------------------------------------------------------
// Platform Owner PO-02D2 — create, revoke and re-issue company invitations. The ONLY code that writes
// organization_invitations and organization_invitation_terms. It creates no organization, user,
// customer session or subscription, sends nothing (no e-mail, SMS, WhatsApp or other delivery: I-8,
// copy link only) and implements no acceptance (PO-02D3).
//
// Every change is accepted only in this order (the PO-02C order):
//   1. both flags (PLATFORM_CONSOLE_ENABLED and PLATFORM_INVITATIONS_ENABLED, each exactly "true")
//   → 2. same-origin (CSRF) → 3. live Platform Owner session (the PLATFORM token; a customer ERP session
//   is never read) → 4. platform.companies.invite
//   → create / re-issue: CUSTOMER_PUBLIC_ORIGIN must be valid (else CONFIG_ERROR before anything is spent)
//   → the audit trail must be protected (a change that could not be recorded is never made)
//   → request FORMAT (no database; a malformed request spends no second-factor code)
//   → read-only pre-checks, so a request that must fail spends nothing either: the hourly limit, the
//     published default Trial, an unexpired pending invitation for the e-mail, a customer user with the
//     e-mail, an unconfirmed company-name collision (create); the invitation's state (revoke / re-issue)
//   → 5. step-up: the durable throttle shared with sign-in, the password (create and re-issue only), then
//     — inside the transaction — a fresh TOTP code consumed with replay protection
//   → 6. ONE READ COMMITTED transaction, lock order: platform_admins row (the TOTP compare-and-set) →
//     the owner e-mail's advisory lock → organization_invitations row(s) FOR UPDATE → inserts. Every
//     pre-check is repeated authoritatively here; the change and its audit record commit together, so an
//     audit failure rolls the whole operation back (AUDIT_UNAVAILABLE) and a disconnection before COMMIT
//     leaves nothing.
//
// One pending invitation per owner e-mail is enforced by PO-02A's partial unique index
// (organization_invitations_pending_email_uq); the e-mail lock makes concurrent requests queue instead
// of colliding, and a 23505 from the index is still reported as CONFLICT. The hourly limit is exact:
// every create and re-issue of one operator serializes on that operator's row (the TOTP step), and the
// count reads committed rows, so it is durable across restarts and processes. Idempotency: there is no
// request-key table (no schema change without approval), so a retried request is refused (a used code,
// or CONFLICT naming the invitation that now holds the slot), never applied twice. A response lost
// after COMMIT cannot be recovered — the link is never stored — so the operator re-issues it.
//
// Not closed by this module (documented): the customer-user e-mail check is application-level. users
// has no case-insensitive unique key, so a customer registration that commits between this check and
// the acceptance phase could take the same e-mail; PO-02D3 must re-check it in its own transaction.
// ---------------------------------------------------------------------------------------------

const TOTP_SHAPE = /^\d{6}$/;
const inv = organizationInvitationsTable;
const terms = organizationInvitationTermsTable;

/** A typed refusal that can carry the reference of the invitation holding the slot, or the name matches. */
class InvitationRefusal extends PlatformError {
  constructor(
    code: PlatformErrorCode,
    detail: string,
    readonly extra: { pendingReference?: string; nameMatches?: { organizations: number; invitations: number } } = {},
  ) {
    super(code, detail);
  }
}

export type InvitationFailure = { ok: false; code: PlatformErrorCode; pendingReference?: string; nameMatches?: { organizations: number; invitations: number } };
export type InvitationCreated = { ok: true; id: string; reference: string; link: string; expiresAt: Date; replacedReference: string | null };
export type InvitationReissued = { ok: true; id: string; reference: string; previousReference: string; link: string; expiresAt: Date };
export type InvitationRevoked = { ok: true; id: string; reference: string; revokedAt: Date };
export type InvitationPreview = {
  ok: true;
  fields: InvitationFields;
  trial: DefaultTrialTerms | null;
  pendingReference: string | null;
  expiredReference: string | null;
  emailInUse: boolean;
  nameMatches: { organizations: number; invitations: number };
  rateLimited: boolean;
};
export type InvitationCurrent = { ok: true; id: string; reference: string; state: InvitationLifecycleState; companyName: string; ownerEmail: string; expiresAt: Date };

export type CreateInvitationInput = InvitationFieldsInput & { confirmDuplicateName?: unknown; password: unknown; totpCode: unknown };
export type RevokeInvitationInput = { invitationId: unknown; reason: unknown; totpCode: unknown };
export type ReissueInvitationInput = { invitationId: unknown; password: unknown; totpCode: unknown };

/** flags → same-origin (CSRF) → live platform session → platform.companies.invite. */
async function authorizeInvitationChange(req: ConsoleRequest): Promise<PlatformSessionContext> {
  assertPlatformInvitationsEnabled();
  assertConsoleHost(req.headers);
  assertSameOrigin(req.headers);
  return authorizePlatformToken(req.token, "platform.companies.invite");
}

/** Typed codes pass through (with their conflict detail); anything else is CONFIG_ERROR without detail. */
function failure(err: unknown, action: string): InvitationFailure {
  if (isPlatformError(err, "AUDIT_UNAVAILABLE")) {
    reportSecurityIncident({ type: "audit_write_failed", action, error: errorClass(err) });
    return { ok: false, code: "AUDIT_UNAVAILABLE" };
  }
  if (err instanceof InvitationRefusal) return { ok: false, code: err.code, ...err.extra };
  if (isPlatformError(err)) return { ok: false, code: err.code };
  console.error(`[platform-invitations] internal failure: ${errorClass(err)}`);
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

/** The invitation row that holds the owner e-mail's pending slot (unaccepted, unrevoked — expired included). */
async function slotHolder(executor: Tx | typeof db, ownerEmail: string, lock: boolean) {
  const query = executor
    .select({ id: inv.id, expiresAt: inv.expiresAt, createdAt: inv.createdAt })
    .from(inv)
    .where(and(eq(inv.ownerEmailNormalized, ownerEmail), isNull(inv.acceptedAt), isNull(inv.revokedAt)))
    .limit(1);
  const [row] = lock ? await query.for("update") : await query;
  return row ?? null;
}

/** revoked_at / updated_at never precede created_at, even if this server's clock is behind the one that created the row. */
const notBeforeCreation = (now: Date) => sql`greatest(${now.toISOString()}::timestamptz, ${inv.createdAt})`;

async function revokeRow(tx: Tx, id: string, adminId: string, now: Date): Promise<Date> {
  const [row] = await tx
    .update(inv)
    .set({ revokedAt: notBeforeCreation(now), revokedByPlatformAdminId: adminId, updatedAt: notBeforeCreation(now) })
    .where(and(eq(inv.id, id), isNull(inv.acceptedAt), isNull(inv.revokedAt)))
    .returning({ revokedAt: inv.revokedAt });
  if (!row?.revokedAt) throw new PlatformError("CONFLICT", "the invitation changed while it was locked");
  return row.revokedAt;
}

/** A new invitation row (token hash only) and its immutable terms (the published default Trial, cycle trial). */
async function insertInvitation(tx: Tx, fields: InvitationFields, trial: DefaultTrialTerms, adminId: string, now: Date): Promise<{ id: string; token: string; expiresAt: Date }> {
  const { token, tokenHash } = newInvitationToken();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
  let id: string;
  try {
    const [row] = await tx
      .insert(inv)
      .values({
        companyName: fields.companyName,
        industry: fields.industry,
        companyEmail: fields.companyEmail,
        countryName: fields.country,
        currencyCode: fields.currency,
        ownerName: fields.ownerName,
        ownerEmailNormalized: fields.ownerEmail,
        tokenHash,
        expiresAt,
        invitedByPlatformAdminId: adminId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: inv.id });
    id = row.id;
  } catch (err) {
    // The partial unique index is the database guarantee of one pending invitation per e-mail.
    if (pgCode(err) === "23505") throw new PlatformError("CONFLICT", "another pending invitation holds this e-mail");
    throw err;
  }
  await tx.insert(terms).values({ invitationId: id, initialPackageVersionId: trial.versionId, initialVersionState: "published", initialIsTrial: true, initialCycle: "trial", createdAt: now });
  return { id, token, expiresAt };
}

function pgCode(err: unknown): string {
  for (let e: unknown = err, depth = 0; e && depth < 5; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return "";
}

const createdAfter = (fields: InvitationFields, trial: DefaultTrialTerms, reference: string, expiresAt: Date) => ({
  reference,
  companyName: fields.companyName,
  country: fields.country,
  currency: fields.currency,
  ownerEmail: fields.ownerEmail,
  packageCode: trial.packageCode,
  versionNumber: trial.versionNumber,
  cycle: "trial",
  expiresAt: expiresAt.toISOString(),
});

// ---- preview (read-only; no step-up) -------------------------------------------------------------

/**
 * Validates the form and reports what a create would meet — the offered Trial terms, an unexpired or an
 * expired invitation holding the owner e-mail, a customer user with that e-mail, company-name matches,
 * the hourly limit — so the operator never spends a second-factor code on a request that must fail.
 * Writes nothing and decides nothing: the create transaction repeats every check.
 */
export async function previewCompanyInvitation(req: ConsoleRequest, input: InvitationFieldsInput): Promise<InvitationPreview | InvitationFailure> {
  try {
    const ctx = await authorizeInvitationChange(req);
    const fields = parseInvitationFields(input);
    const now = platformClock.now();
    const [trial, holder, emailInUse, recent] = await Promise.all([
      publishedDefaultTrial(),
      slotHolder(db, fields.ownerEmail, false),
      customerEmailInUse(db, fields.ownerEmail),
      recentInvitationsBy(db, ctx.adminId, now),
    ]);
    const unexpired = holder && holder.expiresAt.getTime() > now.getTime();
    // An expired holder of this e-mail is replaced by the create, so its own name never counts as a collision.
    const nameMatches = await companyNameMatches(db, fields.companyName, holder && !unexpired ? holder.id : undefined);
    return {
      ok: true,
      fields,
      trial,
      pendingReference: unexpired ? invitationReference(holder.id) : null,
      expiredReference: holder && !unexpired ? invitationReference(holder.id) : null,
      emailInUse,
      nameMatches,
      rateLimited: recent >= INVITATION_RATE_LIMIT.max,
    };
  } catch (err) {
    return failure(err, "invitation.preview");
  }
}

/** One invitation's current state, for a dialog to act on the state as it is now (not as the page was). */
export async function readCompanyInvitation(req: ConsoleRequest, rawId: unknown): Promise<InvitationCurrent | InvitationFailure> {
  try {
    await authorizeInvitationChange(req);
    const id = parseInvitationId(rawId);
    const [row] = await db
      .select({ id: inv.id, companyName: inv.companyName, ownerEmail: inv.ownerEmailNormalized, expiresAt: inv.expiresAt, acceptedAt: inv.acceptedAt, revokedAt: inv.revokedAt })
      .from(inv)
      .where(eq(inv.id, id))
      .limit(1);
    if (!row) throw new PlatformError("NOT_FOUND", "no invitation with this id");
    return { ok: true, id: row.id, reference: invitationReference(row.id), state: invitationState(row, platformClock.now()), companyName: row.companyName, ownerEmail: row.ownerEmail, expiresAt: row.expiresAt };
  } catch (err) {
    return failure(err, "invitation.read");
  }
}

// ---- create --------------------------------------------------------------------------------------

/** Create one company invitation; returns its reference and the one-time link (the only time it exists). */
export async function createCompanyInvitation(req: ConsoleRequest, input: CreateInvitationInput): Promise<InvitationCreated | InvitationFailure> {
  const action = "invitation.created";
  try {
    const ctx = await authorizeInvitationChange(req);
    const origin = customerPublicOrigin();
    await assertPlatformAuditProtection();
    const fields = parseInvitationFields(input);
    const password = stepUpPassword(input.password);
    const totpCode = stepUpCode(input.totpCode);
    const confirmName = input.confirmDuplicateName === true;
    const meta = requestMeta(req.headers);
    const now = platformClock.now();
    const base = { actorAdminId: ctx.adminId, actorLabel: ctx.displayName, entityType: INVITATION_ENTITY, ...meta };
    const rejected = (stage: string, extra: Record<string, unknown> = {}) =>
      recordPlatformAudit({ ...base, entityId: "new", action: "invitation.create.rejected", after: { stage, companyName: fields.companyName, ownerEmail: fields.ownerEmail, ...extra }, result: "rejected" });

    // Read-only pre-checks: a request that must fail spends nothing (the transaction repeats each one).
    if ((await recentInvitationsBy(db, ctx.adminId, now)) >= INVITATION_RATE_LIMIT.max) {
      await rejected("rate_limit");
      throw new PlatformError("RATE_LIMITED", "hourly invitation limit reached");
    }
    if (!(await publishedDefaultTrial())) {
      await rejected("no_trial");
      throw new PlatformError("CONFIG_ERROR", "no published default Trial version");
    }
    const holder = await slotHolder(db, fields.ownerEmail, false);
    if (holder && holder.expiresAt.getTime() > now.getTime()) {
      const pendingReference = invitationReference(holder.id);
      await rejected("pending_conflict", { pending: pendingReference });
      throw new InvitationRefusal("CONFLICT", "an unexpired invitation holds this e-mail", { pendingReference });
    }
    if (await customerEmailInUse(db, fields.ownerEmail)) {
      await rejected("email_conflict");
      throw new PlatformError("EMAIL_CONFLICT", "a customer user has this e-mail");
    }
    const names = await companyNameMatches(db, fields.companyName, holder?.id);
    if ((names.organizations > 0 || names.invitations > 0) && !confirmName) throw new InvitationRefusal("CONFLICT", "company name collision not confirmed", { nameMatches: names });

    const keys = throttleKeys(ctx.email, meta.ipAddress);
    await stepUpOutsideTransaction(ctx, keys, password, now, rejected);

    let outcome: { ok: true; id: string; token: string; expiresAt: Date; replacedReference: string | null } | { ok: false; stage: "mfa" | "replay" };
    try {
      outcome = await db.transaction(
        async (tx) => {
          // Step-up, part 2: a fresh TOTP code, consumed with this change or not at all.
          const totp = await consumeTotpCode(tx, ctx.adminId, totpCode, now);
          if (!totp.ok) return { ok: false as const, stage: totp.reason === "replayed" ? ("replay" as const) : ("mfa" as const) };
          await lockInvitationEmail(tx, fields.ownerEmail);
          if ((await recentInvitationsBy(tx, ctx.adminId, now)) >= INVITATION_RATE_LIMIT.max) throw new PlatformError("RATE_LIMITED", "hourly invitation limit reached");
          const trial = await publishedDefaultTrial(tx);
          if (!trial) throw new PlatformError("CONFIG_ERROR", "no published default Trial version");
          const current = await slotHolder(tx, fields.ownerEmail, true);
          if (current && current.expiresAt.getTime() > now.getTime()) {
            throw new InvitationRefusal("CONFLICT", "an unexpired invitation holds this e-mail", { pendingReference: invitationReference(current.id) });
          }
          if (await customerEmailInUse(tx, fields.ownerEmail)) throw new PlatformError("EMAIL_CONFLICT", "a customer user has this e-mail");
          const matches = await companyNameMatches(tx, fields.companyName, current?.id);
          if ((matches.organizations > 0 || matches.invitations > 0) && !confirmName) throw new InvitationRefusal("CONFLICT", "company name collision not confirmed", { nameMatches: matches });

          // I-5: an EXPIRED holder gives up its slot in this transaction, attributed and audited.
          let replacedReference: string | null = null;
          if (current) {
            await revokeRow(tx, current.id, ctx.adminId, now);
            replacedReference = invitationReference(current.id);
          }
          const created = await insertInvitation(tx, fields, trial, ctx.adminId, now);
          const reference = invitationReference(created.id);
          if (current && replacedReference) {
            await recordPlatformAudit(
              { ...base, entityId: current.id, action: "invitation.revoked", reason: `Expired; replaced by ${reference}`, before: { state: "expired" }, after: { state: "revoked", replacedBy: reference }, result: "success" },
              tx,
            );
          }
          await recordPlatformAudit(
            { ...base, entityId: created.id, action, after: { ...createdAfter(fields, trial, reference, created.expiresAt), ...(replacedReference ? { replaces: replacedReference } : {}) }, result: "success" },
            tx,
          );
          return { ok: true as const, id: created.id, token: created.token, expiresAt: created.expiresAt, replacedReference };
        },
        { isolationLevel: "read committed" },
      );
    } catch (err) {
      // Rolled back (the code included); the attempt is still recorded.
      if (err instanceof InvitationRefusal && err.extra.pendingReference) await rejected("pending_conflict", { pending: err.extra.pendingReference });
      else if (isPlatformError(err, "CONFLICT") && !(err instanceof InvitationRefusal)) await rejected("pending_conflict");
      else if (isPlatformError(err, "EMAIL_CONFLICT")) await rejected("email_conflict");
      else if (isPlatformError(err, "RATE_LIMITED")) await rejected("rate_limit");
      throw err;
    }
    if (!outcome.ok) {
      await recordLoginAttempt(keys, "failure", now);
      await rejected(outcome.stage);
      throw new PlatformError("MFA_INVALID", "step-up second factor failed");
    }
    return { ok: true, id: outcome.id, reference: invitationReference(outcome.id), link: invitationLink(origin, outcome.token), expiresAt: outcome.expiresAt, replacedReference: outcome.replacedReference };
  } catch (err) {
    return failure(err, action);
  }
}

// ---- revoke --------------------------------------------------------------------------------------

/** Revoke one pending (or expired) invitation: a fresh TOTP code and a reason (I-3). Its link can never be used. */
export async function revokeCompanyInvitation(req: ConsoleRequest, input: RevokeInvitationInput): Promise<InvitationRevoked | InvitationFailure> {
  const action = "invitation.revoked";
  try {
    const ctx = await authorizeInvitationChange(req);
    await assertPlatformAuditProtection();
    const id = parseInvitationId(input.invitationId);
    const reason = normalizeInvitationReason(input.reason);
    if (reason === null) throw new PlatformError("VALIDATION_FAILED", `reason must be ${INVITATION_LIMITS.reasonMin}–${INVITATION_LIMITS.reasonMax} characters without control characters`);
    const totpCode = stepUpCode(input.totpCode);
    const meta = requestMeta(req.headers);
    const now = platformClock.now();
    const base = { actorAdminId: ctx.adminId, actorLabel: ctx.displayName, entityType: INVITATION_ENTITY, entityId: id, ...meta };
    const rejected = (stage: string) => recordPlatformAudit({ ...base, action: "invitation.revoke.rejected", reason, after: { stage }, result: "rejected" });

    const [before] = await db.select({ ownerEmail: inv.ownerEmailNormalized, acceptedAt: inv.acceptedAt, revokedAt: inv.revokedAt }).from(inv).where(eq(inv.id, id)).limit(1);
    if (!before) throw new PlatformError("NOT_FOUND", "no invitation with this id");
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
          await lockInvitationEmail(tx, before.ownerEmail);
          const [row] = await tx.select({ acceptedAt: inv.acceptedAt, revokedAt: inv.revokedAt, expiresAt: inv.expiresAt }).from(inv).where(eq(inv.id, id)).for("update");
          if (!row) throw new PlatformError("NOT_FOUND", "no invitation with this id");
          if (row.acceptedAt) throw new PlatformError("INVITE_USED", "the invitation was accepted");
          if (row.revokedAt) throw new PlatformError("CONFLICT", "the invitation is already revoked");
          const state = invitationState(row, now);
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
    return { ok: true, id, reference: invitationReference(id), revokedAt: outcome.revokedAt };
  } catch (err) {
    return failure(err, action);
  }
}

// ---- re-issue ------------------------------------------------------------------------------------

/**
 * Re-issue one pending or expired invitation: the old row is revoked (its token can never be accepted)
 * and a new invitation with the same company and owner details, a new token and a new 72-hour expiry is
 * created, in one transaction. The new invitation is attributed to the re-issuing operator and offers the
 * CURRENT published default Trial (P-5). Returns only the new link.
 */
export async function reissueCompanyInvitation(req: ConsoleRequest, input: ReissueInvitationInput): Promise<InvitationReissued | InvitationFailure> {
  const action = "invitation.reissued";
  try {
    const ctx = await authorizeInvitationChange(req);
    const origin = customerPublicOrigin();
    await assertPlatformAuditProtection();
    const id = parseInvitationId(input.invitationId);
    const password = stepUpPassword(input.password);
    const totpCode = stepUpCode(input.totpCode);
    const meta = requestMeta(req.headers);
    const now = platformClock.now();
    const base = { actorAdminId: ctx.adminId, actorLabel: ctx.displayName, entityType: INVITATION_ENTITY, ...meta };
    const rejected = (stage: string) => recordPlatformAudit({ ...base, entityId: id, action: "invitation.reissue.rejected", after: { stage }, result: "rejected" });

    const [before] = await db.select({ ownerEmail: inv.ownerEmailNormalized, acceptedAt: inv.acceptedAt, revokedAt: inv.revokedAt }).from(inv).where(eq(inv.id, id)).limit(1);
    if (!before) throw new PlatformError("NOT_FOUND", "no invitation with this id");
    if (before.acceptedAt) {
      await rejected("accepted");
      throw new PlatformError("INVITE_USED", "the invitation was accepted");
    }
    if (before.revokedAt) throw new PlatformError("CONFLICT", "the invitation is already revoked");
    if ((await recentInvitationsBy(db, ctx.adminId, now)) >= INVITATION_RATE_LIMIT.max) {
      await rejected("rate_limit");
      throw new PlatformError("RATE_LIMITED", "hourly invitation limit reached");
    }
    if (!(await publishedDefaultTrial())) {
      await rejected("no_trial");
      throw new PlatformError("CONFIG_ERROR", "no published default Trial version");
    }
    if (await customerEmailInUse(db, before.ownerEmail)) {
      await rejected("email_conflict");
      throw new PlatformError("EMAIL_CONFLICT", "a customer user has this e-mail");
    }

    const keys = throttleKeys(ctx.email, meta.ipAddress);
    await stepUpOutsideTransaction(ctx, keys, password, now, rejected);

    let outcome: { ok: true; id: string; token: string; expiresAt: Date; previousReference: string } | { ok: false; stage: "mfa" | "replay" };
    try {
      outcome = await db.transaction(
        async (tx) => {
          const totp = await consumeTotpCode(tx, ctx.adminId, totpCode, now);
          if (!totp.ok) return { ok: false as const, stage: totp.reason === "replayed" ? ("replay" as const) : ("mfa" as const) };
          await lockInvitationEmail(tx, before.ownerEmail);
          const [old] = await tx
            .select({
              acceptedAt: inv.acceptedAt,
              revokedAt: inv.revokedAt,
              expiresAt: inv.expiresAt,
              companyName: inv.companyName,
              industry: inv.industry,
              companyEmail: inv.companyEmail,
              country: inv.countryName,
              currency: inv.currencyCode,
              ownerName: inv.ownerName,
              ownerEmail: inv.ownerEmailNormalized,
            })
            .from(inv)
            .where(eq(inv.id, id))
            .for("update");
          if (!old) throw new PlatformError("NOT_FOUND", "no invitation with this id");
          if (old.acceptedAt) throw new PlatformError("INVITE_USED", "the invitation was accepted");
          if (old.revokedAt) throw new PlatformError("CONFLICT", "the invitation is already revoked");
          if ((await recentInvitationsBy(tx, ctx.adminId, now)) >= INVITATION_RATE_LIMIT.max) throw new PlatformError("RATE_LIMITED", "hourly invitation limit reached");
          const trial = await publishedDefaultTrial(tx);
          if (!trial) throw new PlatformError("CONFIG_ERROR", "no published default Trial version");
          if (await customerEmailInUse(tx, old.ownerEmail)) throw new PlatformError("EMAIL_CONFLICT", "a customer user has this e-mail");
          const fields: InvitationFields = { companyName: old.companyName, industry: old.industry, companyEmail: old.companyEmail, country: old.country, currency: old.currency, ownerName: old.ownerName, ownerEmail: old.ownerEmail };
          const previousState = invitationState(old, now);
          const previousReference = invitationReference(id);
          await revokeRow(tx, id, ctx.adminId, now);
          const created = await insertInvitation(tx, fields, trial, ctx.adminId, now);
          const reference = invitationReference(created.id);
          await recordPlatformAudit(
            { ...base, entityId: id, action: "invitation.revoked", reason: `Re-issued as ${reference}`, before: { state: previousState }, after: { state: "revoked", replacedBy: reference }, result: "success" },
            tx,
          );
          await recordPlatformAudit({ ...base, entityId: created.id, action, after: { ...createdAfter(fields, trial, reference, created.expiresAt), replaces: previousReference }, result: "success" }, tx);
          return { ok: true as const, id: created.id, token: created.token, expiresAt: created.expiresAt, previousReference };
        },
        { isolationLevel: "read committed" },
      );
    } catch (err) {
      if (isPlatformError(err, "INVITE_USED")) await rejected("accepted");
      else if (isPlatformError(err, "EMAIL_CONFLICT")) await rejected("email_conflict");
      else if (isPlatformError(err, "RATE_LIMITED")) await rejected("rate_limit");
      throw err;
    }
    if (!outcome.ok) {
      await recordLoginAttempt(keys, "failure", now);
      await rejected(outcome.stage);
      throw new PlatformError("MFA_INVALID", "step-up second factor failed");
    }
    return { ok: true, id: outcome.id, reference: invitationReference(outcome.id), previousReference: outcome.previousReference, link: invitationLink(origin, outcome.token), expiresAt: outcome.expiresAt };
  } catch (err) {
    return failure(err, action);
  }
}
