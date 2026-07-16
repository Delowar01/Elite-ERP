"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, attendanceRecordsTable, employeesTable } from "@/db";
import { requireSession } from "@/lib/session";

export type ActionResult = { error?: string };

const PATH = "/hr/attendance";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Check-ins after 09:00 are marked late — matches the mockup's Attendance screen, where a
// 09:14 check-in renders the Late pill while 08:58 renders Present.
const LATE_CUTOFF = "09:00";

export async function checkInAction(employeeId: number): Promise<ActionResult> {
  const session = await requireSession();

  const [employee] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.orgId, session.orgId), eq(employeesTable.status, "active")));
  if (!employee) return { error: "Employee not found." };

  const today = todayIso();
  const [existing] = await db
    .select()
    .from(attendanceRecordsTable)
    .where(and(eq(attendanceRecordsTable.employeeId, employeeId), eq(attendanceRecordsTable.date, today)));
  if (existing?.checkIn) return { error: "Already checked in today." };
  if (existing?.status === "on_leave") return { error: "This employee is on approved leave today." };

  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5);
  const status = hhmm > LATE_CUTOFF ? "late" : "present";

  if (existing) {
    await db.update(attendanceRecordsTable).set({ checkIn: now, status }).where(eq(attendanceRecordsTable.id, existing.id));
  } else {
    await db.insert(attendanceRecordsTable).values({ orgId: session.orgId, employeeId, date: today, checkIn: now, status });
  }

  revalidatePath(PATH);
  revalidatePath("/hr/employees");
  revalidatePath("/dashboard");
  return {};
}

export async function checkOutAction(employeeId: number): Promise<ActionResult> {
  const session = await requireSession();

  const today = todayIso();
  const [existing] = await db
    .select({ id: attendanceRecordsTable.id, checkIn: attendanceRecordsTable.checkIn, checkOut: attendanceRecordsTable.checkOut, orgId: attendanceRecordsTable.orgId })
    .from(attendanceRecordsTable)
    .where(and(eq(attendanceRecordsTable.employeeId, employeeId), eq(attendanceRecordsTable.date, today), eq(attendanceRecordsTable.orgId, session.orgId)));
  if (!existing?.checkIn) return { error: "Check in first." };
  if (existing.checkOut) return { error: "Already checked out today." };

  await db.update(attendanceRecordsTable).set({ checkOut: new Date() }).where(eq(attendanceRecordsTable.id, existing.id));

  revalidatePath(PATH);
  return {};
}
