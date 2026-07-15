import { Percent, Wallet, Info, Columns3, ChevronDown, type LucideIcon } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";

const PILL_ICONS: Record<string, LucideIcon> = { percent: Percent, wallet: Wallet, info: Info, columns: Columns3 };

// Matches the mockup's doc_pills() exactly: <div class="doc-pills-row"><div class="doc-pill-btn">...
export function DocPillsRow({ locale, pills }: { locale: Locale; pills: { icon: keyof typeof PILL_ICONS; label: string; value?: string }[] }) {
  return (
    <div className="doc-pills-row">
      {pills.map((p) => {
        const Icon = PILL_ICONS[p.icon];
        return (
          <div className="doc-pill-btn" key={p.label}>
            <Icon className="size-3.5" />
            <span>{t(locale, p.label)}</span>
            {p.value && <span className="dpb-val">{p.value}</span>}
            <ChevronDown className="size-3" style={{ color: "var(--ink-faint)" }} />
          </div>
        );
      })}
    </div>
  );
}
