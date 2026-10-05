"use client";

import { useId, useState, useTransition } from "react";
import { getLineDesc } from "../_shared/line-item-desc";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { CurrencyProvider } from "@/components/ui/currency-mark";
import { docMoneyMark } from "../_shared/doc-currency";
import { PartyCardStatic, PartyCardSelect } from "../_shared/party-card";
import { DocFieldBox } from "../_shared/doc-field-box";
import { DocFormError } from "../_shared/doc-form-error";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { ValidityDaysDialog, addDays } from "../_shared/validity-days-dialog";
import { DocBrandPanel } from "../_shared/doc-brand-panel";
import { DocPillsRow } from "../_shared/doc-pills-row";
import { LineItemsEditor, emptyLineItem, type LineItemDraft } from "../_shared/line-items-editor";
import { TotalsCard } from "../_shared/totals-card";
import { TermsBlock, type AttachmentDraft } from "../_shared/terms-block";
import type { DocumentTerm } from "../_shared/document-terms";
import { SealSignaturePreview, type SealAsset } from "../_shared/seal-signature";
import { DocFooterContact } from "../_shared/doc-footer-contact";
import { DocActionBar } from "../_shared/doc-action-bar";
import { DocTopActions } from "../_shared/doc-top-actions";
import { PreviewDialog, type PreviewData } from "../_shared/preview-dialog";
import { BankAccountsField } from "../_shared/bank-accounts-field";
import { snapshotSelectedBankAccounts } from "@/lib/document-bank-accounts";
import type { EditableBankAccount, GlAccountOption } from "../../finance/bank-accounts/bank-account-form-dialog";
import { computeTotals } from "../_shared/totals";
import { ConfigureColumnsDialog } from "../_shared/configure-columns-dialog";
import { resolveColumns, type ColumnDef } from "@/lib/column-config";
import { t, type Locale } from "@/lib/i18n/dict";
import { useDirtyForm } from "../../_shared/dirty-form";
import { getProfileByCountryName } from "@/lib/geo/country-profiles";
import { Settings, Columns3 } from "lucide-react";
import type { Customer, Product, Org } from "@/db";
import type { ContentPreset } from "@/lib/document-presets";
import { createQuotationAction, updateQuotationAction } from "./actions";


