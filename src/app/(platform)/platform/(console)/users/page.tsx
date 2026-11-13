import { Building2, UserCheck, UserMinus, UserPlus, Users } from "lucide-react";
import { pt } from "@/components/platform/i18n";
import { ConsolePage, PreviewAction, PreviewTable, PreviewToolbar, StatGrid, StatTile } from "@/components/platform/page-kit";
import { getLocale } from "@/lib/i18n/server";
import { requirePlatformSession } from "@/lib/platform/guards";

// Customer users across companies (PO-03). Layout preview only — no customer user is read.
export default async function PlatformUsersPage() {
  await requirePlatformSession();
  const locale = await getLocale();
  return (
    <ConsolePage
      locale={locale}
      title={pt(locale, "nav.users")}
      description={pt(locale, "users.desc")}
      phase="PO-03"
      actions={<PreviewAction locale={locale} label={pt(locale, "action.inviteUser")} icon={UserPlus} phase="PO-03" />}
    >
      <StatGrid>
        <StatTile locale={locale} label={pt(locale, "users.totalActive")} icon={UserCheck} />
        <StatTile locale={locale} label={pt(locale, "users.invited")} icon={Users} />
        <StatTile locale={locale} label={pt(locale, "users.disabled")} icon={UserMinus} />
        <StatTile locale={locale} label={pt(locale, "users.orgsWithUsers")} icon={Building2} />
      </StatGrid>
      <PreviewToolbar locale={locale} search={pt(locale, "users.search")} filters={["filter.company", "filter.role", "filter.status"]} />
      <PreviewTable
        locale={locale}
        columns={["col.user", "col.email", "col.company", "col.role", "col.accountState", "col.lastSignIn"]}
        empty={pt(locale, "users.empty")}
        hint={pt(locale, "users.emptyHint")}
      />
    </ConsolePage>
  );
}
