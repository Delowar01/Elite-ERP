import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { db, organizationInvitationsTable, orgsTable, platformAdminsTable, platformAuditEventsTable, type Tx } from "@/db";
import { userInvitationsTable } from "@/db/staged/platform-user-invitations";
import { assertPlatformAuditProtection, recordPlatformAudit } from "./audit";
import { platformClock } from "./clock";
import { escapeLikePattern, invitationReference, orgReference } from "./companies";
import { requestMeta, type ConsoleRequest } from "./console";
import { isPlatformError, PlatformError } from "./errors";
import { assertPlatformUserInvitationsEnabled } from "./flags";
import { authorizePlatformToken } from "./guards";
import { errorClass, reportSecurityIncident } from "./incident";
import { INVITATION_LIFECYCLE_STATES, INVITATION_RATE_LIMIT, INVITATION_TTL_MS, invitationState, normalizeInvitationEmail, type InvitationLifecycleState } from "./invitations";
import type { PlatformSessionContext } from "./session";

// ---------------------------------------------------------------------------------------------
// Platform Owner PO-03C (sub-batch C) — customer-user invitations: the shared rules and the READ model. An invitation
// asks a NEW person to join an EXISTING company as admin or staff (never owner). It is copy-link only: nothing is
// sent (no e-mail, SMS or WhatsApp), and nothing accepts it yet — acceptance, and seat enforcement with it, is PO-04.
//
//  • The table is STAGED (src/db/staged/platform-user-invitations.ts; drizzle/platform/PO03C_user_invitations.sql,
//    outside the platform SQL chain): every read and write first asks the catalog whether it exists and fails closed
//    (USER_INVITATIONS_NOT_INSTALLED) when it does not.
//  • Reads: flag (PLATFORM_CONSOLE_ENABLED and PLATFORM_USER_INVITATIONS_ENABLED, each exactly "true") → live platform
//    session → platform.users.read. The writes are user-invitation-actions.ts (platform.users.invite).
//  • Only allow-listed columns are ever selected — never the token hash. The token itself is never stored.
//  • One open invitation per normalized e-mail, platform-wide (customer e-mails are globally unique): the partial
//    unique index; an e-mail that already belongs to ANY customer user (any letter case), or that a pending COMPANY
//    invitation holds, is refused by the writes.
// ---------------------------------------------------------------------------------------------

export const USER_INVITATION_ENTITY = "user_invitation";
/** Schema.md §5.2: 72 hours, as the company invitations (the table caps any window at 30 days). */
export const USER_INVITATION_TTL_MS = INVITATION_TTL_MS;
/** Per operator, creates and re-issues of USER invitations in a rolling hour (company invitations count separately). */
export const USER_INVITATION_RATE_LIMIT = INVITATION_RATE_LIMIT;
export const USER_INVITATION_LIMITS = { name: 200, email: 320, reasonMin: 10, reasonMax: 500 } as const;
/** Never "owner": a user invitation adds an admin or a staff member; owners come from registration, a role change or a transfer. */
export const USER_INVITATION_ROLES = ["admin", "staff"] as const;
export type UserInvitationRole = (typeof USER_INVITATION_ROLES)[number];
export type UserInvitationState = InvitationLifecycleState;
export const USER_INVITATION_STATES = INVITATION_LIFECYCLE_STATES;
export const USER_INVITATION_PAGE_SIZE = 25;

const uinv = userInvitationsTable;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// The PO-02D2 text rule: C0 / C1 controls and the bidirectional embedding / override / isolate controls are refused.
const DISALLOWED_TEXT = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/;
const SEARCH_MAX = 100;
const UIN_REF = /^uin-?([0-9a-f]{8})$/i;
const invalid = (detail: string) => new PlatformError("VALIDATION_FAILED", detail);

/** UIN-XXXXXXXX: the console's reference for one user invitation (never the token). */
export function userInvitationReference(invitationId: string): string {
  return `UIN-${invitationId.slice(0, 8).toUpperCase()}`;
}

/**
 * The one-time link. The token travels in the FRAGMENT, which browsers never send to a server. The path is NOT served
 * by this build: user-invitation acceptance is PO-04, so the link is only ever copied, never usable yet.
 */
export function userInvitationLink(origin: string, token: string): string {
  return `${origin}/join/accept#t=${token}`;
}

export function parseUserInvitationId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new PlatformError("NOT_FOUND", "no user invitation with this id");
  return value;
}

