import * as React from "react";
import { cn } from "@/lib/utils";

// Navy Command input foundation (DEV-UI-01.1): 36px comfortable height, 6px radius, a control border
// that clears 3:1 against its surface (WCAG 1.4.11), solid fills only. Focus is a 2px orange outline
// for keyboard and pointer alike (a text field always shows where typing goes); errors are signalled
// with aria-invalid, which also changes the border so it is not colour-on-hover alone. Read-only is a
// subtle fill (DEV-UI-01.4). Border colours carry `!`: globals.css has an unlayered `* { border-color }`
// that otherwise outranks every layered border-colour utility (the control border never applied).
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-(--control-height) w-full rounded-md border border-border-control! bg-[var(--input-background)] px-3 text-body text-ink placeholder:text-ink-faint transition-[border-color,outline-color] duration-150",
        "hover:border-ink-muted!",
        "focus-visible:border-focus! focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-focus",
        "aria-invalid:border-danger! aria-invalid:focus-visible:outline-danger",
        "disabled:cursor-not-allowed disabled:bg-[var(--disabled-background)] disabled:text-[var(--disabled-text)] disabled:border-border!",
        // Read-only (DEV-UI-01.4): still selectable and focusable, visibly not editable — the recessed
        // canvas fill (distinct from the input fill in light AND dark; surface-subtle equals the dark
        // input fill) and a quieter border, the text at full contrast.
        "[&:read-only:not(:disabled)]:bg-canvas [&:read-only:not(:disabled)]:border-border! [&:read-only:not(:disabled)]:hover:border-border!",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
