"use server";

import { revalidatePath } from "next/cache";
import { sanitizeIfHtml } from "@/lib/sanitize-html";
import { normalizeDocumentTerms, type DocumentTerm } from "../_shared/document-terms";
import { redirect } from "next/navigation";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, creditNotesTable, creditNoteItemsTable, salesInvoicesTable, accountsTable, journalEntriesTable, journalLinesTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { nextDocumentNumber } from "@/lib/documents";
import { can, evaluate } from "@/lib/document-lifecycle";
import { snapshotSealForDoc } from "@/lib/doc-seal";
import { snapshotDocumentBankAccounts } from "@/lib/document-bank-data";
import { computeTotals, type LineItemInput } from "../_shared/totals";
import { moneyEpsilon, roundMoney } from "@/lib/currency/currencies";
import { subtractMoney } from "@/lib/posting-currency";
import { creditNoteLines, noteBaseAmounts } from "@/lib/reversal-currency";
import {
  activeAllocationTotal, creditNoteReleaseAmount, releaseAllocations, reverseReleasesOfCause,
} from "@/lib/advance-allocations";

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
    // Create-and-issue used to DISCARD the issue's result and redirect regardless, so a refusal —
    // a missing exchange rate then, the credit-note cap now — left a silent draft and a screen that
    // looked like success. The note is saved either way; the reason has to reach the user.
    const issued = await issueCreditNoteAction(id);
    if (issued.error) {
      revalidatePath(PATH);
      return { ...issued, error: `${issued.error} The credit note has been saved as a draft.`, id };
    }
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

