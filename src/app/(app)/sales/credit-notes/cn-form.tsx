"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FileMinus2 } from "lucide-react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PartyCardStatic } from "../_shared/party-card";
import { DocFieldBox } from "../_shared/doc-field-box";
import { LineItemsEditor, emptyLineItem, type LineItemDraft } from "../_shared/line-items-editor";
import { DocFooterContact } from "../_shared/doc-footer-contact";
import { DocActionBar } from "../_shared/doc-action-bar";
import { Money } from "../_shared/money";
import { computeTotals } from "../_shared/totals";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Product, Org } from "@/db";
import { createCreditNoteAction, updateCreditNoteAction } from "./actions";

type InvoiceOption = { id: number; invoiceNumber: string; customerName: string; customerAddress?: string | null; customerEmail?: string | null; customerPhone?: string | null };

export type CnFormInitial = {
  sourceInvoiceId: string;
  issueDate: string;
  reason: string;
  items: LineItemDraft[];
};

export function CnForm({
  locale,
  invoices,
  products,
  org,
  numberPreview,
  defaultInvoiceId,
  mode = "create",
  documentId,
  initial,
}: {
  locale: Locale;
  invoices: InvoiceOption[];
  products: Product[];
  org: Org;
  numberPreview: string;
  defaultInvoiceId?: string;
  mode?: "create" | "edit";
  documentId?: number;
  initial?: CnFormInitial;
}) {
  const isEdit = mode === "edit";
  const [sourceInvoiceId, setSourceInvoiceId] = useState(initial?.sourceInvoiceId ?? defaultInvoiceId ?? "");
  const [issueDate, setIssueDate] = useState(initial?.issueDate ?? new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [items, setItems] = useState<LineItemDraft[]>(initial?.items && initial.items.length > 0 ? initial.items : [emptyLineItem()]);
  const [pendingDraft, startDraftTransition] = useTransition();
  const [pendingPrimary, startPrimaryTransition] = useTransition();

  const totals = computeTotals(items);
  const selectedInvoice = invoices.find((inv) => String(inv.id) === sourceInvoiceId);

  function submit(andIssue: boolean) {
    const start = andIssue ? startPrimaryTransition : startDraftTransition;
    start(async () => {
      const result = isEdit && documentId
        ? await updateCreditNoteAction(documentId, { reason, items })
        : await createCreditNoteAction({ title: "", sourceInvoiceId, reason, items }, andIssue);
      if (result?.error) toast.error(result.error);
    });
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="doc-titlebar">
        <div>
          <h3>
            <FileMinus2 className="size-5" style={{ color: "var(--brand-orange)" }} /> {t(locale, isEdit ? "Edit Credit Note" : "Create Credit Note")}
          </h3>
          <div className="sub">{t(locale, isEdit ? "Edit this draft document." : "Issue a credit against a sent invoice — posts Dr Sales Revenue + Dr VAT Payable, Cr Accounts Receivable.")}</div>
        </div>
        <div className="doc-titlebar-actions">
          <button type="button" className="btn btn-glass" disabled>
            {t(locale, "Save as Draft")}
          </button>
        </div>
      </div>

      <div className="doc-header-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <DocFieldBox label={t(locale, "CN Number")} required gear>
          {numberPreview}
        </DocFieldBox>
        <DocFieldBox label={t(locale, "Issue Date")} required>
          <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="w-full bg-transparent outline-none" />
        </DocFieldBox>
      </div>

      <div className="doc-header-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="doc-field">
          <label>
            {t(locale, "Against Invoice")} <span className="req">*</span>
          </label>
          <div className="doc-field-input-row">
            <Select value={sourceInvoiceId} onValueChange={setSourceInvoiceId} disabled={isEdit}>
              <SelectTrigger className="input plain h-[38px] w-full border-0 shadow-none justify-between">
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
        </div>
        <DocFieldBox label={t(locale, "Reason")} plain>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full bg-transparent outline-none" />
        </DocFieldBox>
      </div>

      <div className="doc-meta-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
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
          <div className="card party-card-v2 flex items-center text-[12.5px] text-ink-faint">{t(locale, "Select an invoice to load the client.")}</div>
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
          <span>{t(locale, "Credit Total")}</span>
          <span className="v">
            <Money amount={totals.total} />
          </span>
        </div>
      </div>

      <DocFooterContact locale={locale} email={org.email} phone={org.phone} />

      <DocActionBar
        locale={locale}
        pendingDraft={pendingDraft}
        pendingPrimary={pendingPrimary}
        onSaveDraft={() => submit(false)}
        onPrimary={() => submit(isEdit ? false : true)}
        primaryLabel="Issue Credit Note"
        editMode={isEdit}
      />
    </div>
  );
}
