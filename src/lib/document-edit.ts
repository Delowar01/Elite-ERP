import { evaluate, type DocumentType, type RecordState } from "./document-lifecycle";

/**
 * Single source of truth for the Edit action on the 8 commercial document types.
 *
 * The list three-dot menu, the document Preview action bar, and the edit route's own server guard
 * all read from here, so none of them can offer (or refuse) Edit on different grounds. It adds no
 * new editing rules: availability is `evaluate(..., "edit")` — the Batch A1 lifecycle matrix, which
 * already says drafts only and never a posted/finalized document — plus the orthogonal record state
 * (a document sitting in the Recycle Bin supports restore, nothing else).
 *
 * Organization ownership is enforced where it must be: on the server, by the edit route's own
 * org-scoped lookup. The client-side rule below decides only whether to SHOW the action.
 */

export type DocEditConfig = {
  /** i18n key for the document type's display name, e.g. "Quotation". */
  typeLabel: string;
  /** The existing edit route. No new edit forms — these are the routes that already exist. */
  editHref: (id: number) => string;
};

export const DOC_EDIT_CONFIG: Record<DocumentType, DocEditConfig> = {
  quotation: { typeLabel: "Quotation", editHref: (id) => `/sales/quotations/${id}/edit` },
  sales_order: { typeLabel: "Sales Order", editHref: (id) => `/sales/orders/${id}/edit` },
  proforma_invoice: { typeLabel: "Proforma Invoice", editHref: (id) => `/sales/proforma/${id}/edit` },
  sales_invoice: { typeLabel: "Invoice", editHref: (id) => `/sales/invoices/${id}/edit` },
  delivery_challan: { typeLabel: "Delivery Challan", editHref: (id) => `/sales/delivery-challans/${id}/edit` },
  credit_note: { typeLabel: "Credit Note", editHref: (id) => `/sales/credit-notes/${id}/edit` },
  debit_note: { typeLabel: "Debit Note", editHref: (id) => `/purchasing/debit-notes/${id}/edit` },
  purchase_order: { typeLabel: "Purchase Order", editHref: (id) => `/purchasing/orders/${id}/edit` },
};

export type EditableCtx = {
  status: string;
  /** Orthogonal soft-delete state. Defaults to "active". */
  recordState?: RecordState;
};

/** The one rule. Returns the lifecycle decision so a refusal can be explained in the same words. */
export function editDecision(docType: DocumentType, ctx: EditableCtx) {
  return evaluate(docType, ctx.status, "edit", { recordState: ctx.recordState ?? "active" });
}

/** Convenience wrapper for callers that only need yes/no (menus, action bars). */
export function canEditDocument(docType: DocumentType, ctx: EditableCtx): boolean {
  return editDecision(docType, ctx).allowed;
}

export function editHrefFor(docType: DocumentType, id: number): string {
  return DOC_EDIT_CONFIG[docType].editHref(id);
}