/**
 * Issue a credit note: post its reversing entry, and release whatever advance it over-settles.
 *
 * Two things were previously missing, and both produce an invoice that disagrees with the ledger:
 *
 *  1. **No cap.** Nothing stopped 12,000 of credit notes against a 10,000 invoice — `paidAmount`
 *     simply grew past the total. Capped server-side at the invoice's own value.
 *  2. **No release.** On an invoice settled by an advance, crediting 2,000 drove AR to −2,000 while
 *     the customer genuinely held 2,000 of value. Now the over-settled portion goes back to 2300 as
 *     available advance and AR stays where it was — see `creditNoteReleaseAmount`.
 */
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

  // The source invoice, read for its stored conversion. Re-read under lock inside the transaction
  // below, which is the read the posting actually uses.
  const [sourceInvoice] = await db
    .select({ currency: salesInvoicesTable.currency, exchangeRate: salesInvoicesTable.exchangeRate })
    .from(salesInvoicesTable)
    .where(and(eq(salesInvoicesTable.id, cn.sourceInvoiceId), eq(salesInvoicesTable.orgId, session.orgId)));
  if (!sourceInvoice) return { error: "Invoice not found." };

  const captured = await noteBaseAmounts({
    orgId: session.orgId,
    baseCurrency: session.orgCurrency,
    source: sourceInvoice,
    note: { currency: cn.currency, total: cn.total, taxTotal: cn.taxTotal, issueDate: cn.issueDate },
  });
  if (!captured.ok) return { error: captured.error, missingRate: captured.missingRate };
  // Derived, so the entry balances by construction — the pre-FX-6 lines debited the full subtotal
  // against a discounted total, the same latent hole the invoice send had.
  const baseRevenue = subtractMoney(captured.baseTotal, captured.baseTaxAmount, session.orgCurrency);

  const docCurrency = cn.currency ?? session.orgCurrency;
  const eps = moneyEpsilon(docCurrency);

  const outcome = await db.transaction(async (tx) => {
    // Lock the note, then the invoice. Two clicks on Issue can both pass the outer status check;
    // the second finds the note already issued here and stops before writing anything. The invoice
    // lock is what makes the cap and the release a single decision rather than a read-then-write
    // race with a second credit note against the same invoice.
    const noteLock = await tx.execute(sql`select status from credit_notes where id = ${cn.id} and org_id = ${session.orgId} for update`);
    if ((noteLock.rows as unknown as { status: string }[])[0]?.status !== "draft") {
      return { error: "Only draft credit notes can be issued." } as const;
    }
    const invoiceLock = await tx.execute(sql`
      select invoice_number, total::text as total, paid_amount::text as paid_amount,
             base_paid_amount::text as base_paid_amount, currency
        from sales_invoices where id = ${cn.sourceInvoiceId} and org_id = ${session.orgId}
         for update`);
    const invoice = (invoiceLock.rows as unknown as {
      invoice_number: string; total: string; paid_amount: string; base_paid_amount: string | null; currency: string | null;
    }[])[0];
    if (!invoice) return { error: "Invoice not found." } as const;

    // §Cap — the sum of ACTIVE credit notes against an invoice may not exceed the invoice's value.
    // Reversed and draft notes do not count: a reversed note has given its credit back, and a draft
    // has not posted. Without this, `paidAmount` grows past `total` and the invoice's own arithmetic
    // stops meaning anything — independent of advances.
    const [issued] = await tx
      .select({ total: sql<string>`coalesce(sum(${creditNotesTable.total}), 0)::text` })
      .from(creditNotesTable)
      .where(and(
        eq(creditNotesTable.orgId, session.orgId),
        eq(creditNotesTable.sourceInvoiceId, cn.sourceInvoiceId),
        eq(creditNotesTable.status, "issued"),
        isNull(creditNotesTable.deletedAt),
      ));
    const alreadyCredited = Number(issued?.total ?? 0);
    if (alreadyCredited + Number(cn.total) > Number(invoice.total) + eps) {
      const headroom = roundMoney(Math.max(0, Number(invoice.total) - alreadyCredited), docCurrency);
      return {
        error: alreadyCredited > 0
          ? `Credit notes against invoice ${invoice.invoice_number} already total ${roundMoney(alreadyCredited, docCurrency)} of its ${invoice.total} value. At most ${headroom} more can be credited.`
          : `A credit note cannot exceed the invoice it credits — invoice ${invoice.invoice_number} is ${invoice.total}.`,
      } as const;
    }

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
    const lines = creditNoteLines({
      baseTotal: captured.baseTotal,
      baseRevenue,
      baseTaxAmount: captured.baseTaxAmount,
      arAccountId: ar.id,
      revenueAccountId: revenue.id,
      vatAccountId: vatPayable.id,
    });
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

    // Release what this note over-settles the invoice by, capped at the advance money actually
    // behind it. LIFO, apportioned, and keyed to THIS note so a replay releases nothing twice.
    const allocated = await activeAllocationTotal(tx, session.orgId, cn.sourceInvoiceId, docCurrency);
    const releaseAmount = creditNoteReleaseAmount({
      invoiceTotal: invoice.total,
      invoicePaidAmount: invoice.paid_amount,
      creditNoteTotal: cn.total,
      activeAllocationTotal: allocated,
      docCurrency,
    });
    const releases = Number(releaseAmount) > eps
      ? await releaseAllocations(tx, {
          orgId: session.orgId, userId: session.userId, salesInvoiceId: cn.sourceInvoiceId,
          reason: "credit_note", causeType: "credit_note", causeId: cn.id,
          date: cn.issueDate, memoSubject: `credit note ${cn.creditNoteNumber}`,
          baseCurrency: session.orgCurrency, docCurrency, limitAmount: releaseAmount,
        })
      : [];
    const releasedDoc = releases.reduce((sum, r) => sum + Number(r.appliedAmount), 0);
    const releasedAr = releases.reduce((sum, r) => sum + Number(r.arCleared), 0);

    // The document-currency paidAmount moves by the note's total NET of what the release gave back;
    // the BASE twin by the note's baseTotal net of the AR the release restored — which is exactly
    // the AR the two entries moved between them, so GL 1100 still equals `baseTotal − basePaidAmount`
    // to the fils. An unconverted legacy invoice keeps null rather than being handed a mixed figure.
    await tx
      .update(salesInvoicesTable)
      .set({
        paidAmount: roundMoney(Number(invoice.paid_amount) + Number(cn.total) - releasedDoc, docCurrency),
        basePaidAmount: invoice.base_paid_amount === null
          ? null
          : roundMoney(Number(invoice.base_paid_amount) + Number(captured.baseTotal) - releasedAr, session.orgCurrency),
        updatedAt: new Date(),
      })
      .where(eq(salesInvoicesTable.id, cn.sourceInvoiceId));
    return { released: roundMoney(releasedDoc, docCurrency) } as const;
  });

  if ("error" in outcome) return { error: outcome.error };

  await logActivity(session, {
    type: "credit_note.issued",
    description: Number(outcome.released) > 0
      ? `Issued credit note ${cn.creditNoteNumber} — posted reversing entry and returned ${outcome.released} of applied advance to the client's balance`
      : `Issued credit note ${cn.creditNoteNumber} — posted reversing entry to ledger`,
    entityType: "credit_note",
    entityId: creditNoteId,
  });
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

    // Re-apply whatever this note released. A reversal that restored `paidAmount` but left the
    // advance released would give the customer their money twice: available in 2300 AND back on
    // the invoice as outstanding. The re-application is the mirror of the release's own lines.
    const reapplied = await reverseReleasesOfCause(tx, {
      orgId: session.orgId, userId: session.userId,
      causeType: "credit_note", causeId: cn.id,
      date: new Date().toISOString().slice(0, 10),
      memoSubject: `credit note ${cn.creditNoteNumber} reversed`,
    });
    const reappliedDoc = reapplied.reduce((sum, r) => sum + Number(r.appliedAmount), 0);
    const reappliedAr = reapplied.reduce((sum, r) => sum + Number(r.arCleared), 0);

    // Un-does the issue's adjustment exactly as it was made: the note's total LESS what it released
    // then, which is what it has just re-applied. The base twin uses the note's STORED baseTotal —
    // never a fresh conversion — guarded the same way it was applied, so a null stays null.
    await tx
      .update(salesInvoicesTable)
      .set({
        paidAmount: sql`GREATEST(0, ${salesInvoicesTable.paidAmount} - ${cn.total} + ${String(reappliedDoc)})`,
        basePaidAmount: cn.baseTotal === null
          ? sql`${salesInvoicesTable.basePaidAmount}`
          : sql`case when ${salesInvoicesTable.basePaidAmount} is null then null else GREATEST(0, ${salesInvoicesTable.basePaidAmount} - ${cn.baseTotal} + ${String(reappliedAr)}) end`,
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
