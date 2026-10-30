import { asc, eq, desc, sql } from "drizzle-orm";
import { db, accountsTable, journalEntriesTable, journalLinesTable, projectsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Money } from "../../sales/_shared/money";
import { JournalForm } from "./journal-form";

export default async function JournalPage() {
  const session = await requireSession();
  const locale = await getLocale();
  const orgId = session.orgId;

  const [accounts, recentEntries, projects] = await Promise.all([
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
    db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.orgId, orgId)).orderBy(asc(projectsTable.name)),
  ]);

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title={t(locale, "New Journal Entry")} meta={<span className="org-pill">{t(locale, "Manual")}</span>} />

      <JournalForm locale={locale} accounts={accounts} currency={session.orgCurrency} projects={projects} />

      <SectionHeader level={2} title={t(locale, "Recent journal entries")} className="mt-10 mb-[22px]" />
      {recentEntries.length === 0 ? (
        <EmptyState message={t(locale, "No journal entries yet.")} />
      ) : (
        <Table density="compact">
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Date")}</TableHead>
              <TableHead>{t(locale, "Memo")}</TableHead>
              <TableHead className="num">{t(locale, "Amount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentEntries.map((e) => (
              <TableRow key={e.id} id={`je-${e.id}`} className="scroll-mt-24 target:bg-canvas">
                <TableCell className="num-tabular">{e.entryDate}</TableCell>
                <TableCell>{e.memo}</TableCell>
                <TableCell className="num">
                  <Money amount={e.total} context="summary" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
