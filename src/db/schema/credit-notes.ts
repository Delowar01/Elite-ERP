import { pgTable, serial, integer, text, numeric, date, timestamp, jsonb } from "drizzle-orm/pg-core";
import type { DocBankAccount } from "@/lib/document-bank-accounts";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgsTable } from "./orgs";
import { customersTable } from "./customers";
import { productsTable } from "./products";
import { usersTable } from "./users";
import { salesInvoicesTable } from "./sales-invoices";

export const creditNotesTable = pgTable("credit_notes", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  creditNoteNumber: text("credit_note_number").notNull(),
  title: text("title"),
  customerId: integer("customer_id")
    .notNull()
    .references(() => customersTable.id),
  sourceInvoiceId: integer("source_invoice_id")
    .notNull()
    .references(() => salesInvoicesTable.id),
  reason: text("reason"),
  terms: jsonb("terms").$type<{ text: string; groupId: number | null; groupName: string | null }[]>(),
  bankAccounts: jsonb("bank_accounts").$type<DocBankAccount[]>(),
  currency: text("currency"), // per-document currency code (ISO); null = org base currency
  status: text("status").notNull().default("draft"), // draft | issued
  issueDate: date("issue_date").notNull(),
  subtotal: numeric("subtotal", { precision: 15, scale: 3 }).notNull().default("0"),
  discount: numeric("discount", { precision: 15, scale: 3 }).notNull().default("0"),
  taxTotal: numeric("tax_total", { precision: 15, scale: 3 }).notNull().default("0"),
  total: numeric("total", { precision: 15, scale: 3 }).notNull().default("0"),
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
});
export const insertCreditNoteSchema = createInsertSchema(creditNotesTable).omit({ id: true, createdAt: true });
export type InsertCreditNote = z.infer<typeof insertCreditNoteSchema>;
export type CreditNote = typeof creditNotesTable.$inferSelect;

export const creditNoteItemsTable = pgTable("credit_note_items", {
  id: serial("id").primaryKey(),
  creditNoteId: integer("credit_note_id")
    .notNull()
    .references(() => creditNotesTable.id, { onDelete: "cascade" }),
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
export type CreditNoteItem = typeof creditNoteItemsTable.$inferSelect;
