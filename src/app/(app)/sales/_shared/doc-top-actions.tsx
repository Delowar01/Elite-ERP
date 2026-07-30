"use client";

import { FileText } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";

// Top titlebar actions shared by every creation page: Save as Draft and Print Preview, two
// separate always-visible buttons. No "More Actions" dropdown and no duplicated actions — the
// final submit lives in the bottom action bar. The preview modal itself is owned by the form
// (one instance, opened via onPreview) so the bottom action bar and this row share it.
export function DocTopActions({ locale, busy, onSaveDraft, onPreview }: { locale: Locale; busy: boolean; onSaveDraft: () => void; onPreview: () => void }) {
  return (
    <div className="doc-titlebar-actions">
      <button type="button" className="btn btn-glass" disabled={busy} onClick={onSaveDraft}>
        {t(locale, "Save as Draft")}
      </button>
      <button type="button" className="btn btn-glass" onClick={onPreview}>
        <FileText className="size-3.5" /> {t(locale, "Print Preview")}
      </button>
    </div>
  );
}
