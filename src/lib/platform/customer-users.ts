import "server-only";
import { and, desc, eq, gt, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { db, orgsTable, platformAuditEventsTable, sessionsTable, usersTable } from "@/db";
import { assertPlatformAuditProtection, recordPlatformAudit } from "./audit";
import { platformClock } from "./clock";
import type { HeaderSource } from "./client-ip";
import { escapeLikePattern, orgReference } from "./companies";
import { requestMeta } from "./console";
import { isPlatformError, PlatformError } from "./errors";
import { assertPlatformConsoleEnabled } from "./flags";
import { authorizePlatformToken } from "./guards";
import { errorClass, reportSecurityIncident } from "./incident";
import { primaryOwnerFoundation, readPrimaryOwnerMapping, readPrimaryOwnerUserIds } from "./primary-owners";
import { readSeatAccounting, readSeatAccountingForCompanies, type SeatAccounting } from "./seat-accounting";
import type { PlatformSessionContext } from "./session";

// ---------------------------------------------------------------------------------------------
// Platform Owner PO-03B — the READ-ONLY customer-user read model: the console's user directory, the audited user
// detail and the live state the user controls confirm against. With companies.ts, the only console module that reads
// the customer `users` table (tests/security/platform-boundary.test.mjs rules 21 and 47).
//
//  • Authorization first, in every exported operation: feature flag → live platform session (the PLATFORM cookie
//    only) → platform.users.read (the directory and the detail) or platform.users.manage (the state a control
//    confirms against).
//  • An explicit allowlist. Every query names its columns. From users: id, company, name, e-mail, role, status,
//    MFA on/off, last sign-in, creation date and the row's change marker (the stale-page check). From orgs: id and
//    name. From sessions: a COUNT of one user's live sessions (the detail only). Never: password hashes, MFA
//    secrets, recovery codes, session tokens or their hashes, user agents, or any customer business record.
//  • Primary-owner designation and seat usage come from the shared read-only cores (primary-owners.ts,
//    seat-accounting.ts), fail-soft: unreadable is shown as unavailable, never as "not designated" or "no
//    subscription". Display only — every decision is made under the shared lock order
//    (src/lib/team/customer-user-core.ts).
//  • Server-side search, filters, sorting and pagination, bounded by construction: page size ≤ 50, page ≤ 10 000,
//    search ≤ 100 characters, LIKE wildcards escaped, sort keys from a fixed list, every value a bound parameter.
//    A page costs a fixed number of queries (no N+1).
//  • A user DETAIL view is audited ("customer_user.viewed", entity customer_user/<id>) under the PO-01B.1 policy:
//    the trail must be protected and the record written, or nothing is returned.
//  • Read-only: this module writes nothing but that audit record.
// ---------------------------------------------------------------------------------------------

export type CustomerUserReadRequest = { headers: HeaderSource; token?: string | null };

/** feature flag → configuration → live platform session → the given users permission */
async function authorizeUserRead(req: CustomerUserReadRequest, permission: "platform.users.read" | "platform.users.manage"): Promise<PlatformSessionContext> {
  assertPlatformConsoleEnabled();
  return authorizePlatformToken(req.token, permission);
}

/** Internal failures become CONFIG_ERROR ("temporarily unavailable") without their details. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isPlatformError(err)) throw err;
    console.error(`[platform-users] internal failure: ${errorClass(err)}`);
    throw new PlatformError("CONFIG_ERROR", "customer user read failed");
  }
}

// ---- input validation (every value from the URL is untrusted) ---------------------------------

export const USER_PAGE_SIZE_DEFAULT = 25;
export const USER_PAGE_SIZE_MAX = 50;
export const USER_PAGE_MAX = 10_000;
export const USER_SEARCH_MAX_LENGTH = 100;
export const USER_SORTS = ["newest", "oldest", "name", "last_sign_in", "company"] as const;
export type CustomerUserSort = (typeof USER_SORTS)[number];
export const USER_ROLES = ["owner", "admin", "staff"] as const;
export type CustomerUserRole = (typeof USER_ROLES)[number];
export const USER_STATUSES = ["active", "disabled"] as const;
export type CustomerUserStatus = (typeof USER_STATUSES)[number];
export const USER_MFA_STATES = ["on", "off"] as const;
export type CustomerUserMfa = (typeof USER_MFA_STATES)[number];
const MAX_ID = 2_147_483_647;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

const invalid = (detail: string) => new PlatformError("VALIDATION_FAILED", detail);

function single(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw invalid(`${name} must be a single value`);
  return value;
}

function boundedText(value: unknown, name: string, max: number): string | null {
  const raw = single(value, name);
  if (raw === undefined) return null;
  if (raw.length > max * 3) throw invalid(`${name} is too long`);
  const text = raw.normalize("NFC").trim();
  if (!text) return null;
  if (text.length > max) throw invalid(`${name} is longer than ${max} characters`);
  if (CONTROL_CHARS.test(text)) throw invalid(`${name} contains control characters`);
  return text;
}

function oneOf<T extends string>(value: unknown, name: string, allowed: readonly T[]): T | null {
  const raw = single(value, name);
  if (raw === undefined || raw === "") return null;
  if (!(allowed as readonly string[]).includes(raw)) throw invalid(`${name} is not an allowed value`);
  return raw as T;
}

function boundedInt(value: unknown, name: string, fallback: number, max: number): number {
  const raw = single(value, name);
  if (raw === undefined || raw === "") return fallback;
  if (!/^[1-9][0-9]{0,4}$/.test(raw) || Number(raw) > max) throw invalid(`${name} must be 1-${max}`);
  return Number(raw);
}

function optionalId(value: unknown, name: string): number | null {
  const raw = single(value, name);
  if (raw === undefined || raw === "") return null;
  if (!/^[1-9][0-9]{0,9}$/.test(raw) || Number(raw) > MAX_ID) throw invalid(`${name} must be an id`);
  return Number(raw);
}

/** USR-000123 — the display reference of a customer user (its id; the audit trail's entity id). */
export function userReference(userId: number): string {
  return `USR-${String(userId).padStart(6, "0")}`;
}
const USR_REF = /^usr-?0*([1-9][0-9]{0,9})$/i;
const ORG_REF = /^org-?0*([1-9][0-9]{0,9})$/i;

/** Route parameter → user id. Anything but a canonical positive integer is NOT_FOUND. */
export function parseCustomerUserId(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/.test(value) || Number(value) > MAX_ID) throw new PlatformError("NOT_FOUND", "malformed customer user id");
  return Number(value);
}

