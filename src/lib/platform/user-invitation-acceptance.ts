import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, orgsTable, type Tx } from "@/db";
import { userInvitationsTable } from "@/db/staged/platform-user-invitations";
import type { Locale } from "@/lib/i18n/dict";
import { activeAcceptanceBlock, recordAcceptanceAttempt, type AcceptanceThrottleKeys } from "./acceptance-throttle";
import { assertPlatformAuditProtection, recordPlatformAudit } from "./audit";
import { clientIpFromHeaders, type HeaderSource } from "./client-ip";
import { platformClock } from "./clock";
import { orgReference } from "./companies";
import { getTenantAccess } from "./company-access";
import { platformKeyedDigest, platformSigningKey } from "./config";
import { formatPlatformDateTime } from "./display";
import { isPlatformError } from "./errors";
import { isCustomerSeatEnforcementEnabled, isCustomerUserInviteAcceptanceEnabled } from "./flags";
import { errorClass, reportSecurityIncident } from "./incident";
import { customerEmailInUse, customerPublicOrigin, invitationTokenHash, lockInvitationEmail } from "./invitations";
import { assertCustomerHost, assertSameOrigin } from "./origin";
import { readSeatAccounting } from "./seat-accounting";
import { assertUserSeatAvailable, boundSeatLockWait, isSeatRefusal, lockCompanyForSeatChange, previewUserSeat, type SeatDecision, type SeatRefusalCode } from "./seat-enforcement";
import { USER_INVITATION_ENTITY, USER_INVITATION_LIMITS, USER_INVITATION_ROLES, userInvitationReference, userInvitationsInstalled, userInvitationState, type UserInvitationRole } from "./user-invitations";

// ---------------------------------------------------------------------------------------------
// PO-03D (sub-batch A) — customer-user invitation ACCEPTANCE: the platform core (docs/platform-owner/PO03D_DEVELOPMENT.md
// §C–§F). A PUBLIC endpoint: the caller holds a one-time link to join an EXISTING company as admin or staff (never owner).
// Its only customer-side caller is src/lib/onboarding/user-invitation-acceptance.ts, which checks and hashes the password
// and supplies two callbacks — the user insert and the customer security / activity evidence — so this module never
// imports customer authentication, password or audit code and never sees a password or its hash.
//
// Every request: flag (CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED, exactly "true") → configuration (canonical customer
// origin, platform key) → same origin, from the canonical customer origin only → the protected audit trail → the staged
// table exists → the durable per-IP block (purpose-separated digests: "user-invite-accept-ip" / "-email" — never a
// sign-in, company-acceptance or console key) → token format → sha256(token) lookup → the per-invitation block →
// lifecycle. Acceptance is then ONE READ COMMITTED transaction, in the shared lock order:
//   bounded lock wait → the e-mail advisory lock (THE key of company and user invitations alike) → the company row
//   FOR NO KEY UPDATE (the seat lock, seat-enforcement.ts — directly, never upgraded) → the invitation row FOR UPDATE →
//   the decision time (read after the locks) → every check again: the token's digest, the lifecycle, the company's
//   access, no customer user with the e-mail in ANY letter case, the role → the seat check (the invitation's own
//   reservation becomes the user: never counted twice) → the user (callback, the precomputed hash) → the invitation
//   marked accepted with the new user's id → customer evidence (callback) → platform audit → COMMIT.
// Any failure — an audit write included — rolls everything back: no user, no accepted invitation, no success record.
// No session is issued (the page links to /login) and nothing is delivered. The token is never stored, logged or
// audited; only its digest is compared.
// ---------------------------------------------------------------------------------------------

/** What the public endpoint may say. "invalid" covers unknown, malformed, revoked and missing links alike. */
export type UserAcceptanceRefusalReason = "disabled" | "invalid" | "expired" | "used" | "throttled" | "unavailable" | "seats_full" | "company_unavailable";

export class UserAcceptanceRefusal extends Error {
  constructor(
    readonly reason: UserAcceptanceRefusalReason,
    /** Internal stage for audit and tests — never shown to the visitor. */
    readonly stage: string,
  ) {
    super(`user invitation acceptance refused (${stage})`);
    this.name = "UserAcceptanceRefusal";
  }
}

export type UserAcceptanceContext = { requestId: string; ip: string | null; userAgent: string | null; ipKeys: AcceptanceThrottleKeys };

