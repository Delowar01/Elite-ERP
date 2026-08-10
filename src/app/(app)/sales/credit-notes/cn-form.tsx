"use client";

import { useState, useTransition } from "react";
import { getLineDesc } from "../_shared/line-item-desc";
import { toast } from "sonner";
import { FileMinus2 } from "lucide-react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PartyCardStatic } from "../_shared/party-card";
import { DocFieldBox } from "../_shared/doc-field-box";
import { LineItemsEditor, emptyLineItem, type LineItemDraft } from "../_shared/line-items-editor";
import { DocPillsRow } from "../_shared/doc-pills-row";
import { DocFooterContact } from "../_shared/doc-footer-contact";
import { DocActionBar } from "../_shared/doc-action-bar";
import { DocTopActions } from "../_shared/doc-top-actions";
import { PreviewDialog, type PreviewData } from "../_shared/preview-dialog";
import { BankAccountsField } from "../_shared/bank-accounts-field";
import { snapshotSelectedBankAccounts } from "@/lib/document-bank-accounts";
import type { EditableBankAccount, GlAccountOption } from "../../finance/bank-accounts/bank-account-form-dialog";
import { DocumentTermsEditor } from "../_shared/terms-editor";
import type { DocumentTerm } from "../_shared/document-terms";
import type { ContentPreset } from "@/lib/document-presets";
import { Money } from "../_shared/money";
import { computeTotals } from "../_shared/totals";
import { t, type Locale } from "@/lib/i18n/dict";
import { useDirtyForm } from "../../_shared/dirty-form";
import { getProfileByCountryName } from "@/lib/geo/country-profiles";
import type { Product, Org } from "@/db";
import { createCreditNoteAction, updateCreditNoteAction } from "./actions";

type InvoiceOption = { id: number; invoiceNumber: string; customerName: string; customerAddress?: string | null; customerEmail?: string | null; customerPhone?: string | null };

export type CnFormInitial = {
  sourceInvoiceId: string;
  issueDate: string;
  reason: string;
  items: LineItemDraft[];
  terms?: DocumentTerm[];
  bankAccountIds?: number[];
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
  termsGroups = [],
  bankAccounts = [],
  glAccounts = [],
  defaultBankAccountIds = [],
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
  termsGroups?: ContentPreset[];
  bankAccounts?: EditableBankAccount[];
  glAccounts?: GlAccountOption[];
  defaultBankAccountIds?: number[];
}) {
  const isEdit = mode === "edit";
  const [sourceInvoiceId, setSourceInvoiceId] = useState(initial?.sourceInvoiceId ?? defaultInvoiceId ?? "");
  const [issueDate, setIssueDate] = useState(initial?.issueDate ?? new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [terms, setTerms] = useState<DocumentTerm[]>(initial?.terms ?? []);
  const [bankAccountIds, setBankAccountIds] = useState<number[]>(initial?.bankAccountIds ?? (mode === "create" ? defaultBankAccountIds : []));
  const countryProfile = getProfileByCountryName(org.country);
  const defaultTaxRate = String(countryProfile.defaultTaxRate);
  const [items, setItems] = useState<LineItemDraft[]>(initial?.items && initial.items.length > 0 ? initial.items : [emptyLineItem(defaultTaxRate)]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pendingDraft, startDraftTransition] = useTransition();
  const [pendingPrimary, startPrimaryTransition] = useTransition();

  const totals = computeTotals(items, 0, org.currency);
  const selectedInvoice = invoices.find((inv) => String(inv.id) === sourceInvoiceId);

  const previewData: PreviewData = {
    docLabel: t(locale, "Credit Note"),
    number: numberPreview,
    fields: [
      { label: t(locale, "Issue Date"), value: issueDate },
      { label: t(locale, "Reason"), value: reason },
    ],
    from: { label: t(locale, "From"), name: org.name, lines: [org.address, org.email, org.phone] },
    to: selectedInvoice ? { label: t(locale, "To Client"), name: selectedInvoice.customerName, lines: [selectedInvoice.customerAddress, selectedInvoice.customerEmail, selectedInvoice.customerPhone] } : undefined,
    items: items.map((it) => ({ description: it.description, desc: getLineDesc(it.customFields), quantity: it.quantity, unitPrice: String(Number(it.unitPrice) || 0), lineTotal: String((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)) })),
    showPricing: true,
    totals: { subtotal: totals.subtotal, discount: totals.discount, taxTotal: totals.taxTotal, total: totals.total },
    terms,
    currency: org.currency,
    bankAccounts: snapshotSelectedBankAccounts(bankAccountIds, bankAccounts),
  };

  // Everything that counts as this document's content. Leaving a field out would leave it
  // unprotected, so line items, terms, notes, attachments, bank accounts and the seal are all in.

  const dirtyForm = useDirtyForm({ sourceInvoiceId, issueDate, reason, terms, items, bankAccountIds });

  function submit(andIssue: boolean) {
    const start = andIssue ? startPrimaryTransition : startDraftTransition;
    start(async () => {
      // Clean BEFORE the call: a successful save redirects from the server and never returns,
      // so marking clean afterwards would be too late and the user would be asked to discard
      // exactly what they just saved. A failure below puts the dirty state back.
      dirtyForm.markClean();
      const result = isEdit && documentId
        ? await updateCreditNoteAction(documentId, { reason, items, terms, bankAccountIds })
        : await createCreditNoteAction({ title: "", sourceInvoiceId, reason, items, terms, bankAccountIds }, andIssue);
      if (result?.error) {
        dirtyForm.restoreDirty();
        toast.error(result.error);
      }
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
        <DocTopActions locale={locale} busy={pendingDraft || pendingPrimary} onSaveDraft={() => submit(false)} onPreview={() => setPreviewOpen(true)} />
      </div>

      <div className="doc-header-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <DocFieldBox label={t(locale, "CN Number")} required gear gearDocType="credit_note" locale={locale}>
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
        <PartyCardStatic locale={locale} label={t(locale, "From")} name={org.name} address={org.address} email={org.email} phone={org.phone} />
        {selectedInvoice ? (
          <PartyCardStatic
            locale={locale}
            label={t(locale, "To Client")}
            name={selectedInvoice.customerName}
            address={selectedInvoice.customerAddress}
            email={selectedInvoice.customerEmail}
            phone={selectedInvoice.customerPhone}
            editable={false}
          />
        ) : (
          <div className="card party-card-v2 flex items-center text-[12.5px] text-ink-faint">{t(locale, "Select an invoice to load the client.")}</div>
        )}
      </div>

      <DocPillsRow locale={locale} org={org} pills={[{ icon: "info", label: "Number Format" }]} />

      <LineItemsEditor locale={locale} products={products} items={items} onChange={setItems} defaultTaxRate={defaultTaxRate} variant="simple" />

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

      <div className="mt-4">
        <DocumentTermsEditor locale={locale} terms={terms} onChange={setTerms} groups={termsGroups} />
      </div>

      <div className="mt-4">
        <BankAccountsField locale={locale} accounts={bankAccounts} glAccounts={glAccounts} value={bankAccountIds} onChange={setBankAccountIds} />
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
        onPreview={() => setPreviewOpen(true)}
      />

      <PreviewDialog locale={locale} data={previewData} open={previewOpen} onOpenChange={setPreviewOpen} />
    </div>
  );
}
