import "server-only";
import { and, eq } from "drizzle-orm";
import { db, accountsTable, journalEntriesTable, journalLinesTable, type Account, type Tx } from "@/db";
import { captureBaseAmounts } from "@/lib/posting-currency";
import { roundMoney } from "@/lib/currency/currencies";

/**
 * A bank account's opening balance is a JOURNAL ENTRY, not a column.
 *
 * It used to be a plain number on `bank_accounts` that exactly one page added to the ledger at
 * render time. That figure had no date, no conversion, no counterpart and no place in double
 * entry, so it appeared in no Trial Balance, no Balance Sheet and no Cash Flow — and both
 * statements balanced without it, because nothing ever needed to compensate for money that was
 * never posted. The rule that replaces it is in verify/README.md: a displayed balance is a
 * function of the ledger and nothing else.
 *
 * The entry is two lines and, for the ordinary positive case, reads:
 *
 *     Dr <the account's own GL account>   opening balance
 *         Cr <contra: equity or liability>    opening balance
 *
 * ## Identity
 *
 * `sourceType = "bank_opening"`, `sourceId = bank_accounts.id`. The PAIR is the idempotency key —
 * `sourceId` values collide freely across source types, because each type draws its id from a
 * different table with its own sequence, so a check on the id alone can find an unrelated row and
 * skip a real posting. Both the creation path and the backfill test for the pair, which is what
 * lets either run twice with no effect.
 *
 * ## Signs
 *
 * A negative opening balance (an overdraft at cutover) FLIPS the two lines rather than posting a
 * negative debit. Every report signs its own figures from the debit/credit columns, so a negative
 * amount in one of them would be read as a positive on the other side by half of them.
 *
 * ## Currency
 *
 * The ledger holds base currency only. A foreign-currency bank account converts once, here, at the
 * OPENING DATE's rate, and stores the result — the same rule every other posting path follows. If
 * no rate exists on or before that date the posting is BLOCKED, never converted at 1.0: a blocked
 * posting is recoverable and a wrong ledger is not.
 *
 * ## Not handled here, because it does not exist yet
 *
 * The product has no closed-period concept — nothing anywhere locks a fiscal period against
 * posting. When one lands, this is one of the paths that must respect it, and an opening date
 * inside a closed period should refuse rather than move.
 */

/** Contra accounts an opening balance may credit. Equity is the common case (owner capital). */
export const OPENING_CONTRA_TYPES = ["equity", "liability"] as const;

export function openingContraRefusal(account: Pick<Account, "type" | "code" | "name">): string | null {
  if (!OPENING_CONTRA_TYPES.includes(account.type as (typeof OPENING_CONTRA_TYPES)[number])) {
    return `${account.code} ${account.name} is ${account.type === "asset" ? "an asset" : `a ${account.type}`} account. An opening balance is funded from equity (owner capital) or a liability (a loan) — crediting anything else states where the money came from wrongly.`;
  }
  return null;
}

export type OpeningPosting =
  | { ok: true; skip: true }
  | { ok: true; skip: false; exchangeRate: string; baseAmount: string; debitAccountId: number; creditAccountId: number }
  | { ok: false; error: string };

/**
 * Decide the entry. Returns `skip` for a zero opening balance — zero is not "post nothing because
 * it rounds away", it is genuinely no event, and posting a 0/0 entry would put an empty row in
 * every ledger view for every account that ever opened at zero.
 */
