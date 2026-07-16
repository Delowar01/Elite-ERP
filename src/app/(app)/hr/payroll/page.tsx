import { asc, and, desc, eq, sql } from "drizzle-orm";
import { db, employeesTable, payrollRunsTable, payslipsTable } from "@/db";
import { requireRole } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { latestStructures } from "./queries";
import { PayrollClient, type PayrollLine } from "./payroll-client";

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function PayrollPage() {
  const session = await requireRole("owner", "admin");
  const locale = await getLocale();

  const now = new Date();
  const periodMonth = now.getMonth() + 1;
  const periodYear = now.getFullYear();
  const monthLabel = now.toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", { month: "long", year: "numeric" });

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
      <div className="main-head">
        <h3>
          {t(locale, "Payroll")} — {monthLabel}
        </h3>
        <Badge variant={run ? "success" : "warning"} live={!run}>
          {t(locale, run ? "processed" : "Draft")}
        </Badge>
      </div>

      <div className="stat-row-2">
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>{t(locale, "Employees")}</div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, marginTop: 4 }}>{lines.length}</div>
        </div>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>{t(locale, "Gross pay")}</div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, marginTop: 4 }}>SAR {fmt(grossTotal)}</div>
        </div>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>{t(locale, "Deductions")}</div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, marginTop: 4 }}>SAR {fmt(deductionsTotal)}</div>
        </div>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>{t(locale, "Net pay")}</div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, marginTop: 4, color: "var(--brand-orange)" }}>
            SAR {fmt(netTotal)}
          </div>
        </div>
      </div>

      {lines.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface shadow-elevated py-12 text-center text-ink-muted text-sm">
          {t(locale, "No active employees with a salary structure — set one on each employee's profile first.")}
        </div>
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
          <div className="main-head" style={{ marginTop: 26 }}>
            <h3 style={{ fontSize: 15 }}>{t(locale, "Past payroll runs")}</h3>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t(locale, "Period")}</TableHead>
                <TableHead>{t(locale, "Status")}</TableHead>
                <TableHead className="text-right">{t(locale, "Net pay")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pastRuns.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">
                    {r.periodYear}-{String(r.periodMonth).padStart(2, "0")}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.status === "processed" ? "success" : "neutral"}>{t(locale, r.status)}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">SAR {fmt(Number(r.netTotal))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}
