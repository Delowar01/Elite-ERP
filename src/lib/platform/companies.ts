import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { db, orgsTable, organizationInvitationsTable, platformAdminsTable, platformAuditEventsTable, tenantAccessControlsTable, usersTable } from "@/db";
import { assertPlatformAuditProtection, recordPlatformAudit } from "./audit";
import { platformClock } from "./clock";
import type { HeaderSource } from "./client-ip";
import { effectiveTenantAccessSql, getTenantAccess, resolveTenantAccess, type TenantAccess, type TenantAccessStatus } from "./company-access";
import { requestMeta } from "./console";
import { isPlatformError, PlatformError } from "./errors";
import { assertPlatformConsoleEnabled } from "./flags";
import { authorizePlatformToken } from "./guards";
import { errorClass, reportSecurityIncident } from "./incident";
import type { PlatformSessionContext } from "./session";

// ---------------------------------------------------------------------------------------------
// Platform Owner PO-02B — the READ-ONLY company read model (PR #11 PRD P-02/P-03, TRD §3.3, §8
// listCompanies, §10; PO02A_DEVELOPMENT.md §6.1–6.2). The ONLY console module that reads the
// customer `orgs` and `users` tables (tests/security/platform-boundary.test.mjs rule 21).
//
//  • Authorization first, in every exported operation: feature flag → live platform session (the
//    PLATFORM cookie only; a customer token is never read) → `platform.companies.read`.
//  • Metadata only, by an explicit allowlist. Every query names its columns — no `select *`, no
//    whole ORM rows. From orgs: id, name, country, currency, industry, created date and logo
//    PRESENCE (a boolean; the URL is never selected). From tenant_access_controls: the effective
//    access, its last reason, change date and responsible operator label. From users: counts, the
//    most recent sign-in date and at most three owner names and e-mails. Never: tax/VAT numbers,
//    addresses, phones, company e-mail, branding/theme, document/print/finance settings, passwords,
//    MFA material, sessions, invitation token hashes, or any customer business table.
//  • Access follows the PO-02A compatibility rule (company-access.ts): no row → active (legacy
//    default); 'active'/'suspended' as stored; anything else → suspended (fails closed).
//    Subscription state does not exist yet and never enters the decision.
//  • Server-side search, filters and keyset pagination, bounded by construction: page size ≤ 50,
//    search ≤ 100 characters, LIKE wildcards escaped, sort keys from a fixed allowlist, every value
//    a bound parameter. A page costs a fixed number of queries (no N+1).
//  • A company DETAIL view is audited ("company.viewed", entity organization/<id>) under the
//    PO-01B.1 policy: the trail must be protected and the record written, or nothing is returned.
//  • Read-only: this module writes nothing but that audit record.
// ---------------------------------------------------------------------------------------------

export type CompanyReadRequest = { headers: HeaderSource; token?: string | null };

/** feature flag → configuration → live platform session → platform.companies.read */
async function authorizeCompanyRead(req: CompanyReadRequest): Promise<PlatformSessionContext> {
  assertPlatformConsoleEnabled();
  return authorizePlatformToken(req.token, "platform.companies.read");
}

/** Internal failures become CONFIG_ERROR ("temporarily unavailable") without their details. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isPlatformError(err)) throw err;
    console.error(`[platform-companies] internal failure: ${errorClass(err)}`);
    throw new PlatformError("CONFIG_ERROR", "company read failed");
  }
}

// ---- input validation (every value from the URL is untrusted) ---------------------------------

export const COMPANY_PAGE_SIZE_DEFAULT = 25;
export const COMPANY_PAGE_SIZE_MAX = 50;
export const SEARCH_MAX_LENGTH = 100;
export const COMPANY_SORTS = ["newest", "oldest", "name"] as const;
export type CompanySort = (typeof COMPANY_SORTS)[number];
export const INVITATION_STATES = ["pending", "expired"] as const;
export type InvitationState = (typeof INVITATION_STATES)[number];
const MAX_ORG_ID = 2_147_483_647;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

const invalid = (detail: string) => new PlatformError("VALIDATION_FAILED", detail);

/** A single query-string value: absent → undefined; a repeated parameter (array) is refused. */
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

