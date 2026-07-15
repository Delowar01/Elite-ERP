import { GitBranch, ChevronRight } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";

// Matches the mockup's document_relationships() exactly: <div class="doc-relationships">
// <div class="doc-rel-node[.current]">{label} · {sub}</div> chained by <span class="doc-rel-arrow">
export function DocRelationships({
  locale,
  nodes,
  currentLabel,
}: {
  locale: Locale;
  nodes: { label: string; sub?: string }[];
  currentLabel: string;
}) {
  return (
    <div className="doc-relationships">
      <GitBranch className="size-3.5" style={{ color: "var(--ink-faint)" }} />
      {nodes.map((n, i) => (
        <span key={n.label} className="flex items-center gap-2">
          {i > 0 && (
            <span className="doc-rel-arrow">
              <ChevronRight className="size-3.5 rtl:rotate-180" />
            </span>
          )}
          <div className={n.label === currentLabel ? "doc-rel-node current" : "doc-rel-node"}>
            {t(locale, n.label)}
            {n.sub && <span className="opacity-70 font-medium"> · {t(locale, n.sub)}</span>}
          </div>
        </span>
      ))}
    </div>
  );
}
