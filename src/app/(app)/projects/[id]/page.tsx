import { notFound } from "next/navigation";
import { and, desc, eq, gte } from "drizzle-orm";
import { db, projectsTable, tasksTable, timeLogsTable, customersTable, employeesTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { tenantScope } from "@/lib/tenant";
import { t } from "@/lib/i18n/dict";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { fmt } from "../../sales/_shared/totals";
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

  const pillParts = [t(locale, project.status)];
  if (project.budget) pillParts.push(`SAR ${fmt(project.budget)} ${t(locale, "budget")}`);

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
    </div>
  );
}
