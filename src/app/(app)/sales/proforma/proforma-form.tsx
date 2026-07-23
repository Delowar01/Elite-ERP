"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FileCheck2, Info, ChevronDown } from "lucide-react";
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
import { computeTotals } from "../_shared/totals";
import { t, type Locale } from "@/lib/i18n/dict";
import type { ContentPreset } from "@/lib/document-presets";
import type { Customer, Product, Org } from "@/db";
import { createProformaAction, updateProformaAction } from "./actions";

export type ProformaFormInitial = {
  title: string;
  customerId: string;
  issueDate: string;
  discount: string;
  notes: string;
  items: LineItemDraft[];
};

export function ProformaForm({
  locale,
  customers,
  products,
  org,
  numberPreview,
  mode = "create",
  documentId,
  initial,
  noteTemplates = [],
  termsGroups = [],
}: {
  locale: Locale;
  customers: Customer[];
  products: Product[];
  org: Org;
  numberPreview: string;
  mode?: "create" | "edit";
  documentId?: number;
  initial?: ProformaFormInitial;
  noteTemplates?: ContentPreset[];
  termsGroups?: ContentPreset[];
}) {
  const isEdit = mode === "edit";
  const [title, setTitle] = useState(initial?.title ?? "");
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [issueDate, setIssueDate] = useState(initial?.issueDate ?? new Date().toISOString().slice(0, 10));
  const [discount, setDiscount] = useState(initial?.discount ?? "0");
  const defaultNote = noteTemplates.find((n) => n.isDefault) ?? noteTemplates[0];
  const [notes, setNotes] = useState(initial?.notes ?? defaultNote?.content ?? "");
  const [items, setItems] = useState<LineItemDraft[]>(initial?.items && initial.items.length > 0 ? initial.items : [emptyLineItem()]);
  const [pendingDraft, startDraftTransition] = useTransition();
  const [pendingPrimary, startPrimaryTransition] = useTransition();

  const totals = computeTotals(items, discount);

  function submit(andSend: boolean) {
    const start = andSend ? startPrimaryTransition : startDraftTransition;
    start(async () => {
      const payload = { title, customerId, issueDate, discount, notes, items };
      const result = isEdit && documentId ? await updateProformaAction(documentId, payload) : await createProformaAction(payload, andSend);
      if (result?.error) toast.error(result.error);
    });
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="doc-titlebar">
        <div>
          <h3>
            <FileCheck2 className="size-5" style={{ color: "var(--brand-orange)" }} /> {t(locale, isEdit ? "Edit Proforma Invoice" : "Create Proforma Invoice")}
          </h3>
          <div className="sub">{t(locale, isEdit ? "Edit this draft document." : "A preview invoice for client reference — never posts revenue or affects stock.")}</div>
        </div>
        <div className="doc-titlebar-actions">
          <button type="button" className="btn btn-glass" disabled={pendingDraft || pendingPrimary} onClick={() => submit(false)}>
            {t(locale, "Save as Draft")}
          </button>
          <button type="button" className="btn btn-glass cursor-not-allowed" disabled title={t(locale, "More options are in the action bar at the bottom.")}>
            {t(locale, "More Actions")} <ChevronDown className="size-3" />
          </button>
        </div>
      </div>

      <span className="doc-badge-noninvoicing">
        <Info className="size-3.5" />
        {t(locale, "Non-posting — for client reference only. Never affects revenue or stock.")}
      </span>

      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 20, marginBottom: 18, alignItems: "start" }}>
        <div>
          <div className="doc-header-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <DocFieldBox label={t(locale, "Proforma Number")} required gear gearDocType="proforma_invoice" locale={locale}>
              {numberPreview}
            </DocFieldBox>
            <DocFieldBox label={t(locale, "Issue Date")} required>
              <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="w-full bg-transparent outline-none" />
            </DocFieldBox>
          </div>
          <div className="field">
            <label>{t(locale, "Proforma Title")}</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t(locale, "Write proforma title here…")}
              className="input plain w-full outline-none"
            />
          </div>
        </div>
        <DocBrandPanel org={org} />
      </div>

      <div className="doc-meta-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <PartyCardStatic locale={locale} label={t(locale, "From")} name={org.name} address={org.address} email={org.email} phone={org.phone} />
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
        <TermsBlock locale={locale} notes={notes} onNotesChange={setNotes} noteTemplates={noteTemplates} termsGroups={termsGroups} />
        <div className="flex flex-col gap-4">
          <TotalsCard locale={locale} subtotal={totals.subtotal} discount={discount} onDiscountChange={setDiscount} taxTotal={totals.taxTotal} total={totals.total} />
        </div>
      </div>

      <SealSignaturePreview locale={locale} sealUrl={org.sealUrl} signatureUrl={org.signatureUrl} />

      <DocFooterContact locale={locale} email={org.email} phone={org.phone} />

      <DocActionBar
        printHref={documentId ? `/print/proforma/${documentId}` : undefined}
        locale={locale}
        pendingDraft={pendingDraft}
        pendingPrimary={pendingPrimary}
        onSaveDraft={() => submit(false)}
        onPrimary={() => submit(isEdit ? false : true)}
        primaryLabel="Send to Client"
        editMode={isEdit}
      />
    </div>
  );
}
