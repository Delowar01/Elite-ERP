"use client";

import { useState, useTransition } from "react";
import { getLineDesc } from "../_shared/line-item-desc";
import { toast } from "sonner";
import { Receipt, Columns3 } from "lucide-react";
import { PartyCardStatic, PartyCardSelect } from "../_shared/party-card";
import { DocFieldBox } from "../_shared/doc-field-box";
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
import { EInvoicePreviewPanel } from "../_shared/einvoice-preview-panel";
import { BankAccountsField } from "../_shared/bank-accounts-field";
import { snapshotSelectedBankAccounts } from "@/lib/document-bank-accounts";
import type { EditableBankAccount, GlAccountOption } from "../../finance/bank-accounts/bank-account-form-dialog";
import { computeTotals } from "../_shared/totals";
import { CurrencyProvider } from "@/components/ui/currency-mark";
import { docMoneyMark } from "../_shared/doc-currency";
import { ConfigureColumnsDialog } from "../_shared/configure-columns-dialog";
import { resolveColumns, type ColumnDef } from "@/lib/column-config";
import { t, type Locale } from "@/lib/i18n/dict";
import { useDirtyForm } from "../../_shared/dirty-form";
import { getProfileByCountryName } from "@/lib/geo/country-profiles";
import type { ContentPreset } from "@/lib/document-presets";
import type { Customer, Product, Org } from "@/db";
import { createInvoiceAction, updateInvoiceAction } from "./actions";

export type InvoiceFormInitial = {
  title: string;
  customerId: string;
  projectId: string;
  issueDate: string;
  dueDate?: string;
  paymentTermId?: string;
  discount: string;
  notes: string;
  items: LineItemDraft[];
  terms?: DocumentTerm[];
  bankAccountIds?: number[];
  currency?: string;
};

/** A Payment Terms preset, used to derive the due date (Net 30 → issue date + 30 days). */
export type PaymentTermOption = { id: number; name: string; netDays: number };

