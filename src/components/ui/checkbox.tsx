"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Navy Command checkbox (DEV-UI-01.4, R3): checked is the PRIMARY navy fill with the primary
// foreground tick — orange stays the focus / accent marker, never the checked fill (an orange fill
// gave the white tick only ~3:1). 4px radius, control border, 2px orange keyboard focus outline,
// disabled in the semantic tokens, aria-invalid in danger.
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-sm border border-border-control! bg-[var(--input-background)] transition-colors duration-150",
        "data-[state=checked]:[background:var(--primary)] data-[state=checked]:border-[color:var(--primary)]! data-[state=checked]:text-[color:var(--primary-foreground)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        "aria-invalid:border-danger!",
        "disabled:cursor-not-allowed disabled:border-border! disabled:bg-[var(--disabled-background)] disabled:data-[state=checked]:[background:var(--disabled-background)] disabled:data-[state=checked]:text-[color:var(--disabled-text)]",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <CheckIcon className="size-3" strokeWidth={3} aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
