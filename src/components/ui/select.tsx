"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDocumentDir } from "./use-document-dir";

// Radix Select writes its own direction onto the portalled list (default "ltr"), so in Arabic the
// options were laid out left-to-right with the tick on the physical left (DEV-UI-01.4).
function Select({ dir, ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const docDir = useDocumentDir();
  return <SelectPrimitive.Root dir={dir ?? docDir} {...props} />;
}
const SelectValue = SelectPrimitive.Value;
const SelectGroup = SelectPrimitive.Group;

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        // Same foundation as <Input> (DEV-UI-01.4): 36px control height, 6px radius, body text, control
        // border on the input background, a 2px orange outline for KEYBOARD focus only (Radix gives the
        // trigger focus on pointer activation too), aria-invalid in danger, disabled in the tokens.
        "flex h-(--control-height) w-full items-center justify-between gap-2 rounded-md border border-border-control! bg-[var(--input-background)] px-3 text-body text-ink transition-[border-color,outline-color] duration-150 data-[placeholder]:text-ink-faint",
        "hover:border-ink-muted!",
        "focus-visible:border-focus! focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-focus",
        "aria-invalid:border-danger! aria-invalid:focus-visible:outline-danger",
        "disabled:cursor-not-allowed disabled:bg-[var(--disabled-background)] disabled:text-[var(--disabled-text)] disabled:border-border!",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 shrink-0 text-ink-faint" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        className={cn(
          "z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-lg border border-line-strong bg-surface-raised shadow-glass",
          position === "popper" && "translate-y-1",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        // Logical padding + indicator (DEV-UI-01.4): the tick sits at the inline start, next to the label,
        // in Arabic as in English. Selected = the approved accent tint + accent ink, weight 600.
        "relative flex w-full cursor-default select-none items-center rounded-md py-2 ps-8 pe-3 text-body text-ink outline-none data-[highlighted]:bg-canvas data-[highlighted]:text-ink data-[state=checked]:bg-accent-tint data-[state=checked]:font-semibold data-[state=checked]:text-ink data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="absolute start-2.5 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-3.5 text-accent-ink" aria-hidden />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectValue, SelectGroup, SelectTrigger, SelectContent, SelectItem };
