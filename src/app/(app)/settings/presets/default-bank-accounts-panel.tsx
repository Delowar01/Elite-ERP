"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { t, type Locale } from "@/lib/i18n/dict";
import { BankAccountsField } from "../../sales/_shared/bank-accounts-field";
import type { EditableBankAccount, GlAccountOption } from "../../finance/bank-accounts/bank-account-form-dialog";
import { updateDefaultBankAccountsAction } from "./actions";

// Preset Management → Default Bank Accounts. Pick one or more default accounts (ordered) that
// pre-fill the Bank Account section of NEW documents. Reuses the same shared BankAccountsField as the
// document forms (no duplicate selection logic). Saving here never changes documents already saved.
export function DefaultBankAccountsPanel({
  locale,
  accounts,
  glAccounts,
  initialIds,
}: {
  locale: Locale;
  accounts: EditableBankAccount[];
  glAccounts: GlAccountOption[];
  initialIds: number[];
}) {
  const [ids, setIds] = useState<number[]>(initialIds);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await updateDefaultBankAccountsAction(ids);
      if (result.error) toast.error(result.error);
      else toast.success(t(locale, "Saved"));
    });
  }

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div>
        <h3 className="text-[15px] font-bold">{t(locale, "Default Bank Accounts")}</h3>
        <p className="text-[12px] text-ink-muted mt-1">
          {t(locale, "These accounts appear automatically on new documents. You can still add, remove or reorder accounts on a single document without changing this default.")}
        </p>
      </div>
      {accounts.length === 0 ? (
        <p className="text-[12.5px] text-ink-faint">{t(locale, "No bank accounts yet. Add one from Finance → Bank Accounts or the New Bank Account button below.")}</p>
      ) : null}
      <BankAccountsField locale={locale} accounts={accounts} glAccounts={glAccounts} value={ids} onChange={setIds} />
      <div>
        <Button onClick={save} disabled={pending}>
          {pending ? t(locale, "Saving…") : t(locale, "Save Changes")}
        </Button>
      </div>
    </div>
  );
}
