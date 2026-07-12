"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast rounded-xl! border! border-line! bg-surface! text-ink! shadow-elevated!",
          description: "text-ink-muted!",
          actionButton: "bg-brand-orange! text-white!",
          cancelButton: "bg-line! text-ink-muted!",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
