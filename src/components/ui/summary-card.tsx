import type { LucideIcon } from "lucide-react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { Card, CardContent } from "./card";
import { cn } from "@/lib/utils";

// One KPI/stat-card implementation for the whole app — the dashboard, and every list page's
// stat row, render through this instead of each growing its own near-duplicate markup.
export function SummaryCard({
  label,
  value,
  icon: Icon,
  accent = "var(--brand-orange)",
  trendPct,
  trendUp,
  delay = 0,
  className,
}: {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  accent?: string;
  trendPct?: string;
  trendUp?: boolean;
  delay?: number;
  className?: string;
}) {
  return (
    <Card hoverable className={cn("animate-fade-up", className)} style={{ animationDelay: `${delay}s` }}>
      <CardContent className="pt-5">
        <div className="flex items-start gap-3">
          {Icon && (
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-[13px]"
              style={{ background: `${accent}18`, color: accent }}
            >
              <Icon className="size-[18px]" />
            </div>
          )}
          <div className="min-w-0">
            <div className="text-[11.5px] font-medium text-ink-muted">{label}</div>
            <div className="font-display font-extrabold text-xl mt-1 text-ink truncate">{value}</div>
          </div>
        </div>
        {trendPct && (
          <div
            className={cn(
              "inline-flex items-center gap-1 text-[11px] font-semibold mt-2.5",
              trendUp ? "text-success" : "text-danger",
            )}
          >
            {trendUp ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
            {trendPct}
            <span className="text-ink-faint font-normal">vs last month</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
