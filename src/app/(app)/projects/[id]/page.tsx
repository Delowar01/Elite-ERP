import { notFound } from "next/navigation";
import Link from "next/link";
import { and, desc, eq, gte } from "drizzle-orm";
import {
  db,
  projectsTable,
  tasksTable,
  timeLogsTable,
  customersTable,
  employeesTable,
  quotationsTable,
  salesOrdersTable,
  salesInvoicesTable,
  purchaseOrdersTable,
} from "@/db";
import { Money } from "../../sales/_shared/money";
import { getProjectCostControl } from "@/lib/project-costing";
import { ProjectCostControlSection } from "./cost-control";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { tenantScope } from "@/lib/tenant";
import { t } from "@/lib/i18n/dict";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { resolveCurrencyMark, displayCurrency, formatMoneyNumber } from "@/lib/currency/currencies";
import { KanbanBoard } from "./kanban-board";
import { LogTimeDialog } from "./log-time-dialog";
import { ProjectStatusSelect } from "./project-status-select";

// "Time logged this week" mirrors the mockup's table title — a rolling 7-day window rather
// than a calendar week, so a freshly logged entry never vanishes the morning a week rolls over.
function weekAgoIso(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const projectId = Number((await params).id);
  if (!Number.isInteger(projectId)) notFound();

  const [project] = await db
    .select({
      id: projectsTable.id,
      name: projectsTable.name,
      status: projectsTable.status,
      startDate: projectsTable.startDate,
      endDate: projectsTable.endDate,
      budget: projectsTable.budget,
      description: projectsTable.description,
      clientName: customersTable.name,
    })
    .from(projectsTable)
    .leftJoin(customersTable, eq(projectsTable.clientId, customersTable.id))
    .where(and(eq(projectsTable.id, projectId), tenantScope(session.orgId, projectsTable)));
  if (!project) notFound();

  const weekAgo = weekAgoIso();

  const [tasks, employees, timeLogs] = await Promise.all([
    db
      .select({
        id: tasksTable.id,
        title: tasksTable.title,
        description: tasksTable.description,
        assigneeId: tasksTable.assigneeId,
        assigneeName: employeesTable.name,
        status: tasksTable.status,
        priority: tasksTable.priority,
        dueDate: tasksTable.dueDate,
      })
      .from(tasksTable)
      .leftJoin(employeesTable, eq(tasksTable.assigneeId, employeesTable.id))
      .where(and(eq(tasksTable.projectId, projectId), eq(tasksTable.orgId, session.orgId)))
      .orderBy(desc(tasksTable.id)),
    db
      .select({ id: employeesTable.id, name: employeesTable.name })
      .from(employeesTable)
      .where(and(eq(employeesTable.orgId, session.orgId), eq(employeesTable.status, "active"))),
    db
      .select({
        id: timeLogsTable.id,
        date: timeLogsTable.date,
        hours: timeLogsTable.hours,
        billable: timeLogsTable.billable,
        taskTitle: tasksTable.title,
        employeeName: employeesTable.name,
      })
      .from(timeLogsTable)
      .innerJoin(tasksTable, eq(timeLogsTable.taskId, tasksTable.id))
      .innerJoin(employeesTable, eq(timeLogsTable.employeeId, employeesTable.id))
      .where(and(eq(tasksTable.projectId, projectId), eq(timeLogsTable.orgId, session.orgId), gte(timeLogsTable.date, weekAgo)))
      .orderBy(desc(timeLogsTable.date), desc(timeLogsTable.id)),
  ]);

  // ---- Project Cost & Profitability ----
  // Every figure comes from src/lib/project-costing.ts, which reads only project-linked records that
  // are already financially effective. Linked Documents below is a different view on purpose: it
  // lists everything tagged to the project, including drafts that the cost figures correctly ignore.
  const [costControl, linkedQuotations, linkedOrders, linkedInvoices, linkedPos] = await Promise.all([
    getProjectCostControl(session.orgId, projectId, session.orgCurrency),
    db
      .select({ id: quotationsTable.id, number: quotationsTable.quotationNumber, date: quotationsTable.issueDate, total: quotationsTable.total, status: quotationsTable.status })
      .from(quotationsTable)
      .where(and(eq(quotationsTable.projectId, projectId), eq(quotationsTable.orgId, session.orgId))),
    db
      .select({ id: salesOrdersTable.id, number: salesOrdersTable.soNumber, date: salesOrdersTable.issueDate, total: salesOrdersTable.total, status: salesOrdersTable.status })
      .from(salesOrdersTable)
      .where(and(eq(salesOrdersTable.projectId, projectId), eq(salesOrdersTable.orgId, session.orgId))),
    db
      .select({ id: salesInvoicesTable.id, number: salesInvoicesTable.invoiceNumber, date: salesInvoicesTable.issueDate, total: salesInvoicesTable.total, status: salesInvoicesTable.status })
      .from(salesInvoicesTable)
      .where(and(eq(salesInvoicesTable.projectId, projectId), eq(salesInvoicesTable.orgId, session.orgId))),
    db
      .select({ id: purchaseOrdersTable.id, number: purchaseOrdersTable.poNumber, date: purchaseOrdersTable.orderDate, total: purchaseOrdersTable.total, status: purchaseOrdersTable.status })
      .from(purchaseOrdersTable)
      .where(and(eq(purchaseOrdersTable.projectId, projectId), eq(purchaseOrdersTable.orgId, session.orgId))),
  ]);
  if (!costControl) notFound();

  const linkedDocs = [
    ...linkedQuotations.map((d) => ({ ...d, type: "Quotation", href: `/sales/quotations/${d.id}` })),
    ...linkedOrders.map((d) => ({ ...d, type: "Sales Order", href: `/sales/orders/${d.id}` })),
    ...linkedInvoices.map((d) => ({ ...d, type: "Invoice", href: `/sales/invoices/${d.id}` })),
    ...linkedPos.map((d) => ({ ...d, type: "Purchase Order", href: `/purchasing/orders/${d.id}` })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  const currencyMark = resolveCurrencyMark(session.orgCurrency);
  const pillParts = [t(locale, project.status)];
  if (project.budget) pillParts.push(`${displayCurrency(currencyMark)} ${formatMoneyNumber(project.budget, "summary")} ${t(locale, "budget")}`);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="main-head">
        <h3>{project.name}</h3>
        <div className="flex items-center gap-3">
          <span className="org-pill">{pillParts.join(" · ")}</span>
          <ProjectStatusSelect locale={locale} projectId={project.id} status={project.status} />
        </div>
      </div>
      {(project.clientName || project.startDate || project.endDate || project.description) && (
        <div className="text-[12.5px] text-ink-muted -mt-3 mb-5 flex flex-wrap gap-x-4">
          {project.clientName && (
            <span>
              {t(locale, "Client")}: {project.clientName}
            </span>
          )}
          {project.startDate && (
            <span className="font-mono text-xs">
              {t(locale, "Start Date")} {project.startDate}
            </span>
          )}
          {project.endDate && (
            <span className="font-mono text-xs">
              {t(locale, "End Date")} {project.endDate}
            </span>
          )}
          {project.description && <span>{project.description}</span>}
        </div>
      )}

      <div className="stat-row-2" style={{ gridTemplateColumns: "repeat(2, 1fr)", maxWidth: 520 }}>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>{t(locale, "Budget")}</div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, marginTop: 4 }}>
            {project.budget ? <Money amount={project.budget} context="summary" /> : "—"}
          </div>
        </div>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>
            {t(locale, "Tasks")} · {costControl.labourEstimate.hours.toFixed(1)} {t(locale, "Hours logged").toLowerCase()}
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, marginTop: 4 }}>{tasks.length}</div>
        </div>
      </div>

      <ProjectCostControlSection locale={locale} data={costControl} />

      <KanbanBoard locale={locale} projectId={project.id} tasks={tasks} employees={employees} />

      <div className="main-head" style={{ marginTop: 22 }}>
        <h3 style={{ fontSize: 15 }}>{t(locale, "Time logged this week")}</h3>
        {employees.length > 0 && tasks.length > 0 ? (
          <LogTimeDialog locale={locale} tasks={tasks.map((task) => ({ id: task.id, title: task.title }))} employees={employees} />
        ) : null}
      </div>
      {employees.length === 0 && (
        <p className="text-[12px] text-ink-faint -mt-2 mb-3">
          {t(locale, "Time logging needs at least one employee — the People module ships in a later section.")}
        </p>
      )}
      {timeLogs.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface shadow-elevated py-8 text-center text-ink-muted text-sm">
          {t(locale, "No time logged yet.")}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Date")}</TableHead>
              <TableHead>{t(locale, "Task")}</TableHead>
              <TableHead>{t(locale, "Employee")}</TableHead>
              <TableHead>{t(locale, "Billable")}</TableHead>
              <TableHead className="text-right">{t(locale, "Hours")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {timeLogs.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="font-mono text-xs">{log.date}</TableCell>
                <TableCell>{log.taskTitle}</TableCell>
                <TableCell>{log.employeeName}</TableCell>
                <TableCell>
                  <Badge variant={log.billable ? "success" : "neutral"}>{t(locale, log.billable ? "Yes" : "No")}</Badge>
                </TableCell>
                <TableCell className="text-right font-mono">{Number(log.hours).toFixed(1)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="main-head" style={{ marginTop: 22 }}>
        <h3 style={{ fontSize: 15 }}>{t(locale, "Linked Documents")}</h3>
      </div>
      {linkedDocs.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface shadow-elevated py-8 text-center text-ink-muted text-sm">
          {t(locale, "No documents tagged to this project yet. Pick this project in the Project field when creating a quotation, sales order, or invoice.")}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Type")}</TableHead>
              <TableHead>{t(locale, "Number")}</TableHead>
              <TableHead>{t(locale, "Date")}</TableHead>
              <TableHead className="text-right">{t(locale, "Amount")}</TableHead>
              <TableHead>{t(locale, "Status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linkedDocs.map((d) => (
              <TableRow key={`${d.type}-${d.id}`}>
                <TableCell>{t(locale, d.type)}</TableCell>
                <TableCell className="font-semibold">
                  <Link href={d.href} className="hover:text-brand-orange font-mono">
                    {d.number}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-xs">{d.date}</TableCell>
                <TableCell className="text-right font-mono">
                  <Money amount={d.total} />
                </TableCell>
                <TableCell className="text-[12.5px] text-ink-muted">{t(locale, d.status)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
