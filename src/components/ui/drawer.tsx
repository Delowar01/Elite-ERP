"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Same Radix Dialog primitive Modal (dialog.tsx) is built on, side-anchored instead of centered —
// for row detail previews / quick-edit panels once a screen needs one, not centered-modal chrome.
const Drawer = DialogPrimitive.Root;
const DrawerTrigger = DialogPrimitive.Trigger;
const DrawerClose = DialogPrimitive.Close;

function DrawerContent({
  className,
  children,
  side = "right",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { side?: "left" | "right" }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-brand-navy-deep/40 backdrop-blur-[2px] data-[state=open]:animate-fade-up" />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-0 z-50 h-full w-full max-w-md border-line bg-surface p-6 shadow-glass outline-none overflow-y-auto",
          side === "right" ? "right-0 border-l" : "left-0 border-r",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 text-ink-faint hover:text-ink outline-none">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5 mb-4", className)} {...props} />;
}

function DrawerTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-lg font-bold text-ink", className)} {...props} />;
}

function DrawerDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-[13px] text-ink-muted", className)} {...props} />;
}

export { Drawer, DrawerTrigger, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription };
