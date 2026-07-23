"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ShoppingCart, Settings, Columns3 } from "lucide-react";
import { PartyCardStatic, PartyCardSelect } from "../../sales/_shared/party-card";
import { DocFieldBox } from "../../sales/_shared/doc-field-box";
import { DateSettingsDialog } from "../../sales/_shared/date-settings-dialog";
import { DocBrandPanel } from "../../sales/_shared/doc-brand-panel";
import { DocPillsRow } from "../../sales/_shared/doc-pills-row";
import { LineItemsEditor, emptyLineItem, type LineItemDraft } from "../../sales/_shared/line-items-editor";
import { TotalsCard } from "../../sales/_shared/totals-card";
import { TermsBlock, type AttachmentDraft } from "../../sales/_shared/terms-block";
import { SealSignaturePreview } from "../../sales/_shared/seal-signature";
import { DocFooterContact } from "../../sales/_shared/doc-footer-contact";
import { DocActionBar } from "../../sales/_shared/doc-action-bar";
import { DocTopActions } from "../../sales/_shared/doc-top-actions";
import { PreviewDialog, type PreviewData } from "../../sales/_shared/preview-dialog";
import { computeTotals, fmt } from "../../sales/_shared/totals";
import { ConfigureColumnsDialog } from "../../sales/_shared/configure-columns-dialog";
import { resolveColumns, type ColumnDef } from "@/lib/column-config";
import { t, type Locale } from "@/lib/i18n/dict";
import type { ContentPreset } from "@/lib/document-presets";
import type { Vendor, Product, Org } from "@/db";
import { createPurchaseOrderAction, updatePurchaseOrderAction } from "./actions";

export type PoFormInitial = {
  title: string;
  vendorId: string;
  orderDate: string;
  expectedDate: string;
  discount: string;
  notes: string;
  items: LineItemDraft[];
};

