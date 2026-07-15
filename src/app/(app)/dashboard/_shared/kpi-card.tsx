import type { LucideIcon } from "lucide-react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { RiyalSymbol } from "@/components/ui/riyal-symbol";
import { t, type Locale } from "@/lib/i18n/dict";
import { Sparkline } from "./charts";

// Matches the mockup's kpi_card_v4() exactly: <div class="card hoverable kpi-card-v4">
// <div class="top"><div class="kpi-chip">...<div class="kpi-label">...<div class="kpi-value-row">...
// <div class="kpi-trend">...<div class="kpi-spark">...
export function KpiCard({
  locale,
  label,
  value,
  isCurrency,
  trendPct,
  trendUp,
  icon: Icon,
  accent,
  sparkValues,
}: {
  locale: Locale;
  label: string;
  value: string;
  isCurrency?: boolean;
  trendPct: string;
  trendUp: boolean;
  icon: LucideIcon;
  accent: string;
  sparkValues: number[];
}) {
  return (
    <div className="card kpi-card-v4">
      <div className="top">
        <div className="kpi-chip" style={{ background: `${accent}18`, color: accent }}>
          <Icon className="size-5" />
        </div>
        <div>
          <div className="kpi-label">{t(locale, label)}</div>
          <span className="kpi-value-row">
            {isCurrency && (
              <span className="kpi-currency-icon">
                <RiyalSymbol />
              </span>
            )}
            <span className="kpi-value">{value}</span>
          </span>
        </div>
      </div>
      <div className={`kpi-trend ${trendUp ? "up" : "down"}`}>
        {trendUp ? <ArrowUp className="size-2.5" style={{ color: "var(--accent-green)" }} /> : <ArrowDown className="size-2.5" style={{ color: "var(--accent-red)" }} />}
        {trendPct} <span className="muted">{t(locale, "vs Last Month")}</span>
      </div>
      <div className="kpi-spark">
        <Sparkline values={sparkValues} color={accent} />
      </div>
    </div>
  );
}
