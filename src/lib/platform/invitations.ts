import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import {
  db,
  organizationInvitationsTable,
  organizationInvitationTermsTable,
  orgsTable,
  platformAdminsTable,
  platformAuditEventsTable,
  subscriptionPackagesTable,
  subscriptionPackageVersionsTable,
  usersTable,
  type Tx,
} from "@/db";
import { isValidCurrencyCode } from "@/lib/currency/currencies";
import { COUNTRIES } from "@/lib/geo/countries";
import { assertPlatformAuditProtection, recordPlatformAudit } from "./audit";
import { platformClock } from "./clock";
import { escapeLikePattern, invitationReference } from "./companies";
import { requestMeta, type ConsoleRequest } from "./console";
import { isPlatformError, PlatformError } from "./errors";
import { assertPlatformInvitationsEnabled } from "./flags";
import { authorizePlatformToken } from "./guards";
import { errorClass, reportSecurityIncident } from "./incident";
import type { PlatformSessionContext } from "./session";

// ---------------------------------------------------------------------------------------------
// Platform Owner PO-02D2 — company invitation administration: the shared rules and the read models.
// The mutations (create / revoke / re-issue) are in invitation-actions.ts; both run only behind
//   PLATFORM_CONSOLE_ENABLED and PLATFORM_INVITATIONS_ENABLED, each exactly "true" (flags.ts).
//
// PROVISIONAL development policies (PO-02D0 decisions; owner approval REQUIRED before production):
//   I-2 permission platform.companies.invite · I-3 step-up (create / re-issue: password + fresh TOTP;
//   revoke: fresh TOTP + reason) · I-4 72-hour expiry · I-5 one pending invitation per owner e-mail
//   (an expired holder is revoked, attributed and audited, when its slot is reused) · I-6 20 creates or
//   re-issues per operator per hour (counted in the database) · I-7 lower(btrim()) e-mails, refused when
//   ANY customer user has the e-mail in any letter case · I-8 copy-link delivery only · I-9 the link's
//   origin is CUSTOMER_PUBLIC_ORIGIN, never a request header · I-10 a company-name collision needs the
//   operator's explicit confirmation · I-11 INV- + 8 hex is a display reference only · R-5 default OFF
//   · P-5 the published default Trial version only, cycle `trial`.
//
// Token material: a 256-bit random token (crypto.randomBytes(32), base64url) exists only in memory, in
// the creating response. The database holds sha256(token) (64 hex, organization_invitations.token_hash);
// no read model here selects that column, and nothing logs, audits or caches the token or the link.
// The acceptance endpoint (/register/accept) does NOT exist in this phase (PO-02D3): a link created here
// is development evidence and cannot onboard anyone.
// ---------------------------------------------------------------------------------------------

/** I-4 (provisional): the invitation lifetime, written explicitly from the platform clock. */
export const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;
/** I-6 (provisional): creates + re-issues per operator in a rolling hour, counted from committed rows. */
export const INVITATION_RATE_LIMIT = { windowMs: 60 * 60 * 1000, max: 20 } as const;
export const INVITATION_LIMITS = { companyName: 200, industry: 100, ownerName: 200, email: 320, reasonMin: 10, reasonMax: 500 } as const;
export const INVITATION_LIFECYCLE_STATES = ["pending", "expired", "revoked", "accepted"] as const;
export type InvitationLifecycleState = (typeof INVITATION_LIFECYCLE_STATES)[number];
/** The audit entity type of every invitation record. */
export const INVITATION_ENTITY = "organization_invitation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// C0 / C1 controls and the bidirectional embedding / override / isolate controls (they could disguise
// a name in the console or the audit trail). Ordinary Arabic text and the RLM / LRM marks are allowed.
const DISALLOWED_TEXT = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
// The PO-02A CHECK shape (one @, a dot in the domain, no white space), printable ASCII only — so the
// JavaScript lower-casing here and PostgreSQL's lower() in the CHECK can never disagree.
const EMAIL = /^[\x21-\x7e]+$/;
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const COUNTRY_NAMES: ReadonlySet<string> = new Set(COUNTRIES.map((c) => c.name));