/** A company id from the form or URL: a canonical positive decimal; anything else is NOT_FOUND (one answer). */
export function parseInvitationCompanyId(value: unknown): number {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !/^[1-9][0-9]{0,9}$/.test(text)) throw new PlatformError("NOT_FOUND", "no company with this id");
  const id = Number(text);
  if (!Number.isSafeInteger(id) || id > 2_147_483_647) throw new PlatformError("NOT_FOUND", "no company with this id");
  return id;
}

/** White-space runs become one space, then trimmed; refused with control or direction-override characters. */
function cleanText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (DISALLOWED_TEXT.test(text) || text.length < min || text.length > max) return null;
  return text;
}

/** The revocation reason: 10–500 characters, the same rule as every Platform Owner reason. */
export function normalizeUserInvitationReason(value: unknown): string | null {
  return cleanText(value, USER_INVITATION_LIMITS.reasonMin, USER_INVITATION_LIMITS.reasonMax);
}

export type UserInvitationFields = { orgId: number; name: string; email: string; role: UserInvitationRole };
export type UserInvitationFieldsInput = { orgId?: unknown; name?: unknown; email?: unknown; role?: unknown };

/** Request format only (no database): a malformed request spends nothing. */
export function parseUserInvitationFields(input: UserInvitationFieldsInput): UserInvitationFields {
  const orgId = parseInvitationCompanyId(input.orgId);
  const name = cleanText(input.name, 1, USER_INVITATION_LIMITS.name);
  if (name === null) throw invalid(`name must be 1–${USER_INVITATION_LIMITS.name} characters without control characters`);
  const email = normalizeInvitationEmail(input.email);
  if (email === null) throw invalid("a valid e-mail address is required");
  if (typeof input.role !== "string" || !(USER_INVITATION_ROLES as readonly string[]).includes(input.role)) throw invalid("role must be admin or staff");
  return { orgId, name, email, role: input.role as UserInvitationRole };
}

/** The derived lifecycle state (expiry is time, not a column): the company-invitation rule. */
export function userInvitationState(row: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now: Date): UserInvitationState {
  return invitationState(row, now);
}

/** Whether the staged table exists in this database (the catalog's answer; a failing probe propagates). */
export async function userInvitationsInstalled(executor: Tx | typeof db = db): Promise<boolean> {
  const result = await executor.execute(sql`select to_regclass('user_invitations') is not null as present`);
  const present = (result.rows[0] as { present?: unknown } | undefined)?.present;
  if (typeof present !== "boolean") throw new Error("user_invitations probe returned no answer");
  return present;
}

export async function assertUserInvitationsInstalled(executor: Tx | typeof db = db): Promise<void> {
  if (!(await userInvitationsInstalled(executor))) throw new PlatformError("USER_INVITATIONS_NOT_INSTALLED", "the user_invitations table is not installed");
}

/** The invitation that holds an e-mail's slot (unaccepted, unrevoked — expired included), in any company. */
export async function userInvitationSlotHolder(executor: Tx | typeof db, email: string, lock: boolean) {
  const query = executor
    .select({ id: uinv.id, orgId: uinv.orgId, expiresAt: uinv.expiresAt, createdAt: uinv.createdAt })
    .from(uinv)
    .where(and(eq(uinv.emailNormalized, email), isNull(uinv.acceptedAt), isNull(uinv.revokedAt)))
    .limit(1);
  const [row] = lock ? await query.for("update") : await query;
  return row ?? null;
}

/** A pending (unexpired, unaccepted, unrevoked) COMPANY invitation for this e-mail — its INV reference, or null. */
export async function pendingCompanyInvitationFor(executor: Tx | typeof db, email: string, now: Date): Promise<string | null> {
  const o = organizationInvitationsTable;
  const [row] = await executor
    .select({ id: o.id })
    .from(o)
    .where(and(eq(o.ownerEmailNormalized, email), isNull(o.acceptedAt), isNull(o.revokedAt), sql`${o.expiresAt} > ${now.toISOString()}::timestamptz`))
    .limit(1);
  return row ? invitationReference(row.id) : null;
}

/** USER invitations this operator created (creates and re-issues alike) in the rolling window ending now. */
export async function recentUserInvitationsBy(executor: Tx | typeof db, adminId: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - USER_INVITATION_RATE_LIMIT.windowMs);
  const [row] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(uinv)
    .where(and(eq(uinv.invitedByPlatformAdminId, adminId), sql`${uinv.createdAt} > ${since.toISOString()}::timestamptz`));
  return row?.n ?? 0;
}

