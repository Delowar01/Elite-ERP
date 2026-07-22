import { pgTable, serial, integer, text, jsonb, timestamp, unique } from "drizzle-orm/pg-core";
import { orgsTable } from "./orgs";
import { usersTable } from "./users";
import { activityLogsTable } from "./activity-log";

// Batch E — per-user shell/dashboard preferences. Exactly one row per (org, user);
// tenant- AND user-scoped. Holds the dashboard date-range default, the saved dashboard
// layout (widget visibility + order), and the "mark all notifications read" watermark.
export const userPreferencesTable = pgTable(
  "user_preferences",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
      .notNull()
      .references(() => orgsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // Dashboard date range key: this_month | last_month | last_7_days | last_30_days | this_quarter | this_year | all_time
    dashboardRange: text("dashboard_range").notNull().default("this_month"),
    // Serialized DashboardLayout: array of { key, visible } in display order.
    dashboardLayout: jsonb("dashboard_layout"),
    // "Mark all as read" watermark — every notification at/older than this is considered read.
    notificationsReadAt: timestamp("notifications_read_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("user_preferences_org_user_uq").on(t.orgId, t.userId)],
);
export type UserPreferences = typeof userPreferencesTable.$inferSelect;

// Batch E — per-item notification read state. A notification is "read" for a user when either
// there is a row here for its activity id, or its createdAt <= that user's notificationsReadAt
// watermark. Kept separate from the append-only activity_logs audit feed, which is never mutated.
export const notificationReadsTable = pgTable(
  "notification_reads",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
      .notNull()
      .references(() => orgsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    activityId: integer("activity_id")
      .notNull()
      .references(() => activityLogsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique("notification_reads_uq").on(t.orgId, t.userId, t.activityId)],
);
export type NotificationRead = typeof notificationReadsTable.$inferSelect;
