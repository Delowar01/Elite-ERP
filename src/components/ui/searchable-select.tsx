"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Check, Plus } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// `keywords` are matched by the filter but never displayed — lets a client be found by VAT / CR /
// phone / email / city / country in addition to its name.
export type SearchOption = { value: string; label: string; sublabel?: string; keywords?: string };

// A searchable dropdown (combobox): a trigger showing the selected label, and a popover with a
// filter input + option list. Solid surface (inherits the Popover fix). DEV-UI-01.4: the filter box
// is the combobox (aria-controls + aria-activedescendant) for a role="listbox" of role="option"s;
// ArrowDown / ArrowUp move the active option, Enter selects it, Escape closes (Radix). Filtering,
// options, onChange and Add New are unchanged.
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
  addNewLabel,
  onAddNew,
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
  // Optional sticky action row at the bottom of the list (e.g. "＋ Add New Client"). Closes the
  // popover, then runs onAddNew.
  addNewLabel?: string;
  onAddNew?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The keyboard-active option (index into `filtered`), exposed via aria-activedescendant.
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (i: number) => `${baseId}-option-${i}`;
  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || (o.sublabel ?? "").toLowerCase().includes(q) || (o.keywords ?? "").toLowerCase().includes(q));
  }, [options, query]);
  const activeIdx = filtered.length ? Math.min(active, filtered.length - 1) : -1;

  // Keep the keyboard-active option visible while arrowing through a long list.
  useEffect(() => {
    if (!open || activeIdx < 0) return;
    listRef.current?.querySelector(`#${CSS.escape(optionId(activeIdx))}`)?.scrollIntoView({ block: "nearest" });
    // optionId is derived from the stable baseId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeIdx]);

  function choose(o: SearchOption) {
    onChange(o.value);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setQuery("");
          // Start on the current selection so Enter keeps it and the arrows move from it.
          setActive(Math.max(0, options.findIndex((x) => x.value === value)));
          requestAnimationFrame(() => inputRef.current?.focus());
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          aria-label={ariaLabel}
          disabled={disabled}
          data-slot="searchable-select-trigger"
          className={cn(
            // Same foundation as <Input> / <SelectTrigger> (DEV-UI-01.4).
            "flex h-(--control-height) w-full items-center justify-between gap-2 rounded-md border border-border-control! bg-[var(--input-background)] px-3 text-body transition-[border-color,outline-color] duration-150",
            "hover:border-ink-muted!",
            "focus-visible:border-focus! focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-focus",
            "aria-invalid:border-danger! aria-invalid:focus-visible:outline-danger",
            "disabled:cursor-not-allowed disabled:bg-[var(--disabled-background)] disabled:text-[var(--disabled-text)] disabled:border-border!",
            triggerClassName,
          )}
        >
          <span className={cn("truncate", selected ? "text-ink" : "text-ink-faint")}>{selected ? selected.label : placeholder}</span>
          <ChevronDown className="size-4 shrink-0 text-ink-faint" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("w-[--radix-popover-trigger-width] rounded-lg p-0", className)}>
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search className="size-4 shrink-0 text-ink-faint" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                if (filtered.length) setActive(activeIdx < filtered.length - 1 ? activeIdx + 1 : activeIdx);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                if (filtered.length) setActive(activeIdx > 0 ? activeIdx - 1 : 0);
              } else if (e.key === "Enter") {
                // Never submit an enclosing form from the filter box.
                e.preventDefault();
                if (activeIdx >= 0) choose(filtered[activeIdx]);
              }
              // Escape is handled by the popover (closes and returns focus to the trigger).
            }}
            placeholder={searchPlaceholder}
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeIdx >= 0 ? optionId(activeIdx) : undefined}
            aria-label={ariaLabel ?? searchPlaceholder}
            className="h-(--control-height) flex-1 bg-transparent text-body outline-none"
          />
        </div>
        <div ref={listRef} id={listboxId} role="listbox" aria-label={ariaLabel ?? placeholder} className="max-h-60 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div role="status" className="px-3 py-6 text-center text-body-sm text-ink-faint">{emptyText}</div>
          ) : (
            filtered.map((o, i) => {
              const isSelected = o.value === value;
              return (
                <div
                  key={o.value}
                  id={optionId(i)}
                  role="option"
                  aria-selected={isSelected}
                  data-active={i === activeIdx || undefined}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault() /* keep focus in the filter box */}
                  onClick={() => choose(o)}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-start text-body",
                    "data-[active]:bg-canvas",
                    isSelected && "bg-accent-tint font-medium",
                  )}
                >
                  <span className="flex-1 min-w-0 truncate">
                    {o.label}
                    {o.sublabel && <span className="text-ink-faint"> · {o.sublabel}</span>}
                  </span>
                  {isSelected && <Check className="size-3.5 shrink-0 text-accent-ink" aria-hidden />}
                </div>
              );
            })
          )}
        </div>
        {onAddNew && (
          <button
            type="button"
            onClick={() => { setOpen(false); onAddNew(); }}
            className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-start text-body font-medium text-accent-ink hover:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
          >
            <Plus className="size-4 shrink-0" aria-hidden />
            {addNewLabel ?? "Add New"}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