// ---- read model ----------------------------------------------------------------------------------

/** flags → live platform session → platform.users.read (reads never need the invite permission). */
async function authorizeUserInvitationRead(req: ConsoleRequest): Promise<PlatformSessionContext> {
  assertPlatformUserInvitationsEnabled();
  return authorizePlatformToken(req.token, "platform.users.read");
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isPlatformError(err)) throw err;
    console.error(`[platform-user-invitations] internal failure: ${errorClass(err)}`);
    throw new PlatformError("CONFIG_ERROR", "user invitation read failed");
  }
}

export type UserInvitationRow = {
  id: string;
  reference: string;
  orgId: number;
  companyName: string;
  companyReference: string;
  name: string;
  email: string;
  role: UserInvitationRole;
  state: UserInvitationState;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  acceptedAt: Date | null;
  invitedBy: string | null;
};
export type UserInvitationPage = {
  state: UserInvitationState | null;
  q: string | null;
  company: { orgId: number; name: string; reference: string } | null;
  rows: UserInvitationRow[];
  total: number;
  offset: number;
  next: string | null;
};

function stateFilter(state: UserInvitationState, now: Date): SQL {
  const at = sql`${now.toISOString()}::timestamptz`;
  if (state === "accepted") return isNotNull(uinv.acceptedAt);
  if (state === "revoked") return and(isNull(uinv.acceptedAt), isNotNull(uinv.revokedAt))!;
  if (state === "pending") return and(isNull(uinv.acceptedAt), isNull(uinv.revokedAt), sql`${uinv.expiresAt} > ${at}`)!;
  return and(isNull(uinv.acceptedAt), isNull(uinv.revokedAt), sql`${uinv.expiresAt} <= ${at}`)!;
}

const invitedBySql = sql<string | null>`(select ${platformAdminsTable.displayName} from ${platformAdminsTable} where ${platformAdminsTable.id} = ${uinv.invitedByPlatformAdminId})`;

/**
 * Every user invitation (pending, expired, revoked, accepted) — of one company, or all — newest first, 25 per page,
 * keyset-paginated on (created_at, id). Search: the invitee's name or e-mail, the company name, or a UIN reference
 * (LIKE wildcards escaped). Allow-listed columns only — never the token hash.
 */
