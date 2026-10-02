"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Command as CommandIcon } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";
import { RecordSearchPanel } from "./record-search";
import { CommandPalettePanel } from "./command-palette";

type Mode = "search" | "palette" | null;

// Owns the two topbar entry points and guarantees they are mutually exclusive:
//  • the Search box opens the Main Search panel (ERP record search only)
//  • the ⌘K pill / Ctrl+K opens the Command palette (navigation + quick actions only)
// Because a single `mode` drives both, only one panel can ever be open at a time.
export function TopbarSearch({ locale, role }: { locale: Locale; role: "owner" | "admin" | "staff" }) {
  const [mode, setMode] = useState<Mode>(null);
  // The live mode for event handlers (the window listener below is registered once).
  const modeRef = useRef<Mode>(null);
  // Where focus was when a panel opened — it goes back there on close. The panels are Radix dialogs
  // without a Dialog.Trigger, so Radix has no trigger of its own to return to.
  const returnTo = useRef<HTMLElement | null>(null);

  function openPanel(next: Exclude<Mode, null>) {
    if (modeRef.current === null) returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modeRef.current = next;
    setMode(next);
  }
  // Idempotent: Escape reaches the panel's input, Radix and the window listener — one close happens.
  function closePanel() {
    if (modeRef.current === null) return;
    modeRef.current = null;
    setMode(null);
    const target = returnTo.current;
    returnTo.current = null;
    requestAnimationFrame(() => target?.focus()); // after the panel has unmounted
  }
  const handlers = useRef({ openPanel, closePanel });
  useEffect(() => {
    handlers.current = { openPanel, closePanel };
  });

  // Global Ctrl/⌘+K toggles the command palette (and replaces the search panel if it was open, since
  // both share the same single-value state). Escape closes whatever is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (modeRef.current === "palette") handlers.current.closePanel();
        else handlers.current.openPanel("palette");
      } else if (e.key === "Escape") {
        handlers.current.closePanel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {/* ≥1024: the search box. <1024: a compact search icon — a visible entry point that needs no
          keyboard (DEV-UI-01.3). Same panel either way; visibility is decided in shell.css. */}
      <button type="button" className="topbar-search" onClick={() => openPanel("search")} aria-label={t(locale, "Search records")}>
        <Search className="size-[15px] shrink-0" aria-hidden />
        <span className="truncate">{t(locale, "Search records…")}</span>
      </button>
      <button type="button" className="topbar-icon-btn topbar-search-icon" onClick={() => openPanel("search")} aria-label={t(locale, "Search records")} title={t(locale, "Search records")}>
        <Search className="size-4" aria-hidden />
      </button>
      <button type="button" className="cmdk-trigger-pill" onClick={() => openPanel("palette")} aria-label={t(locale, "Command menu")}>
        <CommandIcon className="size-3" aria-hidden />
        <span className="cmdk-kbd">K</span>
      </button>

      {/* Conditionally mounted so each open is a fresh instance (clean state) and only one panel can
          exist in the DOM at a time. Both panels are Radix dialogs: focus returns to the trigger on close. */}
      {mode === "search" && <RecordSearchPanel locale={locale} onClose={closePanel} />}
      {mode === "palette" && <CommandPalettePanel locale={locale} role={role} onClose={closePanel} />}
    </>
  );
}