const invalid = (detail: string) => new PlatformError("VALIDATION_FAILED", detail);

// ---- configuration: the canonical customer origin (I-9) ---------------------------------------

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * The customer-facing origin every invitation link uses — from configuration ONLY, never from Host,
 * X-Forwarded-Host or Origin. Exactly an origin (scheme, host, optional port; no path, query, fragment
 * or credentials), https. Plain http is accepted only for a loopback host AND only when
 * PLATFORM_INVITATIONS_LOOPBACK_ORIGIN is exactly "true" (an explicit approval for local tests; it can
 * never allow a non-loopback http origin). Anything else is CONFIG_ERROR, and nothing is created.
 */
export function customerPublicOrigin(): string {
  const raw = process.env.CUSTOMER_PUBLIC_ORIGIN;
  if (!raw) throw new PlatformError("CONFIG_ERROR", "CUSTOMER_PUBLIC_ORIGIN is not set");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PlatformError("CONFIG_ERROR", "CUSTOMER_PUBLIC_ORIGIN is not a URL");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || (raw !== url.origin && raw !== `${url.origin}/`)) {
    throw new PlatformError("CONFIG_ERROR", "CUSTOMER_PUBLIC_ORIGIN must be exactly an origin (no path, query, fragment or credentials)");
  }
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname) && process.env.PLATFORM_INVITATIONS_LOOPBACK_ORIGIN === "true") return url.origin;
  throw new PlatformError("CONFIG_ERROR", "CUSTOMER_PUBLIC_ORIGIN must be an https origin");
}

// ---- token and link ---------------------------------------------------------------------------

/** A fresh 256-bit token and its stored digest. The token is returned to the caller once and never stored. */
export function newInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: invitationTokenHash(token) };
}

/** sha256(token) as 64 lower-case hex — the only form the database ever holds (PO-02A token_hash CHECK). */
export function invitationTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** The one-time link: the token travels in the FRAGMENT, which browsers never send to a server. */
export function invitationLink(origin: string, token: string): string {
  return `${origin}/register/accept#t=${token}`;
}

// ---- validation -------------------------------------------------------------------------------

/** lower(btrim()) of a printable-ASCII address with the PO-02A shape, ≤ 320 characters; null otherwise. */
export function normalizeInvitationEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > INVITATION_LIMITS.email || !EMAIL.test(email) || !EMAIL_SHAPE.test(email)) return null;
  return email;
}

/** White-space runs become one space, then trimmed; refused with control or direction-override characters. */
function cleanText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (DISALLOWED_TEXT.test(text) || text.length < min || text.length > max) return null;
  return text;
}

/** The revocation reason (I-3): 10–500 characters, the same rule as a company-access reason. */
export function normalizeInvitationReason(value: unknown): string | null {
  return cleanText(value, INVITATION_LIMITS.reasonMin, INVITATION_LIMITS.reasonMax);
}

export type InvitationFields = {
  companyName: string;
  industry: string | null;
  companyEmail: string;
  country: string;
  currency: string;
  ownerName: string;
  ownerEmail: string;
};
export type InvitationFieldsInput = { [K in keyof InvitationFields]?: unknown };

/**
 * Every field against the ERP's own catalogues, as /register validates them (COUNTRIES by name,
 * isValidCurrencyCode). Throws VALIDATION_FAILED naming the field; the database CHECKs are the backstop.
 */
export function parseInvitationFields(input: InvitationFieldsInput): InvitationFields {
  const companyName = cleanText(input.companyName, 1, INVITATION_LIMITS.companyName);
  if (companyName === null) throw invalid("companyName");
  let industry: string | null = null;
  if (input.industry !== undefined && input.industry !== null && !(typeof input.industry === "string" && input.industry.trim() === "")) {
    industry = cleanText(input.industry, 1, INVITATION_LIMITS.industry);
    if (industry === null) throw invalid("industry");
  }
  const companyEmail = normalizeInvitationEmail(input.companyEmail);
  if (companyEmail === null) throw invalid("companyEmail");
  const country = typeof input.country === "string" ? input.country.trim() : "";
  if (!COUNTRY_NAMES.has(country)) throw invalid("country");
  const currency = typeof input.currency === "string" ? input.currency.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(currency) || !isValidCurrencyCode(currency)) throw invalid("currency");
  const ownerName = cleanText(input.ownerName, 1, INVITATION_LIMITS.ownerName);
  if (ownerName === null) throw invalid("ownerName");
  const ownerEmail = normalizeInvitationEmail(input.ownerEmail);
  if (ownerEmail === null) throw invalid("ownerEmail");
  return { companyName, industry, companyEmail, country, currency, ownerName, ownerEmail };
}

