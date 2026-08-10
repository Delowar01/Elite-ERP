"use server";

import { revalidatePath } from "next/cache";
import { sanitizeIfHtml } from "@/lib/sanitize-html";
import { normalizeDocumentTerms, type DocumentTerm } from "../../sales/_shared/document-terms";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db, vendorsTable, purchaseOrdersTable, purchaseOrderItemsTable, productsTable, accountsTable, journalEntriesTable, journalLinesTable, projectsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { nextDocumentNumber } from "@/lib/documents";
import { can, evaluate } from "@/lib/document-lifecycle";
import { snapshotDocumentBankAccounts } from "@/lib/document-bank-data";
import { snapshotSealForDoc, applySealOverride } from "@/lib/doc-seal";
import { normalizeDocCurrency, roundMoney } from "@/lib/currency/currencies";
import { captureBaseAmounts } from "@/lib/posting-currency";
import { computeTotals, type LineItemInput } from "../../sales/_shared/totals";
import { persistDocumentAttachments, type AttachmentInput } from "../../sales/_shared/attachment-persist";

export type ActionResult = {
  error?: string;
  id?: number;
  /** Set when a posting was blocked by a missing exchange rate — FX-3's rate-entry seam. */
  missingRate?: { currency: string; date: string };
};

const PATH = "/purchasing/orders";

type LineInput = { productId: string; description: string; quantity: string; unitPrice: string; taxRatePercent: string; imageUrl?: string; unit?: string; customFields?: Record<string, string> };

// Resolve the optional project tag, tenant-scoped. Returns null for "no project" and `undefined`
// when the id was supplied but does not belong to this org (the caller turns that into an error).
async function resolveProjectId(orgId: number, raw: string | undefined): Promise<number | null | undefined> {
  if (!raw) return null;
  const [project] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, Number(raw)), eq(projectsTable.orgId, orgId)));
  return project ? project.id : undefined;
}

export async function createPurchaseOrderAction(
  input: {
    title: string;
    vendorId: string;
    projectId?: string;
    orderDate: string;
    expectedDate: string;
    discount: string;
    notes: string; terms?: DocumentTerm[];
    items: LineInput[];
    attachments?: AttachmentInput[];
    sourceQuotationId?: string;
    sourceSalesOrderId?: string;
    sourceProformaId?: string;
    sourceInvoiceId?: string;
    bankAccountIds?: number[];
    currency?: string;
    sealUrl?: string;
    signatureUrl?: string;
  },
  andSend = false,
): Promise<ActionResult> {
  const session = await requireSession();
  const vendorId = Number(input.vendorId);
  if (!vendorId) return { error: "Choose a vendor." };
  const [vendorOwned] = await db.select({ id: vendorsTable.id }).from(vendorsTable).where(and(eq(vendorsTable.id, vendorId), eq(vendorsTable.orgId, session.orgId)));
  if (!vendorOwned) return { error: "Vendor not found." };
  if (!input.orderDate) return { error: "Order date is required." };
  const projectId = await resolveProjectId(session.orgId, input.projectId);
  if (projectId === undefined) return { error: "Project not found." };

  const items = input.items.filter((l) => l.description.trim() && Number(l.quantity) > 0);
  if (items.length === 0) return { error: "Add at least one line item." };

  const currency = normalizeDocCurrency(input.currency) ?? session.orgCurrency;
  const totals = computeTotals(items as LineItemInput[], input.discount, currency);
  const bankAccounts = await snapshotDocumentBankAccounts(session.orgId, input.bankAccountIds);
  const seal = applySealOverride(await snapshotSealForDoc(db, session.orgId, "purchase_order"), { sealUrl: input.sealUrl, signatureUrl: input.signatureUrl });

  const id = await db.transaction(async (tx) => {
    const poNumber = await nextDocumentNumber(tx, session.orgId, "purchase_order");
    const [po] = await tx
      .insert(purchaseOrdersTable)
      .values({
        orgId: session.orgId,
        poNumber,
        title: input.title.trim() || null,
        vendorId,
        projectId,
        sourceQuotationId: input.sourceQuotationId ? Number(input.sourceQuotationId) : null,
        sourceSalesOrderId: input.sourceSalesOrderId ? Number(input.sourceSalesOrderId) : null,
        sourceProformaId: input.sourceProformaId ? Number(input.sourceProformaId) : null,
        sourceInvoiceId: input.sourceInvoiceId ? Number(input.sourceInvoiceId) : null,
        orderDate: input.orderDate,
        expectedDate: input.expectedDate || null,
        bankAccounts,
        currency: normalizeDocCurrency(input.currency),
        notes: sanitizeIfHtml(input.notes) || null,
        terms: normalizeDocumentTerms(input.terms),
        subtotal: totals.subtotal,
        discount: totals.discount,
        taxTotal: totals.taxTotal,
        total: totals.total,
        sealUrl: seal.sealUrl,
        signatureUrl: seal.signatureUrl,
        createdById: session.userId,
      })
      .returning({ id: purchaseOrdersTable.id });

    await tx.insert(purchaseOrderItemsTable).values(
      items.map((l) => ({
        purchaseOrderId: po.id,
        productId: l.productId ? Number(l.productId) : null,
        imageUrl: l.imageUrl || null,
        unit: l.unit || null,
        customFields: l.customFields ?? {},
        description: sanitizeIfHtml(l.description),
        quantity: l.quantity,
        unitCost: l.unitPrice,
        taxRatePercent: l.taxRatePercent,
        lineTotal: roundMoney((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), currency),
      })),
    );
    await persistDocumentAttachments(tx, session.orgId, session.userId, "purchase_order", po.id, input.attachments);

    return po.id;
  });

  await logActivity(session, { type: "purchase_order.created", description: "Created a purchase order", entityType: "purchase_order", entityId: id });
  if (andSend) {
    await sendPurchaseOrderAction(id);
  }
  revalidatePath(PATH);
  redirect(`/purchasing/orders/${id}`);
}

