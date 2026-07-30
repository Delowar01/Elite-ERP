import assert from "node:assert";
import {
  toDocBankAccount,
  snapshotSelectedBankAccounts,
  initialSelectedIds,
  normalizeDocBankAccounts,
  type BankAccountLike,
} from "../../src/lib/document-bank-accounts";

// Pure, DB-free tests for the Bank Account Selection snapshot logic (Issue #6). Selecting a bank
// account on a document is display-only; these functions only shape the snapshot that gets stored.

const accounts: BankAccountLike[] = [
  { id: 1, name: "Operating", bankName: "Al Rajhi", accountNumberMasked: "****1234", iban: "SA00", swift: "RJHISARI", currency: "SAR", branch: "Riyadh", accountHolder: "Elite" },
  { id: 2, name: "Payroll", bankName: "SNB", accountNumberMasked: "  ", iban: null, swift: undefined, currency: "SAR", branch: null, accountHolder: "" },
  { id: 3, name: "USD", bankName: "SAB", accountNumberMasked: "****9", currency: "USD" },
];

// toDocBankAccount: maps accountNumberMasked -> accountNumber, trims/nulls empties.
{
  const d = toDocBankAccount(accounts[0]);
  assert.equal(d.id, 1);
  assert.equal(d.accountNumber, "****1234");
  assert.equal(d.branch, "Riyadh");
  const d2 = toDocBankAccount(accounts[1]);
  assert.equal(d2.accountNumber, null, "blank masked number -> null");
  assert.equal(d2.accountHolder, null, "empty holder -> null");
  assert.equal(d2.swift, null, "undefined swift -> null");
}

// snapshotSelectedBankAccounts: preserves order, dedups, skips missing ids.
{
  const snap = snapshotSelectedBankAccounts([3, 1, 3, 99], accounts);
  assert.equal(snap.length, 2, "dedup + skip missing");
  assert.equal(snap[0].id, 3, "order preserved (3 first)");
  assert.equal(snap[1].id, 1);
  assert.deepEqual(snapshotSelectedBankAccounts([], accounts), []);
  assert.deepEqual(snapshotSelectedBankAccounts(null, accounts), []);
}

// initialSelectedIds: only ids whose account still resolves, order + dedup preserved.
{
  const stored = snapshotSelectedBankAccounts([2, 1], accounts);
  // account 2 later deleted -> only remaining live account 1 comes back
  const ids = initialSelectedIds(stored, [accounts[0]]);
  assert.deepEqual(ids, [1], "deleted account dropped from editable ids");
  // both live -> both returned in stored order
  assert.deepEqual(initialSelectedIds(stored, accounts), [2, 1]);
  assert.deepEqual(initialSelectedIds(null, accounts), []);
}

// normalizeDocBankAccounts: drops nameless rows, strips empties, caps at 20, returns null when empty.
{
  assert.equal(normalizeDocBankAccounts([]), null);
  assert.equal(normalizeDocBankAccounts([{ name: "  " }]), null, "nameless dropped -> null");
  const norm = normalizeDocBankAccounts([{ id: 5, name: " Main ", bankName: "  ", iban: "SA1" }]);
  assert.ok(norm);
  assert.equal(norm![0].name, "Main", "name trimmed");
  assert.equal(norm![0].bankName, null, "blank -> null");
  assert.equal(norm![0].iban, "SA1");
  const many = Array.from({ length: 30 }, (_, i) => ({ name: `A${i}` }));
  assert.equal(normalizeDocBankAccounts(many)!.length, 20, "capped at 20");
}

console.log("document-bank-accounts.test.ts — all assertions passed");
