import { pgTable, serial, integer, text, unique } from "drizzle-orm/pg-core";
import { orgsTable } from "./orgs";

export const documentSequencesTable = pgTable(
  "document_sequences",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
      .notNull()
      .references(() => orgsTable.id, { onDelete: "cascade" }),
    documentType: text("document_type").notNull(),
    prefix: text("prefix").notNull(),
    nextNumber: integer("next_number").notNull().default(1),
    padding: integer("padding").notNull().default(4),
  },
  (t) => [unique().on(t.orgId, t.documentType)],
);

export type DocumentSequence = typeof documentSequencesTable.$inferSelect;

export const DOCUMENT_TYPES = [
  "quotation",
  "sales_order",
  "proforma_invoice",
  "sales_invoice",
  "delivery_challan",
  "credit_note",
  "purchase_order",
  "debit_note",
] as const;

export const DEFAULT_SEQUENCES: Record<(typeof DOCUMENT_TYPES)[number], string> = {
  quotation: "QTN-",
  sales_order: "SO-",
  proforma_invoice: "PF-",
  sales_invoice: "INV-",
  delivery_challan: "DC-",
  credit_note: "CN-",
  purchase_order: "PO-",
  debit_note: "DN-",
};
