"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import { richTextToHtml } from "@/lib/sanitize-html";

export type PreviewParty = { label: string; name: string; lines: (string | null | undefined)[] };
export type PreviewItem = { description: string; quantity: string; unitPrice?: string; lineTotal?: string };
export type PreviewData = {
  docLabel: string;
  number: string;
  title?: string;
  fields: { label: string; value: string }[];
  from: PreviewParty;
  to?: PreviewParty;
  items: PreviewItem[];
  showPricing: boolean;
  totals?: { subtotal: string; discount: string; taxTotal: string; total: string };
  notes?: string;
  currency: string;
};

// In-page Preview & Print modal built from the CURRENT unsaved form state (passed as `data`). The
// creation page and all its unsaved fields stay mounted behind the modal; printing is scoped to the
// preview only (see .preview-print-area print CSS), so nothing is lost and no redirect happens.
export function PreviewDialog({
  locale,
  data,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  locale: Locale;
  data: PreviewData;
  trigger?: React.ReactNode;
  /** Controlled mode (e.g. opened from a More Actions menu item). */
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;
  const setOpen = onOpenChange ?? setUncontrolled;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>{t(locale, "Preview")} — {data.docLabel}</DialogTitle>
        </DialogHeader>
        <div className="preview-print-area rounded-[10px] border border-line bg-white text-[#111] p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="text-lg font-bold">{data.docLabel}</div>
              <div className="font-mono text-[13px]">{data.number}</div>
              {data.title && <div className="text-[13px] text-[#555] mt-1">{data.title}</div>}
            </div>
            <div className="text-[12px] text-right">
              {data.fields.map((f) => (
                <div key={f.label}>
                  <span className="text-[#777]">{f.label}: </span>
                  {f.value || "—"}
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <PartyBlock party={data.from} />
            {data.to && <PartyBlock party={data.to} />}
          </div>
          <table className="w-full text-[12px] border-collapse mb-4">
            <thead>
              <tr className="border-b-2 border-[#ddd] text-left">
                <th className="py-1">{t(locale, "Item Description")}</th>
                <th className="py-1 text-right">{t(locale, "Qty")}</th>
                {data.showPricing && <th className="py-1 text-right">{t(locale, "Unit Price")}</th>}
                {data.showPricing && <th className="py-1 text-right">{t(locale, "Amount")}</th>}
              </tr>
            </thead>
            <tbody>
              {data.items.map((it, i) => (
                <tr key={i} className="border-b border-[#eee]">
                  <td className="py-1">{it.description || "—"}</td>
                  <td className="py-1 text-right">{it.quantity}</td>
                  {data.showPricing && <td className="py-1 text-right">{it.unitPrice}</td>}
                  {data.showPricing && <td className="py-1 text-right">{it.lineTotal}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {data.showPricing && data.totals && (
            <div className="flex flex-col items-end gap-0.5 text-[12px] mb-3">
              <Row label={t(locale, "Sub Total")} value={`${data.currency} ${data.totals.subtotal}`} />
              {Number(data.totals.discount) > 0 && <Row label={t(locale, "Discount")} value={`- ${data.currency} ${data.totals.discount}`} />}
              <Row label={t(locale, "VAT Total")} value={`${data.currency} ${data.totals.taxTotal}`} />
              <Row label={t(locale, "Grand Total")} value={`${data.currency} ${data.totals.total}`} bold />
            </div>
          )}
          {data.notes && (
            <div className="text-[11.5px] text-[#444] border-t border-[#eee] pt-2">
              <div className="font-semibold mb-1">{t(locale, "Notes")}</div>
              <div dangerouslySetInnerHTML={{ __html: richTextToHtml(data.notes) }} />
            </div>
          )}
        </div>
        <DialogFooter className="preview-no-print">
          <DialogClose asChild>
            <button type="button" className="btn btn-glass">{t(locale, "Close")}</button>
          </DialogClose>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            <Printer className="size-3.5" /> {t(locale, "Print")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PartyBlock({ party }: { party: PreviewParty }) {
  return (
    <div className="text-[12px]">
      <div className="text-[#777] text-[10px] uppercase tracking-wide">{party.label}</div>
      <div className="font-semibold">{party.name || "—"}</div>
      {party.lines.filter(Boolean).map((l, i) => (
        <div key={i} className="text-[#555]">{l}</div>
      ))}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-8 w-52 ${bold ? "font-bold border-t border-[#ddd] pt-1" : ""}`}>
      <span className="text-[#777]">{label}</span>
      <span>{value}</span>
    </div>
  );
}
