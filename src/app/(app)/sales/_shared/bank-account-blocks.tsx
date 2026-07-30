import { t, type Locale } from "@/lib/i18n/dict";
import type { DocBankAccount } from "@/lib/document-bank-accounts";

// Read-only display of a document's selected bank accounts (payment instructions). Multiple accounts
// render as separate blocks. Only non-empty fields are shown. Shared by the create/edit form's
// selected list, the detail page, and the preview dialog (print/PDF has its own print-styled block).
function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value || !value.trim()) return null;
  return (
    <div className="flex justify-between gap-4 text-[12px]">
      <span className="text-ink-faint">{label}</span>
      <span className="font-medium text-ink text-end break-words">{value}</span>
    </div>
  );
}

export function BankAccountBlock({ locale, account }: { locale: Locale; account: DocBankAccount }) {
  return (
    <div className="rounded-[10px] border border-line bg-surface p-3 flex flex-col gap-1">
      <div className="text-[12.5px] font-bold text-ink">{account.name}</div>
      <Row label={t(locale, "Bank Name")} value={account.bankName} />
      <Row label={t(locale, "Account Holder Name")} value={account.accountHolder} />
      <Row label={t(locale, "Account Number")} value={account.accountNumber} />
      <Row label={t(locale, "IBAN")} value={account.iban} />
      <Row label={t(locale, "SWIFT / BIC")} value={account.swift} />
      <Row label={t(locale, "Currency")} value={account.currency} />
      <Row label={t(locale, "Branch")} value={account.branch} />
    </div>
  );
}

export function BankAccountBlocks({ locale, accounts, className }: { locale: Locale; accounts: DocBankAccount[] | null | undefined; className?: string }) {
  if (!accounts || accounts.length === 0) return null;
  return (
    <div className={className}>
      <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-2">{t(locale, "Bank Details")}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {accounts.map((a, i) => (
          <BankAccountBlock key={a.id ?? i} locale={locale} account={a} />
        ))}
      </div>
    </div>
  );
}
