"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, leaveRequestsTable, attendanceRecordsTable, employeesTable } from "@/db";
import { requireSession, requireRole } from "@/lib/session";
import { logActivity } from "@/lib/activity";

export type ActionResult = { error?: string };

const PATH = "/hr/leave";
const LEAVE_TYPES = new Set(["annual", "sick", "unpaid", "other"]);
// Upper bound on how many attendance rows one approval may write — guards against a typo'd
// end date (e.g. wrong year) generating thousands of rows in the approval transaction.
const MAX_LEAVE_DAYS = 60;

export async function requestLeaveAction(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const employeeId = Number(formData.get("employeeId"));
  const type = String(formData.get("type") ?? "");
  const startDate = String(formData.get("startDate") ?? "").trim();
  const endDate = String(formData.get("endDate") ?? "").trim();

  if (!employeeId) return { error: "Choose an employee." };
  if (!LEAVE_TYPES.has(type)) return { error: "Invalid leave type." };
  if (!startDate || !endDate) return { error: "Start and end dates are required." };
  if (endDate < startDate) return { error: "End date cannot be before the start date." };

  const [employee] = await db
    .select({ id: employeesTable.id, name: employeesTable.name })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.orgId, session.orgId)));
  if (!employee) return { error: "Employee not found." };

  const [row] = await db
    .insert(leaveRequestsTable)
    .values({
      orgId: session.orgId,
      employeeId,
      type,
      startDate,
      endDate,
      reason: String(formData.get("reason") ?? "").trim() || null,
    })
    .returning({ id: leaveRequestsTable.id });

  await logActivity(session, {
    type: "leave.requested",
    description: `Leave requested for "${employee.name}" (${startDate} – ${endDate})`,
    entityType: "leave_request",
    entityId: row.id,
  });

  revalidatePath(PATH);
  return {};
}

function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last && out.length < MAX_LEAVE_DAYS) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export async function approveLeaveAction(id: number): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");

  const [request] = await db
    .select()
    .from(leaveRequestsTable)
    .where(and(eq(leaveRequestsTable.id, id), eq(leaveRequestsTable.orgId, session.orgId)));
  if (!request) return { error: "Leave request not found." };
  if (request.status !== "pending") return { error: "Only pending requests can be approved." };

  const days = datesBetween(request.startDate, request.endDate);
  if (days.length >= MAX_LEAVE_DAYS) return { error: `Leave range is too long (max ${MAX_LEAVE_DAYS} days).` };

  // Approval + attendance sync in one transaction: every day in the range gets an on_leave
  // attendance row (v2 plan: "leave approval syncs attendance"), so Attendance/Employees/
  // Dashboard all show the right status without re-deriving from leave requests.
  await db.transaction(async (tx) => {
    await tx
      .update(leaveRequestsTable)
      .set({ status: "approved", approvedById: session.userId, decidedAt: new Date() })
      .where(eq(leaveRequestsTable.id, request.id));

    for (const date of days) {
      const [existing] = await tx
        .select({ id: attendanceRecordsTable.id })
        .from(attendanceRecordsTable)
        .where(and(eq(attendanceRecordsTable.employeeId, request.employeeId), eq(attendanceRecordsTable.date, date)));
      if (existing) {
        await tx.update(attendanceRecordsTable).set({ status: "on_leave" }).where(eq(attendanceRecordsTable.id, existing.id));
      } else {
        await tx.insert(attendanceRecordsTable).values({
          orgId: session.orgId,
          employeeId: request.employeeId,
          date,
          status: "on_leave",
        });
      }
    }
  });

  await logActivity(session, {
    type: "leave.approved",
    description: `Approved leave request #${request.id}`,
    entityType: "leave_request",
    entityId: request.id,
  });

  revalidatePath(PATH);
  revalidatePath("/hr/attendance");
  revalidatePath("/hr/employees");
  revalidatePath("/dashboard");
  return {};
}

export async function rejectLeaveAction(id: number): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");

  const result = await db
    .update(leaveRequestsTable)
    .set({ status: "rejected", approvedById: session.userId, decidedAt: new Date() })
    .where(and(eq(leaveRequestsTable.id, id), eq(leaveRequestsTable.orgId, session.orgId), eq(leaveRequestsTable.status, "pending")))
    .returning({ id: leaveRequestsTable.id });
  if (!result.length) return { error: "Only pending requests can be rejected." };

  await logActivity(session, {
    type: "leave.rejected",
    description: `Rejected leave request #${id}`,
    entityType: "leave_request",
    entityId: id,
  });

  revalidatePath(PATH);
  return {};
}
