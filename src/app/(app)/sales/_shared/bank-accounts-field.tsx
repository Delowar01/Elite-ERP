"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ArrowUp, ArrowDown, X, Pencil, Landmark } from "lucide-react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { t, type Locale } from "@/lib/i18n/dict";
import { toDocBankAccount } from "@/lib/document-bank-accounts";
import { BankAccountFormDialog, type EditableBankAccount, type GlAccountOption } from "../../finance/bank-accounts/bank-account-form-dialog";
import { BankAccountBlock } from "./bank-account-blocks";

// The shared Bank Account section for document create/edit pages. Users can select one or many bank
// accounts, remove, reorder, add a new account (in-page popup) and edit an existing one (same popup)
// — all without leaving the document, so unsaved data is preserved. The value is the ordered list of
// selected bank-account ids; the document action snapshots them at save time. Selecting an account
// here is display-only (payment instructions) — it records no payment and changes no balance.
export function BankAccountsField({
  locale,
  accounts,
  glAccounts,
  value,
  onChange,
}: {
  locale: Locale;
  accounts: EditableBankAccount[];
  glAccounts: GlAccountOption[];
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  const router = useRouter();
  const [addKey, setAddKey] = useState(0); // remounts the add-Select so its placeholder resets
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const selected = value.filter((id) => byId.has(id));
  const unselected = accounts.filter((a) => !value.includes(a.id));

  function move(index: number, dir: -1 | 1) {
    const next = [...value];
    const to = index + dir;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  }
  function remove(id: number) {
    onChange(value.filter((v) => v !== id));
  }
  function add(id: number) {
    if (!value.includes(id)) onChange([...value, id]);
    setAddKey((k) => k + 1);
  }

  return (
    <div className="doc-note-box" style={{ padding: 14 }}>
      <div className="flex items-center gap-2 mb-2">
        <Landmark className="size-4 text-ink-muted" />
        <div className="text-[12.5px] font-bold text-ink">{t(locale, "Bank Accounts")}</div>
      </div>
      <p className="text-[11px] text-ink-faint mb-3">
        {t(locale, "Shown on the document as payment instructions. This does not record a payment or change any balance.")}
      </p>

      {selected.length > 0 && (
        <div className="flex flex-col gap-2 mb-3">
          {selected.map((id, index) => {
            const a = byId.get(id)!;
            return (
              <div key={id} className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <BankAccountBlock locale={locale} account={toDocBankAccount(a)} />
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    type="button"
                    className="text-ink-faint hover:text-ink disabled:opacity-30"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    title={t(locale, "Move up")}
                    aria-label={t(locale, "Move up")}
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="text-ink-faint hover:text-ink disabled:opacity-30"
                    onClick={() => move(index, 1)}
                    disabled={index === selected.length - 1}
                    title={t(locale, "Move down")}
                    aria-label={t(locale, "Move down")}
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                  <BankAccountFormDialog
                    locale={locale}
                    glAccounts={glAccounts}
                    account={a}
                    onSaved={() => router.refresh()}
                    trigger={
                      <button type="button" className="text-ink-faint hover:text-brand-orange" title={t(locale, "Edit")} aria-label={t(locale, "Edit")}>
                        <Pencil className="size-3.5" />
                      </button>
                    }
                  />
                  <button
                    type="button"
                    className="text-ink-faint hover:text-danger"
                    onClick={() => remove(id)}
                    title={t(locale, "Remove")}
                    aria-label={t(locale, "Remove")}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="w-56">
          <Select key={addKey} value="" onValueChange={(v) => add(Number(v))}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder={t(locale, "Add a bank account…")} />
            </SelectTrigger>
            <SelectContent>
              {unselected.length === 0 ? (
                <div className="px-2 py-1.5 text-[12px] text-ink-faint">{t(locale, "All accounts added")}</div>
              ) : (
                unselected.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        <BankAccountFormDialog
          locale={locale}
          glAccounts={glAccounts}
          onSaved={(id) => {
            if (typeof id === "number") onChange([...value, id]);
            router.refresh();
          }}
          trigger={
            <button type="button" className="doc-pill-btn" style={{ height: 36 }}>
              <Plus className="size-3.5" /> {t(locale, "New Bank Account")}
            </button>
          }
        />
      </div>
    </div>
  );
}
