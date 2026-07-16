import { and, asc, eq } from "drizzle-orm";
import { db, purchaseOrdersTable, vendorsTable, productsTable, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { tenantScope } from "@/lib/tenant";
import { previewNextDocumentNumber } from "@/lib/documents";
import { DnForm } from "../dn-form";

export default async function NewDebitNotePage({ searchParams }: { searchParams: Promise<{ po?: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const { po } = await searchParams;

  const [purchaseOrders, products, [org], numberPreview] = await Promise.all([
    db
      .select({
        id: purchaseOrdersTable.id,
        poNumber: purchaseOrdersTable.poNumber,
        vendorName: vendorsTable.name,
        vendorAddress: vendorsTable.address,
        vendorEmail: vendorsTable.email,
        vendorPhone: vendorsTable.phone,
      })
      .from(purchaseOrdersTable)
      .innerJoin(vendorsTable, eq(vendorsTable.id, purchaseOrdersTable.vendorId))
      .where(and(eq(purchaseOrdersTable.orgId, session.orgId), eq(purchaseOrdersTable.status, "received")))
      .orderBy(asc(purchaseOrdersTable.poNumber)),
    db.select().from(productsTable).where(tenantScope(session.orgId, productsTable)).orderBy(asc(productsTable.name)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
    previewNextDocumentNumber(session.orgId, "debit_note"),
  ]);

  return (
    <div className="max-w-4xl">
      <DnForm locale={locale} purchaseOrders={purchaseOrders} products={products} org={org} numberPreview={numberPreview} defaultPoId={po} />
    </div>
  );
}