// Batch A2 — draft-only edit. Preserves number/org/status/source links; recomputes totals server-side.
export async function updatePurchaseOrderAction(
  id: number,
  input: { title: string; vendorId: string; projectId?: string; orderDate: string; expectedDate: string; discount: string; notes: string; terms?: DocumentTerm[]; items: LineInput[]; attachments?: AttachmentInput[]; bankAccountIds?: number[]; currency?: string; sealUrl?: string; signatureUrl?: string },
): Promise<ActionResult> {
  const session = await requireSession();
  const [existing] = await db.select().from(purchaseOrdersTable).where(and(eq(purchaseOrdersTable.id, id), eq(purchaseOrdersTable.orgId, session.orgId)));
  if (!existing) return { error: "Purchase order not found." };
  if (!can("purchase_order", existing.status, "edit")) return { error: "Only draft purchase orders can be edited." };

  const vendorId = Number(input.vendorId);
  if (!vendorId) return { error: "Choose a vendor." };
  const [vendorOwned] = await db.select({ id: vendorsTable.id }).from(vendorsTable).where(and(eq(vendorsTable.id, vendorId), eq(vendorsTable.orgId, session.orgId)));
  if (!vendorOwned) return { error: "Vendor not found." };
  if (!input.orderDate) return { error: "Order date is required." };
  const projectId = await resolveProjectId(session.orgId, input.projectId);
  if (projectId === undefined) return { error: "Project not found." };
  const items = input.items.filter((l) => l.description.trim() && Number(l.quantity) > 0);
  if (items.length === 0) return { error: "Add at least one line item." };
  const currency = normalizeDocCurrency(input.currency) ?? session.orgCurrency;
  const totals = computeTotals(items as LineItemInput[], input.discount, currency);
  const bankAccounts = await snapshotDocumentBankAccounts(session.orgId, input.bankAccountIds);
  const seal = applySealOverride(await snapshotSealForDoc(db, session.orgId, "purchase_order"), { sealUrl: input.sealUrl, signatureUrl: input.signatureUrl });

  await db.transaction(async (tx) => {
    await tx
      .update(purchaseOrdersTable)
      .set({
        title: input.title.trim() || null,
        vendorId,
        projectId,
        orderDate: input.orderDate,
        expectedDate: input.expectedDate || null,
        bankAccounts,
        currency: normalizeDocCurrency(input.currency),
        notes: sanitizeIfHtml(input.notes) || null,
        terms: normalizeDocumentTerms(input.terms),
        subtotal: totals.subtotal,
        discount: totals.discount,
        taxTotal: totals.taxTotal,
        total: totals.total,
        sealUrl: seal.sealUrl,
        signatureUrl: seal.signatureUrl,
        updatedAt: new Date(),
      })
      .where(and(eq(purchaseOrdersTable.id, id), eq(purchaseOrdersTable.orgId, session.orgId)));
    await tx.delete(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.purchaseOrderId, id));
    await tx.insert(purchaseOrderItemsTable).values(
      items.map((l) => ({
        purchaseOrderId: id,
        productId: l.productId ? Number(l.productId) : null,
        imageUrl: l.imageUrl || null,
        unit: l.unit || null,
        customFields: l.customFields ?? {},
        description: sanitizeIfHtml(l.description),
        quantity: l.quantity,
        unitCost: l.unitPrice,
        taxRatePercent: l.taxRatePercent,
        lineTotal: roundMoney((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), currency),
      })),
    );
    await persistDocumentAttachments(tx, session.orgId, session.userId, "purchase_order", id, input.attachments);
  });

  await logActivity(session, { type: "purchase_order.updated", description: `Edited draft purchase order ${existing.poNumber}`, entityType: "purchase_order", entityId: id });
  revalidatePath(PATH);
  revalidatePath(`/purchasing/orders/${id}`);
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

