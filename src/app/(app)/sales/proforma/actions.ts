"use server";

import { revalidatePath } from "next/cache";
import { sanitizeIfHtml } from "@/lib/sanitize-html";
import { normalizeDocumentTerms, type DocumentTerm } from "../_shared/document-terms";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db, customersTable, proformaInvoicesTable, proformaInvoiceItemsTable, salesInvoicesTable, salesInvoiceItemsTable, deliveryChallansTable, deliveryChallanItemsTable, paymentsTable, accountsTable, journalEntriesTable, journalLinesTable } from "@/db";
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
import { fxLine, mils } from "@/lib/payment-currency";

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
  // §10 cap, in the DOCUMENT's currency: advances apply to the new invoice only up to its total,
  // in the order they were received, WHOLE payments only — one application per payment is what
  // lets each application carry its own advance's stored base figure (the per-payment FX shape).
  // A payment that will not fit inside the remaining balance is NOT transferred: it keeps
  // salesInvoiceId null and stays in 2300 as the customer's available advance (for a future
  // invoice or a refund — which also makes "advance available" a plain query), so AR can never be
  // over-credited. Tolerance and rounding follow the proforma's own currency: half a fils is
  // 0.0005, not 0.005.
  const convCurrency = pf.currency ?? session.orgCurrency;
  const convEps = moneyEpsilon(convCurrency);
  const ordered = [...proformaPayments].sort((a, b) =>
    a.paymentDate < b.paymentDate ? -1 : a.paymentDate > b.paymentDate ? 1 : a.id - b.id);
  const applied: typeof proformaPayments = [];
  let appliedTotal = 0;
  for (const p of ordered) {
    if (appliedTotal + Number(p.amount) <= Number(pf.total) + convEps) {
      applied.push(p);
      appliedTotal += Number(p.amount);
    }
  }
  const paidStr = roundMoney(appliedTotal, convCurrency);
  // Reflect the applied payments' status immediately (no payments → normal draft, unchanged).
  const invoiceStatus = appliedTotal <= convEps ? "draft" : appliedTotal >= Number(pf.total) - convEps ? "paid" : "partially_paid";

  const issueDate = new Date().toISOString().slice(0, 10);
  // An invoice born non-draft (it carries transferred advances) NEVER passes through send — that
  // status is a payment fact, not a posting fact — so its one posting moment is here: revenue, AR
  // and VAT post and stock decrements inside the conversion transaction, via the same shared
  // function send uses. Skipping this (as the pre-advances code did) silently dropped the revenue
  // of every advance-carrying conversion from the P&L forever. A foreign proforma with no usable
  // rate REFUSES to convert (missingRate → the one-click fetch seam) rather than posting a wrong
  // ledger; advance-free conversions still produce a plain draft and post nothing until send.
  let posting: PreparedInvoicePosting | null = null;
  if (invoiceStatus !== "draft") {
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

  // Advance applications (§7): one journal per applied payment, keyed (advance_application,
  // payment.id) — Dr 2300 at the advance's CARRIED base value (what 2300 was credited at receipt,
  // the payment-date rate), Cr 1100 at the invoice's BOOKED rate × the applied amount, difference
  // derived to 4900 — FX-7's exact construction with 2300 standing where Bank stood; the
  // application itself moves no cash. The CLOSING application is derived (baseTotal − prior
  // credits) so a fully-advanced invoice lands at basePaidAmount === baseTotal exactly, the same
  // rule as invoice payments. basePaidAmount is the sum of the AR-clearing figures, so the 1100
  // ledger and the document column agree by construction.
  type AdvanceApplication = {
    paymentId: number;
    dr2300: string;
    crAr: string;
    fx: { accountId: number; debit: string; credit: string } | null;
  };
  const applications: AdvanceApplication[] = [];
  let basePaidStr: string | null = null;
  let advAccountId = 0;
  let arAccountId = 0;
  if (applied.length > 0 && posting) {
    const accounts = await db.select().from(accountsTable).where(eq(accountsTable.orgId, session.orgId));
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const advances = byCode.get("2300");
    const arAccount = byCode.get("1100");
    if (!advances) return { error: "Chart of accounts is missing a required system account (2300 Customer Advances)." };
    if (!arAccount) return { error: "Chart of accounts is missing a required system account (1100)." };
    advAccountId = advances.id;
    arAccountId = arAccount.id;

    const bookedRate = Number(posting.captured.exchangeRate);
    const fullyAdvanced = appliedTotal >= Number(pf.total) - convEps;
    let crSumMils = 0;
    for (const [i, p] of applied.entries()) {
      // The advance's carried base value is its stored baseAppliedAmount (= its payment-date base;
      // for advances the applied figure IS the received figure). A pre-FX-7 base-currency payment
      // carries the identity; a pre-FX-7 FOREIGN payment stored no base at all, so the application
      // cannot be constructed — an honest refusal, not a guess.
      const isBase = !p.currency || p.currency.toUpperCase() === session.orgCurrency.toUpperCase();
      const carried = p.baseAppliedAmount ?? (isBase ? p.amount : null);
      if (carried === null) {
        return { error: "A transferred advance has no stored base-currency value (it was recorded before currency capture), so it cannot be applied. Delete and re-record that payment first." };
      }
      const closing = fullyAdvanced && i === applied.length - 1;
      const crAr = closing
        ? roundMoney(Number(posting.captured.baseTotal) - crSumMils / 1000, session.orgCurrency)
        : roundMoney(Number(p.amount) * bookedRate, session.orgCurrency);
      crSumMils += mils(crAr);
      const fx = fxLine({
        baseAmount: carried, baseApplied: crAr, direction: "in",
        baseCurrency: session.orgCurrency, fxAccountId: byCode.get("4900")?.id ?? -1,
      });
      if (fx && !byCode.get("4900")) {
        return { error: "Chart of accounts is missing a required system account (4900 Exchange Gain/Loss)." };
      }
      applications.push({ paymentId: p.id, dr2300: carried, crAr, fx });
    }
    basePaidStr = roundMoney(crSumMils / 1000, session.orgCurrency);
  }

  const id = await db.transaction(async (tx) => {
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
        basePaidAmount: basePaidStr,
        // A posted-at-conversion invoice stores its FX capture exactly as send would have;
        // a draft conversion leaves them null until send fills them.
        exchangeRate: posting?.captured.exchangeRate,
        baseTotal: posting?.captured.baseTotal,
        baseTaxAmount: posting?.captured.baseTaxAmount,
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

    // Transfer the APPLIED payments: re-point each to the new invoice while keeping
    // proformaInvoiceId as the origin reference. No new payment rows — each keeps its single
    // receipt posting. A §10-capped excess payment is left untouched (salesInvoiceId null): it
    // was never applied and remains the customer's available advance.
    if (applied.length > 0) {
      await tx
        .update(paymentsTable)
        .set({ salesInvoiceId: inv.id })
        .where(and(eq(paymentsTable.orgId, session.orgId), inArray(paymentsTable.id, applied.map((p) => p.id))));
    }

    // Post the born-non-draft invoice inside the same transaction — invoice, items, transferred
    // payments and the revenue/AR/VAT entry commit or roll back as one.
    if (posting) {
      await posting.post(tx, {
        invoiceId: inv.id,
        memo: `Invoice ${invoiceNumber} issued (converted from proforma ${pf.proformaNumber})`,
      });
    }

    // Apply the advances (§7) — after the invoice posting, so the AR being cleared exists. The
    // application is not cash: the money posted once, at receipt.
    for (const app of applications) {
      const [entry] = await tx
        .insert(journalEntriesTable)
        .values({
          orgId: session.orgId,
          entryDate: issueDate,
          memo: `Advance applied to invoice ${invoiceNumber} (received against proforma ${pf.proformaNumber})`,
          sourceType: "advance_application",
          sourceId: app.paymentId,
          createdById: session.userId,
        })
        .returning({ id: journalEntriesTable.id });
      await tx.insert(journalLinesTable).values([
        { journalEntryId: entry.id, accountId: advAccountId, debit: app.dr2300, credit: "0" },
        { journalEntryId: entry.id, accountId: arAccountId, debit: "0", credit: app.crAr },
        ...(app.fx ? [{ journalEntryId: entry.id, ...app.fx }] : []),
      ]);
    }

    // Link the proforma to the invoice; its payment history stays visible read-only.
    await tx.update(proformaInvoicesTable).set({ convertedInvoiceId: inv.id, updatedAt: new Date() }).where(eq(proformaInvoicesTable.id, proformaId));
    return inv.id;
  });

  await logActivity(session, {
    type: "sales_invoice.created",
    description: posting
      ? `Converted from proforma ${pf.proformaNumber} — posted to ledger and decremented stock`
      : `Converted from proforma ${pf.proformaNumber}`,
    entityType: "sales_invoice",
    entityId: id,
  });
  if (proformaPayments.length > 0) {
    const unapplied = proformaPayments.filter((p) => !applied.some((a) => a.id === p.id));
    await recordAudit({ orgId: session.orgId, userId: session.userId, userName: session.name }, {
      action: "payment.transferred", entityType: "sales_invoice", entityId: id,
      previousValue: { proformaInvoiceId: proformaId, paymentIds: proformaPayments.map((p) => p.id) },
      newValue: {
        salesInvoiceId: id,
        appliedPaymentIds: applied.map((p) => p.id),
        appliedTotal: paidStr,
        // §10: payments the cap left behind — still the customer's available advance.
        unappliedPaymentIds: unapplied.map((p) => p.id),
      },
    });
  }
  revalidatePath("/sales/invoices");
  revalidatePath("/sales/proforma");
  revalidatePath(`/sales/proforma/${proformaId}`);
  if (posting) {
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
