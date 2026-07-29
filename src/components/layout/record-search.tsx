"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, CornerDownLeft, FileText, AlertCircle } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";
import { globalSearchAction } from "@/app/(app)/search-actions";
import type { SearchResult } from "@/lib/global-search";

// Main Search panel — searches real ERP records ONLY (clients, vendors, products, every document
// type, employees, projects, journal entries), tenant-scoped, grouped by record type. Clicking a
// result opens its detail page. Navigation and quick actions live in the ⌘K command palette instead.
// This panel is mounted only while open (the coordinator conditionally renders it), so every open is
// a fresh mount — state starts clean with no reset-in-effect needed.
export function RecordSearchPanel({ locale, onClose }: { locale: Locale; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [records, setRecords] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input on mount (DOM only — no setState in the effect body).
  useEffect(() => {
    const h = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(h);
  }, []);

  // Debounced, tenant-scoped record search once the query is meaningful (≥2 chars). Every state
  // update happens inside a timeout/promise callback, never synchronously in the effect body.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      const clear = setTimeout(() => {
        setRecords([]);
        setLoading(false);
        setError(false);
      }, 0);
      return () => clearTimeout(clear);
    }
    const handle = setTimeout(async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await globalSearchAction(q);
        setRecords(res);
        setError(false);
      } catch {
        setRecords([]);
        setError(true);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(handle);
  }, [query]);

  const activeIdx = records.length ? Math.min(active, records.length - 1) : 0;
  const showEmpty = !loading && !error && query.trim().length >= 2 && records.length === 0;
  const showHint = !loading && !error && query.trim().length < 2;

  // Group consecutive results by record type for section headers; searchRecords already returns each
  // type contiguously, so consecutive grouping matches the intended sections.
  const grouped = useMemo(() => {
    const out: { type: string; items: { r: SearchResult; index: number }[] }[] = [];
    records.forEach((r, index) => {
      const last = out[out.length - 1];
      if (last && last.type === r.type) last.items.push({ r, index });
      else out.push({ type: r.type, items: [{ r, index }] });
    });
    return out;
  }, [records]);

  function go(href: string) {
    onClose();
    router.push(href);
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 backdrop-blur-sm pt-[12vh] px-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t(locale, "Search records")}
    >
      <div
        className="w-full max-w-[560px] rounded-2xl border border-line bg-surface shadow-glass overflow-hidden animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-3 pb-2 border-b border-line">
          <div className="text-[13px] font-semibold text-ink">{t(locale, "Search records")}</div>
          <div className="text-[11px] text-ink-faint">{t(locale, "Find clients, documents, products, employees and more")}</div>
        </div>
        <div className="flex items-center gap-2 px-4 border-b border-line">
          <Search className="size-4 text-ink-faint shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive(Math.min(activeIdx + 1, records.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive(Math.max(activeIdx - 1, 0));
              } else if (e.key === "Enter" && records[activeIdx]) {
                e.preventDefault();
                go(records[activeIdx].href);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder={t(locale, "Search ERP records…")}
            className="flex-1 h-12 bg-transparent outline-none text-[14px]"
          />
          {loading && <Loader2 className="size-4 text-ink-faint animate-spin shrink-0" />}
        </div>
        <div className="max-h-[380px] overflow-y-auto py-2">
          {showHint && (
            <div className="px-4 py-6 text-center text-[12.5px] text-ink-faint">{t(locale, "Type at least 2 characters to search.")}</div>
          )}
          {error && (
            <div className="px-4 py-6 flex flex-col items-center gap-1.5 text-center text-[12.5px] text-danger">
              <AlertCircle className="size-5" />
              {t(locale, "Search failed. Please try again.")}
            </div>
          )}
          {showEmpty && <div className="px-4 py-6 text-center text-[12.5px] text-ink-faint">{t(locale, "No records found.")}</div>}
          {grouped.map((group) => (
            <Fragment key={group.type}>
              <div className="px-4 pt-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">{t(locale, group.type)}</div>
              {group.items.map(({ r, index }) => (
                <button
                  key={`${r.type}-${r.id}`}
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => go(r.href)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-start text-[13px] ${index === activeIdx ? "bg-canvas" : ""}`}
                >
                  <FileText className="size-4 text-ink-muted shrink-0" />
                  <span className="flex-1 min-w-0 truncate">
                    {r.label}
                    {r.sublabel && <span className="text-ink-faint"> · {r.sublabel}</span>}
                  </span>
                  {index === activeIdx && <CornerDownLeft className="size-3.5 text-ink-faint shrink-0" />}
                </button>
              ))}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