// Batch A4 — cancel a non-posted purchase order. A received PO has posted inventory + AP
// and is refused by the lifecycle rule (correct it with a Debit Note instead); a cancelled
// PO cannot be re-cancelled. No accounting/inventory to reverse for draft/ordered.
export async function cancelPurchaseOrderAction(poId: number): Promise<ActionResult> {
  const session = await requireSession();
  const [po] = await db.select().from(purchaseOrdersTable).where(and(eq(purchaseOrdersTable.id, poId), eq(purchaseOrdersTable.orgId, session.orgId)));
  if (!po) return { error: "Purchase order not found." };
  const decision = evaluate("purchase_order", po.status, "cancel");
  if (!decision.allowed) return { error: decision.reason };

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

  // FX-6: the rate date for a receipt is the RECEIPT date — today, the day the goods and the
  // liability actually arrive — not the PO's order date. (The journal entry itself keeps its
  // existing orderDate, deliberately untouched: changing what date receipts post under is not an
  // FX question.) Base case short-circuits; a missing rate blocks the receipt.
  const receiptDate = new Date().toISOString().slice(0, 10);
  const captured = await captureBaseAmounts({
    orgId: session.orgId,
    baseCurrency: session.orgCurrency,
    docCurrency: po.currency,
    total: po.total,
    taxTotal: po.taxTotal,
    date: receiptDate,
  });
  if (!captured.ok) return { error: captured.error, missingRate: captured.missingRate };

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

    // The ledger holds BASE currency only. Two lines of the same figure — balanced by construction.
    await tx.insert(journalLinesTable).values([
      { journalEntryId: entry.id, accountId: inventory.id, debit: captured.baseTotal, credit: "0" },
      { journalEntryId: entry.id, accountId: accountsPayable.id, debit: "0", credit: captured.baseTotal },
    ]);

    await tx
      .update(purchaseOrdersTable)
      .set({
        status: "received",
        exchangeRate: captured.exchangeRate,
        baseTotal: captured.baseTotal,
        baseTaxAmount: captured.baseTaxAmount,
        // Nothing is paid at receipt; payments follow (FX-7 owns their conversion).
        basePaidAmount: roundMoney(0, session.orgCurrency),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrdersTable.id, poId));
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
