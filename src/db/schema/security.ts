import { pgTable, serial, integer, text, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { orgsTable } from "./orgs";
import { usersTable } from "./users";

// ---------------------------------------------------------------------------
// Stage 11 — Enterprise security schema. All additive; no existing column or
// table is changed, so this is fully backward-compatible.
// ---------------------------------------------------------------------------

// Active sessions: one row per issued session token. The JWT stays the transport,
// but a server-side row lets us list devices, terminate individual sessions, and
// hard-invalidate on password/role/disable/MFA changes (JWT alone can't be revoked).
export const sessionsTable = pgTable(
  "sessions",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
      .notNull()
      .references(() => orgsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // Random opaque token id carried inside the JWT (jti). We store only its SHA-256 hash.
    tokenHash: text("token_hash").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    browser: text("browser"),
    os: text("os"),
    device: text("device"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastActivityAt: timestamp("last_activity_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    revokedReason: text("revoked_reason"), // logout | logout_all | password_change | role_change | disabled | mfa_change | expired
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_token_idx").on(t.tokenHash)],
);
export type Session = typeof sessionsTable.$inferSelect;

// Password history for reuse prevention (keep last N hashes).
export const passwordHistoryTable = pgTable(
  "password_history",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("pwd_history_user_idx").on(t.userId)],
);
export type PasswordHistory = typeof passwordHistoryTable.$inferSelect;

// Security events — the append-only feed behind the Security Center + threat detection.
// Distinct from activity_logs (business events); this table is security/audit only.
export const securityEventsTable = pgTable(
  "security_events",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id").references(() => orgsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    email: text("email"), // captured even for failed logins where no user resolves
    type: text("type").notNull(), // login.success | login.failed | password.changed | role.changed | mfa.enabled | ...
    severity: text("severity").notNull().default("info"), // info | low | medium | high | critical
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    browser: text("browser"),
    os: text("os"),
    device: text("device"),
    detail: text("detail"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("sec_events_org_idx").on(t.orgId), index("sec_events_type_idx").on(t.type), index("sec_events_email_idx").on(t.email)],
);
export type SecurityEvent = typeof securityEventsTable.$inferSelect;

// Immutable audit trail (Part 9). Append-only enforced at the app layer (no update/delete
// helpers exist) and, in production, by a DB trigger — see drizzle/immutable_audit.sql.
export const auditLogsTable = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id").references(() => orgsTable.id, { onDelete: "set null" }),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    userName: text("user_name"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: integer("entity_id"),
    previousValue: jsonb("previous_value"),
    newValue: jsonb("new_value"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    browser: text("browser"),
    os: text("os"),
    device: text("device"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_org_idx").on(t.orgId), index("audit_entity_idx").on(t.entityType, t.entityId)],
);
export type AuditLog = typeof auditLogsTable.$inferSelect;

// Download/access log for protected files (Part 3).
export const fileAccessLogsTable = pgTable(
  "file_access_logs",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
      .notNull()
      .references(() => orgsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    folder: text("folder").notNull(),
    fileName: text("file_name").notNull(),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("file_access_org_idx").on(t.orgId)],
);
export type FileAccessLog = typeof fileAccessLogsTable.$inferSelect;

// GDPR consent tracking (Part 5).
export const consentRecordsTable = pgTable("consent_records", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  subject: text("subject").notNull(), // e.g. "privacy_policy", "data_processing"
  granted: boolean("granted").notNull(),
  version: text("version"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type ConsentRecord = typeof consentRecordsTable.$inferSelect;
