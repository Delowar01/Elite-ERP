import "server-only";
import { and, eq, gte, lte, ne, inArray, sql, desc } from "drizzle-orm";
import { db, salesInvoicesTable, quotationsTable, bankAccountsTable, journalLinesTable, journalEntriesTable, customersTable, purchaseOrdersTable, projectsTable, employeesTable, attendanceRecordsTable } from "@/db";
import { rangeBuckets, type ResolvedRange } from "@/lib/dashboard-range";

async function invoiceTotalBetween(orgId: number, start: string, end: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${salesInvoicesTable.total}), 0)` })
    .from(salesInvoicesTable)
    .where(
      and(
        eq(salesInvoicesTable.orgId, orgId),
        ne(salesInvoicesTable.status, "draft"),
        ne(salesInvoicesTable.status, "void"),
        gte(salesInvoicesTable.issueDate, start),
        lte(salesInvoicesTable.issueDate, end),
      ),
    );
  return Number(row?.total ?? 0);
}

function trend(current: number, previous: number): { pct: string; up: boolean } {
  if (previous === 0) return { pct: current > 0 ? "100%" : "0%", up: current >= previous };
  const pct = ((current - previous) / previous) * 100;
  return { pct: `${Math.abs(pct).toFixed(1)}%`, up: pct >= 0 };
}

// KPIs for the selected date range, with a period-over-period trend vs. the preceding window.
// Receivables/Payables are point-in-time balances (all outstanding), not range-scoped.
export async function getKpis(orgId: number, range: ResolvedRange) {
  const [salesThis, salesPrev] = await Promise.all([
    invoiceTotalBetween(orgId, range.start, range.end),
    invoiceTotalBetween(orgId, range.prevStart, range.prevEnd),
  ]);

  const countBetween = async (start: string, end: string) => {
    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(salesInvoicesTable)
      .where(and(eq(salesInvoicesTable.orgId, orgId), ne(salesInvoicesTable.status, "draft"), gte(salesInvoicesTable.issueDate, start), lte(salesInvoicesTable.issueDate, end)));
    return n;
  };
  const [invoicesThis, invoicesPrev] = await Promise.all([countBetween(range.start, range.end), countBetween(range.prevStart, range.prevEnd)]);

  const [{ receivables } = { receivables: "0" }] = await db
    .select({ receivables: sql<string>`coalesce(sum(${salesInvoicesTable.total} - ${salesInvoicesTable.paidAmount}), 0)` })
    .from(salesInvoicesTable)
    .where(and(eq(salesInvoicesTable.orgId, orgId), inArray(salesInvoicesTable.status, ["sent", "partially_paid"])));

  const [{ payables } = { payables: "0" }] = await db
    .select({ payables: sql<string>`coalesce(sum(${purchaseOrdersTable.total} - ${purchaseOrdersTable.paidAmount}), 0)` })
    .from(purchaseOrdersTable)
    .where(and(eq(purchaseOrdersTable.orgId, orgId), eq(purchaseOrdersTable.status, "received")));

  return {
    totalSalesThisMonth: salesThis,
    totalSalesTrend: trend(salesThis, salesPrev),
    totalInvoices: invoicesThis,
    totalInvoicesTrend: trend(invoicesThis, invoicesPrev),
    totalReceivables: Number(receivables),
    totalPayables: Number(payables),
  };
}

// Revenue series for the range's chart buckets (day or month). One query, bucketed in JS.
export async function getRevenueSeries(orgId: number, range: ResolvedRange): Promise<{ label: string; total: number }[]> {
  const buckets = rangeBuckets(range);
  const rows = await db
    .select({ date: salesInvoicesTable.issueDate, total: salesInvoicesTable.total })
    .from(salesInvoicesTable)
    .where(
      and(
        eq(salesInvoicesTable.orgId, orgId),
        ne(salesInvoicesTable.status, "draft"),
        ne(salesInvoicesTable.status, "void"),
        gte(salesInvoicesTable.issueDate, range.start),
        lte(salesInvoicesTable.issueDate, range.end),
      ),
    );
  return buckets.map((b) => {
    let sum = 0;
    for (const r of rows) if (r.date >= b.start && r.date <= b.end) sum += Number(r.total);
    return { label: b.label, total: sum };
  });
}

export async function getInvoicesOverview(orgId: number, range: ResolvedRange) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({ status: salesInvoicesTable.status, dueDate: salesInvoicesTable.dueDate, n: sql<number>`count(*)::int` })
    .from(salesInvoicesTable)
    .where(
      and(
        eq(salesInvoicesTable.orgId, orgId),
        ne(salesInvoicesTable.status, "draft"),
        ne(salesInvoicesTable.status, "void"),
        gte(salesInvoicesTable.issueDate, range.start),
        lte(salesInvoicesTable.issueDate, range.end),
      ),
    )
    .groupBy(salesInvoicesTable.status, salesInvoicesTable.dueDate);

  let paid = 0;
  let partial = 0;
  let pending = 0;
  let overdue = 0;
  for (const r of rows) {
    if (r.status === "paid") paid += r.n;
    else if (r.status === "partially_paid") partial += r.n;
    else if (r.status === "sent") {
      if (r.dueDate && r.dueDate < today) overdue += r.n;
      else pending += r.n;
    }
  }
  const total = paid + partial + pending + overdue;
  return { paid, partial, pending, overdue, total };
}

export async function getProjectsOverview(orgId: number) {
  const rows = await db
    .select({ status: projectsTable.status, n: sql<number>`count(*)::int` })
    .from(projectsTable)
    .where(eq(projectsTable.orgId, orgId))
    .groupBy(projectsTable.status);

  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = r.n;
  return {
    active: byStatus.active ?? 0,
    completed: byStatus.completed ?? 0,
    onHold: byStatus.on_hold ?? 0,
    planned: byStatus.planned ?? 0,
  };
}

export async function getHrSnapshot(orgId: number) {
  const today = new Date().toISOString().slice(0, 10);
  const [employees, attendance] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(employeesTable)
      .where(and(eq(employeesTable.orgId, orgId), eq(employeesTable.status, "active"))),
    db
      .select({ status: attendanceRecordsTable.status, n: sql<number>`count(*)::int` })
      .from(attendanceRecordsTable)
      .where(and(eq(attendanceRecordsTable.orgId, orgId), eq(attendanceRecordsTable.date, today)))
      .groupBy(attendanceRecordsTable.status),
  ]);

  const byStatus: Record<string, number> = {};
  for (const r of attendance) byStatus[r.status] = r.n;
  const total = employees[0]?.n ?? 0;
  const present = (byStatus.present ?? 0) + (byStatus.late ?? 0);
  const onLeave = byStatus.on_leave ?? 0;
  return { total, present, onLeave, absent: Math.max(0, total - present - onLeave) };
}

export async function getCashFlow(orgId: number, range: ResolvedRange) {
  const bankGlAccountIds = await db.select({ id: bankAccountsTable.glAccountId }).from(bankAccountsTable).where(eq(bankAccountsTable.orgId, orgId));
  const ids = bankGlAccountIds.map((r) => r.id);
  if (ids.length === 0) return { inflow: 0, outflow: 0, net: 0 };

  const [row] = await db
    .select({
      debit: sql<string>`coalesce(sum(${journalLinesTable.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLinesTable.credit}), 0)`,
    })
    .from(journalLinesTable)
    .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalLinesTable.journalEntryId))
    .where(
      and(
        eq(journalEntriesTable.orgId, orgId),
        inArray(journalLinesTable.accountId, ids),
        gte(journalEntriesTable.entryDate, range.start),
        lte(journalEntriesTable.entryDate, range.end),
      ),
    );
  const inflow = Number(row?.debit ?? 0);
  const outflow = Number(row?.credit ?? 0);
  return { inflow, outflow, net: inflow - outflow };
}

export type RecentActivity = { kind: "quotation" | "invoice"; label: string; time: Date };

// Recent quotations + invoices created within the selected range.
export async function getRecentActivity(orgId: number, range: ResolvedRange, limit = 4): Promise<RecentActivity[]> {
  const startTs = new Date(range.start + "T00:00:00");
  const endTs = new Date(range.end + "T23:59:59");
  const [quotes, invoices] = await Promise.all([
    db
      .select({ number: quotationsTable.quotationNumber, customerName: customersTable.name, createdAt: quotationsTable.createdAt })
      .from(quotationsTable)
      .innerJoin(customersTable, eq(customersTable.id, quotationsTable.customerId))
      .where(and(eq(quotationsTable.orgId, orgId), gte(quotationsTable.createdAt, startTs), lte(quotationsTable.createdAt, endTs)))
      .orderBy(desc(quotationsTable.createdAt))
      .limit(limit),
    db
      .select({ number: salesInvoicesTable.invoiceNumber, customerName: customersTable.name, createdAt: salesInvoicesTable.createdAt })
      .from(salesInvoicesTable)
      .innerJoin(customersTable, eq(customersTable.id, salesInvoicesTable.customerId))
      .where(and(eq(salesInvoicesTable.orgId, orgId), gte(salesInvoicesTable.createdAt, startTs), lte(salesInvoicesTable.createdAt, endTs)))
      .orderBy(desc(salesInvoicesTable.createdAt))
      .limit(limit),
  ]);

  const combined: RecentActivity[] = [
    ...quotes.map((q) => ({ kind: "quotation" as const, label: `${q.number} · ${q.customerName}`, time: q.createdAt })),
    ...invoices.map((i) => ({ kind: "invoice" as const, label: `${i.number} · ${i.customerName}`, time: i.createdAt })),
  ];
  combined.sort((a, b) => b.time.getTime() - a.time.getTime());
  return combined.slice(0, limit);
}
