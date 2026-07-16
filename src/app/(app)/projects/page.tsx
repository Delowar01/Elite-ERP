import { desc, eq, sql } from "drizzle-orm";
import { db, projectsTable, customersTable, tasksTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { ProjectsListClient } from "./projects-list-client";

export default async function ProjectsPage() {
  const session = await requireSession();
  const locale = await getLocale();

  const rows = await db
    .select({
      id: projectsTable.id,
      name: projectsTable.name,
      clientName: customersTable.name,
      status: projectsTable.status,
      startDate: projectsTable.startDate,
      endDate: projectsTable.endDate,
      budget: projectsTable.budget,
      taskCount: sql<number>`(select count(*) from ${tasksTable} where ${tasksTable.projectId} = ${projectsTable.id})`.mapWith(Number),
    })
    .from(projectsTable)
    .leftJoin(customersTable, eq(projectsTable.clientId, customersTable.id))
    .where(eq(projectsTable.orgId, session.orgId))
    .orderBy(desc(projectsTable.id));

  return <ProjectsListClient locale={locale} rows={rows} />;
}
