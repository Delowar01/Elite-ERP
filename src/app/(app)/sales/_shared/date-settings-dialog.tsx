"use client";

import { useState } from "react";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t, type Locale } from "@/lib/i18n/dict";

// In-page popup for the date gears (Valid Till / Due Date / Expected Delivery). It computes the
// target date as (base date + N days) and writes it straight into the form field — no redirect, no
// persistence needed beyond the document itself (the resulting date is saved with the document).
// Unsaved form data is fully preserved.
export function DateSettingsDialog({
  locale,
  title,
  baseDate,
  baseLabel,
  onApply,
  trigger,
}: {
  locale: Locale;
  title: string;
  /** The date the offset is measured from (e.g. the issue/order date), yyyy-mm-dd. */
  baseDate: string;
  baseLabel: string;
  onApply: (date: string) => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("30");

  const base = baseDate || new Date().toISOString().slice(0, 10);
  const preview = addDays(base, Number(days) || 0);

  function apply() {
    onApply(preview);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ds-days">{t(locale, "Days after")} {baseLabel}</Label>
            <Input id="ds-days" type="number" min={0} value={days} onChange={(e) => setDays(e.target.value)} autoFocus />
          </div>
          <p className="text-[11.5px] text-ink-faint">
            {baseLabel}: <span className="font-mono text-ink">{base}</span> → <span className="font-mono text-ink">{preview}</span>
          </p>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <button type="button" className="btn btn-glass">{t(locale, "Cancel")}</button>
          </DialogClose>
          <button type="button" className="btn btn-primary" onClick={apply}>{t(locale, "Apply")}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00");
  if (isNaN(d.getTime())) return isoDate;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