/** A token is exactly what PO-03C issues: 32 random bytes, base64url (43 characters). */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ACTOR = "invitee";
// C0 / C1 controls and the bidirectional embedding / override / isolate controls (the PO-02D2 / PO-03C text rule).
const DISALLOWED_TEXT = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/;
const UI = userInvitationsTable;

export function isUserInvitationAcceptanceAvailable(): boolean {
  return isCustomerUserInviteAcceptanceEnabled();
}

/**
 * The throttle keys of this endpoint: keyed digests under purposes of its OWN, so a user-acceptance key can never match,
 * count against or block a Platform Owner sign-in, a company-invitation acceptance or a console step-up (and the reverse).
 */
export function userAcceptanceThrottleKeys(email: string | null, ipAddress: string | null): AcceptanceThrottleKeys {
  const ip = (ipAddress ?? "").trim().toLowerCase();
  return {
    invitationHash: email ? platformKeyedDigest("user-invite-accept-email", email) : null,
    ipHash: ip ? platformKeyedDigest("user-invite-accept-ip", ip) : null,
  };
}

/** The invitee's confirmed name: white-space runs collapsed, 1–200 characters, no control or direction-override characters. */
export function normalizeAcceptanceInviteeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length < 1 || text.length > USER_INVITATION_LIMITS.name || DISALLOWED_TEXT.test(text)) return null;
  return text;
}

/**
 * Every request starts here: flag → configuration → same origin (the canonical customer origin) → protected audit trail
 * → the staged table → per-IP block. Throws UserAcceptanceRefusal; never reads a token.
 */
export async function beginUserAcceptance(headers: HeaderSource): Promise<UserAcceptanceContext> {
  if (!isCustomerUserInviteAcceptanceEnabled()) throw new UserAcceptanceRefusal("disabled", "flag");
  let origin: string;
  let ip: string | null;
  let ipKeys: AcceptanceThrottleKeys;
  try {
    origin = customerPublicOrigin();
    platformSigningKey();
    ip = clientIpFromHeaders(headers);
    ipKeys = userAcceptanceThrottleKeys(null, ip);
  } catch {
    throw new UserAcceptanceRefusal("unavailable", "config");
  }
  try {
    assertSameOrigin(headers);
    assertCustomerHost(headers); // PO-07 H-1: the customer host only
  } catch {
    throw new UserAcceptanceRefusal("unavailable", "origin");
  }
  if (headers.get("origin") !== origin) throw new UserAcceptanceRefusal("unavailable", "origin");
  try {
    await assertPlatformAuditProtection();
  } catch {
    throw new UserAcceptanceRefusal("unavailable", "audit_protection");
  }
  let installed = false;
  try {
    installed = await userInvitationsInstalled(db);
  } catch {
    installed = false;
  }
  if (!installed) throw new UserAcceptanceRefusal("unavailable", "not_installed");
  if (await activeAcceptanceBlock(ipKeys, platformClock.now())) throw new UserAcceptanceRefusal("throttled", "ip_blocked");
  return { requestId: randomUUID(), ip, userAgent: headers.get("user-agent")?.slice(0, 500) ?? null, ipKeys };
}

// ---- reads -------------------------------------------------------------------------------------

type InvitationRow = { id: string; orgId: number; name: string; email: string; role: string; tokenHash: string; expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null; createdAt: Date };
// Allow-listed columns; the digest is compared here and never leaves this module.
const COLUMNS = { id: UI.id, orgId: UI.orgId, name: UI.name, email: UI.emailNormalized, role: UI.requestedRole, tokenHash: UI.tokenHash, expiresAt: UI.expiresAt, acceptedAt: UI.acceptedAt, revokedAt: UI.revokedAt, createdAt: UI.createdAt };

async function auditRejection(ctx: UserAcceptanceContext, invitation: { id: string; orgId: number }, stage: string): Promise<void> {
  try {
    await recordPlatformAudit({
      actorLabel: ACTOR,
      action: "user_invitation.accept.rejected",
      entityType: USER_INVITATION_ENTITY,
      entityId: invitation.id,
      orgId: invitation.orgId,
      after: { reference: userInvitationReference(invitation.id), stage },
      result: "rejected",
      requestId: ctx.requestId,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });
  } catch (err) {
    reportSecurityIncident({ type: "audit_write_failed", action: "user_invitation.accept.rejected", requestId: ctx.requestId, ipAddress: ctx.ip, error: errorClass(err) });
  }
}

