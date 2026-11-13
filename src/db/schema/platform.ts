import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  bigint,
  bigserial,
  integer,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { orgsTable } from "./orgs";

// ---------------------------------------------------------------------------
// Platform Owner — PO-01A identity foundation (docs/platform-owner/PO00_BASELINE.md,
// PR #11 Schema.md §3.1–3.4).
//
// These tables are deliberately SEPARATE from tenant identity: no org_id on an admin, no
// tenant role, no row in `users`. Nothing here references `users` or `sessions`, and no
// existing table is altered. The only reference into tenant data is the nullable
// `platform_audit_events.org_id → orgs(id) ON DELETE RESTRICT` that Schema.md §3.4 specifies.
//
// `drizzle-kit push` creates these tables but NOT the append-only triggers. The reviewed,
// idempotent SQL in drizzle/platform/PO01_platform_identity.sql creates both, and the
// platform library refuses to run while the triggers are missing (assertPlatformAuditProtection).
// Never run `drizzle-kit generate` for these tables: it would bundle the unrelated historical
// migration drift recorded in PO-00 §F.2.
//
// Timestamps are timestamptz (Schema.md principle 5). All security timing (expiry, idle,
// throttling) is computed from the application clock and written explicitly, so CHECKs compare
// values from one clock.
// ---------------------------------------------------------------------------

/** Schema.md §3.1 — one row per Platform Owner operator. Never a tenant `users` row. */
export const platformAdminsTable = pgTable(
  "platform_admins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    emailNormalized: text("email_normalized").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    // Field-encrypted TOTP secret (src/lib/crypto/field-encryption.ts envelope). Never plaintext.
    mfaSecretEncrypted: text("mfa_secret_encrypted"),
    // bcrypt hashes of the single-use recovery codes. Hashes only; a used code is removed.
    mfaRecoveryHashes: jsonb("mfa_recovery_hashes").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    mfaEnrolledAt: timestamp("mfa_enrolled_at", { withTimezone: true }),
    // Highest TOTP time step ever accepted; a code for this step or an earlier one is a replay.
    // PO-00 §C.2 C-8 refinement (the shared TOTP helper keeps no such state).
    mfaLastTotpStep: bigint("mfa_last_totp_step", { mode: "number" }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("platform_admins_email_lower_uq").on(sql`lower(${t.emailNormalized})`),
    index("platform_admins_active_idx").on(t.isActive).where(sql`${t.isActive}`),
    check(
      "platform_admins_email_chk",
      sql`${t.emailNormalized} = lower(btrim(${t.emailNormalized})) AND length(${t.emailNormalized}) <= 320 AND ${t.emailNormalized} ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'`,
    ),
    check("platform_admins_display_name_chk", sql`length(btrim(${t.displayName})) >= 1 AND length(${t.displayName}) <= 200`),
    // bcrypt only — makes plaintext or foreign password storage impossible at the DB layer.
    check("platform_admins_password_hash_chk", sql`${t.passwordHash} ~ '^[$]2[aby][$][0-9]{2}[$][./A-Za-z0-9]{53}$'`),
    // field-encryption envelope v<ver>:<iv>:<tag>:<ciphertext> — a base32 TOTP seed can never match.
    check(
      "platform_admins_mfa_secret_chk",
      sql`${t.mfaSecretEncrypted} IS NULL OR ${t.mfaSecretEncrypted} ~ '^v[0-9]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$'`,
    ),
    check(
      "platform_admins_recovery_hashes_chk",
      sql`jsonb_typeof(${t.mfaRecoveryHashes}) = 'array' AND jsonb_array_length(${t.mfaRecoveryHashes}) <= 16`,
    ),
    // Mandatory MFA: an active operator must have an enrolled, encrypted TOTP secret.
    check(
      "platform_admins_active_requires_mfa_chk",
      sql`NOT ${t.isActive} OR (${t.mfaSecretEncrypted} IS NOT NULL AND ${t.mfaEnrolledAt} IS NOT NULL)`,
    ),
    check("platform_admins_totp_step_chk", sql`${t.mfaLastTotpStep} IS NULL OR ${t.mfaLastTotpStep} >= 0`),
  ],
);

/**
 * Schema.md §3.2 — revocable, server-side platform sessions. Only the SHA-256 of the token's
 * opaque `jti` is stored. A row is written only after MFA succeeds, so `mfa_verified_at` is
 * NOT NULL ("must be non-null on active sessions"). 12 h is the provisional absolute ceiling
 * (PO-00 D-9, owner confirmation required before production).
 */
