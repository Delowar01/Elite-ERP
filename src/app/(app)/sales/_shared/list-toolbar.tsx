"use client";

import Link from "next/link";
import { Search, SlidersHorizontal, Bookmark, ChevronDown, Download, Upload, Archive, Plus } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";

// Matches the mockup's list_toolbar() exactly: <div class="list-toolbar">
// <div class="topbar-search">...<button class="doc-pill-btn">Filters</button>
// <button class="doc-pill-btn">Views</button><div class="toolbar-actions-right">...
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
    <div className="list-toolbar">
      <div className="topbar-search">
        <Search className="size-3.5 shrink-0" />
        <input
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-ink-faint"
        />
      </div>
      <button type="button" className="doc-pill-btn" disabled>
        <SlidersHorizontal className="size-3.5" /> <span>{t(locale, "Filters")}</span> <ChevronDown className="size-3" style={{ color: "var(--ink-faint)" }} />
      </button>
      <button type="button" className="doc-pill-btn" disabled>
        <Bookmark className="size-3.5" /> <span>{t(locale, "Views")}</span> <ChevronDown className="size-3" style={{ color: "var(--ink-faint)" }} />
      </button>
      <div className="toolbar-actions-right">
        <button type="button" className="btn btn-glass" disabled>
          <Download className="size-3.5" /> <span>{t(locale, "Export")}</span> <ChevronDown className="size-3" />
        </button>
        <button type="button" className="btn btn-glass" disabled>
          <Upload className="size-3.5" /> <span>{t(locale, "Import")}</span>
        </button>
        <button type="button" className="btn btn-glass" disabled>
          <Archive className="size-3.5" /> <span>{t(locale, "Recycle Bin")}</span>
        </button>
        <Link href={createHref} className="btn btn-primary">
          <Plus className="size-3.5" /> {createLabel}
        </Link>
      </div>
    </div>
  );
}
