import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, index, uniqueIndex, check, foreignKey } from "drizzle-orm/pg-core";
import { orgsTable } from "./orgs";
import { platformAdminsTable } from "./platform";

// ---------------------------------------------------------------------------
// Platform Owner — PO-02A company database foundation (docs/platform-owner/PO02A_DEVELOPMENT.md,
// PR #11 Schema.md §4.1 and §5.1; PO-00 §F.4 M2–M3).
//
// Additive only. Both tables link to the real tenant organization by its existing integer id and
// to the separate platform identity; no existing column, constraint or row is changed, and the
// PO-02A migration creates NO row: no company is backfilled, suspended or otherwise modified.
//
// `drizzle-kit push` creates these tables; the reviewed, retry-safe SQL is
// drizzle/platform/PO02A_company_foundation.sql (outside the drizzle-kit journal, decision D-6).
// Never run `drizzle-kit generate` for them: it would bundle the historical migration drift
// recorded in PO-00 §F.2.
//
// Timestamps are timestamptz (Schema.md principle 5). Services write them from one clock.
// ---------------------------------------------------------------------------

/**
 * M2 — Schema.md §4.1. One row per organization: the platform's access decision, independent of
 * any subscription state. An organization WITHOUT a row is a pre-existing (legacy) company and is
 * active — that compatibility rule lives in exactly one place, src/lib/platform/company-access.ts.
 *
 * Only an explicit platform action may change the status (PO-02C): every change is attributed to
 * a platform administrator with a reason, and a suspended row cannot exist without one — so no
 * automated process (subscription expiry included) can suspend a company by writing a bare row.
 */
