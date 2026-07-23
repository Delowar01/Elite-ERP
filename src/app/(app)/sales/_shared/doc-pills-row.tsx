import Link from "next/link";
import { Percent, Wallet, Info, Columns3, ChevronDown, type LucideIcon } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";

const PILL_ICONS: Record<string, LucideIcon> = { percent: Percent, wallet: Wallet, info: Info, columns: Columns3 };

// Each config pill mirrors an org-level setting, so it now links to where that setting is
// actually configured instead of being a dead button. A pill with no settings home is clearly
// disabled with a reason.
const PILL_HREFS: Record<string, string> = {
  "VAT Settings": "/settings/organization?tab=vat-config",
  Currency: "/settings/organization?tab=business-details",
  "Number Format": "/settings/presets",
};

// Matches the mockup's doc_pills() exactly: <div class="doc-pills-row"><div class="doc-pill-btn">...
export function DocPillsRow({ locale, pills }: { locale: Locale; pills: { icon: keyof typeof PILL_ICONS; label: string; value?: string }[] }) {
  return (
    <div className="doc-pills-row">
      {pills.map((p) => {
        const Icon = PILL_ICONS[p.icon];
        const href = PILL_HREFS[p.label];
        const inner = (
          <>
            <Icon className="size-3.5" />
            <span>{t(locale, p.label)}</span>
            {p.value && <span className="dpb-val">{p.value}</span>}
            <ChevronDown className="size-3" style={{ color: "var(--ink-faint)" }} />
          </>
        );
        if (href) {
          return (
            <Link href={href} key={p.label} className="doc-pill-btn" title={t(locale, "Open settings")}>
              {inner}
            </Link>
          );
        }
        return (
          <span key={p.label} className="doc-pill-btn opacity-50 cursor-not-allowed" title={t(locale, "Not configurable yet")} aria-disabled>
            {inner}
          </span>
        );
      })}
    </div>
  );
}
