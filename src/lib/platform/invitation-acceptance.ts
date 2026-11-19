import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  organizationInvitationsTable,
  organizationInvitationTermsTable,
  subscriptionEventsTable,
  subscriptionPackagesTable,
  subscriptionPackageVersionsTable,
  tenantAccessControlsTable,
  tenantPrimaryOwnersTable,
  tenantSubscriptionsTable,
  type Tx,
} from "@/db";
import { addDays } from "@/lib/date-only";
import type { Locale } from "@/lib/i18n/dict";
import { acceptanceThrottleKeys, activeAcceptanceBlock, recordAcceptanceAttempt, type AcceptanceThrottleKeys } from "./acceptance-throttle";
import { assertPlatformAuditProtection, recordPlatformAudit } from "./audit";
import { clientIpFromHeaders, type HeaderSource } from "./client-ip";
import { platformClock } from "./clock";
import { invitationReference } from "./companies";
import { platformSigningKey } from "./config";
import { formatPlatformDate, formatPlatformDateTime } from "./display";
import { isPlatformError } from "./errors";
import { isCustomerInviteAcceptanceEnabled } from "./flags";
import { errorClass, reportSecurityIncident } from "./incident";
import { customerEmailInUse, customerPublicOrigin, INVITATION_ENTITY, INVITATION_LIMITS, invitationState, invitationTokenHash, lockInvitationEmail } from "./invitations";
import { assertSameOrigin } from "./origin";

// ---------------------------------------------------------------------------------------------
// PO-02D3 — invitation acceptance: the platform core (docs/platform-owner/PO02D3_DEVELOPMENT.md §F, §I).
//
// A PUBLIC endpoint: the caller is an invitee holding a one-time link, not a Platform Owner. Its only customer-side
// caller is src/lib/onboarding/invitation-acceptance.ts, which hashes the password and supplies two callbacks — the
// shared organization bootstrap and the customer audit / security evidence — so this module never imports customer
// authentication, password or audit code (boundary rule 2) and the platform never sees a password or its hash.
//
// Order of every request: flag (CUSTOMER_INVITE_ACCEPTANCE_ENABLED) → configuration (canonical customer origin,
// platform key, protected audit trail) → same origin, from the canonical customer origin only → durable per-IP block
// → token format → sha256(token) lookup → lifecycle (pending, unexpired) → the invitation's immutable terms (a
// PUBLISHED Trial version, cycle `trial`) → durable per-invitation block. Acceptance then runs ONE READ COMMITTED
// transaction:
//   owner e-mail advisory lock (PO-02D2's key) → the invitation row FOR UPDATE → every check again (state, terms,
//   any customer user with the e-mail in any letter case) → organization + owner + defaults (callback) → active access
//   row → primary owner → Trial subscription from the terms' version snapshots (Asia/Riyadh business dates) →
//   `assigned` subscription event → invitation marked accepted → platform audit `invitation.accepted` → customer
//   audit + security evidence (callback) → COMMIT.
// Any failure — an audit write included — rolls the whole acceptance back: no company, owner, defaults, mapping,
// subscription, accepted status or success record survives. No session is issued; nothing is delivered.
//
// Lock order against the rest of the system: PO-02D2 create / revoke / re-issue take the operator row, THEN the same
// e-mail lock, then the invitation row — the same relative order, so they serialize and cannot deadlock. PO-02C
// suspension and PO-02C.1 sign-in lock EXISTING companies; acceptance only creates a new one. /register takes no
// advisory lock: its only contention point is the users_email_unique index entry, where the second writer of one
// normalized address always loses with 23505 and rolls back whole (verify:platform-email-uniqueness).
// ---------------------------------------------------------------------------------------------

/** What the public endpoint may say. "invalid" covers unknown, malformed, revoked and missing links alike. */
export type PublicRefusalReason = "disabled" | "invalid" | "expired" | "used" | "throttled" | "unavailable";

export class AcceptanceRefusal extends Error {
  constructor(
    readonly reason: PublicRefusalReason,
    /** Internal stage for audit and tests — never shown to the visitor. */
    readonly stage: string,
  ) {
    super(`invitation acceptance refused (${stage})`);
    this.name = "AcceptanceRefusal";
  }
}

export type AcceptanceContext = { requestId: string; ip: string | null; userAgent: string | null; ipKeys: AcceptanceThrottleKeys };

/** A token is exactly what PO-02D2 issues: 32 random bytes, base64url (43 characters). */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ACTOR = "invitee";
// C0 / C1 controls and the bidirectional embedding / override / isolate controls (as PO-02D2's names).
const DISALLOWED_TEXT = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

