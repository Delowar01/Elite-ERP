"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { LineItemsEditor, emptyLineItem, type LineItemDraft } from "../_shared/line-items-editor";
import { computeTotals, fmt } from "../_shared/totals";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Customer, Product } from "@/db";
import { createQuotationAction } from "./actions";

export function QuotationForm({ locale, customers, products }: { locale: Locale; customers: Customer[]; products: Product[] }) {
  const [customerId, setCustomerId] = useState("");
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItemDraft[]>([emptyLineItem()]);
  const [pending, startTransition] = useTransition();

  const totals = computeTotals(items);

  function submit() {
    startTransition(async () => {
      const result = await createQuotationAction({ customerId, issueDate, validUntil, notes, items });
      if (result?.error) toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-5 max-w-4xl">
      <div className="grid grid-cols-3 gap-4">
        <FormField label={t(locale, "Client")} htmlFor="q-customer">
          <Select value={customerId} onValueChange={setCustomerId}>
            <SelectTrigger id="q-customer">
              <SelectValue placeholder={t(locale, "Select a client")} />
            </SelectTrigger>
            <SelectContent>
              {customers.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label={t(locale, "Issue Date")} htmlFor="q-issue-date">
          <Input id="q-issue-date" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
        </FormField>
        <FormField label={t(locale, "Valid Till")} htmlFor="q-valid-until">
          <Input id="q-valid-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </FormField>
      </div>

      <LineItemsEditor locale={locale} products={products} items={items} onChange={setItems} pricing />

      <div className="grid grid-cols-2 gap-4">
        <FormField label={t(locale, "Notes")} htmlFor="q-notes">
          <Textarea id="q-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </FormField>
        <div className="rounded-2xl border border-line bg-surface p-4 flex flex-col gap-1.5 self-start">
          <div className="flex justify-between text-[13px]">
            <span className="text-ink-muted">{t(locale, "Subtotal")}</span>
            <span className="font-mono">{fmt(totals.subtotal)}</span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-ink-muted">{t(locale, "VAT")}</span>
            <span className="font-mono">{fmt(totals.taxTotal)}</span>
          </div>
          <div className="flex justify-between text-[15px] font-bold border-t border-line-strong mt-1 pt-2">
            <span>{t(locale, "Total")}</span>
            <span className="font-mono">{t(locale, "SAR")} {fmt(totals.total)}</span>
          </div>
        </div>
      </div>

      <div>
        <Button style={{ width: "auto" }} disabled={pending} onClick={submit}>
          {pending ? t(locale, "Saving…") : t(locale, "Save Quotation")}
        </Button>
      </div>
    </div>
  );
}
