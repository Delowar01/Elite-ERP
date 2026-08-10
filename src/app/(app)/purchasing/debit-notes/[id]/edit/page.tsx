import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db, debitNotesTable, debitNoteItemsTable, purchaseOrdersTable, vendorsTable, productsTable, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getDocumentContentPresets } from "@/lib/document-presets";
import { getLocale } from "@/lib/i18n/server";
import { tenantScope } from "@/lib/tenant";
import { canEditDocument } from "@/lib/document-edit";
import { getDocumentBankData } from "@/lib/document-bank-data";
import { initialSelectedIds } from "@/lib/document-bank-accounts";
import type { LineItemDraft } from "../../../../sales/_shared/line-items-editor";
import { DnForm } from "../../dn-form";

export default async function EditDebitNotePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const dnId = Number((await params).id);
  if (!Number.isInteger(dnId)) notFound();

  const [dn] = await db.select().from(debitNotesTable).where(and(eq(debitNotesTable.id, dnId), eq(debitNotesTable.orgId, session.orgId)));
  if (!dn) notFound();
  // Server-side authorization for a direct edit URL: the SAME shared rule the list menu and
  // the Preview Edit action use — draft-only, and never a record sitting in the Recycle Bin.
  if (!canEditDocument("debit_note", { status: dn.status, recordState: dn.deletedAt ? "deleted" : dn.archivedAt ? "archived" : "active" }))
    redirect(`/purchasing/debit-notes/${dnId}`);

  const [items, [sourcePo], products, [org]] = await Promise.all([
    db.select().from(debitNoteItemsTable).where(eq(debitNoteItemsTable.debitNoteId, dnId)),
    db
      .select({
        id: purchaseOrdersTable.id,
        poNumber: purchaseOrdersTable.poNumber,
        currency: purchaseOrdersTable.currency,
        vendorName: vendorsTable.name,
        vendorAddress: vendorsTable.address,
        vendorEmail: vendorsTable.email,
        vendorPhone: vendorsTable.phone,
      })
      .from(purchaseOrdersTable)
      .innerJoin(vendorsTable, eq(vendorsTable.id, purchaseOrdersTable.vendorId))
      .where(and(eq(purchaseOrdersTable.id, dn.sourcePurchaseOrderId), eq(purchaseOrdersTable.orgId, session.orgId))),
    db.select().from(productsTable).where(tenantScope(session.orgId, productsTable)).orderBy(asc(productsTable.name)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
  ]);
  const [presets, bankData] = await Promise.all([getDocumentContentPresets(session.orgId, "debit_note"), getDocumentBankData(session.orgId)]);

  const initialItems: LineItemDraft[] = items.map((it) => ({
    productId: it.productId ? String(it.productId) : "",
    description: it.description ?? "",
    quantity: it.quantity,
    unitPrice: it.unitCost,
    taxRatePercent: it.taxRatePercent,
    imageUrl: it.imageUrl ?? "",
    unit: it.unit ?? "",
    customFields: (it.customFields as Record<string, string>) ?? {},
  }));

  return (
    <div className="max-w-4xl mx-auto">
      <DnForm
        termsGroups={presets.termsGroups}
        locale={locale}
        purchaseOrders={sourcePo ? [sourcePo] : []}
        products={products}
        org={org}
        numberPreview={dn.debitNoteNumber}
        mode="edit"
        documentId={dnId}
        bankAccounts={bankData.bankAccounts}
        glAccounts={bankData.glAccounts}
        initial={{
          sourcePurchaseOrderId: String(dn.sourcePurchaseOrderId),
          issueDate: dn.issueDate,
          reason: dn.reason ?? "",
          items: initialItems,
          terms: dn.terms ?? [],
          bankAccountIds: initialSelectedIds(dn.bankAccounts, bankData.bankAccounts),
        }}
      />
    </div>
  );
}
