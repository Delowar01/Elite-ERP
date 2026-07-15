"use client";

import { useTransition } from "react";
import { Languages, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { setLocaleAction } from "@/lib/i18n/actions";
import type { Locale } from "@/lib/i18n/dict";

export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={pending}
        className="flex items-center gap-1 h-9 rounded-[10px] border border-line px-2.5 text-[12px] font-semibold text-ink-muted hover:text-ink outline-none disabled:opacity-60"
      >
        <Languages className="size-3.5" />
        {locale.toUpperCase()}
        <ChevronDown className="size-2.5 text-ink-faint" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className={cn("cursor-pointer", locale === "en" && "font-semibold text-brand-orange")}
          onSelect={() => startTransition(() => setLocaleAction("en"))}
        >
          🇬🇧 English
        </DropdownMenuItem>
        <DropdownMenuItem
          className={cn("cursor-pointer", locale === "ar" && "font-semibold text-brand-orange")}
          onSelect={() => startTransition(() => setLocaleAction("ar"))}
        >
          🇸🇦 العربية
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
