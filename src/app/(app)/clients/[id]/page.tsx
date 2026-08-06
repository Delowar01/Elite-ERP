import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, customersTable, salesInvoicesTable, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { tenantScope } from "@/lib/tenant";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { composeAddress, countryCodeByName } from "@/lib/geo/countries";
import { getCountryProfile, resolveTaxLabels } from "@/lib/geo/country-profiles";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClientForm } from "../client-form";
import { updateClientAction } from "../actions";
import { ClientRecordActions } from "../client-record-actions";
import { StatementView } from "../../finance/statements/statement-view";
import { getStatement, presetRange } from "@/lib/statements";
import { Money } from "../../sales/_shared/money";

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const { id } = await params;
  const clientId = Number(id);
  if (!Number.isInteger(clientId)) notFound();

  const [client] = await db
    .select()
    .from(customersTable)
    .where(and(eq(customersTable.id, clientId), tenantScope(session.orgId, customersTable, { includeArchived: true })))
    .limit(1);

  if (!client) notFound();

  const [org] = await db
    .select({ country: orgsTable.country, customTaxName: orgsTable.customTaxName, customTaxNumberLabel: orgsTable.customTaxNumberLabel, customRegistrationLabel: orgsTable.customRegistrationLabel })
    .from(orgsTable)
    .where(eq(orgsTable.id, session.orgId));
  // The Details card labels follow THIS client's country (falling back to the org's country only when
  // the client has none). The edit form does the same, using taxOverrides for Global-profile clients.
  const taxLabels = resolveTaxLabels(getCountryProfile(client.countryCode || countryCodeByName(org?.country)), org);

  const invoices = await db
    .select()
    .from(salesInvoicesTable)
    .where(and(eq(salesInvoicesTable.customerId, clientId), eq(salesInvoicesTable.orgId, session.orgId)))
    .orderBy(salesInvoicesTable.issueDate);

  const stmtRange = presetRange("this_year")!;
  const clientStatement = await getStatement(session.orgId, "client", client.id, stmtRange);

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title={client.name}
        description="Client profile"
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={client.isActive ? "success" : "neutral"}>{client.isActive ? "Active" : "Inactive"}</Badge>
            {client.recordState === "archived" && <Badge variant="neutral">Archived</Badge>}
            <ClientRecordActions client={client} />
          </div>
        }
      />

      <div className="grid grid-cols-3 gap-5">
        <Card className="col-span-2">
          <CardContent className="pt-6">
            <ClientForm locale={locale} client={client} action={updateClientAction.bind(null, client.id)} submitLabel="Save changes" taxOverrides={org} />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>{t(locale, "Details")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-[13px]">
            <div className="flex justify-between"><span className="text-ink-faint">{t(locale, "Client Type")}</span><span>{t(locale, client.clientType === "company" ? "Company" : "Individual")}</span></div>
            {composeAddress(client) && <div className="text-ink-muted">{composeAddress(client)}</div>}
            {client.vatNumber && <div className="flex justify-between"><span className="text-ink-faint">{t(locale, taxLabels.taxNumberLabel)}</span><span className="font-mono">{client.vatNumber}</span></div>}
            {client.taxId && <div className="flex justify-between"><span className="text-ink-faint">{t(locale, taxLabels.registrationLabel)}</span><span className="font-mono">{client.taxId}</span></div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t(locale, "Invoices")}</CardTitle>
          </CardHeader>
          <CardContent>
            {invoices.length === 0 ? (
              <p className="text-xs text-ink-faint">No invoices yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {invoices.map((inv) => (
                  <div key={inv.id} className="flex justify-between text-[13px] border-b border-line pb-2 last:border-0">
                    <span className="font-mono">{inv.invoiceNumber}</span>
                    <span className="text-ink-muted"><Money amount={inv.total} context="summary" /></span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        </div>
      </div>

      {/* Statement of account for this client — same component the central statement page uses. */}
      <div className="mt-6">
        <div className="main-head"><h3>{t(locale, "Statement of Account")}</h3></div>
        <StatementView locale={locale} kind="client" partyId={client.id} compact initial={clientStatement} />
      </div>
    </div>
  );
}
