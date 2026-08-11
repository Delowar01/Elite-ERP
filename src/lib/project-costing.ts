import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  projectsTable,
  quotationsTable,
  salesOrdersTable,
  salesInvoicesTable,
  creditNotesTable,
  purchaseOrdersTable,
  debitNotesTable,
  paymentsTable,
  journalEntriesTable,
  journalLinesTable,
  accountsTable,
  customersTable,
  vendorsTable,
  tasksTable,
  timeLogsTable,
} from "@/db";
import { baseTotalExpr } from "@/lib/base-amounts-sql";
import { latestStructures } from "@/app/(app)/hr/payroll/queries";

/**
 * Project Cost Control — financial performance for one project, built only from records that are
 * already linked to it and already financially effective.
 *
 * Principles this module holds to, because getting them wrong produces a plausible-looking but
 * wrong profit figure:
 *
 *  - COMMITTED vs ACTUAL are never mixed. Quoted/Confirmed value is committed revenue; Invoiced is
 *    recognized revenue; Received is cash. On the cost side, purchase orders are committed cost and
 *    payments to suppliers are actual cash out — they are reported as separate figures, never added.
 *  - Nothing is estimated. Every figure traces to a saved document or a posted ledger line. The one
 *    derived number (labour from time logs × salary structure) is returned separately, flagged as an
 *    estimate, and deliberately excluded from Total Project Cost.
 *  - Not-yet-effective and undone records are excluded: drafts, cancelled, void, archived and
 *    soft-deleted rows never count, and issued credit/debit notes are netted off the document they
 *    reverse so a reversed amount does not remain counted.
 *  - FX-9: totals cross currencies at STORED base amounts — never a fresh conversion. Posted
 *    foreign documents (invoices, credit/debit notes, received POs) carry posting-time base
 *    columns and are summed at those figures; payments at their stored base cash figure. A
 *    document with NO stored conversion — every foreign quotation and sales order (non-posting,
 *    so nothing is ever captured for them by design) and any pre-FX rows — is excluded and
 *    reported as a count, so the omission is visible rather than silent.
 *  - Every query is scoped by orgId, and the project itself is re-checked against that orgId, so a
 *    project id from a URL can never read another organization's numbers.
 */

/** Statuses at which a document is financially effective for costing, per the lifecycle rules. */
const QUOTATION_COMMITTED = ["sent", "accepted"]; // draft = not issued; rejected/expired = dead
const SALES_ORDER_COMMITTED = ["confirmed", "fulfilled"]; // draft/cancelled excluded
const INVOICE_POSTED = ["sent", "partially_paid", "paid"]; // draft = unposted, void = reversed
const PO_COMMITTED = ["ordered", "received"]; // draft = unissued, cancelled = dead

export type CostDrillRow = {
  /** Stable row key. Uses the document's own number, never a database id. */
  key: string;
  type: string;
  number: string;
  date: string;
  party: string | null;
  status: string;
  amount: number;
  /** Where the row drills through to. */
  href: string;
  /** Reversal rows (credit/debit notes) carry a negative amount and are shown as deductions. */
  negative?: boolean;
};

export type ProjectCostControl = {
  project: { id: number; name: string; status: string; budget: string | null };
  revenue: {
    quoted: number;
    confirmed: number;
    invoiced: number;
    received: number;
    outstandingReceivable: number;
  };
  cost: {
    purchase: number;
    paidToSuppliers: number;
    outstandingSupplier: number;
    other: number;
    total: number;
  };
  profit: number;
  /** Null when there is no recognized revenue yet — a margin over zero revenue is meaningless. */
  marginPercent: number | null;
  health: "profitable" | "loss" | "no_revenue";
  rows: { revenue: CostDrillRow[]; costs: CostDrillRow[] };
  /** Time-log labour, reported for information only. NOT part of `cost.total` — it is an estimate. */
  labourEstimate: { hours: number; cost: number };
  /**
   * Rows linked to this project with NO stored base-currency conversion, hence excluded from the
   * totals: every foreign quotation/sales order (non-posting — nothing is ever captured for them
   * by design) plus any pre-FX posted document or payment. Counted, never silently dropped.
   */
  excludedUnconverted: number;
};

const n = (v: string | number | null | undefined) => Number(v ?? 0) || 0;

/** Active records only: no soft-deleted, no archived. */
function activeOnly(table: { archivedAt: unknown; deletedAt: unknown }) {
  return and(
    isNull(table.archivedAt as Parameters<typeof isNull>[0]),
    isNull(table.deletedAt as Parameters<typeof isNull>[0]),
  )!;
}

