import { asc } from "drizzle-orm";
import { db, customersTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { tenantScope } from "@/lib/tenant";
import { t } from "@/lib/i18n/dict";
import { Card, CardContent } from "@/components/ui/card";
import { ProjectForm } from "../project-form";
import { createProjectAction } from "../actions";

export default async function NewProjectPage() {
  const session = await requireSession();
  const locale = await getLocale();

  const clients = await db
    .select({ id: customersTable.id, name: customersTable.name })
    .from(customersTable)
    .where(tenantScope(session.orgId, customersTable))
    .orderBy(asc(customersTable.name));

  return (
    <div className="max-w-6xl mx-auto">
      <div className="main-head">
        <h3>{t(locale, "New Project")}</h3>
      </div>
      <p className="text-[12.5px] text-ink-muted -mt-3 mb-5">{t(locale, "Add a project to plan tasks and track time against it.")}</p>
      <Card>
        <CardContent className="pt-6">
          <ProjectForm locale={locale} clients={clients} action={createProjectAction} />
        </CardContent>
      </Card>
    </div>
  );
}
