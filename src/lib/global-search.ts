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
  employeesTable,
  projectsTable,
  journalEntriesTable,
} from "@/db";

// Global search over real ERP records (NOT navigation — that lives in the ⌘K command palette).
// Every query is tenant-scoped (orgId) and excludes soft-deleted rows; results carry a detail href
// so the search panel can open the record. Kept to a small per-type cap so one keystroke stays fast.
// Searchable fields per type: document number, name, code, email, phone, VAT number and SKU where
// applicable.
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

  // A sales document sharing the customer + number shape (matches on the document number or the
  // client's name).
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

  const [quotes, orders, proforma, invoices, challans, credits, pos, debits, clients, vendors, products, employees, projects, journal] = await Promise.all([
    salesDoc(quotationsTable, quotationsTable.quotationNumber, "Quotations", "/sales/quotations"),
    salesDoc(salesOrdersTable as unknown as typeof quotationsTable, salesOrdersTable.soNumber, "Sales Orders", "/sales/orders"),
    salesDoc(proformaInvoicesTable as unknown as typeof quotationsTable, proformaInvoicesTable.proformaNumber, "Proforma Invoices", "/sales/proforma"),
    salesDoc(salesInvoicesTable as unknown as typeof quotationsTable, salesInvoicesTable.invoiceNumber, "Invoices", "/sales/invoices"),
    salesDoc(deliveryChallansTable as unknown as typeof quotationsTable, deliveryChallansTable.dcNumber, "Delivery Challans", "/sales/delivery-challans"),
    salesDoc(creditNotesTable as unknown as typeof quotationsTable, creditNotesTable.creditNoteNumber, "Credit Notes", "/sales/credit-notes"),
    // vendor-side docs
    db
      .select({ id: purchaseOrdersTable.id, number: purchaseOrdersTable.poNumber, party: vendorsTable.name })
      .from(purchaseOrdersTable)
      .innerJoin(vendorsTable, eq(vendorsTable.id, purchaseOrdersTable.vendorId))
      .where(and(eq(purchaseOrdersTable.orgId, orgId), isNull(purchaseOrdersTable.deletedAt), or(ilike(purchaseOrdersTable.poNumber, like), ilike(vendorsTable.name, like))))
      .orderBy(desc(purchaseOrdersTable.id))
      .limit(PER_TYPE)
      .then((rows) => rows.map((r) => ({ type: "Purchase Orders", id: r.id, label: r.number, sublabel: r.party, href: `/purchasing/orders/${r.id}` }))),
    db
      .select({ id: debitNotesTable.id, number: debitNotesTable.debitNoteNumber, party: vendorsTable.name })
      .from(debitNotesTable)
      .innerJoin(vendorsTable, eq(vendorsTable.id, debitNotesTable.vendorId))
      .where(and(eq(debitNotesTable.orgId, orgId), isNull(debitNotesTable.deletedAt), or(ilike(debitNotesTable.debitNoteNumber, like), ilike(vendorsTable.name, like))))
      .orderBy(desc(debitNotesTable.id))
      .limit(PER_TYPE)
      .then((rows) => rows.map((r) => ({ type: "Debit Notes", id: r.id, label: r.number, sublabel: r.party, href: `/purchasing/debit-notes/${r.id}` }))),
    // Clients — name / email / phone / VAT number
    db
      .select({ id: customersTable.id, name: customersTable.name, email: customersTable.email, vatNumber: customersTable.vatNumber })
      .from(customersTable)
      .where(
        and(
          eq(customersTable.orgId, orgId),
          eq(customersTable.isActive, true),
          or(ilike(customersTable.name, like), ilike(customersTable.email, like), ilike(customersTable.phone, like), ilike(customersTable.vatNumber, like)),
        ),
      )
      .orderBy(desc(customersTable.id))
      .limit(PER_TYPE)
      .then((rows) => rows.map((r) => ({ type: "Clients", id: r.id, label: r.name, sublabel: r.email ?? r.vatNumber ?? "", href: `/clients/${r.id}` }))),
    // Vendors — name / email / phone / VAT number
    db
      .select({ id: vendorsTable.id, name: vendorsTable.name, email: vendorsTable.email, vatNumber: vendorsTable.vatNumber })
      .from(vendorsTable)
      .where(
        and(
          eq(vendorsTable.orgId, orgId),
          eq(vendorsTable.isActive, true),
          or(ilike(vendorsTable.name, like), ilike(vendorsTable.email, like), ilike(vendorsTable.phone, like), ilike(vendorsTable.vatNumber, like)),
        ),
      )
      .orderBy(desc(vendorsTable.id))
      .limit(PER_TYPE)
      .then((rows) => rows.map((r) => ({ type: "Vendors", id: r.id, label: r.name, sublabel: r.email ?? r.vatNumber ?? "", href: `/purchasing/vendors/${r.id}` }))),
    // Products — name / SKU
    db
      .select({ id: productsTable.id, name: productsTable.name, sku: productsTable.sku })
      .from(productsTable)
      .where(and(eq(productsTable.orgId, orgId), eq(productsTable.isActive, true), or(ilike(productsTable.name, like), ilike(productsTable.sku, like))))
      .orderBy(desc(productsTable.id))
      .limit(PER_TYPE)
      .then((rows) => rows.map((r) => ({ type: "Products", id: r.id, label: r.name, sublabel: r.sku ?? "", href: `/inventory/products/${r.id}` }))),
    // Employees — name / employee code / email / phone
    db
      .select({ id: employeesTable.id, name: employeesTable.name, code: employeesTable.employeeCode, designation: employeesTable.designation })
      .from(employeesTable)
      .where(
        and(
          eq(employeesTable.orgId, orgId),
          or(ilike(employeesTable.name, like), ilike(employeesTable.employeeCode, like), ilike(employeesTable.email, like), ilike(employeesTable.phone, like)),
        ),
      )
      .orderBy(desc(employeesTable.id))
      .limit(PER_TYPE)
      .then((rows) => rows.map((r) => ({ type: "Employees", id: r.id, label: r.name, sublabel: r.designation ?? r.code, href: `/hr/employees/${r.id}` }))),
    // Projects — name
    db
      .select({ id: projectsTable.id, name: projectsTable.name, status: projectsTable.status })
      .from(projectsTable)
      .where(and(eq(projectsTable.orgId, orgId), ilike(projectsTable.name, like)))
      .orderBy(desc(projectsTable.id))
      .limit(PER_TYPE)
      .then((rows) => rows.map((r) => ({ type: "Projects", id: r.id, label: r.name, sublabel: r.status, href: `/projects/${r.id}` }))),
    // Journal entries — memo (no per-entry detail page; the search opens the Journal Entry screen,
    // anchored to the matching row).
    db
      .select({ id: journalEntriesTable.id, memo: journalEntriesTable.memo, entryDate: journalEntriesTable.entryDate })
      .from(journalEntriesTable)
      .where(and(eq(journalEntriesTable.orgId, orgId), ilike(journalEntriesTable.memo, like)))
      .orderBy(desc(journalEntriesTable.id))
      .limit(PER_TYPE)
      .then((rows) => rows.map((r) => ({ type: "Journal Entries", id: r.id, label: r.memo, sublabel: r.entryDate ?? "", href: `/finance/journal#je-${r.id}` }))),
  ]);

  return [
    ...invoices,
    ...quotes,
    ...orders,
    ...proforma,
    ...challans,
    ...credits,
    ...pos,
    ...debits,
    ...clients,
    ...vendors,
    ...products,
    ...employees,
    ...projects,
    ...journal,
  ];
}
