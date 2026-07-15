import { pgTable, serial, integer, text, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgsTable } from "./orgs";
import { productsTable } from "./products";

export const taxPresetsTable = pgTable("tax_presets", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  ratePercent: numeric("rate_percent", { precision: 5, scale: 2 }).notNull(),
});
export const insertTaxPresetSchema = createInsertSchema(taxPresetsTable).omit({ id: true });
export type InsertTaxPreset = z.infer<typeof insertTaxPresetSchema>;
export type TaxPreset = typeof taxPresetsTable.$inferSelect;

export const paymentTermPresetsTable = pgTable("payment_term_presets", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  netDays: integer("net_days").notNull().default(0),
});
export const insertPaymentTermPresetSchema = createInsertSchema(paymentTermPresetsTable).omit({ id: true });
export type InsertPaymentTermPreset = z.infer<typeof insertPaymentTermPresetSchema>;
export type PaymentTermPreset = typeof paymentTermPresetsTable.$inferSelect;

export const unitsTable = pgTable("units", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  abbreviation: text("abbreviation").notNull(),
});
export const insertUnitSchema = createInsertSchema(unitsTable).omit({ id: true });
export type InsertUnit = z.infer<typeof insertUnitSchema>;
export type Unit = typeof unitsTable.$inferSelect;

export const noteTemplatesTable = pgTable("note_templates", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  documentType: text("document_type"),
  content: text("content").notNull(),
  // Pre-filled by default when a new document of `documentType` is created. At most one default
  // per (orgId, documentType) — enforced in the action layer, not a DB constraint (documentType
  // is nullable for "applies to any type" templates, which a partial unique index can't express
  // cleanly across nulls).
  isDefault: boolean("is_default").notNull().default(false),
});
export const insertNoteTemplateSchema = createInsertSchema(noteTemplatesTable).omit({ id: true });
export type InsertNoteTemplate = z.infer<typeof insertNoteTemplateSchema>;
export type NoteTemplate = typeof noteTemplatesTable.$inferSelect;

export const productBundlesTable = pgTable("product_bundles", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
});
export const insertProductBundleSchema = createInsertSchema(productBundlesTable).omit({ id: true });
export type InsertProductBundle = z.infer<typeof insertProductBundleSchema>;
export type ProductBundle = typeof productBundlesTable.$inferSelect;

export const productBundleItemsTable = pgTable("product_bundle_items", {
  id: serial("id").primaryKey(),
  bundleId: integer("bundle_id")
    .notNull()
    .references(() => productBundlesTable.id, { onDelete: "cascade" }),
  productId: integer("product_id")
    .notNull()
    .references(() => productsTable.id),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull().default("1"),
});
export type ProductBundleItem = typeof productBundleItemsTable.$inferSelect;

export const productCategoriesTable = pgTable("product_categories", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
});
export const insertProductCategorySchema = createInsertSchema(productCategoriesTable).omit({ id: true });
export type InsertProductCategory = z.infer<typeof insertProductCategorySchema>;
export type ProductCategory = typeof productCategoriesTable.$inferSelect;

export const leaveTypesTable = pgTable("leave_types", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  daysPerYear: integer("days_per_year"),
});
export const insertLeaveTypeSchema = createInsertSchema(leaveTypesTable).omit({ id: true });
export type InsertLeaveType = z.infer<typeof insertLeaveTypeSchema>;
export type LeaveType = typeof leaveTypesTable.$inferSelect;

export const expenseCategoriesTable = pgTable("expense_categories", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
});
export const insertExpenseCategorySchema = createInsertSchema(expenseCategoriesTable).omit({ id: true });
export type InsertExpenseCategory = z.infer<typeof insertExpenseCategorySchema>;
export type ExpenseCategory = typeof expenseCategoriesTable.$inferSelect;