function pageSize(value: unknown): number {
  const raw = single(value, "size");
  if (raw === undefined || raw === "") return COMPANY_PAGE_SIZE_DEFAULT;
  if (!/^[1-9][0-9]?$/.test(raw) || Number(raw) > COMPANY_PAGE_SIZE_MAX) throw invalid(`size must be 1-${COMPANY_PAGE_SIZE_MAX}`);
  return Number(raw);
}

function oneOf<T extends string>(value: unknown, name: string, allowed: readonly T[]): T | null {
  const raw = single(value, name);
  if (raw === undefined || raw === "") return null;
  if (!(allowed as readonly string[]).includes(raw)) throw invalid(`${name} is not an allowed value`);
  return raw as T;
}

/** Escape LIKE/ILIKE wildcards so a search term only ever matches itself (used with ESCAPE '\'). */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}
const containsPattern = (term: string) => `%${escapeLikePattern(term)}%`;

/** ORG-000042 — the display reference of a real organization (never an invitation). */
export function orgReference(orgId: number): string {
  return `ORG-${String(orgId).padStart(6, "0")}`;
}
/** INV-1A2B3C4D — the short display reference of a pending company invitation (never an orgId). */
export function invitationReference(invitationId: string): string {
  return `INV-${invitationId.slice(0, 8).toUpperCase()}`;
}
const ORG_REF = /^org-?0*([1-9][0-9]{0,9})$/i;
const INV_REF = /^inv-?([0-9a-f]{8})$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Route parameter → organization id. Anything but a canonical positive integer is NOT_FOUND. */
export function parseOrgId(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/.test(value) || Number(value) > MAX_ORG_ID) throw new PlatformError("NOT_FOUND", "malformed organization id");
  return Number(value);
}

// Keyset cursors: "<anchor>.<fingerprint>". The anchor is the last (or first) row's id; the
// fingerprint binds the cursor to the search / filters / sort it was issued for, so a changed
// query can never continue from a position in another result set.
const fingerprint = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 8);

type Cursor<A> = { direction: "after" | "before"; anchor: A };

function parseCursor<A>(input: { after?: unknown; before?: unknown }, fp: string, anchor: (raw: string) => A | null): Cursor<A> | null {
  const after = single(input.after, "after");
  const before = single(input.before, "before");
  if (after && before) throw invalid("only one of after / before");
  const raw = after || before;
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  const value = dot > 0 ? anchor(raw.slice(0, dot)) : null;
  if (value === null || raw.slice(dot + 1) !== fp) throw invalid("the page cursor does not belong to this query");
  return { direction: after ? "after" : "before", anchor: value };
}
const orgAnchor = (raw: string) => (/^[1-9][0-9]{0,9}$/.test(raw) && Number(raw) <= MAX_ORG_ID ? Number(raw) : null);
const uuidAnchor = (raw: string) => (UUID.test(raw) ? raw : null);
const eventAnchor = (raw: string) => (/^[1-9][0-9]{0,14}$/.test(raw) ? Number(raw) : null);

/** Given the rows fetched (one extra) in the requested direction, the page and its neighbours. */
function paginate<R>(fetched: R[], size: number, cursor: Cursor<unknown> | null, anchorOf: (row: R) => string, fp: string) {
  const more = fetched.length > size;
  const page = fetched.slice(0, size);
  if (cursor?.direction === "before") page.reverse();
  const cursorOf = (row: R) => `${anchorOf(row)}.${fp}`;
  if (!page.length) return { rows: page, next: null, prev: null };
  const first = page[0];
  const last = page[page.length - 1];
  if (cursor?.direction === "before") return { rows: page, next: cursorOf(last), prev: more ? cursorOf(first) : null };
  return { rows: page, next: more ? cursorOf(last) : null, prev: cursor ? cursorOf(first) : null };
}

// ---- shared allow-listed selections -------------------------------------------------------------

