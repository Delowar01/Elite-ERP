import { pgTable, serial, integer, text, numeric, date, timestamp, jsonb } from "drizzle-orm/pg-core";
import type { DocBankAccount } from "@/lib/document-bank-accounts";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgsTable } from "./orgs";
import { vendorsTable } from "./vendors";
import { productsTable } from "./products";
import { usersTable } from "./users";
import { quotationsTable } from "./quotations";
import { salesOrdersTable } from "./sales-orders";
import { proformaInvoicesTable } from "./proforma-invoices";
import { salesInvoicesTable } from "./sales-invoices";
import { projectsTable } from "./projects";
import { baseAmountColumns, basePaidAmountColumn } from "./_base-amounts";

export const purchaseOrdersTable = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  poNumber: text("po_number").notNull(),
  title: text("title"),
  vendorId: integer("vendor_id")
    .notNull()
    .references(() => vendorsTable.id),
  // Optional project tag — the same nullable link quotations/sales orders/invoices already carry.
  // It is what lets Project Cost Control attribute supplier cost to a project. Existing rows stay
  // NULL (unattributed) and no purchasing workflow depends on it.
  projectId: integer("project_id").references(() => projectsTable.id),
  sourceQuotationId: integer("source_quotation_id").references(() => quotationsTable.id),
  sourceSalesOrderId: integer("source_sales_order_id").references(() => salesOrdersTable.id),
  sourceProformaId: integer("source_proforma_id").references(() => proformaInvoicesTable.id),
  sourceInvoiceId: integer("source_invoice_id").references(() => salesInvoicesTable.id),
  status: text("status").notNull().default("draft"), // draft | ordered | received | cancelled
  orderDate: date("order_date").notNull(),
  expectedDate: date("expected_date"),
  subtotal: numeric("subtotal", { precision: 15, scale: 3 }).notNull().default("0"),
  discount: numeric("discount", { precision: 15, scale: 3 }).notNull().default("0"),
  taxTotal: numeric("tax_total", { precision: 15, scale: 3 }).notNull().default("0"),
  total: numeric("total", { precision: 15, scale: 3 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 15, scale: 3 }).notNull().default("0"),
  notes: text("notes"),
  terms: jsonb("terms").$type<{ text: string; groupId: number | null; groupName: string | null }[]>(),
  bankAccounts: jsonb("bank_accounts").$type<DocBankAccount[]>(),
  currency: text("currency"), // per-document currency code (ISO); null = org base currency
  ...baseAmountColumns,
  ...basePaidAmountColumn,
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
export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrdersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type PurchaseOrder = typeof purchaseOrdersTable.$inferSelect;

export const purchaseOrderItemsTable = pgTable("purchase_order_items", {
  id: serial("id").primaryKey(),
  purchaseOrderId: integer("purchase_order_id")
    .notNull()
    .references(() => purchaseOrdersTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id),
  imageUrl: text("image_url"),
  unit: text("unit"),
  customFields: jsonb("custom_fields"),
  description: text("description"),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull().default("1"),
  unitCost: numeric("unit_cost", { precision: 15, scale: 3 }).notNull().default("0"),
  taxRatePercent: numeric("tax_rate_percent", { precision: 5, scale: 2 }).notNull().default("15"),
  lineTotal: numeric("line_total", { precision: 15, scale: 3 }).notNull().default("0"),
});
export type PurchaseOrderItem = typeof purchaseOrderItemsTable.$inferSelect;
