"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, proformaInvoicesTable, proformaInvoiceItemsTable, salesInvoicesTable, salesInvoiceItemsTable, deliveryChallansTable, deliveryChallanItemsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { nextDocumentNumber } from "@/lib/documents";
import { computeTotals, type LineItemInput } from "../_shared/totals";

export type ActionResult = { error?: string; id?: number };

const PATH = "/sales/proforma";
const VALID_STATUSES = ["draft", "sent"];

type LineInput = { productId: string; description: string; quantity: string; unitPrice: string; taxRatePercent: string };

export async function createProformaAction(
  input: {
    title: string;
    customerId: string;
    issueDate: string;
    discount: string;
    notes: string;
    items: LineInput[];
  },
  andSend = false,
): Promise<ActionResult> {
  const session = await requireSession();
  const customerId = Number(input.customerId);
  if (!customerId) return { error: "Choose a client." };
  if (!input.issueDate) return { error: "Issue date is required." };

  const items = input.items.filter((l) => l.description.trim() && Number(l.quantity) > 0);
  if (items.length === 0) return { error: "Add at least one line item." };

  const totals = computeTotals(items as LineItemInput[], input.discount);

  const id = await db.transaction(async (tx) => {
    const proformaNumber = await nextDocumentNumber(tx, session.orgId, "proforma_invoice");
    const [pf] = await tx
      .insert(proformaInvoicesTable)
      .values({
        orgId: session.orgId,
        proformaNumber,
        title: input.title.trim() || null,
        customerId,
        issueDate: input.issueDate,
        notes: input.notes.trim() || null,
        subtotal: totals.subtotal,
        discount: totals.discount,
        taxTotal: totals.taxTotal,
        total: totals.total,
        createdById: session.userId,
      })
      .returning({ id: proformaInvoicesTable.id });

    await tx.insert(proformaInvoiceItemsTable).values(
      items.map((l) => ({
        proformaInvoiceId: pf.id,
        productId: l.productId ? Number(l.productId) : null,
        description: l.description.trim(),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxRatePercent: l.taxRatePercent,
        lineTotal: ((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)).toFixed(2),
      })),
    );
    return pf.id;
  });

  await logActivity(session, { type: "proforma_invoice.created", description: "Created a proforma invoice", entityType: "proforma_invoice", entityId: id });
  if (andSend) {
    await updateProformaStatusAction(id, "sent");
  }
  revalidatePath(PATH);
  redirect(`/sales/proforma/${id}`);
}

export async function updateProformaStatusAction(id: number, status: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!VALID_STATUSES.includes(status)) return { error: "Invalid status." };

  const result = await db
    .update(proformaInvoicesTable)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(proformaInvoicesTable.id, id), eq(proformaInvoicesTable.orgId, session.orgId)))
    .returning({ id: proformaInvoicesTable.id });
  if (!result.length) return { error: "Proforma invoice not found." };

  await logActivity(session, { type: "proforma_invoice.status_changed", description: `Marked proforma as ${status}`, entityType: "proforma_invoice", entityId: id });
  revalidatePath(PATH);
  revalidatePath(`/sales/proforma/${id}`);
  return {};
}

export async function convertProformaToInvoiceAction(proformaId: number): Promise<ActionResult> {
  const session = await requireSession();
  const [pf] = await db.select().from(proformaInvoicesTable).where(and(eq(proformaInvoicesTable.id, proformaId), eq(proformaInvoicesTable.orgId, session.orgId)));
  if (!pf) return { error: "Proforma invoice not found." };
  const items = await db.select().from(proformaInvoiceItemsTable).where(eq(proformaInvoiceItemsTable.proformaInvoiceId, proformaId));

  const id = await db.transaction(async (tx) => {
    const invoiceNumber = await nextDocumentNumber(tx, session.orgId, "sales_invoice");
    const [inv] = await tx
      .insert(salesInvoicesTable)
      .values({
        orgId: session.orgId,
        invoiceNumber,
        title: pf.title,
        customerId: pf.customerId,
        sourceSalesOrderId: pf.sourceSalesOrderId,
        issueDate: new Date().toISOString().slice(0, 10),
        subtotal: pf.subtotal,
        discount: pf.discount,
        taxTotal: pf.taxTotal,
        total: pf.total,
        notes: pf.notes,
        createdById: session.userId,
      })
      .returning({ id: salesInvoicesTable.id });

    await tx.insert(salesInvoiceItemsTable).values(
      items.map((it) => ({
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

  await logActivity(session, { type: "sales_invoice.created", description: `Converted from proforma ${pf.proformaNumber}`, entityType: "sales_invoice", entityId: id });
  revalidatePath("/sales/invoices");
  redirect(`/sales/invoices/${id}`);
}

export async function convertProformaToDeliveryChallanAction(proformaId: number): Promise<ActionResult> {
  const session = await requireSession();
  const [pf] = await db.select().from(proformaInvoicesTable).where(and(eq(proformaInvoicesTable.id, proformaId), eq(proformaInvoicesTable.orgId, session.orgId)));
  if (!pf) return { error: "Proforma invoice not found." };
  const items = await db.select().from(proformaInvoiceItemsTable).where(eq(proformaInvoiceItemsTable.proformaInvoiceId, proformaId));

  const id = await db.transaction(async (tx) => {
    const dcNumber = await nextDocumentNumber(tx, session.orgId, "delivery_challan");
    const [dc] = await tx
      .insert(deliveryChallansTable)
      .values({
        orgId: session.orgId,
        dcNumber,
        title: pf.title,
        customerId: pf.customerId,
        sourceProformaId: pf.id,
        createdById: session.userId,
      })
      .returning({ id: deliveryChallansTable.id });

    await tx.insert(deliveryChallanItemsTable).values(
      items.map((it) => ({
        deliveryChallanId: dc.id,
        productId: it.productId,
        description: it.description,
        quantity: it.quantity,
      })),
    );
    return dc.id;
  });

  await logActivity(session, { type: "delivery_challan.created", description: `Converted from proforma ${pf.proformaNumber}`, entityType: "delivery_challan", entityId: id });
  revalidatePath("/sales/delivery-challans");
  redirect(`/sales/delivery-challans/${id}`);
}
