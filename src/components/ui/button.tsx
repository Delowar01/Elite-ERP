import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[13.5px] font-semibold font-(family-name:--font-body) transition-[transform,box-shadow,filter] duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 outline-none focus-visible:ring-[3px] focus-visible:ring-brand-orange/30",
  {
    variants: {
      variant: {
        primary:
          "text-white shadow-[0_6px_18px_-4px_rgba(232,119,34,0.55)] bg-linear-to-br from-brand-orange-light to-brand-orange hover:brightness-105 hover:-translate-y-px active:translate-y-0 active:brightness-95",
        secondary:
          "bg-brand-navy text-white shadow-elevated hover:-translate-y-px hover:shadow-elevated-hover active:translate-y-0 active:brightness-95",
        glass:
          "bg-surface/80 backdrop-blur-md border border-line-strong text-ink hover:bg-surface active:bg-canvas",
        ghost: "text-ink-muted border border-line-strong bg-transparent hover:bg-surface active:bg-canvas",
        destructive: "bg-danger text-white hover:brightness-105 active:brightness-95",
        link: "text-brand-orange underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        default: "h-[42px] px-4",
        sm: "h-8 px-3 text-[12.5px]",
        lg: "h-11 px-6",
        icon: "h-10 w-10",
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
