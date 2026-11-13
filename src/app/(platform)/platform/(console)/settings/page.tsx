import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { describeUserAgent } from "@/components/platform/device";
import { pt, type PlatformStringKey } from "@/components/platform/i18n";
import { ConsolePage, DeniedState, Panel, PreviewBadge } from "@/components/platform/page-kit";
import { PlatformSecurityPanel, type SecurityView, type SessionView } from "@/components/platform/security-panel";
import { PlatformSettingsTabs } from "@/components/platform/settings-tabs";
import type { Locale } from "@/lib/i18n/dict";
import { getLocale } from "@/lib/i18n/server";
import { PLATFORM_SESSION_COOKIE } from "@/lib/platform/config";
import { securityOverviewCore, type SecurityOverview } from "@/lib/platform/console";
import { isPlatformError } from "@/lib/platform/errors";
import { requirePlatformSession } from "@/lib/platform/guards";

// Platform settings. Security is operational in PO-01B (sessions, sign-out, recovery codes on the
// PO-01A backend); Onboarding and Billing are locked previews with no invented values.
//
// Times are shown in Riyadh time (Asia/Riyadh), Gregorian calendar, Western digits, rendered on the
// server so the client never re-formats them (no hydration drift).

const FORMAT: Record<Locale, Intl.DateTimeFormat> = {
  en: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }),
  ar: new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }),
};

function toView(o: SecurityOverview, locale: Locale): SecurityView {
  const fmt = (d: Date) => FORMAT[locale].format(d);
  const device = (ua: string | null) => {
    const d = describeUserAgent(ua);
    return d ? pt(locale, "sec.deviceOn", { browser: d.browser, os: d.os }) : pt(locale, "sec.unknownDevice");
  };
  const session = (s: SecurityOverview["sessions"][number]): SessionView => ({
    id: s.id,
    createdAt: fmt(s.createdAt),
    lastSeenAt: fmt(s.lastSeenAt),
    expiresAt: fmt(s.expiresAt),
    ip: s.ipAddress,
    device: device(s.userAgent),
  });
  const currentRow = o.sessions.find((s) => s.current);
  return {
    mfaEnrolledAt: o.mfaEnrolledAt ? fmt(o.mfaEnrolledAt) : null,
    current: currentRow
      ? session(currentRow)
      : { id: o.current.sessionId, createdAt: fmt(o.current.createdAt), lastSeenAt: fmt(o.current.lastSeenAt), expiresAt: fmt(o.current.expiresAt), ip: null, device: device(null) },
    others: o.sessions.filter((s) => !s.current).map(session),
    recoveryCodesRemaining: o.recoveryCodesRemaining,
    policy: o.policy,
    timeZoneNote: pt(locale, "sec.timesNote"),
  };
}

function LockedRows({ locale, rows }: { locale: Locale; rows: { label: PlatformStringKey; value?: PlatformStringKey }[] }) {
  return (
    <dl className="platform-locked-rows">
      {rows.map((r) => (
        <div key={r.label} className="platform-locked-row">
          <dt>{pt(locale, r.label)}</dt>
          <dd>
            <span>{pt(locale, r.value ?? "common.notConfigured")}</span>
            <Lock className="size-3.5" aria-label={pt(locale, "common.locked")} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default async function PlatformSettingsPage() {
  await requirePlatformSession();
  const locale = await getLocale();
  const store = await cookies();

  // Data first, JSX after: a failure to load is decided here, rendering errors go to the boundary.
  let view: SecurityView | null = null;
  try {
    view = toView(await securityOverviewCore({ headers: await headers(), token: store.get(PLATFORM_SESSION_COOKIE)?.value ?? null }), locale);
  } catch (err) {
    if (isPlatformError(err, "UNAUTHORIZED") || isPlatformError(err, "SESSION_EXPIRED")) redirect("/platform/session-expired");
    // → the console error boundary (generic message + retry); no internal detail reaches the page.
    if (!isPlatformError(err, "FORBIDDEN")) throw err;
  }
  const security = view ? <PlatformSecurityPanel locale={locale} view={view} /> : <DeniedState locale={locale} />;

  const onboarding = (
    <Panel id="settings-onboarding" title={pt(locale, "settings.onboarding")} meta={<PreviewBadge locale={locale} phase="PO-02" />}>
      <LockedRows locale={locale} rows={[{ label: "onb.trial" }, { label: "onb.grace" }, { label: "onb.inviteOnly" }, { label: "onb.alerts" }]} />
      <p className="platform-fine-print mt-4">{pt(locale, "onb.note")}</p>
    </Panel>
  );
  const billing = (
    <Panel id="settings-billing" title={pt(locale, "settings.billing")} meta={<PreviewBadge locale={locale} phase="PO-05" />}>
      <LockedRows locale={locale} rows={[{ label: "bill.manual", value: "common.on" }, { label: "bill.currency", value: "bill.currencyValue" }]} />
      <p className="platform-fine-print mt-4">{pt(locale, "bill.note")}</p>
    </Panel>
  );

  return (
    <ConsolePage locale={locale} title={pt(locale, "nav.settings")} description={pt(locale, "settings.desc")}>
      <PlatformSettingsTabs locale={locale} security={security} onboarding={onboarding} billing={billing} />
    </ConsolePage>
  );
}
