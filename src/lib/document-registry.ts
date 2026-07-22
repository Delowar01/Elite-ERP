import "server-only";
import { and, eq, count, isNull, isNotNull, desc } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import {
  db,
  quotationsTable,
  quotationItemsTable,
  salesOrdersTable,
  salesOrderItemsTable,
  proformaInvoicesTable,
  proformaInvoiceItemsTable,
  salesInvoicesTable,
  salesInvoiceItemsTable,
  deliveryChallansTable,
  deliveryChallanItemsTable,
  creditNotesTable,
  creditNoteItemsTable,
  debitNotesTable,
  debitNoteItemsTable,
  purchaseOrdersTable,
  purchaseOrderItemsTable,
  customersTable,
  vendorsTable,
} from "@/db";
import type { DocumentType } from "./document-lifecycle";

/**
 * Batch A3 — one registry describing how to archive / soft-delete / restore /
 * permanently delete and list-in-the-Recycle-Bin each of the 8 document types.
 * The generic lifecycle server actions and the Recycle Bin page both read from
 * here so the per-type SQL lives in exactly one place. Every closure is written
 * against its own concrete Drizzle table, tenant-scoped by orgId.
 */

export type DocRecordState = "active" | "archived" | "deleted";

export type DocState = {
  status: string;
  /** The document's human number (quotationNumber / soNumber / …). Preserved on permanent delete. */
  number: string;
  archivedAt: Date | null;
  deletedAt: Date | null;
};

export type RecycleRow = {
  docType: DocumentType;
  id: number;
  number: string;
  status: string;
  partyName: string;
  deletedAt: Date | null;
};

export function recordStateOf(s: { archivedAt: Date | null; deletedAt: Date | null }): DocRecordState {
  if (s.deletedAt) return "deleted";
  if (s.archivedAt) return "archived";
  return "active";
}

/** Count of non-deleted rows in `table` whose `col` points at `parentId` (a downstream reference). */
async function refN(table: PgTable, col: PgColumn, orgCol: PgColumn, delCol: PgColumn, parentId: number, orgId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(table)
    .where(and(eq(col, parentId), eq(orgCol, orgId), isNull(delCol)));
  return Number(row?.n ?? 0);
}

export type DocAdminEntry = {
  docType: DocumentType;
  /** i18n key for the document type name, e.g. "Quotation". */
  typeLabel: string;
  listPath: string;
  detailHref: (id: number) => string;
  /** Paths to revalidate after any state change. */
  revalidatePaths: string[];
  loadState: (orgId: number, id: number) => Promise<DocState | null>;
  /** Count of non-deleted downstream documents that reference this one. */
  countReferences: (orgId: number, id: number) => Promise<number>;
  /** Returns rows affected (0 = not found / not owned). */
  setArchivedAt: (orgId: number, id: number, value: Date | null) => Promise<number>;
  setDeletedAt: (orgId: number, id: number, value: Date | null) => Promise<number>;
  /** Hard-delete the row and its line items (items removed first). */
  hardDelete: (orgId: number, id: number) => Promise<void>;
  /** Soft-deleted documents for the Recycle Bin, newest first. */
  listDeleted: (orgId: number) => Promise<RecycleRow[]>;
};

