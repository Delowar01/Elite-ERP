import { FileText, ChevronDown } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";

// Matches the mockup's doc_action_bar() exactly: <div class="doc-action-bar">
// <button class="btn btn-glass">Preview & Print</button>
// <button class="btn btn-glass" style="border-color:var(--success);color:var(--success);">Save as Draft</button>
// <button class="btn btn-primary">{primary_label} chevron</button></div>
export function DocActionBar({
  locale,
  pending,
  onSubmit,
  primaryLabel = "Save as Draft",
}: {
  locale: Locale;
  pending: boolean;
  onSubmit: () => void;
  primaryLabel?: string;
}) {
  return (
    <div className="doc-action-bar">
      <button type="button" className="btn btn-glass" disabled>
        <FileText className="size-3.5" /> {t(locale, "Preview & Print")}
      </button>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={onSubmit}>
        {pending ? t(locale, "Saving…") : t(locale, primaryLabel)} <ChevronDown className="size-3" />
      </button>
    </div>
  );
}
