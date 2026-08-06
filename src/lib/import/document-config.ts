import "server-only";
import {
  quotationsTable, quotationItemsTable,
  salesOrdersTable, salesOrderItemsTable,
  proformaInvoicesTable, proformaInvoiceItemsTable,
  salesInvoicesTable, salesInvoiceItemsTable,
  deliveryChallansTable, deliveryChallanItemsTable,
  purchaseOrdersTable, purchaseOrderItemsTable,
  creditNotesTable, creditNoteItemsTable,
  debitNotesTable, debitNoteItemsTable,
} from "@/db";
import type { DocModule } from "./document-fields";

// The write half of a document import: one small function per module that turns the engine's
// already-validated values into the module's own header + line-item rows. Everything else —
// grouping, validation, totals, dates, terms, the transaction — is shared in document-import.ts.
//
// These run INSIDE the engine's per-document transaction. They only insert a draft; no lifecycle
// action (send / issue / receive / approve / cancel / payment), no ledger entry, no stock movement.

/** A line item after the engine has normalized it. `unitPrice` is 0 for quantity-only modules. */
export type ImportLine = {
  productId: number | null;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRatePercent: string;
  lineTotal: string;
  unit: string | null;
  imageUrl: string | null;
  customFields: Record<string, string>;
};

export type WriteArgs = {
  // drizzle's transaction type is generic over the full schema; the engine always passes a real tx.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;
  orgId: number;
  userId: number;
  number: string;
  partyId: number;
  projectId: number | null;
  sourceDocId: number | null;
  /** Raw header cell values, for the few columns only one module has (carrier, reason, …). */
  h: Record<string, string>;
  /** Resolved ISO dates keyed by the module's date-field keys; blank dates are absent. */
  dates: Record<string, string>;
  title: string | null;
  currency: string | null;
  notes: string | null;
  terms: { text: string; groupId: number | null; groupName: string | null }[] | null;
  totals: { subtotal: string; discount: string; taxTotal: string; total: string };
  lines: ImportLine[];
};

const txt = (v: string | undefined) => (v ?? "").trim() || null;

/** Header columns every priced sales document shares. */
const priced = (a: WriteArgs) => ({
  orgId: a.orgId,
  title: a.title,
  currency: a.currency,
  status: "draft" as const,
  subtotal: a.totals.subtotal,
  discount: a.totals.discount,
  taxTotal: a.totals.taxTotal,
  total: a.totals.total,
  createdById: a.userId,
});

/** Purchasing item tables store the per-unit money in `unitCost` rather than `unitPrice`. */
const costLine = (l: ImportLine) => ({
  productId: l.productId, description: l.description, quantity: l.quantity,
  unitCost: l.unitPrice, taxRatePercent: l.taxRatePercent, lineTotal: l.lineTotal,
  unit: l.unit, imageUrl: l.imageUrl, customFields: l.customFields,
});

