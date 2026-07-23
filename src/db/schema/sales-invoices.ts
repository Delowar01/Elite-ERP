import { pgTable, serial, integer, text, numeric, date, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgsTable } from "./orgs";
import { customersTable } from "./customers";
import { productsTable } from "./products";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { salesOrdersTable } from "./sales-orders";

export const salesInvoicesTable = pgTable("sales_invoices", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  invoiceNumber: text("invoice_number").notNull(),
  title: text("title"),
  customerId: integer("customer_id")
    .notNull()
    .references(() => customersTable.id),
  projectId: integer("project_id").references(() => projectsTable.id),
  sourceSalesOrderId: integer("source_sales_order_id").references(() => salesOrdersTable.id),
  status: text("status").notNull().default("draft"), // draft | sent | partially_paid | paid | void
  issueDate: date("issue_date").notNull(),
  dueDate: date("due_date"),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  discount: numeric("discount", { precision: 14, scale: 2 }).notNull().default("0"),
  taxTotal: numeric("tax_total", { precision: 14, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 14, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  createdById: integer("created_by_id")
    .notNull()
    .references(() => usersTable.id),

  // E-invoicing (ZATCA-aligned, Phase-1 style — see plan §2 for scope)
  invoiceType: text("invoice_type").notNull().default("simplified"), // standard | simplified
  qrCodeData: text("qr_code_data"),
  invoiceHash: text("invoice_hash"),
  previousInvoiceHash: text("previous_invoice_hash"),

  // Batch A3 — record-state columns (orthogonal to business status): NULL = active.
  archivedAt: timestamp("archived_at"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertSalesInvoiceSchema = createInsertSchema(salesInvoicesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSalesInvoice = z.infer<typeof insertSalesInvoiceSchema>;
export type SalesInvoice = typeof salesInvoicesTable.$inferSelect;

export const salesInvoiceItemsTable = pgTable("sales_invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id")
    .notNull()
    .references(() => salesInvoicesTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id),
  imageUrl: text("image_url"),
  unit: text("unit"),
  customFields: jsonb("custom_fields"),
  description: text("description"),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull().default("1"),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
  taxRatePercent: numeric("tax_rate_percent", { precision: 5, scale: 2 }).notNull().default("15"),
  lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull().default("0"),
});
export type SalesInvoiceItem = typeof salesInvoiceItemsTable.$inferSelect;
