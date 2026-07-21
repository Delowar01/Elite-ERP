import { FileText, ChevronDown } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";

// Matches the mockup's doc_action_bar() exactly: <div class="doc-action-bar">
// <button class="btn btn-glass">Preview & Print</button>
// <button class="btn btn-glass" style="border-color:var(--success);color:var(--success);">Save as Draft</button>
// <button class="btn btn-primary">{primary_label} chevron</button></div>
//
// The primary button is honest about what it does: it creates the document AND
// immediately performs the real next transition (send/confirm/issue/dispatch —
// whichever server action the detail page's own status-change button already
// calls), so a label like "Send to Client" never lies about the outcome.
export function DocActionBar({
  locale,
  pendingDraft,
  pendingPrimary,
  onSaveDraft,
  onPrimary,
  primaryLabel = "Save as Draft",
  editMode = false,
}: {
  locale: Locale;
  pendingDraft: boolean;
  pendingPrimary: boolean;
  onSaveDraft: () => void;
  onPrimary: () => void;
  primaryLabel?: string;
  /** Edit mode (Batch A2): a single "Save Changes" button — no create/send split. */
  editMode?: boolean;
}) {
  const busy = pendingDraft || pendingPrimary;
  if (editMode) {
    return (
      <div className="doc-action-bar">
        <button type="button" className="btn btn-glass" disabled>
          <FileText className="size-3.5" /> {t(locale, "Preview & Print")}
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onPrimary}>
          {pendingPrimary ? t(locale, "Saving…") : t(locale, "Save Changes")}
        </button>
      </div>
    );
  }
  return (
    <div className="doc-action-bar">
      <button type="button" className="btn btn-glass" disabled>
        <FileText className="size-3.5" /> {t(locale, "Preview & Print")}
      </button>
      <button
        type="button"
        className="btn btn-glass"
        style={{ borderColor: "var(--success)", color: "var(--success)" }}
        disabled={busy}
        onClick={onSaveDraft}
      >
        {pendingDraft ? t(locale, "Saving…") : t(locale, "Save as Draft")}
      </button>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={onPrimary}>
        {pendingPrimary ? t(locale, "Saving…") : t(locale, primaryLabel)} <ChevronDown className="size-3" />
      </button>
    </div>
  );
}
