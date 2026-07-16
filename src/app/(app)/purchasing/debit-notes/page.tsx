import { eq, desc } from "drizzle-orm";
import { db, debitNotesTable, vendorsTable, usersTable, purchaseOrdersTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { DnListClient } from "./dn-list-client";

export default async function DebitNotesPage() {
  const session = await requireSession();
  const locale = await getLocale();

  const rows = await db
    .select({
      id: debitNotesTable.id,
      debitNoteNumber: debitNotesTable.debitNoteNumber,
      title: debitNotesTable.title,
      vendorName: vendorsTable.name,
      issueDate: debitNotesTable.issueDate,
      total: debitNotesTable.total,
      status: debitNotesTable.status,
      creatorName: usersTable.name,
      sourcePoNumber: purchaseOrdersTable.poNumber,
      sourcePurchaseOrderId: debitNotesTable.sourcePurchaseOrderId,
    })
    .from(debitNotesTable)
    .innerJoin(vendorsTable, eq(vendorsTable.id, debitNotesTable.vendorId))
    .innerJoin(usersTable, eq(usersTable.id, debitNotesTable.createdById))
    .innerJoin(purchaseOrdersTable, eq(purchaseOrdersTable.id, debitNotesTable.sourcePurchaseOrderId))
    .where(eq(debitNotesTable.orgId, session.orgId))
    .orderBy(desc(debitNotesTable.id));

  return <DnListClient locale={locale} rows={rows} />;
}
