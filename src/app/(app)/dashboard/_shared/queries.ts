import "server-only";
import { and, eq, gte, lte, ne, inArray, sql, desc } from "drizzle-orm";
import { db, salesInvoicesTable, quotationsTable, bankAccountsTable, journalLinesTable, journalEntriesTable, customersTable, purchaseOrdersTable, projectsTable } from "@/db";

function monthBounds(offsetMonths: number) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offsetMonths + 1, 0);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

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

export async function getKpis(orgId: number) {
  const thisMonth = monthBounds(0);
  const lastMonth = monthBounds(-1);

  const [salesThis, salesLast] = await Promise.all([
    invoiceTotalBetween(orgId, thisMonth.start, thisMonth.end),
    invoiceTotalBetween(orgId, lastMonth.start, lastMonth.end),
  ]);

  const [{ n: invoicesThis } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(salesInvoicesTable)
    .where(and(eq(salesInvoicesTable.orgId, orgId), ne(salesInvoicesTable.status, "draft"), gte(salesInvoicesTable.issueDate, thisMonth.start)));
  const [{ n: invoicesLast } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(salesInvoicesTable)
    .where(
      and(
        eq(salesInvoicesTable.orgId, orgId),
        ne(salesInvoicesTable.status, "draft"),
        gte(salesInvoicesTable.issueDate, lastMonth.start),
        lte(salesInvoicesTable.issueDate, lastMonth.end),
      ),
    );
  const [{ n: invoicesTotal } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(salesInvoicesTable)
    .where(and(eq(salesInvoicesTable.orgId, orgId), ne(salesInvoicesTable.status, "draft")));

  const [{ receivables } = { receivables: "0" }] = await db
    .select({ receivables: sql<string>`coalesce(sum(${salesInvoicesTable.total} - ${salesInvoicesTable.paidAmount}), 0)` })
    .from(salesInvoicesTable)
    .where(and(eq(salesInvoicesTable.orgId, orgId), inArray(salesInvoicesTable.status, ["sent", "partially_paid"])));

  // Mirrors totalReceivables exactly, on the purchasing side: received POs are the ones
  // that have actually posted to Accounts Payable. paidAmount stays 0 for every PO until
  // Payments (a later section) ships, so this is honestly the full received total for now.
  const [{ payables } = { payables: "0" }] = await db
    .select({ payables: sql<string>`coalesce(sum(${purchaseOrdersTable.total} - ${purchaseOrdersTable.paidAmount}), 0)` })
    .from(purchaseOrdersTable)
    .where(and(eq(purchaseOrdersTable.orgId, orgId), eq(purchaseOrdersTable.status, "received")));

  const salesTrend = trend(salesThis, salesLast);
  const invoicesTrend = trend(invoicesThis, invoicesLast);

  return {
    totalSalesThisMonth: salesThis,
    totalSalesTrend: salesTrend,
    totalInvoices: invoicesTotal,
    totalInvoicesTrend: invoicesTrend,
    totalReceivables: Number(receivables),
    totalPayables: Number(payables),
  };
}

export async function getRevenueTrend(orgId: number, months = 7) {
  const points: { label: string; total: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const { start, end } = monthBounds(-i);
    const total = await invoiceTotalBetween(orgId, start, end);
    const label = new Date(start).toLocaleDateString("en-US", { month: "short" });
    points.push({ label, total });
  }
  return points;
}

export async function getInvoicesOverview(orgId: number) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({ status: salesInvoicesTable.status, dueDate: salesInvoicesTable.dueDate, n: sql<number>`count(*)::int` })
    .from(salesInvoicesTable)
    .where(and(eq(salesInvoicesTable.orgId, orgId), ne(salesInvoicesTable.status, "draft"), ne(salesInvoicesTable.status, "void")))
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

export async function getCashFlowThisMonth(orgId: number) {
  const { start, end } = monthBounds(0);
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
        gte(journalEntriesTable.entryDate, start),
        lte(journalEntriesTable.entryDate, end),
      ),
    );
  const inflow = Number(row?.debit ?? 0);
  const outflow = Number(row?.credit ?? 0);
  return { inflow, outflow, net: inflow - outflow };
}

export type RecentActivity = { kind: "quotation" | "invoice"; label: string; time: Date };

export async function getRecentActivity(orgId: number, limit = 4): Promise<RecentActivity[]> {
  const [quotes, invoices] = await Promise.all([
    db
      .select({ number: quotationsTable.quotationNumber, customerName: customersTable.name, createdAt: quotationsTable.createdAt })
      .from(quotationsTable)
      .innerJoin(customersTable, eq(customersTable.id, quotationsTable.customerId))
      .where(eq(quotationsTable.orgId, orgId))
      .orderBy(desc(quotationsTable.createdAt))
      .limit(limit),
    db
      .select({ number: salesInvoicesTable.invoiceNumber, customerName: customersTable.name, createdAt: salesInvoicesTable.createdAt })
      .from(salesInvoicesTable)
      .innerJoin(customersTable, eq(customersTable.id, salesInvoicesTable.customerId))
      .where(eq(salesInvoicesTable.orgId, orgId))
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