/**
 * Everything Project Cost Control shows for one project. Returns null when the project does not
 * exist in this organization — callers turn that into a 404 rather than an empty report.
 */
export async function getProjectCostControl(
  orgId: number,
  projectId: number,
  baseCurrency: string,
): Promise<ProjectCostControl | null> {
  const [project] = await db
    .select({ id: projectsTable.id, name: projectsTable.name, status: projectsTable.status, budget: projectsTable.budget })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.orgId, orgId)));
  if (!project) return null;

  const base = baseCurrency;

  const [
    quotations,
    orders,
    invoices,
    creditNotes,
    paymentsIn,
    purchaseOrders,
    debitNotes,
    paymentsOut,
    otherCostRows,
    labourRows,
    structures,
  ] = await Promise.all([
    db
      .select({
        id: quotationsTable.id,
        number: quotationsTable.quotationNumber,
        date: quotationsTable.issueDate,
        status: quotationsTable.status,
        total: baseTotalExpr(quotationsTable, base),
        party: customersTable.name,
      })
      .from(quotationsTable)
      .leftJoin(customersTable, eq(quotationsTable.customerId, customersTable.id))
      .where(
        and(
          eq(quotationsTable.orgId, orgId),
          eq(quotationsTable.projectId, projectId),
          inArray(quotationsTable.status, QUOTATION_COMMITTED),
          activeOnly(quotationsTable),
        ),
      ),
    db
      .select({
        id: salesOrdersTable.id,
        number: salesOrdersTable.soNumber,
        date: salesOrdersTable.issueDate,
        status: salesOrdersTable.status,
        total: baseTotalExpr(salesOrdersTable, base),
        party: customersTable.name,
      })
      .from(salesOrdersTable)
      .leftJoin(customersTable, eq(salesOrdersTable.customerId, customersTable.id))
      .where(
        and(
          eq(salesOrdersTable.orgId, orgId),
          eq(salesOrdersTable.projectId, projectId),
          inArray(salesOrdersTable.status, SALES_ORDER_COMMITTED),
          activeOnly(salesOrdersTable),
        ),
      ),
    db
      .select({
        id: salesInvoicesTable.id,
        number: salesInvoicesTable.invoiceNumber,
        date: salesInvoicesTable.issueDate,
        status: salesInvoicesTable.status,
        total: baseTotalExpr(salesInvoicesTable, base),
        party: customersTable.name,
      })
      .from(salesInvoicesTable)
      .leftJoin(customersTable, eq(salesInvoicesTable.customerId, customersTable.id))
      .where(
        and(
          eq(salesInvoicesTable.orgId, orgId),
          eq(salesInvoicesTable.projectId, projectId),
          inArray(salesInvoicesTable.status, INVOICE_POSTED),
          activeOnly(salesInvoicesTable),
        ),
      ),
    // Issued credit notes against this project's invoices — recognized revenue that has been undone.
    db
      .select({
        id: creditNotesTable.id,
        number: creditNotesTable.creditNoteNumber,
        date: creditNotesTable.issueDate,
        status: creditNotesTable.status,
        total: baseTotalExpr(creditNotesTable, base),
        party: customersTable.name,
      })
      .from(creditNotesTable)
      .innerJoin(salesInvoicesTable, eq(creditNotesTable.sourceInvoiceId, salesInvoicesTable.id))
      .leftJoin(customersTable, eq(creditNotesTable.customerId, customersTable.id))
      .where(
        and(
          eq(creditNotesTable.orgId, orgId),
          eq(salesInvoicesTable.projectId, projectId),
          eq(creditNotesTable.status, "issued"),
          activeOnly(creditNotesTable),
        ),
      ),
    // Cash actually received against this project's invoices.
    db
      .select({
        id: paymentsTable.id,
        reference: paymentsTable.reference,
        date: paymentsTable.paymentDate,
        // The payment's stored base cash figure — identity for base-currency payments, the FX-7
        // baseAmount for foreign ones, NULL (excluded + counted) for a pre-FX-7 foreign payment.
        amount: sql<string | null>`case when ${paymentsTable.currency} is null then ${paymentsTable.amount} else ${paymentsTable.baseAmount} end`,
        invoiceNumber: salesInvoicesTable.invoiceNumber,
        party: customersTable.name,
      })
      .from(paymentsTable)
      .innerJoin(salesInvoicesTable, eq(paymentsTable.salesInvoiceId, salesInvoicesTable.id))
      .leftJoin(customersTable, eq(salesInvoicesTable.customerId, customersTable.id))
      .where(
        and(
          eq(paymentsTable.orgId, orgId),
          eq(paymentsTable.direction, "in"),
          eq(salesInvoicesTable.projectId, projectId),
          activeOnly(salesInvoicesTable),
        ),
      ),
    db
      .select({
        id: purchaseOrdersTable.id,
        number: purchaseOrdersTable.poNumber,
        date: purchaseOrdersTable.orderDate,
        status: purchaseOrdersTable.status,
        total: baseTotalExpr(purchaseOrdersTable, base),
        party: vendorsTable.name,
      })
      .from(purchaseOrdersTable)
      .leftJoin(vendorsTable, eq(purchaseOrdersTable.vendorId, vendorsTable.id))
      .where(
        and(
          eq(purchaseOrdersTable.orgId, orgId),
          eq(purchaseOrdersTable.projectId, projectId),
          inArray(purchaseOrdersTable.status, PO_COMMITTED),
          activeOnly(purchaseOrdersTable),
        ),
      ),
    // Issued debit notes against this project's POs — committed cost that has been returned.
    db
      .select({
        id: debitNotesTable.id,
        number: debitNotesTable.debitNoteNumber,
        date: debitNotesTable.issueDate,
        status: debitNotesTable.status,
        total: baseTotalExpr(debitNotesTable, base),
        party: vendorsTable.name,
      })
      .from(debitNotesTable)
      .innerJoin(purchaseOrdersTable, eq(debitNotesTable.sourcePurchaseOrderId, purchaseOrdersTable.id))
      .leftJoin(vendorsTable, eq(debitNotesTable.vendorId, vendorsTable.id))
      .where(
        and(
          eq(debitNotesTable.orgId, orgId),
          eq(purchaseOrdersTable.projectId, projectId),
          eq(debitNotesTable.status, "issued"),
          activeOnly(debitNotesTable),
        ),
      ),
    db
      .select({
        id: paymentsTable.id,
        reference: paymentsTable.reference,
        date: paymentsTable.paymentDate,
        amount: sql<string | null>`case when ${paymentsTable.currency} is null then ${paymentsTable.amount} else ${paymentsTable.baseAmount} end`,
        poNumber: purchaseOrdersTable.poNumber,
        party: vendorsTable.name,
      })
      .from(paymentsTable)
      .innerJoin(purchaseOrdersTable, eq(paymentsTable.purchaseOrderId, purchaseOrdersTable.id))
      .leftJoin(vendorsTable, eq(purchaseOrdersTable.vendorId, vendorsTable.id))
      .where(
        and(
          eq(paymentsTable.orgId, orgId),
          eq(paymentsTable.direction, "out"),
          eq(purchaseOrdersTable.projectId, projectId),
          activeOnly(purchaseOrdersTable),
        ),
      ),
    // Other direct project cost: MANUAL journal entries tagged to this project, netted over expense
    // accounts. Document-sourced entries are excluded on purpose — their cost is already counted via
    // the document itself, and counting both would double it. A reversing entry credits the same
    // account, so a reversed cost nets to zero here rather than lingering.
    db
      .select({
        id: journalEntriesTable.id,
        memo: journalEntriesTable.memo,
        date: journalEntriesTable.entryDate,
        amount: sql<string>`sum(${journalLinesTable.debit} - ${journalLinesTable.credit})`,
      })
      .from(journalEntriesTable)
      .innerJoin(journalLinesTable, eq(journalLinesTable.journalEntryId, journalEntriesTable.id))
      .innerJoin(accountsTable, eq(journalLinesTable.accountId, accountsTable.id))
      .where(
        and(
          eq(journalEntriesTable.orgId, orgId),
          eq(journalEntriesTable.projectId, projectId),
          eq(journalEntriesTable.sourceType, "manual"),
          eq(accountsTable.type, "expense"),
        ),
      )
      .groupBy(journalEntriesTable.id),
    db
      .select({ employeeId: timeLogsTable.employeeId, hours: sql<string>`coalesce(sum(${timeLogsTable.hours}), 0)` })
      .from(timeLogsTable)
      .innerJoin(tasksTable, eq(timeLogsTable.taskId, tasksTable.id))
      .where(and(eq(tasksTable.projectId, projectId), eq(timeLogsTable.orgId, orgId)))
      .groupBy(timeLogsTable.employeeId),
    latestStructures(orgId),
  ]);

  // FX-9: a NULL base figure means "no stored conversion" — the row is dropped from every total
  // and drill list, and COUNTED, so the report says what it left out instead of totalling short.
  let excludedUnconverted = 0;
  const converted = <T extends { total?: string | null; amount?: string | null }>(rows: T[], key: "total" | "amount"): T[] => {
    const usable = rows.filter((r) => r[key] !== null);
    excludedUnconverted += rows.length - usable.length;
    return usable;
  };
  const cQuotations = converted(quotations, "total");
  const cOrders = converted(orders, "total");
  const cInvoices = converted(invoices, "total");
  const cCreditNotes = converted(creditNotes, "total");
  const cPurchaseOrders = converted(purchaseOrders, "total");
  const cDebitNotes = converted(debitNotes, "total");
  const cPaymentsIn = converted(paymentsIn, "amount");
  const cPaymentsOut = converted(paymentsOut, "amount");

  const sum = <T>(rows: T[], pick: (r: T) => number) => rows.reduce((acc, r) => acc + pick(r), 0);

  const quoted = sum(cQuotations, (q) => n(q.total));
  const confirmed = sum(cOrders, (o) => n(o.total));
  const invoicedGross = sum(cInvoices, (i) => n(i.total));
  const creditedBack = sum(cCreditNotes, (c) => n(c.total));
  const invoiced = invoicedGross - creditedBack;
  const received = sum(cPaymentsIn, (p) => n(p.amount));

  const purchaseGross = sum(cPurchaseOrders, (p) => n(p.total));
  const debitedBack = sum(cDebitNotes, (d) => n(d.total));
  const purchase = purchaseGross - debitedBack;
  const paidToSuppliers = sum(cPaymentsOut, (p) => n(p.amount));
  const other = sum(otherCostRows, (r) => n(r.amount));

  const totalCost = purchase + other;
  const profit = invoiced - totalCost;

  let labourHours = 0;
  let labourCost = 0;
  for (const row of labourRows) {
    const hours = n(row.hours);
    labourHours += hours;
    const s = structures.get(row.employeeId);
    // Same documented "simple rate" the project page has always used: monthly gross ÷ 240 hours.
    if (s) labourCost += hours * ((n(s.basicSalary) + n(s.allowances)) / 240);
  }

  const revenueRows: CostDrillRow[] = [
    ...cQuotations.map((q) => row("Quotation", q.number, q.date, q.party, q.status, n(q.total), `/sales/quotations/${q.id}`)),
    ...cOrders.map((o) => row("Sales Order", o.number, o.date, o.party, o.status, n(o.total), `/sales/orders/${o.id}`)),
    ...cInvoices.map((i) => row("Invoice", i.number, i.date, i.party, i.status, n(i.total), `/sales/invoices/${i.id}`)),
    ...cCreditNotes.map((c) => ({
      ...row("Credit Note", c.number, c.date, c.party, c.status, -n(c.total), `/sales/credit-notes/${c.id}`),
      negative: true,
    })),
    ...cPaymentsIn.map((p) =>
      row("Payment Received", p.reference || p.invoiceNumber, p.date, p.party, "received", n(p.amount), "/finance/payments"),
    ),
  ];

  const costRows: CostDrillRow[] = [
    ...cPurchaseOrders.map((p) => row("Purchase Order", p.number, p.date, p.party, p.status, n(p.total), `/purchasing/orders/${p.id}`)),
    ...cDebitNotes.map((d) => ({
      ...row("Debit Note", d.number, d.date, d.party, d.status, -n(d.total), `/purchasing/debit-notes/${d.id}`),
      negative: true,
    })),
    ...cPaymentsOut.map((p) => row("Payment Made", p.reference || p.poNumber, p.date, p.party, "paid", n(p.amount), "/finance/payments")),
    ...otherCostRows
      .filter((r) => n(r.amount) !== 0)
      .map((r) => row("Journal Entry", r.memo, r.date, null, "posted", n(r.amount), `/finance/journal#je-${r.id}`)),
  ];

  const byDateDesc = (a: CostDrillRow, b: CostDrillRow) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  revenueRows.sort(byDateDesc);
  costRows.sort(byDateDesc);

  return {
    project,
    revenue: {
      quoted,
      confirmed,
      invoiced,
      received,
      outstandingReceivable: invoiced - received,
    },
    cost: {
      purchase,
      paidToSuppliers,
      outstandingSupplier: purchase - paidToSuppliers,
      other,
      total: totalCost,
    },
    profit,
    marginPercent: invoiced > 0 ? (profit / invoiced) * 100 : null,
    health: invoiced <= 0 ? "no_revenue" : profit >= 0 ? "profitable" : "loss",
    rows: { revenue: revenueRows, costs: costRows },
    labourEstimate: { hours: labourHours, cost: labourCost },
    excludedUnconverted,
  };
}

function row(
  type: string,
  number: string | null,
  date: string,
  party: string | null,
  status: string,
  amount: number,
  href: string,
): CostDrillRow {
  const label = number ?? "—";
  return { key: `${type}:${label}:${date}:${amount}`, type, number: label, date, party, status, amount, href };
}
