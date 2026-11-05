"use server";

import { revalidatePath } from "next/cache";
import { sanitizeIfHtml } from "@/lib/sanitize-html";
import { normalizeDocumentTerms, type DocumentTerm } from "../../sales/_shared/document-terms";
import { redirect } from "next/navigation";
import { and, eq, sql, isNull } from "drizzle-orm";
import { db, debitNotesTable, debitNoteItemsTable, purchaseOrdersTable, accountsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { nextDocumentNumber } from "@/lib/documents";
import { can, evaluate } from "@/lib/document-lifecycle";
import { snapshotSealForDoc } from "@/lib/doc-seal";
import { snapshotDocumentBankAccounts } from "@/lib/document-bank-data";
import { computeTotals, type LineItemInput } from "../../sales/_shared/totals";
import { roundMoney } from "@/lib/currency/currencies";
import { noteBaseAmounts } from "@/lib/reversal-currency";
import { isInventoryRefusal, refusalText } from "@/lib/inventory-costing";
import { postPurchaseReturn, reversePurchaseReturn } from "@/lib/purchase-posting";
import { getLocale } from "@/lib/i18n/server";

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

// Reverses part of receivePurchaseOrderAction's ledger impact — and takes the returned stock back
// out, since a debit note represents goods physically returned to the vendor, symmetric with how
// receiving brought them in. This is the one place this mirrors, rather than copies, Credit Note's
// reversal: a sales credit note never touches stock (it's often a pure price adjustment), but a
// purchase debit note always means a physical return. ACC-01: the posting (postPurchaseReturn)
// splits like the receipt it reverses — AP debited the gross; VAT back to 2100; stock lines out of
// inventory at the value the supplier credits; other lines back out of 5100.
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

  let outcome: { error?: string };
  try {
  outcome = await db.transaction(async (tx) => {
    // Lock the NOTE first, and re-check its status. The outer `status !== "draft"` check above ran
    // before the transaction, so two clicks on Issue can both pass it; the second finds the note
    // already issued here and stops before writing anything. The credit note has always done this;
    // the debit note did not, and it matters more now that the sibling aggregate below has to see a
    // serialized view — without it the second click would post a second entry AND be counted as a
    // prior note by nothing, since it is the same note.
    const noteLock = await tx.execute(sql`select status from debit_notes where id = ${dn.id} and org_id = ${session.orgId} for update`);
    if ((noteLock.rows as unknown as { status: string }[])[0]?.status !== "draft") {
      return { error: "Only draft debit notes can be issued." } as const;
    }

    // The purchase order, LOCKED. The rate itself needs no lock — `exchange_rate` is written
    // exactly once, by receivePurchaseOrderAction, which requires status `ordered` and sets
    // `received`, and the lifecycle allows only duplicate/reverse from there, so a receive cannot
    // run twice and edit is draft-only. The lock is for the SIBLING AGGREGATE below: two debit
    // notes issued concurrently against the same PO would otherwise both read the same "already
    // returned" total and both decide they are the closing note, and both would take the whole
    // remainder.
    const poLock = await tx.execute(sql`
      select po_number, currency, total::text as total, exchange_rate::text as exchange_rate,
             base_total::text as base_total, base_tax_amount::text as base_tax_amount
        from purchase_orders where id = ${dn.sourcePurchaseOrderId} and org_id = ${session.orgId}
         for update`);
    const sourcePo = (poLock.rows as unknown as {
      po_number: string; currency: string | null; total: string; exchange_rate: string | null;
      base_total: string | null; base_tax_amount: string | null;
    }[])[0];
    if (!sourcePo) return { error: "Purchase order not found." } as const;

    // The ACTIVE debit notes already issued against this PO — the mirror of the credit note's own
    // aggregate, and read the same NULL-intolerant way: `sum()` skips nulls silently, so a legacy
    // note with no stored conversion would shrink the sum and hand the closing rule a confident
    // wrong remainder.
    const [returned] = await tx
      .select({
        total: sql<string>`coalesce(sum(${debitNotesTable.total}), 0)::text`,
        baseTotal: sql<string>`coalesce(sum(${debitNotesTable.baseTotal}), 0)::text`,
        baseTaxAmount: sql<string>`coalesce(sum(${debitNotesTable.baseTaxAmount}), 0)::text`,
        unconverted: sql<number>`count(*) filter (where ${debitNotesTable.baseTotal} is null or ${debitNotesTable.baseTaxAmount} is null)::int`,
      })
      .from(debitNotesTable)
      .where(and(
        eq(debitNotesTable.orgId, session.orgId),
        eq(debitNotesTable.sourcePurchaseOrderId, dn.sourcePurchaseOrderId),
        eq(debitNotesTable.status, "issued"),
        isNull(debitNotesTable.deletedAt),
      ));
    const priorConverted = Number(returned?.unconverted ?? 0) === 0;

    // INHERITS the purchase order's stored rate — the note reverses part of a receipt whose
    // inventory and AP were both booked at that rate, and no cash moves here. The note that closes
    // the PO out takes the exact remainder rather than a fresh proportional conversion.
    const captured = noteBaseAmounts({
      baseCurrency: session.orgCurrency,
      source: {
        currency: sourcePo.currency, exchangeRate: sourcePo.exchange_rate,
        total: sourcePo.total, baseTotal: sourcePo.base_total, baseTaxAmount: sourcePo.base_tax_amount,
      },
      note: { currency: dn.currency, total: dn.total, taxTotal: dn.taxTotal },
      priorNotes: {
        total: returned?.total ?? "0",
        baseTotal: priorConverted ? (returned?.baseTotal ?? "0") : null,
        baseTaxAmount: priorConverted ? (returned?.baseTaxAmount ?? "0") : null,
      },
    });
    if (!captured.ok) return { error: captured.error } as const;

    await postPurchaseReturn(tx, {
      orgId: session.orgId, userId: session.userId, baseCurrency: session.orgCurrency,
      dn: { id: dn.id, debitNoteNumber: dn.debitNoteNumber, issueDate: dn.issueDate },
      items, captured,
    });

    await tx
      .update(debitNotesTable)
      .set({
        status: "issued",
        exchangeRate: captured.exchangeRate,
        baseTotal: captured.baseTotal,
        baseTaxAmount: captured.baseTaxAmount,
      })
      .where(eq(debitNotesTable.id, debitNoteId));
    return {} as const;
  });
  } catch (e) {
    // ACC-01: a stock shortfall or a fractional stock quantity — nothing was written.
    if (isInventoryRefusal(e)) return { error: refusalText(e, await getLocale()) };
    throw e;
  }
  if (outcome.error) return { error: outcome.error };

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

  const reversed = await db.transaction(async (tx) => {
    // The lifecycle decision again under the note's row lock: a second concurrent reverse would put
    // the returned stock and its cost back twice.
    const noteLock = await tx.execute(sql`select status from debit_notes where id = ${dn.id} and org_id = ${session.orgId} for update`);
    const again = evaluate("debit_note", (noteLock.rows as unknown as { status: string }[])[0]?.status ?? "", "reverse");
    if (!again.allowed) return { error: again.reason } as const;

    // FX-6 mirror of the posting entry, and the returned stock put back exactly as it left (ACC-01).
    await reversePurchaseReturn(tx, {
      orgId: session.orgId, userId: session.userId, baseCurrency: session.orgCurrency,
      dn: { id: dn.id, debitNoteNumber: dn.debitNoteNumber }, items, date: new Date().toISOString().slice(0, 10),
    });

    await tx.update(debitNotesTable).set({ status: "reversed" }).where(eq(debitNotesTable.id, debitNoteId));
    return {} as const;
  });
  if ("error" in reversed) return { error: reversed.error };

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
