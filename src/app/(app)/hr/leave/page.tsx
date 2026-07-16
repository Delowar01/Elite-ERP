import { asc, and, desc, eq } from "drizzle-orm";
import { db, leaveRequestsTable, employeesTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { LeaveClient } from "./leave-client";

export default async function LeavePage() {
  const session = await requireSession();
  const locale = await getLocale();

  const [rows, employees] = await Promise.all([
    db
      .select({
        id: leaveRequestsTable.id,
        employeeName: employeesTable.name,
        type: leaveRequestsTable.type,
        startDate: leaveRequestsTable.startDate,
        endDate: leaveRequestsTable.endDate,
        reason: leaveRequestsTable.reason,
        status: leaveRequestsTable.status,
      })
      .from(leaveRequestsTable)
      .innerJoin(employeesTable, eq(leaveRequestsTable.employeeId, employeesTable.id))
      .where(eq(leaveRequestsTable.orgId, session.orgId))
      .orderBy(desc(leaveRequestsTable.id)),
    db
      .select({ id: employeesTable.id, name: employeesTable.name })
      .from(employeesTable)
      .where(and(eq(employeesTable.orgId, session.orgId), eq(employeesTable.status, "active")))
      .orderBy(asc(employeesTable.name)),
  ]);

  const canDecide = session.role === "owner" || session.role === "admin";

  return <LeaveClient locale={locale} rows={rows} employees={employees} canDecide={canDecide} />;
}
