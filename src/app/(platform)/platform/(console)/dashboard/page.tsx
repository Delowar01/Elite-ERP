import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, BadgeCheck, Building2, CalendarClock, Clock, PieChart, ShieldOff, Timer, UserPlus, Users, Wallet } from "lucide-react";
import { Ltr, MetricTile, RegistrationsChart } from "@/components/platform/companies-kit";
import { pt } from "@/components/platform/i18n";
import { ConsolePage, DeniedState, EmptyPanel, Panel, PreviewAction, PreviewBadge, StatGrid, StatTile } from "@/components/platform/page-kit";
import { getLocale } from "@/lib/i18n/server";
import { companyMetrics, REGISTRATION_MONTHS, type CompanyMetrics } from "@/lib/platform/companies";
import { PLATFORM_SESSION_COOKIE } from "@/lib/platform/config";
import { formatPlatformCount, formatPlatformDate, formatPlatformMonth } from "@/lib/platform/display";
import { isPlatformError } from "@/lib/platform/errors";
import { requirePlatformSession } from "@/lib/platform/guards";

// Platform overview (PR #11 UI spec UI-01). PO-02B makes the COMPANY indicators real — totals by
// effective access, customer users, monthly registrations and the newest companies — from the
// allow-listed read model (src/lib/platform/companies.ts). Commercial indicators (paid plans,
// trials, expirations, estimated MRR, package mix) have no data source yet: they stay previews
// that read "—" with their phase named. No figure is invented, and no tenant financial table is read.
export default async function PlatformDashboardPage() {
  await requirePlatformSession();
  const [locale, store, requestHeaders] = await Promise.all([getLocale(), cookies(), headers()]);

  let metrics: CompanyMetrics | null = null;
  try {
    metrics = await companyMetrics({ headers: requestHeaders, token: store.get(PLATFORM_SESSION_COOKIE)?.value ?? null });
  } catch (err) {
    if (isPlatformError(err, "UNAUTHORIZED") || isPlatformError(err, "SESSION_EXPIRED")) redirect("/platform/session-expired");
    if (!isPlatformError(err, "FORBIDDEN")) throw err; // → the console error boundary
  }

  const header = {
    locale,
    title: pt(locale, "dash.title"),
    description: pt(locale, "dash.desc"),
    actions: <PreviewAction locale={locale} label={pt(locale, "action.inviteCompany")} icon={UserPlus} phase="PO-02D" />,
  };
  if (!metrics) {
    return (
      <ConsolePage {...header}>
        <DeniedState locale={locale} />
      </ConsolePage>
    );
  }

  const m = metrics;
  const count = formatPlatformCount;
  const months = m.registrations.map((r) => {
    const label = formatPlatformMonth(r.month, locale);
    return { key: r.month, label, count: r.count, countText: count(r.count), description: pt(locale, "dash.monthCount", { month: label, n: count(r.count) }) };
  });

  return (
    <ConsolePage {...header}>
      <StatGrid>
        <MetricTile label={pt(locale, "dash.totalCompanies")} value={count(m.companies.total)} icon={Building2} href="/platform/companies" note={pt(locale, "metric.newNote", { n: count(m.companies.registeredLast30Days) })} />
        <MetricTile
          label={pt(locale, "dash.activeAccess")}
          value={count(m.companies.active)}
          icon={BadgeCheck}
          href="/platform/companies?access=active"
          note={m.companies.legacyDefault ? pt(locale, "metric.legacyNote", { n: count(m.companies.legacyDefault) }) : undefined}
        />
        <StatTile locale={locale} label={pt(locale, "dash.paidPlans")} icon={Wallet} note={pt(locale, "common.phase", { phase: "PO-05" })} />
        <StatTile locale={locale} label={pt(locale, "dash.trials")} icon={Timer} note={pt(locale, "common.phase", { phase: "PO-05" })} />
        <MetricTile label={pt(locale, "dash.suspended")} value={count(m.companies.suspended)} icon={ShieldOff} href="/platform/companies?access=suspended" note={pt(locale, "metric.suspendedNote")} />
        <MetricTile label={pt(locale, "dash.customerUsers")} value={count(m.users.total)} icon={Users} note={pt(locale, "companies.usersActive", { n: count(m.users.active) })} />
        <StatTile locale={locale} label={pt(locale, "dash.expiring")} icon={CalendarClock} note={pt(locale, "common.phase", { phase: "PO-05" })} />
        <StatTile locale={locale} label={pt(locale, "dash.mrr")} icon={Wallet} note={pt(locale, "dash.mrrNote")} />
      </StatGrid>
      <div className="platform-panel-grid">
        <Panel id="dash-registrations" title={pt(locale, "dash.registrations")}>
          {m.companies.total === 0 ? (
            <EmptyPanel icon={Building2} message={pt(locale, "dash.noCompanies")} hint={pt(locale, "inv.emptyHint")} />
          ) : (
            <div className="platform-settings-stack">
              <p className="platform-fine-print">{pt(locale, "dash.registrationsSummary", { n: REGISTRATION_MONTHS })}</p>
              <RegistrationsChart months={months} label={pt(locale, "dash.registrationsSummary", { n: REGISTRATION_MONTHS })} />
              <p className="platform-fine-print">{pt(locale, "dash.currentMonthNote")}</p>
              <div>
                <h3 className="platform-subhead">{pt(locale, "dash.newest")}</h3>
                <ul className="platform-newest">
                  {m.newest.map((org) => (
                    <li key={org.orgId}>
                      <Link href={`/platform/companies/${org.orgId}`} className="platform-company-link" dir="auto">
                        {org.name}
                      </Link>
                      <span className="platform-cell-sub">
                        <Ltr>{org.reference}</Ltr> · {formatPlatformDate(org.createdAt, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link href="/platform/companies" className="platform-inline-link">
                  {pt(locale, "dash.viewAll")}
                </Link>
              </div>
            </div>
          )}
        </Panel>
        <Panel id="dash-package-mix" title={pt(locale, "dash.packageMix")} meta={<PreviewBadge locale={locale} phase="PO-04" />}>
          <EmptyPanel icon={PieChart} message={pt(locale, "common.noData")} hint={pt(locale, "dash.packageMixEmpty")} />
        </Panel>
        <Panel id="dash-expirations" title={pt(locale, "dash.expirations")} meta={<PreviewBadge locale={locale} phase="PO-05" />}>
          <EmptyPanel icon={Clock} message={pt(locale, "common.noData")} hint={pt(locale, "dash.expirationsEmpty")} />
        </Panel>
        <Panel id="dash-events" title={pt(locale, "dash.events")} meta={<PreviewBadge locale={locale} phase="PO-06" />}>
          <EmptyPanel icon={Activity} message={pt(locale, "common.noData")} hint={pt(locale, "activity.emptyHint")} />
        </Panel>
      </div>
    </ConsolePage>
  );
}
