"use client";

import { useId, useState, useTransition } from "react";
import { getLineDesc } from "../../sales/_shared/line-item-desc";
import { toast } from "sonner";
import { ShoppingCart, Settings, Columns3 } from "lucide-react";
import { PartyCardStatic, PartyCardSelect } from "../../sales/_shared/party-card";
import { DocFieldBox } from "../../sales/_shared/doc-field-box";
import { DocFormError } from "../../sales/_shared/doc-form-error";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { DateSettingsDialog } from "../../sales/_shared/date-settings-dialog";
import { DocBrandPanel } from "../../sales/_shared/doc-brand-panel";
import { DocPillsRow } from "../../sales/_shared/doc-pills-row";
import { LineItemsEditor, emptyLineItem, type LineItemDraft } from "../../sales/_shared/line-items-editor";
import { TotalsCard } from "../../sales/_shared/totals-card";
import { TermsBlock, type AttachmentDraft } from "../../sales/_shared/terms-block";
import type { DocumentTerm } from "../../sales/_shared/document-terms";
import { SealSignaturePreview, type SealAsset } from "../../sales/_shared/seal-signature";
import { DocFooterContact } from "../../sales/_shared/doc-footer-contact";
import { DocActionBar } from "../../sales/_shared/doc-action-bar";
import { DocTopActions } from "../../sales/_shared/doc-top-actions";
import { PreviewDialog, type PreviewData } from "../../sales/_shared/preview-dialog";
import { BankAccountsField } from "../../sales/_shared/bank-accounts-field";
import { snapshotSelectedBankAccounts } from "@/lib/document-bank-accounts";
import type { EditableBankAccount, GlAccountOption } from "../../finance/bank-accounts/bank-account-form-dialog";
import { computeTotals } from "../../sales/_shared/totals";
import { CurrencyProvider } from "@/components/ui/currency-mark";
import { docMoneyMark } from "../../sales/_shared/doc-currency";
import { ConfigureColumnsDialog } from "../../sales/_shared/configure-columns-dialog";
import { resolveColumns, type ColumnDef } from "@/lib/column-config";
import { t, type Locale } from "@/lib/i18n/dict";
import { useDirtyForm } from "../../_shared/dirty-form";
import { getProfileByCountryName } from "@/lib/geo/country-profiles";
import type { ContentPreset } from "@/lib/document-presets";
import type { Vendor, Product, Org } from "@/db";
import { createPurchaseOrderAction, updatePurchaseOrderAction } from "./actions";


// Radix Select items cannot carry "", so the "—" (none) option uses this sentinel in the UI only.
const NONE = "__none";
export type PoFormInitial = {
  title: string;
  vendorId: string;
  projectId?: string;
  orderDate: string;
  expectedDate: string;
  discount: string;
  notes: string;
  items: LineItemDraft[];
  terms?: DocumentTerm[];
  bankAccountIds?: number[];
  currency?: string;
};

