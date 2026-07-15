import { eq, desc } from "drizzle-orm";
import { db, proformaInvoicesTable, customersTable, usersTable, salesOrdersTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { ProformaListClient } from "./proforma-list-client";

export default async function ProformaPage() {
  const session = await requireSession();
  const locale = await getLocale();

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
      sourceSoNumber: salesOrdersTable.soNumber,
    })
    .from(proformaInvoicesTable)
    .innerJoin(customersTable, eq(customersTable.id, proformaInvoicesTable.customerId))
    .innerJoin(usersTable, eq(usersTable.id, proformaInvoicesTable.createdById))
    .leftJoin(salesOrdersTable, eq(salesOrdersTable.id, proformaInvoicesTable.sourceSalesOrderId))
    .where(eq(proformaInvoicesTable.orgId, session.orgId))
    .orderBy(desc(proformaInvoicesTable.id));

  return <ProformaListClient locale={locale} rows={rows} />;
}
