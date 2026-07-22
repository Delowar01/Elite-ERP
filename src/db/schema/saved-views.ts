import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgsTable } from "./orgs";
import { usersTable } from "./users";

// Batch B — a user's saved list filters/settings for a document module. Tenant- AND
// user-scoped: a saved view belongs to exactly one (org, user, module) and is never
// visible to another user or org.
export const savedViewsTable = pgTable("saved_views", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  // Document module key, e.g. "quotation", "sales_order", … (a DocumentType value).
  module: text("module").notNull(),
  name: text("name").notNull(),
  // Serialized ListFilterState { search, status, dateFrom, dateTo, party, archived }.
  config: jsonb("config").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertSavedViewSchema = createInsertSchema(savedViewsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSavedView = z.infer<typeof insertSavedViewSchema>;
export type SavedView = typeof savedViewsTable.$inferSelect;
