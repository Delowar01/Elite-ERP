"use server";

import { revalidatePath } from "next/cache";
import { sanitizeIfHtml } from "@/lib/sanitize-html";
import { normalizeDocumentTerms, type DocumentTerm } from "../_shared/document-terms";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db, customersTable, proformaInvoicesTable, proformaInvoiceItemsTable, salesInvoicesTable, salesInvoiceItemsTable, deliveryChallansTable, deliveryChallanItemsTable, paymentsTable, accountsTable, journalEntriesTable, journalLinesTable, advanceApplicationsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { recordAudit } from "@/lib/security/audit";
import { nextDocumentNumber } from "@/lib/documents";
import { can } from "@/lib/document-lifecycle";
import { computeTotals, type LineItemInput } from "../_shared/totals";
import { persistDocumentAttachments, type AttachmentInput } from "../_shared/attachment-persist";
import { snapshotDocumentBankAccounts } from "@/lib/document-bank-data";
import { snapshotSealForDoc, applySealOverride } from "@/lib/doc-seal";
import { moneyEpsilon, normalizeDocCurrency, roundMoney } from "@/lib/currency/currencies";
import { prepareInvoicePosting, type PreparedInvoicePosting } from "@/lib/invoice-posting";
import {
  lockAdvanceAndReadPot, planAllocations, sameCustomerRefusal, sameCurrencyRefusal,
  type AdvancePot,
} from "@/lib/advance-allocations";

export type ActionResult = {
  error?: string;
  id?: number;
  /** Set when a conversion's posting was blocked by a missing exchange rate — FX-3's rate-entry seam. */
  missingRate?: { currency: string; date: string };
};

const PATH = "/sales/proforma";
const VALID_STATUSES = ["draft", "sent"];

type LineInput = { productId: string; description: string; quantity: string; unitPrice: string; taxRatePercent: string; imageUrl?: string; unit?: string; customFields?: Record<string, string> };

