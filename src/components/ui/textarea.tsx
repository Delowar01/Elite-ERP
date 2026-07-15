import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-24 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13.5px] text-ink placeholder:text-ink-faint outline-none transition-[box-shadow,border-color] duration-150",
        "focus-visible:border-brand-orange focus-visible:ring-[3px] focus-visible:ring-brand-orange/18",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
