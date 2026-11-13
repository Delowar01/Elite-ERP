import { UserPlus } from "lucide-react";
import { pt } from "@/components/platform/i18n";
import { ConsolePage, PreviewAction, PreviewTable, PreviewToolbar } from "@/components/platform/page-kit";
import { getLocale } from "@/lib/i18n/server";
import { requirePlatformSession } from "@/lib/platform/guards";

// Companies (PO-02 builds the data, invitations and access controls). Layout preview only.
export default async function PlatformCompaniesPage() {
  await requirePlatformSession();
  const locale = await getLocale();
  return (
    <ConsolePage
      locale={locale}
      title={pt(locale, "nav.companies")}
      description={pt(locale, "companies.desc")}
      phase="PO-02"
      actions={<PreviewAction locale={locale} label={pt(locale, "action.inviteCompany")} icon={UserPlus} phase="PO-02" />}
    >
      <div className="platform-segments" role="group" aria-label={pt(locale, "nav.companies")}>
        <span className="platform-segment" aria-current="true">{pt(locale, "companies.registered")}</span>
        <span className="platform-segment" aria-disabled="true">{pt(locale, "companies.pending")}</span>
      </div>
      <PreviewToolbar locale={locale} search={pt(locale, "companies.search")} filters={["filter.access", "filter.package", "filter.country"]} />
      <PreviewTable
        locale={locale}
        columns={["col.company", "col.owner", "col.package", "col.subscription", "col.access", "col.users", "col.renewal"]}
        empty={pt(locale, "companies.empty")}
        hint={pt(locale, "companies.emptyHint")}
      />
    </ConsolePage>
  );
}
