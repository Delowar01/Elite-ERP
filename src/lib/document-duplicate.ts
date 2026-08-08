import type { DocumentType } from "./document-lifecycle";

/**
 * Which document types may be duplicated, and where each one's copy lives.
 *
 * Pure module (no DB, no framework): a `"use server"` file may only export async functions, so the
 * allow-list and its type guard live here where both the client row-menu and the server action can
 * import them and stay in agreement.
 *
 * Credit Notes and Debit Notes are deliberately absent. Their source binding is NOT NULL, so a copy
 * would be a second identical reversal bound to the same invoice/purchase order — one stray click
 * plus one Issue away from double-reversing revenue against a customer. Every other type's worst
 * case is a stray draft. The legitimate need (two partial credits on one invoice) already has a
 * correct path: create a credit note from the invoice and enter the second amount deliberately.
 */
export const DUPLICABLE_TYPES = [
  "quotation",
  "sales_order",
  "proforma_invoice",
  "sales_invoice",
  "delivery_challan",
  "purchase_order",
] as const;

export type DuplicableType = (typeof DUPLICABLE_TYPES)[number];

export function isDuplicableType(docType: DocumentType): docType is DuplicableType {
  return (DUPLICABLE_TYPES as readonly string[]).includes(docType);
}

/** Each duplicable type's list route; the copy opens at `${LIST_PATH}/{id}/edit`. */
export const DUPLICATE_LIST_PATH: Record<DuplicableType, string> = {
  quotation: "/sales/quotations",
  sales_order: "/sales/orders",
  proforma_invoice: "/sales/proforma",
  sales_invoice: "/sales/invoices",
  delivery_challan: "/sales/delivery-challans",
  purchase_order: "/purchasing/orders",
};
