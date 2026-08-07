import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getColumnConfig } from "@/lib/column-config-server";
import { db, vendorsTable, productsTable, orgsTable, purchaseOrdersTable, purchaseOrderItemsTable, projectsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { tenantScope } from "@/lib/tenant";
import { can } from "@/lib/document-lifecycle";
import { getDocumentBankData } from "@/lib/document-bank-data";
import { initialSelectedIds } from "@/lib/document-bank-accounts";
import type { LineItemDraft } from "../../../../sales/_shared/line-items-editor";
import { PoForm } from "../../po-form";

export default async function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const columnConfig = await getColumnConfig(session.orgId, session.userId, "purchase_order");
  const locale = await getLocale();
  const poId = Number((await params).id);
  if (!Number.isInteger(poId)) notFound();

  const [po] = await db.select().from(purchaseOrdersTable).where(and(eq(purchaseOrdersTable.id, poId), eq(purchaseOrdersTable.orgId, session.orgId)));
  if (!po) notFound();
  if (!can("purchase_order", po.status, "edit")) redirect(`/purchasing/orders/${poId}`);

  const [items, vendors, products, [org], bankData, projects] = await Promise.all([
    db.select().from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.purchaseOrderId, poId)),
    db.select().from(vendorsTable).where(tenantScope(session.orgId, vendorsTable)).orderBy(asc(vendorsTable.name)),
    db.select().from(productsTable).where(tenantScope(session.orgId, productsTable)).orderBy(asc(productsTable.name)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
    getDocumentBankData(session.orgId),
    db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.orgId, session.orgId)).orderBy(asc(projectsTable.name)),
  ]);

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
    <div className="max-w-5xl mx-auto">
      <PoForm
        locale={locale}
        vendors={vendors}
        products={products}
        org={org}
        numberPreview={po.poNumber}
        projects={projects}
        mode="edit"
        columnConfig={columnConfig}
        documentId={poId}
        bankAccounts={bankData.bankAccounts}
        glAccounts={bankData.glAccounts}
        initial={{
          title: po.title ?? "",
          vendorId: String(po.vendorId),
          projectId: po.projectId ? String(po.projectId) : "",
          orderDate: po.orderDate,
          expectedDate: po.expectedDate ?? "",
          discount: po.discount,
          notes: po.notes ?? "",
          terms: po.terms ?? [],
          items: initialItems,
          bankAccountIds: initialSelectedIds(po.bankAccounts, bankData.bankAccounts),
          currency: po.currency ?? undefined,
        }}
      />
    </div>
  );
}
