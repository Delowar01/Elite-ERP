import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, accountsTable, journalEntriesTable, journalLinesTable, type Account } from "@/db";

// Debit-normal accounts (asset/expense) grow with debits; credit-normal accounts
// (liability/equity/revenue) grow with credits — this signs the raw debit/credit sums
// into a single balance figure per the standard double-entry convention.
function signedBalance(account: Pick<Account, "normalBalance">, totalDebit: number, totalCredit: number): number {
  return account.normalBalance === "debit" ? totalDebit - totalCredit : totalCredit - totalDebit;
}

export async function getAccountBalances(orgId: number): Promise<Map<number, number>> {
  const accounts = await db.select().from(accountsTable).where(eq(accountsTable.orgId, orgId));

  const sums = await db
    .select({
      accountId: journalLinesTable.accountId,
      totalDebit: sql<string>`coalesce(sum(${journalLinesTable.debit}), 0)`,
      totalCredit: sql<string>`coalesce(sum(${journalLinesTable.credit}), 0)`,
    })
    .from(journalLinesTable)
    .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalLinesTable.journalEntryId))
    .where(eq(journalEntriesTable.orgId, orgId))
    .groupBy(journalLinesTable.accountId);

  const sumsByAccount = new Map(sums.map((s) => [s.accountId, s]));
  const balances = new Map<number, number>();
  for (const account of accounts) {
    const s = sumsByAccount.get(account.id);
    balances.set(account.id, s ? signedBalance(account, Number(s.totalDebit), Number(s.totalCredit)) : 0);
  }
  return balances;
}

export type LedgerRow = {
  entryId: number;
  date: string;
  memo: string;
  sourceType: string;
  debit: number;
  credit: number;
  runningBalance: number;
};

export async function getAccountLedger(orgId: number, accountId: number): Promise<LedgerRow[]> {
  const [account] = await db.select().from(accountsTable).where(and(eq(accountsTable.id, accountId), eq(accountsTable.orgId, orgId)));
  if (!account) return [];

  const rows = await db
    .select({
      entryId: journalEntriesTable.id,
      date: journalEntriesTable.entryDate,
      entryMemo: journalEntriesTable.memo,
      lineMemo: journalLinesTable.memo,
      sourceType: journalEntriesTable.sourceType,
      debit: journalLinesTable.debit,
      credit: journalLinesTable.credit,
    })
    .from(journalLinesTable)
    .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalLinesTable.journalEntryId))
    .where(and(eq(journalEntriesTable.orgId, orgId), eq(journalLinesTable.accountId, accountId)))
    .orderBy(journalEntriesTable.entryDate, journalEntriesTable.id);

  let running = 0;
  return rows.map((r) => {
    const debit = Number(r.debit);
    const credit = Number(r.credit);
    running += account.normalBalance === "debit" ? debit - credit : credit - debit;
    return {
      entryId: r.entryId,
      date: r.date,
      memo: r.lineMemo || r.entryMemo,
      sourceType: r.sourceType,
      debit,
      credit,
      runningBalance: running,
    };
  });
}
