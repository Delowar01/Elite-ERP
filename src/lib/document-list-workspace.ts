import "server-only";
import { and, eq, or, ilike, gte, lte, isNull, isNotNull, desc, count } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  db,
  type Tx,
  quotationsTable,
  quotationItemsTable,
  salesOrdersTable,
  salesOrderItemsTable,
  proformaInvoicesTable,
  proformaInvoiceItemsTable,
  salesInvoicesTable,
  salesInvoiceItemsTable,
  deliveryChallansTable,
  creditNotesTable,
  creditNoteItemsTable,
  debitNotesTable,
  debitNoteItemsTable,
  purchaseOrdersTable,
  purchaseOrderItemsTable,
  customersTable,
  vendorsTable,
} from "@/db";
import { nextDocumentNumber } from "@/lib/documents";
import type { DocumentType } from "@/lib/document-lifecycle";
import type { ListFilterState } from "@/app/(app)/documents/_workspace/filter-types";

/**
 * Batch B — the list-workspace registry. One place that knows, per document module,
 * how to filter + export the list (respecting tenant scope) and how to validate + import
 * draft records from a CSV. Everything is tenant-scoped by orgId; import creates DRAFT
 * documents only and never posts to the ledger or touches stock.
 */

// ---------- shared filter → SQL ----------
type FilterCols = {
  orgCol: PgColumn;
  statusCol: PgColumn;
  dateCol: PgColumn;
  partyNameCol: PgColumn;
  archivedCol: PgColumn;
  deletedCol: PgColumn;
  searchCols: PgColumn[];
};
function filterConds(cols: FilterCols, orgId: number, f: ListFilterState) {
  const conds = [eq(cols.orgCol, orgId), isNull(cols.deletedCol)];
  if (f.status) conds.push(eq(cols.statusCol, f.status));
  if (f.dateFrom) conds.push(gte(cols.dateCol, f.dateFrom));
  if (f.dateTo) conds.push(lte(cols.dateCol, f.dateTo));
  if (f.party) conds.push(eq(cols.partyNameCol, f.party));
  if (f.archived === "active") conds.push(isNull(cols.archivedCol));
  if (f.archived === "archived") conds.push(isNotNull(cols.archivedCol));
  if (f.search) {
    const s = `%${f.search}%`;
    const like = cols.searchCols.map((c) => ilike(c, s));
    const combined = like.length > 1 ? or(...like) : like[0];
    if (combined) conds.push(combined);
  }
  return and(...conds);
}

export type ExportColumn = { key: string; header: string };
export type ExportResult = { columns: ExportColumn[]; rows: Record<string, string>[] };
export type ImportColumn = { key: string; header: string; required: boolean; note?: string };
export type ImportRowResult = { row: number; ok: boolean; errors: string[] };

const money = (v: string | null) => (v == null ? "" : v);
const dash = (v: string | null) => v ?? "";

// ---------- party / value helpers for import ----------
async function findCustomerId(orgId: number, name: string): Promise<number | null> {
  const [c] = await db.select({ id: customersTable.id }).from(customersTable).where(and(eq(customersTable.orgId, orgId), ilike(customersTable.name, name.trim())));
  return c?.id ?? null;
}
async function findVendorId(orgId: number, name: string): Promise<number | null> {
  const [v] = await db.select({ id: vendorsTable.id }).from(vendorsTable).where(and(eq(vendorsTable.orgId, orgId), ilike(vendorsTable.name, name.trim())));
  return v?.id ?? null;
}
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
const isAmount = (s: string) => s.trim() === "" || (/^\d+(\.\d{1,2})?$/.test(s.trim()) && Number(s) >= 0);
function totalsFromAmount(amount: string): { subtotal: string; taxTotal: string; total: string; hasItem: boolean } {
  const a = Number(amount || "0");
  return { subtotal: a.toFixed(2), taxTotal: "0.00", total: a.toFixed(2), hasItem: a > 0 };
}

export type WorkspaceEntry = {
  docType: DocumentType;
  partyLabel: string; // i18n key: "Client" | "Vendor"
  statuses: string[];
  loadForExport: (orgId: number, f: ListFilterState) => Promise<ExportResult>;
  importColumns: ImportColumn[];
  // validate one parsed row; returns error messages (empty = valid). `batchNumbers` are the
  // (lower-cased) document numbers already seen earlier in this same file, to catch in-file dups.
  validateRow: (orgId: number, cells: Record<string, string>, batchNumbers: Set<string>) => Promise<string[]>;
  // insert one already-validated draft row inside a transaction.
  insertRow: (tx: Tx, orgId: number, userId: number, cells: Record<string, string>) => Promise<void>;
};

