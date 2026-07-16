import { eq, desc } from "drizzle-orm";
import { db, purchaseOrdersTable, vendorsTable, usersTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { PoListClient } from "./po-list-client";

export default async function PurchaseOrdersPage() {
  const session = await requireSession();
  const locale = await getLocale();

  const rows = await db
    .select({
      id: purchaseOrdersTable.id,
      poNumber: purchaseOrdersTable.poNumber,
      title: purchaseOrdersTable.title,
      vendorName: vendorsTable.name,
      orderDate: purchaseOrdersTable.orderDate,
      expectedDate: purchaseOrdersTable.expectedDate,
      total: purchaseOrdersTable.total,
      status: purchaseOrdersTable.status,
      creatorName: usersTable.name,
    })
    .from(purchaseOrdersTable)
    .innerJoin(vendorsTable, eq(vendorsTable.id, purchaseOrdersTable.vendorId))
    .innerJoin(usersTable, eq(usersTable.id, purchaseOrdersTable.createdById))
    .where(eq(purchaseOrdersTable.orgId, session.orgId))
    .orderBy(desc(purchaseOrdersTable.id));

  return <PoListClient locale={locale} rows={rows} />;
}