type Resolved = { row: InvitationRow; keys: AcceptanceThrottleKeys; tokenHash: string };

/**
 * A usable invitation for this token, or a UserAcceptanceRefusal. Unknown and malformed tokens count against the client
 * IP only and leave no audit record (nothing to attach it to); every refusal of a REAL invitation also counts against
 * that invitation (when the invitee caused it) and is audited with its stage.
 */
async function resolveUsable(ctx: UserAcceptanceContext, token: unknown): Promise<Resolved> {
  const now = platformClock.now();
  if (typeof token !== "string" || !TOKEN.test(token)) {
    await recordAcceptanceAttempt(ctx.ipKeys, "failure", now);
    throw new UserAcceptanceRefusal("invalid", "malformed");
  }
  const tokenHash = invitationTokenHash(token);
  const [row] = await db.select(COLUMNS).from(UI).where(eq(UI.tokenHash, tokenHash)).limit(1);
  if (!row) {
    await recordAcceptanceAttempt(ctx.ipKeys, "failure", now);
    throw new UserAcceptanceRefusal("invalid", "unknown");
  }
  const keys = userAcceptanceThrottleKeys(row.email, ctx.ip);
  if (await activeAcceptanceBlock(keys, now)) throw new UserAcceptanceRefusal("throttled", "invitation_blocked");
  const state = userInvitationState(row, now);
  if (state !== "pending") {
    const refusal = state === "expired" ? new UserAcceptanceRefusal("expired", "expired") : state === "accepted" ? new UserAcceptanceRefusal("used", "used") : new UserAcceptanceRefusal("invalid", "revoked");
    await recordAcceptanceAttempt(keys, "failure", now);
    await auditRejection(ctx, row, refusal.stage);
    throw refusal;
  }
  return { row, keys, tokenHash };
}

/** A seat refusal of the shared check, as the visitor may hear it. */
function seatRefusal(code: SeatRefusalCode): UserAcceptanceRefusal {
  if (code === "SEAT_LIMIT") return new UserAcceptanceRefusal("seats_full", "seat_limit");
  if (code === "SUBSCRIPTION_REQUIRED") return new UserAcceptanceRefusal("seats_full", "no_subscription");
  return new UserAcceptanceRefusal("unavailable", "seat_check_unavailable");
}

export type UserInvitationSeatView =
  /** Enforced for this company: the seats included and how many are in use, this invitation's reserved seat counted. */
  | { state: "enforced"; seats: number; occupied: number }
  /** A subscription exists, but enforcement is switched off here: the seats are shown, not enforced. */
  | { state: "shown"; seats: number; occupied: number }
  /** No subscription (or none readable): nothing to show. */
  | { state: "none" };

export type UserInvitationAcceptancePreview = {
  reference: string;
  companyName: string;
  name: string;
  email: string;
  role: UserInvitationRole;
  expiresAt: string;
  /** Riyadh time, Gregorian calendar, Western digits — in both languages, so the page can switch without a request. */
  expiresAtText: Record<Locale, string>;
  plan: { packageName: string; versionNumber: number; isTrial: boolean } | null;
  seats: UserInvitationSeatView;
};

/**
 * Read-only: what the invitee is about to accept — the invitation's own fields, its company, the company's plan and seats
 * — or why it cannot be used. A company that is suspended or has no free seat (while enforcement is on) is refused here
 * already, so no password is typed for nothing; the acceptance transaction repeats every check under the locks.
 */
