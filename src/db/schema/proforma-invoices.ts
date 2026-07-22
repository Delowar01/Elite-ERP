import { pgTable, serial, integer, text, numeric, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgsTable } from "./orgs";
import { customersTable } from "./customers";
import { productsTable } from "./products";
import { usersTable } from "./users";
import { salesOrdersTable } from "./sales-orders";

export const proformaInvoicesTable = pgTable("proforma_invoices", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  proformaNumber: text("proforma_number").notNull(),
  title: text("title"),
  customerId: integer("customer_id")
    .notNull()
    .references(() => customersTable.id),
  sourceSalesOrderId: integer("source_sales_order_id").references(() => salesOrdersTable.id),
  status: text("status").notNull().default("draft"), // draft | sent — non-posting, never affects accounting/stock
  issueDate: date("issue_date").notNull(),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  discount: numeric("discount", { precision: 14, scale: 2 }).notNull().default("0"),
  taxTotal: numeric("tax_total", { precision: 14, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 14, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  createdById: integer("created_by_id")
    .notNull()
    .references(() => usersTable.id),
  // Batch A3 — record-state columns (orthogonal to business status): NULL = active.
  archivedAt: timestamp("archived_at"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertProformaInvoiceSchema = createInsertSchema(proformaInvoicesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProformaInvoice = z.infer<typeof insertProformaInvoiceSchema>;
export type ProformaInvoice = typeof proformaInvoicesTable.$inferSelect;

export const proformaInvoiceItemsTable = pgTable("proforma_invoice_items", {
  id: serial("id").primaryKey(),
  proformaInvoiceId: integer("proforma_invoice_id")
    .notNull()
    .references(() => proformaInvoicesTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id),
  description: text("description"),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull().default("1"),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
  taxRatePercent: numeric("tax_rate_percent", { precision: 5, scale: 2 }).notNull().default("15"),
  lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull().default("0"),
});
export type ProformaInvoiceItem = typeof proformaInvoiceItemsTable.$inferSelect;
