"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  db,
  quotationsTable, quotationItemsTable,
  salesOrdersTable, salesOrderItemsTable,
  proformaInvoicesTable, proformaInvoiceItemsTable,
  salesInvoicesTable, salesInvoiceItemsTable,
  deliveryChallansTable, deliveryChallanItemsTable,
  purchaseOrdersTable, purchaseOrderItemsTable,
  orgsTable, paymentTermPresetsTable,
} from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { nextDocumentNumber } from "@/lib/documents";
import { evaluate, type DocumentType } from "@/lib/document-lifecycle";
import { isDuplicableType, DUPLICATE_LIST_PATH as LIST_PATH, type DuplicableType } from "@/lib/document-duplicate";

/**
 * Duplicate a commercial document into a NEW DRAFT.
 *
 * What carries over: everything that is already a snapshot on the source row — title, party,
 * project, notes, discount, currency, terms, bank accounts, seal/signature and every line item
 * (including the long-form description held in custom_fields). Nothing is re-resolved from today's
 * presets, because a duplicate must look like the document the user pointed at; only the document
 * NUMBER is re-issued.
 *
 * What never carries over: status (always draft), paid amount, payments, conversion/source links,
 * ledger postings, ZATCA fields, archive/delete state, and attachments (deliberately — an
 * attachment is evidence for one transaction, not for its copy). The confirmation popup says so.
 *
 * Credit Notes and Debit Notes are intentionally NOT duplicable: their source binding is NOT NULL,
 * so a copy would be a second identical reversal bound to the same invoice/PO — one stray click
 * away from double-reversing revenue. The lifecycle rules already deny it and the menu omits it.
 */