export function PoForm({
  locale,
  vendors,
  products,
  org,
  numberPreview,
  projects = [],
  initialTitle,
  initialItems,
  initialCurrency,
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
  bankAccounts = [],
  glAccounts = [],
  defaultBankAccountIds = [],
  sealAssets = [],
}: {
  sealAssets?: SealAsset[];
  locale: Locale;
  vendors: Vendor[];
  products: Product[];
  org: Org;
  numberPreview: string;
  projects?: { id: number; name: string }[];
  initialTitle?: string;
  initialItems?: LineItemDraft[];
  /** Prefill from a converted source document. The copied amounts are in THIS currency. */
  initialCurrency?: string | null;
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
  bankAccounts?: EditableBankAccount[];
  glAccounts?: GlAccountOption[];
  defaultBankAccountIds?: number[];
}) {
  const isEdit = mode === "edit";
  const [columns, setColumns] = useState<ColumnDef[]>(columnConfig ?? resolveColumns(null));
  const [title, setTitle] = useState(initial?.title ?? initialTitle ?? "");
  const [vendorId, setVendorId] = useState(initial?.vendorId ?? "");
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [orderDate, setOrderDate] = useState(initial?.orderDate ?? new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState(initial?.expectedDate ?? "");
  const [discount, setDiscount] = useState(initial?.discount ?? "0");
  const defaultNote = noteTemplates.find((n) => n.isDefault) ?? noteTemplates[0];
  const [notes, setNotes] = useState(initial?.notes ?? defaultNote?.content ?? "");
  const [terms, setTerms] = useState<DocumentTerm[]>(initial?.terms ?? []);
  const [bankAccountIds, setBankAccountIds] = useState<number[]>(initial?.bankAccountIds ?? (mode === "create" ? defaultBankAccountIds : []));
  const [currency, setCurrency] = useState<string>(initial?.currency ?? initialCurrency ?? org.currency);
  const [sealOverride, setSealOverride] = useState<string | undefined>(undefined);
  const [signatureOverride, setSignatureOverride] = useState<string | undefined>(undefined);
  const docMark = docMoneyMark(org, currency);
  const countryProfile = getProfileByCountryName(org.country);
  const defaultTaxRate = String(countryProfile.defaultTaxRate);
  const [items, setItems] = useState<LineItemDraft[]>(
    initial?.items && initial.items.length > 0 ? initial.items : initialItems && initialItems.length > 0 ? initialItems : [emptyLineItem(defaultTaxRate)],
  );
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pendingDraft, startDraftTransition] = useTransition();
  const [pendingPrimary, startPrimaryTransition] = useTransition();
  // DEV-UI-01.6: ids for the header controls, and the last save failure shown in the error region.
  const fid = useId();
  const [formError, setFormError] = useState<string | null>(null);

  const totals = computeTotals(items, discount, currency);
  const selectedVendor = vendors.find((v) => String(v.id) === vendorId);

  // Everything that counts as this document's content. Leaving a field out would leave it
  // unprotected, so line items, terms, notes, attachments, bank accounts and the seal are all in.

  const dirtyForm = useDirtyForm({ title, vendorId, projectId, orderDate, expectedDate, discount, notes, terms, items, attachments, bankAccountIds, currency, sealOverride, signatureOverride });

  function submit(andSend: boolean) {
    const start = andSend ? startPrimaryTransition : startDraftTransition;
    setFormError(null);
    start(async () => {
      // Clean BEFORE the call: a successful save redirects from the server and never returns,
      // so marking clean afterwards would be too late and the user would be asked to discard
      // exactly what they just saved. A failure below puts the dirty state back.
      dirtyForm.markClean();
      const result = isEdit && documentId
        ? await updatePurchaseOrderAction(documentId, { title, vendorId, projectId, orderDate, expectedDate, discount, notes, terms, items, attachments, bankAccountIds, currency, sealUrl: sealOverride, signatureUrl: signatureOverride })
        : await createPurchaseOrderAction(
            { title, vendorId, projectId, orderDate, expectedDate, discount, notes, items, attachments, sourceQuotationId, sourceSalesOrderId, sourceProformaId, sourceInvoiceId, bankAccountIds, currency, sealUrl: sealOverride, signatureUrl: signatureOverride },
            andSend,
          );
      if (result?.error) {
        dirtyForm.restoreDirty();
        toast.error(result.error);
        setFormError(result.error);
      }
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
    items: items.map((it) => ({ description: it.description, desc: getLineDesc(it.customFields), quantity: it.quantity, unitPrice: String(Number(it.unitPrice) || 0), lineTotal: String((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)) })),
    showPricing: true,
    totals: { subtotal: totals.subtotal, discount: totals.discount, taxTotal: totals.taxTotal, total: totals.total },
    notes,
    terms,
    currency,
    bankAccounts: snapshotSelectedBankAccounts(bankAccountIds, bankAccounts),
  };

  return (
    <CurrencyProvider mark={docMark}>
    <div className="max-w-5xl mx-auto">
      <div className="doc-titlebar">
        <div>
          <h3>
            <ShoppingCart className="size-5" style={{ color: "var(--brand-orange)" }} /> {t(locale, isEdit ? "Edit Purchase Order" : "Create Purchase Order")}
          </h3>
          <div className="sub">{t(locale, isEdit ? "Edit this draft document." : "Order stock from a vendor — receiving posts to inventory and accounts payable.")}</div>
        </div>
        <DocTopActions locale={locale} busy={pendingDraft || pendingPrimary} onSaveDraft={() => submit(false)} onPreview={() => setPreviewOpen(true)} dirty={dirtyForm.dirty} />
      </div>

      <div className="doc-head-grid">
        <div>
          <div className="doc-header-grid">
            <DocFieldBox label={t(locale, "PO Number")} required mono gear gearDocType="purchase_order" locale={locale}>
              {numberPreview}
            </DocFieldBox>
            <DocFieldBox label={t(locale, "Order Date")} required htmlFor={`${fid}-order-date`}>
              <Input id={`${fid}-order-date`} type="date" aria-required value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </DocFieldBox>
          </div>
          <div className="doc-header-grid">
            <DocFieldBox
              label={t(locale, "Expected Delivery")}
              required
              htmlFor={`${fid}-expected-delivery`}
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
              <Input id={`${fid}-expected-delivery`} type="date" aria-required value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </DocFieldBox>
            {/* Optional project tag — same field the sales-side builders already offer. It is what
                attributes this order's cost to a project in Project Cost Control. */}
            <DocFieldBox label={t(locale, "Project")} htmlFor={`${fid}-project`}>
              {/* Radix items cannot carry "": NONE stands for the "—" option and maps back to "". */}
              <Select value={projectId || NONE} onValueChange={(v) => setProjectId(v === NONE ? "" : v)}>
                <SelectTrigger id={`${fid}-project`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </DocFieldBox>
          </div>
          <FormField label={t(locale, "Purchase Order Title")} htmlFor={`${fid}-title`}>
            {(field) => (
              <Input id={field.id} aria-describedby={field.describedBy} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t(locale, "Write purchase order title here…")} />
            )}
          </FormField>
        </div>
        <DocBrandPanel org={org} />
      </div>

      <div className="doc-meta-row">
        <PartyCardStatic locale={locale} label={t(locale, "From")} name={org.name} address={org.address} email={org.email} phone={org.phone} />
        <PartyCardSelect locale={locale} label={t(locale, "To Vendor")} customers={vendors} value={vendorId} onChange={setVendorId} placeholder="Select a vendor" partyKind="vendor" />
      </div>

      <DocPillsRow
        locale={locale}
        org={org}
        currency={currency}
        onCurrencyChange={setCurrency}
        pills={[
          { icon: "percent", label: "VAT Settings" },
          { icon: "wallet", label: "Currency", value: currency },
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

      <LineItemsEditor locale={locale} products={products} items={items} onChange={setItems} defaultTaxRate={defaultTaxRate} variant="full" columns={columns} />

      <div className="doc-bottom-grid">
        <TermsBlock locale={locale} notes={notes} onNotesChange={setNotes} terms={terms} onTermsChange={setTerms} noteTemplates={noteTemplates} termsGroups={termsGroups} attachments={attachments} onAttachmentsChange={setAttachments} />
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

      <div className="mt-4">
        <BankAccountsField locale={locale} accounts={bankAccounts} glAccounts={glAccounts} value={bankAccountIds} onChange={setBankAccountIds} />
      </div>

      <SealSignaturePreview locale={locale} sealUrl={org.sealUrl} signatureUrl={org.signatureUrl} sealAssets={sealAssets} sealOverride={sealOverride} signatureOverride={signatureOverride} onSealOverride={setSealOverride} onSignatureOverride={setSignatureOverride} />

      <DocFooterContact locale={locale} email={org.email} phone={org.phone} />

      <DocFormError locale={locale} error={formError} />

      <DocActionBar
        locale={locale}
        pendingDraft={pendingDraft}
        pendingPrimary={pendingPrimary}
        onSaveDraft={() => submit(false)}
        onPrimary={() => submit(isEdit ? false : true)}
        primaryLabel="Send to Vendor"
        editMode={isEdit}
        onPreview={() => setPreviewOpen(true)}
      />

      <PreviewDialog locale={locale} data={previewData} open={previewOpen} onOpenChange={setPreviewOpen} />
    </div>
    </CurrencyProvider>
  );
}
