"use client";

import Link from "next/link";
import { Archive, Plus } from "lucide-react";
import { ListSearch } from "@/components/ui/list-search";
import { t, type Locale } from "@/lib/i18n/dict";

// The simple list toolbar (today: Projects). DEV-UI-01.5: only what actually works is rendered —
// the live search, the Recycle Bin link when the list has one, and Create. The earlier disabled
// Filters / Views / Export / Import placeholders read as broken controls and were removed (no
// feature was added or taken away). Search semantics are the caller's, unchanged.
export function ListToolbar({
  locale,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  createHref,
  createLabel,
  recycleBinHref = "/recycle-bin",
}: {
  locale: Locale;
  searchPlaceholder: string;
  searchValue: string;
  onSearchChange: (v: string) => void;
  createHref: string;
  createLabel: string;
  recycleBinHref?: string;
}) {
  return (
    <div className="list-toolbar">
      <ListSearch value={searchValue} onChange={onSearchChange} placeholder={searchPlaceholder} label={searchPlaceholder} clearLabel={t(locale, "Clear search")} />
      <div className="toolbar-actions-right">
        {recycleBinHref ? (
          <Link href={recycleBinHref} className="btn btn-glass">
            <Archive className="size-3.5" /> <span>{t(locale, "Recycle Bin")}</span>
          </Link>
        ) : null}
        <Link href={createHref} className="btn btn-primary">
          <Plus className="size-3.5" /> {createLabel}
        </Link>
      </div>
    </div>
  );
}
