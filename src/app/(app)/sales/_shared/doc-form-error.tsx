"use client";

import { useEffect, useRef } from "react";
import { AlertCircle } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";

// DEV-UI-01.6: the document-level error region. A document editor's save returns one server message
// (the server owns validation — nothing is checked or re-worded here, and the message is not mapped
// to a field). When a save fails the form sets that message here: the region appears, is announced
// (role="alert"), and receives focus so keyboard and screen-reader users land on it. The message is
// shown through the dictionary — known server messages read in Arabic, anything else falls back to the
// server's own text. The form clears it at the start of the next save attempt.
export function DocFormError({ locale, error }: { locale: Locale; error: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);
  if (!error) return null;
  return (
    <div ref={ref} role="alert" aria-live="assertive" tabIndex={-1} className="doc-form-error" data-doc-form-error="">
      <AlertCircle className="size-4 shrink-0" aria-hidden />
      <div>
        <div className="doc-form-error-title">{t(locale, "The document was not saved.")}</div>
        <div className="doc-form-error-text">{t(locale, error)}</div>
      </div>
    </div>
  );
}
