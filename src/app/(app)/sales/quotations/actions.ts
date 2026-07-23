"use server";

import { revalidatePath } from "next/cache";
import { sanitizeIfHtml } from "@/lib/sanitize-html";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, customersTable, projectsTable, quotationsTable, quotationItemsTable, salesOrdersTable, salesOrderItemsTable, proformaInvoicesTable, proformaInvoiceItemsTable, salesInvoicesTable, salesInvoiceItemsTable, deliveryChallansTable, deliveryChallanItemsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { nextDocumentNumber } from "@/lib/documents";
import { can } from "@/lib/document-lifecycle";
import { computeTotals, type LineItemInput } from "../_shared/totals";
import { persistDocumentAttachments, type AttachmentInput } from "../_shared/attachment-persist";

export type ActionResult = { error?: string; id?: number };

const PATH = "/sales/quotations";
const VALID_STATUSES = ["draft", "sent", "accepted", "rejected", "expired"];

type LineInput = { productId: string; description: string; quantity: string; unitPrice: string; taxRatePercent: string; imageUrl?: string; unit?: string; customFields?: Record<string, string> };

export async function createQuotationAction(
  input: {
    title: string;
    customerId: string;
    projectId?: string;
    issueDate: string;
    validUntil: string;
    discount: string;
    notes: string;
    items: LineInput[];
    attachments?: AttachmentInput[];
  },
  andSend = false,
): Promise<ActionResult> {
  const session = await requireSession();
  const customerId = Number(input.customerId);
  if (!customerId) return { error: "Choose a client." };
  const [customerOwned] = await db.select({ id: customersTable.id }).from(customersTable).where(and(eq(customersTable.id, customerId), eq(customersTable.orgId, session.orgId)));
  if (!customerOwned) return { error: "Client not found." };

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
    const quotationNumber = await nextDocumentNumber(tx, session.orgId, "quotation");
    const [quotation] = await tx
      .insert(quotationsTable)
      .values({
        orgId: session.orgId,
        quotationNumber,
        title: input.title.trim() || null,
        customerId,
        projectId,
        issueDate: input.issueDate,
        validUntil: input.validUntil || null,
        notes: sanitizeIfHtml(input.notes) || null,
        subtotal: totals.subtotal,
        discount: totals.discount,
        taxTotal: totals.taxTotal,
        total: totals.total,
        createdById: session.userId,
      })
      .returning({ id: quotationsTable.id });

    await tx.insert(quotationItemsTable).values(
      items.map((l) => ({
        quotationId: quotation.id,
        productId: l.productId ? Number(l.productId) : null,
        imageUrl: l.imageUrl || null,
        unit: l.unit || null,
        customFields: l.customFields ?? {},
        description: sanitizeIfHtml(l.description),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxRatePercent: l.taxRatePercent,
        lineTotal: ((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)).toFixed(2),
      })),
    );

    await persistDocumentAttachments(tx, session.orgId, session.userId, "quotation", quotation.id, input.attachments);

    return quotation.id;
  });

  await logActivity(session, { type: "quotation.created", description: "Created a quotation", entityType: "quotation", entityId: id });
  if (andSend) {
    await updateQuotationStatusAction(id, "sent");
  }
  revalidatePath(PATH);
  redirect(`/sales/quotations/${id}`);
}