const ORG_FIELDS = {
  orgId: orgsTable.id,
  name: orgsTable.name,
  country: orgsTable.country,
  currency: orgsTable.currency,
  industry: orgsTable.industry,
  createdAt: orgsTable.createdAt,
  // Presence only: the logo URL itself never leaves the database.
  hasLogo: sql<boolean>`(${orgsTable.logoUrl} is not null and ${orgsTable.logoUrl} <> '')`,
};
const ACCESS_FIELDS = {
  accessRowOrgId: tenantAccessControlsTable.orgId,
  storedAccessStatus: tenantAccessControlsTable.accessStatus,
};
const withAccess = eq(tenantAccessControlsTable.orgId, orgsTable.id);

/** The PO-02A compatibility rule applied to a LEFT JOINed row (no row → legacy default). */
function accessOf(row: { accessRowOrgId: number | null; storedAccessStatus: string | null }): TenantAccess {
  return resolveTenantAccess(row.accessRowOrgId === null ? null : { accessStatus: row.storedAccessStatus });
}

export type UserSummary = { total: number; active: number; owners: number; lastSignInAt: Date | null };
export type OwnerSummary = { name: string; email: string };

/** Counts and the latest sign-in per organization — ONE grouped query for the whole page. */
async function userSummaries(orgIds: number[]): Promise<Map<number, UserSummary>> {
  if (!orgIds.length) return new Map();
  const rows = await db
    .select({
      orgId: usersTable.orgId,
      total: sql<number>`count(*)::int`,
      active: sql<number>`(count(*) filter (where ${usersTable.isActive}))::int`,
      owners: sql<number>`(count(*) filter (where ${usersTable.role} = 'owner'))::int`,
      lastSignInAt: sql<Date | null>`max(${usersTable.lastLoginAt})`.mapWith(usersTable.lastLoginAt),
    })
    .from(usersTable)
    .where(inArray(usersTable.orgId, orgIds))
    .groupBy(usersTable.orgId);
  return new Map(rows.map((r) => [r.orgId, { total: r.total, active: r.active, owners: r.owners, lastSignInAt: r.lastSignInAt ?? null }]));
}

/** At most `limit` owner names and e-mails per organization (oldest first) — ONE query for the page. */
async function ownerSummaries(orgIds: number[], limit: number): Promise<Map<number, OwnerSummary[]>> {
  if (!orgIds.length) return new Map();
  const ranked = db
    .select({
      orgId: usersTable.orgId,
      name: usersTable.name,
      email: usersTable.email,
      rank: sql<number>`row_number() over (partition by ${usersTable.orgId} order by ${usersTable.createdAt}, ${usersTable.id})`.as("owner_rank"),
    })
    .from(usersTable)
    .where(and(inArray(usersTable.orgId, orgIds), eq(usersTable.role, "owner")))
    .as("ranked_owners");
  const rows = await db.select({ orgId: ranked.orgId, name: ranked.name, email: ranked.email }).from(ranked).where(lte(ranked.rank, limit)).orderBy(asc(ranked.orgId), asc(ranked.rank));
  const out = new Map<number, OwnerSummary[]>();
  for (const r of rows) out.set(r.orgId, [...(out.get(r.orgId) ?? []), { name: r.name, email: r.email }]);
  return out;
}

const NO_USERS: UserSummary = { total: 0, active: 0, owners: 0, lastSignInAt: null };

// ---- the company directory ----------------------------------------------------------------------

export type CompanyListQuery = { q: string | null; access: TenantAccessStatus | null; country: string | null; sort: CompanySort; size: number };
export type CompanyListRow = {
  orgId: number;
  reference: string;
  name: string;
  country: string | null;
  currency: string;
  industry: string | null;
  createdAt: Date;
  hasLogo: boolean;
  access: TenantAccess;
  users: UserSummary;
  /** The first owner (by account age); the full owner list (≤ 3) is on the audited detail view. */
  primaryOwner: OwnerSummary | null;
};
export type CompanyListPage = {
  query: CompanyListQuery;
  rows: CompanyListRow[];
  total: number;
  /** Matching rows before this page in display order (0 on the first page). */
  offset: number;
  next: string | null;
  prev: string | null;
  /** The search looked like an invitation reference: those are listed with the pending invitations. */
  invitationReference: boolean;
};
export type CompanyListInput = { q?: unknown; access?: unknown; country?: unknown; sort?: unknown; size?: unknown; after?: unknown; before?: unknown };

