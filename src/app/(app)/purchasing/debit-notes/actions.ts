"use server";

import { revalidatePath } from "next/cache";
import { sanitizeIfHtml } from "@/lib/sanitize-html";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db, debitNotesTable, debitNoteItemsTable, purchaseOrdersTable, productsTable, accountsTable, journalEntriesTable, journalLinesTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { nextDocumentNumber } from "@/lib/documents";
import { can, evaluate } from "@/lib/document-lifecycle";
import { computeTotals, type LineItemInput } from "../../sales/_shared/totals";

export type ActionResult = { error?: string; id?: number };

const PATH = "/purchasing/debit-notes";

type LineInput = { productId: string; description: string; quantity: string; unitPrice: string; taxRatePercent: string; imageUrl?: string; unit?: string };

export async function createDebitNoteAction(
  input: {
    title: string;
    sourcePurchaseOrderId: string;
    reason: string;
    items: LineInput[];
  },
  andIssue = false,
): Promise<ActionResult> {
  const session = await requireSession();
  const sourcePurchaseOrderId = Number(input.sourcePurchaseOrderId);
  if (!sourcePurchaseOrderId) return { error: "Choose the purchase order this debit note is against." };

  const [po] = await db
    .select()
    .from(purchaseOrdersTable)
    .where(and(eq(purchaseOrdersTable.id, sourcePurchaseOrderId), eq(purchaseOrdersTable.orgId, session.orgId)));
  if (!po) return { error: "Purchase order not found." };

  const items = input.items.filter((l) => l.description.trim() && Number(l.quantity) > 0);
  if (items.length === 0) return { error: "Add at least one line item." };

  const totals = computeTotals(items as LineItemInput[]);

  const id = await db.transaction(async (tx) => {
    const debitNoteNumber = await nextDocumentNumber(tx, session.orgId, "debit_note");
    const [dn] = await tx
      .insert(debitNotesTable)
      .values({
        orgId: session.orgId,
        debitNoteNumber,
        title: input.title.trim() || null,
        vendorId: po.vendorId,
        sourcePurchaseOrderId: po.id,
        reason: input.reason.trim() || null,
        issueDate: new Date().toISOString().slice(0, 10),
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        createdById: session.userId,
      })
      .returning({ id: debitNotesTable.id });

    await tx.insert(debitNoteItemsTable).values(
      items.map((l) => ({
        debitNoteId: dn.id,
        productId: l.productId ? Number(l.productId) : null,
        imageUrl: l.imageUrl || null,
        unit: l.unit || null,
        description: sanitizeIfHtml(l.description),
        quantity: l.quantity,
        unitCost: l.unitPrice,
        taxRatePercent: l.taxRatePercent,
        lineTotal: ((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)).toFixed(2),
      })),
    );
    return dn.id;
  });

  await logActivity(session, { type: "debit_note.created", description: `Created a debit note against purchase order ${po.poNumber}`, entityType: "debit_note", entityId: id });
  if (andIssue) {
    await issueDebitNoteAction(id);
  }
  revalidatePath(PATH);
  redirect(`/purchasing/debit-notes/${id}`);
}

// Batch A2 — draft-only edit. Preserves number/org/status/vendor + source-PO link; recomputes totals server-side.
export async function updateDebitNoteAction(
  id: number,
  input: { reason: string; items: LineInput[] },
): Promise<ActionResult> {
  const session = await requireSession();
  const [existing] = await db.select().from(debitNotesTable).where(and(eq(debitNotesTable.id, id), eq(debitNotesTable.orgId, session.orgId)));
  if (!existing) return { error: "Debit note not found." };
  if (!can("debit_note", existing.status, "edit")) return { error: "Only draft debit notes can be edited." };

  const items = input.items.filter((l) => l.description.trim() && Number(l.quantity) > 0);
  if (items.length === 0) return { error: "Add at least one line item." };
  const totals = computeTotals(items as LineItemInput[]);

  await db.transaction(async (tx) => {
    await tx
      .update(debitNotesTable)
      .set({
        reason: input.reason.trim() || null,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
      })
      .where(and(eq(debitNotesTable.id, id), eq(debitNotesTable.orgId, session.orgId)));
    await tx.delete(debitNoteItemsTable).where(eq(debitNoteItemsTable.debitNoteId, id));
    await tx.insert(debitNoteItemsTable).values(
      items.map((l) => ({
        debitNoteId: id,
        productId: l.productId ? Number(l.productId) : null,
        imageUrl: l.imageUrl || null,
        unit: l.unit || null,
        description: sanitizeIfHtml(l.description),
        quantity: l.quantity,
        unitCost: l.unitPrice,
        taxRatePercent: l.taxRatePercent,
        lineTotal: ((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)).toFixed(2),
      })),
    );
  });

  await logActivity(session, { type: "debit_note.updated", description: `Edited draft debit note ${existing.debitNoteNumber}`, entityType: "debit_note", entityId: id });
  revalidatePath(PATH);
  revalidatePath(`/purchasing/debit-notes/${id}`);
  redirect(`/purchasing/debit-notes/${id}`);
}

