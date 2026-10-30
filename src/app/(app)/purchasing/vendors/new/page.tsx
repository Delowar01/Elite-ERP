import { eq } from "drizzle-orm";
import { db, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { getProfileByCountryName, resolveTaxLabels } from "@/lib/geo/country-profiles";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { VendorForm } from "../vendor-form";
import { createVendorAction } from "../actions";

export default async function NewVendorPage() {
  const session = await requireSession();
  const locale = await getLocale();
  const [org] = await db
    .select({ country: orgsTable.country, customTaxName: orgsTable.customTaxName, customTaxNumberLabel: orgsTable.customTaxNumberLabel, customRegistrationLabel: orgsTable.customRegistrationLabel })
    .from(orgsTable)
    .where(eq(orgsTable.id, session.orgId));
  const labels = resolveTaxLabels(getProfileByCountryName(org?.country), org);

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title={t(locale, "New Vendor")} description={t(locale, "Add a vendor to order and receive against.")} />
      <Card>
        <CardContent className="pt-6">
          <VendorForm action={createVendorAction} submitLabel={t(locale, "Create Vendor")} taxNumberLabel={labels.taxNumberLabel} registrationLabel={labels.registrationLabel} />
        </CardContent>
      </Card>
    </div>
  );
}