const SORT_SPECS: Record<CompanySort, { key: SQL; descending: boolean }> = {
  newest: { key: sql`${orgsTable.createdAt}`, descending: true },
  oldest: { key: sql`${orgsTable.createdAt}`, descending: false },
  name: { key: sql`lower(${orgsTable.name})`, descending: false },
};

function companySearch(term: string): SQL {
  const pattern = containsPattern(term);
  const conditions: SQL[] = [
    sql`${orgsTable.name} ilike ${pattern} escape '\\'`,
    // Owner-role e-mails only: a staff or admin address never makes a company match.
    sql`${orgsTable.id} in (select ${usersTable.orgId} from ${usersTable} where ${usersTable.role} = 'owner' and ${usersTable.email} ilike ${pattern} escape '\\')`,
  ];
  const ref = ORG_REF.exec(term);
  if (ref && Number(ref[1]) <= MAX_ORG_ID) conditions.push(eq(orgsTable.id, Number(ref[1])));
  return or(...conditions)!;
}

/**
 * One page of the directory: registered organizations (never invitations), with search by company
 * name, owner e-mail or ORG reference; filters by effective access and country; sort newest /
 * oldest / name; keyset pagination on (sort key, id). Fixed query count: count, page, user
 * summaries, owners (+ one anchor check when a cursor is given).
 */
export async function listCompanies(req: CompanyReadRequest, input: CompanyListInput = {}): Promise<CompanyListPage> {
  await authorizeCompanyRead(req);
  const query: CompanyListQuery = {
    q: boundedText(input.q, "q", SEARCH_MAX_LENGTH),
    access: oneOf(input.access, "access", ["active", "suspended"] as const),
    country: boundedText(input.country, "country", 100),
    sort: oneOf(input.sort, "sort", COMPANY_SORTS) ?? "newest",
    size: pageSize(input.size),
  };
  const fp = fingerprint(["companies", query.q, query.access, query.country, query.sort]);
  const cursor = parseCursor(input, fp, orgAnchor);
  return guarded(async () => {
    const filters: SQL[] = [];
    if (query.q) filters.push(companySearch(query.q));
    if (query.access) filters.push(sql`${effectiveTenantAccessSql} = ${query.access}`);
    if (query.country) filters.push(eq(orgsTable.country, query.country));
    const spec = SORT_SPECS[query.sort];

    const position: SQL[] = [];
    if (cursor) {
      const [exists] = await db.select({ id: orgsTable.id }).from(orgsTable).where(eq(orgsTable.id, cursor.anchor));
      if (!exists) throw invalid("the page cursor points at no organization");
      // Rows after the anchor in display order, or before it; the anchor's own key comes from the
      // database (exact microseconds and collation — nothing is round-tripped through JavaScript).
      const greater = spec.descending !== (cursor.direction === "after");
      const anchorKey = sql`(select ${spec.key}, ${orgsTable.id} from ${orgsTable} where ${orgsTable.id} = ${cursor.anchor})`;
      position.push(greater ? sql`(${spec.key}, ${orgsTable.id}) > ${anchorKey}` : sql`(${spec.key}, ${orgsTable.id}) < ${anchorKey}`);
    }
    const reverse = cursor?.direction === "before";
    const dir = spec.descending !== reverse ? desc : asc;

    const [counted, fetched] = await Promise.all([
      db.select({ total: sql<number>`count(*)::int` }).from(orgsTable).leftJoin(tenantAccessControlsTable, withAccess).where(and(...filters)),
      db
        .select({ ...ORG_FIELDS, ...ACCESS_FIELDS })
        .from(orgsTable)
        .leftJoin(tenantAccessControlsTable, withAccess)
        .where(and(...filters, ...position))
        .orderBy(dir(spec.key), dir(orgsTable.id))
        .limit(query.size + 1),
    ]);
    const page = paginate(fetched, query.size, cursor, (r) => String(r.orgId), fp);
    const ids = page.rows.map((r) => r.orgId);
    // The page's position: matching rows that come before its first row in display order.
    const before = (first: number) => {
      const key = sql`(select ${spec.key}, ${orgsTable.id} from ${orgsTable} where ${orgsTable.id} = ${first})`;
      return db
        .select({ n: sql<number>`count(*)::int` })
        .from(orgsTable)
        .leftJoin(tenantAccessControlsTable, withAccess)
        .where(and(...filters, spec.descending ? sql`(${spec.key}, ${orgsTable.id}) > ${key}` : sql`(${spec.key}, ${orgsTable.id}) < ${key}`));
    };
    const [users, owners, offset] = await Promise.all([userSummaries(ids), ownerSummaries(ids, 1), cursor && ids.length ? before(ids[0]).then((r) => r[0]?.n ?? 0) : Promise.resolve(0)]);
    return {
      offset,
      query,
      rows: page.rows.map((r) => ({
        orgId: r.orgId,
        reference: orgReference(r.orgId),
        name: r.name,
        country: r.country,
        currency: r.currency,
        industry: r.industry,
        createdAt: r.createdAt,
        hasLogo: r.hasLogo === true,
        access: accessOf(r),
        users: users.get(r.orgId) ?? NO_USERS,
        primaryOwner: owners.get(r.orgId)?.[0] ?? null,
      })),
      total: counted[0]?.total ?? 0,
      next: page.next,
      prev: page.prev,
      invitationReference: !!query.q && INV_REF.test(query.q),
    };
  });
}

