import { Percent, Wallet, Info, Columns3, ChevronDown, type LucideIcon } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Org } from "@/db";
import { PillSettingsDialog } from "./pill-settings-dialog";
import { NumberFormatPillDialog } from "./number-format-pill-dialog";

const PILL_ICONS: Record<string, LucideIcon> = { percent: Percent, wallet: Wallet, info: Info, columns: Columns3 };

// Each config pill mirrors an org-level setting. Per the creation-page rule it must not redirect:
// clicking opens an in-page popup. The Number Format pill opens the FULL editable form in-place
// (see NumberFormatPillDialog); the remaining pills show the current value with a link to their full
// settings screen. A pill with no settings home is clearly disabled with a reason.
const PILL_SETTINGS: Record<string, { href: string; description: string }> = {
  "VAT Settings": { href: "/settings/organization?tab=vat-config", description: "VAT is applied at your organization's configured rate." },
  Currency: { href: "/settings/organization?tab=business-details", description: "Documents use your organization's base currency." },
};

// Matches the mockup's doc_pills() exactly: <div class="doc-pills-row"><div class="doc-pill-btn">...
// `trailing` renders extra controls inline after the pills (e.g. the Edit Columns dialog trigger).
// `org` is required for the Number Format pill, which edits the org's format directly in the popup.
export function DocPillsRow({
  locale,
  pills,
  org,
  trailing,
}: {
  locale: Locale;
  pills: { icon: keyof typeof PILL_ICONS; label: string; value?: string }[];
  org?: Org;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="doc-pills-row">
      {pills.map((p) => {
        const Icon = PILL_ICONS[p.icon];
        const settings = PILL_SETTINGS[p.label];
        const inner = (
          <>
            <Icon className="size-3.5" />
            <span>{t(locale, p.label)}</span>
            {p.value && <span className="dpb-val">{p.value}</span>}
            <ChevronDown className="size-3" style={{ color: "var(--ink-faint)" }} />
          </>
        );
        const triggerBtn = (
          <button type="button" className="doc-pill-btn" title={t(locale, "Open settings")}>
            {inner}
          </button>
        );
        // Number Format opens the full editable form in-place (no redirect).
        if (p.label === "Number Format" && org) {
          return <NumberFormatPillDialog key={p.label} locale={locale} org={org} trigger={triggerBtn} />;
        }
        if (settings) {
          return (
            <PillSettingsDialog
              key={p.label}
              locale={locale}
              label={p.label}
              description={settings.description}
              value={p.value}
              fullSettingsHref={settings.href}
              trigger={triggerBtn}
            />
          );
        }
        return (
          <span key={p.label} className="doc-pill-btn opacity-50 cursor-not-allowed" title={t(locale, "Not configurable yet")} aria-disabled>
            {inner}
          </span>
        );
      })}
      {trailing}
    </div>
  );
}
