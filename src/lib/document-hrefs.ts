import type { DocumentType } from "./document-lifecycle";

/**
 * Each document type's canonical detail route. Pure module with no DB or framework imports, so the
 * server registry and client row menus share exactly one definition.
 *
 * This route is effectively a document's identity in the app: it is what a favorite stores, what
 * search results link to, and what a permanently-deleted document's favorites are purged by. If it
 * ever changes, it must change here and nowhere else.
 */
export const DOCUMENT_DETAIL_HREF: Record<DocumentType, (id: number) => string> = {
  quotation: (id) => `/sales/quotations/${id}`,
  sales_order: (id) => `/sales/orders/${id}`,
  proforma_invoice: (id) => `/sales/proforma/${id}`,
  sales_invoice: (id) => `/sales/invoices/${id}`,
  delivery_challan: (id) => `/sales/delivery-challans/${id}`,
  credit_note: (id) => `/sales/credit-notes/${id}`,
  debit_note: (id) => `/purchasing/debit-notes/${id}`,
  purchase_order: (id) => `/purchasing/orders/${id}`,
};
