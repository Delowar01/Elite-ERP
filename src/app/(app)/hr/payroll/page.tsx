import { asc, and, desc, eq, sql } from "drizzle-orm";
import { StatusBadge } from "@/components/ui/status-badge";
import { db, employeesTable, payrollRunsTable, payslipsTable } from "@/db";
import { requireRole } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDisplayDate } from "@/lib/i18n/format-date";
import { latestStructures } from "./queries";
import { PayrollClient, type PayrollLine } from "./payroll-client";
import { Money } from "../../sales/_shared/money";
import { StatRow } from "../../sales/_shared/stat-row";

export default async function PayrollPage() {
  const session = await requireRole("owner", "admin");
  const locale = await getLocale();

  const now = new Date();
  const periodMonth = now.getMonth() + 1;
  const periodYear = now.getFullYear();
  // The title shows the period selected above (its first day, written out in UTC), so the formatter never
  // picks a month of its own; Gregorian with Western digits in Arabic too.
  const monthLabel = formatDisplayDate(`${periodYear}-${String(periodMonth).padStart(2, "0")}-01T00:00:00Z`, locale, "monthYear");

  const [run] = await db
    .select()
    .from(payrollRunsTable)
    .where(
      and(eq(payrollRunsTable.orgId, session.orgId), eq(payrollRunsTable.periodMonth, periodMonth), eq(payrollRunsTable.periodYear, periodYear)),
    );

  let lines: PayrollLine[] = [];
  let skippedCount = 0;

  if (run) {
    // Processed: show the snapshot, not live structures.
    const slips = await db
      .select({
        employeeId: payslipsTable.employeeId,
        employeeName: employeesTable.name,
        basic: payslipsTable.basicSalary,
        allowances: payslipsTable.allowances,
        deductions: payslipsTable.deductions,
        gross: payslipsTable.grossPay,
        net: payslipsTable.netPay,
      })
      .from(payslipsTable)
      .innerJoin(employeesTable, eq(payslipsTable.employeeId, employeesTable.id))
      .where(eq(payslipsTable.payrollRunId, run.id))
      .orderBy(asc(employeesTable.name));
    lines = slips.map((s) => ({
      employeeId: s.employeeId,
      employeeName: s.employeeName,
      basic: Number(s.basic),
      allowances: Number(s.allowances),
      deductions: Number(s.deductions),
      gross: Number(s.gross),
      net: Number(s.net),
    }));
  } else {
    // Draft preview computed live from each active employee's latest salary structure.
    const employees = await db
      .select({ id: employeesTable.id, name: employeesTable.name })
      .from(employeesTable)
      .where(and(eq(employeesTable.orgId, session.orgId), eq(employeesTable.status, "active")))
      .orderBy(asc(employeesTable.name));
    const structures = await latestStructures(session.orgId);
    for (const e of employees) {
      const s = structures.get(e.id);
      if (!s) {
        skippedCount += 1;
        continue;
      }
      const basic = Number(s.basicSalary);
      const allowances = Number(s.allowances);
      const deductions = Number(s.deductions);
      const gross = basic + allowances;
      lines.push({ employeeId: e.id, employeeName: e.name, basic, allowances, deductions, gross, net: gross - deductions });
    }
  }

  const grossTotal = lines.reduce((sum, l) => sum + l.gross, 0);
  const deductionsTotal = lines.reduce((sum, l) => sum + l.deductions, 0);
  const netTotal = lines.reduce((sum, l) => sum + l.net, 0);

  // Join + group-by rather than a raw-sql correlated subquery: inside sql`` templates drizzle
  // renders bare column names, so the "outer" reference silently resolves to the inner table.
  const pastRuns = await db
    .select({
      id: payrollRunsTable.id,
      periodMonth: payrollRunsTable.periodMonth,
      periodYear: payrollRunsTable.periodYear,
      status: payrollRunsTable.status,
      netTotal: sql<string>`coalesce(sum(${payslipsTable.netPay}), 0)`,
    })
    .from(payrollRunsTable)
    .leftJoin(payslipsTable, eq(payslipsTable.payrollRunId, payrollRunsTable.id))
    .where(eq(payrollRunsTable.orgId, session.orgId))
    .groupBy(payrollRunsTable.id)
    .orderBy(desc(payrollRunsTable.periodYear), desc(payrollRunsTable.periodMonth));

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title={`${t(locale, "Payroll")} — ${monthLabel}`}
        meta={<StatusBadge domain="payroll_period" status={run ? "processed" : "draft"} locale={locale} />}
      />

      {/* Totals, not statuses: plain values (no tone), money through <Money>. */}
      <StatRow
        items={[
          { label: t(locale, "Employees"), value: lines.length },
          { label: t(locale, "Gross pay"), value: <Money amount={grossTotal} context="summary" /> },
          { label: t(locale, "Deductions"), value: <Money amount={deductionsTotal} context="summary" /> },
          { label: t(locale, "Net pay"), value: <Money amount={netTotal} context="summary" /> },
        ]}
      />

      {lines.length === 0 ? (
        <EmptyState message={t(locale, "No active employees with a salary structure — set one on each employee's profile first.")} />
      ) : (
        <>
          {!run && skippedCount > 0 && (
            <p className="text-[12px] text-ink-faint mb-3">
              {skippedCount} — {t(locale, "Employees without a salary structure are skipped.")}
            </p>
          )}
          <PayrollClient locale={locale} lines={lines} processed={Boolean(run)} periodMonth={periodMonth} periodYear={periodYear} />
        </>
      )}

      {pastRuns.length > 0 && (
        <>
          <SectionHeader level={2} title={t(locale, "Past payroll runs")} className="mt-[26px] mb-[22px]" />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t(locale, "Period")}</TableHead>
                <TableHead>{t(locale, "Status")}</TableHead>
                <TableHead numeric>{t(locale, "Net pay")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pastRuns.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="num-tabular text-xs">
                    {r.periodYear}-{String(r.periodMonth).padStart(2, "0")}
                  </TableCell>
                  <TableCell>
                    <StatusBadge domain="payroll_run" status={r.status} locale={locale} />
                  </TableCell>
                  <TableCell numeric><Money amount={Number(r.netTotal)} context="summary" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}
