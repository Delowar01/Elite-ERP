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
  userId: integer("user_id").references(() => usersTable.id),
  userName: text("user_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ActivityLog = typeof activityLogsTable.$inferSelect;
