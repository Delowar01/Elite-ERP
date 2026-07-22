"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { Sun, Moon } from "lucide-react";
import { setThemeAction } from "@/lib/theme-actions";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Theme } from "@/lib/theme";

// Reads the OS color-scheme preference the React-blessed way (no setState-in-effect), so the
// icon is correct even when the user hasn't picked a theme yet (following the OS).
function useSystemDark(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false, // server snapshot — reconciled on the client after hydration
  );
}

// Light/dark theme toggle. `initial` is the explicit cookie value (null = following the OS).
// On click we flip it, apply data-theme to <html> instantly (CSS handles the cross-fade), and
// persist the choice via a cookie so it survives reloads.
export function ThemeToggle({ locale, initial }: { locale: Locale; initial: Theme | null }) {
  const [override, setOverride] = useState<Theme | null>(initial);
  const systemDark = useSystemDark();
  const [, startTransition] = useTransition();

  const theme: Theme = override ?? (systemDark ? "dark" : "light");

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setOverride(next);
    document.documentElement.setAttribute("data-theme", next);
    startTransition(() => setThemeAction(next));
  }

  const label = theme === "dark" ? t(locale, "Switch to light mode") : t(locale, "Switch to dark mode");
  return (
    <button type="button" className="topbar-icon-btn" onClick={toggle} aria-label={label} title={label}>
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
