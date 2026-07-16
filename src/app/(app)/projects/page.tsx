import { desc, eq, sql } from "drizzle-orm";
import { db, projectsTable, customersTable, tasksTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { ProjectsListClient } from "./projects-list-client";

export default async function ProjectsPage() {
  const session = await requireSession();
  const locale = await getLocale();

  // Join + group-by rather than a raw-sql correlated subquery: inside sql`` templates drizzle
  // renders bare column names, so the "outer" reference silently resolves to the inner table.
  const rows = await db
    .select({
      id: projectsTable.id,
      name: projectsTable.name,
      clientName: customersTable.name,
      status: projectsTable.status,
      startDate: projectsTable.startDate,
      endDate: projectsTable.endDate,
      budget: projectsTable.budget,
      taskCount: sql<number>`count(${tasksTable.id})::int`.mapWith(Number),
    })
    .from(projectsTable)
    .leftJoin(customersTable, eq(projectsTable.clientId, customersTable.id))
    .leftJoin(tasksTable, eq(tasksTable.projectId, projectsTable.id))
    .where(eq(projectsTable.orgId, session.orgId))
    .groupBy(projectsTable.id, customersTable.id)
    .orderBy(desc(projectsTable.id));

  return <ProjectsListClient locale={locale} rows={rows} />;
}