// ---- shared allow-listed selections -------------------------------------------------------------

/**
 * The account row's change marker — the SAME expression as src/lib/team/customer-user-core.ts (rule 47 pins both):
 * a control sends it back and the shared service refuses the change if the row has moved since.
 */
const VERSION = sql<string>`to_char(${usersTable.updatedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

const USER_FIELDS = {
  userId: usersTable.id,
  orgId: usersTable.orgId,
  name: usersTable.name,
  email: usersTable.email,
  role: usersTable.role,
  isActive: usersTable.isActive,
  mfaEnabled: usersTable.mfaEnabled,
  lastSignInAt: usersTable.lastLoginAt,
  createdAt: usersTable.createdAt,
  companyName: orgsTable.name,
};
const withCompany = eq(orgsTable.id, usersTable.orgId);

/** Seat usage as one row shows it: occupied seats against the current subscription's allowance (display only). */
export type SeatUsageView = { occupied: number; seats: number | null; overLimit: boolean; allowance: "assigned" | "none" | "not_installed" };
const seatUsage = (s: SeatAccounting): SeatUsageView => ({ occupied: s.occupied, seats: s.allowance.state === "assigned" ? s.allowance.seats : null, overLimit: s.overLimit, allowance: s.allowance.state });

/** Whether a user is the company's mapped primary owner — or why that cannot be said. */
export type PrimaryOwnerFlag = "yes" | "no" | "not_installed" | "unavailable";

async function primaryOwnersOf(orgIds: number[]): Promise<{ state: "installed"; byOrg: Map<number, number> } | { state: "not_installed" | "unavailable" }> {
  try {
    if ((await primaryOwnerFoundation(db)) === "absent") return { state: "not_installed" };
    return { state: "installed", byOrg: await readPrimaryOwnerUserIds(db, orgIds) };
  } catch (err) {
    console.error(`[platform-users] primary owners unavailable: ${errorClass(err)}`);
    return { state: "unavailable" };
  }
}

async function seatsOf(orgIds: number[]): Promise<Map<number, SeatAccounting> | null> {
  try {
    return await readSeatAccountingForCompanies(db, orgIds);
  } catch (err) {
    console.error(`[platform-users] seat accounting unavailable: ${errorClass(err)}`);
    return null;
  }
}

// ---- the user directory -------------------------------------------------------------------------

export type CustomerUserListQuery = {
  q: string | null;
  org: number | null;
  role: CustomerUserRole | null;
  status: CustomerUserStatus | null;
  mfa: CustomerUserMfa | null;
  sort: CustomerUserSort;
  size: number;
  page: number;
};
export type CustomerUserRow = {
  userId: number;
  reference: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  mfaEnabled: boolean;
  lastSignInAt: Date | null;
  createdAt: Date;
  company: { orgId: number; reference: string; name: string };
  primaryOwner: PrimaryOwnerFlag;
  /** null = could not be read (shown as unavailable). */
  seats: SeatUsageView | null;
};
export type CustomerUserListPage = {
  query: CustomerUserListQuery;
  rows: CustomerUserRow[];
  total: number;
  /** Matching rows before this page (0 on the first page). */
  offset: number;
  pages: number;
  /** The company of the `org` filter, when it exists. */
  company: { orgId: number; reference: string; name: string } | null;
};
export type CustomerUserListInput = { q?: unknown; org?: unknown; role?: unknown; status?: unknown; mfa?: unknown; sort?: unknown; size?: unknown; page?: unknown };

const SORT_ORDER: Record<CustomerUserSort, SQL[]> = {
  newest: [sql`${usersTable.createdAt} desc`, sql`${usersTable.id} desc`],
  oldest: [sql`${usersTable.createdAt} asc`, sql`${usersTable.id} asc`],
  name: [sql`lower(${usersTable.name}) asc`, sql`${usersTable.id} asc`],
  last_sign_in: [sql`${usersTable.lastLoginAt} desc nulls last`, sql`${usersTable.id} desc`],
  company: [sql`lower(${orgsTable.name}) asc`, sql`lower(${usersTable.name}) asc`, sql`${usersTable.id} asc`],
};

function userSearch(term: string): SQL {
  const pattern = `%${escapeLikePattern(term)}%`;
  const conditions: SQL[] = [
    sql`${usersTable.name} ilike ${pattern} escape '\\'`,
    sql`${usersTable.email} ilike ${pattern} escape '\\'`,
    sql`${orgsTable.name} ilike ${pattern} escape '\\'`,
  ];
  const usr = USR_REF.exec(term);
  if (usr && Number(usr[1]) <= MAX_ID) conditions.push(eq(usersTable.id, Number(usr[1])));
  const org = ORG_REF.exec(term);
  if (org && Number(org[1]) <= MAX_ID) conditions.push(eq(usersTable.orgId, Number(org[1])));
  return or(...conditions)!;
}

/**
 * One page of the directory: customer users of every company, with search by name, e-mail, company name or a
 * USR / ORG reference; filters by company, role, status and MFA; five sorts; numbered pages. Fixed query count:
 * count, page, primary owners (probe + one query), seats (counts, probe, allowances) and the filter company.
 */
export async function listCustomerUsers(req: CustomerUserReadRequest, input: CustomerUserListInput = {}): Promise<CustomerUserListPage> {
  await authorizeUserRead(req, "platform.users.read");
  const query: CustomerUserListQuery = {
    q: boundedText(input.q, "q", USER_SEARCH_MAX_LENGTH),
    org: optionalId(input.org, "org"),
    role: oneOf(input.role, "role", USER_ROLES),
    status: oneOf(input.status, "status", USER_STATUSES),
    mfa: oneOf(input.mfa, "mfa", USER_MFA_STATES),
    sort: oneOf(input.sort, "sort", USER_SORTS) ?? "newest",
    size: boundedInt(input.size, "size", USER_PAGE_SIZE_DEFAULT, USER_PAGE_SIZE_MAX),
    page: boundedInt(input.page, "page", 1, USER_PAGE_MAX),
  };
  return guarded(async () => {
    const filters: SQL[] = [];
    if (query.q) filters.push(userSearch(query.q));
    if (query.org) filters.push(eq(usersTable.orgId, query.org));
    if (query.role) filters.push(eq(usersTable.role, query.role));
    if (query.status) filters.push(eq(usersTable.isActive, query.status === "active"));
    if (query.mfa) filters.push(eq(usersTable.mfaEnabled, query.mfa === "on"));
    const offset = (query.page - 1) * query.size;
    const [counted, fetched, filterCompany] = await Promise.all([
      db.select({ total: sql<number>`count(*)::int` }).from(usersTable).innerJoin(orgsTable, withCompany).where(and(...filters)),
      db
        .select(USER_FIELDS)
        .from(usersTable)
        .innerJoin(orgsTable, withCompany)
        .where(and(...filters))
        .orderBy(...SORT_ORDER[query.sort])
        .limit(query.size)
        .offset(offset),
      query.org ? db.select({ orgId: orgsTable.id, name: orgsTable.name }).from(orgsTable).where(eq(orgsTable.id, query.org)).limit(1) : Promise.resolve([]),
    ]);
    const orgIds = [...new Set(fetched.map((r) => r.orgId))];
    const [owners, seats] = await Promise.all([primaryOwnersOf(orgIds), seatsOf(orgIds)]);
    const total = counted[0]?.total ?? 0;
    return {
      query,
      total,
      offset: fetched.length ? offset : 0,
      pages: Math.max(1, Math.ceil(total / query.size)),
      company: filterCompany[0] ? { orgId: filterCompany[0].orgId, reference: orgReference(filterCompany[0].orgId), name: filterCompany[0].name } : null,
      rows: fetched.map((r) => {
        const s = seats?.get(r.orgId);
        return {
          userId: r.userId,
          reference: userReference(r.userId),
          name: r.name,
          email: r.email,
          role: r.role,
          isActive: r.isActive,
          mfaEnabled: r.mfaEnabled,
          lastSignInAt: r.lastSignInAt ?? null,
          createdAt: r.createdAt,
          company: { orgId: r.orgId, reference: orgReference(r.orgId), name: r.companyName },
          primaryOwner: owners.state === "installed" ? (owners.byOrg.get(r.orgId) === r.userId ? "yes" : "no") : owners.state,
          seats: s ? seatUsage(s) : null,
        };
      }),
    };
  });
}

export type CustomerUserMetrics = { total: number; active: number; disabled: number; mfaEnabled: number; companies: number };

/** Directory totals over every customer user (ONE statement). */
export async function customerUserMetrics(req: CustomerUserReadRequest): Promise<CustomerUserMetrics> {
  await authorizeUserRead(req, "platform.users.read");
  return guarded(async () => {
    const [r] = await db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`(count(*) filter (where ${usersTable.isActive}))::int`,
        mfaEnabled: sql<number>`(count(*) filter (where ${usersTable.mfaEnabled}))::int`,
        companies: sql<number>`count(distinct ${usersTable.orgId})::int`,
      })
      .from(usersTable);
    const total = r?.total ?? 0;
    const active = r?.active ?? 0;
    return { total, active, disabled: total - active, mfaEnabled: r?.mfaEnabled ?? 0, companies: r?.companies ?? 0 };
  });
}

// ---- protection and live state (display only) ---------------------------------------------------

/** The rules the shared service applies, as committed now: the mapped primary owner, and the last active owner. */
async function protectionOf(user: { userId: number; orgId: number; role: string }): Promise<{ primaryOwner: PrimaryOwnerFlag; lastActiveOwner: boolean }> {
  let primaryOwner: PrimaryOwnerFlag;
  try {
    if ((await primaryOwnerFoundation(db)) === "absent") primaryOwner = "not_installed";
    else primaryOwner = (await readPrimaryOwnerMapping(db, user.orgId))?.userId === user.userId ? "yes" : "no";
  } catch (err) {
    console.error(`[platform-users] primary owner unavailable: ${errorClass(err)}`);
    primaryOwner = "unavailable";
  }
  let lastActiveOwner = false;
  if (user.role === "owner") {
    const others = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.orgId, user.orgId), eq(usersTable.role, "owner"), eq(usersTable.isActive, true), ne(usersTable.id, user.userId)))
      .limit(1);
    lastActiveOwner = others.length === 0;
  }
  return { primaryOwner, lastActiveOwner };
}

/** How many live sessions one user of one company has (a count — never a token, hash, id or user agent). */
async function liveSessionCount(userId: number, orgId: number): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sessionsTable)
    .where(and(eq(sessionsTable.orgId, orgId), eq(sessionsTable.userId, userId), isNull(sessionsTable.revokedAt), gt(sessionsTable.expiresAt, platformClock.now())));
  return r?.n ?? 0;
}

// ---- the user detail ----------------------------------------------------------------------------

export const USER_ACTIVITY_LIMIT = 20;
export type CustomerUserActivityRow = { id: number; at: Date; actor: string; action: string; result: string; reason: string | null };
export type CustomerUserDetail = Omit<CustomerUserRow, "seats"> & {
  /** The account row's change marker, sent back by a control (the stale-page check). */
  version: string;
  lastActiveOwner: boolean;
  liveSessions: number;
  /** null = could not be read (shown as unavailable). */
  seats: SeatAccounting | null;
  activity: CustomerUserActivityRow[];
};

const ev = platformAuditEventsTable;

/**
 * One customer user's allow-listed fields, company, primary-owner designation, seat usage, live session count and the
 * Platform Owner events about the account (newest first, at most 20).
 *
 * Order (PO-01B.1 audit policy): authorize → validate the id (malformed or unknown → NOT_FOUND) → the audit trail must
 * be protected (else CONFIG_ERROR) → read → write "customer_user.viewed" → return. If the record cannot be written,
 * AUDIT_UNAVAILABLE is thrown and nothing is returned.
 */
export async function getCustomerUserDetail(req: CustomerUserReadRequest, rawUserId: unknown): Promise<CustomerUserDetail> {
  const ctx = await authorizeUserRead(req, "platform.users.read");
  const userId = parseCustomerUserId(rawUserId);
  const meta = requestMeta(req.headers);
  await assertPlatformAuditProtection();
  const detail = await guarded(async () => {
    const [u] = await db.select({ ...USER_FIELDS, version: VERSION }).from(usersTable).innerJoin(orgsTable, withCompany).where(eq(usersTable.id, userId)).limit(1);
    if (!u) throw new PlatformError("NOT_FOUND", "no customer user with this id");
    const [protection, liveSessions, seats, activity] = await Promise.all([
      protectionOf(u),
      liveSessionCount(u.userId, u.orgId),
      readSeatAccounting(db, u.orgId).catch((err: unknown) => {
        console.error(`[platform-users] seat accounting unavailable: ${errorClass(err)}`);
        return null;
      }),
      db
        .select({ id: ev.id, at: ev.createdAt, actor: ev.actorLabel, action: ev.action, result: ev.result, reason: ev.reason })
        .from(ev)
        .where(and(eq(ev.entityType, "customer_user"), eq(ev.entityId, String(u.userId))))
        .orderBy(desc(ev.createdAt), desc(ev.id))
        .limit(USER_ACTIVITY_LIMIT),
    ]);
    return {
      userId: u.userId,
      reference: userReference(u.userId),
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      mfaEnabled: u.mfaEnabled,
      lastSignInAt: u.lastSignInAt ?? null,
      createdAt: u.createdAt,
      company: { orgId: u.orgId, reference: orgReference(u.orgId), name: u.companyName },
      version: u.version,
      primaryOwner: protection.primaryOwner,
      lastActiveOwner: protection.lastActiveOwner,
      liveSessions,
      seats,
      activity: activity.map((r) => ({ ...r, reason: r.reason ? r.reason.slice(0, 200) : null })),
    };
  });
  try {
    await recordPlatformAudit({
      actorAdminId: ctx.adminId,
      actorLabel: ctx.displayName,
      action: "customer_user.viewed",
      entityType: "customer_user",
      entityId: String(userId),
      orgId: detail.company.orgId,
      result: "success",
      ...meta,
    });
  } catch (err) {
    if (isPlatformError(err, "AUDIT_UNAVAILABLE")) reportSecurityIncident({ type: "audit_write_failed", action: "customer_user.viewed", error: errorClass(err) });
    throw err;
  }
  return detail;
}

export type CustomerUserState = { userId: number; isActive: boolean; version: string; primaryOwner: PrimaryOwnerFlag; lastActiveOwner: boolean; liveSessions: number };

/**
 * The account as it is NOW (not as the page was rendered) — what a control's confirmation acts on. Read-only and
 * unaudited (like the company access state read); platform.users.manage.
 */
export async function readCustomerUserState(req: CustomerUserReadRequest, rawUserId: unknown): Promise<CustomerUserState> {
  await authorizeUserRead(req, "platform.users.manage");
  const userId = parseCustomerUserId(rawUserId);
  return guarded(async () => {
    const [u] = await db
      .select({ userId: usersTable.id, orgId: usersTable.orgId, role: usersTable.role, isActive: usersTable.isActive, version: VERSION })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!u) throw new PlatformError("NOT_FOUND", "no customer user with this id");
    const [protection, liveSessions] = await Promise.all([protectionOf(u), liveSessionCount(u.userId, u.orgId)]);
    return { userId: u.userId, isActive: u.isActive, version: u.version, primaryOwner: protection.primaryOwner, lastActiveOwner: protection.lastActiveOwner, liveSessions };
  });
}
