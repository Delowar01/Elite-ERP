"use server";

import { revalidatePath } from "next/cache";
import { sanitizeIfHtml } from "@/lib/sanitize-html";
import { normalizeDocumentTerms, type DocumentTerm } from "../../sales/_shared/document-terms";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db, debitNotesTable, debitNoteItemsTable, purchaseOrdersTable, productsTable, accountsTable, journalEntriesTable, journalLinesTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { nextDocumentNumber } from "@/lib/documents";
import { can, evaluate } from "@/lib/document-lifecycle";
import { snapshotSealForDoc } from "@/lib/doc-seal";
import { snapshotDocumentBankAccounts } from "@/lib/document-bank-data";
import { computeTotals, type LineItemInput } from "../../sales/_shared/totals";
import { roundMoney } from "@/lib/currency/currencies";
import { captureBaseAmounts } from "@/lib/posting-currency";

export type ActionResult = {
  error?: string;
  id?: number;
  /** Set when a posting was blocked by a missing exchange rate — FX-3's rate-entry seam. */
  missingRate?: { currency: string; date: string };
};

const PATH = "/purchasing/debit-notes";

type LineInput = { productId: string; description: string; quantity: string; unitPrice: string; taxRatePercent: string; imageUrl?: string; unit?: string; customFields?: Record<string, string> };

export async function createDebitNoteAction(
  input: {
    title: string;
    sourcePurchaseOrderId: string;
    reason: string;
    items: LineInput[];
    terms?: DocumentTerm[];
    bankAccountIds?: number[];
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

  // Denominated in the purchase order it reverses — same rule as the credit note.
  const currency = po.currency ?? session.orgCurrency;
  const totals = computeTotals(items as LineItemInput[], 0, currency);
  const bankAccounts = await snapshotDocumentBankAccounts(session.orgId, input.bankAccountIds);
  const seal = await snapshotSealForDoc(db, session.orgId, "debit_note");

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
        currency: po.currency,
        reason: input.reason.trim() || null,
        terms: normalizeDocumentTerms(input.terms),
        bankAccounts,
        issueDate: new Date().toISOString().slice(0, 10),
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        sealUrl: seal.sealUrl,
        signatureUrl: seal.signatureUrl,
        createdById: session.userId,
      })
      .returning({ id: debitNotesTable.id });

    await tx.insert(debitNoteItemsTable).values(
      items.map((l) => ({
        debitNoteId: dn.id,
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
  input: { reason: string; items: LineInput[]; terms?: DocumentTerm[]; bankAccountIds?: number[] },
): Promise<ActionResult> {
  const session = await requireSession();
  const [existing] = await db.select().from(debitNotesTable).where(and(eq(debitNotesTable.id, id), eq(debitNotesTable.orgId, session.orgId)));
  if (!existing) return { error: "Debit note not found." };
  if (!can("debit_note", existing.status, "edit")) return { error: "Only draft debit notes can be edited." };

  const items = input.items.filter((l) => l.description.trim() && Number(l.quantity) > 0);
  if (items.length === 0) return { error: "Add at least one line item." };
  // Editing never changes the note's currency — it stays what it inherited from its PO.
  const currency = existing.currency ?? session.orgCurrency;
  const totals = computeTotals(items as LineItemInput[], 0, currency);
  const bankAccounts = await snapshotDocumentBankAccounts(session.orgId, input.bankAccountIds);

  await db.transaction(async (tx) => {
    await tx
      .update(debitNotesTable)
      .set({
        reason: input.reason.trim() || null,
        terms: normalizeDocumentTerms(input.terms),
        bankAccounts,
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
        customFields: l.customFields ?? {},
        description: sanitizeIfHtml(l.description),
        quantity: l.quantity,
        unitCost: l.unitPrice,
        taxRatePercent: l.taxRatePercent,
        lineTotal: roundMoney((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), currency),
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

  // FX-6: the rate date for a debit note is the NOTE's own issue date. The note inherits its PO's
  // currency at creation; a missing rate blocks the issue rather than posting unconverted.
  const captured = await captureBaseAmounts({
    orgId: session.orgId,
    baseCurrency: session.orgCurrency,
    docCurrency: dn.currency,
    total: dn.total,
    taxTotal: dn.taxTotal,
    date: dn.issueDate,
  });
  if (!captured.ok) return { error: captured.error, missingRate: captured.missingRate };

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

    // BASE currency only. Two lines of the same figure — balanced by construction.
    await tx.insert(journalLinesTable).values([
      { journalEntryId: entry.id, accountId: accountsPayable.id, debit: captured.baseTotal, credit: "0" },
      { journalEntryId: entry.id, accountId: inventory.id, debit: "0", credit: captured.baseTotal },
    ]);

    await tx
      .update(debitNotesTable)
      .set({
        status: "issued",
        exchangeRate: captured.exchangeRate,
        baseTotal: captured.baseTotal,
        baseTaxAmount: captured.baseTaxAmount,
      })
      .where(eq(debitNotesTable.id, debitNoteId));
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
  // No chart-of-accounts lookup: the reversal mirrors the issue entry's own lines (FX-6), so the
  // accounts come from what was actually posted and the stored conversion cannot be re-derived.

  await db.transaction(async (tx) => {
    for (const item of items) {
      if (item.productId) {
        await tx
          .update(productsTable)
          .set({ quantityOnHand: sql`${productsTable.quantityOnHand} + ${Math.trunc(Number(item.quantity))}` })
          .where(and(eq(productsTable.id, item.productId), eq(productsTable.orgId, session.orgId)));
      }
    }

    const [posting] = await tx
      .select({ id: journalEntriesTable.id })
      .from(journalEntriesTable)
      .where(and(
        eq(journalEntriesTable.orgId, session.orgId),
        eq(journalEntriesTable.sourceType, "debit_note"),
        eq(journalEntriesTable.sourceId, dn.id),
      ))
      .orderBy(journalEntriesTable.id)
      .limit(1);

    if (posting) {
      const originalLines = await tx
        .select({ accountId: journalLinesTable.accountId, debit: journalLinesTable.debit, credit: journalLinesTable.credit })
        .from(journalLinesTable)
        .where(eq(journalLinesTable.journalEntryId, posting.id));

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

      await tx.insert(journalLinesTable).values(
        originalLines.map((l) => ({ journalEntryId: entry.id, accountId: l.accountId, debit: l.credit, credit: l.debit })),
      );
    }

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