export async function previewUserInvitationForAcceptance(ctx: UserAcceptanceContext, token: unknown): Promise<UserInvitationAcceptancePreview> {
  const { row } = await resolveUsable(ctx, token);
  const now = platformClock.now();
  const [org] = await db.select({ name: orgsTable.name }).from(orgsTable).where(eq(orgsTable.id, row.orgId)).limit(1);
  const access = org ? await getTenantAccess(row.orgId) : null;
  if (!org || !access || access.status !== "active") {
    await auditRejection(ctx, row, "company_suspended");
    throw new UserAcceptanceRefusal("company_unavailable", "company_suspended");
  }
  if (!(USER_INVITATION_ROLES as readonly string[]).includes(row.role)) {
    await auditRejection(ctx, row, "role");
    throw new UserAcceptanceRefusal("invalid", "role");
  }
  const verdict = await previewUserSeat(db, row.orgId, 1, { path: "invitation_accept", at: now, replacingInvitationIds: [row.id] });
  if (!verdict.ok) {
    const refusal = seatRefusal(verdict.code);
    await auditRejection(ctx, row, refusal.stage);
    throw refusal;
  }
  const enforcement = isCustomerSeatEnforcementEnabled();
  const accounting = await readSeatAccounting(db, row.orgId, now, enforcement).catch(() => null);
  const allowance = accounting?.allowance.state === "assigned" ? accounting.allowance : null;
  const seats: UserInvitationSeatView = accounting && allowance ? { state: accounting.enforced ? "enforced" : "shown", seats: allowance.seats, occupied: accounting.occupied } : { state: "none" };
  return {
    reference: userInvitationReference(row.id),
    companyName: org.name,
    name: row.name,
    email: row.email,
    role: row.role as UserInvitationRole,
    expiresAt: row.expiresAt.toISOString(),
    expiresAtText: { en: formatPlatformDateTime(row.expiresAt, "en"), ar: formatPlatformDateTime(row.expiresAt, "ar") },
    plan: allowance ? { packageName: allowance.packageName, versionNumber: allowance.versionNumber, isTrial: allowance.isTrial } : null,
    seats,
  };
}

// ---- acceptance ----------------------------------------------------------------------------------

export type UserAcceptanceFacts = { orgId: number; companyName: string; name: string; email: string; role: UserInvitationRole; reference: string };
export type UserAcceptanceHooks = {
  /** The customer user, inside THIS transaction (the bridge's insert, with the hash it computed before the transaction). */
  createUser: (tx: Tx, facts: UserAcceptanceFacts) => Promise<{ userId: number }>;
  /** The customer security and activity records, inside THIS transaction. */
  evidence: (tx: Tx, facts: UserAcceptanceFacts & { userId: number }) => Promise<void>;
};
export type UserAcceptanceResult = { reference: string; companyName: string; email: string; role: UserInvitationRole };

/** The SQLSTATE (and constraint) of a database error, also when wrapped. */
function pgError(err: unknown): { code: string; constraint: string } | null {
  for (let e: unknown = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return { code, constraint: String((e as { constraint?: unknown }).constraint ?? "") };
  }
  return null;
}

/** Client-caused refusals count against the throttle; failures of the system (and a full company) never lock an invitee out. */
const COUNTED: ReadonlySet<string> = new Set(["expired", "used", "revoked", "changed", "email_conflict"]);

