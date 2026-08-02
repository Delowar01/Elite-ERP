"use client";

import { FileText } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";

// The document action bar: Save as Draft / Preview / primary submit — three separate,
// always-visible buttons, in that order. No "More Actions" dropdown and no duplicated Save as
// Draft (it lives only in its own button here).
//
// - Save as Draft: saves the complete document with draft status.
// - Preview: opens the in-page preview modal built from the current form data. It never navigates
//   to a print page and contains no Print button — downloading is done via the "Download PDF"
//   action on the document's detail page (Issue #10).
// - Primary: performs the document's real final action (send/confirm/issue/dispatch). `busy`
//   disables every button while a save is in flight, preventing duplicate submission.
export function DocActionBar({
  locale,
  pendingDraft,
  pendingPrimary,
  onSaveDraft,
  onPrimary,
  primaryLabel = "Save as Draft",
  editMode = false,
  onPreview,
}: {
  locale: Locale;
  pendingDraft: boolean;
  pendingPrimary: boolean;
  onSaveDraft: () => void;
  onPrimary: () => void;
  primaryLabel?: string;
  /** Edit mode (Batch A2): a single "Save Changes" button — no create/send split. */
  editMode?: boolean;
  /** Opens the in-page preview modal built from the current form data. */
  onPreview?: () => void;
}) {
  const busy = pendingDraft || pendingPrimary;

  const previewButton = onPreview ? (
    <button type="button" className="btn btn-glass" onClick={onPreview}>
      <FileText className="size-3.5" /> {t(locale, "Preview")}
    </button>
  ) : (
    <button type="button" className="btn btn-glass cursor-not-allowed" disabled title={t(locale, "Save the document first to preview.")}>
      <FileText className="size-3.5" /> {t(locale, "Preview")}
    </button>
  );

  if (editMode) {
    return (
      <div className="doc-action-bar">
        {previewButton}
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onPrimary}>
          {pendingPrimary ? t(locale, "Saving…") : t(locale, "Save Changes")}
        </button>
      </div>
    );
  }
  return (
    <div className="doc-action-bar">
      <button
        type="button"
        className="btn btn-glass"
        style={{ borderColor: "var(--success)", color: "var(--success)" }}
        disabled={busy}
        onClick={onSaveDraft}
      >
        {pendingDraft ? t(locale, "Saving…") : t(locale, "Save as Draft")}
      </button>
      {previewButton}
      <button type="button" className="btn btn-primary" disabled={busy} onClick={onPrimary}>
        {pendingPrimary ? t(locale, "Saving…") : t(locale, primaryLabel)}
      </button>
    </div>
  );
}