// Batch A2 — draft-only edit. Preserves number/org/status/source links; recomputes totals server-side.
export async function updateQuotationAction(
  id: number,
  input: {
    title: string;
    customerId: string;
    projectId?: string;
    issueDate: string;
    validUntil: string;
    discount: string;
    notes: string;
    items: LineInput[];
    attachments?: AttachmentInput[];
  },
): Promise<ActionResult> {
  const session = await requireSession();
  const [existing] = await db.select().from(quotationsTable).where(and(eq(quotationsTable.id, id), eq(quotationsTable.orgId, session.orgId)));
  if (!existing) return { error: "Quotation not found." };
  // Server-side lifecycle guard: only drafts may be edited (rejects direct-route access to a non-draft).
  if (!can("quotation", existing.status, "edit")) return { error: "Only draft quotations can be edited." };

  const customerId = Number(input.customerId);
  if (!customerId) return { error: "Choose a client." };
  const [customerOwned] = await db.select({ id: customersTable.id }).from(customersTable).where(and(eq(customersTable.id, customerId), eq(customersTable.orgId, session.orgId)));
  if (!customerOwned) return { error: "Client not found." };

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

  await db.transaction(async (tx) => {
    // Update only editable header fields; quotationNumber, orgId, status, createdById, source links are preserved.
    await tx
      .update(quotationsTable)
      .set({
        title: input.title.trim() || null,
        customerId,
        projectId,
        issueDate: input.issueDate,
        validUntil: input.validUntil || null,
        notes: sanitizeIfHtml(input.notes) || null,
        subtotal: totals.subtotal,
        discount: totals.discount,
        taxTotal: totals.taxTotal,
        total: totals.total,
        updatedAt: new Date(),
      })
      .where(and(eq(quotationsTable.id, id), eq(quotationsTable.orgId, session.orgId)));

    await tx.delete(quotationItemsTable).where(eq(quotationItemsTable.quotationId, id));
    await tx.insert(quotationItemsTable).values(
      items.map((l) => ({
        quotationId: id,
        productId: l.productId ? Number(l.productId) : null,
        imageUrl: l.imageUrl || null,
        unit: l.unit || null,
        customFields: l.customFields ?? {},
        description: sanitizeIfHtml(l.description),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxRatePercent: l.taxRatePercent,
        lineTotal: ((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)).toFixed(2),
      })),
    );

    await persistDocumentAttachments(tx, session.orgId, session.userId, "quotation", id, input.attachments);
  });

  await logActivity(session, { type: "quotation.updated", description: `Edited draft quotation ${existing.quotationNumber}`, entityType: "quotation", entityId: id });
  revalidatePath(PATH);
  revalidatePath(`/sales/quotations/${id}`);
  redirect(`/sales/quotations/${id}`);
}

export async function updateQuotationStatusAction(id: number, status: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!VALID_STATUSES.includes(status)) return { error: "Invalid status." };

  const result = await db
    .update(quotationsTable)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(quotationsTable.id, id), eq(quotationsTable.orgId, session.orgId)))
    .returning({ id: quotationsTable.id });
  if (!result.length) return { error: "Quotation not found." };

  await logActivity(session, { type: "quotation.status_changed", description: `Marked quotation as ${status}`, entityType: "quotation", entityId: id });
  revalidatePath(PATH);
  revalidatePath(`/sales/quotations/${id}`);
  return {};
}

async function loadQuotationWithItems(orgId: number, id: number) {
  const [quotation] = await db.select().from(quotationsTable).where(and(eq(quotationsTable.id, id), eq(quotationsTable.orgId, orgId)));
  if (!quotation) return null;
  const items = await db.select().from(quotationItemsTable).where(eq(quotationItemsTable.quotationId, id));
  return { quotation, items };
}

export async function convertToSalesOrderAction(quotationId: number): Promise<ActionResult> {
  const session = await requireSession();
  const data = await loadQuotationWithItems(session.orgId, quotationId);
  if (!data) return { error: "Quotation not found." };

  const id = await db.transaction(async (tx) => {
    const soNumber = await nextDocumentNumber(tx, session.orgId, "sales_order");
    const [so] = await tx
      .insert(salesOrdersTable)
      .values({
        orgId: session.orgId,
        soNumber,
        title: data.quotation.title,
        customerId: data.quotation.customerId,
        sourceQuotationId: data.quotation.id,
        issueDate: new Date().toISOString().slice(0, 10),
        subtotal: data.quotation.subtotal,
        discount: data.quotation.discount,
        taxTotal: data.quotation.taxTotal,
        total: data.quotation.total,
        notes: data.quotation.notes,
        createdById: session.userId,
      })
      .returning({ id: salesOrdersTable.id });

    await tx.insert(salesOrderItemsTable).values(
      data.items.map((it) => ({
        salesOrderId: so.id,
        productId: it.productId,
        imageUrl: it.imageUrl,
        unit: it.unit,
        description: it.description,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        taxRatePercent: it.taxRatePercent,
        lineTotal: it.lineTotal,
      })),
    );
    return so.id;
  });

  await logActivity(session, { type: "sales_order.created", description: `Converted from quotation ${data.quotation.quotationNumber}`, entityType: "sales_order", entityId: id });
  revalidatePath("/sales/orders");
  redirect(`/sales/orders/${id}`);
}

