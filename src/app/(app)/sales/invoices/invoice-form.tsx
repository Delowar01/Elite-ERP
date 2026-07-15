"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Receipt, ChevronDown } from "lucide-react";
import { PartyCardStatic, PartyCardSelect } from "../_shared/party-card";
import { DocFieldBox } from "../_shared/doc-field-box";
import { DocBrandPanel } from "../_shared/doc-brand-panel";
import { DocPillsRow } from "../_shared/doc-pills-row";
import { LineItemsEditor, emptyLineItem, type LineItemDraft } from "../_shared/line-items-editor";
import { TotalsCard } from "../_shared/totals-card";
import { TermsBlock } from "../_shared/terms-block";
import { SealSignaturePreview } from "../_shared/seal-signature";
import { DocFooterContact } from "../_shared/doc-footer-contact";
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
    <div className="max-w-6xl">
      <div className="doc-titlebar">
        <div>
          <h3>
            <Receipt className="size-5" style={{ color: "var(--brand-orange)" }} /> {t(locale, "Create Invoice")}
          </h3>
          <div className="sub">{t(locale, "Issue a tax invoice — posts to the ledger and decrements stock on send.")}</div>
        </div>
        <div className="doc-titlebar-actions">
          <button type="button" className="btn btn-glass" disabled>
            {t(locale, "Save as Draft")}
          </button>
          <button type="button" className="btn btn-glass" disabled>
            {t(locale, "More Actions")} <ChevronDown className="size-3" />
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 20, marginBottom: 18, alignItems: "start" }}>
        <div>
          <div className="doc-header-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <DocFieldBox label={t(locale, "Invoice Number")} required gear>
              {numberPreview}
            </DocFieldBox>
            <DocFieldBox label={t(locale, "Issue Date")} required>
              <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="w-full bg-transparent outline-none" />
            </DocFieldBox>
          </div>
          <div className="doc-header-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <DocFieldBox label={t(locale, "Due Date")} required>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full bg-transparent outline-none" />
            </DocFieldBox>
            <div />
          </div>
          <div className="field">
            <label>{t(locale, "Invoice Title")}</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t(locale, "Write invoice title here…")}
              className="input plain w-full outline-none"
            />
          </div>
        </div>
        <DocBrandPanel org={org} />
      </div>

      <div className="doc-meta-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <PartyCardStatic label={t(locale, "From")} name={org.name} address={org.address} email={org.email} phone={org.phone} />
        <PartyCardSelect locale={locale} label={t(locale, "To Client")} customers={customers} value={customerId} onChange={setCustomerId} />
      </div>

      <DocPillsRow
        locale={locale}
        pills={[
          { icon: "percent", label: "VAT Settings" },
          { icon: "wallet", label: "Currency", value: org.currency },
          { icon: "info", label: "Number Format", value: "123,456.78" },
          { icon: "columns", label: "Edit Columns" },
        ]}
      />

      <LineItemsEditor locale={locale} products={products} items={items} onChange={setItems} variant="full" />

      <div className="doc-bottom-grid">
        <TermsBlock locale={locale} groupKey="group-b" notes={notes} onNotesChange={setNotes} />
        <div className="flex flex-col gap-4">
          <TotalsCard locale={locale} subtotal={totals.subtotal} discount={discount} onDiscountChange={setDiscount} taxTotal={totals.taxTotal} total={totals.total} />
          <EInvoicePreviewPanel locale={locale} vatNumber={org.vatNumber} taxTotal={totals.taxTotal} variant="create" />
        </div>
      </div>

      <SealSignaturePreview locale={locale} sealUrl={org.sealUrl} signatureUrl={org.signatureUrl} />

      <DocFooterContact locale={locale} email={org.email} phone={org.phone} />

      <DocActionBar locale={locale} pending={pending} onSubmit={submit} primaryLabel="Save as Draft" />
    </div>
  );
}
