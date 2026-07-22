import { and, eq, desc, isNull, sql } from "drizzle-orm";
import { db, proformaInvoicesTable, customersTable, usersTable, salesOrdersTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { workspaceEntry } from "@/lib/document-list-workspace";
import { listSavedViews } from "../../documents/_workspace/saved-view-actions";
import { ProformaListClient } from "./proforma-list-client";

export default async function ProformaPage() {
  const session = await requireSession();
  const locale = await getLocale();
  const entry = workspaceEntry("proforma_invoice");
  const savedViews = await listSavedViews("proforma_invoice");

  const rows = await db
    .select({
      id: proformaInvoicesTable.id,
      proformaNumber: proformaInvoicesTable.proformaNumber,
      title: proformaInvoicesTable.title,
      customerName: customersTable.name,
      issueDate: proformaInvoicesTable.issueDate,
      total: proformaInvoicesTable.total,
      status: proformaInvoicesTable.status,
      creatorName: usersTable.name,
      isArchived: sql<boolean>`${proformaInvoicesTable.archivedAt} is not null`,
      sourceSoNumber: salesOrdersTable.soNumber,
    })
    .from(proformaInvoicesTable)
    .innerJoin(customersTable, eq(customersTable.id, proformaInvoicesTable.customerId))
    .innerJoin(usersTable, eq(usersTable.id, proformaInvoicesTable.createdById))
    .leftJoin(salesOrdersTable, eq(salesOrdersTable.id, proformaInvoicesTable.sourceSalesOrderId))
    .where(and(eq(proformaInvoicesTable.orgId, session.orgId), isNull(proformaInvoicesTable.deletedAt)))
    .orderBy(desc(proformaInvoicesTable.id));

  return (
    <ProformaListClient
      locale={locale}
      rows={rows}
      savedViews={savedViews}
      importColumns={entry.importColumns}
      statusOptions={entry.statuses}
      partyLabel={entry.partyLabel}
    />
  );
}
