import { asc, eq, sql } from "drizzle-orm";
import { db, departmentsTable, employeesTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Card, CardContent } from "@/components/ui/card";
import { EmployeeForm } from "../employee-form";
import { createEmployeeAction } from "../actions";

export default async function NewEmployeePage() {
  const session = await requireSession();
  const locale = await getLocale();

  const [departments, [{ n }]] = await Promise.all([
    db
      .select({ id: departmentsTable.id, name: departmentsTable.name })
      .from(departmentsTable)
      .where(eq(departmentsTable.orgId, session.orgId))
      .orderBy(asc(departmentsTable.name)),
    db.select({ n: sql<number>`count(*)::int` }).from(employeesTable).where(eq(employeesTable.orgId, session.orgId)),
  ]);

  const codeSuggestion = `EMP-${String(n + 1).padStart(3, "0")}`;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="main-head">
        <h3>{t(locale, "New Employee")}</h3>
      </div>
      <Card>
        <CardContent className="pt-6">
          <EmployeeForm
            locale={locale}
            departments={departments}
            codeSuggestion={codeSuggestion}
            action={createEmployeeAction}
            submitLabel={t(locale, "Create Employee")}
          />
        </CardContent>
      </Card>
    </div>
  );
}