export function PoForm({
  locale,
  vendors,
  products,
  org,
  numberPreview,
  initialTitle,
  initialItems,
  sourceQuotationId,
  sourceSalesOrderId,
  sourceProformaId,
  sourceInvoiceId,
  mode = "create",
  documentId,
  initial,
  noteTemplates = [],
  termsGroups = [],
  columnConfig,
}: {
  locale: Locale;
  vendors: Vendor[];
  products: Product[];
  org: Org;
  numberPreview: string;
  initialTitle?: string;
  initialItems?: LineItemDraft[];
  sourceQuotationId?: string;
  sourceSalesOrderId?: string;
  sourceProformaId?: string;
  sourceInvoiceId?: string;
  mode?: "create" | "edit";
  documentId?: number;
  initial?: PoFormInitial;
  noteTemplates?: ContentPreset[];
  termsGroups?: ContentPreset[];
  columnConfig?: ColumnDef[];
}) {
  const isEdit = mode === "edit";
  const [columns, setColumns] = useState<ColumnDef[]>(columnConfig ?? resolveColumns(null));
  const [title, setTitle] = useState(initial?.title ?? initialTitle ?? "");
  const [vendorId, setVendorId] = useState(initial?.vendorId ?? "");
  const [orderDate, setOrderDate] = useState(initial?.orderDate ?? new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState(initial?.expectedDate ?? "");
  const [discount, setDiscount] = useState(initial?.discount ?? "0");
  const defaultNote = noteTemplates.find((n) => n.isDefault) ?? noteTemplates[0];
  const [notes, setNotes] = useState(initial?.notes ?? defaultNote?.content ?? "");
  const [items, setItems] = useState<LineItemDraft[]>(
    initial?.items && initial.items.length > 0 ? initial.items : initialItems && initialItems.length > 0 ? initialItems : [emptyLineItem()],
  );
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pendingDraft, startDraftTransition] = useTransition();
  const [pendingPrimary, startPrimaryTransition] = useTransition();

  const totals = computeTotals(items, discount);
  const selectedVendor = vendors.find((v) => String(v.id) === vendorId);

  function submit(andSend: boolean) {
    const start = andSend ? startPrimaryTransition : startDraftTransition;
    start(async () => {
      const result = isEdit && documentId
        ? await updatePurchaseOrderAction(documentId, { title, vendorId, orderDate, expectedDate, discount, notes, items, attachments })
        : await createPurchaseOrderAction(
            { title, vendorId, orderDate, expectedDate, discount, notes, items, attachments, sourceQuotationId, sourceSalesOrderId, sourceProformaId, sourceInvoiceId },
            andSend,
          );
      if (result?.error) toast.error(result.error);
    });
  }

  const previewData: PreviewData = {
    docLabel: t(locale, "Purchase Order"),
    number: numberPreview,
    title,
    fields: [
      { label: t(locale, "Order Date"), value: orderDate },
      { label: t(locale, "Expected Delivery"), value: expectedDate },
    ],
    from: { label: t(locale, "From"), name: org.name, lines: [org.address, org.email, org.phone] },
    to: selectedVendor ? { label: t(locale, "To Vendor"), name: selectedVendor.name, lines: [selectedVendor.address, selectedVendor.email, selectedVendor.phone] } : undefined,
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
            <ShoppingCart className="size-5" style={{ color: "var(--brand-orange)" }} /> {t(locale, isEdit ? "Edit Purchase Order" : "Create Purchase Order")}
          </h3>
          <div className="sub">{t(locale, isEdit ? "Edit this draft document." : "Order stock from a vendor — receiving posts to inventory and accounts payable.")}</div>
        </div>
        <DocTopActions locale={locale} busy={pendingDraft || pendingPrimary} onSaveDraft={() => submit(false)} onPreview={() => setPreviewOpen(true)} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 20, marginBottom: 18, alignItems: "start" }}>
        <div>
          <div className="doc-header-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <DocFieldBox label={t(locale, "PO Number")} required gear gearDocType="purchase_order" locale={locale}>
              {numberPreview}
            </DocFieldBox>
            <DocFieldBox label={t(locale, "Order Date")} required>
              <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className="w-full bg-transparent outline-none" />
            </DocFieldBox>
          </div>
          <div className="doc-header-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <DocFieldBox
              label={t(locale, "Expected Delivery")}
              required
              gearDialog={
                <DateSettingsDialog
                  locale={locale}
                  title={t(locale, "Expected Delivery")}
                  baseDate={orderDate}
                  baseLabel={t(locale, "Order Date")}
                  onApply={setExpectedDate}
                  trigger={
                    <button type="button" className="doc-gear-btn" title={t(locale, "Set expected delivery")} aria-label={t(locale, "Set expected delivery")}>
                      <Settings className="size-[15px]" />
                    </button>
                  }
                />
              }
            >
              <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="w-full bg-transparent outline-none" />
            </DocFieldBox>
            <div />
          </div>
          <div className="field">
            <label>{t(locale, "Purchase Order Title")}</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t(locale, "Write purchase order title here…")}
              className="input plain w-full outline-none"
            />
          </div>
        </div>
        <DocBrandPanel org={org} />
      </div>

      <div className="doc-meta-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <PartyCardStatic locale={locale} label={t(locale, "From")} name={org.name} address={org.address} email={org.email} phone={org.phone} />
        <PartyCardSelect locale={locale} label={t(locale, "To Vendor")} customers={vendors} value={vendorId} onChange={setVendorId} placeholder="Select a vendor" partyKind="vendor" />
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
            documentType="purchase_order"
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
          <TotalsCard
            locale={locale}
            subtotal={totals.subtotal}
            discount={discount}
            onDiscountChange={setDiscount}
            taxTotal={totals.taxTotal}
            total={totals.total}
            totalLabel="Total Payable"
          />
        </div>
      </div>

      <SealSignaturePreview locale={locale} sealUrl={org.sealUrl} signatureUrl={org.signatureUrl} />

      <DocFooterContact locale={locale} email={org.email} phone={org.phone} />

      <DocActionBar
        printHref={documentId ? `/print/purchase-order/${documentId}` : undefined}
        locale={locale}
        pendingDraft={pendingDraft}
        pendingPrimary={pendingPrimary}
        onSaveDraft={() => submit(false)}
        onPrimary={() => submit(isEdit ? false : true)}
        primaryLabel="Send to Vendor"
        editMode={isEdit}
        onPreview={documentId ? undefined : () => setPreviewOpen(true)}
      />

      <PreviewDialog locale={locale} data={previewData} open={previewOpen} onOpenChange={setPreviewOpen} />
    </div>
  );
}
