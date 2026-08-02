"use client";

import { t, type Locale } from "@/lib/i18n/dict";

// The /print/[type]/[id] page is rendered headlessly by the PDF generator (see lib/pdf/document-pdf)
// and is not linked from anywhere in the UI. This toolbar is hidden in the printed/PDF output via
// @media print; it only offers a way back for anyone who lands on the page directly. There is no
// browser Print action anywhere in the app — documents are obtained via "Download PDF".
export function PrintToolbar({ locale, backHref }: { locale: Locale; backHref: string }) {
  return (
    <div className="print-toolbar">
      <a className="back" href={backHref}>
        ← {t(locale, "Back")}
      </a>
    </div>
  );
}
