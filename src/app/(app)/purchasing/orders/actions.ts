"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db, purchaseOrdersTable, purchaseOrderItemsTable, productsTable, accountsTable, journalEntriesTable, journalLinesTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { nextDocumentNumber } from "@/lib/documents";
import { computeTotals, type LineItemInput } from "../../sales/_shared/totals";

export type ActionResult = { error?: string; id?: number };

const PATH = "/purchasing/orders";

type LineInput = { productId: string; description: string; quantity: string; unitPrice: string; taxRatePercent: string };

export async function createPurchaseOrderAction(input: {
  title: string;
  vendorId: string;
  orderDate: string;
  expectedDate: string;
  discount: string;
  notes: string;
  items: LineInput[];
}): Promise<ActionResult> {
  const session = await requireSession();
  const vendorId = Number(input.vendorId);
  if (!vendorId) return { error: "Choose a vendor." };
  if (!input.orderDate) return { error: "Order date is required." };

  const items = input.items.filter((l) => l.description.trim() && Number(l.quantity) > 0);
  if (items.length === 0) return { error: "Add at least one line item." };

  const totals = computeTotals(items as LineItemInput[], input.discount);

  const id = await db.transaction(async (tx) => {
    const poNumber = await nextDocumentNumber(tx, session.orgId, "purchase_order");
    const [po] = await tx
      .insert(purchaseOrdersTable)
      .values({
        orgId: session.orgId,
        poNumber,
        title: input.title.trim() || null,
        vendorId,
        orderDate: input.orderDate,
        expectedDate: input.expectedDate || null,
        notes: input.notes.trim() || null,
        subtotal: totals.subtotal,
        discount: totals.discount,
        taxTotal: totals.taxTotal,
        total: totals.total,
        createdById: session.userId,
      })
      .returning({ id: purchaseOrdersTable.id });

    await tx.insert(purchaseOrderItemsTable).values(
      items.map((l) => ({
        purchaseOrderId: po.id,
        productId: l.productId ? Number(l.productId) : null,
        description: l.description.trim(),
        quantity: l.quantity,
        unitCost: l.unitPrice,
        taxRatePercent: l.taxRatePercent,
        lineTotal: ((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)).toFixed(2),
      })),
    );
    return po.id;
  });

  await logActivity(session, { type: "purchase_order.created", description: "Created a purchase order", entityType: "purchase_order", entityId: id });
  revalidatePath(PATH);
  redirect(`/purchasing/orders/${id}`);
}

export async function sendPurchaseOrderAction(poId: number): Promise<ActionResult> {
  const session = await requireSession();
  const [po] = await db.select().from(purchaseOrdersTable).where(and(eq(purchaseOrdersTable.id, poId), eq(purchaseOrdersTable.orgId, session.orgId)));
  if (!po) return { error: "Purchase order not found." };
  if (po.status !== "draft") return { error: "Only draft purchase orders can be sent." };

  await db.update(purchaseOrdersTable).set({ status: "ordered", updatedAt: new Date() }).where(eq(purchaseOrdersTable.id, poId));
  await logActivity(session, { type: "purchase_order.sent", description: `Sent purchase order ${po.poNumber} to vendor`, entityType: "purchase_order", entityId: poId });
  revalidatePath(PATH);
  revalidatePath(`/purchasing/orders/${poId}`);
  return {};
}

export async function cancelPurchaseOrderAction(poId: number): Promise<ActionResult> {
  const session = await requireSession();
  const [po] = await db.select().from(purchaseOrdersTable).where(and(eq(purchaseOrdersTable.id, poId), eq(purchaseOrdersTable.orgId, session.orgId)));
  if (!po) return { error: "Purchase order not found." };
  if (po.status !== "draft" && po.status !== "ordered") return { error: "Only draft or ordered purchase orders can be cancelled." };

  await db.update(purchaseOrdersTable).set({ status: "cancelled", updatedAt: new Date() }).where(eq(purchaseOrdersTable.id, poId));
  await logActivity(session, { type: "purchase_order.cancelled", description: `Cancelled purchase order ${po.poNumber}`, entityType: "purchase_order", entityId: poId });
  revalidatePath(PATH);
  revalidatePath(`/purchasing/orders/${poId}`);
  return {};
}

// Mirrors sendInvoiceAction's structure exactly, inverted: receiving stock increments
// productsTable.quantityOnHand and posts Dr Inventory / Cr Accounts Payable in one
// transaction, so a failure partway through never leaves stock and books out of sync.
export async function receivePurchaseOrderAction(poId: number): Promise<ActionResult> {
  const session = await requireSession();

  const [po] = await db.select().from(purchaseOrdersTable).where(and(eq(purchaseOrdersTable.id, poId), eq(purchaseOrdersTable.orgId, session.orgId)));
  if (!po) return { error: "Purchase order not found." };
  if (po.status !== "ordered") return { error: "Only ordered purchase orders can be received." };

  const items = await db.select().from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.purchaseOrderId, poId));

  const accounts = await db.select().from(accountsTable).where(eq(accountsTable.orgId, session.orgId));
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const inventory = byCode.get("1200");
  const accountsPayable = byCode.get("2000");
  if (!inventory || !accountsPayable) {
    return { error: "Chart of accounts is missing a required system account (1200/2000)." };
  }

  await db.transaction(async (tx) => {
    for (const item of items) {
      if (item.productId) {
        await tx
          .update(productsTable)
          .set({ quantityOnHand: sql`${productsTable.quantityOnHand} + ${Math.trunc(Number(item.quantity))}` })
          .where(and(eq(productsTable.id, item.productId), eq(productsTable.orgId, session.orgId)));
      }
    }

    const [entry] = await tx
      .insert(journalEntriesTable)
      .values({
        orgId: session.orgId,
        entryDate: po.orderDate,
        memo: `Purchase order ${po.poNumber} received`,
        sourceType: "purchase_order",
        sourceId: po.id,
        createdById: session.userId,
      })
      .returning({ id: journalEntriesTable.id });

    await tx.insert(journalLinesTable).values([
      { journalEntryId: entry.id, accountId: inventory.id, debit: po.total, credit: "0" },
      { journalEntryId: entry.id, accountId: accountsPayable.id, debit: "0", credit: po.total },
    ]);

    await tx.update(purchaseOrdersTable).set({ status: "received", updatedAt: new Date() }).where(eq(purchaseOrdersTable.id, poId));
  });

  await logActivity(session, {
    type: "purchase_order.received",
    description: `Received purchase order ${po.poNumber} — posted to ledger and stock updated`,
    entityType: "purchase_order",
    entityId: poId,
  });
  revalidatePath(PATH);
  revalidatePath(`/purchasing/orders/${poId}`);
  revalidatePath("/finance/chart-of-accounts");
  revalidatePath("/finance/ledger");
  revalidatePath("/finance/reports");
  revalidatePath("/inventory/products");
  revalidatePath("/dashboard");
  return {};
}
