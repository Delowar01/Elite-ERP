"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ShoppingCart, ChevronDown } from "lucide-react";
import { PartyCardStatic, PartyCardSelect } from "../../sales/_shared/party-card";
import { DocFieldBox } from "../../sales/_shared/doc-field-box";
import { DocBrandPanel } from "../../sales/_shared/doc-brand-panel";
import { DocPillsRow } from "../../sales/_shared/doc-pills-row";
import { LineItemsEditor, emptyLineItem, type LineItemDraft } from "../../sales/_shared/line-items-editor";
import { TotalsCard } from "../../sales/_shared/totals-card";
import { TermsBlock } from "../../sales/_shared/terms-block";
import { SealSignaturePreview } from "../../sales/_shared/seal-signature";
import { DocFooterContact } from "../../sales/_shared/doc-footer-contact";
import { DocActionBar } from "../../sales/_shared/doc-action-bar";
import { computeTotals } from "../../sales/_shared/totals";
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
}) {
  const isEdit = mode === "edit";
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
  const [pendingDraft, startDraftTransition] = useTransition();
  const [pendingPrimary, startPrimaryTransition] = useTransition();

  const totals = computeTotals(items, discount);

  function submit(andSend: boolean) {
    const start = andSend ? startPrimaryTransition : startDraftTransition;
    start(async () => {
      const result = isEdit && documentId
        ? await updatePurchaseOrderAction(documentId, { title, vendorId, orderDate, expectedDate, discount, notes, items })
        : await createPurchaseOrderAction(
            { title, vendorId, orderDate, expectedDate, discount, notes, items, sourceQuotationId, sourceSalesOrderId, sourceProformaId, sourceInvoiceId },
            andSend,
          );
      if (result?.error) toast.error(result.error);
    });
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="doc-titlebar">
        <div>
          <h3>
            <ShoppingCart className="size-5" style={{ color: "var(--brand-orange)" }} /> {t(locale, isEdit ? "Edit Purchase Order" : "Create Purchase Order")}
          </h3>
          <div className="sub">{t(locale, isEdit ? "Edit this draft document." : "Order stock from a vendor — receiving posts to inventory and accounts payable.")}</div>
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
            <DocFieldBox label={t(locale, "Expected Delivery")} required>
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
          { icon: "columns", label: "Edit Columns" },
        ]}
      />

      <LineItemsEditor locale={locale} products={products} items={items} onChange={setItems} variant="full" />

      <div className="doc-bottom-grid">
        <TermsBlock locale={locale} notes={notes} onNotesChange={setNotes} noteTemplates={noteTemplates} termsGroups={termsGroups} />
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
      />
    </div>
  );
}