export async function listUserInvitations(req: ConsoleRequest, input: { state?: unknown; q?: unknown; org?: unknown; after?: unknown } = {}): Promise<UserInvitationPage> {
  await authorizeUserInvitationRead(req);
  const state = input.state === undefined || input.state === "" ? null : (USER_INVITATION_STATES as readonly unknown[]).includes(input.state) ? (input.state as UserInvitationState) : null;
  if (input.state !== undefined && input.state !== "" && state === null) throw invalid("state");
  let q: string | null = null;
  if (typeof input.q === "string" && input.q.trim()) {
    q = input.q.trim();
    if (q.length > SEARCH_MAX || DISALLOWED_TEXT.test(q)) throw invalid("q");
  } else if (input.q !== undefined && typeof input.q !== "string") throw invalid("q");
  const orgId = input.org === undefined || input.org === "" ? null : parseInvitationCompanyId(input.org);
  const after = input.after === undefined || input.after === "" ? null : parseUserInvitationId(input.after);
  return guarded(async () => {
    await assertUserInvitationsInstalled(db);
    const now = platformClock.now();
    let company: UserInvitationPage["company"] = null;
    if (orgId !== null) {
      const [org] = await db.select({ id: orgsTable.id, name: orgsTable.name }).from(orgsTable).where(eq(orgsTable.id, orgId)).limit(1);
      if (!org) throw new PlatformError("NOT_FOUND", "no company with this id");
      company = { orgId: org.id, name: org.name, reference: orgReference(org.id) };
    }
    const filters: SQL[] = [];
    if (orgId !== null) filters.push(eq(uinv.orgId, orgId));
    if (state) filters.push(stateFilter(state, now));
    if (q) {
      const pattern = `%${escapeLikePattern(q)}%`;
      const conditions: SQL[] = [sql`${uinv.name} ilike ${pattern} escape '\\'`, sql`${uinv.emailNormalized} ilike ${pattern} escape '\\'`, sql`${orgsTable.name} ilike ${pattern} escape '\\'`];
      const ref = UIN_REF.exec(q);
      if (ref) {
        const hex = ref[1].toLowerCase();
        conditions.push(sql`${uinv.id} between ${`${hex}-0000-0000-0000-000000000000`}::uuid and ${`${hex}-ffff-ffff-ffff-ffffffffffff`}::uuid`);
      }
      filters.push(or(...conditions)!);
    }
    const position: SQL[] = [];
    if (after) {
      const [exists] = await db.select({ id: uinv.id }).from(uinv).where(eq(uinv.id, after));
      if (!exists) throw invalid("the page cursor points at no invitation");
      position.push(sql`(${uinv.createdAt}, ${uinv.id}) < (select ${uinv.createdAt}, ${uinv.id} from ${uinv} where ${uinv.id} = ${after}::uuid)`);
    }
    const where = (extra: SQL[]) => (filters.length + extra.length ? and(...filters, ...extra) : undefined);
    const [counted, rows] = await Promise.all([
      db.select({ total: sql<number>`count(*)::int` }).from(uinv).innerJoin(orgsTable, eq(orgsTable.id, uinv.orgId)).where(where([])),
      db
        .select({
          id: uinv.id,
          orgId: uinv.orgId,
          companyName: orgsTable.name,
          name: uinv.name,
          email: uinv.emailNormalized,
          role: uinv.requestedRole,
          createdAt: uinv.createdAt,
          expiresAt: uinv.expiresAt,
          revokedAt: uinv.revokedAt,
          acceptedAt: uinv.acceptedAt,
          invitedBy: invitedBySql,
        })
        .from(uinv)
        .innerJoin(orgsTable, eq(orgsTable.id, uinv.orgId))
        .where(where(position))
        .orderBy(desc(uinv.createdAt), desc(uinv.id))
        .limit(USER_INVITATION_PAGE_SIZE + 1),
    ]);
    const more = rows.length > USER_INVITATION_PAGE_SIZE;
    const page = rows.slice(0, USER_INVITATION_PAGE_SIZE);
    let offset = 0;
    if (after && page.length) {
      const key = sql`(select ${uinv.createdAt}, ${uinv.id} from ${uinv} where ${uinv.id} = ${page[0].id}::uuid)`;
      const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(uinv).innerJoin(orgsTable, eq(orgsTable.id, uinv.orgId)).where(where([sql`(${uinv.createdAt}, ${uinv.id}) > ${key}`]));
      offset = r?.n ?? 0;
    }
    return {
      state,
      q,
      company,
      rows: page.map((r) => ({ ...r, role: r.role as UserInvitationRole, reference: userInvitationReference(r.id), companyReference: orgReference(r.orgId), state: userInvitationState(r, now) })),
      total: counted[0]?.total ?? 0,
      offset,
      next: more ? page[page.length - 1].id : null,
    };
  });
}

export const COMPANY_OPEN_INVITATIONS_SHOWN = 10;
export type CompanyUserInvitations = { rows: UserInvitationRow[]; open: number; total: number };

/**
 * One company's OPEN user invitations (pending or expired: not accepted, not revoked) for its Users tab — newest first,
 * at most COMPANY_OPEN_INVITATIONS_SHOWN — with the company's open and total counts. Same authorization and allow-list
 * as listUserInvitations (the caller has already resolved the company: an id of no company simply has none).
 */
export async function listCompanyUserInvitations(req: ConsoleRequest, rawOrgId: unknown): Promise<CompanyUserInvitations> {
  await authorizeUserInvitationRead(req);
  const orgId = parseInvitationCompanyId(rawOrgId);
  return guarded(async () => {
    await assertUserInvitationsInstalled(db);
    const now = platformClock.now();
    const open = and(eq(uinv.orgId, orgId), isNull(uinv.acceptedAt), isNull(uinv.revokedAt))!;
    const [[counts], rows] = await Promise.all([
      db
        .select({ total: sql<number>`count(*)::int`, open: sql<number>`(count(*) filter (where ${uinv.acceptedAt} is null and ${uinv.revokedAt} is null))::int` })
        .from(uinv)
        .where(eq(uinv.orgId, orgId)),
      db
        .select({
          id: uinv.id,
          orgId: uinv.orgId,
          companyName: orgsTable.name,
          name: uinv.name,
          email: uinv.emailNormalized,
          role: uinv.requestedRole,
          createdAt: uinv.createdAt,
          expiresAt: uinv.expiresAt,
          revokedAt: uinv.revokedAt,
          acceptedAt: uinv.acceptedAt,
          invitedBy: invitedBySql,
        })
        .from(uinv)
        .innerJoin(orgsTable, eq(orgsTable.id, uinv.orgId))
        .where(open)
        .orderBy(desc(uinv.createdAt), desc(uinv.id))
        .limit(COMPANY_OPEN_INVITATIONS_SHOWN),
    ]);
    return {
      rows: rows.map((r) => ({ ...r, role: r.role as UserInvitationRole, reference: userInvitationReference(r.id), companyReference: orgReference(r.orgId), state: userInvitationState(r, now) })),
      open: counts?.open ?? 0,
      total: counts?.total ?? 0,
    };
  });
}

