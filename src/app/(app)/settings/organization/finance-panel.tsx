"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Org, BankAccount } from "@/db";
import { updateDefaultBankAccountAction, updateFiscalYearAction, updateVatConfigAction } from "./actions";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function DefaultBankAccountPanel({ locale, org, bankAccounts }: { locale: Locale; org: Org; bankAccounts: BankAccount[] }) {
  const [pending, startTransition] = useTransition();
  const [defaultBankAccountId, setDefaultBankAccountId] = useState(org.defaultBankAccountId ? String(org.defaultBankAccountId) : "");

  function submit() {
    const formData = new FormData();
    formData.set("defaultBankAccountId", defaultBankAccountId);
    startTransition(async () => {
      const result = await updateDefaultBankAccountAction(formData);
      if (result.error) toast.error(result.error);
      else toast.success(t(locale, "Saved"));
    });
  }

  return (
    <div className="flex flex-col gap-4 max-w-lg">
      <div>
        <h3 className="text-[17px] font-bold">{t(locale, "Default Bank Account")}</h3>
        <p className="text-[12px] text-ink-muted mt-1">
          {t(locale, "Pre-selected automatically on every new Payment Record and Purchase Order.")}
        </p>
      </div>
      <Select value={defaultBankAccountId} onValueChange={setDefaultBankAccountId}>
        <SelectTrigger>
          <SelectValue placeholder={t(locale, "None")} />
        </SelectTrigger>
        <SelectContent>
          {bankAccounts.map((account) => (
            <SelectItem key={account.id} value={String(account.id)}>
              {account.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div>
        <Button onClick={submit} disabled={pending}>
          {pending ? t(locale, "Saving…") : t(locale, "Save")}
        </Button>
      </div>
    </div>
  );
}

export function FiscalYearPanel({ locale, org }: { locale: Locale; org: Org }) {
  const [pending, startTransition] = useTransition();
  const [fiscalMonth, setFiscalMonth] = useState(String(org.fiscalYearStartMonth));

  function submit() {
    const formData = new FormData();
    formData.set("fiscalYearStartMonth", fiscalMonth);
    startTransition(async () => {
      const result = await updateFiscalYearAction(formData);
      if (result.error) toast.error(result.error);
      else toast.success(t(locale, "Saved"));
    });
  }

  return (
    <div className="flex flex-col gap-4 max-w-sm">
      <h3 className="text-[17px] font-bold">{t(locale, "Fiscal Year")}</h3>
      <FormField label={t(locale, "Fiscal Year Start")} htmlFor="fiscal-month">
        <Select value={fiscalMonth} onValueChange={setFiscalMonth}>
          <SelectTrigger id="fiscal-month">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((m, i) => (
              <SelectItem key={m} value={String(i + 1)}>
                {t(locale, m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <div>
        <Button onClick={submit} disabled={pending}>
          {pending ? t(locale, "Saving…") : t(locale, "Save")}
        </Button>
      </div>
    </div>
  );
}

export function VatConfigurationPanel({ locale, org }: { locale: Locale; org: Org }) {
  const [pending, startTransition] = useTransition();
  const [vatStatus, setVatStatus] = useState(org.vatRegistrationStatus);
  const [taxTreatment, setTaxTreatment] = useState(org.defaultTaxTreatment);
  const [rounding, setRounding] = useState(org.vatRounding);

  function submit() {
    const formData = new FormData();
    formData.set("vatRegistrationStatus", vatStatus);
    formData.set("defaultTaxTreatment", taxTreatment);
    formData.set("vatRounding", rounding);
    startTransition(async () => {
      const result = await updateVatConfigAction(formData);
      if (result.error) toast.error(result.error);
      else toast.success(t(locale, "Saved"));
    });
  }

  return (
    <div className="flex flex-col gap-4 max-w-lg">
      <h3 className="text-[17px] font-bold">{t(locale, "VAT Configuration")}</h3>
      <div className="grid grid-cols-1 gap-4">
        <FormField label={t(locale, "Registration Status")} htmlFor="vat-status">
          <Select value={vatStatus} onValueChange={setVatStatus}>
            <SelectTrigger id="vat-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="registered">{t(locale, "Registered")}</SelectItem>
              <SelectItem value="not_registered">{t(locale, "Not Registered")}</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField label={t(locale, "Default Tax Treatment")} htmlFor="tax-treatment">
          <Select value={taxTreatment} onValueChange={setTaxTreatment}>
            <SelectTrigger id="tax-treatment">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="exclusive">{t(locale, "Exclusive of VAT")}</SelectItem>
              <SelectItem value="inclusive">{t(locale, "Inclusive of VAT")}</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField label={t(locale, "Rounding Rule")} htmlFor="vat-rounding">
          <Select value={rounding} onValueChange={setRounding}>
            <SelectTrigger id="vat-rounding">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nearest_0_01">{t(locale, "Round to nearest 0.01 (Halala)")}</SelectItem>
              <SelectItem value="nearest_1">{t(locale, "Round to nearest 1")}</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
      </div>
      <div>
        <Button onClick={submit} disabled={pending}>
          {pending ? t(locale, "Saving…") : t(locale, "Save")}
        </Button>
      </div>
    </div>
  );
}
