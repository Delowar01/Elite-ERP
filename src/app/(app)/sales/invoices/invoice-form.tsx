"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Receipt, Settings } from "lucide-react";
import { PartyCardStatic, PartyCardSelect } from "../_shared/party-card";
import { DocFieldBox } from "../_shared/doc-field-box";
import { DateSettingsDialog } from "../_shared/date-settings-dialog";
import { DocBrandPanel } from "../_shared/doc-brand-panel";
import { DocPillsRow } from "../_shared/doc-pills-row";
import { LineItemsEditor, emptyLineItem, type LineItemDraft } from "../_shared/line-items-editor";
import { TotalsCard } from "../_shared/totals-card";
import { TermsBlock, type AttachmentDraft } from "../_shared/terms-block";
import { SealSignaturePreview } from "../_shared/seal-signature";
import { DocFooterContact } from "../_shared/doc-footer-contact";
import { DocActionBar } from "../_shared/doc-action-bar";
import { DocTopActions } from "../_shared/doc-top-actions";
import { PreviewDialog, type PreviewData } from "../_shared/preview-dialog";
import { EInvoicePreviewPanel } from "../_shared/einvoice-preview-panel";
import { computeTotals, fmt } from "../_shared/totals";
import { t, type Locale } from "@/lib/i18n/dict";
import type { ContentPreset } from "@/lib/document-presets";
import type { Customer, Product, Org } from "@/db";
import { createInvoiceAction, updateInvoiceAction } from "./actions";

export type InvoiceFormInitial = {
  title: string;
  customerId: string;
  projectId: string;
  issueDate: string;
  dueDate: string;
  discount: string;
  notes: string;
  items: LineItemDraft[];
};

export function InvoiceForm({
  locale,
  customers,
  products,
  projects,
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
  projects: { id: number; name: string }[];
  org: Org;
  numberPreview: string;
  mode?: "create" | "edit";
  documentId?: number;
  initial?: InvoiceFormInitial;
  noteTemplates?: ContentPreset[];
  termsGroups?: ContentPreset[];
}) {
  const isEdit = mode === "edit";
  const [title, setTitle] = useState(initial?.title ?? "");
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [issueDate, setIssueDate] = useState(initial?.issueDate ?? new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [discount, setDiscount] = useState(initial?.discount ?? "0");
  const defaultNote = noteTemplates.find((n) => n.isDefault) ?? noteTemplates[0];
  const [notes, setNotes] = useState(initial?.notes ?? defaultNote?.content ?? "");
  const [items, setItems] = useState<LineItemDraft[]>(initial?.items && initial.items.length > 0 ? initial.items : [emptyLineItem()]);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pendingDraft, startDraftTransition] = useTransition();
  const [pendingPrimary, startPrimaryTransition] = useTransition();

  const totals = computeTotals(items, discount);
  const selectedCustomer = customers.find((c) => String(c.id) === customerId);

  function submit(andSend: boolean) {
    const start = andSend ? startPrimaryTransition : startDraftTransition;
    start(async () => {
      const payload = { title, customerId, projectId, issueDate, dueDate, discount, notes, items, attachments };
      const result = isEdit && documentId ? await updateInvoiceAction(documentId, payload) : await createInvoiceAction(payload, andSend);
      if (result?.error) toast.error(result.error);
    });
  }

  const previewData: PreviewData = {
    docLabel: t(locale, "Invoice"),
    number: numberPreview,
    title,
    fields: [
      { label: t(locale, "Issue Date"), value: issueDate },
      { label: t(locale, "Due Date"), value: dueDate },
    ],
    from: { label: t(locale, "From"), name: org.name, lines: [org.address, org.email, org.phone] },
    to: selectedCustomer ? { label: t(locale, "To Client"), name: selectedCustomer.name, lines: [selectedCustomer.address, selectedCustomer.email, selectedCustomer.phone] } : undefined,
    items: items.map((it) => ({ description: it.description, quantity: it.quantity, unitPrice: fmt(Number(it.unitPrice) || 0), lineTotal: fmt((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)) })),
    showPricing: true,
    totals: { subtotal: totals.subtotal, discount: totals.discount, taxTotal: totals.taxTotal, total: totals.total },
    notes,
    currency: org.currency,
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="doc-titlebar">
        <div>
          <h3>
            <Receipt className="size-5" style={{ color: "var(--brand-orange)" }} /> {t(locale, isEdit ? "Edit Invoice" : "Create Invoice")}
          </h3>
          <div className="sub">{t(locale, isEdit ? "Edit this draft document." : "Issue a tax invoice — posts to the ledger and decrements stock on send.")}</div>
        </div>
        <DocTopActions locale={locale} busy={pendingDraft || pendingPrimary} onSaveDraft={() => submit(false)} onPreview={() => setPreviewOpen(true)} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 20, marginBottom: 18, alignItems: "start" }}>
        <div>
          <div className="doc-header-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <DocFieldBox label={t(locale, "Invoice Number")} required gear gearDocType="sales_invoice" locale={locale}>
              {numberPreview}
            </DocFieldBox>
            <DocFieldBox label={t(locale, "Issue Date")} required>
              <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="w-full bg-transparent outline-none" />
            </DocFieldBox>
          </div>
          <div className="doc-header-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <DocFieldBox
              label={t(locale, "Due Date")}
              required
              gearDialog={
                <DateSettingsDialog
                  locale={locale}
                  title={t(locale, "Due Date")}
                  baseDate={issueDate}
                  baseLabel={t(locale, "Issue Date")}
                  onApply={setDueDate}
                  trigger={
                    <button type="button" className="doc-gear-btn" title={t(locale, "Set payment term")} aria-label={t(locale, "Set payment term")}>
                      <Settings className="size-[15px]" />
                    </button>
                  }
                />
              }
            >
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full bg-transparent outline-none" />
            </DocFieldBox>
            <DocFieldBox label={t(locale, "Project")}>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-full bg-transparent outline-none">
                <option value="">—</option>
                {projects.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
            </DocFieldBox>
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
        <TermsBlock locale={locale} notes={notes} onNotesChange={setNotes} noteTemplates={noteTemplates} termsGroups={termsGroups} attachments={attachments} onAttachmentsChange={setAttachments} />
        <div className="flex flex-col gap-4">
          <TotalsCard locale={locale} subtotal={totals.subtotal} discount={discount} onDiscountChange={setDiscount} taxTotal={totals.taxTotal} total={totals.total} />
          <EInvoicePreviewPanel locale={locale} vatNumber={org.vatNumber} taxTotal={totals.taxTotal} variant="create" />
        </div>
      </div>

      <SealSignaturePreview locale={locale} sealUrl={org.sealUrl} signatureUrl={org.signatureUrl} />

      <DocFooterContact locale={locale} email={org.email} phone={org.phone} />

      <DocActionBar
        printHref={documentId ? `/print/invoice/${documentId}` : undefined}
        locale={locale}
        pendingDraft={pendingDraft}
        pendingPrimary={pendingPrimary}
        onSaveDraft={() => submit(false)}
        onPrimary={() => submit(isEdit ? false : true)}
        primaryLabel="Send to Client"
        editMode={isEdit}
        onPreview={documentId ? undefined : () => setPreviewOpen(true)}
      />

      <PreviewDialog locale={locale} data={previewData} open={previewOpen} onOpenChange={setPreviewOpen} />
    </div>
  );
}
