import { and, asc, eq } from "drizzle-orm";
import { db, purchaseOrdersTable, vendorsTable, productsTable, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getDocumentContentPresets } from "@/lib/document-presets";
import { getLocale } from "@/lib/i18n/server";
import { tenantScope } from "@/lib/tenant";
import { previewNextDocumentNumber } from "@/lib/documents";
import { getDocumentBankData } from "@/lib/document-bank-data";
import { DnForm } from "../dn-form";

export default async function NewDebitNotePage({ searchParams }: { searchParams: Promise<{ po?: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const { po } = await searchParams;

  const [purchaseOrders, products, [org], numberPreview, bankData] = await Promise.all([
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
    getDocumentBankData(session.orgId),
  ]);
  const presets = await getDocumentContentPresets(session.orgId, "debit_note");

  return (
    <div className="max-w-4xl mx-auto">
      <DnForm locale={locale} purchaseOrders={purchaseOrders} products={products} org={org} numberPreview={numberPreview} termsGroups={presets.termsGroups} defaultPoId={po}
        bankAccounts={bankData.bankAccounts} glAccounts={bankData.glAccounts} defaultBankAccountIds={bankData.defaultBankAccountIds} />
    </div>
  );
}
