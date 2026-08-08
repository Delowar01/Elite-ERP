import Link from "next/link";
import { Plus } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";

/**
 * What a document list shows when it has no rows.
 *
 * Five of the eight lists previously rendered a header row over nothing, which reads as a broken
 * table rather than an empty one — and it was also what a loading placeholder handed off to. The
 * card matches the three lists that already had an empty state; the create action is new to all
 * eight, because an empty list is the best place in the app to offer it.
 */
export function ListEmptyState({
  locale,
  message,
  hint,
  createHref,
  createLabel,
}: {
  locale: Locale;
  /** Already-translated primary line, e.g. "No quotations yet." */
  message: string;
  /** Already-translated secondary line, for types that are normally raised against a source document. */
  hint?: string;
  createHref: string;
  /** Already-translated button label, e.g. "New Quotation". */
  createLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface shadow-elevated py-12 px-6 text-center">
      <p className="text-ink-muted text-sm">{message}</p>
      {hint && <p className="mt-1.5 text-[12.5px] text-ink-faint">{hint}</p>}
      <Link href={createHref} className="btn btn-primary mt-5 inline-flex" style={{ width: "auto", padding: "0 18px" }}>
        <Plus className="size-4" /> {createLabel}
      </Link>
      <p className="sr-only">{t(locale, "Nothing to show yet.")}</p>
    </div>
  );
}
