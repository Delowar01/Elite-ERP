"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Command as CommandIcon, CornerDownLeft } from "lucide-react";
import { NAV_GROUPS } from "./nav-config";
import { t, type Locale } from "@/lib/i18n/dict";

// Quick-nav command palette. Wires up the topbar search box + ⌘K pill (both were
// decorative before) and a global ⌘/Ctrl-K shortcut, so every page is one keystroke away.
export function CommandPalette({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo(
    () =>
      NAV_GROUPS.flatMap((g) =>
        g.items.map((it) => ({ label: t(locale, it.label), href: it.href, group: g.label ? t(locale, g.label) : "", Icon: it.icon })),
      ),
    [locale],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => it.label.toLowerCase().includes(q) || it.group.toLowerCase().includes(q));
  }, [items, query]);

  function openPalette() {
    setQuery("");
    setActive(0);
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
                  if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                  else if (e.key === "Enter" && filtered[active]) { e.preventDefault(); go(filtered[active].href); }
                }}
                placeholder={t(locale, "Jump to a page…")}
                className="flex-1 h-12 bg-transparent outline-none text-[14px]"
              />
            </div>
            <div className="max-h-[340px] overflow-y-auto py-2">
              {filtered.length === 0 && <div className="px-4 py-6 text-center text-[12.5px] text-ink-faint">{t(locale, "No matches.")}</div>}
              {filtered.map((it, i) => {
                const Icon = it.Icon;
                return (
                  <button
                    key={it.href}
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(it.href)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-[13px] ${i === active ? "bg-canvas" : ""}`}
                  >
                    <Icon className="size-4 text-ink-muted shrink-0" />
                    <span className="flex-1">{it.label}</span>
                    {it.group && <span className="text-[11px] text-ink-faint">{it.group}</span>}
                    {i === active && <CornerDownLeft className="size-3.5 text-ink-faint" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
