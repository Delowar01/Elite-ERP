"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Check } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SearchOption = { value: string; label: string; sublabel?: string };

// A searchable dropdown (combobox): a trigger showing the selected label, and a popover with a
// filter input + option list. Solid surface (inherits the Popover fix). Keyboard + click.
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches.",
  disabled,
  className,
  triggerClassName,
  id,
  "aria-label": ariaLabel,
}: {
  options: SearchOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || (o.sublabel ?? "").toLowerCase().includes(q));
  }, [options, query]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) { setQuery(""); requestAnimationFrame(() => inputRef.current?.focus()); }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            "flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-line-strong bg-surface px-3 text-[13.5px] outline-none focus:border-brand-orange focus:ring-[3px] focus:ring-brand-orange/18 disabled:opacity-50",
            triggerClassName,
          )}
        >
          <span className={cn("truncate", selected ? "text-ink" : "text-ink-faint")}>{selected ? selected.label : placeholder}</span>
          <ChevronDown className="size-4 shrink-0 text-ink-faint" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("w-[--radix-popover-trigger-width] p-0", className)}>
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search className="size-4 shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-10 flex-1 bg-transparent text-[13.5px] outline-none"
          />
        </div>
        <div className="max-h-60 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12.5px] text-ink-faint">{emptyText}</div>
          ) : (
            filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[13px] hover:bg-canvas",
                  o.value === value && "bg-brand-orange/10 font-medium",
                )}
              >
                <span className="flex-1 min-w-0 truncate">
                  {o.label}
                  {o.sublabel && <span className="text-ink-faint"> · {o.sublabel}</span>}
                </span>
                {o.value === value && <Check className="size-3.5 shrink-0 text-brand-orange" />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