/** Distinct, non-empty country names of registered organizations (the country filter's options). */
export async function listCompanyCountries(req: CompanyReadRequest): Promise<string[]> {
  await authorizeCompanyRead(req);
  return guarded(async () => {
    const rows = await db
      .selectDistinct({ country: orgsTable.country })
      .from(orgsTable)
      .where(sql`${orgsTable.country} is not null and btrim(${orgsTable.country}) <> ''`)
      .orderBy(asc(orgsTable.country))
      .limit(300);
    return rows.map((r) => r.country).filter((c): c is string => typeof c === "string");
  });
}

// ---- pending company invitations (read-only) ---------------------------------------------------

export type InvitationListQuery = { q: string | null; state: InvitationState | null; size: number };
export type InvitationListRow = { reference: string; companyName: string; ownerEmail: string; country: string; createdAt: Date; expiresAt: Date; state: InvitationState };
export type InvitationListPage = { query: InvitationListQuery; rows: InvitationListRow[]; total: number; offset: number; next: string | null; prev: string | null };
export type InvitationListInput = { q?: unknown; state?: unknown; size?: unknown; after?: unknown; before?: unknown };

const inv = organizationInvitationsTable;
/** Exactly the predicate of PO-02A's pending-email unique index: expired-but-unrevoked rows still hold their slot. */
const holdsPendingSlot = and(isNull(inv.acceptedAt), isNull(inv.revokedAt))!;

function invitationSearch(term: string): SQL {
  const pattern = containsPattern(term);
  const conditions: SQL[] = [sql`${inv.companyName} ilike ${pattern} escape '\\'`, sql`${inv.ownerEmailNormalized} ilike ${pattern} escape '\\'`];
  const ref = INV_REF.exec(term);
  if (ref) {
    const hex = ref[1].toLowerCase();
    conditions.push(sql`${inv.id} between ${`${hex}-0000-0000-0000-000000000000`}::uuid and ${`${hex}-ffff-ffff-ffff-ffffffffffff`}::uuid`);
  }
  return or(...conditions)!;
}

/**
 * Invitations that still hold their pending e-mail slot (not accepted, not revoked), newest first,
 * with the derived state pending / expired. Never selects the token hash (or any token material),
 * and offers no operation: creating, resending, revoking and accepting invitations is PO-02D.
 */
