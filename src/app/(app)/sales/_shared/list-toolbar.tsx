"use client";

import Link from "next/link";
import { Search, SlidersHorizontal, Bookmark, ChevronDown, Download, Upload, Archive, Plus } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";

export function ListToolbar({
  locale,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  createHref,
  createLabel,
}: {
  locale: Locale;
  searchPlaceholder: string;
  searchValue: string;
  onSearchChange: (v: string) => void;
  createHref: string;
  createLabel: string;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap mb-4">
      <div className="flex-1 min-w-[220px] max-w-[340px] flex items-center gap-2 h-9 rounded-[9px] bg-surface border border-line-strong px-3 text-[12.5px] text-ink">
        <Search className="size-3.5 text-ink-faint shrink-0" />
        <input
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-ink-faint"
        />
      </div>
      <button
        type="button"
        className="inline-flex items-center gap-1.5 h-9 rounded-[9px] border border-line-strong bg-surface px-3.5 text-[12px] font-medium text-ink-muted"
      >
        <SlidersHorizontal className="size-3.5" /> {t(locale, "Filters")} <ChevronDown className="size-3 text-ink-faint" />
      </button>
      <button
        type="button"
        className="inline-flex items-center gap-1.5 h-9 rounded-[9px] border border-line-strong bg-surface px-3.5 text-[12px] font-medium text-ink-muted"
      >
        <Bookmark className="size-3.5" /> {t(locale, "Views")} <ChevronDown className="size-3 text-ink-faint" />
      </button>
      <div className="flex items-center gap-2 ms-auto flex-wrap">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 h-9 rounded-lg border border-line-strong bg-surface/80 px-3.5 text-[12.5px] font-semibold text-ink"
        >
          <Download className="size-3.5" /> {t(locale, "Export")} <ChevronDown className="size-3" />
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 h-9 rounded-lg border border-line-strong bg-surface/80 px-3.5 text-[12.5px] font-semibold text-ink"
        >
          <Upload className="size-3.5" /> {t(locale, "Import")}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 h-9 rounded-lg border border-line-strong bg-surface/80 px-3.5 text-[12.5px] font-semibold text-ink"
        >
          <Archive className="size-3.5" /> {t(locale, "Recycle Bin")}
        </button>
        <Link
          href={createHref}
          className="inline-flex items-center gap-1.5 h-9 rounded-lg px-4 text-[12.5px] font-semibold text-white shadow-[0_6px_18px_-4px_rgba(232,119,34,0.55)] bg-linear-to-br from-brand-orange-light to-brand-orange"
        >
          <Plus className="size-3.5" /> {createLabel}
        </Link>
      </div>
    </div>
  );
}
