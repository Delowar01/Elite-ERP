import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  smallint,
  bigint,
  boolean,
  char,
  numeric,
  jsonb,
  date,
  index,
  uniqueIndex,
  unique,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { orgsTable } from "./orgs";
import { usersTable } from "./users";
import { platformAdminsTable } from "./platform";
import { organizationInvitationsTable } from "./platform-companies";

// ---------------------------------------------------------------------------
// Platform Owner — PO-02D1A onboarding database foundation, SCHEMA ONLY
// (docs/platform-owner/PO02D1A_DEVELOPMENT.md; PO02D0_DECISIONS.md §C; PR #11 Schema.md §4.2, §5.1, §6, §7, §9).
//
// Additive only. Seven platform-owned tables; the only change to a customer table is the composite UNIQUE key
// users_org_id_id_uq in ./users.ts (the target of the primary-owner foreign key). This module creates NO row: no
// settings row, no Trial or paid package, no version, no subscription, no primary owner, no invitation terms. The
// business values a seed needs (Trial length, seats, storage, module labels) are NOT approved (PO-02D1B).
//
// `drizzle-kit push` creates these tables, keys and indexes; the reviewed, retry-safe SQL that also installs the
// guard and append-only triggers is drizzle/platform/PO02D1_onboarding_foundation.sql (outside the drizzle-kit
// journal, decision D-6). Never run `drizzle-kit generate` for them (PO-00 §F.2).
//
// COLUMN ORDER IS LOAD-BEARING. drizzle-kit 0.31 introspects the columns of a composite foreign key and of a
// composite UNIQUE constraint without their key positions (in table-column order instead), so a key declared in
// any other order is dropped and re-created on every push (measured in PO-02D1A). Every composite key below lists
// its columns in table-column order on BOTH sides, and the columns are positioned so that this order pairs them
// correctly — e.g. tenant_primary_owners has user_id before org_id to match users (id, org_id).
// ---------------------------------------------------------------------------

/**
 * F2 — Schema.md §9 / PRD P-09. Singleton (id = 1). The Stage 2 locked values are CHECKs: manual billing and mandatory
 * platform MFA are always true, the platform currency is SAR and the business time zone Asia/Riyadh. default_trial_days
 * has NO default: the seed must state an owner-approved value. `invite_only` is deliberately absent until the D-3
 * registration cutover (decision R-3): stored as true it would be false while /register is public.
 */
