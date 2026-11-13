import { pt } from "@/components/platform/i18n";
import { ConsolePage, PreviewTable, PreviewToolbar } from "@/components/platform/page-kit";
import { getLocale } from "@/lib/i18n/server";
import { requirePlatformSession } from "@/lib/platform/guards";

// Activity log (PO-06 adds the viewer). Platform security events are already written to the
// append-only platform audit table by PO-01A; this page shows the history layout without reading it.
export default async function PlatformActivityPage() {
  await requirePlatformSession();
  const locale = await getLocale();
  return (
    <ConsolePage locale={locale} title={pt(locale, "nav.activity")} description={pt(locale, "activity.desc")} phase="PO-06">
      <PreviewToolbar locale={locale} search={pt(locale, "col.eventId")} filters={["filter.dateRange", "filter.actor", "filter.eventType", "filter.result"]} />
      <PreviewTable
        locale={locale}
        columns={["col.time", "col.actor", "col.action", "col.target", "col.reason", "col.result", "col.eventId"]}
        empty={pt(locale, "activity.empty")}
        hint={pt(locale, "activity.emptyHint")}
      />
    </ConsolePage>
  );
}
