"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { LineItemsEditor, emptyLineItem, type LineItemDraft } from "../_shared/line-items-editor";
import { computeTotals, fmt } from "../_shared/totals";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Product } from "@/db";
import { createCreditNoteAction } from "./actions";

type InvoiceOption = { id: number; invoiceNumber: string; customerName: string };

export function CnForm({
  locale,
  invoices,
  products,
  defaultInvoiceId,
}: {
  locale: Locale;
  invoices: InvoiceOption[];
  products: Product[];
  defaultInvoiceId?: string;
}) {
  const [sourceInvoiceId, setSourceInvoiceId] = useState(defaultInvoiceId ?? "");
  const [reason, setReason] = useState("");
  const [items, setItems] = useState<LineItemDraft[]>([emptyLineItem()]);
  const [pending, startTransition] = useTransition();

  const totals = computeTotals(items);

  function submit() {
    startTransition(async () => {
      const result = await createCreditNoteAction({ sourceInvoiceId, reason, items });
      if (result?.error) toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <div className="grid grid-cols-2 gap-4">
        <FormField label={t(locale, "Against Invoice")} htmlFor="cn-invoice">
          <Select value={sourceInvoiceId} onValueChange={setSourceInvoiceId}>
            <SelectTrigger id="cn-invoice">
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
        </FormField>
        <FormField label={t(locale, "Reason")} htmlFor="cn-reason">
          <Textarea id="cn-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={1} />
        </FormField>
      </div>

      <LineItemsEditor locale={locale} products={products} items={items} onChange={setItems} pricing />

      <div className="flex justify-end">
        <div className="rounded-2xl border border-line bg-surface p-4 flex flex-col gap-1.5 w-72">
          <div className="flex justify-between text-[13px]">
            <span className="text-ink-muted">{t(locale, "Subtotal")}</span>
            <span className="font-mono">{fmt(totals.subtotal)}</span>
          </div>
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

      <div>
        <Button style={{ width: "auto" }} disabled={pending} onClick={submit}>
          {pending ? t(locale, "Saving…") : t(locale, "Save Credit Note")}
        </Button>
      </div>
    </div>
  );
}
