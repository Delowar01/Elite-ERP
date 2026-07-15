"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FileMinus2 } from "lucide-react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PartyCardStatic } from "../_shared/party-card";
import { DocFieldBox } from "../_shared/doc-field-box";
import { LineItemsEditor, emptyLineItem, type LineItemDraft } from "../_shared/line-items-editor";
import { DocActionBar } from "../_shared/doc-action-bar";
import { computeTotals, fmt } from "../_shared/totals";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Product, Org } from "@/db";
import { createCreditNoteAction } from "./actions";

type InvoiceOption = { id: number; invoiceNumber: string; customerName: string; customerAddress?: string | null; customerEmail?: string | null; customerPhone?: string | null };

export function CnForm({
  locale,
  invoices,
  products,
  org,
  numberPreview,
  defaultInvoiceId,
}: {
  locale: Locale;
  invoices: InvoiceOption[];
  products: Product[];
  org: Org;
  numberPreview: string;
  defaultInvoiceId?: string;
}) {
  const [title, setTitle] = useState("");
  const [sourceInvoiceId, setSourceInvoiceId] = useState(defaultInvoiceId ?? "");
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [items, setItems] = useState<LineItemDraft[]>([emptyLineItem()]);
  const [pending, startTransition] = useTransition();

  const totals = computeTotals(items);
  const selectedInvoice = invoices.find((inv) => String(inv.id) === sourceInvoiceId);

  function submit() {
    startTransition(async () => {
      const result = await createCreditNoteAction({ title, sourceInvoiceId, reason, items });
      if (result?.error) toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-5 max-w-4xl">
      <div className="flex items-center gap-2.5">
        <FileMinus2 className="size-5 text-brand-orange" />
        <div>
          <h3 className="text-[19px] font-bold">{t(locale, "Create Credit Note")}</h3>
          <div className="text-[12px] text-ink-muted">
            {t(locale, "Issue a credit against a sent invoice — posts Dr Sales Revenue + Dr VAT Payable, Cr Accounts Receivable.")}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        <DocFieldBox label={t(locale, "CN Number")} required gear>
          {numberPreview}
        </DocFieldBox>
        <DocFieldBox label={t(locale, "Issue Date")} required mono={false}>
          <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="w-full bg-transparent outline-none" />
        </DocFieldBox>
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        <div>
          <label className="block text-[11.5px] font-semibold text-ink-muted mb-1.5">
            {t(locale, "Against Invoice")} <span className="text-brand-orange">*</span>
          </label>
          <Select value={sourceInvoiceId} onValueChange={setSourceInvoiceId}>
            <SelectTrigger className="h-[38px]">
              <SelectValue placeholder={t(locale, "Select an invoice")} />
            </SelectTrigger>
            <SelectContent>
              {invoices.map((inv) => (
                <SelectItem key={inv.id} value={String(inv.id)}>
                  {inv.invoiceNumber} · {inv.customerName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="block text-[11.5px] font-semibold text-ink-muted mb-1.5">{t(locale, "Reason")}</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full h-[38px] rounded-[9px] border border-line-strong bg-surface px-3 text-[12.5px] text-ink outline-none focus:border-brand-orange"
          />
        </div>
      </div>

      <div>
        <label className="block text-[11.5px] font-semibold text-ink-muted mb-1.5">{t(locale, "Credit Note Title")}</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full h-[38px] rounded-[9px] border border-line-strong bg-surface px-3 text-[12.5px] text-ink outline-none focus:border-brand-orange"
        />
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        <PartyCardStatic label={t(locale, "From")} name={org.name} address={org.address} email={org.email} phone={org.phone} />
        {selectedInvoice ? (
          <PartyCardStatic
            label={t(locale, "To Client")}
            name={selectedInvoice.customerName}
            address={selectedInvoice.customerAddress}
            email={selectedInvoice.customerEmail}
            phone={selectedInvoice.customerPhone}
          />
        ) : (
          <div className="rounded-2xl border border-line bg-surface shadow-elevated p-4 flex items-center text-[12.5px] text-ink-faint">
            {t(locale, "Select an invoice to load the client.")}
          </div>
        )}
      </div>

      <LineItemsEditor locale={locale} products={products} items={items} onChange={setItems} pricing />

      <div className="flex justify-end">
        <div className="rounded-2xl border border-line bg-surface shadow-elevated p-4 flex flex-col gap-1.5 w-72">
          <div className="flex justify-between text-[13px]">
            <span className="text-ink-muted">{t(locale, "VAT")}</span>
            <span className="font-mono">{fmt(totals.taxTotal)}</span>
          </div>
          <div className="flex justify-between text-[15px] font-bold border-t border-line-strong mt-1 pt-2">
            <span>{t(locale, "Credit Total")}</span>
            <span className="font-mono">{t(locale, "SAR")} {fmt(totals.total)}</span>
          </div>
        </div>
      </div>

      <DocActionBar locale={locale} pending={pending} onSubmit={submit} primaryLabel="Save as Draft" />
    </div>
  );
}
