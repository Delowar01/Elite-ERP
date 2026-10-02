"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Same Radix Dialog primitive Modal (dialog.tsx) is built on, side-anchored instead of centered.
// Radix supplies the focus trap, focus return, Escape and the inert background. Sides are LOGICAL
// (start/end), so the drawer follows the document direction in Arabic. First user: the mobile
// navigation drawer (DEV-UI-01.3).
const Drawer = DialogPrimitive.Root;
const DrawerTrigger = DialogPrimitive.Trigger;
const DrawerClose = DialogPrimitive.Close;

function DrawerContent({
  className,
  children,
  side = "end",
  closeLabel = "Close",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** Logical edge: "start" is left in LTR / right in RTL; "end" is the opposite. */
  side?: "start" | "end";
  /** Accessible name of the close button (pass a translated string). */
  closeLabel?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      {/* Plain dim overlay — no blur, no decorative animation (DEV-UI-01.3). */}
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-brand-navy-deep/40" />
      <DialogPrimitive.Content
        data-side={side}
        className={cn(
          "fixed top-0 z-50 h-full w-full max-w-md border-line bg-surface p-6 shadow-glass outline-none overflow-y-auto",
          side === "start" ? "start-0 border-e" : "end-0 border-s",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="drawer-close absolute end-4 top-4 rounded-md p-1 text-ink-faint hover:text-ink outline-none focus-visible:ring-2 focus-visible:ring-focus">
          <XIcon className="size-4" aria-hidden />
          <span className="sr-only">{closeLabel}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5 mb-4", className)} {...props} />;
}

function DrawerTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-title font-semibold text-ink", className)} {...props} />;
}

function DrawerDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-body text-ink-muted", className)} {...props} />;
}

export { Drawer, DrawerTrigger, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription };
