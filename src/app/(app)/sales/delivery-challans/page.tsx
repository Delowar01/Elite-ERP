import { and, eq, desc, isNull, sql } from "drizzle-orm";
import { db, deliveryChallansTable, customersTable, usersTable, salesOrdersTable, salesInvoicesTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { DcListClient } from "./dc-list-client";

export default async function DeliveryChallansPage() {
  const session = await requireSession();
  const locale = await getLocale();

  const rows = await db
    .select({
      id: deliveryChallansTable.id,
      dcNumber: deliveryChallansTable.dcNumber,
      title: deliveryChallansTable.title,
      customerName: customersTable.name,
      dispatchDate: deliveryChallansTable.dispatchDate,
      status: deliveryChallansTable.status,
      creatorName: usersTable.name,
      isArchived: sql<boolean>`${deliveryChallansTable.archivedAt} is not null`,
      sourceSoNumber: salesOrdersTable.soNumber,
      sourceInvoiceNumber: salesInvoicesTable.invoiceNumber,
    })
    .from(deliveryChallansTable)
    .innerJoin(customersTable, eq(customersTable.id, deliveryChallansTable.customerId))
    .innerJoin(usersTable, eq(usersTable.id, deliveryChallansTable.createdById))
    .leftJoin(salesOrdersTable, eq(salesOrdersTable.id, deliveryChallansTable.sourceSalesOrderId))
    .leftJoin(salesInvoicesTable, eq(salesInvoicesTable.id, deliveryChallansTable.sourceInvoiceId))
    .where(and(eq(deliveryChallansTable.orgId, session.orgId), isNull(deliveryChallansTable.deletedAt)))
    .orderBy(desc(deliveryChallansTable.id));

  const mapped = rows.map((r) => ({ ...r, sourceLabel: r.sourceSoNumber ?? r.sourceInvoiceNumber ?? null }));

  return <DcListClient locale={locale} rows={mapped} />;
}
