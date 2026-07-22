"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, projectsTable, salesOrdersTable, salesOrderItemsTable, proformaInvoicesTable, proformaInvoiceItemsTable, salesInvoicesTable, salesInvoiceItemsTable, deliveryChallansTable, deliveryChallanItemsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { nextDocumentNumber } from "@/lib/documents";
import { can, evaluate } from "@/lib/document-lifecycle";
import { computeTotals, type LineItemInput } from "../_shared/totals";

export type ActionResult = { error?: string; id?: number };

const PATH = "/sales/orders";
const VALID_STATUSES = ["draft", "confirmed", "fulfilled", "cancelled"];

type LineInput = { productId: string; description: string; quantity: string; unitPrice: string; taxRatePercent: string };

export async function createSalesOrderAction(
  input: {
    title: string;
    customerId: string;
    projectId?: string;
    issueDate: string;
    expectedDate: string;
    discount: string;
    notes: string;
    items: LineInput[];
  },
  andConfirm = false,
): Promise<ActionResult> {
  const session = await requireSession();
  const customerId = Number(input.customerId);
  if (!customerId) return { error: "Choose a client." };

  let projectId: number | null = null;
  if (input.projectId) {
    const [project] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, Number(input.projectId)), eq(projectsTable.orgId, session.orgId)));
    if (!project) return { error: "Project not found." };
    projectId = project.id;
  }
  if (!input.issueDate) return { error: "Issue date is required." };

  const items = input.items.filter((l) => l.description.trim() && Number(l.quantity) > 0);
  if (items.length === 0) return { error: "Add at least one line item." };

  const totals = computeTotals(items as LineItemInput[], input.discount);

  const id = await db.transaction(async (tx) => {
    const soNumber = await nextDocumentNumber(tx, session.orgId, "sales_order");
    const [so] = await tx
      .insert(salesOrdersTable)
      .values({
        orgId: session.orgId,
        soNumber,
        title: input.title.trim() || null,
        customerId,
        projectId,
        issueDate: input.issueDate,
        expectedDate: input.expectedDate || null,
        notes: input.notes.trim() || null,
        subtotal: totals.subtotal,
        discount: totals.discount,
        taxTotal: totals.taxTotal,
        total: totals.total,
        createdById: session.userId,
      })
      .returning({ id: salesOrdersTable.id });

    await tx.insert(salesOrderItemsTable).values(
      items.map((l) => ({
        salesOrderId: so.id,
        productId: l.productId ? Number(l.productId) : null,
        description: l.description.trim(),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxRatePercent: l.taxRatePercent,
        lineTotal: ((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)).toFixed(2),
      })),
    );
    return so.id;
  });

  await logActivity(session, { type: "sales_order.created", description: "Created a sales order", entityType: "sales_order", entityId: id });
  if (andConfirm) {
    await updateSalesOrderStatusAction(id, "confirmed");
  }
  revalidatePath(PATH);
  redirect(`/sales/orders/${id}`);
}