export const tenantAccessControlsTable = pgTable(
  "tenant_access_controls",
  {
    orgId: integer("org_id").primaryKey(),
    accessStatus: text("access_status").notNull().default("active"),
    // Reason for the most recent platform change (suspension or reactivation). History lives in
    // platform_audit_events.
    reason: text("reason"),
    changedByPlatformAdminId: uuid("changed_by_platform_admin_id"),
    changedAt: timestamp("changed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "tenant_access_controls_org_fk", columns: [t.orgId], foreignColumns: [orgsTable.id] }).onDelete("restrict"),
    foreignKey({
      name: "tenant_access_controls_changed_by_fk",
      columns: [t.changedByPlatformAdminId],
      foreignColumns: [platformAdminsTable.id],
    }).onDelete("restrict"),
    check("tenant_access_controls_status_chk", sql`${t.accessStatus} IN ('active', 'suspended')`),
    check("tenant_access_controls_reason_chk", sql`${t.reason} IS NULL OR (${t.reason} = btrim(${t.reason}) AND length(${t.reason}) BETWEEN 1 AND 1000)`),
    // A change is always attributed: both or neither of who and when.
    check("tenant_access_controls_change_attribution_chk", sql`(${t.changedAt} IS NULL) = (${t.changedByPlatformAdminId} IS NULL)`),
    // Every attributed change carries its reason (mandatory for suspension AND reactivation).
    check("tenant_access_controls_change_reason_chk", sql`${t.changedByPlatformAdminId} IS NULL OR ${t.reason} IS NOT NULL`),
    // Suspension only by a responsible platform administrator — never by a bare automated write.
    check("tenant_access_controls_suspension_chk", sql`${t.accessStatus} <> 'suspended' OR ${t.changedByPlatformAdminId} IS NOT NULL`),
    check(
      "tenant_access_controls_timestamps_chk",
      sql`${t.updatedAt} >= ${t.createdAt} AND (${t.changedAt} IS NULL OR ${t.changedAt} >= ${t.createdAt})`,
    ),
  ],
);

/**
 * M3 — Schema.md §5.1. A pending company invitation is metadata only: no `orgs` or `users` row
 * exists until acceptance (PO-02D). Only SHA-256(token) is stored — never the token or a link.
 * Lifecycle: pending → accepted | revoked (terminal, mutually exclusive) | expired (derived from
 * time). At most one pending (unaccepted, unrevoked) invitation per normalized owner e-mail; a
 * re-issue revokes the previous one in the same transaction, then inserts the new token row.
 *
 * Deferred by design (owner decision, PO-02A brief): Schema.md §5.1's initial_package_version_id
 * and initial_cycle reference subscription packages, which PO-02A must not implement. They are
 * added additively with the package schema, before any invitation exists.
 */
export const organizationInvitationsTable = pgTable(
  "organization_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyName: text("company_name").notNull(),
    industry: text("industry"),
    companyEmail: text("company_email").notNull(),
    // Validated against the ERP catalogs at creation (src/lib/geo/countries.ts COUNTRIES by name,
    // src/lib/currency/currencies.ts isValidCurrencyCode), as /register does; the DB holds the format.
    countryName: text("country_name").notNull(),
    currencyCode: text("currency_code").notNull(),
    ownerName: text("owner_name").notNull(),
    ownerEmailNormalized: text("owner_email_normalized").notNull(),
    tokenHash: text("token_hash").notNull(),
    // Default 72 h (Schema.md §5.1), written in PostgreSQL's canonical form so `drizzle-kit push`
    // sees no difference against the reviewed SQL's `now() + interval '72 hours'`.
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`(now() + '72:00:00'::interval)`),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedOrgId: integer("accepted_org_id"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByPlatformAdminId: uuid("revoked_by_platform_admin_id"),
    invitedByPlatformAdminId: uuid("invited_by_platform_admin_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "organization_invitations_accepted_org_fk", columns: [t.acceptedOrgId], foreignColumns: [orgsTable.id] }).onDelete(
      "restrict",
    ),
    foreignKey({
      name: "organization_invitations_invited_by_fk",
      columns: [t.invitedByPlatformAdminId],
      foreignColumns: [platformAdminsTable.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "organization_invitations_revoked_by_fk",
      columns: [t.revokedByPlatformAdminId],
      foreignColumns: [platformAdminsTable.id],
    }).onDelete("restrict"),
    uniqueIndex("organization_invitations_token_hash_uq").on(t.tokenHash),
    uniqueIndex("organization_invitations_accepted_org_uq").on(t.acceptedOrgId).where(sql`${t.acceptedOrgId} IS NOT NULL`),
    // One current usable invitation per owner e-mail (expiry is derived from time, so the database
    // rule is "unaccepted and unrevoked"; a re-issue revokes the old row first).
    uniqueIndex("organization_invitations_pending_email_uq")
      .on(t.ownerEmailNormalized)
      .where(sql`${t.acceptedAt} IS NULL AND ${t.revokedAt} IS NULL`),
    index("organization_invitations_pending_expiry_idx").on(t.expiresAt).where(sql`${t.acceptedAt} IS NULL AND ${t.revokedAt} IS NULL`),
    // SHA-256 hex of a high-entropy random token: a plaintext token or link cannot match.
    check("organization_invitations_token_hash_chk", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "organization_invitations_owner_email_chk",
      sql`${t.ownerEmailNormalized} = lower(btrim(${t.ownerEmailNormalized})) AND length(${t.ownerEmailNormalized}) <= 320 AND ${t.ownerEmailNormalized} ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'`,
    ),
    check(
      "organization_invitations_company_email_chk",
      sql`${t.companyEmail} = lower(btrim(${t.companyEmail})) AND length(${t.companyEmail}) <= 320 AND ${t.companyEmail} ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'`,
    ),
    check("organization_invitations_company_name_chk", sql`${t.companyName} = btrim(${t.companyName}) AND length(${t.companyName}) BETWEEN 1 AND 200`),
    check("organization_invitations_owner_name_chk", sql`${t.ownerName} = btrim(${t.ownerName}) AND length(${t.ownerName}) BETWEEN 1 AND 200`),
    check(
      "organization_invitations_industry_chk",
      sql`${t.industry} IS NULL OR (${t.industry} = btrim(${t.industry}) AND length(${t.industry}) BETWEEN 1 AND 100)`,
    ),
    check("organization_invitations_country_chk", sql`${t.countryName} = btrim(${t.countryName}) AND length(${t.countryName}) BETWEEN 2 AND 100`),
    check("organization_invitations_currency_chk", sql`${t.currencyCode} ~ '^[A-Z]{3}$'`),
    // Service default 72 h; 30 days is a sanity ceiling so no token is effectively permanent.
    check("organization_invitations_expiry_chk", sql`${t.expiresAt} > ${t.createdAt} AND ${t.expiresAt} <= ${t.createdAt} + interval '30 days'`),
    check("organization_invitations_terminal_chk", sql`${t.acceptedAt} IS NULL OR ${t.revokedAt} IS NULL`),
    check("organization_invitations_acceptance_chk", sql`(${t.acceptedAt} IS NULL) = (${t.acceptedOrgId} IS NULL)`),
    // Single use within its validity window: an expired invitation can never be marked accepted.
    check(
      "organization_invitations_acceptance_window_chk",
      sql`${t.acceptedAt} IS NULL OR (${t.acceptedAt} >= ${t.createdAt} AND ${t.acceptedAt} <= ${t.expiresAt})`,
    ),
    check("organization_invitations_revocation_chk", sql`(${t.revokedAt} IS NULL) = (${t.revokedByPlatformAdminId} IS NULL)`),
    check("organization_invitations_revocation_time_chk", sql`${t.revokedAt} IS NULL OR ${t.revokedAt} >= ${t.createdAt}`),
    check("organization_invitations_updated_chk", sql`${t.updatedAt} >= ${t.createdAt}`),
  ],
);

export type TenantAccessControl = typeof tenantAccessControlsTable.$inferSelect;
export type OrganizationInvitation = typeof organizationInvitationsTable.$inferSelect;
