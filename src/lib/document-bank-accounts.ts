// A bank account's payment-instruction details, SNAPSHOTTED onto a document when it is saved. The
// snapshot lives in the document header (a jsonb column) so a saved document never changes when the
// underlying bank account is later edited or deleted, or when the org's default accounts change.
// Every field is optional and empty fields are never displayed. Selecting a bank account on a
// document is display-only — it records no payment, posts no journal entry, and never affects any
// balance. This module is DB-free so both client forms and server actions can use it.
export type DocBankAccount = {
  id?: number | null; // source bank_accounts.id — lets the edit form re-select it (may be gone if deleted)
  name: string; // account label ("Account Name")
  bankName?: string | null;
  accountHolder?: string | null;
  accountNumber?: string | null;
  iban?: string | null;
  swift?: string | null;
  currency?: string | null;
  branch?: string | null;
};

// The subset of a bank_accounts row this feature reads (avoids importing the DB layer here).
export type BankAccountLike = {
  id: number;
  name: string;
  bankName?: string | null;
  accountHolder?: string | null;
  accountNumberMasked?: string | null;
  iban?: string | null;
  swift?: string | null;
  currency?: string | null;
  branch?: string | null;
};

const clean = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim();
  return s || null;
};

// Map a live bank account row → a document snapshot.
export function toDocBankAccount(a: BankAccountLike): DocBankAccount {
  return {
    id: a.id,
    name: a.name,
    bankName: clean(a.bankName),
    accountHolder: clean(a.accountHolder),
    accountNumber: clean(a.accountNumberMasked),
    iban: clean(a.iban),
    swift: clean(a.swift),
    currency: clean(a.currency),
    branch: clean(a.branch),
  };
}

// Snapshot the selected accounts (by ordered id list) from the available live accounts. Ids that no
// longer resolve (e.g. a deleted account) are skipped. Order is preserved from `ids`.
export function snapshotSelectedBankAccounts(ids: number[] | null | undefined, available: BankAccountLike[]): DocBankAccount[] {
  if (!ids || ids.length === 0) return [];
  const byId = new Map(available.map((a) => [a.id, a]));
  const out: DocBankAccount[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const a = byId.get(id);
    if (a) out.push(toDocBankAccount(a));
  }
  return out;
}

// The ordered id list initially selected when editing a document: the stored snapshot's ids that
// still resolve to a live account (so the form can render + re-snapshot them).
export function initialSelectedIds(snapshot: DocBankAccount[] | null | undefined, available: BankAccountLike[]): number[] {
  if (!snapshot || snapshot.length === 0) return [];
  const availableIds = new Set(available.map((a) => a.id));
  const out: number[] = [];
  for (const s of snapshot) {
    if (typeof s.id === "number" && availableIds.has(s.id) && !out.includes(s.id)) out.push(s.id);
  }
  return out;
}

// Sanitize a snapshot array for storage (drop rows with no name, cap length, strip empties).
export function normalizeDocBankAccounts(arr: DocBankAccount[] | null | undefined): DocBankAccount[] | null {
  if (!arr || arr.length === 0) return null;
  const out = arr
    .filter((a) => a && typeof a.name === "string" && a.name.trim())
    .slice(0, 20)
    .map((a) => ({
      id: typeof a.id === "number" ? a.id : null,
      name: a.name.trim(),
      bankName: clean(a.bankName),
      accountHolder: clean(a.accountHolder),
      accountNumber: clean(a.accountNumber),
      iban: clean(a.iban),
      swift: clean(a.swift),
      currency: clean(a.currency),
      branch: clean(a.branch),
    }));
  return out.length ? out : null;
}
