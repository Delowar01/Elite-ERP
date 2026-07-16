import { asc, and, eq } from "drizzle-orm";
import { db, employeesTable, attendanceRecordsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { AttendanceRowActions } from "./attendance-row-actions";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  present: "success",
  late: "warning",
  on_leave: "info",
  absent: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  present: "Present",
  late: "Late",
  on_leave: "On leave",
  absent: "Absent",
};

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
  const todayLabel = new Date().toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="max-w-6xl mx-auto">
      <div className="main-head">
        <h3>
          {t(locale, "Attendance")} — {t(locale, "Today")}
        </h3>
        <span className="org-pill">{todayLabel}</span>
      </div>

      {employees.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface shadow-elevated py-12 text-center text-ink-muted text-sm">
          {t(locale, "No active employees yet — add employees to start tracking attendance.")}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Employee")}</TableHead>
              <TableHead>{t(locale, "Check-in")}</TableHead>
              <TableHead>{t(locale, "Check-out")}</TableHead>
              <TableHead>{t(locale, "Status")}</TableHead>
              <TableHead />
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
                  <TableCell className="font-mono text-xs">{fmtTime(record?.checkIn ?? null)}</TableCell>
                  <TableCell className="font-mono text-xs">{fmtTime(record?.checkOut ?? null)}</TableCell>
                  <TableCell>
                    {status ? (
                      <Badge variant={STATUS_VARIANT[status] ?? "neutral"}>{t(locale, STATUS_LABEL[status] ?? status)}</Badge>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
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