export async function listPendingInvitations(req: CompanyReadRequest, input: InvitationListInput = {}): Promise<InvitationListPage> {
  await authorizeCompanyRead(req);
  const query: InvitationListQuery = {
    q: boundedText(input.q, "q", SEARCH_MAX_LENGTH),
    state: oneOf(input.state, "state", INVITATION_STATES),
    size: pageSize(input.size),
  };
  const fp = fingerprint(["invitations", query.q, query.state]);
  const cursor = parseCursor(input, fp, uuidAnchor);
  return guarded(async () => {
    const now = platformClock.now();
    const filters: SQL[] = [holdsPendingSlot];
    if (query.q) filters.push(invitationSearch(query.q));
    if (query.state === "pending") filters.push(sql`${inv.expiresAt} > ${now.toISOString()}::timestamptz`);
    if (query.state === "expired") filters.push(sql`${inv.expiresAt} <= ${now.toISOString()}::timestamptz`);
    const position: SQL[] = [];
    if (cursor) {
      const [exists] = await db.select({ id: inv.id }).from(inv).where(eq(inv.id, cursor.anchor));
      if (!exists) throw invalid("the page cursor points at no invitation");
      const anchorKey = sql`(select ${inv.createdAt}, ${inv.id} from ${inv} where ${inv.id} = ${cursor.anchor}::uuid)`;
      position.push(cursor.direction === "after" ? sql`(${inv.createdAt}, ${inv.id}) < ${anchorKey}` : sql`(${inv.createdAt}, ${inv.id}) > ${anchorKey}`);
    }
    const dir = cursor?.direction === "before" ? asc : desc;
    const [counted, fetched] = await Promise.all([
      db.select({ total: sql<number>`count(*)::int` }).from(inv).where(and(...filters)),
      db
        .select({ id: inv.id, companyName: inv.companyName, ownerEmail: inv.ownerEmailNormalized, country: inv.countryName, createdAt: inv.createdAt, expiresAt: inv.expiresAt })
        .from(inv)
        .where(and(...filters, ...position))
        .orderBy(dir(inv.createdAt), dir(inv.id))
        .limit(query.size + 1),
    ]);
    const page = paginate(fetched, query.size, cursor, (r) => r.id, fp);
    let offset = 0;
    if (cursor && page.rows.length) {
      const key = sql`(select ${inv.createdAt}, ${inv.id} from ${inv} where ${inv.id} = ${page.rows[0].id}::uuid)`;
      const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(inv).where(and(...filters, sql`(${inv.createdAt}, ${inv.id}) > ${key}`));
      offset = r?.n ?? 0;
    }
    return {
      query,
      offset,
      rows: page.rows.map((r) => ({
        reference: invitationReference(r.id),
        companyName: r.companyName,
        ownerEmail: r.ownerEmail,
        country: r.country,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        state: r.expiresAt.getTime() > now.getTime() ? ("pending" as const) : ("expired" as const),
      })),
      total: counted[0]?.total ?? 0,
      next: page.next,
      prev: page.prev,
    };
  });
}

// ---- dashboard / directory metrics ------------------------------------------------------------

export type CompanyMetrics = {
  companies: { total: number; active: number; suspended: number; legacyDefault: number; registeredLast30Days: number };
  invitations: { pending: number; expired: number };
  users: { total: number; active: number };
  /** Organizations registered per calendar month (Asia/Riyadh), oldest first, the current month last. */
  registrations: { month: string; count: number }[];
  /** The most recently registered organizations (newest first). */
  newest: { orgId: number; reference: string; name: string; createdAt: Date }[];
};

export const REGISTRATION_MONTHS = 6;