export const platformSettingsTable = pgTable(
  "platform_settings",
  {
    id: smallint("id").primaryKey().default(1),
    defaultTrialDays: integer("default_trial_days").notNull(),
    graceDays: integer("grace_days").notNull().default(0),
    expiryAlertsEnabled: boolean("expiry_alerts_enabled").notNull().default(true),
    manualBilling: boolean("manual_billing").notNull().default(true),
    platformMfaRequired: boolean("platform_mfa_required").notNull().default(true),
    platformCurrency: char("platform_currency", { length: 3 }).notNull().default("SAR"),
    platformTimezone: text("platform_timezone").notNull().default("Asia/Riyadh"),
    updatedByPlatformAdminId: uuid("updated_by_platform_admin_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "platform_settings_updated_by_fk", columns: [t.updatedByPlatformAdminId], foreignColumns: [platformAdminsTable.id] }).onDelete("restrict"),
    check("platform_settings_singleton_chk", sql`${t.id} = 1`),
    check("platform_settings_trial_days_chk", sql`${t.defaultTrialDays} BETWEEN 1 AND 120`),
    check("platform_settings_grace_days_chk", sql`${t.graceDays} BETWEEN 0 AND 60`),
    check("platform_settings_locked_chk", sql`${t.manualBilling} AND ${t.platformMfaRequired}`),
    check("platform_settings_currency_chk", sql`${t.platformCurrency} = 'SAR'`),
    check("platform_settings_timezone_chk", sql`${t.platformTimezone} = 'Asia/Riyadh'`),
  ],
);

/**
 * F3 — Schema.md §6.1. Catalog identity. At most one default Trial, which is a Trial and is never archived; every
 * package but the system-seeded default Trial names the operator who created it. (id, is_trial) is a UNIQUE key so a
 * version can carry is_trial declaratively.
 */
export const subscriptionPackagesTable = pgTable(
  "subscription_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("draft"),
    isTrial: boolean("is_trial").notNull().default(false),
    isDefaultTrial: boolean("is_default_trial").notNull().default(false),
    createdByPlatformAdminId: uuid("created_by_platform_admin_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("subscription_packages_id_trial_uq").on(t.id, t.isTrial),
    foreignKey({ name: "subscription_packages_created_by_fk", columns: [t.createdByPlatformAdminId], foreignColumns: [platformAdminsTable.id] }).onDelete("restrict"),
    check("subscription_packages_code_chk", sql`${t.code} ~ '^[a-z][a-z0-9-]{1,39}$'`),
    check("subscription_packages_name_chk", sql`${t.name} = btrim(${t.name}) AND length(${t.name}) BETWEEN 1 AND 100`),
    check(
      "subscription_packages_description_chk",
      sql`${t.description} IS NULL OR (${t.description} = btrim(${t.description}) AND length(${t.description}) BETWEEN 1 AND 1000)`,
    ),
    check("subscription_packages_status_chk", sql`${t.status} IN ('draft', 'active', 'archived')`),
    check("subscription_packages_default_trial_chk", sql`NOT ${t.isDefaultTrial} OR (${t.isTrial} AND ${t.status} <> 'archived')`),
    check("subscription_packages_attribution_chk", sql`${t.createdByPlatformAdminId} IS NOT NULL OR ${t.isDefaultTrial}`),
    check("subscription_packages_timestamps_chk", sql`${t.updatedAt} >= ${t.createdAt}`),
    uniqueIndex("subscription_packages_code_uq").on(t.code),
    uniqueIndex("subscription_packages_name_uq").on(sql`lower(${t.name})`),
    uniqueIndex("subscription_packages_default_trial_uq").on(t.isDefaultTrial).where(sql`${t.isDefaultTrial}`),
  ],
);

/**
 * F4 — Schema.md §6.2. Commercial terms, SAR numeric(14,2). A PUBLISHED version is immutable and undeletable (guard
 * trigger in the reviewed SQL); a draft may be edited. A Trial version is free with 1–120 trial days; a paid version has
 * none. module_groups is an array of label strings — display only, never enforced (PRD §2.2). (id, publish_state,
 * is_trial) is a UNIQUE key so subscriptions and invitation terms can require a published version declaratively.
 */
export const subscriptionPackageVersionsTable = pgTable(
  "subscription_package_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packageId: uuid("package_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    publishState: text("publish_state").notNull().default("draft"),
    isTrial: boolean("is_trial").notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull().default("SAR"),
    monthlyPrice: numeric("monthly_price", { precision: 14, scale: 2 }).notNull(),
    annualPrice: numeric("annual_price", { precision: 14, scale: 2 }).notNull(),
    includedSeats: integer("included_seats").notNull(),
    storageAllowanceGb: integer("storage_allowance_gb").notNull(),
    moduleGroups: jsonb("module_groups").notNull().default(sql`'[]'::jsonb`),
    trialDays: integer("trial_days").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdByPlatformAdminId: uuid("created_by_platform_admin_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("subscription_package_versions_number_uq").on(t.packageId, t.versionNumber),
    unique("subscription_package_versions_ref_uq").on(t.id, t.publishState, t.isTrial),
    foreignKey({
      name: "subscription_package_versions_package_fk",
      columns: [t.packageId, t.isTrial],
      foreignColumns: [subscriptionPackagesTable.id, subscriptionPackagesTable.isTrial],
    }).onDelete("restrict"),
    foreignKey({ name: "subscription_package_versions_created_by_fk", columns: [t.createdByPlatformAdminId], foreignColumns: [platformAdminsTable.id] }).onDelete("restrict"),
    check("subscription_package_versions_number_chk", sql`${t.versionNumber} > 0`),
    check("subscription_package_versions_state_chk", sql`${t.publishState} IN ('draft', 'published')`),
    check("subscription_package_versions_published_at_chk", sql`(${t.publishState} = 'published') = (${t.publishedAt} IS NOT NULL)`),
    check("subscription_package_versions_currency_chk", sql`${t.currencyCode} = 'SAR'`),
    check("subscription_package_versions_prices_chk", sql`${t.monthlyPrice} >= 0 AND ${t.annualPrice} >= 0`),
    check("subscription_package_versions_seats_chk", sql`${t.includedSeats} >= 1`),
    check("subscription_package_versions_storage_chk", sql`${t.storageAllowanceGb} >= 1`),
    check(
      "subscription_package_versions_modules_chk",
      sql`jsonb_typeof(${t.moduleGroups}) = 'array' AND NOT jsonb_path_exists(${t.moduleGroups}, 'strict $[*] ? (@.type() != "string")', '{}', true)`,
    ),
    check(
      "subscription_package_versions_trial_terms_chk",
      sql`(${t.isTrial} AND ${t.trialDays} BETWEEN 1 AND 120 AND ${t.monthlyPrice} = 0 AND ${t.annualPrice} = 0) OR (NOT ${t.isTrial} AND ${t.trialDays} = 0)`,
    ),
    check("subscription_package_versions_attribution_chk", sql`${t.createdByPlatformAdminId} IS NOT NULL OR ${t.isTrial}`),
  ],
);

/**
 * F5 — Schema.md §4.2. One primary owner per company (PK org_id) and one company per primary owner (UNIQUE user_id).
 * The composite foreign key (user_id, org_id) → users (id, org_id) makes a cross-company owner impossible; the guard
 * trigger requires an active `owner` of the same company at every write and forbids deleting a mapping. No legacy
 * company receives a row (decision O-2). Protecting the mapped user from demotion or deactivation through the
 * existing team screen is PO-03 (decision O-3); until then the drift check R02 detects it.
 */
export const tenantPrimaryOwnersTable = pgTable(
  "tenant_primary_owners",
  {
    userId: integer("user_id").notNull(),
    orgId: integer("org_id").primaryKey(),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    assignedByPlatformAdminId: uuid("assigned_by_platform_admin_id"),
  },
  (t) => [
    unique("tenant_primary_owners_user_uq").on(t.userId),
    foreignKey({ name: "tenant_primary_owners_org_fk", columns: [t.orgId], foreignColumns: [orgsTable.id] }).onDelete("restrict"),
    foreignKey({ name: "tenant_primary_owners_user_fk", columns: [t.userId, t.orgId], foreignColumns: [usersTable.id, usersTable.orgId] }).onDelete("restrict"),
    foreignKey({ name: "tenant_primary_owners_assigned_by_fk", columns: [t.assignedByPlatformAdminId], foreignColumns: [platformAdminsTable.id] }).onDelete("restrict"),
  ],
);

/**
 * F6 — Schema.md §7.1. One CURRENT subscription per company (superseded_at IS NULL); history retained and frozen. It
 * references a PUBLISHED version (version_state is always 'published' and part of the key) with matching Trial-ness;
 * a Trial is free, `trialing` and on the trial cycle; a paid assignment is never `trialing`. Price, seat, storage and
 * module snapshots are immutable (guard trigger). Expired is DERIVED from end_date (business dates, Asia/Riyadh); no
 * column links a subscription to tenant_access_controls, so an expiry can never suspend a company. An invitation
 * acceptance carries no operator (PO-02D3 lock order); every other assignment names one.
 */
export const tenantSubscriptionsTable = pgTable(
  "tenant_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: integer("org_id").notNull(),
    packageVersionId: uuid("package_version_id").notNull(),
    versionState: text("version_state").notNull().default("published"),
    isTrial: boolean("is_trial").notNull(),
    cycle: text("cycle").notNull(),
    lifecycleState: text("lifecycle_state").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    priceSnapshotSar: numeric("price_snapshot_sar", { precision: 14, scale: 2 }).notNull(),
    seatsSnapshot: integer("seats_snapshot").notNull(),
    storageSnapshotGb: integer("storage_snapshot_gb").notNull(),
    moduleGroupsSnapshot: jsonb("module_groups_snapshot").notNull(),
    manualNote: text("manual_note"),
    assignmentSource: text("assignment_source").notNull(),
    createdByPlatformAdminId: uuid("created_by_platform_admin_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("tenant_subscriptions_id_org_uq").on(t.id, t.orgId),
    foreignKey({ name: "tenant_subscriptions_org_fk", columns: [t.orgId], foreignColumns: [orgsTable.id] }).onDelete("restrict"),
    foreignKey({
      name: "tenant_subscriptions_version_fk",
      columns: [t.packageVersionId, t.versionState, t.isTrial],
      foreignColumns: [subscriptionPackageVersionsTable.id, subscriptionPackageVersionsTable.publishState, subscriptionPackageVersionsTable.isTrial],
    }).onDelete("restrict"),
    foreignKey({ name: "tenant_subscriptions_created_by_fk", columns: [t.createdByPlatformAdminId], foreignColumns: [platformAdminsTable.id] }).onDelete("restrict"),
    check("tenant_subscriptions_version_state_chk", sql`${t.versionState} = 'published'`),
    check("tenant_subscriptions_cycle_chk", sql`${t.cycle} IN ('trial', 'monthly', 'annual')`),
    check("tenant_subscriptions_trial_cycle_chk", sql`${t.isTrial} = (${t.cycle} = 'trial')`),
    check("tenant_subscriptions_lifecycle_chk", sql`${t.lifecycleState} IN ('trialing', 'active', 'paused', 'cancelled')`),
    check(
      "tenant_subscriptions_trialing_chk",
      sql`(${t.lifecycleState} = 'trialing') <= (${t.cycle} = 'trial') AND (${t.lifecycleState} = 'active') <= (${t.cycle} <> 'trial')`,
    ),
    check("tenant_subscriptions_dates_chk", sql`${t.endDate} >= ${t.startDate}`),
    check("tenant_subscriptions_price_chk", sql`${t.priceSnapshotSar} >= 0 AND (${t.cycle} <> 'trial' OR ${t.priceSnapshotSar} = 0)`),
    check("tenant_subscriptions_seats_chk", sql`${t.seatsSnapshot} > 0`),
    check("tenant_subscriptions_storage_chk", sql`${t.storageSnapshotGb} > 0`),
    check("tenant_subscriptions_modules_chk", sql`jsonb_typeof(${t.moduleGroupsSnapshot}) = 'array'`),
    check(
      "tenant_subscriptions_note_chk",
      sql`${t.manualNote} IS NULL OR (${t.manualNote} = btrim(${t.manualNote}) AND length(${t.manualNote}) BETWEEN 1 AND 1000)`,
    ),
    check("tenant_subscriptions_source_chk", sql`${t.assignmentSource} IN ('invitation_acceptance', 'platform_assignment')`),
    check("tenant_subscriptions_attribution_chk", sql`${t.assignmentSource} = 'invitation_acceptance' OR ${t.createdByPlatformAdminId} IS NOT NULL`),
    check(
      "tenant_subscriptions_timestamps_chk",
      sql`${t.updatedAt} >= ${t.createdAt} AND (${t.supersededAt} IS NULL OR ${t.supersededAt} >= ${t.createdAt})`,
    ),
    uniqueIndex("tenant_subscriptions_current_uq").on(t.orgId).where(sql`${t.supersededAt} IS NULL`),
    index("tenant_subscriptions_expiry_idx").on(t.endDate, t.lifecycleState).where(sql`${t.supersededAt} IS NULL`),
    index("tenant_subscriptions_version_idx").on(t.packageVersionId, t.supersededAt),
  ],
);

/**
 * F7 — Schema.md §7.2. Append-only subscription history (UPDATE, DELETE and TRUNCATE rejected by PO-01A's
 * platform_reject_mutation). The (tenant_subscription_id, org_id) foreign key keeps an event on its subscription's
 * company. Every event names its operator, except the `assigned` event of an invitation acceptance, labelled
 * `invitee`. A request id makes retries idempotent per (subscription, request, event type).
 */
export const subscriptionEventsTable = pgTable(
  "subscription_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    tenantSubscriptionId: uuid("tenant_subscription_id").notNull(),
    orgId: integer("org_id").notNull(),
    eventType: text("event_type").notNull(),
    actorPlatformAdminId: uuid("actor_platform_admin_id"),
    actorLabel: text("actor_label").notNull(),
    beforeSafe: jsonb("before_safe"),
    afterSafe: jsonb("after_safe"),
    reason: text("reason"),
    requestId: uuid("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "subscription_events_subscription_fk",
      columns: [t.tenantSubscriptionId, t.orgId],
      foreignColumns: [tenantSubscriptionsTable.id, tenantSubscriptionsTable.orgId],
    }).onDelete("restrict"),
    foreignKey({ name: "subscription_events_org_fk", columns: [t.orgId], foreignColumns: [orgsTable.id] }).onDelete("restrict"),
    foreignKey({ name: "subscription_events_actor_fk", columns: [t.actorPlatformAdminId], foreignColumns: [platformAdminsTable.id] }).onDelete("restrict"),
    check(
      "subscription_events_type_chk",
      sql`${t.eventType} IN ('assigned', 'renewed', 'paused', 'resumed', 'superseded', 'cancelled', 'terms_updated')`,
    ),
    check(
      "subscription_events_actor_chk",
      sql`length(btrim(${t.actorLabel})) BETWEEN 1 AND 200 AND (${t.actorPlatformAdminId} IS NOT NULL OR (${t.eventType} = 'assigned' AND ${t.actorLabel} = 'invitee'))`,
    ),
    check(
      "subscription_events_snapshot_chk",
      sql`(${t.beforeSafe} IS NULL OR jsonb_typeof(${t.beforeSafe}) = 'object') AND (${t.afterSafe} IS NULL OR jsonb_typeof(${t.afterSafe}) = 'object')`,
    ),
    check("subscription_events_reason_chk", sql`${t.reason} IS NULL OR (${t.reason} = btrim(${t.reason}) AND length(${t.reason}) BETWEEN 1 AND 1000)`),
    uniqueIndex("subscription_events_request_uq").on(t.tenantSubscriptionId, t.requestId, t.eventType).where(sql`${t.requestId} IS NOT NULL`),
    index("subscription_events_subscription_idx").on(t.tenantSubscriptionId, t.createdAt.desc()),
    index("subscription_events_org_idx").on(t.orgId, t.createdAt.desc()),
  ],
);