/** issueDate + netDays, as a YYYY-MM-DD string. Returns "" when the issue date is not yet valid. */
function addDays(issueDate: string, netDays: number): string {
  const base = new Date(`${issueDate}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return "";
  base.setUTCDate(base.getUTCDate() + netDays);
  return base.toISOString().slice(0, 10);
}

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
  columnConfig,
  bankAccounts = [],
  glAccounts = [],
  defaultBankAccountIds = [],
  sealAssets = [],
  paymentTerms = [],
}: {
  paymentTerms?: PaymentTermOption[];
  sealAssets?: SealAsset[];
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
  columnConfig?: ColumnDef[];
  bankAccounts?: EditableBankAccount[];
  glAccounts?: GlAccountOption[];
  defaultBankAccountIds?: number[];
}) {
  const isEdit = mode === "edit";
  const [columns, setColumns] = useState<ColumnDef[]>(columnConfig ?? resolveColumns(null));
  const [title, setTitle] = useState(initial?.title ?? "");
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [issueDate, setIssueDateRaw] = useState(initial?.issueDate ?? new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDateRaw] = useState(initial?.dueDate ?? "");
  const [paymentTermId, setPaymentTermId] = useState(initial?.paymentTermId ?? "");
  // True once the user has typed a due date themselves. From then on, changing the issue date no
  // longer moves it — only explicitly picking a payment term does, since that is a deliberate act.
  const [dueDateEdited, setDueDateEdited] = useState(Boolean(initial?.dueDate));
  const [discount, setDiscount] = useState(initial?.discount ?? "0");

  // Picking a term always re-derives the due date (an explicit choice outranks a previous manual
  // edit); clearing the term leaves whatever date is there.
  function choosePaymentTerm(id: string) {
    setPaymentTermId(id);
    const term = paymentTerms.find((p) => String(p.id) === id);
    if (!term || !issueDate) return;
    setDueDateRaw(addDays(issueDate, term.netDays));
    setDueDateEdited(false);
  }

  // Moving the issue date carries an auto-derived due date along with it, but never overwrites one
  // the user typed.
  function setIssueDate(next: string) {
    setIssueDateRaw(next);
    if (dueDateEdited) return;
    const term = paymentTerms.find((p) => String(p.id) === paymentTermId);
    if (term && next) setDueDateRaw(addDays(next, term.netDays));
  }

  function setDueDate(next: string) {
    setDueDateRaw(next);
    setDueDateEdited(true);
  }
  const defaultNote = noteTemplates.find((n) => n.isDefault) ?? noteTemplates[0];
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

  const totals = computeTotals(items, discount, currency);
  const selectedCustomer = customers.find((c) => String(c.id) === customerId);

  // Everything that counts as this document's content. Leaving a field out would leave it
  // unprotected, so line items, terms, notes, attachments, bank accounts and the seal are all in.

  const dirtyForm = useDirtyForm({ title, customerId, projectId, issueDate, dueDate, paymentTermId, discount, notes, terms, items, attachments, bankAccountIds, currency, sealOverride, signatureOverride });

  function submit(andSend: boolean) {
    const start = andSend ? startPrimaryTransition : startDraftTransition;
    start(async () => {
      // Clean BEFORE the call: a successful save redirects from the server and never returns,
      // so marking clean afterwards would be too late and the user would be asked to discard
      // exactly what they just saved. A failure below puts the dirty state back.
      dirtyForm.markClean();
      const payload = { title, customerId, projectId, issueDate, dueDate, paymentTermId, discount, notes, terms, items, attachments, bankAccountIds, currency, sealUrl: sealOverride, signatureUrl: signatureOverride };
      const result = isEdit && documentId ? await updateInvoiceAction(documentId, payload) : await createInvoiceAction(payload, andSend);
      if (result?.error) {
        dirtyForm.restoreDirty();
        toast.error(result.error);
      }
    });
  }

  const previewData: PreviewData = {
    docLabel: t(locale, "Invoice"),
    number: numberPreview,
    title,
    fields: [
      { label: t(locale, "Issue Date"), value: issueDate },
      ...(dueDate ? [{ label: t(locale, "Due Date"), value: dueDate }] : []),
    ],
    from: { label: t(locale, "From"), name: org.name, lines: [org.address, org.email, org.phone] },
    to: selectedCustomer ? { label: t(locale, "To Client"), name: selectedCustomer.name, lines: [selectedCustomer.address, selectedCustomer.email, selectedCustomer.phone] } : undefined,
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
          {/* Payment Terms drives the Due Date (Net 30 → issue date + 30 days); the date itself
              stays editable, and a hand-typed date is never overwritten by moving the issue date. */}
          <div className="doc-header-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <DocFieldBox label={t(locale, "Payment Terms")}>
              <select value={paymentTermId} onChange={(e) => choosePaymentTerm(e.target.value)} className="w-full bg-transparent outline-none">
                <option value="">—</option>
                {paymentTerms.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
            </DocFieldBox>
            <DocFieldBox label={t(locale, "Due Date")}>
              <input type="date" value={dueDate} min={issueDate || undefined} onChange={(e) => setDueDate(e.target.value)} className="w-full bg-transparent outline-none" />
            </DocFieldBox>
          </div>
          <div className="doc-header-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
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
            documentType="sales_invoice"
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
          <EInvoicePreviewPanel locale={locale} vatNumber={org.vatNumber} taxTotal={totals.taxTotal} variant="create" />
        </div>
      </div>

      <div className="mt-4">
        <BankAccountsField locale={locale} accounts={bankAccounts} glAccounts={glAccounts} value={bankAccountIds} onChange={setBankAccountIds} />
      </div>

      <SealSignaturePreview locale={locale} sealUrl={org.sealUrl} signatureUrl={org.signatureUrl} sealAssets={sealAssets} sealOverride={sealOverride} signatureOverride={signatureOverride} onSealOverride={setSealOverride} onSignatureOverride={setSignatureOverride} />

      <DocFooterContact locale={locale} email={org.email} phone={org.phone} />

      <DocActionBar
        locale={locale}
        pendingDraft={pendingDraft}
        pendingPrimary={pendingPrimary}
        onSaveDraft={() => submit(false)}
        onPrimary={() => submit(isEdit ? false : true)}
        primaryLabel="Send to Client"
        editMode={isEdit}
        onPreview={() => setPreviewOpen(true)}
      />

      <PreviewDialog locale={locale} data={previewData} open={previewOpen} onOpenChange={setPreviewOpen} />
    </div>
    </CurrencyProvider>
  );
}
