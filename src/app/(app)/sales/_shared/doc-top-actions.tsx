"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t, type Locale } from "@/lib/i18n/dict";
import { DocDirtyIndicator } from "./doc-dirty-indicator";

// Top titlebar actions shared by every creation page: Save as Draft and Print Preview, two
// separate always-visible buttons. No "More Actions" dropdown and no duplicated actions — the
// final submit lives in the bottom action bar. The preview modal itself is owned by the form
// (one instance, opened via onPreview) so the bottom action bar and this row share it.
// DEV-UI-01.6: approved Buttons; the Save as Draft pressed HERE shows the loading state (the same
// action in the bottom bar stays a plain disabled button); the transient "Unsaved changes" status.
export function DocTopActions({
  locale,
  busy,
  onSaveDraft,
  onPreview,
  dirty = false,
}: {
  locale: Locale;
  busy: boolean;
  onSaveDraft: () => void;
  onPreview: () => void;
  /** The form's useDirtyForm().dirty — drives the "Unsaved changes" indicator. */
  dirty?: boolean;
}) {
  const [pressed, setPressed] = useState(false);
  // A finished (or failed) save clears which button was pressed (state adjusted while rendering when
  // `busy` changes — React's pattern for state derived from a prop change).
  const [prevBusy, setPrevBusy] = useState(busy);
  if (busy !== prevBusy) {
    setPrevBusy(busy);
    if (!busy) setPressed(false);
  }
  return (
    <div className="doc-titlebar-actions">
      <DocDirtyIndicator locale={locale} dirty={dirty} />
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        loading={busy && pressed}
        onClick={() => {
          setPressed(true);
          onSaveDraft();
        }}
      >
        {t(locale, "Save as Draft")}
      </Button>
      <Button type="button" variant="secondary" onClick={onPreview}>
        <FileText className="size-3.5" aria-hidden /> {t(locale, "Preview")}
      </Button>
    </div>
  );
}
