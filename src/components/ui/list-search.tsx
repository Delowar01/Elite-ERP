"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { Input } from "./input";
import { Button } from "./button";
import { cn } from "@/lib/utils";

// The list search box (DEV-UI-01.5): the approved 36px Input with a search icon at the logical inline
// start and an accessible name. It renders the value it is given and reports changes — WHEN a search
// runs (live, or on Enter + URL navigation) stays with each list, unchanged. The optional clear button
// (only while there is text) clears the text and nothing else.
// Not `.topbar-search`: that class belongs to the shell's search box.
export function ListSearch({
  value,
  onChange,
  placeholder,
  label,
  clearLabel,
  onKeyDown,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Accessible name (already translated). */
  label: string;
  /** When given, a clear button appears while the box has text (already translated). */
  clearLabel?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  className?: string;
}) {
  return (
    <div className={cn("relative w-full min-w-[220px] max-w-[340px] flex-1", className)} data-slot="list-search">
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={label}
        className={cn("ps-9", clearLabel && value ? "pe-10" : undefined)}
      />
      {clearLabel && value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute end-0.5 top-1/2 -translate-y-1/2"
          aria-label={clearLabel}
          onClick={() => onChange("")}
        >
          <X />
        </Button>
      ) : null}
    </div>
  );
}
