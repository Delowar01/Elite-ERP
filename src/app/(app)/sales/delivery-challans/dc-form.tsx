"use client";

import { useState, useTransition } from "react";
import { getLineDesc } from "../_shared/line-item-desc";
import { toast } from "sonner";
import { Truck } from "lucide-react";
import { PartyCardStatic, PartyCardSelect } from "../_shared/party-card";
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
import { t, type Locale } from "@/lib/i18n/dict";
import { useFormDirty, useLeaveWarning } from "../../_shared/unsaved-changes";
import { getProfileByCountryName } from "@/lib/geo/country-profiles";
import type { Customer, Product, Org } from "@/db";
import { createDeliveryChallanAction, updateDeliveryChallanAction } from "./actions";

export type DcFormInitial = {
  customerId: string;
  dispatchDate: string;
  carrier: string;
  vehicleNo: string;
  items: LineItemDraft[];
  terms?: DocumentTerm[];
  bankAccountIds?: number[];
};

export function DcForm({
  locale,
  customers,
  products,
  org,
  numberPreview,
  mode = "create",
  documentId,
  initial,
  termsGroups = [],
  bankAccounts = [],
  glAccounts = [],
  defaultBankAccountIds = [],
}: {
  locale: Locale;
  customers: Customer[];
  products: Product[];
  org: Org;
  numberPreview: string;
  mode?: "create" | "edit";
  documentId?: number;
  initial?: DcFormInitial;
  termsGroups?: ContentPreset[];
  bankAccounts?: EditableBankAccount[];
  glAccounts?: GlAccountOption[];
  defaultBankAccountIds?: number[];
}) {
  const isEdit = mode === "edit";
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [dispatchDate, setDispatchDate] = useState(initial?.dispatchDate ?? new Date().toISOString().slice(0, 10));
  const [carrier, setCarrier] = useState(initial?.carrier ?? "");
  const [vehicleNo, setVehicleNo] = useState(initial?.vehicleNo ?? "");
  const [terms, setTerms] = useState<DocumentTerm[]>(initial?.terms ?? []);
  const [bankAccountIds, setBankAccountIds] = useState<number[]>(initial?.bankAccountIds ?? (mode === "create" ? defaultBankAccountIds : []));
  const countryProfile = getProfileByCountryName(org.country);
  const defaultTaxRate = String(countryProfile.defaultTaxRate);
  const [items, setItems] = useState<LineItemDraft[]>(initial?.items && initial.items.length > 0 ? initial.items : [emptyLineItem(defaultTaxRate)]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pendingDraft, startDraftTransition] = useTransition();
  const [pendingPrimary, startPrimaryTransition] = useTransition();

  const selectedCustomer = customers.find((c) => String(c.id) === customerId);
  const previewData: PreviewData = {
    docLabel: t(locale, "Delivery Challan"),
    number: numberPreview,
    fields: [
      { label: t(locale, "Dispatch Date"), value: dispatchDate },
      { label: t(locale, "Carrier"), value: carrier },
      { label: t(locale, "Vehicle No."), value: vehicleNo },
    ],
    from: { label: t(locale, "From"), name: org.name, lines: [org.address, org.email, org.phone] },
    to: selectedCustomer ? { label: t(locale, "To Client"), name: selectedCustomer.name, lines: [selectedCustomer.address, selectedCustomer.email, selectedCustomer.phone] } : undefined,
    items: items.map((it) => ({ description: it.description, desc: getLineDesc(it.customFields), quantity: it.quantity })),
    showPricing: false,
    terms,
    currency: org.currency,
    bankAccounts: snapshotSelectedBankAccounts(bankAccountIds, bankAccounts),
  };

  // Warn before the tab is closed or reloaded with unsaved work (only when it really changed).
  useLeaveWarning(useFormDirty({ customerId, items }));

  function submit(andDispatch: boolean) {
    const start = andDispatch ? startPrimaryTransition : startDraftTransition;
    start(async () => {
      const payload = { customerId, dispatchDate, carrier, vehicleNo, items, terms, bankAccountIds };
      const result = isEdit && documentId
        ? await updateDeliveryChallanAction(documentId, payload)
        : await createDeliveryChallanAction({ title: "", ...payload }, andDispatch);
      if (result?.error) toast.error(result.error);
    });
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="doc-titlebar">
        <div>
          <h3>
            <Truck className="size-5" style={{ color: "var(--brand-orange)" }} /> {t(locale, isEdit ? "Edit Delivery Challan" : "Create Delivery Challan")}
          </h3>
          <div className="sub">{t(locale, isEdit ? "Edit this draft document." : "Dispatch stock to a client — logistics only, no pricing or ledger impact.")}</div>
        </div>
        <DocTopActions locale={locale} busy={pendingDraft || pendingPrimary} onSaveDraft={() => submit(false)} onPreview={() => setPreviewOpen(true)} />
      </div>

      <div className="doc-header-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <DocFieldBox label={t(locale, "DC Number")} required gear gearDocType="delivery_challan" locale={locale}>
          {numberPreview}
        </DocFieldBox>
        <DocFieldBox label={t(locale, "Dispatch Date")} required>
          <input type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} className="w-full bg-transparent outline-none" />
        </DocFieldBox>
      </div>
      <div className="doc-header-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <DocFieldBox label={t(locale, "Carrier")} plain>
          <input value={carrier} onChange={(e) => setCarrier(e.target.value)} className="w-full bg-transparent outline-none" />
        </DocFieldBox>
        <DocFieldBox label={t(locale, "Vehicle No.")} plain>
          <input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} className="w-full bg-transparent outline-none" />
        </DocFieldBox>
      </div>

      <div className="doc-meta-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <PartyCardStatic locale={locale} label={t(locale, "From")} name={org.name} address={org.address} email={org.email} phone={org.phone} />
        <PartyCardSelect locale={locale} label={t(locale, "To Client")} customers={customers} value={customerId} onChange={setCustomerId} taxOverrides={org} defaultCountryCode={countryProfile.countryCode} />
      </div>

      <DocPillsRow locale={locale} org={org} pills={[{ icon: "info", label: "Number Format" }]} />

      <LineItemsEditor locale={locale} products={products} items={items} onChange={setItems} defaultTaxRate={defaultTaxRate} variant="qty" />

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
        primaryLabel="Create & Dispatch"
        editMode={isEdit}
        onPreview={() => setPreviewOpen(true)}
      />

      <PreviewDialog locale={locale} data={previewData} open={previewOpen} onOpenChange={setPreviewOpen} />
    </div>
  );
}
