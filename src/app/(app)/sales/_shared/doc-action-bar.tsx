"use client";

import { FileText } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";

// The document action bar: Save as Draft / Print Preview / primary submit — three separate,
// always-visible buttons, in that order. No "More Actions" dropdown and no duplicated Save as
// Draft (it lives only in its own button here).
//
// - Save as Draft: saves the complete document with draft status.
// - Print Preview: opens the in-page preview modal (create) or the print view (edit, `printHref`).
//   On a brand-new document there's nothing to print yet, so it's disabled with a clear reason.
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
  printHref,
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
  /** When the document already exists, the print route to open; enables Print Preview. */
  printHref?: string;
  /** Create mode: opens the in-page preview modal built from the current unsaved form data. */
  onPreview?: () => void;
}) {
  const busy = pendingDraft || pendingPrimary;

  const previewButton = printHref ? (
    <a className="btn btn-glass" href={printHref} target="_blank" rel="noreferrer">
      <FileText className="size-3.5" /> {t(locale, "Print Preview")}
    </a>
  ) : onPreview ? (
    <button type="button" className="btn btn-glass" onClick={onPreview}>
      <FileText className="size-3.5" /> {t(locale, "Print Preview")}
    </button>
  ) : (
    <button type="button" className="btn btn-glass cursor-not-allowed" disabled title={t(locale, "Save the document first to preview & print.")}>
      <FileText className="size-3.5" /> {t(locale, "Print Preview")}
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
