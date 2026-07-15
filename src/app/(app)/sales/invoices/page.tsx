import { eq, desc } from "drizzle-orm";
import { db, salesInvoicesTable, customersTable, usersTable, salesOrdersTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { InvoicesListClient } from "./invoices-list-client";

export default async function InvoicesPage() {
  const session = await requireSession();
  const locale = await getLocale();

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
      sourceSoNumber: salesOrdersTable.soNumber,
    })
    .from(salesInvoicesTable)
    .innerJoin(customersTable, eq(customersTable.id, salesInvoicesTable.customerId))
    .innerJoin(usersTable, eq(usersTable.id, salesInvoicesTable.createdById))
    .leftJoin(salesOrdersTable, eq(salesOrdersTable.id, salesInvoicesTable.sourceSalesOrderId))
    .where(eq(salesInvoicesTable.orgId, session.orgId))
    .orderBy(desc(salesInvoicesTable.id));

  return <InvoicesListClient locale={locale} rows={rows} />;
}
