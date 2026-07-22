import "server-only";
import { and, eq, or, ilike, isNull, desc } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  db,
  quotationsTable,
  salesOrdersTable,
  proformaInvoicesTable,
  salesInvoicesTable,
  deliveryChallansTable,
  creditNotesTable,
  debitNotesTable,
  purchaseOrdersTable,
  customersTable,
  vendorsTable,
  productsTable,
} from "@/db";

// Batch E — global search over real ERP records (not navigation). Every query is tenant-scoped
// (orgId) and excludes soft-deleted rows; results carry a detail href so the palette can open
// the record. Kept to a small per-type cap so one keystroke stays fast.
export type SearchResult = {
  type: string; // i18n key for the group label, e.g. "Invoices"
  id: number;
  label: string; // primary (number / name)
  sublabel: string; // secondary (party / sku / status)
  href: string;
};

const PER_TYPE = 5;

export async function searchRecords(orgId: number, query: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${q}%`;

  // A sales document sharing the customer + number shape.
  const salesDoc = (
    table: typeof quotationsTable,
    numberCol: PgColumn,
    typeKey: string,
    hrefBase: string,
  ) =>
    db
      .select({ id: table.id, number: numberCol, party: customersTable.name, status: table.status })
      .from(table)
      .innerJoin(customersTable, eq(customersTable.id, table.customerId))
      .where(and(eq(table.orgId, orgId), isNull(table.deletedAt), or(ilike(numberCol, like), ilike(customersTable.name, like))))
      .orderBy(desc(table.id))
      .limit(PER_TYPE)
      .then((rows) => rows.map((r) => ({ type: typeKey, id: r.id, label: r.number as string, sublabel: r.party, href: `${hrefBase}/${r.id}` })));

  const [quotes, orders, proforma, invoices, challans, credits, debits, pos, clients, vendors, products] = await Promise.all([
    salesDoc(quotationsTable, quotationsTable.quotationNumber, "Quotations", "/sales/quotations"),
    salesDoc(salesOrdersTable as unknown as typeof quotationsTable, salesOrdersTable.soNumber, "Sales Orders", "/sales/orders"),
    salesDoc(proformaInvoicesTable as unknown as typeof quotationsTable, proformaInvoicesTable.proformaNumber, "Proforma Invoices", "/sales/proforma"),
    salesDoc(salesInvoicesTable as unknown as typeof quotationsTable, salesInvoicesTable.invoiceNumber, "Invoices", "/sales/invoices"),
    salesDoc(deliveryChallansTable as unknown as typeof quotationsTable, deliveryChallansTable.dcNumber, "Delivery Challans", "/sales/delivery-challans"),
    salesDoc(creditNotesTable as unknown as typeof quotationsTable, creditNotesTable.creditNoteNumber, "Credit Notes", "/sales/credit-notes"),
    // vendor-side doc
    db
      .select({ id: debitNotesTable.id, number: debitNotesTable.debitNoteNumber, party: vendorsTable.name })
      .from(debitNotesTable)
      .innerJoin(vendorsTable, eq(vendorsTable.id, debitNotesTable.vendorId))
      .where(and(eq(debitNotesTable.orgId, orgId), isNull(debitNotesTable.deletedAt), or(ilike(debitNotesTable.debitNoteNumber, like), ilike(vendorsTable.name, like))))
      .orderBy(desc(debitNotesTable.id))
      .limit(PER_TYPE)
      .then((rows) => rows.map((r) => ({ type: "Debit Notes", id: r.id, label: r.number, sublabel: r.party, href: `/purchasing/debit-notes/${r.id}` }))),
    db
      .select({ id: purchaseOrdersTable.id, number: purchaseOrdersTable.poNumber, party: vendorsTable.name })
      .from(purchaseOrdersTable)
      .innerJoin(vendorsTable, eq(vendorsTable.id, purchaseOrdersTable.vendorId))
      .where(and(eq(purchaseOrdersTable.orgId, orgId), isNull(purchaseOrdersTable.deletedAt), or(ilike(purchaseOrdersTable.poNumber, like), ilike(vendorsTable.name, like))))
      .orderBy(desc(purchaseOrdersTable.id))
      .limit(PER_TYPE)
      .then((rows) => rows.map((r) => ({ type: "Purchase Orders", id: r.id, label: r.number, sublabel: r.party, href: `/purchasing/orders/${r.id}` }))),
    db
      .select({ id: customersTable.id, name: customersTable.name })
      .from(customersTable)
      .where(and(eq(customersTable.orgId, orgId), eq(customersTable.isActive, true), ilike(customersTable.name, like)))
      .orderBy(desc(customersTable.id))
      .limit(PER_TYPE)
      .then((rows) => rows.map((r) => ({ type: "Clients", id: r.id, label: r.name, sublabel: "", href: `/clients/${r.id}` }))),
    db
      .select({ id: vendorsTable.id, name: vendorsTable.name })
      .from(vendorsTable)
      .where(and(eq(vendorsTable.orgId, orgId), eq(vendorsTable.isActive, true), ilike(vendorsTable.name, like)))
      .orderBy(desc(vendorsTable.id))
      .limit(PER_TYPE)
      .then((rows) => rows.map((r) => ({ type: "Vendors", id: r.id, label: r.name, sublabel: "", href: `/purchasing/vendors/${r.id}` }))),
    db
      .select({ id: productsTable.id, name: productsTable.name, sku: productsTable.sku })
      .from(productsTable)
      .where(and(eq(productsTable.orgId, orgId), eq(productsTable.isActive, true), or(ilike(productsTable.name, like), ilike(productsTable.sku, like))))
      .orderBy(desc(productsTable.id))
      .limit(PER_TYPE)
      .then((rows) => rows.map((r) => ({ type: "Products", id: r.id, label: r.name, sublabel: r.sku ?? "", href: `/inventory/products/${r.id}` }))),
  ]);

  return [...invoices, ...quotes, ...orders, ...proforma, ...challans, ...credits, ...pos, ...debits, ...clients, ...vendors, ...products];
}