export function isInvitationAcceptanceAvailable(): boolean {
  return isCustomerInviteAcceptanceEnabled();
}

/** The invitee's confirmed name: white-space runs collapsed, 1–200 characters, no control or direction-override characters. */
export function normalizeAcceptanceOwnerName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length < 1 || text.length > INVITATION_LIMITS.ownerName || DISALLOWED_TEXT.test(text)) return null;
  return text;
}

/** The Asia/Riyadh calendar date of an instant, "YYYY-MM-DD" (decision S-1: business dates are Riyadh dates). */
const RIYADH = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" });
export function riyadhBusinessDate(instant: Date): string {
  const parts = Object.fromEntries(RIYADH.formatToParts(instant).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Every request starts here: flag → configuration → same origin (the canonical customer origin) → per-IP block.
 * Throws AcceptanceRefusal; never reads a token.
 */
export async function beginAcceptance(headers: HeaderSource): Promise<AcceptanceContext> {
  if (!isCustomerInviteAcceptanceEnabled()) throw new AcceptanceRefusal("disabled", "flag");
  let origin: string;
  let ip: string | null;
  let ipKeys: AcceptanceThrottleKeys;
  try {
    origin = customerPublicOrigin();
    platformSigningKey();
    ip = clientIpFromHeaders(headers);
    ipKeys = acceptanceThrottleKeys(null, ip);
  } catch {
    throw new AcceptanceRefusal("unavailable", "config");
  }
  try {
    assertSameOrigin(headers);
  } catch {
    throw new AcceptanceRefusal("unavailable", "origin");
  }
  if (headers.get("origin") !== origin) throw new AcceptanceRefusal("unavailable", "origin");
  try {
    await assertPlatformAuditProtection();
  } catch {
    throw new AcceptanceRefusal("unavailable", "audit_protection");
  }
  if (await activeAcceptanceBlock(ipKeys, platformClock.now())) throw new AcceptanceRefusal("throttled", "ip_blocked");
  return { requestId: randomUUID(), ip, userAgent: headers.get("user-agent")?.slice(0, 500) ?? null, ipKeys };
}

// ---- reads -------------------------------------------------------------------------------------

const inv = organizationInvitationsTable;
const terms = organizationInvitationTermsTable;
const versions = subscriptionPackageVersionsTable;
const packages = subscriptionPackagesTable;

type InvitationRow = {
  id: string;
  tokenHash: string;
  companyName: string;
  industry: string | null;
  companyEmail: string;
  countryName: string;
  currencyCode: string;
  ownerName: string;
  ownerEmail: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
};

const INVITATION_COLUMNS = {
  id: inv.id,
  tokenHash: inv.tokenHash,
  companyName: inv.companyName,
  industry: inv.industry,
  companyEmail: inv.companyEmail,
  countryName: inv.countryName,
  currencyCode: inv.currencyCode,
  ownerName: inv.ownerName,
  ownerEmail: inv.ownerEmailNormalized,
  expiresAt: inv.expiresAt,
  acceptedAt: inv.acceptedAt,
  revokedAt: inv.revokedAt,
};

export type TrialTerms = {
  versionId: string;
  packageCode: string;
  packageName: string;
  versionNumber: number;
  trialDays: number;
  seats: number;
  storageGb: number;
  modules: string[];
  price: string;
  currency: string;
};

/** The invitation's immutable terms, joined to the PUBLISHED version they name; null unless a usable Trial. */
async function loadTerms(executor: Tx | typeof db, invitationId: string): Promise<TrialTerms | null> {
  const [row] = await executor
    .select({
      versionId: terms.initialPackageVersionId,
      termsIsTrial: terms.initialIsTrial,
      cycle: terms.initialCycle,
      publishState: versions.publishState,
      versionIsTrial: versions.isTrial,
      versionNumber: versions.versionNumber,
      trialDays: versions.trialDays,
      seats: versions.includedSeats,
      storageGb: versions.storageAllowanceGb,
      modules: versions.moduleGroups,
      price: versions.monthlyPrice,
      currency: versions.currencyCode,
      packageCode: packages.code,
      packageName: packages.name,
      packageIsTrial: packages.isTrial,
    })
    .from(terms)
    .innerJoin(versions, eq(versions.id, terms.initialPackageVersionId))
    .innerJoin(packages, eq(packages.id, versions.packageId))
    .where(eq(terms.invitationId, invitationId))
    .limit(1);
  if (!row) return null;
  // P-5 (provisional): acceptance assigns the Trial only — a published Trial version on the trial cycle, free.
  const modules = Array.isArray(row.modules) && row.modules.every((m) => typeof m === "string") ? (row.modules as string[]) : null;
  if (
    row.publishState !== "published" || !row.termsIsTrial || !row.versionIsTrial || !row.packageIsTrial || row.cycle !== "trial" ||
    !Number.isInteger(row.trialDays) || row.trialDays < 1 || row.trialDays > 120 || Number(row.price) !== 0 || !modules
  ) {
    return null;
  }
  return {
    versionId: row.versionId,
    packageCode: row.packageCode,
    packageName: row.packageName,
    versionNumber: row.versionNumber,
    trialDays: row.trialDays,
    seats: row.seats,
    storageGb: row.storageGb,
    modules,
    price: row.price,
    currency: row.currency,
  };
}

async function auditRejection(ctx: AcceptanceContext, invitationId: string, stage: string): Promise<void> {
  try {
    await recordPlatformAudit({
      actorLabel: ACTOR,
      action: "invitation.accept.rejected",
      entityType: INVITATION_ENTITY,
      entityId: invitationId,
      after: { reference: invitationReference(invitationId), stage },
      result: "rejected",
      requestId: ctx.requestId,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });
  } catch (err) {
    reportSecurityIncident({ type: "audit_write_failed", action: "invitation.accept.rejected", requestId: ctx.requestId, ipAddress: ctx.ip, error: errorClass(err) });
  }
}

type Resolved = { row: InvitationRow; terms: TrialTerms; keys: AcceptanceThrottleKeys; tokenHash: string };

/**
 * A usable invitation for this token, or an AcceptanceRefusal. Unknown and malformed tokens count against the client
 * IP only and leave no audit record (nothing to attach it to); every refusal of a REAL invitation also counts against
 * that invitation and is audited with its stage.
 */
async function resolveUsable(ctx: AcceptanceContext, token: unknown): Promise<Resolved> {
  const now = platformClock.now();
  if (typeof token !== "string" || !TOKEN.test(token)) {
    await recordAcceptanceAttempt(ctx.ipKeys, "failure", now);
    throw new AcceptanceRefusal("invalid", "malformed");
  }
  const tokenHash = invitationTokenHash(token);
  const [row] = await db.select(INVITATION_COLUMNS).from(inv).where(eq(inv.tokenHash, tokenHash)).limit(1);
  if (!row) {
    await recordAcceptanceAttempt(ctx.ipKeys, "failure", now);
    throw new AcceptanceRefusal("invalid", "unknown");
  }
  const keys = acceptanceThrottleKeys(row.ownerEmail, ctx.ip);
  if (await activeAcceptanceBlock(keys, now)) throw new AcceptanceRefusal("throttled", "invitation_blocked");
  const state = invitationState(row, now);
  if (state !== "pending") {
    const refusal = state === "expired" ? new AcceptanceRefusal("expired", "expired") : state === "accepted" ? new AcceptanceRefusal("used", "used") : new AcceptanceRefusal("invalid", "revoked");
    await recordAcceptanceAttempt(keys, "failure", now);
    await auditRejection(ctx, row.id, refusal.stage);
    throw refusal;
  }
  const trial = await loadTerms(db, row.id);
  if (!trial) {
    await auditRejection(ctx, row.id, "terms");
    throw new AcceptanceRefusal("unavailable", "terms");
  }
  return { row, terms: trial, keys, tokenHash };
}

export type InvitationPreview = {
  reference: string;
  companyName: string;
  ownerName: string;
  ownerEmail: string;
  countryName: string;
  currencyCode: string;
  expiresAt: string;
  /** Riyadh time, Gregorian calendar, Western digits — in both languages, so the page can switch without a request. */
  expiresAtText: Record<Locale, string>;
  trial: { packageName: string; versionNumber: number; trialDays: number; seats: number; storageGb: number; modules: string[]; price: string; currency: string; cycle: "trial" };
};

/** Read-only: what the invitee is about to accept (the invitation's own fields and its immutable Trial terms). */
export async function previewInvitationForAcceptance(ctx: AcceptanceContext, token: unknown): Promise<InvitationPreview> {
  const { row, terms: t } = await resolveUsable(ctx, token);
  return {
    reference: invitationReference(row.id),
    companyName: row.companyName,
    ownerName: row.ownerName,
    ownerEmail: row.ownerEmail,
    countryName: row.countryName,
    currencyCode: row.currencyCode,
    expiresAt: row.expiresAt.toISOString(),
    expiresAtText: { en: formatPlatformDateTime(row.expiresAt, "en"), ar: formatPlatformDateTime(row.expiresAt, "ar") },
    trial: { packageName: t.packageName, versionNumber: t.versionNumber, trialDays: t.trialDays, seats: t.seats, storageGb: t.storageGb, modules: t.modules, price: t.price, currency: t.currency, cycle: "trial" },
  };
}

// ---- acceptance ----------------------------------------------------------------------------------

export type AcceptanceFacts = {
  companyName: string;
  industry: string | null;
  companyEmail: string;
  countryName: string;
  currencyCode: string;
  ownerName: string;
  ownerEmail: string;
};
export type AcceptanceEvidenceFacts = AcceptanceFacts & { orgId: number; userId: number; reference: string; packageCode: string; versionNumber: number; startDate: string; endDate: string };
export type AcceptanceHooks = {
  /** Organization + owner + defaults (src/lib/org-bootstrap.ts), inside THIS transaction. */
  bootstrap: (tx: Tx, facts: AcceptanceFacts) => Promise<{ orgId: number; userId: number }>;
  /** The customer audit and security records, inside THIS transaction. */
  evidence: (tx: Tx, facts: AcceptanceEvidenceFacts) => Promise<void>;
};
export type AcceptanceResult = { reference: string; ownerEmail: string; startDate: string; endDate: string; startDateText: Record<Locale, string>; endDateText: Record<Locale, string> };

/** The SQLSTATE (and constraint) of a database error, also when wrapped. */
function pgError(err: unknown): { code: string; constraint: string } | null {
  for (let e: unknown = err, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return { code, constraint: String((e as { constraint?: unknown }).constraint ?? "") };
  }
  return null;
}

/** Client-caused refusals count against the throttle; failures of the system never lock an invitee out. */
const COUNTED: ReadonlySet<string> = new Set(["expired", "used", "revoked", "changed", "email_conflict"]);

export async function acceptInvitation(ctx: AcceptanceContext, input: { token: unknown; ownerName: string }, hooks: AcceptanceHooks): Promise<AcceptanceResult> {
  const pre = await resolveUsable(ctx, input.token);
  let stage = "failed";
  try {
    const result = await db.transaction(
      async (tx) => {
        await lockInvitationEmail(tx, pre.row.ownerEmail);
        const [current] = await tx.select(INVITATION_COLUMNS).from(inv).where(eq(inv.id, pre.row.id)).for("update");
        // The decision time is taken AFTER the locks: an invitation that expired while this request waited is expired.
        const now = platformClock.now();
        if (!current || current.tokenHash !== pre.tokenHash) throw new AcceptanceRefusal("invalid", "changed");
        const state = invitationState(current, now);
        if (state === "accepted") throw new AcceptanceRefusal("used", "used");
        if (state === "revoked") throw new AcceptanceRefusal("invalid", "revoked");
        if (state === "expired") throw new AcceptanceRefusal("expired", "expired");
        const t = await loadTerms(tx, current.id);
        if (!t) throw new AcceptanceRefusal("unavailable", "terms");
        // I-7 / A-7: any customer user with this e-mail in ANY letter case refuses the acceptance (neutral message);
        // a user committed after this check is caught by users_email_unique at the owner insert (23505 below).
        if (await customerEmailInUse(tx, current.ownerEmail)) throw new AcceptanceRefusal("unavailable", "email_conflict");

        const facts: AcceptanceFacts = {
          companyName: current.companyName,
          industry: current.industry,
          companyEmail: current.companyEmail,
          countryName: current.countryName,
          currencyCode: current.currencyCode,
          ownerName: input.ownerName,
          ownerEmail: current.ownerEmail,
        };
        stage = "bootstrap";
        const ids = await hooks.bootstrap(tx, facts);
        stage = "access";
        await tx.insert(tenantAccessControlsTable).values({ orgId: ids.orgId, accessStatus: "active", createdAt: now, updatedAt: now });
        stage = "primary_owner";
        await tx.insert(tenantPrimaryOwnersTable).values({ userId: ids.userId, orgId: ids.orgId, assignedAt: now });
        // A-5: the Trial starts on the acceptance business day in Asia/Riyadh; its end date is inclusive.
        const startDate = riyadhBusinessDate(now);
        const endDate = addDays(startDate, t.trialDays - 1);
        stage = "subscription";
        const [subscription] = await tx
          .insert(tenantSubscriptionsTable)
          .values({
            orgId: ids.orgId,
            packageVersionId: t.versionId,
            versionState: "published",
            isTrial: true,
            cycle: "trial",
            lifecycleState: "trialing",
            startDate,
            endDate,
            priceSnapshotSar: t.price,
            seatsSnapshot: t.seats,
            storageSnapshotGb: t.storageGb,
            moduleGroupsSnapshot: t.modules,
            assignmentSource: "invitation_acceptance",
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: tenantSubscriptionsTable.id });
        const reference = invitationReference(current.id);
        stage = "subscription_event";
        await tx.insert(subscriptionEventsTable).values({
          tenantSubscriptionId: subscription.id,
          orgId: ids.orgId,
          eventType: "assigned",
          actorLabel: ACTOR,
          afterSafe: {
            reference,
            packageCode: t.packageCode,
            versionNumber: t.versionNumber,
            cycle: "trial",
            startDate,
            endDate,
            seats: t.seats,
            storageGb: t.storageGb,
            moduleGroups: t.modules.length,
          },
          requestId: ctx.requestId,
          createdAt: now,
        });
        stage = "accepted";
        const marked = await tx
          .update(inv)
          .set({ acceptedAt: now, acceptedOrgId: ids.orgId, updatedAt: now })
          .where(and(eq(inv.id, current.id), isNull(inv.acceptedAt), isNull(inv.revokedAt)))
          .returning({ id: inv.id });
        if (marked.length !== 1) throw new AcceptanceRefusal("used", "changed");
        stage = "audit";
        await recordPlatformAudit(
          {
            actorLabel: ACTOR,
            action: "invitation.accepted",
            entityType: INVITATION_ENTITY,
            entityId: current.id,
            orgId: ids.orgId,
            after: {
              reference,
              companyName: current.companyName,
              ownerEmail: current.ownerEmail,
              orgId: ids.orgId,
              userId: ids.userId,
              packageCode: t.packageCode,
              versionNumber: t.versionNumber,
              cycle: "trial",
              startDate,
              endDate,
            },
            result: "success",
            requestId: ctx.requestId,
            ipAddress: ctx.ip,
            userAgent: ctx.userAgent,
          },
          tx,
        );
        stage = "evidence";
        await hooks.evidence(tx, { ...facts, orgId: ids.orgId, userId: ids.userId, reference, packageCode: t.packageCode, versionNumber: t.versionNumber, startDate, endDate });
        return { reference, ownerEmail: current.ownerEmail, startDate, endDate, decidedAt: now };
      },
      { isolationLevel: "read committed" },
    );
    await recordAcceptanceAttempt(pre.keys, "success", result.decidedAt).catch(() => undefined);
    // A business date is a Riyadh calendar day: formatted at Riyadh noon, it reads as that day in Riyadh time.
    const day = (iso: string, l: Locale) => formatPlatformDate(new Date(`${iso}T12:00:00+03:00`), l);
    const startText = { en: day(result.startDate, "en"), ar: day(result.startDate, "ar") };
    const endText = { en: day(result.endDate, "en"), ar: day(result.endDate, "ar") };
    return { reference: result.reference, ownerEmail: result.ownerEmail, startDate: result.startDate, endDate: result.endDate, startDateText: startText, endDateText: endText };
  } catch (err) {
    let refusal: AcceptanceRefusal;
    if (err instanceof AcceptanceRefusal) refusal = err;
    else {
      const pg = pgError(err);
      if (pg?.code === "23505" && /users_email/.test(pg.constraint)) refusal = new AcceptanceRefusal("unavailable", "email_conflict");
      else if (pg?.code === "23505" && /organization_invitations/.test(pg.constraint)) refusal = new AcceptanceRefusal("used", "changed");
      else {
        if (isPlatformError(err) && err.code === "AUDIT_UNAVAILABLE") {
          stage = "audit";
          reportSecurityIncident({ type: "audit_write_failed", action: "invitation.accepted", requestId: ctx.requestId, ipAddress: ctx.ip, error: errorClass(err) });
        } else {
          // The class only (a PlatformError code, a SQLSTATE or a constructor name) — never a message or a value.
          console.error(`[invitation-acceptance] not completed at ${stage} (${errorClass(err)}); nothing was applied`);
        }
        refusal = new AcceptanceRefusal("unavailable", stage);
      }
    }
    if (COUNTED.has(refusal.stage)) await recordAcceptanceAttempt(pre.keys, "failure", platformClock.now()).catch(() => undefined);
    await auditRejection(ctx, pre.row.id, refusal.stage);
    throw refusal;
  }
}