/**
 * F8 — Schema.md §5.1's deferred initial_package_version_id and initial_cycle, one immutable row per invitation
 * (decision I-1: a 1:1 table keeps PO-02A's organization_invitations exactly as reviewed). Only a PUBLISHED version
 * can be named, with a cycle consistent with its Trial-ness. Written by PO-02D2 with the invitation; nothing writes
 * it in PO-02D1A.
 */
export const organizationInvitationTermsTable = pgTable(
  "organization_invitation_terms",
  {
    invitationId: uuid("invitation_id").primaryKey(),
    initialPackageVersionId: uuid("initial_package_version_id").notNull(),
    initialVersionState: text("initial_version_state").notNull().default("published"),
    initialIsTrial: boolean("initial_is_trial").notNull(),
    initialCycle: text("initial_cycle").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "organization_invitation_terms_invitation_fk",
      columns: [t.invitationId],
      foreignColumns: [organizationInvitationsTable.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "organization_invitation_terms_version_fk",
      columns: [t.initialPackageVersionId, t.initialVersionState, t.initialIsTrial],
      foreignColumns: [subscriptionPackageVersionsTable.id, subscriptionPackageVersionsTable.publishState, subscriptionPackageVersionsTable.isTrial],
    }).onDelete("restrict"),
    check("organization_invitation_terms_state_chk", sql`${t.initialVersionState} = 'published'`),
    check(
      "organization_invitation_terms_cycle_chk",
      sql`${t.initialCycle} IN ('trial', 'monthly', 'annual') AND ${t.initialIsTrial} = (${t.initialCycle} = 'trial')`,
    ),
    index("organization_invitation_terms_version_idx").on(t.initialPackageVersionId),
  ],
);

export type PlatformSettings = typeof platformSettingsTable.$inferSelect;
export type SubscriptionPackage = typeof subscriptionPackagesTable.$inferSelect;
export type SubscriptionPackageVersion = typeof subscriptionPackageVersionsTable.$inferSelect;
export type TenantPrimaryOwner = typeof tenantPrimaryOwnersTable.$inferSelect;
export type TenantSubscription = typeof tenantSubscriptionsTable.$inferSelect;
export type SubscriptionEvent = typeof subscriptionEventsTable.$inferSelect;
export type OrganizationInvitationTerms = typeof organizationInvitationTermsTable.$inferSelect;
