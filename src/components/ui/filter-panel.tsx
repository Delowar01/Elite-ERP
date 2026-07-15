"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "./button";
import { Popover, PopoverTrigger, PopoverContent } from "./popover";
import { cn } from "@/lib/utils";

// The one Advanced Filter shell every list page opens off its Filters button — a direct port of
// the mockup's advanced_filter_panel(): zero network activity until Apply is clicked. Callers own
// their own filter state (typically URL searchParams, matching the existing list-page pattern) and
// pass the actual fields in as children; this component is just the popover chrome + Apply/Clear.
export function FilterPanel({
  children,
  onApply,
  onClear,
  triggerLabel = "Filters",
  hasActiveFilters,
}: {
  children: React.ReactNode;
  onApply?: () => void;
  onClear?: () => void;
  triggerLabel?: string;
  hasActiveFilters?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="glass"
          size="sm"
          className={cn(hasActiveFilters && "border-brand-orange text-brand-orange")}
        >
          <SlidersHorizontal className="size-3.5" /> {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="flex flex-col gap-3">{children}</div>
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-line">
          <button
            type="button"
            onClick={() => {
              onClear?.();
              setOpen(false);
            }}
            className="text-[11.5px] font-semibold text-ink-muted hover:text-danger transition-colors"
          >
            Clear
          </button>
          <Button
            size="sm"
            onClick={() => {
              onApply?.();
              setOpen(false);
            }}
          >
            Apply Filters
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
