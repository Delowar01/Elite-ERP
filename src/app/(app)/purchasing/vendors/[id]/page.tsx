import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, vendorsTable, purchaseOrdersTable, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { getProfileByCountryName, resolveTaxLabels } from "@/lib/geo/country-profiles";
import { tenantScope } from "@/lib/tenant";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { VendorForm } from "../vendor-form";
import { updateVendorAction } from "../actions";
import { VendorRecordActions } from "../vendor-record-actions";
import { StatementView } from "../../../finance/statements/statement-view";
import { getStatement, presetRange } from "@/lib/statements";
import { Money } from "../../../sales/_shared/money";

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const { id } = await params;
  const vendorId = Number(id);
  if (!Number.isInteger(vendorId)) notFound();

  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(and(eq(vendorsTable.id, vendorId), tenantScope(session.orgId, vendorsTable, { includeArchived: true })))
    .limit(1);

  if (!vendor) notFound();

  const [org] = await db
    .select({ country: orgsTable.country, customTaxName: orgsTable.customTaxName, customTaxNumberLabel: orgsTable.customTaxNumberLabel, customRegistrationLabel: orgsTable.customRegistrationLabel })
    .from(orgsTable)
    .where(eq(orgsTable.id, session.orgId));
  const labels = resolveTaxLabels(getProfileByCountryName(org?.country), org);

  const pos = await db
    .select()
    .from(purchaseOrdersTable)
    .where(and(eq(purchaseOrdersTable.vendorId, vendorId), eq(purchaseOrdersTable.orgId, session.orgId)))
    .orderBy(purchaseOrdersTable.orderDate);

  const stmtRange = presetRange("this_year")!;
  const vendorStatement = await getStatement(session.orgId, "vendor", vendor.id, stmtRange);

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title={vendor.name}
        description={t(locale, "Vendor profile")}
        meta={
          <>
            <StatusBadge domain="active_flag" status={vendor.isActive ? "active" : "inactive"} locale={locale} />
            {vendor.recordState === "archived" && <StatusBadge domain="record_state" status="archived" locale={locale} />}
          </>
        }
        actions={<VendorRecordActions vendor={vendor} locale={locale} />}
      />

      {/* One column up to lg; from lg the form takes two thirds and the side card one. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardContent className="pt-6">
            <VendorForm vendor={vendor} action={updateVendorAction.bind(null, vendor.id)} submitLabel={t(locale, "Save changes")} taxNumberLabel={labels.taxNumberLabel} registrationLabel={labels.registrationLabel} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">{t(locale, "Purchase Orders")}</CardTitle>
          </CardHeader>
          <CardContent>
            {pos.length === 0 ? (
              <p className="text-xs text-ink-faint">{t(locale, "No purchase orders yet.")}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {pos.map((po) => (
                  <Link
                    key={po.id}
                    href={`/purchasing/orders/${po.id}`}
                    className="flex justify-between text-[13px] border-b border-line pb-2 last:border-0 hover:text-brand-orange"
                  >
                    <span className="font-mono">{po.poNumber}</span>
                    <span className="text-ink-muted"><Money amount={po.total} context="summary" /></span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Statement of account for this vendor — same component the central statement page uses. */}
      <div className="mt-6">
        <SectionHeader level={2} title={t(locale, "Statement of Account")} className="mb-4" />
        <StatementView locale={locale} kind="vendor" partyId={vendor.id} compact initial={vendorStatement} />
      </div>
    </div>
  );
}