export async function convertToProformaAction(quotationId: number): Promise<ActionResult> {
  const session = await requireSession();
  const data = await loadQuotationWithItems(session.orgId, quotationId);
  if (!data) return { error: "Quotation not found." };

  const id = await db.transaction(async (tx) => {
    const proformaNumber = await nextDocumentNumber(tx, session.orgId, "proforma_invoice");
    const [pf] = await tx
      .insert(proformaInvoicesTable)
      .values({
        orgId: session.orgId,
        proformaNumber,
        title: data.quotation.title,
        customerId: data.quotation.customerId,
        issueDate: new Date().toISOString().slice(0, 10),
        subtotal: data.quotation.subtotal,
        discount: data.quotation.discount,
        taxTotal: data.quotation.taxTotal,
        total: data.quotation.total,
        notes: data.quotation.notes,
        createdById: session.userId,
      })
      .returning({ id: proformaInvoicesTable.id });

    await tx.insert(proformaInvoiceItemsTable).values(
      data.items.map((it) => ({
        proformaInvoiceId: pf.id,
        productId: it.productId,
        imageUrl: it.imageUrl,
        unit: it.unit,
        description: it.description,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        taxRatePercent: it.taxRatePercent,
        lineTotal: it.lineTotal,
      })),
    );
    return pf.id;
  });

  await logActivity(session, { type: "proforma_invoice.created", description: `Converted from quotation ${data.quotation.quotationNumber}`, entityType: "proforma_invoice", entityId: id });
  revalidatePath("/sales/proforma");
  redirect(`/sales/proforma/${id}`);
}

export async function convertToInvoiceAction(quotationId: number): Promise<ActionResult> {
  const session = await requireSession();
  const data = await loadQuotationWithItems(session.orgId, quotationId);
  if (!data) return { error: "Quotation not found." };

  const id = await db.transaction(async (tx) => {
    const invoiceNumber = await nextDocumentNumber(tx, session.orgId, "sales_invoice");
    const [inv] = await tx
      .insert(salesInvoicesTable)
      .values({
        orgId: session.orgId,
        invoiceNumber,
        title: data.quotation.title,
        customerId: data.quotation.customerId,
        issueDate: new Date().toISOString().slice(0, 10),
        subtotal: data.quotation.subtotal,
        discount: data.quotation.discount,
        taxTotal: data.quotation.taxTotal,
        total: data.quotation.total,
        notes: data.quotation.notes,
        createdById: session.userId,
      })
      .returning({ id: salesInvoicesTable.id });

    await tx.insert(salesInvoiceItemsTable).values(
      data.items.map((it) => ({
        invoiceId: inv.id,
        productId: it.productId,
        imageUrl: it.imageUrl,
        unit: it.unit,
        description: it.description,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        taxRatePercent: it.taxRatePercent,
        lineTotal: it.lineTotal,
      })),
    );
    return inv.id;
  });

  await logActivity(session, { type: "sales_invoice.created", description: `Converted from quotation ${data.quotation.quotationNumber}`, entityType: "sales_invoice", entityId: id });
  revalidatePath("/sales/invoices");
  redirect(`/sales/invoices/${id}`);
}

export async function convertToDeliveryChallanAction(quotationId: number): Promise<ActionResult> {
  const session = await requireSession();
  const data = await loadQuotationWithItems(session.orgId, quotationId);
  if (!data) return { error: "Quotation not found." };

  const id = await db.transaction(async (tx) => {
    const dcNumber = await nextDocumentNumber(tx, session.orgId, "delivery_challan");
    const [dc] = await tx
      .insert(deliveryChallansTable)
      .values({
        orgId: session.orgId,
        dcNumber,
        title: data.quotation.title,
        customerId: data.quotation.customerId,
        sourceQuotationId: data.quotation.id,
        createdById: session.userId,
      })
      .returning({ id: deliveryChallansTable.id });

    await tx.insert(deliveryChallanItemsTable).values(
      data.items.map((it) => ({
        deliveryChallanId: dc.id,
        productId: it.productId,
        imageUrl: it.imageUrl,
        unit: it.unit,
        description: it.description,
        quantity: it.quantity,
      })),
    );
    return dc.id;
  });

  await logActivity(session, { type: "delivery_challan.created", description: `Converted from quotation ${data.quotation.quotationNumber}`, entityType: "delivery_challan", entityId: id });
  revalidatePath("/sales/delivery-challans");
  redirect(`/sales/delivery-challans/${id}`);
}