export async function createProformaAction(
  input: {
    title: string;
    customerId: string;
    issueDate: string;
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
  if (!input.issueDate) return { error: "Issue date is required." };

  const items = input.items.filter((l) => l.description.trim() && Number(l.quantity) > 0);
  if (items.length === 0) return { error: "Add at least one line item." };

  const currency = normalizeDocCurrency(input.currency) ?? session.orgCurrency;
  const totals = computeTotals(items as LineItemInput[], input.discount, currency);
  const bankAccounts = await snapshotDocumentBankAccounts(session.orgId, input.bankAccountIds);
  const seal = applySealOverride(await snapshotSealForDoc(db, session.orgId, "proforma_invoice"), { sealUrl: input.sealUrl, signatureUrl: input.signatureUrl });

  const id = await db.transaction(async (tx) => {
    const proformaNumber = await nextDocumentNumber(tx, session.orgId, "proforma_invoice");
    const [pf] = await tx
      .insert(proformaInvoicesTable)
      .values({
        orgId: session.orgId,
        proformaNumber,
        title: input.title.trim() || null,
        customerId,
        issueDate: input.issueDate,
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
      .returning({ id: proformaInvoicesTable.id });

    await tx.insert(proformaInvoiceItemsTable).values(
      items.map((l) => ({
        proformaInvoiceId: pf.id,
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
    await persistDocumentAttachments(tx, session.orgId, session.userId, "proforma_invoice", pf.id, input.attachments);

    return pf.id;
  });

  await logActivity(session, { type: "proforma_invoice.created", description: "Created a proforma invoice", entityType: "proforma_invoice", entityId: id });
  if (andSend) {
    await updateProformaStatusAction(id, "sent");
  }
  revalidatePath(PATH);
  redirect(`/sales/proforma/${id}`);
}

// Batch A2 — draft-only edit. Preserves number/org/status/source links; recomputes totals server-side.
export async function updateProformaAction(
  id: number,
  input: { title: string; customerId: string; issueDate: string; discount: string; notes: string; terms?: DocumentTerm[]; items: LineInput[]; attachments?: AttachmentInput[]; bankAccountIds?: number[]; currency?: string; sealUrl?: string; signatureUrl?: string },
): Promise<ActionResult> {
  const session = await requireSession();
  const [existing] = await db.select().from(proformaInvoicesTable).where(and(eq(proformaInvoicesTable.id, id), eq(proformaInvoicesTable.orgId, session.orgId)));
  if (!existing) return { error: "Proforma invoice not found." };
  if (!can("proforma_invoice", existing.status, "edit")) return { error: "Only draft proforma invoices can be edited." };

  const customerId = Number(input.customerId);
  if (!customerId) return { error: "Choose a client." };
  const [customerOwned] = await db.select({ id: customersTable.id }).from(customersTable).where(and(eq(customersTable.id, customerId), eq(customersTable.orgId, session.orgId)));
  if (!customerOwned) return { error: "Client not found." };
  if (!input.issueDate) return { error: "Issue date is required." };
  const items = input.items.filter((l) => l.description.trim() && Number(l.quantity) > 0);
  if (items.length === 0) return { error: "Add at least one line item." };
  const currency = normalizeDocCurrency(input.currency) ?? session.orgCurrency;
  const totals = computeTotals(items as LineItemInput[], input.discount, currency);
  const bankAccounts = await snapshotDocumentBankAccounts(session.orgId, input.bankAccountIds);
  const seal = applySealOverride(await snapshotSealForDoc(db, session.orgId, "proforma_invoice"), { sealUrl: input.sealUrl, signatureUrl: input.signatureUrl });

  await db.transaction(async (tx) => {
    await tx
      .update(proformaInvoicesTable)
      .set({
        title: input.title.trim() || null,
        customerId,
        issueDate: input.issueDate,
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
      .where(and(eq(proformaInvoicesTable.id, id), eq(proformaInvoicesTable.orgId, session.orgId)));
    await tx.delete(proformaInvoiceItemsTable).where(eq(proformaInvoiceItemsTable.proformaInvoiceId, id));
    await tx.insert(proformaInvoiceItemsTable).values(
      items.map((l) => ({
        proformaInvoiceId: id,
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
    await persistDocumentAttachments(tx, session.orgId, session.userId, "proforma_invoice", id, input.attachments);
  });

  await logActivity(session, { type: "proforma_invoice.updated", description: `Edited draft proforma ${existing.proformaNumber}`, entityType: "proforma_invoice", entityId: id });
  revalidatePath(PATH);
  revalidatePath(`/sales/proforma/${id}`);
  redirect(`/sales/proforma/${id}`);
}

export async function updateProformaStatusAction(id: number, status: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!VALID_STATUSES.includes(status)) return { error: "Invalid status." };

  const result = await db
    .update(proformaInvoicesTable)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(proformaInvoicesTable.id, id), eq(proformaInvoicesTable.orgId, session.orgId)))
    .returning({ id: proformaInvoicesTable.id });
  if (!result.length) return { error: "Proforma invoice not found." };

  await logActivity(session, { type: "proforma_invoice.status_changed", description: `Marked proforma as ${status}`, entityType: "proforma_invoice", entityId: id });
  revalidatePath(PATH);
  revalidatePath(`/sales/proforma/${id}`);
  return {};
}

export async function convertProformaToInvoiceAction(proformaId: number): Promise<ActionResult> {
  const session = await requireSession();
  const [pf] = await db.select().from(proformaInvoicesTable).where(and(eq(proformaInvoicesTable.id, proformaId), eq(proformaInvoicesTable.orgId, session.orgId)));
  if (!pf) return { error: "Proforma invoice not found." };
  if (pf.convertedInvoiceId) return { error: "This proforma has already been converted to a sales invoice." };
  const items = await db.select().from(proformaInvoiceItemsTable).where(eq(proformaInvoiceItemsTable.proformaInvoiceId, proformaId));

  // Payments recorded against the proforma, to be transferred to the new invoice (Issue #14).
  // A refunded advance is NOT transferable value — the cash went back — so both halves of that
  // pair (the refund row and the receipt it returned) are excluded from the applicable set.
  const allProformaPayments = await db.select().from(paymentsTable).where(and(eq(paymentsTable.orgId, session.orgId), eq(paymentsTable.proformaInvoiceId, proformaId)));
  const refundedIds = new Set(allProformaPayments.filter((p) => p.kind === "advance_refund" && p.refundsPaymentId !== null).map((p) => p.refundsPaymentId));
  const proformaPayments = allProformaPayments.filter((p) => p.kind !== "advance_refund" && !refundedIds.has(p.id));
  const convCurrency = pf.currency ?? session.orgCurrency;
  const convEps = moneyEpsilon(convCurrency);
  // Consumption order is OLDEST RECEIPT FIRST and must be deterministic: with two advances taken
  // at different rates the order decides the realized FX, so an arbitrary order would make the
  // same conversion produce different numbers on different runs.
  const consumeOrder = [...proformaPayments].sort((a, b) =>
    a.paymentDate < b.paymentDate ? -1 : a.paymentDate > b.paymentDate ? 1 : a.id - b.id);
  // Whether anything CAN be applied decides whether this invoice is born posted. Real availability
  // is re-read under lock inside the transaction; this outer read only answers "prepare a
  // posting?". A stale yes is harmless (the plan comes back empty and the invoice stays a draft);
  // a stale no cannot happen, because nothing can ADD availability to these advances while this
  // proforma is unconverted.
  const roughAvailable = proformaPayments.reduce((sum, p) => sum + Number(p.amount), 0);

  const issueDate = new Date().toISOString().slice(0, 10);
  // An invoice born non-draft (it carries transferred advances) NEVER passes through send — that
  // status is a payment fact, not a posting fact — so its one posting moment is here: revenue, AR
  // and VAT post and stock decrements inside the conversion transaction, via the same shared
  // function send uses. Skipping this (as the pre-advances code did) silently dropped the revenue
  // of every advance-carrying conversion from the P&L forever. A foreign proforma with no usable
  // rate REFUSES to convert (missingRate → the one-click fetch seam) rather than posting a wrong
  // ledger; advance-free conversions still produce a plain draft and post nothing until send.
  let posting: PreparedInvoicePosting | null = null;
  if (roughAvailable > convEps) {
    const prep = await prepareInvoicePosting({
      orgId: session.orgId,
      userId: session.userId,
      baseCurrency: session.orgCurrency,
      docCurrency: pf.currency,
      total: pf.total,
      taxTotal: pf.taxTotal,
      issueDate,
      items: items.map((it) => ({ productId: it.productId, quantity: it.quantity })),
    });
    if (!prep.ok) return { error: prep.error, missingRate: prep.missingRate };
    posting = prep;
  }

  const accounts = await db.select().from(accountsTable).where(eq(accountsTable.orgId, session.orgId));
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  if (posting && !byCode.get("2300")) return { error: "Chart of accounts is missing a required system account (2300 Customer Advances)." };
  if (posting && !byCode.get("1100")) return { error: "Chart of accounts is missing a required system account (1100)." };

  const result = await db.transaction(async (tx) => {
    // Double-submit guard on the SERVER, not only in the confirm dialog: two clicks can both pass
    // the convertedInvoiceId check above before either commits. Locking the proforma row and
    // re-reading it here makes the second one lose deterministically.
    const pfLocked = await tx.execute(sql`
      select converted_invoice_id from proforma_invoices
       where id = ${proformaId} and org_id = ${session.orgId} for update
    `);
    const pfRow = (pfLocked.rows as unknown as { converted_invoice_id: number | null }[])[0];
    if (!pfRow) return { error: "Proforma invoice not found." } as const;
    if (pfRow.converted_invoice_id) return { error: "This proforma has already been converted to a sales invoice." } as const;

    // Lock every advance BEFORE reading availability, in ASCENDING ID order so two callers can
    // never take the same pair of locks in opposite orders and deadlock. Availability read outside
    // a lock is a guess: two allocators could each see the same 2,000 as available and both spend
    // it, driving 2300 negative.
    const potById = new Map<number, AdvancePot>();
    for (const p of [...consumeOrder].sort((a, b) => a.id - b.id)) {
      const locked = await lockAdvanceAndReadPot(tx, { orgId: session.orgId, advancePaymentId: p.id });
      if (!locked) {
        // Not an advance receipt, or a pre-FX-7 foreign receipt with no stored base value — there
        // is no carried figure to release, and inventing one would misstate 2300.
        return { error: "An advance on this proforma has no stored base-currency value (it was recorded before currency capture), so it cannot be applied. Delete and re-record that payment first." } as const;
      }
      potById.set(p.id, locked.pot);
    }
    const pots = consumeOrder.map((p) => ({ paymentId: p.id, pot: potById.get(p.id)! }));

    // §5 and the same-currency rule hold by construction at conversion (the invoice IS this
    // proforma) and are checked anyway — this is the same engine that will apply an advance to a
    // DIFFERENT invoice, where neither holds for free.
    for (const p of proformaPayments) {
      const cur = sameCurrencyRefusal(p.currency, pf.currency, session.orgCurrency);
      if (cur) return { error: cur } as const;
    }
    const party = sameCustomerRefusal(pf.customerId, pf.customerId);
    if (party) return { error: party } as const;

    const planned = posting
      ? planAllocations({
          pots,
          invoice: {
            currency: pf.currency,
            exchangeRate: posting.captured.exchangeRate,
            baseTotal: posting.captured.baseTotal,
            basePaidAmount: "0",
            total: pf.total,
            paidAmount: "0",
          },
          baseCurrency: session.orgCurrency,
          advancesAccountId: byCode.get("2300")!.id,
          arAccountId: byCode.get("1100")!.id,
          fxAccountId: byCode.get("4900")?.id ?? null,
        })
      : ({ ok: true, plan: [], totalApplied: "0", totalArCleared: "0" } as const);
    if (!planned.ok) return { error: planned.error } as const;

    const paidStr = roundMoney(Number(planned.totalApplied), convCurrency);
    const willPost = planned.plan.length > 0;
    const invoiceStatus = !willPost ? "draft" : Number(paidStr) >= Number(pf.total) - convEps ? "paid" : "partially_paid";

    const invoiceNumber = await nextDocumentNumber(tx, session.orgId, "sales_invoice");
    const [inv] = await tx
      .insert(salesInvoicesTable)
      .values({
        orgId: session.orgId,
        invoiceNumber,
        title: pf.title,
        customerId: pf.customerId,
        sourceSalesOrderId: pf.sourceSalesOrderId,
        status: invoiceStatus,
        issueDate,
        // The totals below are copied verbatim, so the currency that qualifies them must
        // travel with them — dropping it re-denominates the amounts in the base currency.
        currency: pf.currency,
        subtotal: pf.subtotal,
        discount: pf.discount,
        taxTotal: pf.taxTotal,
        total: pf.total,
        paidAmount: paidStr,
        basePaidAmount: willPost ? planned.totalArCleared : null,
        // A posted-at-conversion invoice stores its FX capture exactly as send would have;
        // a draft conversion leaves them null until send fills them.
        exchangeRate: willPost ? posting!.captured.exchangeRate : null,
        baseTotal: willPost ? posting!.captured.baseTotal : null,
        baseTaxAmount: willPost ? posting!.captured.baseTaxAmount : null,
        notes: pf.notes,
        createdById: session.userId,
      })
      .returning({ id: salesInvoicesTable.id });

    if (items.length > 0) {
      await tx.insert(salesInvoiceItemsTable).values(
        items.map((it) => ({
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
    }

    // Post the born-non-draft invoice inside the same transaction — invoice, items, allocations
    // and the revenue/AR/VAT entry commit or roll back as one.
    if (willPost && posting) {
      await posting.post(tx, {
        invoiceId: inv.id,
        memo: `Invoice ${invoiceNumber} issued (converted from proforma ${pf.proformaNumber})`,
      });
    }

    // Apply the advances (§7) — AFTER the invoice posting, so the AR being cleared exists. Each
    // allocation is its own row and its own journal, keyed by the ALLOCATION and no longer by the
    // payment: one advance can now settle several invoices, so a payment id is not unique per
    // application, and keying by it would make the second application collide with the first and
    // be suppressed by the idempotency check.
    for (const step of planned.plan) {
      const [alloc] = await tx
        .insert(advanceApplicationsTable)
        .values({
          orgId: session.orgId,
          advancePaymentId: step.advancePaymentId,
          salesInvoiceId: inv.id,
          appliedAmount: step.appliedAmount,
          carriedBase: step.carriedBase,
          arCleared: step.arCleared,
          appliedDate: issueDate,
          createdById: session.userId,
        })
        .returning({ id: advanceApplicationsTable.id });
      const [entry] = await tx
        .insert(journalEntriesTable)
        .values({
          orgId: session.orgId,
          entryDate: issueDate,
          memo: `Advance applied to invoice ${invoiceNumber} (received against proforma ${pf.proformaNumber})`,
          sourceType: "advance_application",
          sourceId: alloc.id,
          createdById: session.userId,
        })
        .returning({ id: journalEntriesTable.id });
      await tx.insert(journalLinesTable).values(step.lines.map((l) => ({ journalEntryId: entry.id, ...l })));

      // Interim, until commit 8 moves the remaining readers onto allocations: a FULLY consumed
      // advance keeps the old salesInvoiceId linkage, so statements, print and project costing
      // behave exactly as before. A PARTIALLY consumed one must not be linked — that field means
      // "this whole receipt settled that invoice", which a partial draw makes untrue.
      if (step.emptiesAdvance) {
        await tx.update(paymentsTable).set({ salesInvoiceId: inv.id })
          .where(and(eq(paymentsTable.orgId, session.orgId), eq(paymentsTable.id, step.advancePaymentId)));
      }
    }

    // Link the proforma to the invoice; its payment history stays visible read-only.
    await tx.update(proformaInvoicesTable).set({ convertedInvoiceId: inv.id, updatedAt: new Date() }).where(eq(proformaInvoicesTable.id, proformaId));
    return { id: inv.id, allocations: planned.plan, posted: willPost, paidStr } as const;
  });
  if ("error" in result) return { error: result.error };
  const { id, allocations, posted } = result;

  await logActivity(session, {
    type: "sales_invoice.created",
    description: posted
      ? `Converted from proforma ${pf.proformaNumber} — posted to ledger and decremented stock`
      : `Converted from proforma ${pf.proformaNumber}`,
    entityType: "sales_invoice",
    entityId: id,
  });
  if (proformaPayments.length > 0) {
    await recordAudit({ orgId: session.orgId, userId: session.userId, userName: session.name }, {
      action: "payment.transferred", entityType: "sales_invoice", entityId: id,
      previousValue: { proformaInvoiceId: proformaId, paymentIds: proformaPayments.map((p) => p.id) },
      newValue: {
        salesInvoiceId: id,
        // Each allocation names how much of which advance settled this invoice. A partial draw is
        // now expressible, so the audit records amounts rather than a list of consumed payments —
        // "payment 12 was used" no longer says how much of it.
        allocations: allocations.map((a) => ({
          advancePaymentId: a.advancePaymentId, applied: a.appliedAmount, carriedBase: a.carriedBase, arCleared: a.arCleared,
        })),
        appliedTotal: result.paidStr,
      },
    });
  }
  revalidatePath("/sales/invoices");
  revalidatePath("/sales/proforma");
  revalidatePath(`/sales/proforma/${proformaId}`);
  if (posted) {
    // A posting happened, so the finance surfaces changed too — same set send revalidates.
    revalidatePath("/finance/chart-of-accounts");
    revalidatePath("/finance/ledger");
    revalidatePath("/finance/reports");
    revalidatePath("/inventory/products");
  }
  redirect(`/sales/invoices/${id}`);
}

export async function convertProformaToDeliveryChallanAction(proformaId: number): Promise<ActionResult> {
  const session = await requireSession();
  const [pf] = await db.select().from(proformaInvoicesTable).where(and(eq(proformaInvoicesTable.id, proformaId), eq(proformaInvoicesTable.orgId, session.orgId)));
  if (!pf) return { error: "Proforma invoice not found." };
  const items = await db.select().from(proformaInvoiceItemsTable).where(eq(proformaInvoiceItemsTable.proformaInvoiceId, proformaId));

  const id = await db.transaction(async (tx) => {
    const dcNumber = await nextDocumentNumber(tx, session.orgId, "delivery_challan");
    const [dc] = await tx
      // No currency here, deliberately: a delivery challan is quantity-only and carries no
      // money, so there is nothing for a currency to qualify.
      .insert(deliveryChallansTable)
      .values({
        orgId: session.orgId,
        dcNumber,
        title: pf.title,
        customerId: pf.customerId,
        sourceProformaId: pf.id,
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

  await logActivity(session, { type: "delivery_challan.created", description: `Converted from proforma ${pf.proformaNumber}`, entityType: "delivery_challan", entityId: id });
  revalidatePath("/sales/delivery-challans");
  redirect(`/sales/delivery-challans/${id}`);
}
