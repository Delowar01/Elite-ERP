import { pgTable, serial, integer, text, boolean, timestamp, jsonb, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgsTable } from "./orgs";
import { usersTable } from "./users";

// Batch F — Terms & Conditions Groups. A named group of ordered terms, optionally scoped to a
// document type, with at most one default per (org, documentType) enforced in the action layer
// (same pattern as note_templates). Tenant-scoped; used in documents to pre-fill/insert terms.
// Terms are stored structured: an ordered jsonb array of term strings, so each term keeps its own
// content, its own position (array index), and its own multiline text — rather than a single
// newline-joined blob (which could not represent a multiline term).
export const termsConditionsGroupsTable = pgTable("terms_conditions_groups", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  documentType: text("document_type"),
  terms: jsonb("terms").$type<string[]>().notNull().default([]),
  isDefault: boolean("is_default").notNull().default(false),
});
export const insertTermsConditionsGroupSchema = createInsertSchema(termsConditionsGroupsTable).omit({ id: true });
export type InsertTermsConditionsGroup = z.infer<typeof insertTermsConditionsGroupSchema>;
export type TermsConditionsGroup = typeof termsConditionsGroupsTable.$inferSelect;

// Batch F — per-user Favorites: a saved shortcut (label + in-app href) shown in the global shell.
// User-specific AND tenant-scoped; unique per (org, user, href) so toggling is idempotent.
export const favoritesTable = pgTable(
  "favorites",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
      .notNull()
      .references(() => orgsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    href: text("href").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique("favorites_org_user_href_uq").on(t.orgId, t.userId, t.href)],
);
export type Favorite = typeof favoritesTable.$inferSelect;