// Reverses receivePurchaseOrderAction's ledger impact: Dr Accounts Payable / Cr Inventory,
// using the debit note's total only (the PO's receive entry never split VAT into its own
// line either — see receivePurchaseOrderAction) — and decrements product stock back down,
// since a debit note represents goods physically returned to the vendor, symmetric with how
// receiving incremented it. This is the one place this mirrors, rather than copies, Credit
// Note's reversal: a sales credit note never touches stock (it's often a pure price
// adjustment), but a purchase debit note always means a physical return.
export async function issueDebitNoteAction(debitNoteId: number): Promise<ActionResult> {
  const session = await requireSession();

  const [dn] = await db.select().from(debitNotesTable).where(and(eq(debitNotesTable.id, debitNoteId), eq(debitNotesTable.orgId, session.orgId)));
  if (!dn) return { error: "Debit note not found." };
  if (dn.status !== "draft") return { error: "Only draft debit notes can be issued." };

  const items = await db.select().from(debitNoteItemsTable).where(eq(debitNoteItemsTable.debitNoteId, debitNoteId));

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
          .set({ quantityOnHand: sql`${productsTable.quantityOnHand} - ${Math.trunc(Number(item.quantity))}` })
          .where(and(eq(productsTable.id, item.productId), eq(productsTable.orgId, session.orgId)));
      }
    }

    const [entry] = await tx
      .insert(journalEntriesTable)
      .values({
        orgId: session.orgId,
        entryDate: dn.issueDate,
        memo: `Debit note ${dn.debitNoteNumber} issued`,
        sourceType: "debit_note",
        sourceId: dn.id,
        createdById: session.userId,
      })
      .returning({ id: journalEntriesTable.id });

    await tx.insert(journalLinesTable).values([
      { journalEntryId: entry.id, accountId: accountsPayable.id, debit: dn.total, credit: "0" },
      { journalEntryId: entry.id, accountId: inventory.id, debit: "0", credit: dn.total },
    ]);

    await tx.update(debitNotesTable).set({ status: "issued" }).where(eq(debitNotesTable.id, debitNoteId));
  });

  await logActivity(session, { type: "debit_note.issued", description: `Issued debit note ${dn.debitNoteNumber} — posted reversing entry to ledger`, entityType: "debit_note", entityId: debitNoteId });
  revalidatePath(PATH);
  revalidatePath(`/purchasing/debit-notes/${debitNoteId}`);
  revalidatePath(`/purchasing/orders/${dn.sourcePurchaseOrderId}`);
  revalidatePath("/finance/chart-of-accounts");
  revalidatePath("/finance/ledger");
  revalidatePath("/finance/reports");
  revalidatePath("/inventory/products");
  revalidatePath("/dashboard");
  return {};
}

// Batch A4 — safely reverse an issued debit note: the exact inverse of issueDebitNoteAction,
// in one transaction. Increments product stock back (the returned goods come back on hand) and
// posts a reversing journal entry (Dr Inventory / Cr Accounts Payable), then marks the debit
// note reversed. The lifecycle rule only permits reverse on an issued debit note, so a reversed
// note cannot be reversed again — no double reversal.
export async function reverseDebitNoteAction(debitNoteId: number): Promise<ActionResult> {
  const session = await requireSession();
  const [dn] = await db.select().from(debitNotesTable).where(and(eq(debitNotesTable.id, debitNoteId), eq(debitNotesTable.orgId, session.orgId)));
  if (!dn) return { error: "Debit note not found." };
  const decision = evaluate("debit_note", dn.status, "reverse");
  if (!decision.allowed) return { error: decision.reason };

  const items = await db.select().from(debitNoteItemsTable).where(eq(debitNoteItemsTable.debitNoteId, debitNoteId));
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
        entryDate: new Date().toISOString().slice(0, 10),
        memo: `Debit note ${dn.debitNoteNumber} reversed`,
        sourceType: "debit_note",
        sourceId: dn.id,
        createdById: session.userId,
      })
      .returning({ id: journalEntriesTable.id });

    await tx.insert(journalLinesTable).values([
      { journalEntryId: entry.id, accountId: inventory.id, debit: dn.total, credit: "0" },
      { journalEntryId: entry.id, accountId: accountsPayable.id, debit: "0", credit: dn.total },
    ]);

    await tx.update(debitNotesTable).set({ status: "reversed" }).where(eq(debitNotesTable.id, debitNoteId));
  });

  await logActivity(session, { type: "debit_note.reversed", description: `Reversed debit note ${dn.debitNoteNumber} — posted reversing entry and restored stock`, entityType: "debit_note", entityId: debitNoteId });
  revalidatePath(PATH);
  revalidatePath(`/purchasing/debit-notes/${debitNoteId}`);
  revalidatePath(`/purchasing/orders/${dn.sourcePurchaseOrderId}`);
  revalidatePath("/finance/chart-of-accounts");
  revalidatePath("/finance/ledger");
  revalidatePath("/finance/reports");
  revalidatePath("/inventory/products");
  revalidatePath("/dashboard");
  return {};
}
