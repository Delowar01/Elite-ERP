"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LayoutGrid, ChevronUp, ChevronDown, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { t, type Locale } from "@/lib/i18n/dict";
import { DEFAULT_DASHBOARD_LAYOUT, labelFor, type DashboardLayoutItem } from "@/lib/dashboard-layout";
import { saveDashboardLayoutAction } from "./dashboard-prefs-actions";

// Dashboard layout customization — show/hide + reorder widgets, saved per user. Reordering the
// DOM order is enough: the dash-grid auto-places widgets by their grid spans in source order.
export function CustomizeLayoutDialog({ locale, layout }: { locale: Locale; layout: DashboardLayoutItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<DashboardLayoutItem[]>(layout);
  const [pending, startTransition] = useTransition();

  function toggle(key: string) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, visible: !it.visible } : it)));
  }
  function move(idx: number, dir: -1 | 1) {
    setItems((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }
  function reset() {
    setItems(DEFAULT_DASHBOARD_LAYOUT);
  }
  function save() {
    startTransition(async () => {
      const res = await saveDashboardLayoutAction(items);
      if (res.error) toast.error(res.error);
      else {
        toast.success(t(locale, "Layout saved."));
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setItems(layout); }}>
      <DialogTrigger asChild>
        <button type="button" className="btn btn-glass">
          <LayoutGrid className="size-3.5" /> {t(locale, "Customize Layout")}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t(locale, "Customize Layout")}</DialogTitle>
          <DialogDescription>{t(locale, "Show, hide and reorder your dashboard widgets.")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1">
          {items.map((it, idx) => (
            <div key={it.key} className="flex items-center gap-3 py-2 border-b border-line last:border-0">
              <Checkbox checked={it.visible} onCheckedChange={() => toggle(it.key)} id={`w-${it.key}`} />
              <label htmlFor={`w-${it.key}`} className="flex-1 text-[13px] cursor-pointer select-none">
                {t(locale, labelFor(it.key))}
              </label>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0} className="p-1 text-ink-faint hover:text-ink disabled:opacity-30" aria-label={t(locale, "Move up")}>
                  <ChevronUp className="size-4" />
                </button>
                <button type="button" onClick={() => move(idx, 1)} disabled={idx === items.length - 1} className="p-1 text-ink-faint hover:text-ink disabled:opacity-30" aria-label={t(locale, "Move down")}>
                  <ChevronDown className="size-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter className="flex-row items-center justify-between gap-2">
          <button type="button" className="btn btn-ghost text-[12.5px]" onClick={reset} disabled={pending}>
            <RotateCcw className="size-3.5" /> {t(locale, "Reset to default")}
          </button>
          <div className="flex items-center gap-2">
            <DialogClose asChild>
              <button type="button" className="btn btn-glass" disabled={pending}>{t(locale, "Cancel")}</button>
            </DialogClose>
            <button type="button" className="btn btn-primary" onClick={save} disabled={pending}>{t(locale, "Save")}</button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