export function parseInvitationId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw invalid("invitation id");
  return value;
}

// ---- shared database rules ----------------------------------------------------------------------

const inv = organizationInvitationsTable;
const terms = organizationInvitationTermsTable;

/** The derived lifecycle state (expiry is time, not a column). Accepted and revoked are terminal. */
export function invitationState(row: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now: Date): InvitationLifecycleState {
  if (row.acceptedAt) return "accepted";
  if (row.revokedAt) return "revoked";
  return row.expiresAt.getTime() > now.getTime() ? "pending" : "expired";
}

export type DefaultTrialTerms = { versionId: string; packageCode: string; packageName: string; versionNumber: number; trialDays: number; includedSeats: number; storageGb: number; monthlyPrice: string; currency: string };

/** P-5: the newest PUBLISHED version of the active default Trial package, or null when none exists. */
export async function publishedDefaultTrial(executor: Tx | typeof db = db): Promise<DefaultTrialTerms | null> {
  const p = subscriptionPackagesTable;
  const v = subscriptionPackageVersionsTable;
  const [row] = await executor
    .select({
      versionId: v.id,
      packageCode: p.code,
      packageName: p.name,
      versionNumber: v.versionNumber,
      trialDays: v.trialDays,
      includedSeats: v.includedSeats,
      storageGb: v.storageAllowanceGb,
      monthlyPrice: v.monthlyPrice,
      currency: v.currencyCode,
    })
    .from(p)
    .innerJoin(v, and(eq(v.packageId, p.id), eq(v.isTrial, true), eq(v.publishState, "published")))
    .where(and(eq(p.isDefaultTrial, true), eq(p.isTrial, true), eq(p.status, "active")))
    .orderBy(desc(v.versionNumber))
    .limit(1);
  return row ?? null;
}

/**
 * Serializes every change for one owner e-mail: a transaction-scoped advisory lock, taken after the
 * operator's row lock (the TOTP step) and before any invitation row lock. Lock order of every PO-02D2
 * transaction: platform_admins row (TOTP compare-and-set) → this e-mail lock → organization_invitations
 * row(s) FOR UPDATE → inserts (their foreign keys take KEY SHARE on the version and operator rows).
 */
