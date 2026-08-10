"use server";

import { revalidatePath } from "next/cache";
import { sanitizeIfHtml } from "@/lib/sanitize-html";
import { normalizeDocumentTerms, type DocumentTerm } from "../_shared/document-terms";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db, creditNotesTable, creditNoteItemsTable, salesInvoicesTable, accountsTable, journalEntriesTable, journalLinesTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { nextDocumentNumber } from "@/lib/documents";
import { can, evaluate } from "@/lib/document-lifecycle";
import { snapshotSealForDoc } from "@/lib/doc-seal";
import { snapshotDocumentBankAccounts } from "@/lib/document-bank-data";
import { computeTotals, type LineItemInput } from "../_shared/totals";
import { roundMoney } from "@/lib/currency/currencies";
import { captureBaseAmounts, subtractMoney } from "@/lib/posting-currency";

export type ActionResult = {
  error?: string;
  id?: number;
  /** Set when a posting was blocked by a missing exchange rate — FX-3's rate-entry seam. */
  missingRate?: { currency: string; date: string };
};

const PATH = "/sales/credit-notes";

type LineInput = { productId: string; description: string; quantity: string; unitPrice: string; taxRatePercent: string; imageUrl?: string; unit?: string; customFields?: Record<string, string> };

export async function createCreditNoteAction(
  input: {
    title: string;
    sourceInvoiceId: string;
    reason: string;
    items: LineInput[];
    terms?: DocumentTerm[];
    bankAccountIds?: number[];
  },
  andIssue = false,
): Promise<ActionResult> {
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

  // A credit note reverses a specific invoice, so it is denominated in THAT invoice's currency —
  // never chosen independently, never the org default. A reversal in a different currency from the
  // document it reverses is not a meaningful object, and FX-6 cannot convert a note whose currency
  // was never written.
  const currency = invoice.currency ?? session.orgCurrency;
  const totals = computeTotals(items as LineItemInput[], 0, currency);
  const bankAccounts = await snapshotDocumentBankAccounts(session.orgId, input.bankAccountIds);
  const seal = await snapshotSealForDoc(db, session.orgId, "credit_note");

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
        currency: invoice.currency,
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
      .returning({ id: creditNotesTable.id });

    await tx.insert(creditNoteItemsTable).values(
      items.map((l) => ({
        creditNoteId: cn.id,
        productId: l.productId ? Number(l.productId) : null,
        imageUrl: l.imageUrl || null,
        unit: l.unit || null,
        customFields: l.customFields ?? {},
        description: sanitizeIfHtml(l.description),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxRatePercent: l.taxRatePercent,
        lineTotal: roundMoney((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), currency),
      })),
    );
    return cn.id;
  });

  await logActivity(session, { type: "credit_note.created", description: `Created a credit note against invoice ${invoice.invoiceNumber}`, entityType: "credit_note", entityId: id });
  if (andIssue) {
    await issueCreditNoteAction(id);
  }
  revalidatePath(PATH);
  redirect(`/sales/credit-notes/${id}`);
}

