"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Account } from "@/db";
import { createBankAccountAction } from "./actions";

export function BankAccountDialog({ locale, accounts }: { locale: Locale; accounts: Account[] }) {
  const [open, setOpen] = useState(false);
  const [glAccountId, setGlAccountId] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    formData.set("glAccountId", glAccountId);
    startTransition(async () => {
      const result = await createBankAccountAction(formData);
      if (result.error) toast.error(result.error);
      else {
        toast.success(t(locale, "Saved"));
        setOpen(false);
        setGlAccountId("");
      }
    });
  }

  return (
    <>
      <Button
        style={{ width: "auto" }}
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" /> {t(locale, "New Account")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(locale, "New Account")}</DialogTitle>
          </DialogHeader>
          <form action={submit} className="flex flex-col gap-4">
            <FormField label={t(locale, "Name")} htmlFor="ba-name">
              <Input id="ba-name" name="name" required autoFocus placeholder="e.g. Al Rajhi — Operating" />
            </FormField>
            <FormField label={t(locale, "Bank Name")} htmlFor="ba-bank-name">
              <Input id="ba-bank-name" name="bankName" />
            </FormField>
            <FormField label={t(locale, "Account Number")} htmlFor="ba-account-number">
              <Input id="ba-account-number" name="accountNumberMasked" placeholder="•••• 4471" />
            </FormField>
            <FormField label={t(locale, "GL Account")} htmlFor="ba-gl-account">
              <Select value={glAccountId} onValueChange={setGlAccountId}>
                <SelectTrigger id="ba-gl-account">
                  <SelectValue placeholder={t(locale, "Select an account")} />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.code} · {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label={t(locale, "Opening Balance")} htmlFor="ba-opening-balance">
              <Input id="ba-opening-balance" name="openingBalance" type="number" step="0.01" defaultValue="0" />
            </FormField>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? t(locale, "Saving…") : t(locale, "Save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
