"use server";

import { revalidatePath } from "next/cache";
import { sanitizeIfHtml } from "@/lib/sanitize-html";
import { normalizeDocumentTerms, type DocumentTerm } from "../_shared/document-terms";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db, customersTable, projectsTable, salesInvoicesTable, salesInvoiceItemsTable, productsTable, accountsTable, journalEntriesTable, journalLinesTable, deliveryChallansTable, deliveryChallanItemsTable, paymentTermPresetsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { nextDocumentNumber } from "@/lib/documents";
import { can, evaluate } from "@/lib/document-lifecycle";
import { computeTotals, type LineItemInput } from "../_shared/totals";
import { persistDocumentAttachments, type AttachmentInput } from "../_shared/attachment-persist";
import { snapshotDocumentBankAccounts } from "@/lib/document-bank-data";
import { snapshotSealForDoc, applySealOverride } from "@/lib/doc-seal";
import { normalizeDocCurrency, roundMoney } from "@/lib/currency/currencies";
import { captureBaseAmounts, subtractMoney } from "@/lib/posting-currency";

export type ActionResult = {
  error?: string;
  id?: number;
  /** Set when a posting was blocked by a missing exchange rate — FX-3's rate-entry seam. */
  missingRate?: { currency: string; date: string };
};

const PATH = "/sales/invoices";

type LineInput = { productId: string; description: string; quantity: string; unitPrice: string; taxRatePercent: string; imageUrl?: string; unit?: string; customFields?: Record<string, string> };

/**
 * Validate the due date + payment term submitted with an invoice. Both are optional (an invoice can
 * be issued with no agreed due date), but when present the term must belong to this org and the due
 * date may not precede the issue date — otherwise AR Aging would report it overdue from day one.
 */
async function resolveDueTerms(
  orgId: number,
  issueDate: string,
  rawDueDate?: string,
  rawTermId?: string,
): Promise<{ error?: string; dueDate?: string | null; paymentTermPresetId?: number | null }> {
  const dueDate = (rawDueDate ?? "").trim() || null;
  if (dueDate && dueDate < issueDate) return { error: "Due date cannot be before the issue date." };

  const termId = Number(rawTermId) || null;
  if (!termId) return { dueDate, paymentTermPresetId: null };
  const [term] = await db
    .select({ id: paymentTermPresetsTable.id })
    .from(paymentTermPresetsTable)
    .where(and(eq(paymentTermPresetsTable.id, termId), eq(paymentTermPresetsTable.orgId, orgId)));
  if (!term) return { error: "Payment term not found." };
  return { dueDate, paymentTermPresetId: term.id };
}

