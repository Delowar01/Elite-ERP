import { Activity, BadgeCheck, Building2, CalendarClock, ChartColumn, Clock, PieChart, ShieldOff, Timer, UserPlus, Users, Wallet } from "lucide-react";
import { pt } from "@/components/platform/i18n";
import { ConsolePage, EmptyPanel, Panel, PreviewAction, StatGrid, StatTile } from "@/components/platform/page-kit";
import { getLocale } from "@/lib/i18n/server";
import { requirePlatformSession } from "@/lib/platform/guards";

// Platform overview (PR #11 UI spec). PO-01B ships the layout only: no company, subscription or
// revenue data exists yet, so every tile reads "—" and every panel shows its empty state — no figure
// is invented. Company data arrives with PO-02.
export default async function PlatformDashboardPage() {
  await requirePlatformSession();
  const locale = await getLocale();
  return (
    <ConsolePage
      locale={locale}
      title={pt(locale, "dash.title")}
      description={pt(locale, "dash.desc")}
      phase="PO-02"
      actions={<PreviewAction locale={locale} label={pt(locale, "action.inviteCompany")} icon={UserPlus} phase="PO-02" />}
    >
      <StatGrid>
        <StatTile locale={locale} label={pt(locale, "dash.totalCompanies")} icon={Building2} />
        <StatTile locale={locale} label={pt(locale, "dash.activeAccess")} icon={BadgeCheck} />
        <StatTile locale={locale} label={pt(locale, "dash.paidPlans")} icon={Wallet} />
        <StatTile locale={locale} label={pt(locale, "dash.trials")} icon={Timer} />
        <StatTile locale={locale} label={pt(locale, "dash.suspended")} icon={ShieldOff} />
        <StatTile locale={locale} label={pt(locale, "dash.customerUsers")} icon={Users} />
        <StatTile locale={locale} label={pt(locale, "dash.expiring")} icon={CalendarClock} />
        <StatTile locale={locale} label={pt(locale, "dash.mrr")} icon={Wallet} note={pt(locale, "dash.mrrNote")} />
      </StatGrid>
      <div className="platform-panel-grid">
        <Panel id="dash-registrations" title={pt(locale, "dash.registrations")}>
          <EmptyPanel icon={ChartColumn} message={pt(locale, "common.noData")} hint={pt(locale, "dash.panelEmpty")} />
        </Panel>
        <Panel id="dash-package-mix" title={pt(locale, "dash.packageMix")}>
          <EmptyPanel icon={PieChart} message={pt(locale, "common.noData")} hint={pt(locale, "dash.panelEmpty")} />
        </Panel>
        <Panel id="dash-expirations" title={pt(locale, "dash.expirations")}>
          <EmptyPanel icon={Clock} message={pt(locale, "common.noData")} hint={pt(locale, "dash.panelEmpty")} />
        </Panel>
        <Panel id="dash-events" title={pt(locale, "dash.events")}>
          <EmptyPanel icon={Activity} message={pt(locale, "common.noData")} hint={pt(locale, "activity.emptyHint")} />
        </Panel>
      </div>
    </ConsolePage>
  );
}
