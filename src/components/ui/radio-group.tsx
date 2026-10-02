"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// Radio group on NATIVE radio inputs (DEV-UI-01.4, R4 — no new dependency). The browser supplies the
// semantics and the keyboard model: one Tab stop for the group, arrow keys move the selection, Space
// selects. Controlled: `value` + `onValueChange`. The circle is the input itself (appearance:none):
// control border when off, a thick primary-navy ring when on (graphical contrast ≥ 3:1), the 2px
// orange outline for keyboard focus, disabled in the semantic tokens. Label order follows the
// document direction (flex), so it mirrors in Arabic.

type Ctx = { name: string; value: string; onValueChange: (v: string) => void; disabled?: boolean };
const RadioGroupContext = React.createContext<Ctx | null>(null);

function RadioGroup({
  name,
  value,
  onValueChange,
  disabled,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "onChange" | "defaultValue"> & {
  /** Shared native `name` — choose one that does not collide with a field the enclosing form submits. */
  name: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <RadioGroupContext.Provider value={{ name, value, onValueChange, disabled }}>
      <div role="radiogroup" data-slot="radio-group" aria-disabled={disabled || undefined} className={cn("flex flex-wrap items-center gap-6", className)} {...props}>
        {children}
      </div>
    </RadioGroupContext.Provider>
  );
}

function RadioGroupItem({
  value,
  children,
  disabled,
  className,
  id,
}: {
  value: string;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const ctx = React.useContext(RadioGroupContext);
  if (!ctx) throw new Error("RadioGroupItem must be rendered inside a RadioGroup");
  const autoId = React.useId();
  const inputId = id ?? autoId;
  const checked = ctx.value === value;
  const isDisabled = ctx.disabled || disabled;
  return (
    <label
      htmlFor={inputId}
      data-slot="radio-group-item"
      className={cn(
        "inline-flex min-h-6 items-center gap-2.5 text-body-lg text-ink",
        isDisabled ? "cursor-not-allowed text-[var(--disabled-text)]" : "cursor-pointer",
        className,
      )}
    >
      <input
        id={inputId}
        type="radio"
        name={ctx.name}
        value={value}
        checked={checked}
        disabled={isDisabled}
        onChange={() => ctx.onValueChange(value)}
        data-slot="radio"
        className={cn(
          "size-4 shrink-0 appearance-none rounded-full border border-border-control! bg-[var(--input-background)] transition-[border-color,border-width] duration-150",
          "checked:border-[5px] checked:border-[color:var(--primary)]!",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
          "disabled:border-border! disabled:bg-[var(--disabled-background)] disabled:checked:border-[color:var(--disabled-text)]!",
        )}
      />
      <span className={cn(checked && "font-medium")}>{children}</span>
    </label>
  );
}

export { RadioGroup, RadioGroupItem };