export const platformSessionsTable = pgTable(
  "platform_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platformAdminId: uuid("platform_admin_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (t) => [
    foreignKey({ name: "platform_sessions_admin_fk", columns: [t.platformAdminId], foreignColumns: [platformAdminsTable.id] }).onDelete(
      "restrict",
    ),
    uniqueIndex("platform_sessions_token_hash_uq").on(t.tokenHash),
    index("platform_sessions_admin_state_idx").on(t.platformAdminId, t.revokedAt, t.expiresAt),
    check("platform_sessions_token_hash_chk", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "platform_sessions_expiry_chk",
      sql`${t.expiresAt} > ${t.createdAt} AND ${t.expiresAt} <= ${t.createdAt} + interval '12 hours'`,
    ),
    check("platform_sessions_last_seen_chk", sql`${t.lastSeenAt} >= ${t.createdAt}`),
    check("platform_sessions_mfa_chk", sql`${t.mfaVerifiedAt} <= ${t.lastSeenAt}`),
    check(
      "platform_sessions_revocation_chk",
      // `revoked_reason IS NOT NULL` is required explicitly: `NULL IN (…)` is NULL, which a CHECK accepts.
      sql`(${t.revokedAt} IS NULL AND ${t.revokedReason} IS NULL) OR (${t.revokedAt} IS NOT NULL AND ${t.revokedReason} IS NOT NULL AND ${t.revokedReason} IN ('logout', 'logout_all', 'revoked', 'idle_timeout', 'expired', 'password_change', 'mfa_change', 'admin_disabled'))`,
    ),
  ],
);

/**
 * Schema.md §3.3 — durable login throttling. E-mail and IP are stored only as keyed HMAC-SHA-256
 * digests (src/lib/platform/throttle.ts), never plaintext; no password or TOTP is ever stored.
 */
export const platformLoginAttemptsTable = pgTable(
  "platform_login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    emailHash: text("email_hash"),
    ipHash: text("ip_hash"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
    outcome: text("outcome").notNull(),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }),
  },
  (t) => [
    index("platform_login_attempts_email_idx").on(t.emailHash, t.attemptedAt),
    index("platform_login_attempts_ip_idx").on(t.ipHash, t.attemptedAt),
    check("platform_login_attempts_outcome_chk", sql`${t.outcome} IN ('success', 'failure', 'blocked', 'mfa_required')`),
    check("platform_login_attempts_email_hash_chk", sql`${t.emailHash} IS NULL OR ${t.emailHash} ~ '^[0-9a-f]{64}$'`),
    check("platform_login_attempts_ip_hash_chk", sql`${t.ipHash} IS NULL OR ${t.ipHash} ~ '^[0-9a-f]{64}$'`),
    check("platform_login_attempts_blocked_chk", sql`${t.blockedUntil} IS NULL OR ${t.blockedUntil} > ${t.attemptedAt}`),
  ],
);

/**
 * Schema.md §3.4 — append-only operator audit. UPDATE, DELETE and TRUNCATE are rejected by
 * triggers installed from drizzle/platform/PO01_platform_identity.sql; the library exposes no
 * update/delete helper. Snapshots are redacted (no secrets, tokens, hashes or codes).
 */
export const platformAuditEventsTable = pgTable(
  "platform_audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorPlatformAdminId: uuid("actor_platform_admin_id"),
    actorLabel: text("actor_label").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    orgId: integer("org_id"),
    reason: text("reason"),
    beforeSafe: jsonb("before_safe"),
    afterSafe: jsonb("after_safe"),
    result: text("result").notNull(),
    requestId: uuid("request_id"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "platform_audit_events_actor_fk",
      columns: [t.actorPlatformAdminId],
      foreignColumns: [platformAdminsTable.id],
    }).onDelete("restrict"),
    foreignKey({ name: "platform_audit_events_org_fk", columns: [t.orgId], foreignColumns: [orgsTable.id] }).onDelete("restrict"),
    index("platform_audit_events_org_idx").on(t.orgId, t.createdAt.desc()),
    index("platform_audit_events_actor_idx").on(t.actorPlatformAdminId, t.createdAt.desc()),
    index("platform_audit_events_action_idx").on(t.action, t.createdAt.desc()),
    index("platform_audit_events_request_idx").on(t.requestId),
    check("platform_audit_events_action_chk", sql`${t.action} ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'`),
    check("platform_audit_events_result_chk", sql`${t.result} IN ('success', 'rejected', 'failed')`),
    check(
      "platform_audit_events_entity_chk",
      sql`length(btrim(${t.entityType})) >= 1 AND length(btrim(${t.entityId})) >= 1 AND length(btrim(${t.actorLabel})) >= 1`,
    ),
    check(
      "platform_audit_events_snapshot_chk",
      sql`(${t.beforeSafe} IS NULL OR jsonb_typeof(${t.beforeSafe}) = 'object') AND (${t.afterSafe} IS NULL OR jsonb_typeof(${t.afterSafe}) = 'object')`,
    ),
  ],
);

export type PlatformAdmin = typeof platformAdminsTable.$inferSelect;
export type PlatformSession = typeof platformSessionsTable.$inferSelect;
export type PlatformLoginAttempt = typeof platformLoginAttemptsTable.$inferSelect;
export type PlatformAuditEvent = typeof platformAuditEventsTable.$inferSelect;