export type DuplicateResult = { error?: string };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(from: string, days: number): string {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Re-date a secondary date (valid-till, expected delivery, due date) onto today while keeping the
 * source's own window: a quotation valid for 14 days duplicates as valid for 14 days from today.
 *
 * Guard: if the source's window is zero or negative — someone edited its dates backwards, or it is
 * an expired quote whose valid-till precedes its issue date — reproducing the offset would emit a
 * date in the past. Fall back to the current preset window, or leave the field empty.
 */
function shiftWindow(
  sourcePrimary: string | null,
  sourceSecondary: string | null,
  fallbackDays: number | null,
): string | null {
  const base = today();
  if (sourcePrimary && sourceSecondary) {
    const window = daysBetween(sourcePrimary, sourceSecondary);
    if (window > 0) return addDays(base, window);
  }
  return fallbackDays && fallbackDays > 0 ? addDays(base, fallbackDays) : null;
}

/**
 * Duplicate `id` of `docType`. Returns an error, or redirects to the new draft's edit page so the
 * user lands in the builder with everything pre-filled rather than back on the list.
 */
export async function duplicateDocumentAction(docType: DocumentType, id: number): Promise<DuplicateResult> {
  // Duplicating is a CREATE, so it uses exactly the gate that creating this document type uses.
  // Every create action in the six duplicable modules is requireSession() with no role check; if
  // one of them ever gains a role gate, this must gain the same one.
  const session = await requireSession();
  if (!Number.isInteger(id)) return { error: "Document not found." };
  if (!isDuplicableType(docType)) return { error: "This document type cannot be duplicated." };

  let newId: number;
  try {
    newId = await duplicateOne(docType, id, session.orgId, session.userId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not duplicate this document." };
  }

  await logActivity(session, {
    type: `${docType}.duplicated`,
    description: "Duplicated a document",
    entityType: docType,
    entityId: newId,
  });
  revalidatePath(LIST_PATH[docType]);
  redirect(`${LIST_PATH[docType]}/${newId}/edit`);
}

const NOT_FOUND = "Document not found.";

async function duplicateOne(docType: DuplicableType, id: number, orgId: number, userId: number): Promise<number> {
  const base = today();

  switch (docType) {
    case "quotation": {
      // Tenant scope is part of the lookup itself: another org's id simply does not resolve.
      const [src] = await db.select().from(quotationsTable).where(and(eq(quotationsTable.id, id), eq(quotationsTable.orgId, orgId)));
      if (!src) throw new Error(NOT_FOUND);
      guard(docType, src.status, src.archivedAt, src.deletedAt);
      const [org] = await db.select({ days: orgsTable.defaultValidityDays }).from(orgsTable).where(eq(orgsTable.id, orgId));
      const items = await db.select().from(quotationItemsTable).where(eq(quotationItemsTable.quotationId, id));

      return db.transaction(async (tx) => {
        const quotationNumber = await nextDocumentNumber(tx, orgId, "quotation");
        const [row] = await tx.insert(quotationsTable).values({
          orgId, quotationNumber, status: "draft", createdById: userId,
          title: src.title, customerId: src.customerId, projectId: src.projectId,
          issueDate: base,
          validUntil: shiftWindow(src.issueDate, src.validUntil, org?.days ?? null),
          subtotal: src.subtotal, discount: src.discount, taxTotal: src.taxTotal, total: src.total,
          notes: src.notes, terms: src.terms, bankAccounts: src.bankAccounts, currency: src.currency,
          sealUrl: src.sealUrl, signatureUrl: src.signatureUrl,
        }).returning({ id: quotationsTable.id });
        if (items.length) {
          await tx.insert(quotationItemsTable).values(items.map((l) => ({ ...pricedItem(l), quotationId: row.id })));
        }
        return row.id;
      });
    }

    case "sales_order": {
      const [src] = await db.select().from(salesOrdersTable).where(and(eq(salesOrdersTable.id, id), eq(salesOrdersTable.orgId, orgId)));
      if (!src) throw new Error(NOT_FOUND);
      guard(docType, src.status, src.archivedAt, src.deletedAt);
      const items = await db.select().from(salesOrderItemsTable).where(eq(salesOrderItemsTable.salesOrderId, id));

      return db.transaction(async (tx) => {
        const soNumber = await nextDocumentNumber(tx, orgId, "sales_order");
        const [row] = await tx.insert(salesOrdersTable).values({
          orgId, soNumber, status: "draft", createdById: userId,
          // sourceQuotationId deliberately dropped: the copy has no lineage.
          title: src.title, customerId: src.customerId, projectId: src.projectId,
          issueDate: base,
          expectedDate: shiftWindow(src.issueDate, src.expectedDate, null),
          subtotal: src.subtotal, discount: src.discount, taxTotal: src.taxTotal, total: src.total,
          notes: src.notes, terms: src.terms, bankAccounts: src.bankAccounts, currency: src.currency,
          sealUrl: src.sealUrl, signatureUrl: src.signatureUrl,
        }).returning({ id: salesOrdersTable.id });
        if (items.length) {
          await tx.insert(salesOrderItemsTable).values(items.map((l) => ({ ...pricedItem(l), salesOrderId: row.id })));
        }
        return row.id;
      });
    }

    case "proforma_invoice": {
      const [src] = await db.select().from(proformaInvoicesTable).where(and(eq(proformaInvoicesTable.id, id), eq(proformaInvoicesTable.orgId, orgId)));
      if (!src) throw new Error(NOT_FOUND);
      guard(docType, src.status, src.archivedAt, src.deletedAt);
      const items = await db.select().from(proformaInvoiceItemsTable).where(eq(proformaInvoiceItemsTable.proformaInvoiceId, id));

      return db.transaction(async (tx) => {
        const proformaNumber = await nextDocumentNumber(tx, orgId, "proforma_invoice");
        const [row] = await tx.insert(proformaInvoicesTable).values({
          orgId, proformaNumber, status: "draft", createdById: userId,
          // paidAmount stays at its 0 default and convertedInvoiceId/sourceSalesOrderId stay null:
          // advances belong to the source proforma, never to a copy of it.
          title: src.title, customerId: src.customerId,
          issueDate: base,
          subtotal: src.subtotal, discount: src.discount, taxTotal: src.taxTotal, total: src.total,
          notes: src.notes, terms: src.terms, bankAccounts: src.bankAccounts, currency: src.currency,
          sealUrl: src.sealUrl, signatureUrl: src.signatureUrl,
        }).returning({ id: proformaInvoicesTable.id });
        if (items.length) {
          await tx.insert(proformaInvoiceItemsTable).values(items.map((l) => ({ ...pricedItem(l), proformaInvoiceId: row.id })));
        }
        return row.id;
      });
    }

    case "sales_invoice": {
      const [src] = await db.select().from(salesInvoicesTable).where(and(eq(salesInvoicesTable.id, id), eq(salesInvoicesTable.orgId, orgId)));
      if (!src) throw new Error(NOT_FOUND);
      guard(docType, src.status, src.archivedAt, src.deletedAt);
      const items = await db.select().from(salesInvoiceItemsTable).where(eq(salesInvoiceItemsTable.invoiceId, id));
      // Fallback for the due-date guard: the stored term's net days, when the preset still exists.
      let termDays: number | null = null;
      if (src.paymentTermPresetId) {
        const [term] = await db.select({ n: paymentTermPresetsTable.netDays }).from(paymentTermPresetsTable)
          .where(and(eq(paymentTermPresetsTable.id, src.paymentTermPresetId), eq(paymentTermPresetsTable.orgId, orgId)));
        termDays = term?.n ?? null;
      }

      return db.transaction(async (tx) => {
        const invoiceNumber = await nextDocumentNumber(tx, orgId, "sales_invoice");
        const [row] = await tx.insert(salesInvoicesTable).values({
          orgId, invoiceNumber, status: "draft", createdById: userId,
          // ZATCA fields (qrCodeData / invoiceHash / previousInvoiceHash) are left null: they are
          // computed at send from this invoice's own totals and timestamp, never copied.
          title: src.title, customerId: src.customerId, projectId: src.projectId,
          issueDate: base,
          dueDate: shiftWindow(src.issueDate, src.dueDate, termDays),
          paymentTermPresetId: src.paymentTermPresetId,
          subtotal: src.subtotal, discount: src.discount, taxTotal: src.taxTotal, total: src.total,
          notes: src.notes, terms: src.terms, bankAccounts: src.bankAccounts, currency: src.currency,
          sealUrl: src.sealUrl, signatureUrl: src.signatureUrl,
        }).returning({ id: salesInvoicesTable.id });
        if (items.length) {
          await tx.insert(salesInvoiceItemsTable).values(items.map((l) => ({ ...pricedItem(l), invoiceId: row.id })));
        }
        return row.id;
      });
    }

    case "delivery_challan": {
      const [src] = await db.select().from(deliveryChallansTable).where(and(eq(deliveryChallansTable.id, id), eq(deliveryChallansTable.orgId, orgId)));
      if (!src) throw new Error(NOT_FOUND);
      guard(docType, src.status, src.archivedAt, src.deletedAt);
      const items = await db.select().from(deliveryChallanItemsTable).where(eq(deliveryChallanItemsTable.deliveryChallanId, id));

      return db.transaction(async (tx) => {
        const dcNumber = await nextDocumentNumber(tx, orgId, "delivery_challan");
        const [row] = await tx.insert(deliveryChallansTable).values({
          orgId, dcNumber, status: "draft", createdById: userId,
          // deliveredDate and all four source links stay null — this is a fresh dispatch.
          title: src.title, customerId: src.customerId,
          dispatchDate: base,
          carrier: src.carrier, vehicleNo: src.vehicleNo,
          notes: src.notes, terms: src.terms, bankAccounts: src.bankAccounts, currency: src.currency,
          sealUrl: src.sealUrl, signatureUrl: src.signatureUrl,
        }).returning({ id: deliveryChallansTable.id });
        if (items.length) {
          // Delivery challans are quantity-only: no rate, no tax, no line total to copy.
          await tx.insert(deliveryChallanItemsTable).values(items.map((l) => ({
            deliveryChallanId: row.id,
            productId: l.productId, imageUrl: l.imageUrl, unit: l.unit,
            customFields: l.customFields ?? {}, description: l.description, quantity: l.quantity,
          })));
        }
        return row.id;
      });
    }

    case "purchase_order": {
      const [src] = await db.select().from(purchaseOrdersTable).where(and(eq(purchaseOrdersTable.id, id), eq(purchaseOrdersTable.orgId, orgId)));
      if (!src) throw new Error(NOT_FOUND);
      guard(docType, src.status, src.archivedAt, src.deletedAt);
      const items = await db.select().from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.purchaseOrderId, id));

      return db.transaction(async (tx) => {
        const poNumber = await nextDocumentNumber(tx, orgId, "purchase_order");
        const [row] = await tx.insert(purchaseOrdersTable).values({
          orgId, poNumber, status: "draft", createdById: userId,
          title: src.title, vendorId: src.vendorId, projectId: src.projectId,
          orderDate: base,
          expectedDate: shiftWindow(src.orderDate, src.expectedDate, null),
          subtotal: src.subtotal, discount: src.discount, taxTotal: src.taxTotal, total: src.total,
          notes: src.notes, terms: src.terms, bankAccounts: src.bankAccounts, currency: src.currency,
          sealUrl: src.sealUrl, signatureUrl: src.signatureUrl,
        }).returning({ id: purchaseOrdersTable.id });
        if (items.length) {
          // Purchase-side lines carry a unit COST rather than a unit price.
          await tx.insert(purchaseOrderItemsTable).values(items.map((l) => ({
            purchaseOrderId: row.id,
            productId: l.productId, imageUrl: l.imageUrl, unit: l.unit,
            customFields: l.customFields ?? {}, description: l.description, quantity: l.quantity,
            unitCost: l.unitCost, taxRatePercent: l.taxRatePercent, lineTotal: l.lineTotal,
          })));
        }
        return row.id;
      });
    }
  }
}

/** The line shape shared by the four sales pricing documents. */
function pricedItem(l: {
  productId: number | null; imageUrl: string | null; unit: string | null;
  customFields: unknown; description: string | null; quantity: string; unitPrice: string;
  taxRatePercent: string; lineTotal: string;
}) {
  return {
    productId: l.productId, imageUrl: l.imageUrl, unit: l.unit,
    customFields: (l.customFields as Record<string, string>) ?? {},
    description: l.description, quantity: l.quantity, unitPrice: l.unitPrice,
    taxRatePercent: l.taxRatePercent, lineTotal: l.lineTotal,
  };
}

/**
 * Re-check the lifecycle rule on the server. The row menu hides Duplicate where it does not apply,
 * but the menu is not authorization — a replayed call has to be refused here too. Records in the
 * Recycle Bin are never duplicable.
 */
function guard(docType: DocumentType, status: string, archivedAt: Date | null, deletedAt: Date | null): void {
  const recordState = deletedAt ? "deleted" : archivedAt ? "archived" : "active";
  const decision = evaluate(docType, status, "duplicate", { recordState });
  if (!decision.allowed) throw new Error(decision.reason);
}