export async function buildBankOpeningPosting(args: {
  orgId: number;
  baseCurrency: string;
  /** The bank account's own currency column, verbatim — null means base. */
  accountCurrency: string | null;
  openingAmount: string;
  openingDate: string;
  glAccountId: number;
  contraAccountId: number;
}): Promise<OpeningPosting> {
  const amount = Number(args.openingAmount);
  if (!Number.isFinite(amount)) return { ok: false, error: "Opening balance is not a number." };
  if (amount === 0) return { ok: true, skip: true };

  const captured = await captureBaseAmounts({
    orgId: args.orgId,
    baseCurrency: args.baseCurrency,
    docCurrency: args.accountCurrency,
    // Converted as a magnitude; the SIGN decides which side the line lands on, below.
    total: roundMoney(Math.abs(amount), args.accountCurrency || args.baseCurrency),
    taxTotal: "0",
    date: args.openingDate,
  });
  if (!captured.ok) return { ok: false, error: captured.error };
  // A rate small enough to round the whole balance away would post a 0/0 entry that claims to
  // record money. Refuse rather than write it.
  if (Number(captured.baseTotal) === 0) {
    return { ok: false, error: `The opening balance converts to zero in ${args.baseCurrency} at the ${args.openingDate} rate. Check the rate before posting.` };
  }

  return {
    ok: true,
    skip: false,
    exchangeRate: captured.exchangeRate,
    baseAmount: captured.baseTotal,
    debitAccountId: amount > 0 ? args.glAccountId : args.contraAccountId,
    creditAccountId: amount > 0 ? args.contraAccountId : args.glAccountId,
  };
}

/**
 * Write the entry, keyed on `(bank_opening, bankAccountId)`. Re-entrant: a second call for the
 * same bank account finds the existing entry and does nothing.
 *
 * Takes the transaction handle so the entry and the bank-account row are one atomic write — a
 * bank account with an opening balance and no entry is precisely the broken state this repair
 * exists to remove, and it must not be creatable by a mid-flight failure.
 */
export async function writeBankOpeningEntry(
  tx: Tx,
  args: {
    orgId: number;
    bankAccountId: number;
    entryDate: string;
    memo: string;
    createdById: number;
    baseAmount: string;
    debitAccountId: number;
    creditAccountId: number;
  },
): Promise<{ entryId: number } | { skipped: "exists" }> {
  const [existing] = await tx
    .select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .where(and(
      eq(journalEntriesTable.orgId, args.orgId),
      eq(journalEntriesTable.sourceType, "bank_opening"),
      eq(journalEntriesTable.sourceId, args.bankAccountId),
    ))
    .limit(1);
  if (existing) return { skipped: "exists" };

  const [entry] = await tx
    .insert(journalEntriesTable)
    .values({
      orgId: args.orgId,
      entryDate: args.entryDate,
      memo: args.memo,
      sourceType: "bank_opening",
      sourceId: args.bankAccountId,
      createdById: args.createdById,
    })
    .returning({ id: journalEntriesTable.id });

  await tx.insert(journalLinesTable).values([
    { journalEntryId: entry.id, accountId: args.debitAccountId, debit: args.baseAmount, credit: "0" },
    { journalEntryId: entry.id, accountId: args.creditAccountId, debit: "0", credit: args.baseAmount },
  ]);
  return { entryId: entry.id };
}

/** Has this bank account's opening entry been posted? The read half of the immutability rule. */
export async function bankOpeningEntryId(
  dbOrTx: Tx | typeof db,
  orgId: number,
  bankAccountId: number,
): Promise<number | null> {
  const [row] = await dbOrTx
    .select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .where(and(
      eq(journalEntriesTable.orgId, orgId),
      eq(journalEntriesTable.sourceType, "bank_opening"),
      eq(journalEntriesTable.sourceId, bankAccountId),
    ))
    .limit(1);
  return row ? row.id : null;
}

/** The default contra: owner capital. Equity accounts an org can pick from, 3000 first. */
export async function openingContraChoices(
  dbOrTx: Tx | typeof db,
  orgId: number,
): Promise<Pick<Account, "id" | "code" | "name" | "type">[]> {
  const rows = await dbOrTx
    .select({ id: accountsTable.id, code: accountsTable.code, name: accountsTable.name, type: accountsTable.type })
    .from(accountsTable)
    .where(and(eq(accountsTable.orgId, orgId), eq(accountsTable.isActive, true)));
  return rows
    .filter((a) => OPENING_CONTRA_TYPES.includes(a.type as (typeof OPENING_CONTRA_TYPES)[number]))
    .sort((a, b) => (a.type === b.type ? a.code.localeCompare(b.code) : a.type === "equity" ? -1 : 1));
}