/** "YYYY-MM" keys of the last `n` Asia/Riyadh calendar months, oldest first, ending with the current one. */
function riyadhMonthKeys(now: Date, n: number): string[] {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit" }).formatToParts(now);
  let year = Number(parts.find((p) => p.type === "year")?.value);
  let month = Number(parts.find((p) => p.type === "month")?.value);
  const keys: string[] = [];
  for (let i = 0; i < n; i++) {
    keys.unshift(`${year}-${String(month).padStart(2, "0")}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return keys;
}

/**
 * Aggregates over the allow-listed metadata only: organization counts by effective access, the
 * invitation slots held, customer user counts, monthly registrations and the newest companies.
 * Commercial figures (plans, trials, expirations, revenue) do not exist yet and are not computed.
 */
export async function companyMetrics(req: CompanyReadRequest): Promise<CompanyMetrics> {
  await authorizeCompanyRead(req);
  return guarded(async () => {
    const now = platformClock.now();
    const nowTz = sql`${now.toISOString()}::timestamptz`;
    // orgs.created_at is a UTC wall-clock timestamp (no zone); compared in UTC, bucketed in Riyadh time.
    const windowStart = sql`((date_trunc('month', ${nowTz} at time zone 'Asia/Riyadh') - (${REGISTRATION_MONTHS - 1}::int * interval '1 month')) at time zone 'Asia/Riyadh')`;
    const riyadhMonth = sql<string>`to_char(date_trunc('month', (${orgsTable.createdAt} at time zone 'UTC') at time zone 'Asia/Riyadh'), 'YYYY-MM')`;
    const [companies, invitations, users, months, newest] = await Promise.all([
      db
        .select({
          total: sql<number>`count(*)::int`,
          active: sql<number>`(count(*) filter (where ${effectiveTenantAccessSql} = 'active'))::int`,
          suspended: sql<number>`(count(*) filter (where ${effectiveTenantAccessSql} = 'suspended'))::int`,
          legacyDefault: sql<number>`(count(*) filter (where ${tenantAccessControlsTable.orgId} is null))::int`,
          registeredLast30Days: sql<number>`(count(*) filter (where ${orgsTable.createdAt} > ((${nowTz} - interval '30 days') at time zone 'UTC')))::int`,
        })
        .from(orgsTable)
        .leftJoin(tenantAccessControlsTable, withAccess),
      db
        .select({
          pending: sql<number>`(count(*) filter (where ${inv.expiresAt} > ${nowTz}))::int`,
          expired: sql<number>`(count(*) filter (where ${inv.expiresAt} <= ${nowTz}))::int`,
        })
        .from(inv)
        .where(holdsPendingSlot),
      db.select({ total: sql<number>`count(*)::int`, active: sql<number>`(count(*) filter (where ${usersTable.isActive}))::int` }).from(usersTable),
      db
        .select({ month: riyadhMonth, count: sql<number>`count(*)::int` })
        .from(orgsTable)
        .where(sql`${orgsTable.createdAt} >= (${windowStart} at time zone 'UTC')`)
        .groupBy(riyadhMonth),
      db.select({ orgId: orgsTable.id, name: orgsTable.name, createdAt: orgsTable.createdAt }).from(orgsTable).orderBy(desc(orgsTable.createdAt), desc(orgsTable.id)).limit(5),
    ]);
    const byMonth = new Map(months.map((m) => [m.month, m.count]));
    return {
      companies: companies[0] ?? { total: 0, active: 0, suspended: 0, legacyDefault: 0, registeredLast30Days: 0 },
      invitations: invitations[0] ?? { pending: 0, expired: 0 },
      users: users[0] ?? { total: 0, active: 0 },
      registrations: riyadhMonthKeys(now, REGISTRATION_MONTHS).map((month) => ({ month, count: byMonth.get(month) ?? 0 })),
      newest: newest.map((r) => ({ orgId: r.orgId, reference: orgReference(r.orgId), name: r.name, createdAt: r.createdAt })),
    };
  });
}

// ---- company detail (audited) -------------------------------------------------------------------

export const ACTIVITY_PAGE_SIZE = 20;
export const DETAIL_OWNER_LIMIT = 3;

export type CompanyActivityRow = { id: number; at: Date; actor: string; action: string; result: string; reason: string | null };
export type CompanyDetail = {
  orgId: number;
  reference: string;
  name: string;
  industry: string | null;
  country: string | null;
  currency: string;
  createdAt: Date;
  hasLogo: boolean;
  access: TenantAccess & { reason: string | null; changedAt: Date | null; changedBy: string | null };
  users: UserSummary;
  owners: OwnerSummary[];
  activity: { rows: CompanyActivityRow[]; next: string | null };
};

const ev = platformAuditEventsTable;

/**
 * One organization's allow-listed metadata, access state, user summary, up to three owners and the
 * Platform Owner events about it (newest first; by exact org id; keyset-paginated).
 *
 * Order (PO-01B.1 audit policy): authorize → validate the id (malformed or unknown → NOT_FOUND) →
 * the audit trail must be protected (else CONFIG_ERROR) → read → write "company.viewed" → return.
 * If the record cannot be written, AUDIT_UNAVAILABLE is thrown and nothing is returned.
 */
export async function getCompanyDetail(req: CompanyReadRequest, rawOrgId: unknown, input: { activity?: unknown } = {}): Promise<CompanyDetail> {
  const ctx = await authorizeCompanyRead(req);
  const orgId = parseOrgId(rawOrgId);
  const rawAnchor = single(input.activity, "activity");
  const activityAnchor = rawAnchor === undefined || rawAnchor === "" ? null : eventAnchor(rawAnchor);
  if (rawAnchor && activityAnchor === null) throw invalid("malformed activity cursor");
  const meta = requestMeta(req.headers);
  await assertPlatformAuditProtection();
  const detail = await guarded(async () => {
    const access = await getTenantAccess(orgId);
    if (!access) throw new PlatformError("NOT_FOUND", "no organization with this id");
    const [org] = await db
      .select({
        ...ORG_FIELDS,
        reason: tenantAccessControlsTable.reason,
        changedAt: tenantAccessControlsTable.changedAt,
        changedBy: platformAdminsTable.displayName,
      })
      .from(orgsTable)
      .leftJoin(tenantAccessControlsTable, withAccess)
      .leftJoin(platformAdminsTable, eq(platformAdminsTable.id, tenantAccessControlsTable.changedByPlatformAdminId))
      .where(eq(orgsTable.id, orgId));
    if (!org) throw new PlatformError("NOT_FOUND", "organization disappeared");
    if (activityAnchor !== null) {
      const [anchor] = await db.select({ id: ev.id }).from(ev).where(and(eq(ev.id, activityAnchor), eq(ev.orgId, orgId)));
      if (!anchor) throw invalid("the activity cursor does not belong to this company");
    }
    const position =
      activityAnchor === null ? [] : [sql`(${ev.createdAt}, ${ev.id}) < (select ${ev.createdAt}, ${ev.id} from ${ev} where ${ev.id} = ${activityAnchor} and ${ev.orgId} = ${orgId})`];
    const [users, owners, activity] = await Promise.all([
      userSummaries([orgId]),
      ownerSummaries([orgId], DETAIL_OWNER_LIMIT),
      db
        .select({ id: ev.id, at: ev.createdAt, actor: ev.actorLabel, action: ev.action, result: ev.result, reason: ev.reason })
        .from(ev)
        .where(and(eq(ev.orgId, orgId), ...position))
        .orderBy(desc(ev.createdAt), desc(ev.id))
        .limit(ACTIVITY_PAGE_SIZE + 1),
    ]);
    const more = activity.length > ACTIVITY_PAGE_SIZE;
    const rows = activity.slice(0, ACTIVITY_PAGE_SIZE).map((r) => ({ ...r, reason: r.reason ? r.reason.slice(0, 200) : null }));
    return {
      orgId,
      reference: orgReference(orgId),
      name: org.name,
      industry: org.industry,
      country: org.country,
      currency: org.currency,
      createdAt: org.createdAt,
      hasLogo: org.hasLogo === true,
      access: { ...access, reason: org.reason ?? null, changedAt: org.changedAt ?? null, changedBy: org.changedBy ?? null },
      users: users.get(orgId) ?? NO_USERS,
      owners: owners.get(orgId) ?? [],
      activity: { rows, next: more ? String(rows[rows.length - 1].id) : null },
    };
  });
  try {
    await recordPlatformAudit({
      actorAdminId: ctx.adminId,
      actorLabel: ctx.displayName,
      action: "company.viewed",
      entityType: "organization",
      entityId: String(orgId),
      orgId,
      result: "success",
      ...meta,
    });
  } catch (err) {
    if (isPlatformError(err, "AUDIT_UNAVAILABLE")) reportSecurityIncident({ type: "audit_write_failed", action: "company.viewed", error: errorClass(err) });
    throw err;
  }
  return detail;
}
