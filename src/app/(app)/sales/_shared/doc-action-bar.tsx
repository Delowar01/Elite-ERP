"use client";

import { FileText, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { t, type Locale } from "@/lib/i18n/dict";

// Matches the mockup's doc_action_bar(): Preview & Print / Save as Draft / primary.
//
// - Preview & Print: opens the real print view when the document exists (edit mode, `printHref`).
//   On a brand-new document there's nothing to print yet, so it's disabled with a clear reason.
// - Primary: the split button — the main click creates the document AND performs the real next
//   transition (send/confirm/issue/dispatch); the chevron opens a "More Actions" menu with the
//   alternative "Save as Draft" path, so the chevron is functional rather than decorative.
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
  /** When the document already exists, the print route to open; enables Preview & Print. */
  printHref?: string;
  /** Create mode: opens the in-page preview modal built from the current unsaved form data. */
  onPreview?: () => void;
}) {
  const busy = pendingDraft || pendingPrimary;

  const previewButton = printHref ? (
    <a className="btn btn-glass" href={printHref} target="_blank" rel="noreferrer">
      <FileText className="size-3.5" /> {t(locale, "Preview & Print")}
    </a>
  ) : onPreview ? (
    <button type="button" className="btn btn-glass" onClick={onPreview}>
      <FileText className="size-3.5" /> {t(locale, "Preview & Print")}
    </button>
  ) : (
    <button type="button" className="btn btn-glass cursor-not-allowed" disabled title={t(locale, "Save the document first to preview & print.")}>
      <FileText className="size-3.5" /> {t(locale, "Preview & Print")}
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
      {previewButton}
      <button
        type="button"
        className="btn btn-glass"
        style={{ borderColor: "var(--success)", color: "var(--success)" }}
        disabled={busy}
        onClick={onSaveDraft}
      >
        {pendingDraft ? t(locale, "Saving…") : t(locale, "Save as Draft")}
      </button>
      <div className="btn-split inline-flex">
        <button type="button" className="btn btn-primary" style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }} disabled={busy} onClick={onPrimary}>
          {pendingPrimary ? t(locale, "Saving…") : t(locale, primaryLabel)}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="btn btn-primary outline-none"
            style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderInlineStart: "1px solid rgba(255,255,255,0.25)", paddingInline: 8, minWidth: 0 }}
            disabled={busy}
            aria-label={t(locale, "More Actions")}
            title={t(locale, "More Actions")}
          >
            <ChevronDown className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="cursor-pointer" onSelect={onSaveDraft} disabled={busy}>
              {t(locale, "Save as Draft")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
