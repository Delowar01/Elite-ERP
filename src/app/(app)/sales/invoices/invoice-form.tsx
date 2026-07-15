"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Receipt } from "lucide-react";
import { PartyCardStatic, PartyCardSelect } from "../_shared/party-card";
import { DocFieldBox } from "../_shared/doc-field-box";
import { LineItemsEditor, emptyLineItem, type LineItemDraft } from "../_shared/line-items-editor";
import { TotalsCard } from "../_shared/totals-card";
import { NoteBox } from "../_shared/note-box";
import { SealSignaturePreview } from "../_shared/seal-signature";
import { DocActionBar } from "../_shared/doc-action-bar";
import { EInvoicePreviewPanel } from "../_shared/einvoice-preview-panel";
import { computeTotals } from "../_shared/totals";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Customer, Product, Org } from "@/db";
import { createInvoiceAction } from "./actions";

export function InvoiceForm({
  locale,
  customers,
  products,
  org,
  numberPreview,
}: {
  locale: Locale;
  customers: Customer[];
  products: Product[];
  org: Org;
  numberPreview: string;
}) {
  const [title, setTitle] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [discount, setDiscount] = useState("0");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItemDraft[]>([emptyLineItem()]);
  const [pending, startTransition] = useTransition();

  const totals = computeTotals(items, discount);

  function submit() {
    startTransition(async () => {
      const result = await createInvoiceAction({ title, customerId, issueDate, dueDate, discount, notes, items });
      if (result?.error) toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-5 max-w-6xl">
      <div className="flex items-center gap-2.5">
        <Receipt className="size-5 text-brand-orange" />
        <div>
          <h3 className="text-[19px] font-bold">{t(locale, "Create Invoice")}</h3>
          <div className="text-[12px] text-ink-muted">{t(locale, "Issue a tax invoice — posts to the ledger and decrements stock on send.")}</div>
        </div>
      </div>

      <div className="grid grid-cols-[1.7fr_1fr] gap-5 items-start">
        <div className="flex flex-col gap-3.5">
          <div className="grid grid-cols-2 gap-3.5">
            <DocFieldBox label={t(locale, "Invoice Number")} required gear>
              {numberPreview}
            </DocFieldBox>
            <DocFieldBox label={t(locale, "Issue Date")} required mono={false}>
              <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="w-full bg-transparent outline-none" />
            </DocFieldBox>
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <DocFieldBox label={t(locale, "Due Date")} required mono={false}>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full bg-transparent outline-none" />
            </DocFieldBox>
            <div />
          </div>
          <div>
            <label className="block text-[11.5px] font-semibold text-ink-muted mb-1.5">{t(locale, "Invoice Title")}</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t(locale, "Write invoice title here…")}
              className="w-full h-[38px] rounded-[9px] border border-line-strong bg-surface px-3 text-[12.5px] text-ink outline-none focus:border-brand-orange"
            />
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-linear-to-br from-surface-raised to-surface shadow-elevated flex flex-col items-center justify-center gap-1.5 py-6 text-center">
          {org.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logoUrl} alt={org.name} className="h-11 w-11 rounded-xl object-cover" />
          ) : (
            <div className="size-11 rounded-xl bg-brand-navy flex items-center justify-center text-white font-display font-bold">{org.name.slice(0, 1)}</div>
          )}
          <div className="font-display font-extrabold text-[19px] text-ink">{org.name}</div>
          <div className="text-[9.5px] font-semibold tracking-[0.16em] text-brand-orange uppercase">
            {org.vatNumber ? `VAT ${org.vatNumber}` : org.currency} · {org.country ?? ""}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        <PartyCardStatic label={t(locale, "From")} name={org.name} address={org.address} email={org.email} phone={org.phone} />
        <PartyCardSelect locale={locale} label={t(locale, "To Client")} customers={customers} value={customerId} onChange={setCustomerId} />
      </div>

      <LineItemsEditor locale={locale} products={products} items={items} onChange={setItems} pricing />

      <div className="grid grid-cols-[1.5fr_1fr] gap-5 items-start">
        <NoteBox locale={locale} label={t(locale, "Notes")} value={notes} onChange={setNotes} />
        <div className="flex flex-col gap-4">
          <TotalsCard locale={locale} subtotal={totals.subtotal} discount={discount} onDiscountChange={setDiscount} taxTotal={totals.taxTotal} total={totals.total} />
          <EInvoicePreviewPanel locale={locale} vatNumber={org.vatNumber} taxTotal={totals.taxTotal} />
        </div>
      </div>

      <SealSignaturePreview locale={locale} sealUrl={org.sealUrl} signatureUrl={org.signatureUrl} />

      <DocActionBar locale={locale} pending={pending} onSubmit={submit} primaryLabel="Save as Draft" />
    </div>
  );
}
