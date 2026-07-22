import { and, eq, desc, isNull, sql } from "drizzle-orm";
import { db, salesInvoicesTable, customersTable, usersTable, salesOrdersTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { workspaceEntry } from "@/lib/document-list-workspace";
import { listSavedViews } from "../../documents/_workspace/saved-view-actions";
import { InvoicesListClient } from "./invoices-list-client";

export default async function InvoicesPage() {
  const session = await requireSession();
  const locale = await getLocale();
  const entry = workspaceEntry("sales_invoice");
  const savedViews = await listSavedViews("sales_invoice");

  const rows = await db
    .select({
      id: salesInvoicesTable.id,
      invoiceNumber: salesInvoicesTable.invoiceNumber,
      title: salesInvoicesTable.title,
      customerName: customersTable.name,
      issueDate: salesInvoicesTable.issueDate,
      dueDate: salesInvoicesTable.dueDate,
      total: salesInvoicesTable.total,
      status: salesInvoicesTable.status,
      creatorName: usersTable.name,
      isArchived: sql<boolean>`${salesInvoicesTable.archivedAt} is not null`,
      sourceSoNumber: salesOrdersTable.soNumber,
    })
    .from(salesInvoicesTable)
    .innerJoin(customersTable, eq(customersTable.id, salesInvoicesTable.customerId))
    .innerJoin(usersTable, eq(usersTable.id, salesInvoicesTable.createdById))
    .leftJoin(salesOrdersTable, eq(salesOrdersTable.id, salesInvoicesTable.sourceSalesOrderId))
    .where(and(eq(salesInvoicesTable.orgId, session.orgId), isNull(salesInvoicesTable.deletedAt)))
    .orderBy(desc(salesInvoicesTable.id));

  return (
    <InvoicesListClient
      locale={locale}
      rows={rows}
      savedViews={savedViews}
      importColumns={entry.importColumns}
      statusOptions={entry.statuses}
      partyLabel={entry.partyLabel}
    />
  );
}