// ============================================================================
// Per-module entries
// ============================================================================

// A small factory for the four sales pricing docs that share the customer + amount shape.
function salesPricingExport(
  orgId: number,
  f: ListFilterState,
  table: typeof quotationsTable,
  numberCol: PgColumn,
  dateCol: PgColumn,
  numberHeader: string,
): Promise<ExportResult> {
  const cols: FilterCols = { orgCol: table.orgId, statusCol: table.status, dateCol, partyNameCol: customersTable.name, archivedCol: table.archivedAt, deletedCol: table.deletedAt, searchCols: [numberCol, customersTable.name] };
  return db
    .select({ number: numberCol, party: customersTable.name, date: dateCol, amount: table.total, status: table.status })
    .from(table)
    .innerJoin(customersTable, eq(customersTable.id, table.customerId))
    .where(filterConds(cols, orgId, f))
    .orderBy(desc(table.id))
    .then((rows) => ({
      columns: [
        { key: "number", header: numberHeader },
        { key: "party", header: "Client" },
        { key: "date", header: "Date" },
        { key: "amount", header: "Amount" },
        { key: "status", header: "Status" },
      ],
      rows: rows.map((r) => ({ number: r.number as string, party: r.party, date: String(r.date), amount: money(r.amount as string), status: r.status })),
    }));
}

async function checkNumberFree(orgId: number, numberCol: PgColumn, table: typeof quotationsTable, num: string): Promise<boolean> {
  const [x] = await db.select({ n: count() }).from(table).where(and(eq(table.orgId, orgId), eq(numberCol, num)));
  return Number(x?.n ?? 0) === 0;
}

