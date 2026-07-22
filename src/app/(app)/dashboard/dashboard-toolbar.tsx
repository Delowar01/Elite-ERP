"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calendar, ChevronDown, Check } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { t, type Locale } from "@/lib/i18n/dict";
import { DASHBOARD_RANGES, RANGE_LABELS, type DashboardRange } from "@/lib/dashboard-range";
import type { DashboardLayoutItem } from "@/lib/dashboard-layout";
import { setDashboardRangeAction } from "./dashboard-prefs-actions";
import { CustomizeLayoutDialog } from "./customize-layout-dialog";

// Dashboard toolbar: the date-range selector (drives every KPI/chart/activity server-side via
// ?range and persists the choice per user) plus the Customize Layout trigger.
export function DashboardToolbar({ locale, range, layout }: { locale: Locale; range: DashboardRange; layout: DashboardLayoutItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function pick(next: DashboardRange) {
    if (next === range) return;
    startTransition(async () => {
      await setDashboardRangeAction(next);
      router.push(`/dashboard?range=${next}`);
      router.refresh();
    });
  }

  return (
    <div className="dash-toolbar">
      <DropdownMenu>
        <DropdownMenuTrigger className="doc-pill-btn outline-none" disabled={pending}>
          <Calendar className="size-3.5" /> <span>{t(locale, RANGE_LABELS[range])}</span>
          <ChevronDown className="size-3" style={{ color: "var(--ink-faint)" }} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-48">
          {DASHBOARD_RANGES.map((r) => (
            <DropdownMenuItem key={r} className="cursor-pointer justify-between" onSelect={() => pick(r)}>
              {t(locale, RANGE_LABELS[r])}
              {r === range && <Check className="size-3.5 text-brand-orange" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="toolbar-actions-right">
        <CustomizeLayoutDialog locale={locale} layout={layout} />
      </div>
    </div>
  );
}
