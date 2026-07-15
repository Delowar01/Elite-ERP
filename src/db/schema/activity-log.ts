import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { orgsTable } from "./orgs";
import { usersTable } from "./users";

export const activityLogsTable = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  description: text("description").notNull(),
  // entityType/entityId let a document's Timeline / Version History (later section) query
  // "every activity-log row for this record" without a parallel tracking table.
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  userId: integer("user_id").references(() => usersTable.id),
  userName: text("user_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ActivityLog = typeof activityLogsTable.$inferSelect;
