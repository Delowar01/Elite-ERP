"use client";

import { t, type Locale } from "@/lib/i18n/dict";

export function PrintToolbar({ locale, backHref }: { locale: Locale; backHref: string }) {
  return (
    <div className="print-toolbar">
      <a className="back" href={backHref}>
        ← {t(locale, "Back")}
      </a>
      <button type="button" onClick={() => window.print()}>
        {t(locale, "Print / Save as PDF")}
      </button>
    </div>
  );
}