// Batch A2 — draft-only edit. Preserves number/org/status/source links; recomputes totals server-side.
export async function updateSalesOrderAction(
  id: number,
  input: { title: string; customerId: string; projectId?: string; issueDate: string; expectedDate: string; discount: string; notes: string; items: LineInput[] },
): Promise<ActionResult> {
  const session = await requireSession();
  const [existing] = await db.select().from(salesOrdersTable).where(and(eq(salesOrdersTable.id, id), eq(salesOrdersTable.orgId, session.orgId)));
  if (!existing) return { error: "Sales order not found." };
  if (!can("sales_order", existing.status, "edit")) return { error: "Only draft sales orders can be edited." };

  const customerId = Number(input.customerId);
  if (!customerId) return { error: "Choose a client." };
  let projectId: number | null = null;
  if (input.projectId) {
    const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(and(eq(projectsTable.id, Number(input.projectId)), eq(projectsTable.orgId, session.orgId)));
    if (!project) return { error: "Project not found." };
    projectId = project.id;
  }
  if (!input.issueDate) return { error: "Order date is required." };
  const items = input.items.filter((l) => l.description.trim() && Number(l.quantity) > 0);
  if (items.length === 0) return { error: "Add at least one line item." };
  const totals = computeTotals(items as LineItemInput[], input.discount);

  await db.transaction(async (tx) => {
    await tx
      .update(salesOrdersTable)
      .set({
        title: input.title.trim() || null,
        customerId,
        projectId,
        issueDate: input.issueDate,
        expectedDate: input.expectedDate || null,
        notes: input.notes.trim() || null,
        subtotal: totals.subtotal,
        discount: totals.discount,
        taxTotal: totals.taxTotal,
        total: totals.total,
        updatedAt: new Date(),
      })
      .where(and(eq(salesOrdersTable.id, id), eq(salesOrdersTable.orgId, session.orgId)));
    await tx.delete(salesOrderItemsTable).where(eq(salesOrderItemsTable.salesOrderId, id));
    await tx.insert(salesOrderItemsTable).values(
      items.map((l) => ({
        salesOrderId: id,
        productId: l.productId ? Number(l.productId) : null,
        description: l.description.trim(),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxRatePercent: l.taxRatePercent,
        lineTotal: ((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)).toFixed(2),
      })),
    );
  });

  await logActivity(session, { type: "sales_order.updated", description: `Edited draft sales order ${existing.soNumber}`, entityType: "sales_order", entityId: id });
  revalidatePath(PATH);
  revalidatePath(`/sales/orders/${id}`);
  redirect(`/sales/orders/${id}`);
}

// Batch A4 — cancel a non-posted sales order. Sales orders never post to the ledger or
// stock, so cancelling is a pure status transition (no accounting/inventory to reverse).
// The lifecycle rule refuses cancel on a fulfilled/cancelled SO, so re-cancellation and
// cancelling a fulfilled order are both blocked.
export async function cancelSalesOrderAction(id: number): Promise<ActionResult> {
  const session = await requireSession();
  const [so] = await db.select().from(salesOrdersTable).where(and(eq(salesOrdersTable.id, id), eq(salesOrdersTable.orgId, session.orgId)));
  if (!so) return { error: "Sales order not found." };
  const decision = evaluate("sales_order", so.status, "cancel");
  if (!decision.allowed) return { error: decision.reason };

  await db.update(salesOrdersTable).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(salesOrdersTable.id, id), eq(salesOrdersTable.orgId, session.orgId)));
  await logActivity(session, { type: "sales_order.cancelled", description: `Cancelled sales order ${so.soNumber}`, entityType: "sales_order", entityId: id });
  revalidatePath(PATH);
  revalidatePath(`/sales/orders/${id}`);
  return {};
}

export async function updateSalesOrderStatusAction(id: number, status: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!VALID_STATUSES.includes(status)) return { error: "Invalid status." };

  const result = await db
    .update(salesOrdersTable)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(salesOrdersTable.id, id), eq(salesOrdersTable.orgId, session.orgId)))
    .returning({ id: salesOrdersTable.id });
  if (!result.length) return { error: "Sales order not found." };

  await logActivity(session, { type: "sales_order.status_changed", description: `Marked sales order as ${status}`, entityType: "sales_order", entityId: id });
  revalidatePath(PATH);
  revalidatePath(`/sales/orders/${id}`);
  return {};
}

async function loadSoWithItems(orgId: number, id: number) {
  const [so] = await db.select().from(salesOrdersTable).where(and(eq(salesOrdersTable.id, id), eq(salesOrdersTable.orgId, orgId)));
  if (!so) return null;
  const items = await db.select().from(salesOrderItemsTable).where(eq(salesOrderItemsTable.salesOrderId, id));
  return { so, items };
}

