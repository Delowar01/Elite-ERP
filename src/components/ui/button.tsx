import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Navy Command button foundation (DEV-UI-01.1, owner decision D-03; variants and sizes DEV-UI-01.4):
// solid navy primary with white text, flat — no gradient, no glow, no hover lift. Colours come only
// from semantic tokens, so the per-org theme and dark mode re-map them without touching this file.
// Focus is a 2px orange outline offset from the control, shown for keyboard focus only.
//
// Border colours carry `!` (DEV-UI-01.4): globals.css declares an UNLAYERED `* { border-color }`,
// which outranks every layered Tailwind border-colour utility — without `!` the bordered variants
// silently rendered the pale default border and "transparent" borders were not transparent.
const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent! text-body font-medium font-(family-name:--font-ui) transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
  {
    variants: {
      variant: {
        // Primary action: navy fill, white label (D-03). `background` shorthand so an org theme value
        // always paints, whatever form it takes.
        primary:
          "text-[color:var(--primary-foreground)] [background:var(--primary)] hover:[background:var(--primary-hover)]",
        // Secondary: a quiet bordered action that never competes with the primary.
        secondary:
          "bg-surface text-ink border-border-strong! hover:bg-surface-subtle active:bg-surface-subtle",
        // Legacy name — a compatibility alias of `secondary` (no blur, no translucency).
        glass:
          "bg-surface text-ink border-border-strong! hover:bg-surface-subtle active:bg-surface-subtle",
        // Bordered tertiary action on a transparent fill (what `ghost` rendered before DEV-UI-01.4).
        outline: "bg-transparent text-ink-muted border-border-strong! hover:bg-surface-subtle hover:text-ink",
        // True ghost: no border, no fill until hover — icon and tertiary actions.
        ghost: "bg-transparent text-ink-muted border-transparent! hover:bg-surface-subtle hover:text-ink",
        // Destructive stays semantically distinct from primary: danger red, never navy.
        // Semantic hover fill (--danger-hover, DEV-UI-01.4-C1) — no filter / brightness, no glow, no lift.
        destructive: "bg-danger text-danger-foreground hover:bg-danger-hover",
        // Borderless destructive (remove / delete inside a row or panel).
        "destructive-ghost": "bg-transparent text-danger border-transparent! hover:bg-danger-bg hover:text-danger",
        link: "border-0 text-link underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        // Comfortable default (D-05); compact and touch sizes share the same foundation tokens.
        default: "h-(--control-height) px-3.5",
        sm: "h-(--control-height-compact) px-3 text-body-sm",
        lg: "h-(--control-height-touch) px-4",
        icon: "size-(--control-height)",
        "icon-sm": "size-(--control-height-compact)",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

// The loading spinner (lucide's loader-circle path), inline: this primitive also renders inside Server
// Components, and the icon library's client context must not be pulled in for it. Its spin is
// neutralised by the global prefers-reduced-motion rule.
function Spinner() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="animate-spin" aria-hidden data-slot="button-spinner">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> &
  // `loading` adds a spinner next to the label, so it cannot be combined with `asChild` (Slot needs
  // exactly one child): the type forbids the combination instead of rendering broken DOM.
  ({ asChild?: false; loading?: boolean } | { asChild: true; loading?: never });

function Button({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }: ButtonProps) {
  if (asChild) {
    return (
      <Slot data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} {...(disabled !== undefined ? { disabled } : {})}>
        {children}
      </Slot>
    );
  }
  const iconOnly = size === "icon" || size === "icon-sm";
  return (
    <button
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      {...props}
    >
      {loading && <Spinner />}
      {/* Icon-only buttons swap their glyph for the spinner (the accessible name stays on the button);
          labelled buttons keep their label next to it. */}
      {loading && iconOnly ? null : children}
    </button>
  );
}

export { Button, buttonVariants };
