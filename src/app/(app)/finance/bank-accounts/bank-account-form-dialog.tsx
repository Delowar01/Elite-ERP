"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import { createBankAccountAction, updateBankAccountAction } from "./actions";
import { accountName } from "@/lib/account-names";

export type GlAccountOption = { id: number; code: string; name: string };
export type EditableBankAccount = {
  id: number;
  name: string;
  bankName: string | null;
  accountNumberMasked: string | null;
  accountHolder: string | null;
  iban: string | null;
  swift: string | null;
  currency: string | null;
  branch: string | null;
  glAccountId: number;
};

// The single shared create/edit dialog for a bank account — used by the Finance → Bank Accounts page
// AND by the in-document Bank Account section (so there is one form + validation + save path). Pass
// `account` to edit; omit it to create. `onSaved(id)` runs after a successful save (the document
// field uses it to refresh the account list and auto-select a newly created account). Editing the
// master record here never changes documents already saved with a snapshot of it.
export function BankAccountFormDialog({
  locale,
  glAccounts,
  account,
  trigger,
  onSaved,
}: {
  locale: Locale;
  glAccounts: GlAccountOption[];
  account?: EditableBankAccount;
  trigger: React.ReactNode;
  onSaved?: (id?: number) => void;
}) {
  const isEdit = !!account;
  const [open, setOpen] = useState(false);
  const [glAccountId, setGlAccountId] = useState(account ? String(account.glAccountId) : glAccounts[0] ? String(glAccounts[0].id) : "");
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    formData.set("glAccountId", glAccountId);
    startTransition(async () => {
      const result = isEdit ? await updateBankAccountAction(account!.id, formData) : await createBankAccountAction(formData);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(t(locale, "Saved"));
      setOpen(false);
      onSaved?.(result.id);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg w-[92vw] max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t(locale, "Edit Bank Account") : t(locale, "New Bank Account")}</DialogTitle>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <FormField label={t(locale, "Name")} htmlFor="ba-name">
            <Input id="ba-name" name="name" required autoFocus defaultValue={account?.name ?? ""} placeholder="e.g. Al Rajhi — Operating" />
          </FormField>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label={t(locale, "Bank Name")} htmlFor="ba-bank-name">
              <Input id="ba-bank-name" name="bankName" defaultValue={account?.bankName ?? ""} />
            </FormField>
            <FormField label={t(locale, "Account Holder Name")} htmlFor="ba-holder">
              <Input id="ba-holder" name="accountHolder" defaultValue={account?.accountHolder ?? ""} />
            </FormField>
            <FormField label={t(locale, "Account Number")} htmlFor="ba-account-number">
              <Input id="ba-account-number" name="accountNumberMasked" defaultValue={account?.accountNumberMasked ?? ""} placeholder="•••• 4471" />
            </FormField>
            <FormField label={t(locale, "IBAN")} htmlFor="ba-iban">
              <Input id="ba-iban" name="iban" defaultValue={account?.iban ?? ""} />
            </FormField>
            <FormField label={t(locale, "SWIFT / BIC")} htmlFor="ba-swift">
              <Input id="ba-swift" name="swift" defaultValue={account?.swift ?? ""} />
            </FormField>
            <FormField label={t(locale, "Currency")} htmlFor="ba-currency">
              <Input id="ba-currency" name="currency" defaultValue={account?.currency ?? ""} placeholder="SAR" />
            </FormField>
            <FormField label={t(locale, "Branch")} htmlFor="ba-branch">
              <Input id="ba-branch" name="branch" defaultValue={account?.branch ?? ""} />
            </FormField>
          </div>
          <FormField label={t(locale, "GL Account")} htmlFor="ba-gl-account">
            <Select value={glAccountId} onValueChange={setGlAccountId}>
              <SelectTrigger id="ba-gl-account">
                <SelectValue placeholder={t(locale, "Select an account")} />
              </SelectTrigger>
              <SelectContent>
                {glAccounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.code} · {accountName(locale, a)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          {!isEdit && (
            <FormField label={t(locale, "Opening Balance")} htmlFor="ba-opening-balance">
              <Input id="ba-opening-balance" name="openingBalance" type="number" step="0.01" defaultValue="0" />
            </FormField>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? t(locale, "Saving…") : t(locale, "Save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
