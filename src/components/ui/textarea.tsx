import * as React from "react";
import { cn } from "@/lib/utils";

// Same foundation as <Input> (DEV-UI-01.4): control border, input background, the body type size,
// 6px radius, a 2px orange focus outline, aria-invalid in danger, disabled in the semantic tokens.
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-24 w-full rounded-md border border-border-control! bg-[var(--input-background)] px-3 py-2 text-body text-ink placeholder:text-ink-faint transition-[border-color,outline-color] duration-150",
        "hover:border-ink-muted!",
        "focus-visible:border-focus! focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-focus",
        "aria-invalid:border-danger! aria-invalid:focus-visible:outline-danger",
        "disabled:cursor-not-allowed disabled:bg-[var(--disabled-background)] disabled:text-[var(--disabled-text)] disabled:border-border!",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