export async function convertSoToProformaAction(soId: number): Promise<ActionResult> {
  const session = await requireSession();
  const data = await loadSoWithItems(session.orgId, soId);
  if (!data) return { error: "Sales order not found." };

  const id = await db.transaction(async (tx) => {
    const proformaNumber = await nextDocumentNumber(tx, session.orgId, "proforma_invoice");
    const [pf] = await tx
      .insert(proformaInvoicesTable)
      .values({
        orgId: session.orgId,
        proformaNumber,
        title: data.so.title,
        customerId: data.so.customerId,
        sourceSalesOrderId: data.so.id,
        issueDate: new Date().toISOString().slice(0, 10),
        subtotal: data.so.subtotal,
        discount: data.so.discount,
        taxTotal: data.so.taxTotal,
        total: data.so.total,
        notes: data.so.notes,
        createdById: session.userId,
      })
      .returning({ id: proformaInvoicesTable.id });

    await tx.insert(proformaInvoiceItemsTable).values(
      data.items.map((it) => ({
        proformaInvoiceId: pf.id,
        productId: it.productId,
        description: it.description,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        taxRatePercent: it.taxRatePercent,
        lineTotal: it.lineTotal,
      })),
    );
    return pf.id;
  });

  await logActivity(session, { type: "proforma_invoice.created", description: `Converted from sales order ${data.so.soNumber}`, entityType: "proforma_invoice", entityId: id });
  revalidatePath("/sales/proforma");
  redirect(`/sales/proforma/${id}`);
}

export async function convertSoToInvoiceAction(soId: number): Promise<ActionResult> {
  const session = await requireSession();
  const data = await loadSoWithItems(session.orgId, soId);
  if (!data) return { error: "Sales order not found." };

  const id = await db.transaction(async (tx) => {
    const invoiceNumber = await nextDocumentNumber(tx, session.orgId, "sales_invoice");
    const [inv] = await tx
      .insert(salesInvoicesTable)
      .values({
        orgId: session.orgId,
        invoiceNumber,
        title: data.so.title,
        customerId: data.so.customerId,
        sourceSalesOrderId: data.so.id,
        issueDate: new Date().toISOString().slice(0, 10),
        subtotal: data.so.subtotal,
        discount: data.so.discount,
        taxTotal: data.so.taxTotal,
        total: data.so.total,
        notes: data.so.notes,
        createdById: session.userId,
      })
      .returning({ id: salesInvoicesTable.id });

    await tx.insert(salesInvoiceItemsTable).values(
      data.items.map((it) => ({
        invoiceId: inv.id,
        productId: it.productId,
        description: it.description,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        taxRatePercent: it.taxRatePercent,
        lineTotal: it.lineTotal,
      })),
    );
    return inv.id;
  });

  await logActivity(session, { type: "sales_invoice.created", description: `Converted from sales order ${data.so.soNumber}`, entityType: "sales_invoice", entityId: id });
  revalidatePath("/sales/invoices");
  redirect(`/sales/invoices/${id}`);
}

export async function convertSoToDeliveryChallanAction(soId: number): Promise<ActionResult> {
  const session = await requireSession();
  const data = await loadSoWithItems(session.orgId, soId);
  if (!data) return { error: "Sales order not found." };

  const id = await db.transaction(async (tx) => {
    const dcNumber = await nextDocumentNumber(tx, session.orgId, "delivery_challan");
    const [dc] = await tx
      .insert(deliveryChallansTable)
      .values({
        orgId: session.orgId,
        dcNumber,
        title: data.so.title,
        customerId: data.so.customerId,
        sourceSalesOrderId: data.so.id,
        createdById: session.userId,
      })
      .returning({ id: deliveryChallansTable.id });

    await tx.insert(deliveryChallanItemsTable).values(
      data.items.map((it) => ({
        deliveryChallanId: dc.id,
        productId: it.productId,
        description: it.description,
        quantity: it.quantity,
      })),
    );
    return dc.id;
  });

  await logActivity(session, { type: "delivery_challan.created", description: `Converted from sales order ${data.so.soNumber}`, entityType: "delivery_challan", entityId: id });
  revalidatePath("/sales/delivery-challans");
  redirect(`/sales/delivery-challans/${id}`);
}
