"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";

// In-page popup for a config pill (VAT Settings / Currency / Number Format). Per the creation-page
// rule, clicking a config control must NOT redirect away — it opens this dialog on the same page,
// showing the current value with an optional "Open Full Settings" link (new tab, so the unsaved
// form is preserved). These org-level settings are edited in their full settings screen; the pill
// surfaces them without leaving the document.
export function PillSettingsDialog({
  locale,
  label,
  description,
  value,
  fullSettingsHref,
  trigger,
}: {
  locale: Locale;
  label: string;
  description: string;
  value?: string;
  fullSettingsHref: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t(locale, label)}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px] text-ink-muted">{t(locale, description)}</p>
          {value && (
            <p className="text-[12.5px]">
              <span className="text-ink-faint">{t(locale, "Current")}: </span>
              <span className="font-medium text-ink">{value}</span>
            </p>
          )}
        </div>
        <DialogFooter className="flex-row items-center justify-between gap-2">
          <Link href={fullSettingsHref} className="text-[12px] text-ink-muted hover:text-brand-orange inline-flex items-center gap-1" target="_blank" rel="noreferrer">
            <ExternalLink className="size-3" /> {t(locale, "Open Full Settings")}
          </Link>
          <DialogClose asChild>
            <button type="button" className="btn btn-glass">{t(locale, "Close")}</button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
