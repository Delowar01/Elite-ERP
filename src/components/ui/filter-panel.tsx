"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "./button";
import { Popover, PopoverTrigger, PopoverContent } from "./popover";
import { cn } from "@/lib/utils";

// The Advanced Filter shell of the master-data lists — a direct port of the mockup's
// advanced_filter_panel(): zero network activity until Apply is clicked. Callers own their filter
// state (URL searchParams) and pass the fields in as children; this component is the popover chrome +
// Apply / Clear. DEV-UI-01.5: presentation only — approved Buttons for Clear / Apply, caller-provided
// (translated) labels, and an optional active count on the trigger. The Apply-based model is unchanged.
export function FilterPanel({
  children,
  onApply,
  onClear,
  triggerLabel = "Filters",
  applyLabel = "Apply Filters",
  clearLabel = "Clear",
  hasActiveFilters,
  activeCount,
}: {
  children: React.ReactNode;
  onApply?: () => void;
  onClear?: () => void;
  triggerLabel?: string;
  /** Already-translated button labels. */
  applyLabel?: string;
  clearLabel?: string;
  hasActiveFilters?: boolean;
  /** How many filters are applied; shown on the trigger when > 0. */
  activeCount?: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          className={cn("data-[state=open]:bg-surface-subtle", hasActiveFilters && "border-accent-ink! text-accent-ink")}
          data-active={hasActiveFilters || undefined}
          data-list-filters=""
        >
          <SlidersHorizontal className="size-3.5" aria-hidden /> {triggerLabel}
          {activeCount ? (
            <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent-tint px-1.5 text-caption font-semibold text-accent-ink" data-filter-count={activeCount}>
              {activeCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="flex flex-col gap-3">{children}</div>
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              onClear?.();
              setOpen(false);
            }}
          >
            {clearLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onApply?.();
              setOpen(false);
            }}
          >
            {applyLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
