import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db, customersTable, productsTable, orgsTable, projectsTable, salesOrdersTable, salesOrderItemsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { tenantScope } from "@/lib/tenant";
import { can } from "@/lib/document-lifecycle";
import type { LineItemDraft } from "../../../_shared/line-items-editor";
import { OrderForm } from "../../order-form";

export default async function EditSalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const soId = Number((await params).id);
  if (!Number.isInteger(soId)) notFound();

  const [so] = await db.select().from(salesOrdersTable).where(and(eq(salesOrdersTable.id, soId), eq(salesOrdersTable.orgId, session.orgId)));
  if (!so) notFound();
  if (!can("sales_order", so.status, "edit")) redirect(`/sales/orders/${soId}`);

  const [items, customers, products, [org], projects] = await Promise.all([
    db.select().from(salesOrderItemsTable).where(eq(salesOrderItemsTable.salesOrderId, soId)),
    db.select().from(customersTable).where(tenantScope(session.orgId, customersTable)).orderBy(asc(customersTable.name)),
    db.select().from(productsTable).where(tenantScope(session.orgId, productsTable)).orderBy(asc(productsTable.name)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
    db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.orgId, session.orgId)).orderBy(asc(projectsTable.name)),
  ]);

  const initialItems: LineItemDraft[] = items.map((it) => ({
    productId: it.productId ? String(it.productId) : "",
    description: it.description ?? "",
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    taxRatePercent: it.taxRatePercent,
    imageUrl: it.imageUrl ?? "",
    unit: it.unit ?? "",
  }));

  return (
    <div className="max-w-5xl mx-auto">
      <OrderForm
        locale={locale}
        customers={customers}
        products={products}
        org={org}
        numberPreview={so.soNumber}
        projects={projects}
        mode="edit"
        documentId={soId}
        initial={{
          title: so.title ?? "",
          customerId: String(so.customerId),
          projectId: so.projectId ? String(so.projectId) : "",
          issueDate: so.issueDate,
          expectedDelivery: so.expectedDate ?? "",
          discount: so.discount,
          notes: so.notes ?? "",
          items: initialItems,
        }}
      />
    </div>
  );
}
