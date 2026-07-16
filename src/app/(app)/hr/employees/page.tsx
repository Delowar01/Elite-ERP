import { asc, and, eq } from "drizzle-orm";
import { db, employeesTable, departmentsTable, attendanceRecordsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { EmployeesClient } from "./employees-client";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function EmployeesPage() {
  const session = await requireSession();
  const locale = await getLocale();

  const [employees, departments, todayAttendance] = await Promise.all([
    db
      .select({
        id: employeesTable.id,
        employeeCode: employeesTable.employeeCode,
        name: employeesTable.name,
        designation: employeesTable.designation,
        departmentId: employeesTable.departmentId,
        departmentName: departmentsTable.name,
        status: employeesTable.status,
      })
      .from(employeesTable)
      .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
      .where(eq(employeesTable.orgId, session.orgId))
      .orderBy(asc(employeesTable.name)),
    db
      .select({ id: departmentsTable.id, name: departmentsTable.name })
      .from(departmentsTable)
      .where(eq(departmentsTable.orgId, session.orgId))
      .orderBy(asc(departmentsTable.name)),
    db
      .select({ employeeId: attendanceRecordsTable.employeeId, status: attendanceRecordsTable.status })
      .from(attendanceRecordsTable)
      .where(and(eq(attendanceRecordsTable.orgId, session.orgId), eq(attendanceRecordsTable.date, todayIso()))),
  ]);

  const attendanceByEmployee = new Map(todayAttendance.map((a) => [a.employeeId, a.status]));
  const rows = employees.map((e) => ({ ...e, todayStatus: attendanceByEmployee.get(e.id) ?? null }));

  return <EmployeesClient locale={locale} rows={rows} departments={departments} />;
}
