import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, employeesTable, departmentsTable, salaryStructuresTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmployeeForm } from "../employee-form";
import { updateEmployeeAction } from "../actions";
import { SalaryForm } from "./salary-form";

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const employeeId = Number((await params).id);
  if (!Number.isInteger(employeeId)) notFound();

  const [employee] = await db
    .select()
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.orgId, session.orgId)));
  if (!employee) notFound();

  const [departments, structures] = await Promise.all([
    db
      .select({ id: departmentsTable.id, name: departmentsTable.name })
      .from(departmentsTable)
      .where(eq(departmentsTable.orgId, session.orgId))
      .orderBy(asc(departmentsTable.name)),
    db
      .select()
      .from(salaryStructuresTable)
      .where(and(eq(salaryStructuresTable.employeeId, employeeId), eq(salaryStructuresTable.orgId, session.orgId)))
      .orderBy(desc(salaryStructuresTable.effectiveFrom), desc(salaryStructuresTable.id)),
  ]);

  const current = structures[0] ?? null;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="main-head">
        <h3>
          {employee.name} <span className="font-mono text-[13px] text-ink-muted">· {employee.employeeCode}</span>
        </h3>
        <Badge variant={employee.status === "active" ? "success" : "neutral"}>{t(locale, employee.status)}</Badge>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <Card>
          <CardContent className="pt-6">
            <EmployeeForm
              locale={locale}
              employee={employee}
              departments={departments}
              action={updateEmployeeAction.bind(null, employee.id)}
              submitLabel={t(locale, "Save Changes")}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-[13px] font-bold mb-4">{t(locale, "Salary Structure")}</div>
            {!current && (
              <p className="text-[12px] text-ink-faint mb-4">
                {t(locale, "No salary structure yet — payroll skips this employee until one is set.")}
              </p>
            )}
            <SalaryForm locale={locale} employeeId={employee.id} current={current} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
