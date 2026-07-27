import { eq } from "drizzle-orm";
import { db, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getProfileByCountryName, resolveTaxLabels } from "@/lib/geo/country-profiles";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { VendorForm } from "../vendor-form";
import { createVendorAction } from "../actions";

export default async function NewVendorPage() {
  const session = await requireSession();
  const [org] = await db
    .select({ country: orgsTable.country, customTaxName: orgsTable.customTaxName, customTaxNumberLabel: orgsTable.customTaxNumberLabel, customRegistrationLabel: orgsTable.customRegistrationLabel })
    .from(orgsTable)
    .where(eq(orgsTable.id, session.orgId));
  const labels = resolveTaxLabels(getProfileByCountryName(org?.country), org);

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title="New Vendor" description="Add a vendor to order and receive against." />
      <Card>
        <CardContent className="pt-6">
          <VendorForm action={createVendorAction} submitLabel="Create Vendor" taxNumberLabel={labels.taxNumberLabel} registrationLabel={labels.registrationLabel} />
        </CardContent>
      </Card>
    </div>
  );
}
