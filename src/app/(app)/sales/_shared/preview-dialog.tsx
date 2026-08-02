"use client";

import { Fragment, useState } from "react";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import { richTextToHtml } from "@/lib/sanitize-html";
import { CurrencyMark, useCurrency } from "@/components/ui/currency-mark";
import { formatAmount, formatRate, formatQuantity, markFormat } from "@/lib/currency/currencies";
import { DocumentTermsView } from "./terms-view";
import type { DocumentTerm } from "./document-terms";
import type { DocBankAccount } from "@/lib/document-bank-accounts";

export type PreviewParty = { label: string; name: string; lines: (string | null | undefined)[] };
// unitPrice / lineTotal / quantity are RAW numeric strings; the preview formats them with the org's
// Number Format (grouping + decimals + rounding), so Preview matches the detail page, print and PDF.
export type PreviewItem = { description: string; desc?: string; quantity: string; unitPrice?: string; lineTotal?: string };
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
  terms?: DocumentTerm[];
  currency: string;
  bankAccounts?: DocBankAccount[];
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
  const mark = useCurrency();
  const cfg = markFormat(mark);
  const sym = <CurrencyMark mark={mark} />;
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
              {data.items.map((it, i) => {
                const cols = data.showPricing ? 4 : 2;
                return (
                  <Fragment key={i}>
                    <tr className={it.desc && it.desc.trim() ? "" : "border-b border-[#eee]"}>
                      <td className="py-1">{it.description || "—"}</td>
                      <td className="py-1 text-right">{formatQuantity(it.quantity, cfg)}</td>
                      {data.showPricing && <td className="py-1 text-right">{it.unitPrice !== undefined ? formatRate(it.unitPrice, cfg) : ""}</td>}
                      {data.showPricing && <td className="py-1 text-right">{it.lineTotal !== undefined ? formatAmount(it.lineTotal, cfg) : ""}</td>}
                    </tr>
                    {it.desc && it.desc.trim() && (
                      <tr className="border-b border-[#eee]">
                        <td colSpan={cols} className="pb-1.5 text-[11.5px] text-[#555] line-desc-cell">
                          <span className="rich-html" dangerouslySetInnerHTML={{ __html: richTextToHtml(it.desc) }} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {data.showPricing && data.totals && (
            <div className="flex flex-col items-end gap-0.5 text-[12px] mb-3">
              <Row label={t(locale, "Sub Total")} value={<>{sym} {formatAmount(data.totals.subtotal, cfg)}</>} />
              {Number(data.totals.discount) > 0 && <Row label={t(locale, "Discount")} value={<>- {sym} {formatAmount(data.totals.discount, cfg)}</>} />}
              <Row label={t(locale, "VAT Total")} value={<>{sym} {formatAmount(data.totals.taxTotal, cfg)}</>} />
              <Row label={t(locale, "Grand Total")} value={<>{sym} {formatAmount(data.totals.total, cfg)}</>} bold />
            </div>
          )}
          {data.bankAccounts && data.bankAccounts.length > 0 && (
            <div className="border-t border-[#eee] pt-2 mb-3">
              <div className="font-semibold text-[11px] uppercase tracking-wide text-[#777] mb-1.5">{t(locale, "Bank Details")}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {data.bankAccounts.map((a, i) => (
                  <PreviewBankBlock key={a.id ?? i} locale={locale} account={a} />
                ))}
              </div>
            </div>
          )}
          {data.terms && data.terms.length > 0 && (
            <div className="border-t border-[#eee] pt-2">
              <DocumentTermsView locale={locale} terms={data.terms} />
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

function PreviewBankBlock({ locale, account }: { locale: Locale; account: DocBankAccount }) {
  const rows: [string, string | null | undefined][] = [
    [t(locale, "Bank Name"), account.bankName],
    [t(locale, "Account Holder Name"), account.accountHolder],
    [t(locale, "Account Number"), account.accountNumber],
    [t(locale, "IBAN"), account.iban],
    [t(locale, "SWIFT / BIC"), account.swift],
    [t(locale, "Currency"), account.currency],
    [t(locale, "Branch"), account.branch],
  ];
  return (
    <div className="rounded-[8px] border border-[#ddd] p-2.5">
      <div className="font-semibold text-[12px] mb-0.5">{account.name}</div>
      {rows.map(([k, v], i) =>
        v && v.trim() ? (
          <div key={i} className="flex gap-3 text-[11px]">
            <span className="w-36 shrink-0 text-[#777]">{k}</span>
            <span className="min-w-0 flex-1 break-words">{v}</span>
          </div>
        ) : null,
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: React.ReactNode; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-8 w-52 ${bold ? "font-bold border-t border-[#ddd] pt-1" : ""}`}>
      <span className="text-[#777]">{label}</span>
      <span>{value}</span>
    </div>
  );
}
