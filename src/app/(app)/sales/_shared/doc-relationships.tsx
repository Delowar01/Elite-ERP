import { GitBranch, ChevronRight } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";

export function DocRelationships({
  locale,
  nodes,
}: {
  locale: Locale;
  nodes: { label: string; sub?: string; current?: boolean }[];
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap mb-4 px-3.5 py-3 rounded-[13px] bg-canvas border border-line">
      <GitBranch className="size-3.5 text-ink-faint shrink-0" />
      {nodes.map((n, i) => (
        <div key={i} className="flex items-center gap-2">
          {i > 0 && <ChevronRight className="size-3.5 text-ink-faint shrink-0 rtl:rotate-180" />}
          <div
            className={
              n.current
                ? "flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[11.5px] font-semibold bg-brand-navy text-white border border-brand-navy"
                : "flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[11.5px] font-semibold bg-surface border border-line-strong text-ink"
            }
          >
            {t(locale, n.label)}
            {n.sub && <span className="opacity-70 font-medium"> · {n.sub}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