// Radix Select items cannot carry "", so the "—" (none) option uses this sentinel in the UI only.
const NONE = "__none";
export type QuotationFormInitial = {
  title: string;
  customerId: string;
  projectId: string;
  issueDate: string;
  validUntil: string;
  discount: string;
  notes: string;
  items: LineItemDraft[];
  terms?: DocumentTerm[];
  bankAccountIds?: number[];
  currency?: string;
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
  bankAccounts = [],
  glAccounts = [],
  defaultBankAccountIds = [],
  defaultValidityDays = 30,
  sealAssets = [],
}: {
  sealAssets?: SealAsset[];
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
  bankAccounts?: EditableBankAccount[];
  glAccounts?: GlAccountOption[];
  defaultBankAccountIds?: number[];
  defaultValidityDays?: number;
}) {
  const isEdit = mode === "edit";
  const [columns, setColumns] = useState<ColumnDef[]>(columnConfig ?? resolveColumns(null));
  const defaultNote = noteTemplates.find((n) => n.isDefault) ?? noteTemplates[0];
  const [title, setTitle] = useState(initial?.title ?? "");
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [issueDate, setIssueDate] = useState(initial?.issueDate ?? new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState(initial?.validUntil ?? "");
  // Valid Till = Issue Date + N remembered days (Issue #4). New documents auto-compute and recompute
  // when the Issue Date changes; a manual date edit switches off auto-calc for this document.
  const [validityDays, setValidityDays] = useState<number>(defaultValidityDays);
  const [autoValidity, setAutoValidity] = useState<boolean>(!isEdit);
  const [discount, setDiscount] = useState(initial?.discount ?? "0");
  const [notes, setNotes] = useState(initial?.notes ?? defaultNote?.content ?? "");
  const [terms, setTerms] = useState<DocumentTerm[]>(initial?.terms ?? []);
  const [bankAccountIds, setBankAccountIds] = useState<number[]>(initial?.bankAccountIds ?? (mode === "create" ? defaultBankAccountIds : []));
  const [currency, setCurrency] = useState<string>(initial?.currency ?? org.currency);
  const [sealOverride, setSealOverride] = useState<string | undefined>(undefined);
  const [signatureOverride, setSignatureOverride] = useState<string | undefined>(undefined);
  const docMark = docMoneyMark(org, currency);
  const countryProfile = getProfileByCountryName(org.country);
  const defaultTaxRate = String(countryProfile.defaultTaxRate);
  const [items, setItems] = useState<LineItemDraft[]>(initial?.items && initial.items.length > 0 ? initial.items : [emptyLineItem(defaultTaxRate)]);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pendingDraft, startDraftTransition] = useTransition();
  const [pendingPrimary, startPrimaryTransition] = useTransition();
  // DEV-UI-01.6: ids for the header controls, and the last save failure shown in the error region.
  const fid = useId();
  const [formError, setFormError] = useState<string | null>(null);

  const totals = computeTotals(items, discount, currency);
  const selectedCustomer = customers.find((c) => String(c.id) === customerId);

  // Valid Till: while auto-calc is on it's derived as Issue Date + N days (recomputes whenever either
  // changes); a manual date edit turns auto off and uses the entered value. Derived at render (no
  // effect) so there are no cascading state updates.
  const effectiveValidUntil = autoValidity ? addDays(issueDate, validityDays) : validUntil;

  // Everything that counts as this document's content. Leaving a field out would leave it
  // unprotected, so line items, terms, notes, attachments, bank accounts and the seal are all in.

  const dirtyForm = useDirtyForm({ title, customerId, projectId, issueDate, validUntil, discount, notes, terms, items, attachments, bankAccountIds, currency, sealOverride, signatureOverride });

  function submit(andSend: boolean) {
    const start = andSend ? startPrimaryTransition : startDraftTransition;
    setFormError(null);
    start(async () => {
      // Clean BEFORE the call: a successful save redirects from the server and never returns,
      // so marking clean afterwards would be too late and the user would be asked to discard
      // exactly what they just saved. A failure below puts the dirty state back.
      dirtyForm.markClean();
      const payload = { title, customerId, projectId, issueDate, validUntil: effectiveValidUntil, discount, notes, terms, items, attachments, bankAccountIds, currency, sealUrl: sealOverride, signatureUrl: signatureOverride };
      const result = isEdit && documentId ? await updateQuotationAction(documentId, payload) : await createQuotationAction(payload, andSend);
      if (result?.error) {
        dirtyForm.restoreDirty();
        toast.error(result.error);
        setFormError(result.error);
      }
    });
  }

  const previewData: PreviewData = {
    docLabel: t(locale, "Quotation"),
    number: numberPreview,
    title,
    fields: [
      { label: t(locale, "Quotation Date"), value: issueDate },
      { label: t(locale, "Valid Till Date"), value: effectiveValidUntil },
    ],
    from: { label: t(locale, "From"), name: org.name, lines: [org.address, org.email, org.phone] },
    to: selectedCustomer
      ? { label: t(locale, "To Client"), name: selectedCustomer.name, lines: [selectedCustomer.address, selectedCustomer.email, selectedCustomer.phone] }
      : undefined,
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
            <FileText className="size-5" style={{ color: "var(--brand-orange)" }} /> {t(locale, isEdit ? "Edit Quotation" : "Create Quotation")}
          </h3>
          <div className="sub">{t(locale, isEdit ? "Edit this draft quotation." : "Create and send professional quotations to your clients.")}</div>
        </div>
        <DocTopActions locale={locale} busy={pendingDraft || pendingPrimary} onSaveDraft={() => submit(false)} onPreview={() => setPreviewOpen(true)} dirty={dirtyForm.dirty} />
      </div>

      <div className="doc-head-grid">
        <div>
          <div className="doc-header-grid">
            <DocFieldBox label={t(locale, "Quotation Number")} required mono gear gearDocType="quotation" locale={locale}>
              {numberPreview}
            </DocFieldBox>
            <DocFieldBox label={t(locale, "Quotation Date")} required htmlFor={`${fid}-quotation-date`}>
              <Input id={`${fid}-quotation-date`} type="date" aria-required value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </DocFieldBox>
          </div>
          <div className="doc-header-grid">
            <DocFieldBox
              label={t(locale, "Valid Till Date")}
              required
              htmlFor={`${fid}-valid-till`}
              gearDialog={
                <ValidityDaysDialog
                  locale={locale}
                  title={t(locale, "Valid Till Date")}
                  baseDate={issueDate}
                  baseLabel={t(locale, "Quotation Date")}
                  initialDays={validityDays}
                  onApply={(d) => {
                    setValidityDays(d);
                    setAutoValidity(true);
                  }}
                  trigger={
                    <button type="button" className="doc-gear-btn" title={t(locale, "Set validity period")} aria-label={t(locale, "Set validity period")}>
                      <Settings className="size-[15px]" />
                    </button>
                  }
                />
              }
            >
              <Input
                id={`${fid}-valid-till`}
                type="date"
                aria-required
                value={effectiveValidUntil}
                onChange={(e) => {
                  setValidUntil(e.target.value);
                  setAutoValidity(false);
                }}
              />
            </DocFieldBox>
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
          <FormField label={t(locale, "Quotation Title")} htmlFor={`${fid}-title`}>
            {(field) => (
              <Input id={field.id} aria-describedby={field.describedBy} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t(locale, "Write quotation title here…")} />
            )}
          </FormField>
        </div>
        <DocBrandPanel org={org} />
      </div>

      <div className="doc-meta-row">
        <PartyCardStatic locale={locale} label={t(locale, "From")} name={org.name} address={org.address} email={org.email} phone={org.phone} />
        <PartyCardSelect locale={locale} label={t(locale, "To Client")} customers={customers} value={customerId} onChange={setCustomerId} taxOverrides={org} defaultCountryCode={countryProfile.countryCode} />
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

      <LineItemsEditor locale={locale} products={products} items={items} onChange={setItems} defaultTaxRate={defaultTaxRate} variant="full" columns={columns} />

      <div className="doc-bottom-grid">
        <TermsBlock locale={locale} notes={notes} onNotesChange={setNotes} terms={terms} onTermsChange={setTerms} noteTemplates={noteTemplates} termsGroups={termsGroups} attachments={attachments} onAttachmentsChange={setAttachments} />
        <div className="flex flex-col gap-4">
          <TotalsCard locale={locale} subtotal={totals.subtotal} discount={discount} onDiscountChange={setDiscount} taxTotal={totals.taxTotal} total={totals.total} />
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
        primaryLabel="Save & Submit"
        editMode={isEdit}
        onPreview={() => setPreviewOpen(true)}
      />

      <PreviewDialog locale={locale} data={previewData} open={previewOpen} onOpenChange={setPreviewOpen} />
    </div>
    </CurrencyProvider>
  );
}
