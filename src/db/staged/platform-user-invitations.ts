import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, index, uniqueIndex, check, foreignKey } from "drizzle-orm/pg-core";
import { orgsTable } from "../schema/orgs";
import { usersTable } from "../schema/users";
import { platformAdminsTable } from "../schema/platform";

// ---------------------------------------------------------------------------
// Platform Owner — PO-03C (sub-batch C) — customer-user invitations, STAGED (Stage 2 Schema.md §5.2;
// docs/platform-owner/PO03C_DEVELOPMENT.md §F–§G).
//
// STAGED, NOT PART OF THE SCHEMA: this module lives outside src/db/schema and is NOT exported from
// src/db/schema/index.ts, so `db:push`, the full-schema push of every test database and every existing
// catalog comparison are unchanged. The table exists only where the reviewed, retry-safe SQL
// drizzle/platform/PO03C_user_invitations.sql has been applied — today only the disposable databases of
// verify:platform-user-invitations (it is NOT in the platform SQL chain; applying it anywhere else is an
// owner decision). verify:platform-user-invitations proves the two catalog-equivalent.
//
// Every reader and writer checks that the table exists (to_regclass) and fails closed when it does not:
// the console reports "not installed" and seat accounting counts no reservation.
//
// Only SHA-256(token) is stored. open -> revoked | accepted (terminal, exclusive) | expired (derived from
// time). One open invitation per normalized e-mail (customer e-mails are globally unique); a re-issue
// revokes the old row first. The guard trigger (in the SQL; push never creates triggers) keeps the terms
// immutable and the row undeletable. Acceptance (accepted_at / accepted_user_id) is PO-04: nothing writes
// those columns yet.
// ---------------------------------------------------------------------------

export const userInvitationsTable = pgTable(
  "user_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: integer("org_id").notNull(),
    name: text("name").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    requestedRole: text("requested_role").notNull(),
    tokenHash: text("token_hash").notNull(),
    // Default 72 h (Schema.md §5.1/5.2), in PostgreSQL's canonical form (the company invitations' default has the same form).
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`(now() + '72:00:00'::interval)`),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedUserId: integer("accepted_user_id"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByPlatformAdminId: uuid("revoked_by_platform_admin_id"),
    invitedByPlatformAdminId: uuid("invited_by_platform_admin_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "user_invitations_org_fk", columns: [t.orgId], foreignColumns: [orgsTable.id] }).onDelete("restrict"),
    foreignKey({ name: "user_invitations_accepted_user_fk", columns: [t.acceptedUserId], foreignColumns: [usersTable.id] }).onDelete("restrict"),
    foreignKey({ name: "user_invitations_revoked_by_fk", columns: [t.revokedByPlatformAdminId], foreignColumns: [platformAdminsTable.id] }).onDelete("restrict"),
    foreignKey({ name: "user_invitations_invited_by_fk", columns: [t.invitedByPlatformAdminId], foreignColumns: [platformAdminsTable.id] }).onDelete("restrict"),
    uniqueIndex("user_invitations_token_hash_uq").on(t.tokenHash),
    // One current invitation per e-mail, platform-wide (expiry is derived from time, so the database rule is
    // "unaccepted and unrevoked"; a re-issue revokes the old row first, in the same transaction).
    uniqueIndex("user_invitations_open_email_uq")
      .on(t.emailNormalized)
      .where(sql`${t.acceptedAt} IS NULL AND ${t.revokedAt} IS NULL`),
    uniqueIndex("user_invitations_accepted_user_uq").on(t.acceptedUserId).where(sql`${t.acceptedUserId} IS NOT NULL`),
    index("user_invitations_org_email_idx").on(t.orgId, t.emailNormalized),
    index("user_invitations_org_expiry_idx").on(t.orgId, t.expiresAt),
    // SHA-256 hex of a high-entropy random token: a plaintext token or link cannot match.
    check("user_invitations_token_hash_chk", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "user_invitations_email_chk",
      sql`${t.emailNormalized} = lower(btrim(${t.emailNormalized})) AND length(${t.emailNormalized}) <= 320 AND ${t.emailNormalized} ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'`,
    ),
    check("user_invitations_name_chk", sql`${t.name} = btrim(${t.name}) AND length(${t.name}) BETWEEN 1 AND 200`),
    // Never "owner": a company's owners come from registration, acceptance of a company invitation, a role change or
    // a primary-owner transfer — never from a user invitation.
    check("user_invitations_role_chk", sql`${t.requestedRole} IN ('admin', 'staff')`),
    check("user_invitations_expiry_chk", sql`${t.expiresAt} > ${t.createdAt} AND ${t.expiresAt} <= ${t.createdAt} + interval '30 days'`),
    check("user_invitations_terminal_chk", sql`${t.acceptedAt} IS NULL OR ${t.revokedAt} IS NULL`),
    check("user_invitations_acceptance_chk", sql`(${t.acceptedAt} IS NULL) = (${t.acceptedUserId} IS NULL)`),
    check("user_invitations_acceptance_window_chk", sql`${t.acceptedAt} IS NULL OR (${t.acceptedAt} >= ${t.createdAt} AND ${t.acceptedAt} <= ${t.expiresAt})`),
    check("user_invitations_revocation_chk", sql`(${t.revokedAt} IS NULL) = (${t.revokedByPlatformAdminId} IS NULL)`),
    check("user_invitations_revocation_time_chk", sql`${t.revokedAt} IS NULL OR ${t.revokedAt} >= ${t.createdAt}`),
  ],
);

export type UserInvitation = typeof userInvitationsTable.$inferSelect;
