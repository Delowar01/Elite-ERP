import { asc, and, eq } from "drizzle-orm";
import { StatusBadge } from "@/components/ui/status-badge";
import { db, employeesTable, attendanceRecordsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDisplayDate } from "@/lib/i18n/format-date";
import { AttendanceRowActions } from "./attendance-row-actions";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}



export default async function AttendancePage() {
  const session = await requireSession();
  const locale = await getLocale();
  const today = todayIso();

  const [employees, records] = await Promise.all([
    db
      .select({ id: employeesTable.id, name: employeesTable.name })
      .from(employeesTable)
      .where(and(eq(employeesTable.orgId, session.orgId), eq(employeesTable.status, "active")))
      .orderBy(asc(employeesTable.name)),
    db
      .select()
      .from(attendanceRecordsTable)
      .where(and(eq(attendanceRecordsTable.orgId, session.orgId), eq(attendanceRecordsTable.date, today))),
  ]);

  const recordByEmployee = new Map(records.map((r) => [r.employeeId, r]));
  // The calendar day the records above were selected for (todayIso, UTC), written out in UTC — the
  // formatter never picks a day of its own; Gregorian with Western digits in Arabic too.
  const todayLabel = formatDisplayDate(`${today}T00:00:00Z`, locale, "date");

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title={`${t(locale, "Attendance")} — ${t(locale, "Today")}`} meta={<span className="org-pill">{todayLabel}</span>} />

      {employees.length === 0 ? (
        <EmptyState message={t(locale, "No active employees yet — add employees to start tracking attendance.")} />
      ) : (
        <Table list>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Employee")}</TableHead>
              <TableHead>{t(locale, "Check-in")}</TableHead>
              <TableHead>{t(locale, "Check-out")}</TableHead>
              <TableHead>{t(locale, "Status")}</TableHead>
              <TableHead action>{t(locale, "Actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.map((e) => {
              const record = recordByEmployee.get(e.id);
              const status = record?.status ?? null;
              const onLeave = status === "on_leave";
              return (
                <TableRow key={e.id}>
                  <TableCell>{e.name}</TableCell>
                  <TableCell className="num-tabular text-xs">{fmtTime(record?.checkIn ?? null)}</TableCell>
                  <TableCell className="num-tabular text-xs">{fmtTime(record?.checkOut ?? null)}</TableCell>
                  <TableCell>
                    {status ? (
                      <StatusBadge domain="attendance" status={status} locale={locale} />
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </TableCell>
                  <TableCell action>
                    <AttendanceRowActions
                      locale={locale}
                      employeeId={e.id}
                      canCheckIn={!record?.checkIn && !onLeave}
                      canCheckOut={Boolean(record?.checkIn) && !record?.checkOut}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
