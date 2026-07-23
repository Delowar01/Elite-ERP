"use server";

import { revalidatePath } from "next/cache";
import { sanitizeIfHtml } from "@/lib/sanitize-html";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, customersTable, deliveryChallansTable, deliveryChallanItemsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { nextDocumentNumber } from "@/lib/documents";
import { can } from "@/lib/document-lifecycle";

export type ActionResult = { error?: string; id?: number };

const PATH = "/sales/delivery-challans";
const VALID_STATUSES = ["draft", "dispatched", "delivered"];

type LineInput = { productId: string; description: string; quantity: string; imageUrl?: string; unit?: string };

export async function createDeliveryChallanAction(
  input: {
    title: string;
    customerId: string;
    dispatchDate: string;
    carrier: string;
    vehicleNo: string;
    items: LineInput[];
  },
  andDispatch = false,
): Promise<ActionResult> {
  const session = await requireSession();
  const customerId = Number(input.customerId);
  if (!customerId) return { error: "Choose a client." };
  const [customerOwned] = await db.select({ id: customersTable.id }).from(customersTable).where(and(eq(customersTable.id, customerId), eq(customersTable.orgId, session.orgId)));
  if (!customerOwned) return { error: "Client not found." };

  const items = input.items.filter((l) => l.description.trim() && Number(l.quantity) > 0);
  if (items.length === 0) return { error: "Add at least one line item." };

  const id = await db.transaction(async (tx) => {
    const dcNumber = await nextDocumentNumber(tx, session.orgId, "delivery_challan");
    const [dc] = await tx
      .insert(deliveryChallansTable)
      .values({
        orgId: session.orgId,
        dcNumber,
        title: input.title.trim() || null,
        customerId,
        dispatchDate: input.dispatchDate || null,
        carrier: input.carrier.trim() || null,
        vehicleNo: input.vehicleNo.trim() || null,
        createdById: session.userId,
      })
      .returning({ id: deliveryChallansTable.id });

    await tx.insert(deliveryChallanItemsTable).values(
      items.map((l) => ({
        deliveryChallanId: dc.id,
        productId: l.productId ? Number(l.productId) : null,
        imageUrl: l.imageUrl || null,
        unit: l.unit || null,
        description: sanitizeIfHtml(l.description),
        quantity: l.quantity,
      })),
    );
    return dc.id;
  });

  await logActivity(session, { type: "delivery_challan.created", description: "Created a delivery challan", entityType: "delivery_challan", entityId: id });
  if (andDispatch) {
    await updateDeliveryChallanStatusAction(id, "dispatched");
  }
  revalidatePath(PATH);
  redirect(`/sales/delivery-challans/${id}`);
}

// Batch A2 — draft-only edit. Preserves number/org/status/title/source links (logistics-only: no totals).
export async function updateDeliveryChallanAction(
  id: number,
  input: { customerId: string; dispatchDate: string; carrier: string; vehicleNo: string; items: LineInput[] },
): Promise<ActionResult> {
  const session = await requireSession();
  const [existing] = await db.select().from(deliveryChallansTable).where(and(eq(deliveryChallansTable.id, id), eq(deliveryChallansTable.orgId, session.orgId)));
  if (!existing) return { error: "Delivery challan not found." };
  if (!can("delivery_challan", existing.status, "edit")) return { error: "Only draft delivery challans can be edited." };

  const customerId = Number(input.customerId);
  if (!customerId) return { error: "Choose a client." };
  const [customerOwned] = await db.select({ id: customersTable.id }).from(customersTable).where(and(eq(customersTable.id, customerId), eq(customersTable.orgId, session.orgId)));
  if (!customerOwned) return { error: "Client not found." };
  const items = input.items.filter((l) => l.description.trim() && Number(l.quantity) > 0);
  if (items.length === 0) return { error: "Add at least one line item." };

  await db.transaction(async (tx) => {
    await tx
      .update(deliveryChallansTable)
      .set({
        customerId,
        dispatchDate: input.dispatchDate || null,
        carrier: input.carrier.trim() || null,
        vehicleNo: input.vehicleNo.trim() || null,
        updatedAt: new Date(),
      })
      .where(and(eq(deliveryChallansTable.id, id), eq(deliveryChallansTable.orgId, session.orgId)));
    await tx.delete(deliveryChallanItemsTable).where(eq(deliveryChallanItemsTable.deliveryChallanId, id));
    await tx.insert(deliveryChallanItemsTable).values(
      items.map((l) => ({
        deliveryChallanId: id,
        productId: l.productId ? Number(l.productId) : null,
        imageUrl: l.imageUrl || null,
        unit: l.unit || null,
        description: sanitizeIfHtml(l.description),
        quantity: l.quantity,
      })),
    );
  });

  await logActivity(session, { type: "delivery_challan.updated", description: `Edited draft delivery challan ${existing.dcNumber}`, entityType: "delivery_challan", entityId: id });
  revalidatePath(PATH);
  revalidatePath(`/sales/delivery-challans/${id}`);
  redirect(`/sales/delivery-challans/${id}`);
}

export async function updateDeliveryChallanStatusAction(id: number, status: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!VALID_STATUSES.includes(status)) return { error: "Invalid status." };

  const patch: { status: string; updatedAt: Date; dispatchDate?: string; deliveredDate?: string } = { status, updatedAt: new Date() };
  const today = new Date().toISOString().slice(0, 10);
  if (status === "dispatched") patch.dispatchDate = today;
  if (status === "delivered") patch.deliveredDate = today;

  const result = await db
    .update(deliveryChallansTable)
    .set(patch)
    .where(and(eq(deliveryChallansTable.id, id), eq(deliveryChallansTable.orgId, session.orgId)))
    .returning({ id: deliveryChallansTable.id });
  if (!result.length) return { error: "Delivery challan not found." };

  await logActivity(session, { type: "delivery_challan.status_changed", description: `Marked delivery challan as ${status}`, entityType: "delivery_challan", entityId: id });
  revalidatePath(PATH);
  revalidatePath(`/sales/delivery-challans/${id}`);
  return {};
}