export async function createInvoiceAction(
  input: {
    title: string;
    customerId: string;
    projectId?: string;
    issueDate: string;
    dueDate?: string;
    paymentTermId?: string;
    discount: string;
    notes: string; terms?: DocumentTerm[];
    items: LineInput[];
    attachments?: AttachmentInput[];
    bankAccountIds?: number[];
    currency?: string;
    sealUrl?: string;
    signatureUrl?: string;
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

  const due = await resolveDueTerms(session.orgId, input.issueDate, input.dueDate, input.paymentTermId);
  if (due.error) return { error: due.error };

  const items = input.items.filter((l) => l.description.trim() && Number(l.quantity) > 0);
  if (items.length === 0) return { error: "Add at least one line item." };

  const currency = normalizeDocCurrency(input.currency) ?? session.orgCurrency;
  const totals = computeTotals(items as LineItemInput[], input.discount, currency);
  const bankAccounts = await snapshotDocumentBankAccounts(session.orgId, input.bankAccountIds);
  const seal = applySealOverride(await snapshotSealForDoc(db, session.orgId, "sales_invoice"), { sealUrl: input.sealUrl, signatureUrl: input.signatureUrl });

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
        dueDate: due.dueDate ?? null,
        paymentTermPresetId: due.paymentTermPresetId ?? null,
        notes: sanitizeIfHtml(input.notes) || null,
        terms: normalizeDocumentTerms(input.terms),
        bankAccounts,
        currency: normalizeDocCurrency(input.currency),
        subtotal: totals.subtotal,
        discount: totals.discount,
        taxTotal: totals.taxTotal,
        total: totals.total,
        sealUrl: seal.sealUrl,
        signatureUrl: seal.signatureUrl,
        createdById: session.userId,
      })
      .returning({ id: salesInvoicesTable.id });

    await tx.insert(salesInvoiceItemsTable).values(
      items.map((l) => ({
        invoiceId: inv.id,
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
    await persistDocumentAttachments(tx, session.orgId, session.userId, "sales_invoice", inv.id, input.attachments);

    return inv.id;
  });

  await logActivity(session, { type: "sales_invoice.created", description: "Created an invoice", entityType: "sales_invoice", entityId: id });
  if (andSend) {
    await sendInvoiceAction(id);
  }
  revalidatePath(PATH);
  redirect(`/sales/invoices/${id}`);
}

// Batch A2 — draft-only edit. Preserves number/org/status/source links; recomputes totals server-side.
export async function updateInvoiceAction(
  id: number,
  input: { title: string; customerId: string; projectId?: string; issueDate: string; dueDate?: string; paymentTermId?: string; discount: string; notes: string; terms?: DocumentTerm[]; items: LineInput[]; attachments?: AttachmentInput[]; bankAccountIds?: number[]; currency?: string; sealUrl?: string; signatureUrl?: string },
): Promise<ActionResult> {
  const session = await requireSession();
  const [existing] = await db.select().from(salesInvoicesTable).where(and(eq(salesInvoicesTable.id, id), eq(salesInvoicesTable.orgId, session.orgId)));
  if (!existing) return { error: "Invoice not found." };
  if (!can("sales_invoice", existing.status, "edit")) return { error: "Only draft invoices can be edited." };

  const customerId = Number(input.customerId);
  if (!customerId) return { error: "Choose a client." };
  const [customerOwned] = await db.select({ id: customersTable.id }).from(customersTable).where(and(eq(customersTable.id, customerId), eq(customersTable.orgId, session.orgId)));
  if (!customerOwned) return { error: "Client not found." };
  let projectId: number | null = null;
  if (input.projectId) {
    const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(and(eq(projectsTable.id, Number(input.projectId)), eq(projectsTable.orgId, session.orgId)));
    if (!project) return { error: "Project not found." };
    projectId = project.id;
  }
  if (!input.issueDate) return { error: "Issue date is required." };

  const due = await resolveDueTerms(session.orgId, input.issueDate, input.dueDate, input.paymentTermId);
  if (due.error) return { error: due.error };
  const items = input.items.filter((l) => l.description.trim() && Number(l.quantity) > 0);
  if (items.length === 0) return { error: "Add at least one line item." };
  const currency = normalizeDocCurrency(input.currency) ?? session.orgCurrency;
  const totals = computeTotals(items as LineItemInput[], input.discount, currency);
  const bankAccounts = await snapshotDocumentBankAccounts(session.orgId, input.bankAccountIds);
  const seal = applySealOverride(await snapshotSealForDoc(db, session.orgId, "sales_invoice"), { sealUrl: input.sealUrl, signatureUrl: input.signatureUrl });

  await db.transaction(async (tx) => {
    await tx
      .update(salesInvoicesTable)
      .set({
        title: input.title.trim() || null,
        customerId,
        projectId,
        issueDate: input.issueDate,
        dueDate: due.dueDate ?? null,
        paymentTermPresetId: due.paymentTermPresetId ?? null,
        notes: sanitizeIfHtml(input.notes) || null,
        terms: normalizeDocumentTerms(input.terms),
        bankAccounts,
        currency: normalizeDocCurrency(input.currency),
        subtotal: totals.subtotal,
        discount: totals.discount,
        taxTotal: totals.taxTotal,
        total: totals.total,
        sealUrl: seal.sealUrl,
        signatureUrl: seal.signatureUrl,
        updatedAt: new Date(),
      })
      .where(and(eq(salesInvoicesTable.id, id), eq(salesInvoicesTable.orgId, session.orgId)));
    await tx.delete(salesInvoiceItemsTable).where(eq(salesInvoiceItemsTable.invoiceId, id));
    await tx.insert(salesInvoiceItemsTable).values(
      items.map((l) => ({
        invoiceId: id,
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
    await persistDocumentAttachments(tx, session.orgId, session.userId, "sales_invoice", id, input.attachments);
  });

  await logActivity(session, { type: "sales_invoice.updated", description: `Edited draft invoice ${existing.invoiceNumber}`, entityType: "sales_invoice", entityId: id });
  revalidatePath(PATH);
  revalidatePath(`/sales/invoices/${id}`);
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

  // FX-6: convert once, at the invoice's own date, and store the result. A base-currency invoice
  // short-circuits to the identity with no rate lookup; a foreign one with no usable rate BLOCKS —
  // posting unconverted or at a guessed rate writes a wrong ledger, and a block is recoverable.
  const captured = await captureBaseAmounts({
    orgId: session.orgId,
    baseCurrency: session.orgCurrency,
    docCurrency: invoice.currency,
    total: invoice.total,
    taxTotal: invoice.taxTotal,
    date: invoice.issueDate,
  });
  if (!captured.ok) return { error: captured.error, missingRate: captured.missingRate };
  // The revenue line is DERIVED so the entry balances by construction — Dr baseTotal always equals
  // Cr revenue + Cr VAT exactly. (The old lines credited the full subtotal against a discounted
  // total, which unbalanced the entry by the discount; deriving the middle line closes that hole
  // for base-currency invoices too.)
  const baseRevenue = subtractMoney(captured.baseTotal, captured.baseTaxAmount, session.orgCurrency);

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

    // The ledger holds BASE currency only.
    const lines: { accountId: number; debit: string; credit: string }[] = [
      { accountId: ar.id, debit: captured.baseTotal, credit: "0" },
      { accountId: revenue.id, debit: "0", credit: baseRevenue },
    ];
    if (Number(captured.baseTaxAmount) > 0) {
      lines.push({ accountId: vatPayable.id, debit: "0", credit: captured.baseTaxAmount });
    }
    await tx.insert(journalLinesTable).values(lines.map((l) => ({ journalEntryId: entry.id, ...l })));

    await tx
      .update(salesInvoicesTable)
      .set({
        status: "sent",
        exchangeRate: captured.exchangeRate,
        baseTotal: captured.baseTotal,
        baseTaxAmount: captured.baseTaxAmount,
        // paidAmount is zero at send (payments only follow a sent invoice), so its base twin is too.
        basePaidAmount: roundMoney(0, session.orgCurrency),
        updatedAt: new Date(),
      })
      .where(eq(salesInvoicesTable.id, invoiceId));
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
      // No currency here, deliberately: a delivery challan is quantity-only and carries no
      // money, so there is nothing for a currency to qualify.
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
        imageUrl: it.imageUrl,
        unit: it.unit,
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

// Batch A4 — void a posted, unpaid invoice: the exact reversal of sendInvoiceAction, in one
// transaction. Restores stock and posts a reversing journal entry that mirrors the original
// posting entry line for line (FX-6), then marks the invoice void. The lifecycle rule refuses
// void once any payment exists (partially_paid / paid — correct those with a Credit Note) and
// refuses a second void (a void invoice is terminal), so no double-reversal is possible.
export async function voidInvoiceAction(invoiceId: number): Promise<ActionResult> {
  const session = await requireSession();
  const [invoice] = await db.select().from(salesInvoicesTable).where(and(eq(salesInvoicesTable.id, invoiceId), eq(salesInvoicesTable.orgId, session.orgId)));
  if (!invoice) return { error: "Invoice not found." };

  const hasPayments = Number(invoice.paidAmount) > 0;
  const decision = evaluate("sales_invoice", invoice.status, "void", { hasPayments });
  if (!decision.allowed) return { error: decision.reason };

  const items = await db.select().from(salesInvoiceItemsTable).where(eq(salesInvoiceItemsTable.invoiceId, invoiceId));
  // No chart-of-accounts lookup here any more: the reversal mirrors the posting entry's own
  // lines, so the accounts come from what was actually posted.

  await db.transaction(async (tx) => {
    for (const item of items) {
      if (item.productId) {
        await tx
          .update(productsTable)
          .set({ quantityOnHand: sql`${productsTable.quantityOnHand} + ${Math.trunc(Number(item.quantity))}` })
          .where(and(eq(productsTable.id, item.productId), eq(productsTable.orgId, session.orgId)));
      }
    }

    // FX-6: the reversal MIRRORS the posting entry's own stored lines instead of recomputing from
    // the document. That is what "reverse at the stored rate" means made literal — whatever was
    // posted (today's base-currency figures, a pre-FX-6 foreign posting at face value, a
    // discounted invoice) is negated line for line, so the reversal balances iff the original did
    // and a rate entered since the posting can never leak in. A document with NO posting entry
    // (fixtures inserted as "sent" by SQL) reverses nothing — the old code recomputed from the
    // document's columns here and, fed one inconsistent fixture, wrote eleven one-sided entries
    // into the dev ledger before anyone noticed.
    const [posting] = await tx
      .select({ id: journalEntriesTable.id })
      .from(journalEntriesTable)
      .where(and(
        eq(journalEntriesTable.orgId, session.orgId),
        eq(journalEntriesTable.sourceType, "sales_invoice"),
        eq(journalEntriesTable.sourceId, invoice.id),
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
          memo: `Invoice ${invoice.invoiceNumber} voided (reversal)`,
          sourceType: "sales_invoice",
          sourceId: invoice.id,
          createdById: session.userId,
        })
        .returning({ id: journalEntriesTable.id });

      await tx.insert(journalLinesTable).values(
        originalLines.map((l) => ({ journalEntryId: entry.id, accountId: l.accountId, debit: l.credit, credit: l.debit })),
      );
    }

    await tx.update(salesInvoicesTable).set({ status: "void", updatedAt: new Date() }).where(eq(salesInvoicesTable.id, invoiceId));
  });

  await logActivity(session, { type: "sales_invoice.voided", description: `Voided invoice ${invoice.invoiceNumber} — reversed ledger entry and restored stock`, entityType: "sales_invoice", entityId: invoiceId });
  revalidatePath(PATH);
  revalidatePath(`/sales/invoices/${invoiceId}`);
  revalidatePath("/finance/chart-of-accounts");
  revalidatePath("/finance/ledger");
  revalidatePath("/finance/reports");
  revalidatePath("/inventory/products");
  revalidatePath("/dashboard");
  return {};
}
