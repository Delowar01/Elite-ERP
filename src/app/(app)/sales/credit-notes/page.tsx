import { and, eq, desc, isNull, sql } from "drizzle-orm";
import { db, creditNotesTable, customersTable, usersTable, salesInvoicesTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { workspaceEntry } from "@/lib/document-list-workspace";
import { listSavedViews } from "../../documents/_workspace/saved-view-actions";
import { CnListClient } from "./cn-list-client";

export default async function CreditNotesPage() {
  const session = await requireSession();
  const locale = await getLocale();
  const entry = workspaceEntry("credit_note");
  const savedViews = await listSavedViews("credit_note");

  const rows = await db
    .select({
      id: creditNotesTable.id,
      creditNoteNumber: creditNotesTable.creditNoteNumber,
      title: creditNotesTable.title,
      customerName: customersTable.name,
      issueDate: creditNotesTable.issueDate,
      total: creditNotesTable.total,
      status: creditNotesTable.status,
      creatorName: usersTable.name,
      isArchived: sql<boolean>`${creditNotesTable.archivedAt} is not null`,
      sourceInvoiceNumber: salesInvoicesTable.invoiceNumber,
      sourceInvoiceId: creditNotesTable.sourceInvoiceId,
    })
    .from(creditNotesTable)
    .innerJoin(customersTable, eq(customersTable.id, creditNotesTable.customerId))
    .innerJoin(usersTable, eq(usersTable.id, creditNotesTable.createdById))
    .innerJoin(salesInvoicesTable, eq(salesInvoicesTable.id, creditNotesTable.sourceInvoiceId))
    .where(and(eq(creditNotesTable.orgId, session.orgId), isNull(creditNotesTable.deletedAt)))
    .orderBy(desc(creditNotesTable.id));

  return (
    <CnListClient
      locale={locale}
      rows={rows}
      savedViews={savedViews}
      importColumns={entry.importColumns}
      statusOptions={entry.statuses}
      partyLabel={entry.partyLabel}
    />
  );
}