export const DOC_WRITERS: Record<DocModule, (a: WriteArgs) => Promise<void>> = {
  quotation: async (a) => {
    const [d] = await a.tx.insert(quotationsTable).values({
      ...priced(a), quotationNumber: a.number, customerId: a.partyId, projectId: a.projectId,
      issueDate: a.dates.issueDate, validUntil: a.dates.validUntil ?? null,
      notes: a.notes, terms: a.terms,
    }).returning({ id: quotationsTable.id });
    await a.tx.insert(quotationItemsTable).values(a.lines.map((l) => ({ quotationId: d.id, ...l })));
  },

  sales_order: async (a) => {
    const [d] = await a.tx.insert(salesOrdersTable).values({
      ...priced(a), soNumber: a.number, customerId: a.partyId, projectId: a.projectId,
      issueDate: a.dates.issueDate, expectedDate: a.dates.expectedDate ?? null,
      notes: a.notes, terms: a.terms,
    }).returning({ id: salesOrdersTable.id });
    await a.tx.insert(salesOrderItemsTable).values(a.lines.map((l) => ({ salesOrderId: d.id, ...l })));
  },

  proforma_invoice: async (a) => {
    const [d] = await a.tx.insert(proformaInvoicesTable).values({
      ...priced(a), proformaNumber: a.number, customerId: a.partyId,
      issueDate: a.dates.issueDate, notes: a.notes, terms: a.terms,
    }).returning({ id: proformaInvoicesTable.id });
    await a.tx.insert(proformaInvoiceItemsTable).values(a.lines.map((l) => ({ proformaInvoiceId: d.id, ...l })));
  },

  sales_invoice: async (a) => {
    // Draft only: the ZATCA hash/QR, the ledger entry and the stock decrement all belong to Send.
    const [d] = await a.tx.insert(salesInvoicesTable).values({
      ...priced(a), invoiceNumber: a.number, customerId: a.partyId, projectId: a.projectId,
      issueDate: a.dates.issueDate, dueDate: a.dates.dueDate ?? null,
      notes: a.notes, terms: a.terms,
    }).returning({ id: salesInvoicesTable.id });
    await a.tx.insert(salesInvoiceItemsTable).values(a.lines.map((l) => ({ invoiceId: d.id, ...l })));
  },

  delivery_challan: async (a) => {
    // Logistics-only: the challan header has no money columns and its items are quantity-only.
    const [d] = await a.tx.insert(deliveryChallansTable).values({
      orgId: a.orgId, dcNumber: a.number, customerId: a.partyId,
      dispatchDate: a.dates.dispatchDate ?? null, deliveredDate: a.dates.deliveredDate ?? null,
      carrier: txt(a.h.carrier), vehicleNo: txt(a.h.vehicleNo),
      title: a.title, currency: a.currency, notes: a.notes, terms: a.terms,
      status: "draft", createdById: a.userId,
    }).returning({ id: deliveryChallansTable.id });
    await a.tx.insert(deliveryChallanItemsTable).values(a.lines.map((l) => ({
      deliveryChallanId: d.id, productId: l.productId, description: l.description,
      quantity: l.quantity, unit: l.unit, imageUrl: l.imageUrl, customFields: l.customFields,
    })));
  },

  purchase_order: async (a) => {
    // Draft: receiving is what posts Dr Inventory / Cr Accounts Payable and increments stock.
    const [d] = await a.tx.insert(purchaseOrdersTable).values({
      ...priced(a), poNumber: a.number, vendorId: a.partyId,
      orderDate: a.dates.orderDate, expectedDate: a.dates.expectedDate ?? null,
      notes: a.notes, terms: a.terms,
    }).returning({ id: purchaseOrdersTable.id });
    await a.tx.insert(purchaseOrderItemsTable).values(a.lines.map((l) => ({ purchaseOrderId: d.id, ...costLine(l) })));
  },

  credit_note: async (a) => {
    // sourceInvoiceId is NOT NULL on the table; the engine has already proven the invoice exists
    // in this organization before we get here.
    const [d] = await a.tx.insert(creditNotesTable).values({
      ...priced(a), creditNoteNumber: a.number, customerId: a.partyId,
      sourceInvoiceId: a.sourceDocId!, reason: txt(a.h.reason),
      issueDate: a.dates.issueDate, terms: a.terms,
    }).returning({ id: creditNotesTable.id });
    await a.tx.insert(creditNoteItemsTable).values(a.lines.map((l) => ({ creditNoteId: d.id, ...l })));
  },

  debit_note: async (a) => {
    const [d] = await a.tx.insert(debitNotesTable).values({
      ...priced(a), debitNoteNumber: a.number, vendorId: a.partyId,
      sourcePurchaseOrderId: a.sourceDocId!, reason: txt(a.h.reason),
      issueDate: a.dates.issueDate, terms: a.terms,
    }).returning({ id: debitNotesTable.id });
    await a.tx.insert(debitNoteItemsTable).values(a.lines.map((l) => ({ debitNoteId: d.id, ...costLine(l) })));
  },
};
