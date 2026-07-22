"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Command as CommandIcon, CornerDownLeft, FileText, Loader2 } from "lucide-react";
import { NAV_GROUPS } from "./nav-config";
import { t, type Locale } from "@/lib/i18n/dict";
import { globalSearchAction } from "@/app/(app)/search-actions";
import type { SearchResult } from "@/lib/global-search";

type Row =
  | { kind: "nav"; label: string; href: string; group: string; Icon: React.ComponentType<{ className?: string }> }
  | { kind: "record"; label: string; href: string; group: string; sublabel: string };

// Global command palette: jumps to any page AND searches real ERP records (invoices,
// quotations, clients, vendors, products, …) via a tenant-scoped server action. Wires the
// topbar search box + ⌘K pill and a global ⌘/Ctrl-K shortcut.
export function CommandPalette({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [records, setRecords] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const navItems = useMemo<Row[]>(
    () =>
      NAV_GROUPS.flatMap((g) =>
        g.items.map((it) => ({ kind: "nav" as const, label: t(locale, it.label), href: it.href, group: g.label ? t(locale, g.label) : "", Icon: it.icon })),
      ),
    [locale],
  );

  const navFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return navItems;
    return navItems.filter((it) => it.label.toLowerCase().includes(q) || it.group.toLowerCase().includes(q));
  }, [navItems, query]);

  // Debounced tenant-scoped record search once the query is meaningful. All state updates run
  // inside the timeout callback (never synchronously in the effect body).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      const clear = setTimeout(() => { setRecords([]); setLoading(false); }, 0);
      return () => clearTimeout(clear);
    }
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await globalSearchAction(q);
        setRecords(res);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(handle);
  }, [query]);

  const recordRows = useMemo<Row[]>(
    () => records.map((r) => ({ kind: "record" as const, label: r.label, href: r.href, group: t(locale, r.type), sublabel: r.sublabel })),
    [records, locale],
  );

  const rows = useMemo<Row[]>(() => [...recordRows, ...navFiltered], [recordRows, navFiltered]);

  function openPalette() {
    setQuery("");
    setActive(0);
    setRecords([]);
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => {
          if (!o) requestAnimationFrame(() => inputRef.current?.focus());
          return !o;
        });
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Clamp during render (no effect) so the highlight stays valid as the result set changes.
  const activeIdx = rows.length ? Math.min(active, rows.length - 1) : 0;

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      {/* Topbar triggers */}
      <button type="button" className="topbar-search hidden lg:flex" onClick={openPalette} aria-label={t(locale, "Search anything…")}>
        <Search className="size-[15px] shrink-0" />
        <span className="truncate">{t(locale, "Search anything…")}</span>
      </button>
      <button type="button" className="cmdk-trigger-pill hidden md:inline-flex" onClick={openPalette} aria-label="Command menu">
        <CommandIcon className="size-3" />
        <span className="cmdk-kbd">K</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 backdrop-blur-sm pt-[12vh] px-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-[520px] rounded-2xl border border-line bg-surface shadow-glass overflow-hidden animate-fade-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 border-b border-line">
              <Search className="size-4 text-ink-faint shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(activeIdx + 1, rows.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(activeIdx - 1, 0)); }
                  else if (e.key === "Enter" && rows[activeIdx]) { e.preventDefault(); go(rows[activeIdx].href); }
                }}
                placeholder={t(locale, "Search records or jump to a page…")}
                className="flex-1 h-12 bg-transparent outline-none text-[14px]"
              />
              {loading && <Loader2 className="size-4 text-ink-faint animate-spin shrink-0" />}
            </div>
            <div className="max-h-[360px] overflow-y-auto py-2">
              {rows.length === 0 && !loading && (
                <div className="px-4 py-6 text-center text-[12.5px] text-ink-faint">{t(locale, "No matches.")}</div>
              )}
              {rows.map((it, i) => (
                <button
                  key={`${it.kind}-${it.href}-${i}`}
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(it.href)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-start text-[13px] ${i === activeIdx ? "bg-canvas" : ""}`}
                >
                  {it.kind === "nav" ? (
                    <it.Icon className="size-4 text-ink-muted shrink-0" />
                  ) : (
                    <FileText className="size-4 text-ink-muted shrink-0" />
                  )}
                  <span className="flex-1 min-w-0 truncate">
                    {it.label}
                    {it.kind === "record" && it.sublabel && <span className="text-ink-faint"> · {it.sublabel}</span>}
                  </span>
                  {it.group && <span className="text-[11px] text-ink-faint shrink-0">{it.group}</span>}
                  {i === activeIdx && <CornerDownLeft className="size-3.5 text-ink-faint shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
