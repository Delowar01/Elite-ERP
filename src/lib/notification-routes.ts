import type { DocumentType } from "./document-lifecycle";
import { docAdmin } from "./document-registry";

// Batch E — maps an activity-log row's (entityType, entityId) to the in-app detail route for
// that record, so a notification can "open the related record". Returns null for entity types
// that have no dedicated record page (org/user settings, saved views, sequences, consents),
// in which case the notification is informational only. Pure/synchronous — safe in a client
// component via the precomputed href carried on each NotificationItem.
const DOC_TYPES = new Set<string>([
  "quotation",
  "sales_order",
  "proforma_invoice",
  "sales_invoice",
  "delivery_challan",
  "credit_note",
  "debit_note",
  "purchase_order",
]);

export function notificationHref(entityType: string | null, entityId: number | null): string | null {
  if (!entityType || entityId == null) return null;
  if (DOC_TYPES.has(entityType)) return docAdmin(entityType as DocumentType).detailHref(entityId);
  switch (entityType) {
    case "client":
    case "customer":
      return `/clients/${entityId}`;
    case "vendor":
      return `/purchasing/vendors/${entityId}`;
    case "product":
      return `/inventory/products/${entityId}`;
    case "employee":
      return `/hr/employees/${entityId}`;
    case "project":
      return `/projects/${entityId}`;
    case "payment":
      return `/finance/payments`;
    case "bank_account":
      return `/finance/bank-accounts`;
    case "journal_entry":
      return `/finance/ledger`;
    case "account":
      return `/finance/chart-of-accounts`;
    case "leave_request":
      return `/hr/leave`;
    case "payroll_run":
      return `/hr/payroll`;
    default:
      return null;
  }
}
