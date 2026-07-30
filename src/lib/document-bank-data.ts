import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, bankAccountsTable, accountsTable, orgsTable } from "@/db";
import { snapshotSelectedBankAccounts, normalizeDocBankAccounts, type DocBankAccount } from "./document-bank-accounts";

export type DocBankAccountOption = {
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

// Everything a document create/edit form needs to render the Bank Account section: the org's active
// bank accounts (with all display fields), the GL accounts for the create/edit dialog, and the
// ordered preset defaults that pre-fill NEW documents. Tenant-scoped.
export async function getDocumentBankData(orgId: number): Promise<{
  bankAccounts: DocBankAccountOption[];
  glAccounts: { id: number; code: string; name: string }[];
  defaultBankAccountIds: number[];
}> {
  const [rows, glAccounts, orgRows] = await Promise.all([
    db
      .select()
      .from(bankAccountsTable)
      .where(and(eq(bankAccountsTable.orgId, orgId), eq(bankAccountsTable.isActive, true)))
      .orderBy(asc(bankAccountsTable.name)),
    db
      .select({ id: accountsTable.id, code: accountsTable.code, name: accountsTable.name })
      .from(accountsTable)
      .where(eq(accountsTable.orgId, orgId))
      .orderBy(asc(accountsTable.code)),
    db.select({ defaultBankAccountIds: orgsTable.defaultBankAccountIds }).from(orgsTable).where(eq(orgsTable.id, orgId)),
  ]);
  const bankAccounts: DocBankAccountOption[] = rows.map((b) => ({
    id: b.id,
    name: b.name,
    bankName: b.bankName,
    accountNumberMasked: b.accountNumberMasked,
    accountHolder: b.accountHolder,
    iban: b.iban,
    swift: b.swift,
    currency: b.currency,
    branch: b.branch,
    glAccountId: b.glAccountId,
  }));
  const validIds = new Set(bankAccounts.map((b) => b.id));
  const defaultBankAccountIds = (orgRows[0]?.defaultBankAccountIds ?? []).filter((id) => validIds.has(id));
  return { bankAccounts, glAccounts, defaultBankAccountIds };
}

// Snapshot the selected bank accounts (ordered ids) at document save time. Tenant-scoped; only the
// org's active accounts are snapshotted. Returns null when nothing is selected.
export async function snapshotDocumentBankAccounts(orgId: number, ids: number[] | null | undefined): Promise<DocBankAccount[] | null> {
  if (!ids || ids.length === 0) return null;
  const rows = await db
    .select()
    .from(bankAccountsTable)
    .where(and(eq(bankAccountsTable.orgId, orgId), eq(bankAccountsTable.isActive, true)));
  return normalizeDocBankAccounts(snapshotSelectedBankAccounts(ids, rows));
}