export type UserInvitationEvent = { action: string; result: string; at: Date; actor: string; reason: string | null; replaces: string | null; replacedBy: string | null; stage: string | null };
export type UserInvitationDetail = UserInvitationRow & { revokedBy: string | null; events: UserInvitationEvent[] };

const EVENT_ACTIONS = ["user_invitation.created", "user_invitation.reissued", "user_invitation.revoked", "user_invitation.revoke.rejected", "user_invitation.reissue.rejected"] as const;
const REF = /^UIN-[0-9A-F]{8}$/;
const refOrNull = (value: unknown) => (typeof value === "string" && REF.test(value) ? value : null);
const stageOrNull = (value: unknown) => (typeof value === "string" && /^[a-z_]{1,40}$/.test(value) ? value : null);

/**
 * One user invitation's allow-listed details and its lifecycle events (from the append-only audit trail: created,
 * re-issued, revoked — with reasons and the re-issue lineage). Audited ("user_invitation.viewed"): the trail must be
 * protected and the record written, or nothing is returned. Never selects the token hash.
 */
export async function getUserInvitationDetail(req: ConsoleRequest, rawId: unknown): Promise<UserInvitationDetail> {
  const ctx = await authorizeUserInvitationRead(req);
  const id = parseUserInvitationId(rawId);
  const meta = requestMeta(req.headers);
  await assertPlatformAuditProtection();
  const detail = await guarded(async () => {
    await assertUserInvitationsInstalled(db);
    const now = platformClock.now();
    const revokedBy = sql<string | null>`(select ${platformAdminsTable.displayName} from ${platformAdminsTable} where ${platformAdminsTable.id} = ${uinv.revokedByPlatformAdminId})`;
    const [row] = await db
      .select({
        id: uinv.id,
        orgId: uinv.orgId,
        companyName: orgsTable.name,
        name: uinv.name,
        email: uinv.emailNormalized,
        role: uinv.requestedRole,
        createdAt: uinv.createdAt,
        expiresAt: uinv.expiresAt,
        revokedAt: uinv.revokedAt,
        acceptedAt: uinv.acceptedAt,
        invitedBy: invitedBySql,
        revokedBy,
      })
      .from(uinv)
      .innerJoin(orgsTable, eq(orgsTable.id, uinv.orgId))
      .where(eq(uinv.id, id))
      .limit(1);
    if (!row) throw new PlatformError("NOT_FOUND", "no user invitation with this id");
    const a = platformAuditEventsTable;
    const events = await db
      .select({ action: a.action, result: a.result, at: a.createdAt, actor: a.actorLabel, reason: a.reason, after: a.afterSafe })
      .from(a)
      .where(and(eq(a.entityType, USER_INVITATION_ENTITY), eq(a.entityId, id), inArray(a.action, [...EVENT_ACTIONS])))
      .orderBy(a.createdAt, a.id)
      .limit(100);
    return {
      ...row,
      role: row.role as UserInvitationRole,
      reference: userInvitationReference(row.id),
      companyReference: orgReference(row.orgId),
      state: userInvitationState(row, now),
      events: events.map((e) => {
        const after = (e.after ?? {}) as Record<string, unknown>;
        return { action: e.action, result: e.result, at: e.at, actor: e.actor, reason: e.reason, replaces: refOrNull(after.replaces), replacedBy: refOrNull(after.replacedBy), stage: stageOrNull(after.stage) };
      }),
    };
  });
  try {
    await recordPlatformAudit({ actorAdminId: ctx.adminId, actorLabel: ctx.displayName, action: "user_invitation.viewed", entityType: USER_INVITATION_ENTITY, entityId: id, result: "success", ...meta });
  } catch (err) {
    if (isPlatformError(err, "AUDIT_UNAVAILABLE")) reportSecurityIncident({ type: "audit_write_failed", action: "user_invitation.viewed", error: errorClass(err) });
    throw err;
  }
  return detail;
}
