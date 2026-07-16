"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, projectsTable, tasksTable, timeLogsTable, customersTable, employeesTable } from "@/db";
import { requireSession } from "@/lib/session";
import { tenantScope } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";

export type ActionState = { error?: string } | undefined;
export type ActionResult = { error?: string };

const PROJECT_STATUSES = new Set(["planned", "active", "on_hold", "completed", "cancelled"]);
const TASK_STATUSES = new Set(["todo", "in_progress", "done", "blocked"]);
const TASK_PRIORITIES = new Set(["low", "medium", "high"]);

export async function createProjectAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Project name is required." };

  const clientIdRaw = Number(formData.get("clientId"));
  let clientId: number | null = null;
  if (clientIdRaw) {
    const [client] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(and(eq(customersTable.id, clientIdRaw), tenantScope(session.orgId, customersTable)));
    if (!client) return { error: "Client not found." };
    clientId = client.id;
  }

  const status = String(formData.get("status") ?? "planned");
  if (!PROJECT_STATUSES.has(status)) return { error: "Invalid project status." };
  const budgetRaw = String(formData.get("budget") ?? "").trim();
  const budget = budgetRaw ? Number(budgetRaw) : null;
  if (budget !== null && (Number.isNaN(budget) || budget < 0)) return { error: "Budget must be a positive number." };

  const [row] = await db
    .insert(projectsTable)
    .values({
      orgId: session.orgId,
      name,
      clientId,
      status,
      startDate: String(formData.get("startDate") ?? "").trim() || null,
      endDate: String(formData.get("endDate") ?? "").trim() || null,
      budget: budget !== null ? budget.toFixed(2) : null,
      description: String(formData.get("description") ?? "").trim() || null,
    })
    .returning({ id: projectsTable.id });

  await logActivity(session, {
    type: "project.created",
    description: `Created project "${name}"`,
    entityType: "project",
    entityId: row.id,
  });

  revalidatePath("/projects");
  revalidatePath("/dashboard");
  redirect(`/projects/${row.id}`);
}

export async function updateProjectStatusAction(projectId: number, status: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!PROJECT_STATUSES.has(status)) return { error: "Invalid project status." };

  const result = await db
    .update(projectsTable)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(projectsTable.id, projectId), tenantScope(session.orgId, projectsTable)))
    .returning({ id: projectsTable.id, name: projectsTable.name });
  if (!result.length) return { error: "Project not found." };

  await logActivity(session, {
    type: "project.status_changed",
    description: `Project "${result[0].name}" moved to ${status}`,
    entityType: "project",
    entityId: projectId,
  });

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/dashboard");
  return {};
}

async function readTaskFields(orgId: number, formData: FormData): Promise<{ error?: string; fields?: {
  title: string;
  description: string | null;
  assigneeId: number | null;
  status: string;
  priority: string;
  dueDate: string | null;
} }> {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Task title is required." };

  const status = String(formData.get("status") ?? "todo");
  if (!TASK_STATUSES.has(status)) return { error: "Invalid task status." };
  const priority = String(formData.get("priority") ?? "medium");
  if (!TASK_PRIORITIES.has(priority)) return { error: "Invalid task priority." };

  const assigneeIdRaw = Number(formData.get("assigneeId"));
  let assigneeId: number | null = null;
  if (assigneeIdRaw) {
    const [employee] = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(and(eq(employeesTable.id, assigneeIdRaw), eq(employeesTable.orgId, orgId)));
    if (!employee) return { error: "Assignee not found." };
    assigneeId = employee.id;
  }

  return {
    fields: {
      title,
      description: String(formData.get("description") ?? "").trim() || null,
      assigneeId,
      status,
      priority,
      dueDate: String(formData.get("dueDate") ?? "").trim() || null,
    },
  };
}

export async function createTaskAction(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const projectId = Number(formData.get("projectId"));

  const [project] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), tenantScope(session.orgId, projectsTable)));
  if (!project) return { error: "Project not found." };

  const parsed = await readTaskFields(session.orgId, formData);
  if (parsed.error || !parsed.fields) return { error: parsed.error };

  await db.insert(tasksTable).values({ orgId: session.orgId, projectId, ...parsed.fields });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  return {};
}

export async function updateTaskAction(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const taskId = Number(formData.get("taskId"));

  const [task] = await db
    .select({ id: tasksTable.id, projectId: tasksTable.projectId })
    .from(tasksTable)
    .where(and(eq(tasksTable.id, taskId), eq(tasksTable.orgId, session.orgId)));
  if (!task) return { error: "Task not found." };

  const parsed = await readTaskFields(session.orgId, formData);
  if (parsed.error || !parsed.fields) return { error: parsed.error };

  await db.update(tasksTable).set({ ...parsed.fields, updatedAt: new Date() }).where(eq(tasksTable.id, task.id));

  revalidatePath(`/projects/${task.projectId}`);
  revalidatePath("/projects");
  return {};
}

export async function logTimeAction(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const taskId = Number(formData.get("taskId"));
  const employeeId = Number(formData.get("employeeId"));
  const date = String(formData.get("date") ?? "").trim();
  const hours = Number(formData.get("hours"));
  const billable = String(formData.get("billable") ?? "") === "true";

  if (!taskId) return { error: "Choose a task." };
  if (!employeeId) return { error: "Choose an employee." };
  if (!date) return { error: "Date is required." };
  if (!hours || Number.isNaN(hours) || hours <= 0) return { error: "Hours must be greater than zero." };

  const [task] = await db
    .select({ id: tasksTable.id, projectId: tasksTable.projectId })
    .from(tasksTable)
    .where(and(eq(tasksTable.id, taskId), eq(tasksTable.orgId, session.orgId)));
  if (!task) return { error: "Task not found." };

  const [employee] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.orgId, session.orgId)));
  if (!employee) return { error: "Employee not found." };

  await db.insert(timeLogsTable).values({
    orgId: session.orgId,
    taskId,
    employeeId,
    date,
    hours: hours.toFixed(2),
    notes: String(formData.get("notes") ?? "").trim() || null,
    billable,
  });

  revalidatePath(`/projects/${task.projectId}`);
  return {};
}
