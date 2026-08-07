import "server-only";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
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
 *  - Currencies are never added together. Only documents in the organization's base currency are
 *    summed; anything in another currency is excluded and reported as a count so the omission is
 *    visible rather than silent.
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
  /** Documents linked to this project but written in another currency, hence excluded from totals. */
  excludedForeignCurrency: number;
};

const n = (v: string | number | null | undefined) => Number(v ?? 0) || 0;

/** Only base-currency documents are summable. NULL means "org base currency". */
function baseCurrencyOnly(col: { currency: unknown }, base: string) {
  const c = col.currency as Parameters<typeof isNull>[0];
  return or(isNull(c), eq(c, base))!;
}

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
    foreignRows,
    labourRows,
    structures,
  ] = await Promise.all([
    db
      .select({
        id: quotationsTable.id,
        number: quotationsTable.quotationNumber,
        date: quotationsTable.issueDate,
        status: quotationsTable.status,
        total: quotationsTable.total,
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
          baseCurrencyOnly(quotationsTable, base),
        ),
      ),
    db
      .select({
        id: salesOrdersTable.id,
        number: salesOrdersTable.soNumber,
        date: salesOrdersTable.issueDate,
        status: salesOrdersTable.status,
        total: salesOrdersTable.total,
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
          baseCurrencyOnly(salesOrdersTable, base),
        ),
      ),
    db
      .select({
        id: salesInvoicesTable.id,
        number: salesInvoicesTable.invoiceNumber,
        date: salesInvoicesTable.issueDate,
        status: salesInvoicesTable.status,
        total: salesInvoicesTable.total,
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
          baseCurrencyOnly(salesInvoicesTable, base),
        ),
      ),
    // Issued credit notes against this project's invoices — recognized revenue that has been undone.
    db
      .select({
        id: creditNotesTable.id,
        number: creditNotesTable.creditNoteNumber,
        date: creditNotesTable.issueDate,
        status: creditNotesTable.status,
        total: creditNotesTable.total,
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
          baseCurrencyOnly(creditNotesTable, base),
        ),
      ),
    // Cash actually received against this project's invoices.
    db
      .select({
        id: paymentsTable.id,
        reference: paymentsTable.reference,
        date: paymentsTable.paymentDate,
        amount: paymentsTable.amount,
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
          baseCurrencyOnly(salesInvoicesTable, base),
        ),
      ),
    db
      .select({
        id: purchaseOrdersTable.id,
        number: purchaseOrdersTable.poNumber,
        date: purchaseOrdersTable.orderDate,
        status: purchaseOrdersTable.status,
        total: purchaseOrdersTable.total,
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
          baseCurrencyOnly(purchaseOrdersTable, base),
        ),
      ),
    // Issued debit notes against this project's POs — committed cost that has been returned.
    db
      .select({
        id: debitNotesTable.id,
        number: debitNotesTable.debitNoteNumber,
        date: debitNotesTable.issueDate,
        status: debitNotesTable.status,
        total: debitNotesTable.total,
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
          baseCurrencyOnly(debitNotesTable, base),
        ),
      ),
    db
      .select({
        id: paymentsTable.id,
        reference: paymentsTable.reference,
        date: paymentsTable.paymentDate,
        amount: paymentsTable.amount,
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
          baseCurrencyOnly(purchaseOrdersTable, base),
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
    // Project-linked documents written in another currency. Counted, never summed.
    countForeignCurrencyDocs(orgId, projectId, base),
    db
      .select({ employeeId: timeLogsTable.employeeId, hours: sql<string>`coalesce(sum(${timeLogsTable.hours}), 0)` })
      .from(timeLogsTable)
      .innerJoin(tasksTable, eq(timeLogsTable.taskId, tasksTable.id))
      .where(and(eq(tasksTable.projectId, projectId), eq(timeLogsTable.orgId, orgId)))
      .groupBy(timeLogsTable.employeeId),
    latestStructures(orgId),
  ]);

  const sum = <T>(rows: T[], pick: (r: T) => number) => rows.reduce((acc, r) => acc + pick(r), 0);

  const quoted = sum(quotations, (q) => n(q.total));
  const confirmed = sum(orders, (o) => n(o.total));
  const invoicedGross = sum(invoices, (i) => n(i.total));
  const creditedBack = sum(creditNotes, (c) => n(c.total));
  const invoiced = invoicedGross - creditedBack;
  const received = sum(paymentsIn, (p) => n(p.amount));

  const purchaseGross = sum(purchaseOrders, (p) => n(p.total));
  const debitedBack = sum(debitNotes, (d) => n(d.total));
  const purchase = purchaseGross - debitedBack;
  const paidToSuppliers = sum(paymentsOut, (p) => n(p.amount));
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
    ...quotations.map((q) => row("Quotation", q.number, q.date, q.party, q.status, n(q.total), `/sales/quotations/${q.id}`)),
    ...orders.map((o) => row("Sales Order", o.number, o.date, o.party, o.status, n(o.total), `/sales/orders/${o.id}`)),
    ...invoices.map((i) => row("Invoice", i.number, i.date, i.party, i.status, n(i.total), `/sales/invoices/${i.id}`)),
    ...creditNotes.map((c) => ({
      ...row("Credit Note", c.number, c.date, c.party, c.status, -n(c.total), `/sales/credit-notes/${c.id}`),
      negative: true,
    })),
    ...paymentsIn.map((p) =>
      row("Payment Received", p.reference || p.invoiceNumber, p.date, p.party, "received", n(p.amount), "/finance/payments"),
    ),
  ];

  const costRows: CostDrillRow[] = [
    ...purchaseOrders.map((p) => row("Purchase Order", p.number, p.date, p.party, p.status, n(p.total), `/purchasing/orders/${p.id}`)),
    ...debitNotes.map((d) => ({
      ...row("Debit Note", d.number, d.date, d.party, d.status, -n(d.total), `/purchasing/debit-notes/${d.id}`),
      negative: true,
    })),
    ...paymentsOut.map((p) => row("Payment Made", p.reference || p.poNumber, p.date, p.party, "paid", n(p.amount), "/finance/payments")),
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
    excludedForeignCurrency: foreignRows,
  };
}

/**
 * How many documents are linked to this project but written in a currency other than the org's
 * base. They are excluded from every total — adding them would silently mix currencies — so the UI
 * shows this count instead of pretending the totals are complete.
 */
async function countForeignCurrencyDocs(orgId: number, projectId: number, base: string): Promise<number> {
  const tables = [quotationsTable, salesOrdersTable, salesInvoicesTable, purchaseOrdersTable] as const;
  const counts = await Promise.all(
    tables.map((table) =>
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(table)
        .where(
          and(
            eq(table.orgId, orgId),
            eq(table.projectId, projectId),
            activeOnly(table),
            sql`${table.currency} is not null and ${table.currency} <> ${base}`,
          ),
        ),
    ),
  );
  return counts.reduce((acc, rows) => acc + (rows[0]?.count ?? 0), 0);
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