export const DOCUMENT_ADMIN: Record<DocumentType, DocAdminEntry> = {
  quotation: {
    docType: "quotation",
    typeLabel: "Quotation",
    listPath: "/sales/quotations",
    detailHref: (id) => `/sales/quotations/${id}`,
    revalidatePaths: ["/sales/quotations", "/recycle-bin"],
    loadState: async (orgId, id) => {
      const [r] = await db
        .select({ status: quotationsTable.status, number: quotationsTable.quotationNumber, archivedAt: quotationsTable.archivedAt, deletedAt: quotationsTable.deletedAt })
        .from(quotationsTable)
        .where(and(eq(quotationsTable.id, id), eq(quotationsTable.orgId, orgId)));
      return r ?? null;
    },
    countReferences: async (orgId, id) =>
      (await refN(salesOrdersTable, salesOrdersTable.sourceQuotationId, salesOrdersTable.orgId, salesOrdersTable.deletedAt, id, orgId)) +
      (await refN(deliveryChallansTable, deliveryChallansTable.sourceQuotationId, deliveryChallansTable.orgId, deliveryChallansTable.deletedAt, id, orgId)) +
      (await refN(purchaseOrdersTable, purchaseOrdersTable.sourceQuotationId, purchaseOrdersTable.orgId, purchaseOrdersTable.deletedAt, id, orgId)),
    setArchivedAt: async (orgId, id, value) => (await db.update(quotationsTable).set({ archivedAt: value, updatedAt: new Date() }).where(and(eq(quotationsTable.id, id), eq(quotationsTable.orgId, orgId))).returning({ id: quotationsTable.id })).length,
    setDeletedAt: async (orgId, id, value) => (await db.update(quotationsTable).set({ deletedAt: value, updatedAt: new Date() }).where(and(eq(quotationsTable.id, id), eq(quotationsTable.orgId, orgId))).returning({ id: quotationsTable.id })).length,
    hardDelete: async (orgId, id) => {
      await db.transaction(async (tx) => {
        await tx.delete(quotationItemsTable).where(eq(quotationItemsTable.quotationId, id));
        await tx.delete(quotationsTable).where(and(eq(quotationsTable.id, id), eq(quotationsTable.orgId, orgId)));
      });
    },
    listDeleted: async (orgId) => {
      const rows = await db
        .select({ id: quotationsTable.id, number: quotationsTable.quotationNumber, status: quotationsTable.status, partyName: customersTable.name, deletedAt: quotationsTable.deletedAt })
        .from(quotationsTable)
        .innerJoin(customersTable, eq(customersTable.id, quotationsTable.customerId))
        .where(and(eq(quotationsTable.orgId, orgId), isNotNull(quotationsTable.deletedAt)))
        .orderBy(desc(quotationsTable.deletedAt));
      return rows.map((r) => ({ docType: "quotation" as const, ...r }));
    },
  },
  sales_order: {
    docType: "sales_order",
    typeLabel: "Sales Order",
    listPath: "/sales/orders",
    detailHref: (id) => `/sales/orders/${id}`,
    revalidatePaths: ["/sales/orders", "/recycle-bin"],
    loadState: async (orgId, id) => {
      const [r] = await db
        .select({ status: salesOrdersTable.status, number: salesOrdersTable.soNumber, archivedAt: salesOrdersTable.archivedAt, deletedAt: salesOrdersTable.deletedAt })
        .from(salesOrdersTable)
        .where(and(eq(salesOrdersTable.id, id), eq(salesOrdersTable.orgId, orgId)));
      return r ?? null;
    },
    countReferences: async (orgId, id) =>
      (await refN(proformaInvoicesTable, proformaInvoicesTable.sourceSalesOrderId, proformaInvoicesTable.orgId, proformaInvoicesTable.deletedAt, id, orgId)) +
      (await refN(salesInvoicesTable, salesInvoicesTable.sourceSalesOrderId, salesInvoicesTable.orgId, salesInvoicesTable.deletedAt, id, orgId)) +
      (await refN(deliveryChallansTable, deliveryChallansTable.sourceSalesOrderId, deliveryChallansTable.orgId, deliveryChallansTable.deletedAt, id, orgId)) +
      (await refN(purchaseOrdersTable, purchaseOrdersTable.sourceSalesOrderId, purchaseOrdersTable.orgId, purchaseOrdersTable.deletedAt, id, orgId)),
    setArchivedAt: async (orgId, id, value) => (await db.update(salesOrdersTable).set({ archivedAt: value, updatedAt: new Date() }).where(and(eq(salesOrdersTable.id, id), eq(salesOrdersTable.orgId, orgId))).returning({ id: salesOrdersTable.id })).length,
    setDeletedAt: async (orgId, id, value) => (await db.update(salesOrdersTable).set({ deletedAt: value, updatedAt: new Date() }).where(and(eq(salesOrdersTable.id, id), eq(salesOrdersTable.orgId, orgId))).returning({ id: salesOrdersTable.id })).length,
    hardDelete: async (orgId, id) => {
      await db.transaction(async (tx) => {
        await tx.delete(salesOrderItemsTable).where(eq(salesOrderItemsTable.salesOrderId, id));
        await tx.delete(salesOrdersTable).where(and(eq(salesOrdersTable.id, id), eq(salesOrdersTable.orgId, orgId)));
      });
    },
    listDeleted: async (orgId) => {
      const rows = await db
        .select({ id: salesOrdersTable.id, number: salesOrdersTable.soNumber, status: salesOrdersTable.status, partyName: customersTable.name, deletedAt: salesOrdersTable.deletedAt })
        .from(salesOrdersTable)
        .innerJoin(customersTable, eq(customersTable.id, salesOrdersTable.customerId))
        .where(and(eq(salesOrdersTable.orgId, orgId), isNotNull(salesOrdersTable.deletedAt)))
        .orderBy(desc(salesOrdersTable.deletedAt));
      return rows.map((r) => ({ docType: "sales_order" as const, ...r }));
    },
  },
  proforma_invoice: {
    docType: "proforma_invoice",
    typeLabel: "Proforma Invoice",
    listPath: "/sales/proforma",
    detailHref: (id) => `/sales/proforma/${id}`,
    revalidatePaths: ["/sales/proforma", "/recycle-bin"],
    loadState: async (orgId, id) => {
      const [r] = await db
        .select({ status: proformaInvoicesTable.status, number: proformaInvoicesTable.proformaNumber, archivedAt: proformaInvoicesTable.archivedAt, deletedAt: proformaInvoicesTable.deletedAt })
        .from(proformaInvoicesTable)
        .where(and(eq(proformaInvoicesTable.id, id), eq(proformaInvoicesTable.orgId, orgId)));
      return r ?? null;
    },
    countReferences: async (orgId, id) =>
      (await refN(deliveryChallansTable, deliveryChallansTable.sourceProformaId, deliveryChallansTable.orgId, deliveryChallansTable.deletedAt, id, orgId)) +
      (await refN(purchaseOrdersTable, purchaseOrdersTable.sourceProformaId, purchaseOrdersTable.orgId, purchaseOrdersTable.deletedAt, id, orgId)),
    setArchivedAt: async (orgId, id, value) => (await db.update(proformaInvoicesTable).set({ archivedAt: value, updatedAt: new Date() }).where(and(eq(proformaInvoicesTable.id, id), eq(proformaInvoicesTable.orgId, orgId))).returning({ id: proformaInvoicesTable.id })).length,
    setDeletedAt: async (orgId, id, value) => (await db.update(proformaInvoicesTable).set({ deletedAt: value, updatedAt: new Date() }).where(and(eq(proformaInvoicesTable.id, id), eq(proformaInvoicesTable.orgId, orgId))).returning({ id: proformaInvoicesTable.id })).length,
    hardDelete: async (orgId, id) => {
      await db.transaction(async (tx) => {
        await tx.delete(proformaInvoiceItemsTable).where(eq(proformaInvoiceItemsTable.proformaInvoiceId, id));
        await tx.delete(proformaInvoicesTable).where(and(eq(proformaInvoicesTable.id, id), eq(proformaInvoicesTable.orgId, orgId)));
      });
    },
    listDeleted: async (orgId) => {
      const rows = await db
        .select({ id: proformaInvoicesTable.id, number: proformaInvoicesTable.proformaNumber, status: proformaInvoicesTable.status, partyName: customersTable.name, deletedAt: proformaInvoicesTable.deletedAt })
        .from(proformaInvoicesTable)
        .innerJoin(customersTable, eq(customersTable.id, proformaInvoicesTable.customerId))
        .where(and(eq(proformaInvoicesTable.orgId, orgId), isNotNull(proformaInvoicesTable.deletedAt)))
        .orderBy(desc(proformaInvoicesTable.deletedAt));
      return rows.map((r) => ({ docType: "proforma_invoice" as const, ...r }));
    },
  },
  sales_invoice: {
    docType: "sales_invoice",
    typeLabel: "Invoice",
    listPath: "/sales/invoices",
    detailHref: (id) => `/sales/invoices/${id}`,
    revalidatePaths: ["/sales/invoices", "/recycle-bin"],
    loadState: async (orgId, id) => {
      const [r] = await db
        .select({ status: salesInvoicesTable.status, number: salesInvoicesTable.invoiceNumber, archivedAt: salesInvoicesTable.archivedAt, deletedAt: salesInvoicesTable.deletedAt })
        .from(salesInvoicesTable)
        .where(and(eq(salesInvoicesTable.id, id), eq(salesInvoicesTable.orgId, orgId)));
      return r ?? null;
    },
    countReferences: async (orgId, id) =>
      (await refN(creditNotesTable, creditNotesTable.sourceInvoiceId, creditNotesTable.orgId, creditNotesTable.deletedAt, id, orgId)) +
      (await refN(deliveryChallansTable, deliveryChallansTable.sourceInvoiceId, deliveryChallansTable.orgId, deliveryChallansTable.deletedAt, id, orgId)) +
      (await refN(purchaseOrdersTable, purchaseOrdersTable.sourceInvoiceId, purchaseOrdersTable.orgId, purchaseOrdersTable.deletedAt, id, orgId)),
    setArchivedAt: async (orgId, id, value) => (await db.update(salesInvoicesTable).set({ archivedAt: value, updatedAt: new Date() }).where(and(eq(salesInvoicesTable.id, id), eq(salesInvoicesTable.orgId, orgId))).returning({ id: salesInvoicesTable.id })).length,
    setDeletedAt: async (orgId, id, value) => (await db.update(salesInvoicesTable).set({ deletedAt: value, updatedAt: new Date() }).where(and(eq(salesInvoicesTable.id, id), eq(salesInvoicesTable.orgId, orgId))).returning({ id: salesInvoicesTable.id })).length,
    hardDelete: async (orgId, id) => {
      await db.transaction(async (tx) => {
        await tx.delete(salesInvoiceItemsTable).where(eq(salesInvoiceItemsTable.invoiceId, id));
        await tx.delete(salesInvoicesTable).where(and(eq(salesInvoicesTable.id, id), eq(salesInvoicesTable.orgId, orgId)));
      });
    },
    listDeleted: async (orgId) => {
      const rows = await db
        .select({ id: salesInvoicesTable.id, number: salesInvoicesTable.invoiceNumber, status: salesInvoicesTable.status, partyName: customersTable.name, deletedAt: salesInvoicesTable.deletedAt })
        .from(salesInvoicesTable)
        .innerJoin(customersTable, eq(customersTable.id, salesInvoicesTable.customerId))
        .where(and(eq(salesInvoicesTable.orgId, orgId), isNotNull(salesInvoicesTable.deletedAt)))
        .orderBy(desc(salesInvoicesTable.deletedAt));
      return rows.map((r) => ({ docType: "sales_invoice" as const, ...r }));
    },
  },
  delivery_challan: {
    docType: "delivery_challan",
    typeLabel: "Delivery Challan",
    listPath: "/sales/delivery-challans",
    detailHref: (id) => `/sales/delivery-challans/${id}`,
    revalidatePaths: ["/sales/delivery-challans", "/recycle-bin"],
    loadState: async (orgId, id) => {
      const [r] = await db
        .select({ status: deliveryChallansTable.status, number: deliveryChallansTable.dcNumber, archivedAt: deliveryChallansTable.archivedAt, deletedAt: deliveryChallansTable.deletedAt })
        .from(deliveryChallansTable)
        .where(and(eq(deliveryChallansTable.id, id), eq(deliveryChallansTable.orgId, orgId)));
      return r ?? null;
    },
    countReferences: async () => 0, // terminal: nothing references a delivery challan
    setArchivedAt: async (orgId, id, value) => (await db.update(deliveryChallansTable).set({ archivedAt: value, updatedAt: new Date() }).where(and(eq(deliveryChallansTable.id, id), eq(deliveryChallansTable.orgId, orgId))).returning({ id: deliveryChallansTable.id })).length,
    setDeletedAt: async (orgId, id, value) => (await db.update(deliveryChallansTable).set({ deletedAt: value, updatedAt: new Date() }).where(and(eq(deliveryChallansTable.id, id), eq(deliveryChallansTable.orgId, orgId))).returning({ id: deliveryChallansTable.id })).length,
    hardDelete: async (orgId, id) => {
      await db.transaction(async (tx) => {
        await tx.delete(deliveryChallanItemsTable).where(eq(deliveryChallanItemsTable.deliveryChallanId, id));
        await tx.delete(deliveryChallansTable).where(and(eq(deliveryChallansTable.id, id), eq(deliveryChallansTable.orgId, orgId)));
      });
    },
    listDeleted: async (orgId) => {
      const rows = await db
        .select({ id: deliveryChallansTable.id, number: deliveryChallansTable.dcNumber, status: deliveryChallansTable.status, partyName: customersTable.name, deletedAt: deliveryChallansTable.deletedAt })
        .from(deliveryChallansTable)
        .innerJoin(customersTable, eq(customersTable.id, deliveryChallansTable.customerId))
        .where(and(eq(deliveryChallansTable.orgId, orgId), isNotNull(deliveryChallansTable.deletedAt)))
        .orderBy(desc(deliveryChallansTable.deletedAt));
      return rows.map((r) => ({ docType: "delivery_challan" as const, ...r }));
    },
  },
  credit_note: {
    docType: "credit_note",
    typeLabel: "Credit Note",
    listPath: "/sales/credit-notes",
    detailHref: (id) => `/sales/credit-notes/${id}`,
    revalidatePaths: ["/sales/credit-notes", "/recycle-bin"],
    loadState: async (orgId, id) => {
      const [r] = await db
        .select({ status: creditNotesTable.status, number: creditNotesTable.creditNoteNumber, archivedAt: creditNotesTable.archivedAt, deletedAt: creditNotesTable.deletedAt })
        .from(creditNotesTable)
        .where(and(eq(creditNotesTable.id, id), eq(creditNotesTable.orgId, orgId)));
      return r ?? null;
    },
    countReferences: async () => 0, // terminal
    setArchivedAt: async (orgId, id, value) => (await db.update(creditNotesTable).set({ archivedAt: value }).where(and(eq(creditNotesTable.id, id), eq(creditNotesTable.orgId, orgId))).returning({ id: creditNotesTable.id })).length,
    setDeletedAt: async (orgId, id, value) => (await db.update(creditNotesTable).set({ deletedAt: value }).where(and(eq(creditNotesTable.id, id), eq(creditNotesTable.orgId, orgId))).returning({ id: creditNotesTable.id })).length,
    hardDelete: async (orgId, id) => {
      await db.transaction(async (tx) => {
        await tx.delete(creditNoteItemsTable).where(eq(creditNoteItemsTable.creditNoteId, id));
        await tx.delete(creditNotesTable).where(and(eq(creditNotesTable.id, id), eq(creditNotesTable.orgId, orgId)));
      });
    },
    listDeleted: async (orgId) => {
      const rows = await db
        .select({ id: creditNotesTable.id, number: creditNotesTable.creditNoteNumber, status: creditNotesTable.status, partyName: customersTable.name, deletedAt: creditNotesTable.deletedAt })
        .from(creditNotesTable)
        .innerJoin(customersTable, eq(customersTable.id, creditNotesTable.customerId))
        .where(and(eq(creditNotesTable.orgId, orgId), isNotNull(creditNotesTable.deletedAt)))
        .orderBy(desc(creditNotesTable.deletedAt));
      return rows.map((r) => ({ docType: "credit_note" as const, ...r }));
    },
  },
  debit_note: {
    docType: "debit_note",
    typeLabel: "Debit Note",
    listPath: "/purchasing/debit-notes",
    detailHref: (id) => `/purchasing/debit-notes/${id}`,
    revalidatePaths: ["/purchasing/debit-notes", "/recycle-bin"],
    loadState: async (orgId, id) => {
      const [r] = await db
        .select({ status: debitNotesTable.status, number: debitNotesTable.debitNoteNumber, archivedAt: debitNotesTable.archivedAt, deletedAt: debitNotesTable.deletedAt })
        .from(debitNotesTable)
        .where(and(eq(debitNotesTable.id, id), eq(debitNotesTable.orgId, orgId)));
      return r ?? null;
    },
    countReferences: async () => 0, // terminal
    setArchivedAt: async (orgId, id, value) => (await db.update(debitNotesTable).set({ archivedAt: value }).where(and(eq(debitNotesTable.id, id), eq(debitNotesTable.orgId, orgId))).returning({ id: debitNotesTable.id })).length,
    setDeletedAt: async (orgId, id, value) => (await db.update(debitNotesTable).set({ deletedAt: value }).where(and(eq(debitNotesTable.id, id), eq(debitNotesTable.orgId, orgId))).returning({ id: debitNotesTable.id })).length,
    hardDelete: async (orgId, id) => {
      await db.transaction(async (tx) => {
        await tx.delete(debitNoteItemsTable).where(eq(debitNoteItemsTable.debitNoteId, id));
        await tx.delete(debitNotesTable).where(and(eq(debitNotesTable.id, id), eq(debitNotesTable.orgId, orgId)));
      });
    },
    listDeleted: async (orgId) => {
      const rows = await db
        .select({ id: debitNotesTable.id, number: debitNotesTable.debitNoteNumber, status: debitNotesTable.status, partyName: vendorsTable.name, deletedAt: debitNotesTable.deletedAt })
        .from(debitNotesTable)
        .innerJoin(vendorsTable, eq(vendorsTable.id, debitNotesTable.vendorId))
        .where(and(eq(debitNotesTable.orgId, orgId), isNotNull(debitNotesTable.deletedAt)))
        .orderBy(desc(debitNotesTable.deletedAt));
      return rows.map((r) => ({ docType: "debit_note" as const, ...r }));
    },
  },
  purchase_order: {
    docType: "purchase_order",
    typeLabel: "Purchase Order",
    listPath: "/purchasing/orders",
    detailHref: (id) => `/purchasing/orders/${id}`,
    revalidatePaths: ["/purchasing/orders", "/recycle-bin"],
    loadState: async (orgId, id) => {
      const [r] = await db
        .select({ status: purchaseOrdersTable.status, number: purchaseOrdersTable.poNumber, archivedAt: purchaseOrdersTable.archivedAt, deletedAt: purchaseOrdersTable.deletedAt })
        .from(purchaseOrdersTable)
        .where(and(eq(purchaseOrdersTable.id, id), eq(purchaseOrdersTable.orgId, orgId)));
      return r ?? null;
    },
    countReferences: async (orgId, id) => refN(debitNotesTable, debitNotesTable.sourcePurchaseOrderId, debitNotesTable.orgId, debitNotesTable.deletedAt, id, orgId),
    setArchivedAt: async (orgId, id, value) => (await db.update(purchaseOrdersTable).set({ archivedAt: value, updatedAt: new Date() }).where(and(eq(purchaseOrdersTable.id, id), eq(purchaseOrdersTable.orgId, orgId))).returning({ id: purchaseOrdersTable.id })).length,
    setDeletedAt: async (orgId, id, value) => (await db.update(purchaseOrdersTable).set({ deletedAt: value, updatedAt: new Date() }).where(and(eq(purchaseOrdersTable.id, id), eq(purchaseOrdersTable.orgId, orgId))).returning({ id: purchaseOrdersTable.id })).length,
    hardDelete: async (orgId, id) => {
      await db.transaction(async (tx) => {
        await tx.delete(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.purchaseOrderId, id));
        await tx.delete(purchaseOrdersTable).where(and(eq(purchaseOrdersTable.id, id), eq(purchaseOrdersTable.orgId, orgId)));
      });
    },
    listDeleted: async (orgId) => {
      const rows = await db
        .select({ id: purchaseOrdersTable.id, number: purchaseOrdersTable.poNumber, status: purchaseOrdersTable.status, partyName: vendorsTable.name, deletedAt: purchaseOrdersTable.deletedAt })
        .from(purchaseOrdersTable)
        .innerJoin(vendorsTable, eq(vendorsTable.id, purchaseOrdersTable.vendorId))
        .where(and(eq(purchaseOrdersTable.orgId, orgId), isNotNull(purchaseOrdersTable.deletedAt)))
        .orderBy(desc(purchaseOrdersTable.deletedAt));
      return rows.map((r) => ({ docType: "purchase_order" as const, ...r }));
    },
  },
};

/** Registry entry by document type. */
export function docAdmin(docType: DocumentType): DocAdminEntry {
  return DOCUMENT_ADMIN[docType];
}
