"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FileText } from "lucide-react";
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
import { computeTotals, fmt } from "../_shared/totals";
import { ConfigureColumnsDialog } from "../_shared/configure-columns-dialog";
import { resolveColumns, type ColumnDef } from "@/lib/column-config";
import { t, type Locale } from "@/lib/i18n/dict";
import { Settings, Columns3 } from "lucide-react";
import type { Customer, Product, Org } from "@/db";
import type { ContentPreset } from "@/lib/document-presets";
import { createQuotationAction, updateQuotationAction } from "./actions";

export type QuotationFormInitial = {
  title: string;
  customerId: string;
  projectId: string;
  issueDate: string;
  validUntil: string;
  discount: string;
  notes: string;
  items: LineItemDraft[];
};

export function QuotationForm({
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
  columnConfig,
}: {
  locale: Locale;
  customers: Customer[];
  products: Product[];
  projects: { id: number; name: string }[];
  org: Org;
  numberPreview: string;
  mode?: "create" | "edit";
  documentId?: number;
  initial?: QuotationFormInitial;
  noteTemplates?: ContentPreset[];
  termsGroups?: ContentPreset[];
  columnConfig?: ColumnDef[];
}) {
  const isEdit = mode === "edit";
  const [columns, setColumns] = useState<ColumnDef[]>(columnConfig ?? resolveColumns(null));
  const defaultNote = noteTemplates.find((n) => n.isDefault) ?? noteTemplates[0];
  const [title, setTitle] = useState(initial?.title ?? "");
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [issueDate, setIssueDate] = useState(initial?.issueDate ?? new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState(initial?.validUntil ?? "");
  const [discount, setDiscount] = useState(initial?.discount ?? "0");
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
      const payload = { title, customerId, projectId, issueDate, validUntil, discount, notes, items, attachments };
      const result = isEdit && documentId ? await updateQuotationAction(documentId, payload) : await createQuotationAction(payload, andSend);
      if (result?.error) toast.error(result.error);
    });
  }

  const previewData: PreviewData = {
    docLabel: t(locale, "Quotation"),
    number: numberPreview,
    title,
    fields: [
      { label: t(locale, "Quotation Date"), value: issueDate },
      { label: t(locale, "Valid Till Date"), value: validUntil },
    ],
    from: { label: t(locale, "From"), name: org.name, lines: [org.address, org.email, org.phone] },
    to: selectedCustomer
      ? { label: t(locale, "To Client"), name: selectedCustomer.name, lines: [selectedCustomer.address, selectedCustomer.email, selectedCustomer.phone] }
      : undefined,
    items: items.map((it) => ({ description: it.description, quantity: it.quantity, unitPrice: fmt(Number(it.unitPrice) || 0), lineTotal: fmt((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)) })),
    showPricing: true,
    totals: { subtotal: totals.subtotal, discount: totals.discount, taxTotal: totals.taxTotal, total: totals.total },
    notes,
    currency: org.currency,
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="doc-titlebar">
        <div>
          <h3>
            <FileText className="size-5" style={{ color: "var(--brand-orange)" }} /> {t(locale, isEdit ? "Edit Quotation" : "Create Quotation")}
          </h3>
          <div className="sub">{t(locale, isEdit ? "Edit this draft quotation." : "Create and send professional quotations to your clients.")}</div>
        </div>
        <DocTopActions locale={locale} busy={pendingDraft || pendingPrimary} onSaveDraft={() => submit(false)} onPreview={() => setPreviewOpen(true)} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 20, marginBottom: 18, alignItems: "start" }}>
        <div>
          <div className="doc-header-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <DocFieldBox label={t(locale, "Quotation Number")} required gear gearDocType="quotation" locale={locale}>
              {numberPreview}
            </DocFieldBox>
            <DocFieldBox label={t(locale, "Quotation Date")} required>
              <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="w-full bg-transparent outline-none" />
            </DocFieldBox>
          </div>
          <div className="doc-header-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <DocFieldBox
              label={t(locale, "Valid Till Date")}
              required
              gearDialog={
                <DateSettingsDialog
                  locale={locale}
                  title={t(locale, "Valid Till Date")}
                  baseDate={issueDate}
                  baseLabel={t(locale, "Quotation Date")}
                  onApply={setValidUntil}
                  trigger={
                    <button type="button" className="doc-gear-btn" title={t(locale, "Set validity period")} aria-label={t(locale, "Set validity period")}>
                      <Settings className="size-[15px]" />
                    </button>
                  }
                />
              }
            >
              <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="w-full bg-transparent outline-none" />
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
            <label>{t(locale, "Quotation Title")}</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t(locale, "Write quotation title here…")}
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
        ]}
        trailing={
          <ConfigureColumnsDialog
            locale={locale}
            documentType="quotation"
            columns={columns}
            onApply={setColumns}
            trigger={
              <button type="button" className="doc-pill-btn">
                <Columns3 className="size-3.5" /> <span>{t(locale, "Edit Columns")}</span>
              </button>
            }
          />
        }
      />

      <LineItemsEditor locale={locale} products={products} items={items} onChange={setItems} variant="full" columns={columns} />

      <div className="doc-bottom-grid">
        <TermsBlock locale={locale} notes={notes} onNotesChange={setNotes} noteTemplates={noteTemplates} termsGroups={termsGroups} attachments={attachments} onAttachmentsChange={setAttachments} />
        <div className="flex flex-col gap-4">
          <TotalsCard locale={locale} subtotal={totals.subtotal} discount={discount} onDiscountChange={setDiscount} taxTotal={totals.taxTotal} total={totals.total} />
        </div>
      </div>

      <SealSignaturePreview locale={locale} sealUrl={org.sealUrl} signatureUrl={org.signatureUrl} />

      <DocFooterContact locale={locale} email={org.email} phone={org.phone} />

      <DocActionBar
        printHref={documentId ? `/print/quotation/${documentId}` : undefined}
        locale={locale}
        pendingDraft={pendingDraft}
        pendingPrimary={pendingPrimary}
        onSaveDraft={() => submit(false)}
        onPrimary={() => submit(isEdit ? false : true)}
        primaryLabel="Save & Submit"
        editMode={isEdit}
        onPreview={documentId ? undefined : () => setPreviewOpen(true)}
      />

      <PreviewDialog locale={locale} data={previewData} open={previewOpen} onOpenChange={setPreviewOpen} />
    </div>
  );
}
