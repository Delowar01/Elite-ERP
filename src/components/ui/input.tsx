import * as React from "react";
import { cn } from "@/lib/utils";

// Navy Command input foundation (DEV-UI-01.1): 36px comfortable height, 6px radius, a control border
// that clears 3:1 against its surface (WCAG 1.4.11), solid fills only. Focus is a 2px orange outline
// for keyboard and pointer alike (a text field always shows where typing goes); errors are signalled
// with aria-invalid, which also changes the border so it is not colour-on-hover alone.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-(--control-height) w-full rounded-md border border-border-control bg-[var(--input-background)] px-3 text-body text-ink placeholder:text-ink-faint transition-[border-color,outline-color] duration-150",
        "hover:border-ink-muted",
        "focus-visible:border-focus focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-focus",
        "aria-invalid:border-danger aria-invalid:focus-visible:outline-danger",
        "disabled:cursor-not-allowed disabled:bg-[var(--disabled-background)] disabled:text-[var(--disabled-text)] disabled:border-border",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
