"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
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
//
// DEV-UI-01.6: approved Buttons (Save as Draft = outline, Preview = secondary, final / Save Changes =
// primary — no hand-coloured "success" draft button). The button that was actually pressed shows the
// Button `loading` state (spinner + aria-busy); the others are disabled while busy. The bar wraps.
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
  const [pressed, setPressed] = useState<"draft" | "primary" | null>(null);
  // A finished (or failed) save clears which button was pressed (state adjusted while rendering when
  // `busy` changes — React's pattern for state derived from a prop change).
  const [prevBusy, setPrevBusy] = useState(busy);
  if (busy !== prevBusy) {
    setPrevBusy(busy);
    if (!busy) setPressed(null);
  }

  const previewButton = onPreview ? (
    <Button type="button" variant="secondary" onClick={onPreview}>
      <FileText className="size-3.5" aria-hidden /> {t(locale, "Preview")}
    </Button>
  ) : (
    <Button type="button" variant="secondary" disabled title={t(locale, "Save the document first to preview.")}>
      <FileText className="size-3.5" aria-hidden /> {t(locale, "Preview")}
    </Button>
  );

  if (editMode) {
    return (
      <div className="doc-action-bar">
        {previewButton}
        <Button
          type="button"
          disabled={busy}
          loading={busy && pressed === "primary"}
          onClick={() => {
            setPressed("primary");
            onPrimary();
          }}
        >
          {t(locale, "Save Changes")}
        </Button>
      </div>
    );
  }
  return (
    <div className="doc-action-bar">
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        loading={busy && pressed === "draft"}
        onClick={() => {
          setPressed("draft");
          onSaveDraft();
        }}
      >
        {t(locale, "Save as Draft")}
      </Button>
      {previewButton}
      <Button
        type="button"
        disabled={busy}
        loading={busy && pressed === "primary"}
        onClick={() => {
          setPressed("primary");
          onPrimary();
        }}
      >
        {t(locale, primaryLabel)}
      </Button>
    </div>
  );
}