export async function acceptUserInvitation(ctx: UserAcceptanceContext, input: { token: unknown; name: string }, hooks: UserAcceptanceHooks): Promise<UserAcceptanceResult> {
  const pre = await resolveUsable(ctx, input.token);
  let stage = "failed";
  try {
    const result = await db.transaction(
      async (tx) => {
        // 1. bounded waits; 2. the e-mail lock; 3. the company row (the seat lock); 4. the invitation row.
        await boundSeatLockWait(tx);
        stage = "email_lock";
        await lockInvitationEmail(tx, pre.row.email);
        stage = "company";
        const lock = await lockCompanyForSeatChange(tx, pre.row.orgId);
        if (!lock) throw new UserAcceptanceRefusal("invalid", "company_missing");
        stage = "invitation";
        const [current] = await tx.select(COLUMNS).from(UI).where(eq(UI.id, pre.row.id)).for("update");
        // 5. The decision time is taken AFTER the locks: an invitation that expired while this request waited is expired.
        const now = platformClock.now();
        // 6. Every check again, on the locked rows.
        if (!current || current.tokenHash !== pre.tokenHash || current.orgId !== lock.orgId) throw new UserAcceptanceRefusal("invalid", "changed");
        const state = userInvitationState(current, now);
        if (state === "accepted") throw new UserAcceptanceRefusal("used", "used");
        if (state === "revoked") throw new UserAcceptanceRefusal("invalid", "revoked");
        if (state === "expired") throw new UserAcceptanceRefusal("expired", "expired");
        // 7. The company's access, read fresh after its row lock (a suspension that committed first is seen).
        const access = await getTenantAccess(lock.orgId, tx);
        if (!access || access.status !== "active") throw new UserAcceptanceRefusal("company_unavailable", "company_suspended");
        // 8. No customer user may hold this e-mail in ANY letter case (neutral answer); a user committed after this check is
        //    caught by users_email_unique at the insert (23505 below) — application writers all store the lower-cased form.
        if (await customerEmailInUse(tx, current.email)) throw new UserAcceptanceRefusal("unavailable", "email_conflict");
        // 9. The role: admin or staff, never owner.
        if (!(USER_INVITATION_ROLES as readonly string[]).includes(current.role)) throw new UserAcceptanceRefusal("invalid", "role");
        const [org] = await tx.select({ name: orgsTable.name }).from(orgsTable).where(eq(orgsTable.id, lock.orgId)).limit(1);
        const reference = userInvitationReference(current.id);
        const facts: UserAcceptanceFacts = { orgId: lock.orgId, companyName: org?.name ?? "", name: input.name, email: current.email, role: current.role as UserInvitationRole, reference };
        // 10. The seat: this invitation's own reservation becomes the user (replaced, never counted twice).
        stage = "seats";
        const seat: SeatDecision = await assertUserSeatAvailable(tx, lock, 1, { path: "invitation_accept", at: now, replacingInvitationIds: [current.id] });
        // 11. The user, with the hash the bridge computed before the transaction.
        stage = "user";
        const { userId } = await hooks.createUser(tx, facts);
        // 12. The invitation, accepted by that user — only while neither accepted nor revoked (accepted_at never precedes created_at).
        stage = "accepted";
        const marked = await tx
          .update(UI)
          .set({ acceptedAt: sql`greatest(${now.toISOString()}::timestamptz, ${UI.createdAt})`, acceptedUserId: userId })
          .where(and(eq(UI.id, current.id), isNull(UI.acceptedAt), isNull(UI.revokedAt)))
          .returning({ id: UI.id });
        if (marked.length !== 1) throw new UserAcceptanceRefusal("used", "changed");
        // 13. Customer evidence; 14. platform audit — both in this transaction.
        stage = "evidence";
        await hooks.evidence(tx, { ...facts, userId });
        stage = "audit";
        await recordPlatformAudit(
          {
            actorLabel: ACTOR,
            action: "user_invitation.accepted",
            entityType: USER_INVITATION_ENTITY,
            entityId: current.id,
            orgId: lock.orgId,
            before: { state: "pending" },
            after: {
              state: "accepted",
              reference,
              orgId: lock.orgId,
              companyReference: orgReference(lock.orgId),
              userId,
              email: current.email,
              role: current.role,
              seats: seat.enforced ? { enforced: true, seats: seat.seats, occupied: seat.occupiedAfter } : { enforced: false, reason: seat.reason },
            },
            result: "success",
            requestId: ctx.requestId,
            ipAddress: ctx.ip,
            userAgent: ctx.userAgent,
          },
          tx,
        );
        return { reference, companyName: facts.companyName, email: current.email, role: facts.role, decidedAt: now };
      },
      { isolationLevel: "read committed" },
    );
    await recordAcceptanceAttempt(pre.keys, "success", result.decidedAt).catch(() => undefined);
    return { reference: result.reference, companyName: result.companyName, email: result.email, role: result.role };
  } catch (err) {
    let refusal: UserAcceptanceRefusal;
    if (err instanceof UserAcceptanceRefusal) refusal = err;
    else if (isSeatRefusal(err)) refusal = seatRefusal(err.code);
    else {
      const pg = pgError(err);
      if (pg?.code === "23505" && /users_email/.test(pg.constraint)) refusal = new UserAcceptanceRefusal("unavailable", "email_conflict");
      else if (pg?.code === "23505" && /user_invitations/.test(pg.constraint)) refusal = new UserAcceptanceRefusal("used", "changed");
      else if (pg?.code === "55P03" || pg?.code === "40P01") refusal = new UserAcceptanceRefusal("unavailable", pg.code === "55P03" ? "lock_timeout" : "deadlock");
      else {
        if (isPlatformError(err) && err.code === "AUDIT_UNAVAILABLE") {
          stage = "audit";
          reportSecurityIncident({ type: "audit_write_failed", action: "user_invitation.accepted", requestId: ctx.requestId, ipAddress: ctx.ip, error: errorClass(err) });
        } else {
          // The class only (a PlatformError code, a SQLSTATE or a constructor name) — never a message or a value.
          console.error(`[user-invitation-acceptance] not completed at ${stage} (${errorClass(err)}); nothing was applied`);
        }
        refusal = new UserAcceptanceRefusal("unavailable", stage);
      }
    }
    if (COUNTED.has(refusal.stage)) await recordAcceptanceAttempt(pre.keys, "failure", platformClock.now()).catch(() => undefined);
    await auditRejection(ctx, pre.row, refusal.stage);
    throw refusal;
  }
}
