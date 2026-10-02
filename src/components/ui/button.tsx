import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Navy Command button foundation (DEV-UI-01.1, owner decision D-03): solid navy primary with white
// text, flat — no gradient, no glow, no hover lift. Colours come only from semantic tokens, so the
// per-org theme and dark mode re-map them without touching this file. Focus is a 2px orange outline
// offset from the control, shown for keyboard focus only.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent text-body font-medium font-(family-name:--font-ui) transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
  {
    variants: {
      variant: {
        // Primary action: navy fill, white label (D-03). `background` shorthand so an org theme value
        // always paints, whatever form it takes.
        primary:
          "text-[color:var(--primary-foreground)] [background:var(--primary)] hover:[background:var(--primary-hover)]",
        // Secondary: a quiet bordered action that never competes with the primary.
        secondary:
          "bg-surface text-ink border-border-strong hover:bg-surface-subtle active:bg-surface-subtle",
        // Legacy name, now the same flat bordered treatment (no blur, no translucency).
        glass:
          "bg-surface text-ink border-border-strong hover:bg-surface-subtle active:bg-surface-subtle",
        ghost: "bg-transparent text-ink-muted border-border-strong hover:bg-surface-subtle hover:text-ink",
        // Destructive stays semantically distinct from primary: danger red, never navy.
        destructive: "bg-danger text-danger-foreground hover:brightness-95",
        link: "border-0 text-link underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        // Comfortable default (D-05); compact and touch sizes share the same foundation tokens.
        default: "h-(--control-height) px-3.5",
        sm: "h-(--control-height-compact) px-3 text-body-sm",
        lg: "h-(--control-height-touch) px-4",
        icon: "size-(--control-height)",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
