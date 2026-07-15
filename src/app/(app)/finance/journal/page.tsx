import { eq, desc, sql } from "drizzle-orm";
import { db, accountsTable, journalEntriesTable, journalLinesTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { JournalForm } from "./journal-form";

export default async function JournalPage() {
  const session = await requireSession();
  const locale = await getLocale();
  const orgId = session.orgId;

  const [accounts, recentEntries] = await Promise.all([
    db.select().from(accountsTable).where(eq(accountsTable.orgId, orgId)).orderBy(accountsTable.code),
    db
      .select({
        id: journalEntriesTable.id,
        entryDate: journalEntriesTable.entryDate,
        memo: journalEntriesTable.memo,
        sourceType: journalEntriesTable.sourceType,
        total: sql<string>`coalesce(sum(${journalLinesTable.debit}), 0)`,
      })
      .from(journalEntriesTable)
      .innerJoin(journalLinesTable, eq(journalLinesTable.journalEntryId, journalEntriesTable.id))
      .where(eq(journalEntriesTable.orgId, orgId))
      .groupBy(journalEntriesTable.id)
      .orderBy(desc(journalEntriesTable.entryDate), desc(journalEntriesTable.id))
      .limit(15),
  ]);

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-[22px]">
        <h3 className="text-[19px] font-bold">{t(locale, "New Journal Entry")}</h3>
        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-line/60 text-ink-muted">{t(locale, "Manual")}</span>
      </div>

      <JournalForm locale={locale} accounts={accounts} />

      <div className="mt-10 mb-3">
        <h3 className="text-[15px] font-bold">{t(locale, "Recent journal entries")}</h3>
      </div>
      {recentEntries.length === 0 ? (
        <p className="text-ink-muted text-sm">{t(locale, "No journal entries yet.")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Date")}</TableHead>
              <TableHead>{t(locale, "Memo")}</TableHead>
              <TableHead className="text-right">{t(locale, "Amount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentEntries.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-mono text-xs">{e.entryDate}</TableCell>
                <TableCell>{e.memo}</TableCell>
                <TableCell className="text-right font-mono">{Number(e.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
