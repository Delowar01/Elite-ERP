"use client";

import { useState } from "react";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t, type Locale } from "@/lib/i18n/dict";
import { updateValidityDaysAction } from "../../settings/organization/actions";

// The Valid Till gear popup (Issue #4). Instead of writing a one-off date, it captures the number of
// days after the Issue Date and REMEMBERS it for future documents (persisted on the org via
// updateValidityDaysAction). The form then auto-computes Valid Till = Issue Date + N days and
// recalculates it whenever the Issue Date changes. No redirect; unsaved document data is preserved.
export function ValidityDaysDialog({
  locale,
  title,
  baseDate,
  baseLabel,
  initialDays,
  onApply,
  trigger,
}: {
  locale: Locale;
  title: string;
  /** The date the offset is measured from (the Issue Date), yyyy-mm-dd. */
  baseDate: string;
  baseLabel: string;
  initialDays: number;
  /** Receives the chosen number of days; the form re-enables auto-calc and recomputes Valid Till. */
  onApply: (days: number) => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(String(initialDays));

  const base = baseDate || new Date().toISOString().slice(0, 10);
  const n = Math.max(0, Math.round(Number(days) || 0));
  const preview = addDays(base, n);

  function apply() {
    onApply(n);
    // Remember for future documents. Fire-and-forget; a permission failure never blocks the local
    // apply, so the current document still gets its computed date.
    void updateValidityDaysAction(n);
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
            <Label htmlFor="vd-days">
              {t(locale, "Days after")} {baseLabel}
            </Label>
            <Input id="vd-days" type="number" min={0} value={days} onChange={(e) => setDays(e.target.value)} autoFocus />
          </div>
          <p className="text-[11.5px] text-ink-faint">
            {baseLabel}: <span className="font-mono text-ink">{base}</span> → <span className="font-mono text-ink">{preview}</span>
          </p>
          <p className="text-[11px] text-ink-faint">{t(locale, "Remembered for future documents and recalculated when the Issue Date changes.")}</p>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <button type="button" className="btn btn-glass">
              {t(locale, "Cancel")}
            </button>
          </DialogClose>
          <button type="button" className="btn btn-primary" onClick={apply}>
            {t(locale, "Apply")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00");
  if (isNaN(d.getTime())) return isoDate;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
