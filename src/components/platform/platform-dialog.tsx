"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";

// The console's modal: the same Radix primitive and look as the shared DialogContent (centred with logical
// insets, so nothing is physical-direction),
// with a LOCALIZED close label (the shared component's is fixed English) and an optional
// non-dismissible mode for the "save your recovery codes" step, where an accidental Escape or
// outside click would lose codes that are shown only once. Radix provides the focus trap, focus
// return, the inert page and aria-labelledby/-describedby.
export function PlatformDialog({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  dismissible = true,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  closeLabel: string;
  dismissible?: boolean;
  children: React.ReactNode;
}) {
  const block = (e: Event) => {
    if (!dismissible) e.preventDefault();
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-fade-up" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 m-auto h-fit w-[calc(100%-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg border border-line bg-surface-raised p-6 shadow-glass outline-none focus-visible:outline-2 focus-visible:outline-focus"
          onEscapeKeyDown={block}
          onPointerDownOutside={block}
          onInteractOutside={block}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <DialogPrimitive.Title className="text-lg font-semibold tracking-tight text-ink pe-8">{title}</DialogPrimitive.Title>
          {description && <DialogPrimitive.Description className="mt-1.5 text-body text-ink-muted">{description}</DialogPrimitive.Description>}
          <div className="mt-5">{children}</div>
          {dismissible && (
            <DialogPrimitive.Close className="absolute end-4 top-4 rounded-md p-1 text-ink-faint hover:text-ink outline-none focus-visible:outline-2 focus-visible:outline-focus">
              <XIcon className="size-4" aria-hidden />
              <span className="sr-only">{closeLabel}</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
