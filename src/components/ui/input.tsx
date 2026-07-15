import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-[42px] w-full rounded-[10px] border border-line-strong bg-surface px-3 text-[13.5px] text-ink placeholder:text-ink-faint outline-none transition-[box-shadow,border-color] duration-150",
        "focus-visible:border-brand-orange focus-visible:ring-[3px] focus-visible:ring-brand-orange/18",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
