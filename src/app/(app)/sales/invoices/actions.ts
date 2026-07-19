"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db, projectsTable, salesInvoicesTable, salesInvoiceItemsTable, productsTable, accountsTable, journalEntriesTable, journalLinesTable, deliveryChallansTable, deliveryChallanItemsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { nextDocumentNumber } from "@/lib/documents";
import { computeTotals, type LineItemInput } from "../_shared/totals";

export type ActionResult = { error?: string; id?: number };

const PATH = "/sales/invoices";

type LineInput = { productId: string; description: string; quantity: string; unitPrice: string; taxRatePercent: string };

export async function createInvoiceAction(
  input: {
    title: string;
    customerId: string;
    projectId?: string;
    issueDate: string;
    dueDate: string;
    discount: string;
    notes: string;
    items: LineInput[];
  },
  andSend = false,
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
    const invoiceNumber = await nextDocumentNumber(tx, session.orgId, "sales_invoice");
    const [inv] = await tx
      .insert(salesInvoicesTable)
      .values({
        orgId: session.orgId,
        invoiceNumber,
        title: input.title.trim() || null,
        customerId,
        projectId,
        issueDate: input.issueDate,
        dueDate: input.dueDate || null,
        notes: input.notes.trim() || null,
        subtotal: totals.subtotal,
        discount: totals.discount,
        taxTotal: totals.taxTotal,
        total: totals.total,
        createdById: session.userId,
      })
      .returning({ id: salesInvoicesTable.id });

    await tx.insert(salesInvoiceItemsTable).values(
      items.map((l) => ({
        invoiceId: inv.id,
        productId: l.productId ? Number(l.productId) : null,
        description: l.description.trim(),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxRatePercent: l.taxRatePercent,
        lineTotal: ((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)).toFixed(2),
      })),
    );
    return inv.id;
  });

  await logActivity(session, { type: "sales_invoice.created", description: "Created an invoice", entityType: "sales_invoice", entityId: id });
  if (andSend) {
    await sendInvoiceAction(id);
  }
  revalidatePath(PATH);
  redirect(`/sales/invoices/${id}`);
}

// The single most important correctness path in the sales chain: sending an invoice is the one
// moment stock decrements and revenue/AR/VAT post to the ledger — everything happens in one
// transaction so a failure partway through never leaves stock and books out of sync.
export async function sendInvoiceAction(invoiceId: number): Promise<ActionResult> {
  const session = await requireSession();

  const [invoice] = await db
    .select()
    .from(salesInvoicesTable)
    .where(and(eq(salesInvoicesTable.id, invoiceId), eq(salesInvoicesTable.orgId, session.orgId)));
  if (!invoice) return { error: "Invoice not found." };
  if (invoice.status !== "draft") return { error: "Only draft invoices can be sent." };

  const items = await db.select().from(salesInvoiceItemsTable).where(eq(salesInvoiceItemsTable.invoiceId, invoiceId));

  const accounts = await db.select().from(accountsTable).where(eq(accountsTable.orgId, session.orgId));
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const ar = byCode.get("1100");
  const revenue = byCode.get("4000");
  const vatPayable = byCode.get("2100");
  if (!ar || !revenue || !vatPayable) {
    return { error: "Chart of accounts is missing a required system account (1100/4000/2100)." };
  }

  await db.transaction(async (tx) => {
    for (const item of items) {
      if (item.productId) {
        await tx
          .update(productsTable)
          .set({ quantityOnHand: sql`${productsTable.quantityOnHand} - ${Math.trunc(Number(item.quantity))}` })
          .where(and(eq(productsTable.id, item.productId), eq(productsTable.orgId, session.orgId)));
      }
    }

    const [entry] = await tx
      .insert(journalEntriesTable)
      .values({
        orgId: session.orgId,
        entryDate: invoice.issueDate,
        memo: `Invoice ${invoice.invoiceNumber} sent`,
        sourceType: "sales_invoice",
        sourceId: invoice.id,
        createdById: session.userId,
      })
      .returning({ id: journalEntriesTable.id });

    const lines: { accountId: number; debit: string; credit: string }[] = [
      { accountId: ar.id, debit: invoice.total, credit: "0" },
      { accountId: revenue.id, debit: "0", credit: invoice.subtotal },
    ];
    if (Number(invoice.taxTotal) > 0) {
      lines.push({ accountId: vatPayable.id, debit: "0", credit: invoice.taxTotal });
    }
    await tx.insert(journalLinesTable).values(lines.map((l) => ({ journalEntryId: entry.id, ...l })));

    await tx.update(salesInvoicesTable).set({ status: "sent", updatedAt: new Date() }).where(eq(salesInvoicesTable.id, invoiceId));
  });

  await logActivity(session, { type: "sales_invoice.sent", description: `Sent invoice ${invoice.invoiceNumber} — posted to ledger and decremented stock`, entityType: "sales_invoice", entityId: invoiceId });
  revalidatePath(PATH);
  revalidatePath(`/sales/invoices/${invoiceId}`);
  revalidatePath("/finance/chart-of-accounts");
  revalidatePath("/finance/ledger");
  revalidatePath("/finance/reports");
  revalidatePath("/inventory/products");
  return {};
}

export async function convertInvoiceToDeliveryChallanAction(invoiceId: number): Promise<ActionResult> {
  const session = await requireSession();
  const [invoice] = await db.select().from(salesInvoicesTable).where(and(eq(salesInvoicesTable.id, invoiceId), eq(salesInvoicesTable.orgId, session.orgId)));
  if (!invoice) return { error: "Invoice not found." };
  const items = await db.select().from(salesInvoiceItemsTable).where(eq(salesInvoiceItemsTable.invoiceId, invoiceId));

  const id = await db.transaction(async (tx) => {
    const dcNumber = await nextDocumentNumber(tx, session.orgId, "delivery_challan");
    const [dc] = await tx
      .insert(deliveryChallansTable)
      .values({
        orgId: session.orgId,
        dcNumber,
        title: invoice.title,
        customerId: invoice.customerId,
        sourceInvoiceId: invoice.id,
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

  await logActivity(session, { type: "delivery_challan.created", description: `Converted from invoice ${invoice.invoiceNumber}`, entityType: "delivery_challan", entityId: id });
  revalidatePath("/sales/delivery-challans");
  redirect(`/sales/delivery-challans/${id}`);
}

export async function voidInvoiceAction(invoiceId: number): Promise<ActionResult> {
  const session = await requireSession();
  const [invoice] = await db.select().from(salesInvoicesTable).where(and(eq(salesInvoicesTable.id, invoiceId), eq(salesInvoicesTable.orgId, session.orgId)));
  if (!invoice) return { error: "Invoice not found." };
  if (invoice.status !== "draft") return { error: "Only draft invoices can be voided — sent invoices need a Credit Note instead." };

  await db.update(salesInvoicesTable).set({ status: "void", updatedAt: new Date() }).where(eq(salesInvoicesTable.id, invoiceId));
  await logActivity(session, { type: "sales_invoice.voided", description: `Voided invoice ${invoice.invoiceNumber}`, entityType: "sales_invoice", entityId: invoiceId });
  revalidatePath(PATH);
  revalidatePath(`/sales/invoices/${invoiceId}`);
  return {};
}
