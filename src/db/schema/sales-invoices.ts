import { pgTable, serial, integer, text, numeric, date, timestamp, jsonb } from "drizzle-orm/pg-core";
import type { DocBankAccount } from "@/lib/document-bank-accounts";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgsTable } from "./orgs";
import { customersTable } from "./customers";
import { productsTable } from "./products";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { salesOrdersTable } from "./sales-orders";
import { paymentTermPresetsTable } from "./presets";
import { baseAmountColumns, basePaidAmountColumn } from "./_base-amounts";

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
  // The Payment Terms preset the due date was derived from (Net 30, …). Stored so the term can be
  // shown on the document and re-selected when editing. The due date itself stays independently
  // editable, so this records which term was chosen — it is not a live formula.
  paymentTermPresetId: integer("payment_term_preset_id").references(() => paymentTermPresetsTable.id, { onDelete: "set null" }),
  subtotal: numeric("subtotal", { precision: 15, scale: 3 }).notNull().default("0"),
  discount: numeric("discount", { precision: 15, scale: 3 }).notNull().default("0"),
  taxTotal: numeric("tax_total", { precision: 15, scale: 3 }).notNull().default("0"),
  total: numeric("total", { precision: 15, scale: 3 }).notNull().default("0"),
  /** Cash actually received against this invoice, plus advances applied as payment. NEVER credits. */
  paidAmount: numeric("paid_amount", { precision: 15, scale: 3 }).notNull().default("0"),
  /**
   * Value credited back by ISSUED credit notes — a third settlement channel, kept separate from
   * `paidAmount` on purpose.
   *
   * It used to be folded into `paidAmount`, which made `outstanding = total − paidAmount` correct
   * and `paidAmount` itself a lie: a fully-paid 575 invoice credited in full reported Paid 1,150
   * and a balance of −575. That figure is not a display value — it feeds invoice status, AR aging,
   * client statements, the dashboard receivables total, the advance-application cap and the
   * credit-note release rule.
   *
   * Payments, applied advances and credit notes are three different things. The identity that
   * replaces the old one is `outstanding = total − paidAmount − creditedAmount`, expressed once in
   * `settlementOf` and once in `baseOutstandingExpr`, so no reader has to remember it.
   */
  creditedAmount: numeric("credited_amount", { precision: 15, scale: 3 }).notNull().default("0"),
  /** `creditedAmount` in base currency. Null carries the same "not converted" meaning as its siblings. */
  baseCreditedAmount: numeric("base_credited_amount", { precision: 15, scale: 3 }),
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
  unitPrice: numeric("unit_price", { precision: 15, scale: 3 }).notNull().default("0"),
  taxRatePercent: numeric("tax_rate_percent", { precision: 5, scale: 2 }).notNull().default("15"),
  lineTotal: numeric("line_total", { precision: 15, scale: 3 }).notNull().default("0"),
});
export type SalesInvoiceItem = typeof salesInvoiceItemsTable.$inferSelect;
