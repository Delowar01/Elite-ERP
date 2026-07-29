"use client";

import { useEffect, useState } from "react";
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

  // Global Ctrl/⌘+K toggles the command palette (and closes the search panel if it was open, since
  // both share the same single-value state). Escape closes whatever is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMode((m) => (m === "palette" ? null : "palette"));
      } else if (e.key === "Escape") {
        setMode(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button type="button" className="topbar-search hidden lg:flex" onClick={() => setMode("search")} aria-label={t(locale, "Search records")}>
        <Search className="size-[15px] shrink-0" />
        <span className="truncate">{t(locale, "Search records…")}</span>
      </button>
      <button type="button" className="cmdk-trigger-pill hidden md:inline-flex" onClick={() => setMode("palette")} aria-label={t(locale, "Command menu")}>
        <CommandIcon className="size-3" />
        <span className="cmdk-kbd">K</span>
      </button>

      {/* Conditionally mounted so each open is a fresh instance (clean state) and only one panel can
          exist in the DOM at a time. */}
      {mode === "search" && <RecordSearchPanel locale={locale} onClose={() => setMode(null)} />}
      {mode === "palette" && <CommandPalettePanel locale={locale} role={role} onClose={() => setMode(null)} />}
    </>
  );
}
