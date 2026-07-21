import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db, customersTable, productsTable, orgsTable, deliveryChallansTable, deliveryChallanItemsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { tenantScope } from "@/lib/tenant";
import { can } from "@/lib/document-lifecycle";
import type { LineItemDraft } from "../../../_shared/line-items-editor";
import { DcForm } from "../../dc-form";

export default async function EditDcPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const dcId = Number((await params).id);
  if (!Number.isInteger(dcId)) notFound();

  const [dc] = await db.select().from(deliveryChallansTable).where(and(eq(deliveryChallansTable.id, dcId), eq(deliveryChallansTable.orgId, session.orgId)));
  if (!dc) notFound();
  if (!can("delivery_challan", dc.status, "edit")) redirect(`/sales/delivery-challans/${dcId}`);

  const [items, customers, products, [org]] = await Promise.all([
    db.select().from(deliveryChallanItemsTable).where(eq(deliveryChallanItemsTable.deliveryChallanId, dcId)),
    db.select().from(customersTable).where(tenantScope(session.orgId, customersTable)).orderBy(asc(customersTable.name)),
    db.select().from(productsTable).where(tenantScope(session.orgId, productsTable)).orderBy(asc(productsTable.name)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
  ]);

  const initialItems: LineItemDraft[] = items.map((it) => ({
    productId: it.productId ? String(it.productId) : "",
    description: it.description ?? "",
    quantity: it.quantity,
    unitPrice: "0",
    taxRatePercent: "0",
  }));

  return (
    <div className="max-w-4xl mx-auto">
      <DcForm
        locale={locale}
        customers={customers}
        products={products}
        org={org}
        numberPreview={dc.dcNumber}
        mode="edit"
        documentId={dcId}
        initial={{
          customerId: String(dc.customerId),
          dispatchDate: dc.dispatchDate ?? "",
          carrier: dc.carrier ?? "",
          vehicleNo: dc.vehicleNo ?? "",
          items: initialItems,
        }}
      />
    </div>
  );
}
