"use client";

import { useSyncExternalStore, useTransition } from "react";
import { Sun, Moon } from "lucide-react";
import { setThemeAction } from "@/lib/theme-actions";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Theme } from "@/lib/theme";

// The effective appearance, read from the document itself: the explicit <html data-theme> when set,
// otherwise the OS preference. Reading the DOM (instead of keeping a private copy in state) keeps every
// toggle in step — the top bar, the mobile drawer and the command palette all flip the same attribute.
function subscribe(cb: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  mq.addEventListener("change", cb);
  return () => {
    mo.disconnect();
    mq.removeEventListener("change", cb);
  };
}
function current(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// Light/dark theme toggle. `initial` is the explicit cookie value (null = following the OS). On click
// we flip it, apply data-theme to <html> instantly (CSS handles the cross-fade), and persist the choice
// via a cookie so it survives reloads.
export function ThemeToggle({ locale, initial, className }: { locale: Locale; initial: Theme | null; className?: string }) {
  const theme = useSyncExternalStore(subscribe, current, () => initial ?? "light");
  const [, startTransition] = useTransition();

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    startTransition(() => setThemeAction(next));
  }

  const label = theme === "dark" ? t(locale, "Switch to light mode") : t(locale, "Switch to dark mode");
  return (
    <button type="button" className={cn("topbar-icon-btn", className)} onClick={toggle} aria-label={label} title={label}>
      {theme === "dark" ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </button>
  );
}