export const WORKSPACE: Record<DocumentType, WorkspaceEntry> = {
  quotation: {
    docType: "quotation",
    partyLabel: "Client",
    statuses: ["draft", "sent", "accepted", "rejected", "expired"],
    loadForExport: (orgId, f) => salesPricingExport(orgId, f, quotationsTable, quotationsTable.quotationNumber, quotationsTable.issueDate, "Quotation #"),
    importColumns: [
      { key: "number", header: "Number", required: false, note: "auto-generated if blank" },
      { key: "client", header: "Client", required: true },
      { key: "date", header: "Issue Date", required: true, note: "YYYY-MM-DD" },
      { key: "title", header: "Title", required: false },
      { key: "amount", header: "Amount", required: false },
    ],
    validateRow: async (orgId, c, batch) => {
      const errs: string[] = [];
      if (!c.client?.trim()) errs.push("Client is required.");
      else if (!(await findCustomerId(orgId, c.client))) errs.push(`Client "${c.client}" not found.`);
      if (!isDate(c.date || "")) errs.push("Issue Date must be YYYY-MM-DD.");
      if (!isAmount(c.amount || "")) errs.push("Amount must be a non-negative number.");
      const num = (c.number || "").trim();
      if (num) {
        if (batch.has(num.toLowerCase())) errs.push(`Duplicate document number "${num}" within the file.`);
        else if (!(await checkNumberFree(orgId, quotationsTable.quotationNumber, quotationsTable, num))) errs.push(`Quotation number "${num}" already exists.`);
      }
      return errs;
    },
    insertRow: async (tx, orgId, userId, c) => {
      const number = (c.number || "").trim() || (await nextDocumentNumber(tx, orgId, "quotation"));
      const t = totalsFromAmount(c.amount || "0");
      const [q] = await tx.insert(quotationsTable).values({ orgId, quotationNumber: number, customerId: (await findCustomerId(orgId, c.client))!, issueDate: c.date, title: c.title?.trim() || null, subtotal: t.subtotal, discount: "0", taxTotal: t.taxTotal, total: t.total, createdById: userId }).returning({ id: quotationsTable.id });
      if (t.hasItem) await tx.insert(quotationItemsTable).values({ quotationId: q.id, description: "Imported line", quantity: "1", unitPrice: t.subtotal, taxRatePercent: "0", lineTotal: t.subtotal });
    },
  },
  sales_order: {
    docType: "sales_order",
    partyLabel: "Client",
    statuses: ["draft", "confirmed", "fulfilled", "cancelled"],
    loadForExport: (orgId, f) => salesPricingExport(orgId, f, salesOrdersTable as unknown as typeof quotationsTable, salesOrdersTable.soNumber, salesOrdersTable.issueDate, "SO #"),
    importColumns: [
      { key: "number", header: "Number", required: false, note: "auto-generated if blank" },
      { key: "client", header: "Client", required: true },
      { key: "date", header: "Order Date", required: true, note: "YYYY-MM-DD" },
      { key: "title", header: "Title", required: false },
      { key: "amount", header: "Amount", required: false },
    ],
    validateRow: async (orgId, c, batch) => {
      const errs: string[] = [];
      if (!c.client?.trim()) errs.push("Client is required.");
      else if (!(await findCustomerId(orgId, c.client))) errs.push(`Client "${c.client}" not found.`);
      if (!isDate(c.date || "")) errs.push("Order Date must be YYYY-MM-DD.");
      if (!isAmount(c.amount || "")) errs.push("Amount must be a non-negative number.");
      const num = (c.number || "").trim();
      if (num) {
        if (batch.has(num.toLowerCase())) errs.push(`Duplicate document number "${num}" within the file.`);
        else if (!(await checkNumberFree(orgId, salesOrdersTable.soNumber, salesOrdersTable as unknown as typeof quotationsTable, num))) errs.push(`Sales order number "${num}" already exists.`);
      }
      return errs;
    },
    insertRow: async (tx, orgId, userId, c) => {
      const number = (c.number || "").trim() || (await nextDocumentNumber(tx, orgId, "sales_order"));
      const t = totalsFromAmount(c.amount || "0");
      const [so] = await tx.insert(salesOrdersTable).values({ orgId, soNumber: number, customerId: (await findCustomerId(orgId, c.client))!, issueDate: c.date, title: c.title?.trim() || null, subtotal: t.subtotal, discount: "0", taxTotal: t.taxTotal, total: t.total, createdById: userId }).returning({ id: salesOrdersTable.id });
      if (t.hasItem) await tx.insert(salesOrderItemsTable).values({ salesOrderId: so.id, description: "Imported line", quantity: "1", unitPrice: t.subtotal, taxRatePercent: "0", lineTotal: t.subtotal });
    },
  },
  proforma_invoice: {
    docType: "proforma_invoice",
    partyLabel: "Client",
    statuses: ["draft", "sent"],
    loadForExport: (orgId, f) => salesPricingExport(orgId, f, proformaInvoicesTable as unknown as typeof quotationsTable, proformaInvoicesTable.proformaNumber, proformaInvoicesTable.issueDate, "Proforma #"),
    importColumns: [
      { key: "number", header: "Number", required: false, note: "auto-generated if blank" },
      { key: "client", header: "Client", required: true },
      { key: "date", header: "Issue Date", required: true, note: "YYYY-MM-DD" },
      { key: "title", header: "Title", required: false },
      { key: "amount", header: "Amount", required: false },
    ],
    validateRow: async (orgId, c, batch) => {
      const errs: string[] = [];
      if (!c.client?.trim()) errs.push("Client is required.");
      else if (!(await findCustomerId(orgId, c.client))) errs.push(`Client "${c.client}" not found.`);
      if (!isDate(c.date || "")) errs.push("Issue Date must be YYYY-MM-DD.");
      if (!isAmount(c.amount || "")) errs.push("Amount must be a non-negative number.");
      const num = (c.number || "").trim();
      if (num) {
        if (batch.has(num.toLowerCase())) errs.push(`Duplicate document number "${num}" within the file.`);
        else if (!(await checkNumberFree(orgId, proformaInvoicesTable.proformaNumber, proformaInvoicesTable as unknown as typeof quotationsTable, num))) errs.push(`Proforma number "${num}" already exists.`);
      }
      return errs;
    },
    insertRow: async (tx, orgId, userId, c) => {
      const number = (c.number || "").trim() || (await nextDocumentNumber(tx, orgId, "proforma_invoice"));
      const t = totalsFromAmount(c.amount || "0");
      const [pf] = await tx.insert(proformaInvoicesTable).values({ orgId, proformaNumber: number, customerId: (await findCustomerId(orgId, c.client))!, issueDate: c.date, title: c.title?.trim() || null, subtotal: t.subtotal, discount: "0", taxTotal: t.taxTotal, total: t.total, createdById: userId }).returning({ id: proformaInvoicesTable.id });
      if (t.hasItem) await tx.insert(proformaInvoiceItemsTable).values({ proformaInvoiceId: pf.id, description: "Imported line", quantity: "1", unitPrice: t.subtotal, taxRatePercent: "0", lineTotal: t.subtotal });
    },
  },
  sales_invoice: {
    docType: "sales_invoice",
    partyLabel: "Client",
    statuses: ["draft", "sent", "partially_paid", "paid", "void"],
    loadForExport: (orgId, f) => salesPricingExport(orgId, f, salesInvoicesTable as unknown as typeof quotationsTable, salesInvoicesTable.invoiceNumber, salesInvoicesTable.issueDate, "Invoice #"),
    importColumns: [
      { key: "number", header: "Number", required: false, note: "auto-generated if blank" },
      { key: "client", header: "Client", required: true },
      { key: "date", header: "Issue Date", required: true, note: "YYYY-MM-DD" },
      { key: "title", header: "Title", required: false },
      { key: "amount", header: "Amount", required: false },
    ],
    validateRow: async (orgId, c, batch) => {
      const errs: string[] = [];
      if (!c.client?.trim()) errs.push("Client is required.");
      else if (!(await findCustomerId(orgId, c.client))) errs.push(`Client "${c.client}" not found.`);
      if (!isDate(c.date || "")) errs.push("Issue Date must be YYYY-MM-DD.");
      if (!isAmount(c.amount || "")) errs.push("Amount must be a non-negative number.");
      const num = (c.number || "").trim();
      if (num) {
        if (batch.has(num.toLowerCase())) errs.push(`Duplicate document number "${num}" within the file.`);
        else if (!(await checkNumberFree(orgId, salesInvoicesTable.invoiceNumber, salesInvoicesTable as unknown as typeof quotationsTable, num))) errs.push(`Invoice number "${num}" already exists.`);
      }
      return errs;
    },
    insertRow: async (tx, orgId, userId, c) => {
      const number = (c.number || "").trim() || (await nextDocumentNumber(tx, orgId, "sales_invoice"));
      const t = totalsFromAmount(c.amount || "0");
      const [inv] = await tx.insert(salesInvoicesTable).values({ orgId, invoiceNumber: number, customerId: (await findCustomerId(orgId, c.client))!, issueDate: c.date, title: c.title?.trim() || null, subtotal: t.subtotal, discount: "0", taxTotal: t.taxTotal, total: t.total, createdById: userId }).returning({ id: salesInvoicesTable.id });
      if (t.hasItem) await tx.insert(salesInvoiceItemsTable).values({ invoiceId: inv.id, description: "Imported line", quantity: "1", unitPrice: t.subtotal, taxRatePercent: "0", lineTotal: t.subtotal });
    },
  },
  delivery_challan: {
    docType: "delivery_challan",
    partyLabel: "Client",
    statuses: ["draft", "dispatched", "delivered"],
    loadForExport: async (orgId, f) => {
      const cols: FilterCols = { orgCol: deliveryChallansTable.orgId, statusCol: deliveryChallansTable.status, dateCol: deliveryChallansTable.dispatchDate, partyNameCol: customersTable.name, archivedCol: deliveryChallansTable.archivedAt, deletedCol: deliveryChallansTable.deletedAt, searchCols: [deliveryChallansTable.dcNumber, customersTable.name] };
      const rows = await db
        .select({ number: deliveryChallansTable.dcNumber, party: customersTable.name, date: deliveryChallansTable.dispatchDate, carrier: deliveryChallansTable.carrier, status: deliveryChallansTable.status })
        .from(deliveryChallansTable)
        .innerJoin(customersTable, eq(customersTable.id, deliveryChallansTable.customerId))
        .where(filterConds(cols, orgId, f))
        .orderBy(desc(deliveryChallansTable.id));
      return {
        columns: [
          { key: "number", header: "DC Number" },
          { key: "party", header: "Client" },
          { key: "date", header: "Dispatch Date" },
          { key: "carrier", header: "Carrier" },
          { key: "status", header: "Status" },
        ],
        rows: rows.map((r) => ({ number: r.number, party: r.party, date: dash(r.date), carrier: dash(r.carrier), status: r.status })),
      };
    },
    importColumns: [
      { key: "number", header: "Number", required: false, note: "auto-generated if blank" },
      { key: "client", header: "Client", required: true },
      { key: "date", header: "Dispatch Date", required: false, note: "YYYY-MM-DD" },
      { key: "carrier", header: "Carrier", required: false },
    ],
    validateRow: async (orgId, c, batch) => {
      const errs: string[] = [];
      if (!c.client?.trim()) errs.push("Client is required.");
      else if (!(await findCustomerId(orgId, c.client))) errs.push(`Client "${c.client}" not found.`);
      if (c.date?.trim() && !isDate(c.date)) errs.push("Dispatch Date must be YYYY-MM-DD.");
      const num = (c.number || "").trim();
      if (num) {
        if (batch.has(num.toLowerCase())) errs.push(`Duplicate document number "${num}" within the file.`);
        else if (!(await checkNumberFree(orgId, deliveryChallansTable.dcNumber, deliveryChallansTable as unknown as typeof quotationsTable, num))) errs.push(`Delivery challan number "${num}" already exists.`);
      }
      return errs;
    },
    insertRow: async (tx, orgId, userId, c) => {
      const number = (c.number || "").trim() || (await nextDocumentNumber(tx, orgId, "delivery_challan"));
      await tx.insert(deliveryChallansTable).values({ orgId, dcNumber: number, customerId: (await findCustomerId(orgId, c.client))!, dispatchDate: c.date?.trim() || null, carrier: c.carrier?.trim() || null, createdById: userId });
    },
  },
  credit_note: {
    docType: "credit_note",
    partyLabel: "Client",
    statuses: ["draft", "issued", "reversed"],
    loadForExport: async (orgId, f) => {
      const cols: FilterCols = { orgCol: creditNotesTable.orgId, statusCol: creditNotesTable.status, dateCol: creditNotesTable.issueDate, partyNameCol: customersTable.name, archivedCol: creditNotesTable.archivedAt, deletedCol: creditNotesTable.deletedAt, searchCols: [creditNotesTable.creditNoteNumber, customersTable.name] };
      const rows = await db
        .select({ number: creditNotesTable.creditNoteNumber, party: customersTable.name, date: creditNotesTable.issueDate, amount: creditNotesTable.total, status: creditNotesTable.status })
        .from(creditNotesTable)
        .innerJoin(customersTable, eq(customersTable.id, creditNotesTable.customerId))
        .where(filterConds(cols, orgId, f))
        .orderBy(desc(creditNotesTable.id));
      return {
        columns: [
          { key: "number", header: "CN Number" },
          { key: "party", header: "Client" },
          { key: "date", header: "Issue Date" },
          { key: "amount", header: "Amount" },
          { key: "status", header: "Status" },
        ],
        rows: rows.map((r) => ({ number: r.number, party: r.party, date: String(r.date), amount: money(r.amount), status: r.status })),
      };
    },
    importColumns: [
      { key: "number", header: "Number", required: false, note: "auto-generated if blank" },
      { key: "sourceInvoice", header: "Source Invoice", required: true, note: "existing invoice number" },
      { key: "date", header: "Issue Date", required: true, note: "YYYY-MM-DD" },
      { key: "reason", header: "Reason", required: false },
      { key: "amount", header: "Amount", required: false },
    ],
    validateRow: async (orgId, c, batch) => {
      const errs: string[] = [];
      if (!c.sourceInvoice?.trim()) errs.push("Source Invoice is required.");
      else {
        const [inv] = await db.select({ id: salesInvoicesTable.id }).from(salesInvoicesTable).where(and(eq(salesInvoicesTable.orgId, orgId), eq(salesInvoicesTable.invoiceNumber, c.sourceInvoice.trim())));
        if (!inv) errs.push(`Source invoice "${c.sourceInvoice}" not found.`);
      }
      if (!isDate(c.date || "")) errs.push("Issue Date must be YYYY-MM-DD.");
      if (!isAmount(c.amount || "")) errs.push("Amount must be a non-negative number.");
      const num = (c.number || "").trim();
      if (num) {
        if (batch.has(num.toLowerCase())) errs.push(`Duplicate document number "${num}" within the file.`);
        else if (!(await checkNumberFree(orgId, creditNotesTable.creditNoteNumber, creditNotesTable as unknown as typeof quotationsTable, num))) errs.push(`Credit note number "${num}" already exists.`);
      }
      return errs;
    },
    insertRow: async (tx, orgId, userId, c) => {
      const [inv] = await tx.select({ id: salesInvoicesTable.id, customerId: salesInvoicesTable.customerId }).from(salesInvoicesTable).where(and(eq(salesInvoicesTable.orgId, orgId), eq(salesInvoicesTable.invoiceNumber, c.sourceInvoice.trim())));
      const number = (c.number || "").trim() || (await nextDocumentNumber(tx, orgId, "credit_note"));
      const t = totalsFromAmount(c.amount || "0");
      const [cn] = await tx.insert(creditNotesTable).values({ orgId, creditNoteNumber: number, customerId: inv.customerId, sourceInvoiceId: inv.id, reason: c.reason?.trim() || null, issueDate: c.date, subtotal: t.subtotal, taxTotal: t.taxTotal, total: t.total, createdById: userId }).returning({ id: creditNotesTable.id });
      if (t.hasItem) await tx.insert(creditNoteItemsTable).values({ creditNoteId: cn.id, description: "Imported line", quantity: "1", unitPrice: t.subtotal, taxRatePercent: "0", lineTotal: t.subtotal });
    },
  },
  debit_note: {
    docType: "debit_note",
    partyLabel: "Vendor",
    statuses: ["draft", "issued", "reversed"],
    loadForExport: async (orgId, f) => {
      const cols: FilterCols = { orgCol: debitNotesTable.orgId, statusCol: debitNotesTable.status, dateCol: debitNotesTable.issueDate, partyNameCol: vendorsTable.name, archivedCol: debitNotesTable.archivedAt, deletedCol: debitNotesTable.deletedAt, searchCols: [debitNotesTable.debitNoteNumber, vendorsTable.name] };
      const rows = await db
        .select({ number: debitNotesTable.debitNoteNumber, party: vendorsTable.name, date: debitNotesTable.issueDate, amount: debitNotesTable.total, status: debitNotesTable.status })
        .from(debitNotesTable)
        .innerJoin(vendorsTable, eq(vendorsTable.id, debitNotesTable.vendorId))
        .where(filterConds(cols, orgId, f))
        .orderBy(desc(debitNotesTable.id));
      return {
        columns: [
          { key: "number", header: "DN Number" },
          { key: "party", header: "Vendor" },
          { key: "date", header: "Issue Date" },
          { key: "amount", header: "Amount" },
          { key: "status", header: "Status" },
        ],
        rows: rows.map((r) => ({ number: r.number, party: r.party, date: String(r.date), amount: money(r.amount), status: r.status })),
      };
    },
    importColumns: [
      { key: "number", header: "Number", required: false, note: "auto-generated if blank" },
      { key: "sourcePo", header: "Source PO", required: true, note: "existing purchase order number" },
      { key: "date", header: "Issue Date", required: true, note: "YYYY-MM-DD" },
      { key: "reason", header: "Reason", required: false },
      { key: "amount", header: "Amount", required: false },
    ],
    validateRow: async (orgId, c, batch) => {
      const errs: string[] = [];
      if (!c.sourcePo?.trim()) errs.push("Source PO is required.");
      else {
        const [po] = await db.select({ id: purchaseOrdersTable.id }).from(purchaseOrdersTable).where(and(eq(purchaseOrdersTable.orgId, orgId), eq(purchaseOrdersTable.poNumber, c.sourcePo.trim())));
        if (!po) errs.push(`Source purchase order "${c.sourcePo}" not found.`);
      }
      if (!isDate(c.date || "")) errs.push("Issue Date must be YYYY-MM-DD.");
      if (!isAmount(c.amount || "")) errs.push("Amount must be a non-negative number.");
      const num = (c.number || "").trim();
      if (num) {
        if (batch.has(num.toLowerCase())) errs.push(`Duplicate document number "${num}" within the file.`);
        else if (!(await checkNumberFree(orgId, debitNotesTable.debitNoteNumber, debitNotesTable as unknown as typeof quotationsTable, num))) errs.push(`Debit note number "${num}" already exists.`);
      }
      return errs;
    },
    insertRow: async (tx, orgId, userId, c) => {
      const [po] = await tx.select({ id: purchaseOrdersTable.id, vendorId: purchaseOrdersTable.vendorId }).from(purchaseOrdersTable).where(and(eq(purchaseOrdersTable.orgId, orgId), eq(purchaseOrdersTable.poNumber, c.sourcePo.trim())));
      const number = (c.number || "").trim() || (await nextDocumentNumber(tx, orgId, "debit_note"));
      const t = totalsFromAmount(c.amount || "0");
      const [dn] = await tx.insert(debitNotesTable).values({ orgId, debitNoteNumber: number, vendorId: po.vendorId, sourcePurchaseOrderId: po.id, reason: c.reason?.trim() || null, issueDate: c.date, subtotal: t.subtotal, taxTotal: t.taxTotal, total: t.total, createdById: userId }).returning({ id: debitNotesTable.id });
      if (t.hasItem) await tx.insert(debitNoteItemsTable).values({ debitNoteId: dn.id, description: "Imported line", quantity: "1", unitCost: t.subtotal, taxRatePercent: "0", lineTotal: t.subtotal });
    },
  },
  purchase_order: {
    docType: "purchase_order",
    partyLabel: "Vendor",
    statuses: ["draft", "ordered", "received", "cancelled"],
    loadForExport: async (orgId, f) => {
      const cols: FilterCols = { orgCol: purchaseOrdersTable.orgId, statusCol: purchaseOrdersTable.status, dateCol: purchaseOrdersTable.orderDate, partyNameCol: vendorsTable.name, archivedCol: purchaseOrdersTable.archivedAt, deletedCol: purchaseOrdersTable.deletedAt, searchCols: [purchaseOrdersTable.poNumber, vendorsTable.name] };
      const rows = await db
        .select({ number: purchaseOrdersTable.poNumber, party: vendorsTable.name, date: purchaseOrdersTable.orderDate, amount: purchaseOrdersTable.total, status: purchaseOrdersTable.status })
        .from(purchaseOrdersTable)
        .innerJoin(vendorsTable, eq(vendorsTable.id, purchaseOrdersTable.vendorId))
        .where(filterConds(cols, orgId, f))
        .orderBy(desc(purchaseOrdersTable.id));
      return {
        columns: [
          { key: "number", header: "PO #" },
          { key: "party", header: "Vendor" },
          { key: "date", header: "Order Date" },
          { key: "amount", header: "Amount" },
          { key: "status", header: "Status" },
        ],
        rows: rows.map((r) => ({ number: r.number, party: r.party, date: String(r.date), amount: money(r.amount), status: r.status })),
      };
    },
    importColumns: [
      { key: "number", header: "Number", required: false, note: "auto-generated if blank" },
      { key: "vendor", header: "Vendor", required: true },
      { key: "date", header: "Order Date", required: true, note: "YYYY-MM-DD" },
      { key: "title", header: "Title", required: false },
      { key: "amount", header: "Amount", required: false },
    ],
    validateRow: async (orgId, c, batch) => {
      const errs: string[] = [];
      if (!c.vendor?.trim()) errs.push("Vendor is required.");
      else if (!(await findVendorId(orgId, c.vendor))) errs.push(`Vendor "${c.vendor}" not found.`);
      if (!isDate(c.date || "")) errs.push("Order Date must be YYYY-MM-DD.");
      if (!isAmount(c.amount || "")) errs.push("Amount must be a non-negative number.");
      const num = (c.number || "").trim();
      if (num) {
        if (batch.has(num.toLowerCase())) errs.push(`Duplicate document number "${num}" within the file.`);
        else if (!(await checkNumberFree(orgId, purchaseOrdersTable.poNumber, purchaseOrdersTable as unknown as typeof quotationsTable, num))) errs.push(`Purchase order number "${num}" already exists.`);
      }
      return errs;
    },
    insertRow: async (tx, orgId, userId, c) => {
      const number = (c.number || "").trim() || (await nextDocumentNumber(tx, orgId, "purchase_order"));
      const t = totalsFromAmount(c.amount || "0");
      const [po] = await tx.insert(purchaseOrdersTable).values({ orgId, poNumber: number, vendorId: (await findVendorId(orgId, c.vendor))!, orderDate: c.date, title: c.title?.trim() || null, subtotal: t.subtotal, discount: "0", taxTotal: t.taxTotal, total: t.total, createdById: userId }).returning({ id: purchaseOrdersTable.id });
      if (t.hasItem) await tx.insert(purchaseOrderItemsTable).values({ purchaseOrderId: po.id, description: "Imported line", quantity: "1", unitCost: t.subtotal, taxRatePercent: "0", lineTotal: t.subtotal });
    },
  },
};

export function workspaceEntry(docType: DocumentType): WorkspaceEntry {
  return WORKSPACE[docType];
}
