"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, accountsTable, journalEntriesTable, journalLinesTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";

export type ActionResult = { error?: string };

const PATH = "/finance/journal";

type LineInput = { accountId: number; memo: string; debit: string; credit: string };

export async function postJournalEntryAction(input: {
  entryDate: string;
  memo: string;
  lines: LineInput[];
}): Promise<ActionResult> {
  const session = await requireSession();
  const memo = input.memo.trim();
  if (!memo) return { error: "Memo is required." };
  if (!input.entryDate) return { error: "Entry date is required." };

  const lines = input.lines.filter((l) => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0));
  if (lines.length < 2) return { error: "At least two lines are required." };

  const totalDebit = lines.reduce((sum, l) => sum + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + Number(l.credit || 0), 0);
  if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)) {
    return { error: "Total debits must equal total credits." };
  }

  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const orgAccounts = await db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(and(eq(accountsTable.orgId, session.orgId)));
  const validIds = new Set(orgAccounts.map((a) => a.id));
  if (accountIds.some((id) => !validIds.has(id))) return { error: "One or more accounts were not found." };

  const entryId = await db.transaction(async (tx) => {
    const [entry] = await tx
      .insert(journalEntriesTable)
      .values({
        orgId: session.orgId,
        entryDate: input.entryDate,
        memo,
        sourceType: "manual",
        createdById: session.userId,
      })
      .returning({ id: journalEntriesTable.id });

    await tx.insert(journalLinesTable).values(
      lines.map((l) => ({
        journalEntryId: entry.id,
        accountId: l.accountId,
        debit: String(Number(l.debit || 0)),
        credit: String(Number(l.credit || 0)),
        memo: l.memo.trim() || null,
      })),
    );

    return entry.id;
  });

  await logActivity(session, {
    type: "journal_entry.posted",
    description: `Posted journal entry "${memo}"`,
    entityType: "journal_entry",
    entityId: entryId,
  });
  revalidatePath(PATH);
  revalidatePath("/finance/chart-of-accounts");
  revalidatePath("/finance/ledger");
  revalidatePath("/finance/reports");
  return {};
}
