import { pgTable, serial, integer, text, numeric, date, timestamp, jsonb } from "drizzle-orm/pg-core";
import type { DocBankAccount } from "@/lib/document-bank-accounts";
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
  // Payments recorded against this proforma (Issue #14). paidAmount is the running total; on
  // conversion to a Sales Invoice the payments transfer and convertedInvoiceId links to it (after
  // which the proforma's payment history is shown read-only).
  paidAmount: numeric("paid_amount", { precision: 15, scale: 3 }).notNull().default("0"),
  convertedInvoiceId: integer("converted_invoice_id"),
  issueDate: date("issue_date").notNull(),
  subtotal: numeric("subtotal", { precision: 15, scale: 3 }).notNull().default("0"),
  discount: numeric("discount", { precision: 15, scale: 3 }).notNull().default("0"),
  taxTotal: numeric("tax_total", { precision: 15, scale: 3 }).notNull().default("0"),
  total: numeric("total", { precision: 15, scale: 3 }).notNull().default("0"),
  notes: text("notes"),
  terms: jsonb("terms").$type<{ text: string; groupId: number | null; groupName: string | null }[]>(),
  bankAccounts: jsonb("bank_accounts").$type<DocBankAccount[]>(),
  currency: text("currency"), // per-document currency code (ISO); null = org base currency
  // Seal/signature snapshot (Preset Management → Seal & Signature). Captured at save so editing a
  // preset never changes already-saved documents; null on legacy rows falls back to the org default.
  sealUrl: text("seal_url"),
  signatureUrl: text("signature_url"),
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
  imageUrl: text("image_url"),
  unit: text("unit"),
  customFields: jsonb("custom_fields"),
  description: text("description"),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull().default("1"),
  unitPrice: numeric("unit_price", { precision: 15, scale: 3 }).notNull().default("0"),
  taxRatePercent: numeric("tax_rate_percent", { precision: 5, scale: 2 }).notNull().default("15"),
  lineTotal: numeric("line_total", { precision: 15, scale: 3 }).notNull().default("0"),
});
export type ProformaInvoiceItem = typeof proformaInvoiceItemsTable.$inferSelect;
