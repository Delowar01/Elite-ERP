import { t, type Locale } from "@/lib/i18n/dict";
import type { DocumentTerm } from "./document-terms";

// Read-only render of a document's final Terms & Conditions — one continuously-numbered list, in the
// exact saved order. Shared by the preview/print modal and every document detail page (and therefore
// browser print + print-to-PDF), so numbering and document-specific edits render identically.
export function DocumentTermsView({
  locale,
  terms,
  className,
}: {
  locale: Locale;
  terms?: DocumentTerm[] | null;
  className?: string;
}) {
  const list = (terms ?? []).filter((x) => x && typeof x.text === "string" && x.text.trim());
  if (list.length === 0) return null;
  return (
    <div className={className}>
      <div className="text-[12px] font-bold mb-1.5">{t(locale, "Terms & Conditions")}</div>
      <ol className="flex flex-col gap-1">
        {list.map((tm, i) => (
          <li key={i} className="text-[12px] flex gap-2">
            <span className="opacity-60 shrink-0">{i + 1}.</span>
            {/* pre-wrap preserves multiline term text; single-line terms render unchanged. */}
            <span className="whitespace-pre-wrap">{tm.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
