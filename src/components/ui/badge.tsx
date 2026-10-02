import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Matches the mockup's .pill/.pill-* exactly (literal classes, mockup-parity.css).
const badgeVariants = cva("pill", {
  variants: {
    variant: {
      success: "pill-success",
      warning: "pill-warning",
      danger: "pill-danger",
      info: "pill-info",
      neutral: "pill-neutral",
      // DEV-UI-01.2: corrective tone from the approved --corrective tokens (generic Badge only;
      // status presentation uses <StatusBadge>).
      corrective: "pill-corrective",
    },
    live: {
      true: "live",
      false: "",
    },
  },
  defaultVariants: { variant: "neutral", live: false },
});

function Badge({
  className,
  variant,
  live,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, live, className }))}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
