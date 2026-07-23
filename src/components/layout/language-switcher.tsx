"use client";

import { useTransition } from "react";
import { Languages, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { setLocaleAction } from "@/lib/i18n/actions";
import type { Locale } from "@/lib/i18n/dict";

export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger disabled={pending} className="topbar-lang outline-none disabled:opacity-60">
        <Languages className="size-3.5" />
        <span>{locale.toUpperCase()}</span>
        <ChevronDown className="size-2.5" style={{ color: "var(--ink-faint)" }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className="cursor-pointer"
          data-selected={locale === "en" ? "true" : undefined}
          onSelect={() => startTransition(() => setLocaleAction("en"))}
        >
          🇬🇧 English
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer"
          data-selected={locale === "ar" ? "true" : undefined}
          onSelect={() => startTransition(() => setLocaleAction("ar"))}
        >
          🇸🇦 العربية
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
