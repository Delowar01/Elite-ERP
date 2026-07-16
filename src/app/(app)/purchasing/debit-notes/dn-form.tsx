"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FileMinus2 } from "lucide-react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PartyCardStatic } from "../../sales/_shared/party-card";
import { DocFieldBox } from "../../sales/_shared/doc-field-box";
import { LineItemsEditor, emptyLineItem, type LineItemDraft } from "../../sales/_shared/line-items-editor";
import { DocFooterContact } from "../../sales/_shared/doc-footer-contact";
import { DocActionBar } from "../../sales/_shared/doc-action-bar";
import { Money } from "../../sales/_shared/money";
import { computeTotals } from "../../sales/_shared/totals";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Product, Org } from "@/db";
import { createDebitNoteAction } from "./actions";

type PoOption = { id: number; poNumber: string; vendorName: string; vendorAddress?: string | null; vendorEmail?: string | null; vendorPhone?: string | null };

export function DnForm({
  locale,
  purchaseOrders,
  products,
  org,
  numberPreview,
  defaultPoId,
}: {
  locale: Locale;
  purchaseOrders: PoOption[];
  products: Product[];
  org: Org;
  numberPreview: string;
  defaultPoId?: string;
}) {
  const [sourcePurchaseOrderId, setSourcePurchaseOrderId] = useState(defaultPoId ?? "");
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [items, setItems] = useState<LineItemDraft[]>([emptyLineItem()]);
  const [pending, startTransition] = useTransition();

  const totals = computeTotals(items);
  const selectedPo = purchaseOrders.find((po) => String(po.id) === sourcePurchaseOrderId);

  function submit() {
    startTransition(async () => {
      const result = await createDebitNoteAction({ title: "", sourcePurchaseOrderId, reason, items });
      if (result?.error) toast.error(result.error);
    });
  }

  return (
    <div className="max-w-4xl">
      <div className="doc-titlebar">
        <div>
          <h3>
            <FileMinus2 className="size-5" style={{ color: "var(--brand-orange)" }} /> {t(locale, "Create Debit Note")}
          </h3>
          <div className="sub">{t(locale, "Issue a debit against a received purchase order — posts Dr Accounts Payable, Cr Inventory.")}</div>
        </div>
        <div className="doc-titlebar-actions">
          <button type="button" className="btn btn-glass" disabled>
            {t(locale, "Save as Draft")}
          </button>
        </div>
      </div>

      <div className="doc-header-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <DocFieldBox label={t(locale, "DN Number")} required gear>
          {numberPreview}
        </DocFieldBox>
        <DocFieldBox label={t(locale, "Issue Date")} required>
          <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="w-full bg-transparent outline-none" />
        </DocFieldBox>
      </div>

      <div className="doc-header-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="doc-field">
          <label>
            {t(locale, "Against PO")} <span className="req">*</span>
          </label>
          <div className="doc-field-input-row">
            <Select value={sourcePurchaseOrderId} onValueChange={setSourcePurchaseOrderId}>
              <SelectTrigger className="input plain h-[38px] w-full border-0 shadow-none justify-between">
                <SelectValue placeholder={t(locale, "Select a purchase order")} />
              </SelectTrigger>
              <SelectContent>
                {purchaseOrders.map((po) => (
                  <SelectItem key={po.id} value={String(po.id)}>
                    {po.poNumber} · {po.vendorName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DocFieldBox label={t(locale, "Reason")} plain>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full bg-transparent outline-none" />
        </DocFieldBox>
      </div>

      <div className="doc-meta-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <PartyCardStatic label={t(locale, "From")} name={org.name} address={org.address} email={org.email} phone={org.phone} />
        {selectedPo ? (
          <PartyCardStatic
            label={t(locale, "To Vendor")}
            name={selectedPo.vendorName}
            address={selectedPo.vendorAddress}
            email={selectedPo.vendorEmail}
            phone={selectedPo.vendorPhone}
          />
        ) : (
          <div className="card party-card-v2 flex items-center text-[12.5px] text-ink-faint">{t(locale, "Select a purchase order to load the vendor.")}</div>
        )}
      </div>

      <LineItemsEditor locale={locale} products={products} items={items} onChange={setItems} variant="simple" />

      <div className="card totals-strip" style={{ maxWidth: 340, marginInlineStart: "auto", marginTop: 16 }}>
        <div className="t-row">
          <span>{t(locale, "VAT")} (15%)</span>
          <span className="v">
            <Money amount={totals.taxTotal} />
          </span>
        </div>
        <div className="t-row final">
          <span>{t(locale, "Debit Total")}</span>
          <span className="v">
            <Money amount={totals.total} />
          </span>
        </div>
      </div>

      <DocFooterContact locale={locale} email={org.email} phone={org.phone} />

      <DocActionBar locale={locale} pending={pending} onSubmit={submit} primaryLabel="Save as Draft" />
    </div>
  );
}
