import { pgTable, serial, integer, text, numeric, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgsTable } from "./orgs";
import { vendorsTable } from "./vendors";
import { productsTable } from "./products";
import { usersTable } from "./users";
import { purchaseOrdersTable } from "./purchase-orders";

export const debitNotesTable = pgTable("debit_notes", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  debitNoteNumber: text("debit_note_number").notNull(),
  title: text("title"),
  vendorId: integer("vendor_id")
    .notNull()
    .references(() => vendorsTable.id),
  sourcePurchaseOrderId: integer("source_purchase_order_id")
    .notNull()
    .references(() => purchaseOrdersTable.id),
  reason: text("reason"),
  status: text("status").notNull().default("draft"), // draft | issued
  issueDate: date("issue_date").notNull(),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  discount: numeric("discount", { precision: 14, scale: 2 }).notNull().default("0"),
  taxTotal: numeric("tax_total", { precision: 14, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 14, scale: 2 }).notNull().default("0"),
  createdById: integer("created_by_id")
    .notNull()
    .references(() => usersTable.id),
  // Batch A3 — record-state columns (orthogonal to business status): NULL = active.
  archivedAt: timestamp("archived_at"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertDebitNoteSchema = createInsertSchema(debitNotesTable).omit({ id: true, createdAt: true });
export type InsertDebitNote = z.infer<typeof insertDebitNoteSchema>;
export type DebitNote = typeof debitNotesTable.$inferSelect;

export const debitNoteItemsTable = pgTable("debit_note_items", {
  id: serial("id").primaryKey(),
  debitNoteId: integer("debit_note_id")
    .notNull()
    .references(() => debitNotesTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id),
  description: text("description"),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull().default("1"),
  unitCost: numeric("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  taxRatePercent: numeric("tax_rate_percent", { precision: 5, scale: 2 }).notNull().default("15"),
  lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull().default("0"),
});
export type DebitNoteItem = typeof debitNoteItemsTable.$inferSelect;