// Batch A2 — draft-only edit. Preserves number/org/status/customer + source-invoice link; recomputes totals server-side.
export async function updateCreditNoteAction(
  id: number,
  input: { reason: string; items: LineInput[]; terms?: DocumentTerm[]; bankAccountIds?: number[] },
): Promise<ActionResult> {
  const session = await requireSession();
  const [existing] = await db.select().from(creditNotesTable).where(and(eq(creditNotesTable.id, id), eq(creditNotesTable.orgId, session.orgId)));
  if (!existing) return { error: "Credit note not found." };
  if (!can("credit_note", existing.status, "edit")) return { error: "Only draft credit notes can be edited." };

  const items = input.items.filter((l) => l.description.trim() && Number(l.quantity) > 0);
  if (items.length === 0) return { error: "Add at least one line item." };
  // Editing never changes the note's currency — it stays what it inherited from its invoice.
  const currency = existing.currency ?? session.orgCurrency;
  const totals = computeTotals(items as LineItemInput[], 0, currency);
  const bankAccounts = await snapshotDocumentBankAccounts(session.orgId, input.bankAccountIds);

  await db.transaction(async (tx) => {
    await tx
      .update(creditNotesTable)
      .set({
        reason: input.reason.trim() || null,
        terms: normalizeDocumentTerms(input.terms),
        bankAccounts,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
      })
      .where(and(eq(creditNotesTable.id, id), eq(creditNotesTable.orgId, session.orgId)));
    await tx.delete(creditNoteItemsTable).where(eq(creditNoteItemsTable.creditNoteId, id));
    await tx.insert(creditNoteItemsTable).values(
      items.map((l) => ({
        creditNoteId: id,
        productId: l.productId ? Number(l.productId) : null,
        imageUrl: l.imageUrl || null,
        unit: l.unit || null,
        customFields: l.customFields ?? {},
        description: sanitizeIfHtml(l.description),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxRatePercent: l.taxRatePercent,
        lineTotal: roundMoney((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), currency),
      })),
    );
  });

  await logActivity(session, { type: "credit_note.updated", description: `Edited draft credit note ${existing.creditNoteNumber}`, entityType: "credit_note", entityId: id });
  revalidatePath(PATH);
  revalidatePath(`/sales/credit-notes/${id}`);
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

  // FX-6: the rate date for a credit note is the NOTE's own issue date. The note inherits its
  // invoice's currency at creation, so this converts the same currency the invoice was in — but at
  // the note date's rate, which is the model's rule: each posting event converts at its own date.
  const captured = await captureBaseAmounts({
    orgId: session.orgId,
    baseCurrency: session.orgCurrency,
    docCurrency: cn.currency,
    total: cn.total,
    taxTotal: cn.taxTotal,
    date: cn.issueDate,
  });
  if (!captured.ok) return { error: captured.error, missingRate: captured.missingRate };
  // Derived, so the entry balances by construction — the pre-FX-6 lines debited the full subtotal
  // against a discounted total, the same latent hole the invoice send had.
  const baseRevenue = subtractMoney(captured.baseTotal, captured.baseTaxAmount, session.orgCurrency);

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

    // BASE currency only, mirroring the invoice-send shape in reverse.
    const lines: { accountId: number; debit: string; credit: string }[] = [
      { accountId: revenue.id, debit: baseRevenue, credit: "0" },
      { accountId: ar.id, debit: "0", credit: captured.baseTotal },
    ];
    if (Number(captured.baseTaxAmount) > 0) {
      lines.push({ accountId: vatPayable.id, debit: captured.baseTaxAmount, credit: "0" });
    }
    await tx.insert(journalLinesTable).values(lines.map((l) => ({ journalEntryId: entry.id, ...l })));

    await tx
      .update(creditNotesTable)
      .set({
        status: "issued",
        exchangeRate: captured.exchangeRate,
        baseTotal: captured.baseTotal,
        baseTaxAmount: captured.baseTaxAmount,
      })
      .where(eq(creditNotesTable.id, creditNoteId));
    // The document-currency paidAmount moves by the note's total, exactly as before; the BASE twin
    // moves by the note's baseTotal — but only where the invoice HAS base amounts. An unconverted
    // legacy invoice keeps null rather than being handed a mixed figure.
    await tx
      .update(salesInvoicesTable)
      .set({
        paidAmount: sql`${salesInvoicesTable.paidAmount} + ${cn.total}`,
        basePaidAmount: sql`case when ${salesInvoicesTable.basePaidAmount} is null then null else ${salesInvoicesTable.basePaidAmount} + ${captured.baseTotal} end`,
        updatedAt: new Date(),
      })
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

// Batch A4 — safely reverse an issued credit note: the exact inverse of issueCreditNoteAction,
// in one transaction. Posts a reversing journal entry (Dr Accounts Receivable / Cr Sales
// Revenue + Cr VAT Payable) and restores the source invoice's balance (subtracts the credit
// back from paidAmount, floored at zero), then marks the credit note reversed. The lifecycle
// rule only permits reverse on an issued credit note, so a reversed note cannot be reversed
// again — no double reversal.
export async function reverseCreditNoteAction(creditNoteId: number): Promise<ActionResult> {
  const session = await requireSession();
  const [cn] = await db.select().from(creditNotesTable).where(and(eq(creditNotesTable.id, creditNoteId), eq(creditNotesTable.orgId, session.orgId)));
  if (!cn) return { error: "Credit note not found." };
  const decision = evaluate("credit_note", cn.status, "reverse");
  if (!decision.allowed) return { error: decision.reason };

  // No chart-of-accounts lookup: the reversal mirrors the issue entry's own lines (FX-6), so the
  // accounts come from what was actually posted, and the stored conversion cannot be re-derived.

  await db.transaction(async (tx) => {
    const [posting] = await tx
      .select({ id: journalEntriesTable.id })
      .from(journalEntriesTable)
      .where(and(
        eq(journalEntriesTable.orgId, session.orgId),
        eq(journalEntriesTable.sourceType, "credit_note"),
        eq(journalEntriesTable.sourceId, cn.id),
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
          memo: `Credit note ${cn.creditNoteNumber} reversed`,
          sourceType: "credit_note",
          sourceId: cn.id,
          createdById: session.userId,
        })
        .returning({ id: journalEntriesTable.id });

      await tx.insert(journalLinesTable).values(
        originalLines.map((l) => ({ journalEntryId: entry.id, accountId: l.accountId, debit: l.credit, credit: l.debit })),
      );
    }

    await tx.update(creditNotesTable).set({ status: "reversed" }).where(eq(creditNotesTable.id, creditNoteId));
    // Un-does the issue's adjustment: doc-currency paidAmount by cn.total, the base twin by the
    // note's STORED baseTotal — guarded the same way it was applied, so a null stays null.
    await tx
      .update(salesInvoicesTable)
      .set({
        paidAmount: sql`GREATEST(0, ${salesInvoicesTable.paidAmount} - ${cn.total})`,
        basePaidAmount: cn.baseTotal === null
          ? sql`${salesInvoicesTable.basePaidAmount}`
          : sql`case when ${salesInvoicesTable.basePaidAmount} is null then null else GREATEST(0, ${salesInvoicesTable.basePaidAmount} - ${cn.baseTotal}) end`,
        updatedAt: new Date(),
      })
      .where(eq(salesInvoicesTable.id, cn.sourceInvoiceId));
  });

  await logActivity(session, { type: "credit_note.reversed", description: `Reversed credit note ${cn.creditNoteNumber} — posted reversing entry and restored invoice balance`, entityType: "credit_note", entityId: creditNoteId });
  revalidatePath(PATH);
  revalidatePath(`/sales/credit-notes/${creditNoteId}`);
  revalidatePath(`/sales/invoices/${cn.sourceInvoiceId}`);
  revalidatePath("/finance/chart-of-accounts");
  revalidatePath("/finance/ledger");
  revalidatePath("/finance/reports");
  revalidatePath("/dashboard");
  return {};
}
