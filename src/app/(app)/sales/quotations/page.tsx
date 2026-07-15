import { eq, desc } from "drizzle-orm";
import { db, quotationsTable, customersTable, usersTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { QuotationsListClient } from "./quotations-list-client";

export default async function QuotationsPage() {
  const session = await requireSession();
  const locale = await getLocale();

  const rows = await db
    .select({
      id: quotationsTable.id,
      quotationNumber: quotationsTable.quotationNumber,
      title: quotationsTable.title,
      customerName: customersTable.name,
      issueDate: quotationsTable.issueDate,
      validUntil: quotationsTable.validUntil,
      total: quotationsTable.total,
      status: quotationsTable.status,
      creatorName: usersTable.name,
    })
    .from(quotationsTable)
    .innerJoin(customersTable, eq(customersTable.id, quotationsTable.customerId))
    .innerJoin(usersTable, eq(usersTable.id, quotationsTable.createdById))
    .where(eq(quotationsTable.orgId, session.orgId))
    .orderBy(desc(quotationsTable.id));

  return <QuotationsListClient locale={locale} rows={rows} />;
}
