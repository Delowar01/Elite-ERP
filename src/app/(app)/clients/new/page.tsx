import { eq } from "drizzle-orm";
import { db, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { countryCodeByName } from "@/lib/geo/countries";
import { t } from "@/lib/i18n/dict";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ClientForm } from "../client-form";
import { createClientAction } from "../actions";

export default async function NewClientPage() {
  const session = await requireSession();
  const locale = await getLocale();
  const [org] = await db.select({ country: orgsTable.country }).from(orgsTable).where(eq(orgsTable.id, session.orgId));
  const defaultCountryCode = countryCodeByName(org?.country);

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title={t(locale, "New Client")} description={t(locale, "Add a client to bill and quote against.")} />
      <Card>
        <CardContent className="pt-6">
          <ClientForm locale={locale} action={createClientAction} submitLabel="Create Client" defaultCountryCode={defaultCountryCode} />
        </CardContent>
      </Card>
    </div>
  );
}
