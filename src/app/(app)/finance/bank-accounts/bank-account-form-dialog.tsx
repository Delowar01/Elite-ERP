"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import { createBankAccountAction, openingContraOptionsAction, updateBankAccountAction } from "./actions";
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
  /**
   * The POSTED opening entry, read from the ledger rather than from the row's legacy column — the
   * column is an audit copy of what was typed and the ledger is what is true. Null when nothing was
   * posted (a zero opening balance, or a legacy row the backfill has not reached).
   */
  opening?: { date: string; amount: string } | null;
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

  // Opening balance — an ACCOUNTING EVENT, not a note on the record. It posts
  // `Dr <this account's GL> / Cr <contra>` dated `openingDate`, so it needs both, and the preview
  // line below exists to teach that: the field used to be a bare number that appeared on this
  // screen and in no statement anywhere.
  const [opening, setOpening] = useState("0");
  const [openingDate, setOpeningDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [contraId, setContraId] = useState("");
  const [contraOptions, setContraOptions] = useState<{ id: number; code: string; name: string; type: string }[]>([]);
  const hasOpening = !isEdit && Number(opening) !== 0 && Number.isFinite(Number(opening));

  useEffect(() => {
    if (!hasOpening || contraOptions.length > 0) return;
    let live = true;
    openingContraOptionsAction().then((rows) => {
      if (!live) return;
      setContraOptions(rows);
      // Owner capital is the overwhelmingly common answer, so 3000 is the default — but it is a
      // visible, changeable field, because "where did this money come from" has more than one
      // legitimate answer (capital, a director's loan, a migration residue).
      const preferred = rows.find((r) => r.code === "3000") ?? rows.find((r) => r.type === "equity") ?? rows[0];
      if (preferred) setContraId(String(preferred.id));
    });
    return () => { live = false; };
  }, [hasOpening, contraOptions.length]);

  const glAccount = glAccounts.find((a) => String(a.id) === glAccountId);
  const contra = contraOptions.find((a) => String(a.id) === contraId);
  const amount = Math.abs(Number(opening) || 0);
  // An overdraft at cutover flips the two lines rather than posting a negative debit.
  const debitSide = Number(opening) > 0 ? glAccount : contra;
  const creditSide = Number(opening) > 0 ? contra : glAccount;

  function submit(formData: FormData) {
    formData.set("glAccountId", glAccountId);
    if (hasOpening) {
      formData.set("openingDate", openingDate);
      formData.set("openingContraAccountId", contraId);
    }
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
          {isEdit && account?.opening && (
            <div className="rounded-lg border border-line bg-surface-sunken px-3 py-2.5">
              <div className="text-[11.5px] uppercase tracking-wide text-ink-faint">{t(locale, "Opening Balance")}</div>
              <div className="font-mono text-[13.5px] mt-0.5" data-testid="opening-readonly">
                {account.opening.amount} · {account.opening.date}
              </div>
              <p className="text-[11.5px] text-ink-muted mt-1 leading-relaxed">
                {t(locale, "Posted to the ledger. It cannot be edited here — correct it with a journal entry so the change is dated and appears in the reports.")}
              </p>
            </div>
          )}
          {!isEdit && (
            <>
              <FormField label={t(locale, "Opening Balance")} htmlFor="ba-opening-balance">
                <Input
                  id="ba-opening-balance"
                  name="openingBalance"
                  type="number"
                  step="0.001"
                  value={opening}
                  onChange={(e) => setOpening(e.target.value)}
                />
              </FormField>
              {hasOpening && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label={t(locale, "As of date")} htmlFor="ba-opening-date">
                    <Input
                      id="ba-opening-date"
                      type="date"
                      max={new Date().toISOString().slice(0, 10)}
                      value={openingDate}
                      onChange={(e) => setOpeningDate(e.target.value)}
                    />
                  </FormField>
                  <FormField label={t(locale, "Where it came from")} htmlFor="ba-opening-contra">
                    {/*
                      The guard is not defensive noise. Radix's Select renders a hidden native
                      <select> for form participation, and its options are registered by the item
                      texts — which mount in the same commit that sets this value, one render before
                      the registration lands. So a value set PROGRAMMATICALLY while the menu has
                      never been opened has no matching <option> yet: the browser refuses it, fires
                      a change event, and Radix reports it back as "". Without this, the default
                      contra account selected itself and was wiped a moment later, and the entry
                      preview showed "Cr —". No item here has an empty value, so an empty change is
                      never a real choice.
                    */}
                    <Select value={contraId} onValueChange={(v) => { if (v) setContraId(v); }}>
                      <SelectTrigger id="ba-opening-contra">
                        <SelectValue placeholder={t(locale, "Select an account")} />
                      </SelectTrigger>
                      <SelectContent>
                        {contraOptions.map((a) => (
                          <SelectItem key={a.id} value={String(a.id)}>
                            {a.code} · {accountName(locale, a)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                </div>
              )}
              {hasOpening && (
                <p className="text-[12px] text-ink-faint leading-relaxed" data-testid="opening-entry-preview">
                  {t(locale, "This posts a journal entry")}:{" "}
                  <span className="font-mono">
                    Dr {debitSide ? `${debitSide.code} ${debitSide.name}` : "—"} {amount} / Cr{" "}
                    {creditSide ? `${creditSide.code} ${creditSide.name}` : "—"} {amount}
                  </span>{" "}
                  — {t(locale, "dated")} {openingDate}. {t(locale, "It cannot be edited afterwards; correct it with a journal entry.")}
                </p>
              )}
            </>
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
