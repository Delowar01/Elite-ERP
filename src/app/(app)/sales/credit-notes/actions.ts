"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db, creditNotesTable, creditNoteItemsTable, salesInvoicesTable, accountsTable, journalEntriesTable, journalLinesTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { nextDocumentNumber } from "@/lib/documents";
import { computeTotals, type LineItemInput } from "../_shared/totals";

export type ActionResult = { error?: string; id?: number };

const PATH = "/sales/credit-notes";

type LineInput = { productId: string; description: string; quantity: string; unitPrice: string; taxRatePercent: string };

export async function createCreditNoteAction(input: {
  title: string;
  sourceInvoiceId: string;
  reason: string;
  items: LineInput[];
}): Promise<ActionResult> {
  const session = await requireSession();
  const sourceInvoiceId = Number(input.sourceInvoiceId);
  if (!sourceInvoiceId) return { error: "Choose the invoice this credit note is against." };

  const [invoice] = await db
    .select()
    .from(salesInvoicesTable)
    .where(and(eq(salesInvoicesTable.id, sourceInvoiceId), eq(salesInvoicesTable.orgId, session.orgId)));
  if (!invoice) return { error: "Invoice not found." };

  const items = input.items.filter((l) => l.description.trim() && Number(l.quantity) > 0);
  if (items.length === 0) return { error: "Add at least one line item." };

  const totals = computeTotals(items as LineItemInput[]);

  const id = await db.transaction(async (tx) => {
    const creditNoteNumber = await nextDocumentNumber(tx, session.orgId, "credit_note");
    const [cn] = await tx
      .insert(creditNotesTable)
      .values({
        orgId: session.orgId,
        creditNoteNumber,
        title: input.title.trim() || null,
        customerId: invoice.customerId,
        sourceInvoiceId: invoice.id,
        reason: input.reason.trim() || null,
        issueDate: new Date().toISOString().slice(0, 10),
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        createdById: session.userId,
      })
      .returning({ id: creditNotesTable.id });

    await tx.insert(creditNoteItemsTable).values(
      items.map((l) => ({
        creditNoteId: cn.id,
        productId: l.productId ? Number(l.productId) : null,
        description: l.description.trim(),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxRatePercent: l.taxRatePercent,
        lineTotal: ((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)).toFixed(2),
      })),
    );
    return cn.id;
  });

  await logActivity(session, { type: "credit_note.created", description: `Created a credit note against invoice ${invoice.invoiceNumber}`, entityType: "credit_note", entityId: id });
  revalidatePath(PATH);
  redirect(`/sales/credit-notes/${id}`);
}

export async function issueCreditNoteAction(creditNoteId: number): Promise<ActionResult> {
  const session = await requireSession();

  const [cn] = await db.select().from(creditNotesTable).where(and(eq(creditNotesTable.id, creditNoteId), eq(creditNotesTable.orgId, session.orgId)));
  if (!cn) return { error: "Credit note not found." };
  if (cn.status !== "draft") return { error: "Only draft credit notes can be issued." };

  const accounts = await db.select().from(accountsTable).where(eq(accountsTable.orgId, session.orgId));
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const ar = byCode.get("1100");
  const revenue = byCode.get("4000");
  const vatPayable = byCode.get("2100");
  if (!ar || !revenue || !vatPayable) {
    return { error: "Chart of accounts is missing a required system account (1100/4000/2100)." };
  }

  await db.transaction(async (tx) => {
    const [entry] = await tx
      .insert(journalEntriesTable)
      .values({
        orgId: session.orgId,
        entryDate: cn.issueDate,
        memo: `Credit note ${cn.creditNoteNumber} issued`,
        sourceType: "credit_note",
        sourceId: cn.id,
        createdById: session.userId,
      })
      .returning({ id: journalEntriesTable.id });

    const lines: { accountId: number; debit: string; credit: string }[] = [
      { accountId: revenue.id, debit: cn.subtotal, credit: "0" },
      { accountId: ar.id, debit: "0", credit: cn.total },
    ];
    if (Number(cn.taxTotal) > 0) {
      lines.push({ accountId: vatPayable.id, debit: cn.taxTotal, credit: "0" });
    }
    await tx.insert(journalLinesTable).values(lines.map((l) => ({ journalEntryId: entry.id, ...l })));

    await tx.update(creditNotesTable).set({ status: "issued" }).where(eq(creditNotesTable.id, creditNoteId));
    await tx
      .update(salesInvoicesTable)
      .set({ paidAmount: sql`${salesInvoicesTable.paidAmount} + ${cn.total}`, updatedAt: new Date() })
      .where(eq(salesInvoicesTable.id, cn.sourceInvoiceId));
  });

  await logActivity(session, { type: "credit_note.issued", description: `Issued credit note ${cn.creditNoteNumber} — posted reversing entry to ledger`, entityType: "credit_note", entityId: creditNoteId });
  revalidatePath(PATH);
  revalidatePath(`/sales/credit-notes/${creditNoteId}`);
  revalidatePath(`/sales/invoices/${cn.sourceInvoiceId}`);
  revalidatePath("/finance/chart-of-accounts");
  revalidatePath("/finance/ledger");
  revalidatePath("/finance/reports");
  return {};
}
