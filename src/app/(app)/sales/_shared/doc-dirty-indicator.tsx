"use client";

import { t, type Locale } from "@/lib/i18n/dict";

// DEV-UI-01.6: the transient "Unsaved changes" status of a document editor. It reflects the form's
// existing useDirtyForm().dirty — nothing new is tracked or persisted, and there is no autosave and no
// "saved" state (a successful save redirects). The polite live region is always mounted so the change
// is announced; it is empty (and takes no space) while the document is clean.
export function DocDirtyIndicator({ locale, dirty }: { locale: Locale; dirty: boolean }) {
  return (
    <span role="status" aria-live="polite" className="doc-dirty-indicator" data-dirty={dirty || undefined}>
      {dirty ? t(locale, "Unsaved changes") : ""}
    </span>
  );
}