export async function lockInvitationEmail(tx: Tx, ownerEmail: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`platform-invitation-email:${ownerEmail}`}, 0))`);
}

/**
 * Customer users holding this e-mail in ANY letter case (I-7) — users.email only (no other user column is read).
 * users has no case-insensitive unique key, so this is application-level: a sequential scan, and a registration that
 * commits after it is not seen (documented; PO-02D3 must re-check in its own transaction).
 */
export async function customerEmailInUse(executor: Tx | typeof db, ownerEmail: string): Promise<boolean> {
  const rows = await executor.select({ found: sql<number>`1` }).from(usersTable).where(sql`lower(${usersTable.email}) = ${ownerEmail}`).limit(1);
  return rows.length > 0;
}

/** I-10: registered companies (orgs.name only) and slot-holding invitations with the same name, case- and space-insensitive. */
export async function companyNameMatches(executor: Tx | typeof db, companyName: string, exceptInvitationId?: string): Promise<{ organizations: number; invitations: number }> {
  const key = companyName.toLowerCase();
  const [orgs] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(orgsTable)
    .where(sql`lower(regexp_replace(btrim(${orgsTable.name}), '\\s+', ' ', 'g')) = ${key}`);
  const [invs] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(inv)
    .where(and(sql`lower(${inv.companyName}) = ${key}`, isNull(inv.acceptedAt), isNull(inv.revokedAt), exceptInvitationId ? ne(inv.id, exceptInvitationId) : undefined));
  return { organizations: orgs?.n ?? 0, invitations: invs?.n ?? 0 };
}

/** I-6: invitations this operator created (creates and re-issues alike) in the rolling window ending now. */
export async function recentInvitationsBy(executor: Tx | typeof db, adminId: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - INVITATION_RATE_LIMIT.windowMs);
  const [row] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(inv)
    .where(and(eq(inv.invitedByPlatformAdminId, adminId), sql`${inv.createdAt} > ${since.toISOString()}::timestamptz`));
  return row?.n ?? 0;
}

// ---- read models (history) ---------------------------------------------------------------------

/** flags → configuration → live platform session → platform.companies.read (reads never need the invite permission). */
async function authorizeInvitationRead(req: ConsoleRequest): Promise<PlatformSessionContext> {
  assertPlatformInvitationsEnabled();
  return authorizePlatformToken(req.token, "platform.companies.read");
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isPlatformError(err)) throw err;
    console.error(`[platform-invitations] internal failure: ${errorClass(err)}`);
    throw new PlatformError("CONFIG_ERROR", "invitation read failed");
  }
}

export const INVITATION_HISTORY_PAGE_SIZE = 25;
const SEARCH_MAX = 100;
const INV_REF = /^inv-?([0-9a-f]{8})$/i;

export type InvitationHistoryRow = {
  id: string;
  reference: string;
  companyName: string;
  ownerEmail: string;
  country: string;
  state: InvitationLifecycleState;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  acceptedAt: Date | null;
};
export type InvitationHistoryPage = { state: InvitationLifecycleState | null; q: string | null; rows: InvitationHistoryRow[]; total: number; offset: number; next: string | null };

function stateFilter(state: InvitationLifecycleState, now: Date): SQL {
  const at = sql`${now.toISOString()}::timestamptz`;
  if (state === "accepted") return isNotNull(inv.acceptedAt);
  if (state === "revoked") return and(isNull(inv.acceptedAt), isNotNull(inv.revokedAt))!;
  if (state === "pending") return and(isNull(inv.acceptedAt), isNull(inv.revokedAt), sql`${inv.expiresAt} > ${at}`)!;
  return and(isNull(inv.acceptedAt), isNull(inv.revokedAt), sql`${inv.expiresAt} <= ${at}`)!;
}

/**
 * Every invitation (pending, expired, revoked, accepted), newest first, 25 per page, keyset-paginated
 * on (created_at, id). Search: company name or owner e-mail (LIKE wildcards escaped) or an INV
 * reference. Allow-listed columns only — never the token hash.
 */
export async function listInvitationHistory(req: ConsoleRequest, input: { state?: unknown; q?: unknown; after?: unknown } = {}): Promise<InvitationHistoryPage> {
  await authorizeInvitationRead(req);
  const state = input.state === undefined || input.state === "" ? null : (INVITATION_LIFECYCLE_STATES as readonly unknown[]).includes(input.state) ? (input.state as InvitationLifecycleState) : null;
  if (input.state !== undefined && input.state !== "" && state === null) throw invalid("state");
  let q: string | null = null;
  if (typeof input.q === "string" && input.q.trim()) {
    q = input.q.trim();
    if (q.length > SEARCH_MAX || DISALLOWED_TEXT.test(q)) throw invalid("q");
  } else if (input.q !== undefined && typeof input.q !== "string") throw invalid("q");
  const after = input.after === undefined || input.after === "" ? null : parseInvitationId(input.after);
  return guarded(async () => {
    const now = platformClock.now();
    const filters: SQL[] = [];
    if (state) filters.push(stateFilter(state, now));
    if (q) {
      const pattern = `%${escapeLikePattern(q)}%`;
      const conditions: SQL[] = [sql`${inv.companyName} ilike ${pattern} escape '\\'`, sql`${inv.ownerEmailNormalized} ilike ${pattern} escape '\\'`];
      const ref = INV_REF.exec(q);
      if (ref) {
        const hex = ref[1].toLowerCase();
        conditions.push(sql`${inv.id} between ${`${hex}-0000-0000-0000-000000000000`}::uuid and ${`${hex}-ffff-ffff-ffff-ffffffffffff`}::uuid`);
      }
      filters.push(or(...conditions)!);
    }
    const position: SQL[] = [];
    if (after) {
      const [exists] = await db.select({ id: inv.id }).from(inv).where(eq(inv.id, after));
      if (!exists) throw invalid("the page cursor points at no invitation");
      position.push(sql`(${inv.createdAt}, ${inv.id}) < (select ${inv.createdAt}, ${inv.id} from ${inv} where ${inv.id} = ${after}::uuid)`);
    }
    const where = (extra: SQL[]) => (filters.length + extra.length ? and(...filters, ...extra) : undefined);
    const [counted, rows] = await Promise.all([
      db.select({ total: sql<number>`count(*)::int` }).from(inv).where(where([])),
      db
        .select({ id: inv.id, companyName: inv.companyName, ownerEmail: inv.ownerEmailNormalized, country: inv.countryName, createdAt: inv.createdAt, expiresAt: inv.expiresAt, revokedAt: inv.revokedAt, acceptedAt: inv.acceptedAt })
        .from(inv)
        .where(where(position))
        .orderBy(desc(inv.createdAt), desc(inv.id))
        .limit(INVITATION_HISTORY_PAGE_SIZE + 1),
    ]);
    const more = rows.length > INVITATION_HISTORY_PAGE_SIZE;
    const page = rows.slice(0, INVITATION_HISTORY_PAGE_SIZE);
    let offset = 0;
    if (after && page.length) {
      const key = sql`(select ${inv.createdAt}, ${inv.id} from ${inv} where ${inv.id} = ${page[0].id}::uuid)`;
      const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(inv).where(where([sql`(${inv.createdAt}, ${inv.id}) > ${key}`]));
      offset = r?.n ?? 0;
    }
    return {
      state,
      q,
      rows: page.map((r) => ({ ...r, reference: invitationReference(r.id), state: invitationState(r, now) })),
      total: counted[0]?.total ?? 0,
      offset,
      next: more ? page[page.length - 1].id : null,
    };
  });
}

export type InvitationEvent = { action: string; result: string; at: Date; actor: string; reason: string | null; replaces: string | null; replacedBy: string | null; stage: string | null };
export type InvitationDetail = {
  id: string;
  reference: string;
  state: InvitationLifecycleState;
  companyName: string;
  industry: string | null;
  companyEmail: string;
  country: string;
  currency: string;
  ownerName: string;
  ownerEmail: string;
  createdAt: Date;
  expiresAt: Date;
  invitedBy: string | null;
  revokedAt: Date | null;
  revokedBy: string | null;
  acceptedAt: Date | null;
  terms: { packageCode: string; packageName: string; versionNumber: number; cycle: string; trialDays: number; includedSeats: number; storageGb: number } | null;
  events: InvitationEvent[];
};

const EVENT_ACTIONS = ["invitation.created", "invitation.reissued", "invitation.revoked", "invitation.revoke.rejected", "invitation.reissue.rejected"] as const;
const REF = /^INV-[0-9A-F]{8}$/;
const refOrNull = (value: unknown) => (typeof value === "string" && REF.test(value) ? value : null);
const stageOrNull = (value: unknown) => (typeof value === "string" && /^[a-z_]{1,40}$/.test(value) ? value : null);

/**
 * One invitation's allow-listed details, its offered terms and its lifecycle events (from the
 * append-only audit trail: created, re-issued, revoked — with reasons and the re-issue links). Audited
 * ("invitation.viewed") under the PO-01B.1 policy: the trail must be protected and the record written,
 * or nothing is returned. Never selects the token hash.
 */
export async function getInvitationHistory(req: ConsoleRequest, rawId: unknown): Promise<InvitationDetail> {
  const ctx = await authorizeInvitationRead(req);
  const id = parseInvitationId(rawId);
  const meta = requestMeta(req.headers);
  await assertPlatformAuditProtection();
  const detail = await guarded(async () => {
    const now = platformClock.now();
    const invitedBy = sql<string | null>`(select ${platformAdminsTable.displayName} from ${platformAdminsTable} where ${platformAdminsTable.id} = ${inv.invitedByPlatformAdminId})`;
    const revokedBy = sql<string | null>`(select ${platformAdminsTable.displayName} from ${platformAdminsTable} where ${platformAdminsTable.id} = ${inv.revokedByPlatformAdminId})`;
    const [row] = await db
      .select({
        id: inv.id,
        companyName: inv.companyName,
        industry: inv.industry,
        companyEmail: inv.companyEmail,
        country: inv.countryName,
        currency: inv.currencyCode,
        ownerName: inv.ownerName,
        ownerEmail: inv.ownerEmailNormalized,
        createdAt: inv.createdAt,
        expiresAt: inv.expiresAt,
        revokedAt: inv.revokedAt,
        acceptedAt: inv.acceptedAt,
        invitedBy,
        revokedBy,
        packageCode: subscriptionPackagesTable.code,
        packageName: subscriptionPackagesTable.name,
        versionNumber: subscriptionPackageVersionsTable.versionNumber,
        cycle: terms.initialCycle,
        trialDays: subscriptionPackageVersionsTable.trialDays,
        includedSeats: subscriptionPackageVersionsTable.includedSeats,
        storageGb: subscriptionPackageVersionsTable.storageAllowanceGb,
      })
      .from(inv)
      .leftJoin(terms, eq(terms.invitationId, inv.id))
      .leftJoin(subscriptionPackageVersionsTable, eq(subscriptionPackageVersionsTable.id, terms.initialPackageVersionId))
      .leftJoin(subscriptionPackagesTable, eq(subscriptionPackagesTable.id, subscriptionPackageVersionsTable.packageId))
      .where(eq(inv.id, id))
      .limit(1);
    if (!row) throw new PlatformError("NOT_FOUND", "no invitation with this id");
    const a = platformAuditEventsTable;
    const events = await db
      .select({ action: a.action, result: a.result, at: a.createdAt, actor: a.actorLabel, reason: a.reason, after: a.afterSafe })
      .from(a)
      .where(and(eq(a.entityType, INVITATION_ENTITY), eq(a.entityId, id), inArray(a.action, [...EVENT_ACTIONS])))
      .orderBy(a.createdAt, a.id)
      .limit(100);
    return {
      id: row.id,
      reference: invitationReference(row.id),
      state: invitationState(row, now),
      companyName: row.companyName,
      industry: row.industry,
      companyEmail: row.companyEmail,
      country: row.country,
      currency: row.currency,
      ownerName: row.ownerName,
      ownerEmail: row.ownerEmail,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      invitedBy: row.invitedBy,
      revokedAt: row.revokedAt,
      revokedBy: row.revokedBy,
      acceptedAt: row.acceptedAt,
      terms:
        row.packageCode && row.versionNumber !== null && row.cycle
          ? { packageCode: row.packageCode, packageName: row.packageName ?? row.packageCode, versionNumber: row.versionNumber, cycle: row.cycle, trialDays: row.trialDays ?? 0, includedSeats: row.includedSeats ?? 0, storageGb: row.storageGb ?? 0 }
          : null,
      events: events.map((e) => {
        const after = (e.after ?? {}) as Record<string, unknown>;
        return { action: e.action, result: e.result, at: e.at, actor: e.actor, reason: e.reason, replaces: refOrNull(after.replaces), replacedBy: refOrNull(after.replacedBy), stage: stageOrNull(after.stage) };
      }),
    };
  });
  try {
    await recordPlatformAudit({ actorAdminId: ctx.adminId, actorLabel: ctx.displayName, action: "invitation.viewed", entityType: INVITATION_ENTITY, entityId: id, result: "success", ...meta });
  } catch (err) {
    if (isPlatformError(err, "AUDIT_UNAVAILABLE")) reportSecurityIncident({ type: "audit_write_failed", action: "invitation.viewed", error: errorClass(err) });
    throw err;
  }
  return detail;
}
