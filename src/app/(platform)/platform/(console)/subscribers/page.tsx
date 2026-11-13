import { CalendarX, CirclePause, Download, Timer, Wallet } from "lucide-react";
import { pt } from "@/components/platform/i18n";
import { ConsolePage, PreviewAction, PreviewTable, PreviewToolbar, StatGrid, StatTile } from "@/components/platform/page-kit";
import { getLocale } from "@/lib/i18n/server";
import { requirePlatformSession } from "@/lib/platform/guards";

// Subscriptions and manual payment records (PO-05). Layout preview only — no amounts are shown.
export default async function PlatformSubscribersPage() {
  await requirePlatformSession();
  const locale = await getLocale();
  return (
    <ConsolePage
      locale={locale}
      title={pt(locale, "nav.subscribers")}
      description={pt(locale, "subs.desc")}
      phase="PO-05"
      actions={<PreviewAction locale={locale} label={pt(locale, "action.export")} icon={Download} phase="PO-05" />}
    >
      <StatGrid>
        <StatTile locale={locale} label={pt(locale, "subs.activePlans")} icon={Wallet} />
        <StatTile locale={locale} label={pt(locale, "subs.trials")} icon={Timer} />
        <StatTile locale={locale} label={pt(locale, "subs.expired")} icon={CalendarX} />
        <StatTile locale={locale} label={pt(locale, "subs.paused")} icon={CirclePause} />
      </StatGrid>
      <PreviewToolbar locale={locale} search={pt(locale, "subs.search")} filters={["filter.package", "filter.cycle", "filter.status", "filter.expiry"]} />
      <PreviewTable
        locale={locale}
        columns={["col.company", "col.plan", "col.cycle", "col.status", "col.price", "col.termEnd", "col.companyAccess"]}
        empty={pt(locale, "subs.empty")}
        hint={pt(locale, "subs.emptyHint")}
      />
    </ConsolePage>
  );
}
