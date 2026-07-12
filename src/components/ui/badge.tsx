import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold before:size-1.5 before:rounded-full before:bg-current",
  {
    variants: {
      variant: {
        success: "bg-success-bg text-success",
        warning: "bg-warning-bg text-warning",
        danger: "bg-danger-bg text-danger",
        info: "bg-info-bg text-info",
        neutral: "bg-line/60 text-ink-muted",
      },
      live: {
        true: "before:animate-[pulse-ring_1.8s_infinite]",
        false: "",
      },
    },
    defaultVariants: { variant: "neutral", live: false },
  },
);

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
