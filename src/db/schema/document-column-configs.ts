import { pgTable, serial, integer, text, jsonb, timestamp, unique } from "drizzle-orm/pg-core";
import { orgsTable } from "./orgs";
import { usersTable } from "./users";

// Per-user, per-document-type line-item column configuration (Edit Columns / Configure Columns).
// Tenant- AND user-scoped: exactly one row per (org, user, documentType). `config` holds the
// serialized ColumnDef[] (order, visibility, labels, widths, and any custom/formula columns).
export const documentColumnConfigsTable = pgTable(
  "document_column_configs",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
      .notNull()
      .references(() => orgsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    documentType: text("document_type").notNull(),
    config: jsonb("config").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("document_column_configs_uq").on(t.orgId, t.userId, t.documentType)],
);
export type DocumentColumnConfig = typeof documentColumnConfigsTable.$inferSelect;
