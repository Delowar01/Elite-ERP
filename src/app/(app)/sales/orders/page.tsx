import { eq, desc } from "drizzle-orm";
import { db, salesOrdersTable, customersTable, usersTable, quotationsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { OrdersListClient } from "./orders-list-client";

export default async function OrdersPage() {
  const session = await requireSession();
  const locale = await getLocale();

  const rows = await db
    .select({
      id: salesOrdersTable.id,
      soNumber: salesOrdersTable.soNumber,
      title: salesOrdersTable.title,
      customerName: customersTable.name,
      issueDate: salesOrdersTable.issueDate,
      total: salesOrdersTable.total,
      status: salesOrdersTable.status,
      creatorName: usersTable.name,
      sourceQuotationNumber: quotationsTable.quotationNumber,
    })
    .from(salesOrdersTable)
    .innerJoin(customersTable, eq(customersTable.id, salesOrdersTable.customerId))
    .innerJoin(usersTable, eq(usersTable.id, salesOrdersTable.createdById))
    .leftJoin(quotationsTable, eq(quotationsTable.id, salesOrdersTable.sourceQuotationId))
    .where(eq(salesOrdersTable.orgId, session.orgId))
    .orderBy(desc(salesOrdersTable.id));

  return <OrdersListClient locale={locale} rows={rows} />;
}
