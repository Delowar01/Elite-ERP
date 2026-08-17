"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  paymentsTable,
  salesInvoicesTable,
  proformaInvoicesTable,
  purchaseOrdersTable,
  bankAccountsTable,
  accountsTable,
  journalEntriesTable,
  journalLinesTable,
  advanceApplicationsTable,
} from "@/db";
import { requireSession, requireRole } from "@/lib/session";
import { moneyEpsilon, roundMoney } from "@/lib/currency/currencies";
import { capturePaymentBase, fxLine } from "@/lib/payment-currency";
import { resolveRate, MissingExchangeRateError } from "@/lib/exchange-rates";
import { subtractMoney } from "@/lib/posting-currency";
import { lockAdvanceAndReadPot, availabilityOf, carriedBaseFor } from "@/lib/advance-allocations";
import { logActivity } from "@/lib/activity";
import { recordAudit } from "@/lib/security/audit";

export type ActionResult = {
  error?: string;
  /** Set when the block is a missing payment-date rate — the one-click fetch seam (FX-3). */
  missingRate?: { currency: string; date: string };
};

// fxLine (the derived realized-FX journal line) moved to @/lib/payment-currency when advance
// applications gained the same construction — one implementation for every clearing path.

const PATH = "/finance/payments";

/**
 * FX-7: the Record Payment dialog's pre-fill — the rate on file for this currency at a payment
 * date (most recent on or before). Read-only and org-scoped via the session; returns null when no
 * rate exists, which the dialog renders as an empty received-amount field for the user to fill —
 * a typed figure IS the rate, so nothing blocks on a lookup the user can supersede.
 */
export async function resolvePaymentRateAction(
  currency: string,
  date: string,
): Promise<{ rate: string; source: string } | null> {
  const session = await requireSession();
  const cur = currency.trim().toUpperCase();
  if (!cur || !date || cur === session.orgCurrency.toUpperCase()) return null;
  try {
    const resolved = await resolveRate({
      orgId: session.orgId, baseCurrency: session.orgCurrency, fromCurrency: cur, date,
    });
    return { rate: resolved.rate, source: resolved.source };
  } catch (e) {
    if (e instanceof MissingExchangeRateError) return null;
    throw e;
  }
}

// Mirrors sendInvoiceAction / receivePurchaseOrderAction's transactional shape: one journal
// entry posted alongside the paidAmount/status update, in the same transaction, so a failure
// partway through never leaves the payment recorded without its ledger impact (or vice versa).
export async function recordPaymentAction(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const direction = String(formData.get("direction") ?? "");
  const sourceId = Number(formData.get("sourceId"));
  const bankAccountId = Number(formData.get("bankAccountId"));
  const amount = Number(formData.get("amount"));
  const paymentDate = String(formData.get("paymentDate") ?? "");
  const method = String(formData.get("method") ?? "") || null;
  const reference = String(formData.get("reference") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  // "invoice" | "proforma" | "po". Defaulted from direction for backward compatibility.
  const sourceType = String(formData.get("sourceType") ?? "") || (direction === "in" ? "invoice" : "po");
  // FX-7: the user-typed received figure in BASE currency. The dialog sends it only when the user
  // edited the field — an untouched pre-fill is omitted, so the server resolves the rate itself
  // and records the rate row's own source. A typed figure IS the rate; nothing looks one up.
  const baseReceivedRaw = String(formData.get("baseReceived") ?? "").trim();
  const baseReceived = baseReceivedRaw === "" ? null : Number(baseReceivedRaw);

  if (direction !== "in" && direction !== "out") return { error: "Invalid payment direction." };
  if (!sourceId) return { error: direction === "in" ? "Choose an invoice." : "Choose a purchase order." };
  if (!bankAccountId) return { error: "Choose a bank account." };
  if (!paymentDate) return { error: "Payment date is required." };
  if (!amount || amount <= 0) return { error: "Amount must be greater than zero." };
  if (baseReceived !== null && (!Number.isFinite(baseReceived) || baseReceived <= 0)) {
    return { error: "The received amount in base currency must be greater than zero." };
  }

  const [bankAccount] = await db
    .select()
    .from(bankAccountsTable)
    .where(and(eq(bankAccountsTable.id, bankAccountId), eq(bankAccountsTable.orgId, session.orgId)));
  if (!bankAccount) return { error: "Bank account not found." };

  const accounts = await db.select().from(accountsTable).where(eq(accountsTable.orgId, session.orgId));
  const byCode = new Map(accounts.map((a) => [a.code, a]));

  // Payment against a Proforma Invoice (Issue #14) — same accounting shape as an invoice payment
  // (Dr bank / Cr Accounts Receivable), a single journal entry, updating the proforma's paidAmount.
  if (direction === "in" && sourceType === "proforma") {
    const [pf] = await db
      .select()
      .from(proformaInvoicesTable)
      .where(and(eq(proformaInvoicesTable.id, sourceId), eq(proformaInvoicesTable.orgId, session.orgId)));
    if (!pf) return { error: "Proforma invoice not found." };
    if (pf.convertedInvoiceId) return { error: "This proforma has been converted — record payments on the sales invoice instead." };
    if (pf.status !== "sent") return { error: "Only sent proforma invoices can receive a payment." };
    // Rounding and tolerance follow the DOCUMENT's currency; the journal lines below follow the
    // organization's base currency, because the general ledger only ever holds base amounts.
    const docCurrency = pf.currency ?? session.orgCurrency;
    const eps = moneyEpsilon(docCurrency);
    const balance = Number(pf.total) - Number(pf.paidAmount);
    if (amount > balance + eps) return { error: "Amount cannot exceed the remaining balance." };

    // CUSTOMER ADVANCES: money against a proforma is a LIABILITY — the business owes goods, not
    // cash back. It credits 2300 Customer Advances, never 1100 (a proforma never created a
    // receivable to credit; the old Cr-AR posting drove customer AR negative and broke the
    // control-account/subledger reconciliation) and never revenue (cash receipt is not revenue
    // recognition). The advance is applied Dr 2300 / Cr 1100 when the proforma converts and the
    // real invoice posts.
    const advances = byCode.get("2300");
    if (!advances) return { error: "Chart of accounts is missing a required system account (2300 Customer Advances)." };

    // §16 SAUDI ADVANCE VAT — DELIBERATELY UNRESOLVED, DO NOT GUESS. If an accountant ever
    // confirms that receiving an advance creates the VAT tax point (two questions are open — see
    // docs/backlog.md), the posting belongs HERE: a Cr 2100 line carved out of this receipt's
    // entry, gated by profileHasFeature(orgProfile, "advance_vat_on_receipt"). That capability is
    // OFF for every country INCLUDING Saudi Arabia, nothing reads it at runtime, and this branch
    // posts the pure non-VAT model: Dr Bank / Cr 2300, nothing else.

    // FX-7: a proforma has no booked rate (it never posts), so there is nothing to clear AGAINST —
    // the advance converts BOTH lines at the payment-date rate. Internally consistent, no FX line;
    // any realized difference materialises at application time, against the invoice's booked rate.
    const captured = await capturePaymentBase({
      orgId: session.orgId, baseCurrency: session.orgCurrency,
      docCurrency: pf.currency, amount, paymentDate, baseReceived,
    });
    if (!captured.ok) return { error: captured.error, missingRate: captured.missingRate };

    const newPaid = roundMoney(Number(pf.paidAmount) + amount, docCurrency);
    // Base-currency proformas keep basePaidAmount as paidAmount's identity mirror. Foreign ones
    // accumulate the payment-date base values, guarded: a null (unknown, pre-FX-7 history with
    // prior payments) stays null rather than absorbing a number that would understate it — but a
    // never-paid document's null genuinely means zero, so it starts accumulating from here.
    const newBasePaid =
      captured.currency === null
        ? newPaid
        : pf.basePaidAmount === null && Number(pf.paidAmount) > 0
          ? null
          : roundMoney(Number(pf.basePaidAmount ?? 0) + Number(captured.baseAmount), session.orgCurrency);

    const paymentId = await db.transaction(async (tx) => {
      const [payment] = await tx
        .insert(paymentsTable)
        .values({
          orgId: session.orgId,
          direction: "in",
          bankAccountId,
          amount: roundMoney(amount, docCurrency),
          kind: "advance_receipt",
          currency: captured.currency,
          exchangeRate: captured.exchangeRate,
          baseAmount: captured.baseAmount,
          // No booked rate to apply against — the advance's applied figure IS its received figure.
          baseAppliedAmount: captured.baseAmount,
          rateSource: captured.rateSource,
          paymentDate,
          method,
          reference,
          notes,
          proformaInvoiceId: pf.id,
          createdById: session.userId,
        })
        .returning({ id: paymentsTable.id });

      const [entry] = await tx
        .insert(journalEntriesTable)
        .values({
          orgId: session.orgId,
          entryDate: paymentDate,
          memo: `Advance received for proforma ${pf.proformaNumber}`,
          sourceType: "payment",
          sourceId: payment.id,
          createdById: session.userId,
        })
        .returning({ id: journalEntriesTable.id });

      await tx.insert(journalLinesTable).values([
        // Both lines at the payment-date rate — the ledger holds base currency only (FX-7).
        // Dr Bank / Cr 2300 Customer Advances: a liability received, not a receivable settled.
        { journalEntryId: entry.id, accountId: bankAccount.glAccountId, debit: captured.baseAmount, credit: "0" },
        { journalEntryId: entry.id, accountId: advances.id, debit: "0", credit: captured.baseAmount },
      ]);

      await tx
        .update(proformaInvoicesTable)
        .set({ paidAmount: newPaid, basePaidAmount: newBasePaid, updatedAt: new Date() })
        .where(eq(proformaInvoicesTable.id, pf.id));
      return payment.id;
    });

    await logActivity(session, { type: "payment.recorded", description: `Recorded a payment of ${roundMoney(amount, docCurrency)} for proforma ${pf.proformaNumber}`, entityType: "payment", entityId: paymentId });
    await recordAudit({ orgId: session.orgId, userId: session.userId, userName: session.name }, {
      action: "payment.created", entityType: "payment", entityId: paymentId,
      newValue: { amount: roundMoney(amount, docCurrency), proformaInvoiceId: pf.id, bankAccountId, method },
    });
    revalidatePath(PATH);
    revalidatePath("/finance/bank-accounts");
    revalidatePath("/finance/chart-of-accounts");
    revalidatePath("/finance/ledger");
    revalidatePath("/finance/reports");
    revalidatePath("/sales/proforma");
    revalidatePath(`/sales/proforma/${pf.id}`);
    revalidatePath("/dashboard");
    return {};
  }

  if (direction === "in") {
    const [invoice] = await db
      .select()
      .from(salesInvoicesTable)
      .where(and(eq(salesInvoicesTable.id, sourceId), eq(salesInvoicesTable.orgId, session.orgId)));
    if (!invoice) return { error: "Invoice not found." };
    if (invoice.status !== "sent" && invoice.status !== "partially_paid") {
      return { error: "Only sent or partially paid invoices can receive a payment." };
    }
    const docCurrency = invoice.currency ?? session.orgCurrency;
    const eps = moneyEpsilon(docCurrency);
    const balance = Number(invoice.total) - Number(invoice.paidAmount);
    if (amount > balance + eps) return { error: "Amount cannot exceed the remaining balance." };

    const ar = byCode.get("1100");
    if (!ar) return { error: "Chart of accounts is missing a required system account (1100)." };

    const captured = await capturePaymentBase({
      orgId: session.orgId, baseCurrency: session.orgCurrency,
      docCurrency: invoice.currency, amount, paymentDate, baseReceived,
    });
    if (!captured.ok) return { error: captured.error, missingRate: captured.missingRate };

    const newPaid = roundMoney(Number(invoice.paidAmount) + amount, docCurrency);
    const newStatus = Number(newPaid) >= Number(invoice.total) - eps ? "paid" : "partially_paid";

    // What the invoice is credited with, at its BOOKED rate — the AR line. The closing payment's
    // figure is DERIVED (baseTotal − basePaidAmount), never converted again, so a fully paid
    // invoice lands at exactly basePaidAmount === baseTotal with no accumulated rounding drift.
    let baseApplied: string;
    if (captured.currency === null) {
      baseApplied = captured.baseAmount;
    } else {
      if (invoice.exchangeRate === null || invoice.baseTotal === null) {
        // A foreign invoice with no stored conversion (pre-FX-6 history). Its AR was never booked
        // in base, so there is no figure to clear against — an honest refusal, not a guess.
        return { error: "This invoice has no stored base-currency conversion, so a payment cannot be applied against it." };
      }
      baseApplied =
        newStatus === "paid"
          ? subtractMoney(invoice.baseTotal, invoice.basePaidAmount ?? "0", session.orgCurrency)
          : roundMoney(amount * Number(invoice.exchangeRate), session.orgCurrency);
    }
    const newBasePaid =
      captured.currency === null
        ? newPaid
        : invoice.basePaidAmount === null && Number(invoice.paidAmount) > 0
          ? null
          : roundMoney(Number(invoice.basePaidAmount ?? 0) + Number(baseApplied), session.orgCurrency);

    const fx = fxLine({
      baseAmount: captured.baseAmount, baseApplied, direction: "in",
      baseCurrency: session.orgCurrency, fxAccountId: byCode.get("4900")?.id ?? -1,
    });
    if (fx && !byCode.get("4900")) {
      return { error: "Chart of accounts is missing a required system account (4900 Exchange Gain/Loss)." };
    }

    const invPaymentId = await db.transaction(async (tx) => {
      const [payment] = await tx
        .insert(paymentsTable)
        .values({
          orgId: session.orgId,
          direction: "in",
          bankAccountId,
          amount: roundMoney(amount, docCurrency),
          currency: captured.currency,
          exchangeRate: captured.exchangeRate,
          baseAmount: captured.baseAmount,
          baseAppliedAmount: baseApplied,
          rateSource: captured.rateSource,
          paymentDate,
          method,
          reference,
          notes,
          salesInvoiceId: invoice.id,
          createdById: session.userId,
        })
        .returning({ id: paymentsTable.id });

      const [entry] = await tx
        .insert(journalEntriesTable)
        .values({
          orgId: session.orgId,
          entryDate: paymentDate,
          memo: `Payment received for invoice ${invoice.invoiceNumber}`,
          sourceType: "payment",
          sourceId: payment.id,
          createdById: session.userId,
        })
        .returning({ id: journalEntriesTable.id });

      await tx.insert(journalLinesTable).values([
        // Dr Bank at what was truly received; Cr AR at the booked rate; the difference — realized
        // FX gain/loss — is the DERIVED third line, so the entry balances by construction (FX-7).
        { journalEntryId: entry.id, accountId: bankAccount.glAccountId, debit: captured.baseAmount, credit: "0" },
        { journalEntryId: entry.id, accountId: ar.id, debit: "0", credit: baseApplied },
        ...(fx ? [{ journalEntryId: entry.id, accountId: fx.accountId, debit: fx.debit, credit: fx.credit }] : []),
      ]);

      await tx
        .update(salesInvoicesTable)
        .set({ paidAmount: newPaid, basePaidAmount: newBasePaid, status: newStatus, updatedAt: new Date() })
        .where(eq(salesInvoicesTable.id, invoice.id));
      return payment.id;
    });

    await logActivity(session, {
      type: "payment.recorded",
      description: `Recorded a payment of ${roundMoney(amount, docCurrency)} for invoice ${invoice.invoiceNumber}`,
      entityType: "payment",
      entityId: invPaymentId,
    });
    await recordAudit({ orgId: session.orgId, userId: session.userId, userName: session.name }, {
      action: "payment.created", entityType: "payment", entityId: invPaymentId,
      newValue: { amount: roundMoney(amount, docCurrency), salesInvoiceId: invoice.id, bankAccountId, method },
    });
    revalidatePath(PATH);
    revalidatePath("/finance/bank-accounts");
    revalidatePath("/finance/chart-of-accounts");
    revalidatePath("/finance/ledger");
    revalidatePath("/finance/reports");
    revalidatePath("/sales/invoices");
    revalidatePath(`/sales/invoices/${invoice.id}`);
    revalidatePath("/dashboard");
    return {};
  }

  const [po] = await db
    .select()
    .from(purchaseOrdersTable)
    .where(and(eq(purchaseOrdersTable.id, sourceId), eq(purchaseOrdersTable.orgId, session.orgId)));
  if (!po) return { error: "Purchase order not found." };
  if (po.status !== "received") return { error: "Only received purchase orders can be paid." };
  const poCurrency = po.currency ?? session.orgCurrency;
  const poEps = moneyEpsilon(poCurrency);
  const balance = Number(po.total) - Number(po.paidAmount);
  if (amount > balance + poEps) return { error: "Amount cannot exceed the remaining balance." };

  const ap = byCode.get("2000");
  if (!ap) return { error: "Chart of accounts is missing a required system account (2000)." };

  const captured = await capturePaymentBase({
    orgId: session.orgId, baseCurrency: session.orgCurrency,
    docCurrency: po.currency, amount, paymentDate, baseReceived,
  });
  if (!captured.ok) return { error: captured.error, missingRate: captured.missingRate };

  const newPaid = roundMoney(Number(po.paidAmount) + amount, poCurrency);
  const closing = Number(newPaid) >= Number(po.total) - poEps;

  // What the PO is debited against AP, at its BOOKED (receipt-time) rate; the closing payment's
  // figure is derived so basePaidAmount lands at exactly baseTotal. Same construction as invoices.
  let baseApplied: string;
  if (captured.currency === null) {
    baseApplied = captured.baseAmount;
  } else {
    if (po.exchangeRate === null || po.baseTotal === null) {
      return { error: "This purchase order has no stored base-currency conversion, so a payment cannot be applied against it." };
    }
    baseApplied = closing
      ? subtractMoney(po.baseTotal, po.basePaidAmount ?? "0", session.orgCurrency)
      : roundMoney(amount * Number(po.exchangeRate), session.orgCurrency);
  }
  const newBasePaid =
    captured.currency === null
      ? newPaid
      : po.basePaidAmount === null && Number(po.paidAmount) > 0
        ? null
        : roundMoney(Number(po.basePaidAmount ?? 0) + Number(baseApplied), session.orgCurrency);

  const fx = fxLine({
    baseAmount: captured.baseAmount, baseApplied, direction: "out",
    baseCurrency: session.orgCurrency, fxAccountId: byCode.get("4900")?.id ?? -1,
  });
  if (fx && !byCode.get("4900")) {
    return { error: "Chart of accounts is missing a required system account (4900 Exchange Gain/Loss)." };
  }

  const poPaymentId = await db.transaction(async (tx) => {
    const [payment] = await tx
      .insert(paymentsTable)
      .values({
        orgId: session.orgId,
        direction: "out",
        bankAccountId,
        amount: roundMoney(amount, poCurrency),
        currency: captured.currency,
        exchangeRate: captured.exchangeRate,
        baseAmount: captured.baseAmount,
        baseAppliedAmount: baseApplied,
        rateSource: captured.rateSource,
        paymentDate,
        method,
        reference,
        notes,
        purchaseOrderId: po.id,
        createdById: session.userId,
      })
      .returning({ id: paymentsTable.id });

    const [entry] = await tx
      .insert(journalEntriesTable)
      .values({
        orgId: session.orgId,
        entryDate: paymentDate,
        memo: `Payment made for purchase order ${po.poNumber}`,
        sourceType: "payment",
        sourceId: payment.id,
        createdById: session.userId,
      })
      .returning({ id: journalEntriesTable.id });

    await tx.insert(journalLinesTable).values([
      // Dr AP at the booked rate; Cr Bank at what was truly paid; the difference is the derived
      // realized-FX line, so the entry balances by construction (FX-7).
      { journalEntryId: entry.id, accountId: ap.id, debit: baseApplied, credit: "0" },
      { journalEntryId: entry.id, accountId: bankAccount.glAccountId, debit: "0", credit: captured.baseAmount },
      ...(fx ? [{ journalEntryId: entry.id, accountId: fx.accountId, debit: fx.debit, credit: fx.credit }] : []),
    ]);

    await tx
      .update(purchaseOrdersTable)
      .set({ paidAmount: newPaid, basePaidAmount: newBasePaid, updatedAt: new Date() })
      .where(eq(purchaseOrdersTable.id, po.id));
    return payment.id;
  });

  await logActivity(session, {
    type: "payment.recorded",
    description: `Recorded a payment of ${roundMoney(amount, poCurrency)} for purchase order ${po.poNumber}`,
    entityType: "payment",
    entityId: poPaymentId,
  });
  await recordAudit({ orgId: session.orgId, userId: session.userId, userName: session.name }, {
    action: "payment.created", entityType: "payment", entityId: poPaymentId,
    newValue: { amount: roundMoney(amount, poCurrency), purchaseOrderId: po.id, bankAccountId, method },
  });
  revalidatePath(PATH);
  revalidatePath("/finance/bank-accounts");
  revalidatePath("/finance/chart-of-accounts");
  revalidatePath("/finance/ledger");
  revalidatePath("/finance/reports");
  revalidatePath("/purchasing/orders");
  revalidatePath(`/purchasing/orders/${po.id}`);
  revalidatePath("/dashboard");
  return {};
}

/**
 * Refund a customer advance, in whole or in part (§10): Dr 2300 Customer Advances / Cr Bank — the
 * liability is returned as cash, and neither AR nor revenue moves (the advance never touched
 * either).
 *
 * ## Partial, and allocation-aware
 *
 * What can be refunded is what is AVAILABLE: the receipt less what allocations still consume and
 * less what earlier refunds already returned. A 10,000 advance with 8,000 applied to an invoice can
 * refund 2,000 — the old rule (any application at all blocks the refund, and one refund per
 * receipt) belonged to the whole-payment model and would strand the client's own money.
 * Availability is read INSIDE the advance's row lock, so two refunds racing for the same 2,000
 * serialise and the loser sees what the winner left.
 *
 * ## The FX shape, which changed
 *
 * A refund is a real cash payment out. It was previously posted at the advance's CARRIED value on
 * both lines, which is right for 2300 and wrong for the bank: if the rate moved since receipt, the
 * bank pays a different base amount than the liability was carried at, and the difference is
 * realized FX. It was the one cash movement in the system booked at a stale rate.
 *
 * ```text
 * Dr 2300  at the advance's carried value (apportioned, exact residual when this empties it)
 * Cr Bank  at what the bank ACTUALLY paid out
 * 4900     the derived difference — realized gain or loss
 * ```
 *
 * The payout figure follows the received-amount pattern in reverse: the caller may state what the
 * bank actually paid in base currency, and the effective rate is derived from it. Omitted, it is
 * converted at the payout DATE's rate, which is the model's rule for a cash event — never the
 * receipt's rate, which belongs to a different day.
 *
 * `rateSource` now records the payout's own provenance rather than copying the receipt's, which
 * claimed a rate lookup that never happened for this movement.
 *
 * Owner/admin only, same as deleting financial records.
 */
export async function refundAdvanceAction(
  paymentId: number,
  opts?: {
    bankAccountId?: number;
    /** Document-currency amount to refund. Omitted = the whole available balance. */
    amount?: string;
    /** What the bank actually paid out, in base currency. Omitted = the payout date's rate. */
    basePaidOut?: string;
  },
): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const [receipt] = await db
    .select()
    .from(paymentsTable)
    .where(and(eq(paymentsTable.id, paymentId), eq(paymentsTable.orgId, session.orgId)));
  if (!receipt) return { error: "Payment not found." };
  if (receipt.kind !== "advance_receipt") return { error: "Only customer advance receipts can be refunded." };

  // Money goes back the way it came unless another org bank account is chosen explicitly.
  const refundBankId = opts?.bankAccountId ?? receipt.bankAccountId;
  const [bankAccount] = await db
    .select()
    .from(bankAccountsTable)
    .where(and(eq(bankAccountsTable.id, refundBankId), eq(bankAccountsTable.orgId, session.orgId)));
  if (!bankAccount) return { error: "Bank account not found." };

  const accounts = await db.select().from(accountsTable).where(eq(accountsTable.orgId, session.orgId));
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const advances = byCode.get("2300");
  if (!advances) return { error: "Chart of accounts is missing a required system account (2300 Customer Advances)." };

  const docCurrency = receipt.currency ?? session.orgCurrency;
  const eps = moneyEpsilon(docCurrency);
  const today = new Date().toISOString().slice(0, 10);
  const [pf] = receipt.proformaInvoiceId
    ? await db.select().from(proformaInvoicesTable).where(and(eq(proformaInvoicesTable.id, receipt.proformaInvoiceId), eq(proformaInvoicesTable.orgId, session.orgId)))
    : [];

  const outcome = await db.transaction(async (tx) => {
    const locked = await lockAdvanceAndReadPot(tx, { orgId: session.orgId, advancePaymentId: paymentId });
    if (!locked) {
      // A pre-FX-7 foreign receipt stored no base value, so there is no carried figure to release.
      return { error: "This advance has no stored base-currency value (it was recorded before currency capture), so it cannot be refunded. Delete and re-record it first." } as const;
    }
    const { availableAmount } = availabilityOf(locked.pot, session.orgCurrency);
    if (Number(availableAmount) <= eps) {
      // Nothing is available — but the REASON matters to whoever clicked, so it is read from the
      // two things that consume an advance rather than reported as a bare unavailability.
      const [applied] = await tx
        .select({ n: sql<string>`coalesce(sum(${advanceApplicationsTable.appliedAmount}), 0)::text` })
        .from(advanceApplicationsTable)
        .where(and(
          eq(advanceApplicationsTable.orgId, session.orgId),
          eq(advanceApplicationsTable.advancePaymentId, receipt.id),
          isNull(advanceApplicationsTable.releasedAt),
        ));
      if (Number(applied?.n ?? 0) > 0) {
        return { error: "This advance has been applied to a sales invoice and can no longer be refunded." } as const;
      }
      return { error: "This advance has already been refunded." } as const;
    }

    const requested = opts?.amount === undefined ? availableAmount : roundMoney(opts.amount, docCurrency);
    if (!Number.isFinite(Number(requested)) || Number(requested) <= 0) {
      return { error: "Enter a refund amount greater than zero." } as const;
    }
    if (Number(requested) > Number(availableAmount) + eps) {
      return { error: `Only ${availableAmount} of this advance is still available to refund.` } as const;
    }

    // The liability leaves at the advance's own carried value — apportioned while the advance
    // survives, the EXACT residual when this refund empties it, so a receipt consumed by any mix of
    // allocations and refunds strands nothing in 2300. A refund is a consumer of the pot like any
    // other.
    const carried = carriedBaseFor({ pot: locked.pot, drawAmount: requested, baseCurrency: session.orgCurrency });

    // What the bank actually paid, in base. A typed figure IS the rate; otherwise the payout date's.
    const captured = await capturePaymentBase({
      orgId: session.orgId,
      baseCurrency: session.orgCurrency,
      docCurrency: receipt.currency,
      amount: Number(requested),
      paymentDate: today,
      baseReceived: opts?.basePaidOut === undefined || opts.basePaidOut.trim() === "" ? null : Number(opts.basePaidOut),
    });
    if (!captured.ok) return { error: captured.error, missingRate: captured.missingRate } as const;

    // Dr 2300 at carried, Cr Bank at paid-out, 4900 takes the difference — the same construction a
    // purchase-order payment uses, which is what makes this a normal cash movement rather than a
    // special case.
    const fx = fxLine({
      baseAmount: captured.baseAmount, baseApplied: carried, direction: "out",
      baseCurrency: session.orgCurrency, fxAccountId: byCode.get("4900")?.id ?? -1,
    });
    if (fx && !byCode.get("4900")) {
      return { error: "Chart of accounts is missing a required system account (4900 Exchange Gain/Loss)." } as const;
    }

    const [refund] = await tx
      .insert(paymentsTable)
      .values({
        orgId: session.orgId,
        direction: "out",
        bankAccountId: bankAccount.id,
        amount: requested,
        kind: "advance_refund",
        refundsPaymentId: receipt.id,
        currency: captured.currency,
        exchangeRate: captured.exchangeRate,
        // baseAmount is the CASH (what left the bank); baseAppliedAmount is the LIABILITY released
        // (what 2300 was carrying). They differ by the realized FX, and the pot reads the second —
        // so a refund consumes exactly what it relieved, never what it happened to cost.
        baseAmount: captured.baseAmount,
        baseAppliedAmount: carried,
        rateSource: captured.rateSource,
        paymentDate: today,
        method: receipt.method,
        reference: receipt.reference,
        proformaInvoiceId: receipt.proformaInvoiceId,
        createdById: session.userId,
      })
      .returning({ id: paymentsTable.id });

    const [entry] = await tx
      .insert(journalEntriesTable)
      .values({
        orgId: session.orgId,
        entryDate: today,
        memo: pf ? `Advance refunded for proforma ${pf.proformaNumber}` : "Customer advance refunded",
        sourceType: "payment",
        sourceId: refund.id,
        createdById: session.userId,
      })
      .returning({ id: journalEntriesTable.id });

    await tx.insert(journalLinesTable).values([
      // Never AR, never revenue — the advance touched neither coming in, and touches neither going out.
      { journalEntryId: entry.id, accountId: advances.id, debit: carried, credit: "0" },
      { journalEntryId: entry.id, accountId: bankAccount.glAccountId, debit: "0", credit: captured.baseAmount },
      ...(fx ? [{ journalEntryId: entry.id, accountId: fx.accountId, debit: fx.debit, credit: fx.credit }] : []),
    ]);

    // The proforma's paid figures track the NET advance held against it, so a refund releases what
    // it returned — the document amount refunded, and the CARRIED base it relieved (not the cash,
    // which includes an FX difference the proforma never booked).
    if (pf) {
      const pfCurrency = pf.currency ?? session.orgCurrency;
      const newPaid = roundMoney(Math.max(0, Number(pf.paidAmount) - Number(requested)), pfCurrency);
      const newBasePaid = pf.basePaidAmount === null
        ? null
        : roundMoney(Math.max(0, Number(pf.basePaidAmount) - Number(carried)), session.orgCurrency);
      await tx
        .update(proformaInvoicesTable)
        .set({ paidAmount: newPaid, basePaidAmount: pfCurrency.toUpperCase() === session.orgCurrency.toUpperCase() ? newPaid : newBasePaid, updatedAt: new Date() })
        .where(eq(proformaInvoicesTable.id, pf.id));
    }
    return { refundId: refund.id, amount: requested, carried, paidOut: captured.baseAmount } as const;
  });

  if ("error" in outcome) return { error: outcome.error, missingRate: outcome.missingRate };

  await logActivity(session, {
    type: "payment.recorded",
    description: pf
      ? `Refunded a customer advance of ${outcome.amount} for proforma ${pf.proformaNumber}`
      : `Refunded a customer advance of ${outcome.amount}`,
    entityType: "payment",
    entityId: outcome.refundId,
  });
  await recordAudit({ orgId: session.orgId, userId: session.userId, userName: session.name }, {
    action: "payment.created", entityType: "payment", entityId: outcome.refundId,
    newValue: {
      kind: "advance_refund", refundsPaymentId: receipt.id, amount: outcome.amount,
      carried: outcome.carried, paidOut: outcome.paidOut, bankAccountId: bankAccount.id,
    },
  });
  revalidatePath(PATH);
  revalidatePath("/finance/bank-accounts");
  revalidatePath("/finance/chart-of-accounts");
  revalidatePath("/finance/ledger");
  revalidatePath("/finance/reports");
  revalidatePath("/sales/proforma");
  if (receipt.proformaInvoiceId) revalidatePath(`/sales/proforma/${receipt.proformaInvoiceId}`);
  revalidatePath("/dashboard");
  return {};
}

/**
 * What is left of an advance, for the Refund dialog — the same figures the action recomputes under
 * its lock, so the dialog can pre-fill rather than guess. Read-only, so no lock is taken here; the
 * action is the authority and refuses anything the pre-fill got wrong.
 */
export async function advanceAvailabilityAction(paymentId: number): Promise<{
  available: string; carried: string; currency: string | null;
} | null> {
  // The org comes from the SESSION, never from an argument — every export of a "use server" module
  // is callable by anyone holding its action id.
  const session = await requireSession();
  const [receipt] = await db
    .select()
    .from(paymentsTable)
    .where(and(eq(paymentsTable.id, paymentId), eq(paymentsTable.orgId, session.orgId)));
  if (!receipt || receipt.kind !== "advance_receipt") return null;
  const read = await db.transaction((tx) => lockAdvanceAndReadPot(tx, { orgId: session.orgId, advancePaymentId: paymentId }));
  if (!read) return null;
  const { availableAmount, availableCarried } = availabilityOf(read.pot, session.orgCurrency);
  return { available: availableAmount, carried: availableCarried, currency: receipt.currency };
}

// Delete a payment and reverse its accounting in one transaction: remove the payment's journal
// entry + lines, decrement the source document's paidAmount (recomputing an invoice's status), then
// delete the payment. Gated to owner/admin (deleting financial records) and audit-logged.
export async function deletePaymentAction(paymentId: number): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const [payment] = await db
    .select()
    .from(paymentsTable)
    .where(and(eq(paymentsTable.id, paymentId), eq(paymentsTable.orgId, session.orgId)));
  if (!payment) return { error: "Payment not found." };

  // An APPLIED advance is settled history: its receipt entry (Dr Bank / Cr 2300) and its
  // application entry (Dr 2300 / Cr 1100, keyed advance_application) both stand behind a posted
  // invoice's basePaidAmount. Deleting the receipt would orphan the application and corrupt both
  // control accounts, so it is refused outright — corrections go through a credit note or a
  // manual journal. Unapplied advances (still on the proforma, or left behind by the §10 cap)
  // delete cleanly as before.
  if (payment.kind === "advance_receipt") {
    // Any ACTIVE allocation stands behind a posted invoice's basePaidAmount; deleting the receipt
    // under it would orphan the allocation and corrupt both control accounts. A partially applied
    // advance is just as unsafe as a fully applied one, which `salesInvoiceId` could not express.
    const [live] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(advanceApplicationsTable)
      .where(and(
        eq(advanceApplicationsTable.orgId, session.orgId),
        eq(advanceApplicationsTable.advancePaymentId, payment.id),
        isNull(advanceApplicationsTable.releasedAt),
      ));
    if ((live?.n ?? 0) > 0) {
      return { error: "This advance has been applied to a sales invoice and can no longer be deleted. Correct it with a credit note or a manual journal instead." };
    }
  }
  // A refunded receipt is one half of a pair — deleting it would orphan the refund row that
  // references it. Delete the refund first (which restores the advance), then the receipt.
  if (payment.kind === "advance_receipt") {
    const [standingRefund] = await db
      .select({ id: paymentsTable.id })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.orgId, session.orgId), eq(paymentsTable.refundsPaymentId, payment.id)));
    if (standingRefund) return { error: "This advance has been refunded. Delete the refund first if you need to remove the receipt." };
  }

  const amt = Number(payment.amount);

  // FX-7: un-pay basePaidAmount from the STORED baseAppliedAmount — never a fresh conversion,
  // mirroring the never-recompute rule reversals follow everywhere. Base-currency documents keep
  // the identity (basePaidAmount === paidAmount). Deleting a pre-FX-7 payment (no stored base)
  // from a foreign document poisons basePaidAmount to null — honestly unknown beats a guess.
  const unpaidBase = (doc: { currency: string | null; basePaidAmount: string | null }, newPaid: string): string | null => {
    if ((doc.currency ?? session.orgCurrency).toUpperCase() === session.orgCurrency.toUpperCase()) return newPaid;
    if (payment.baseAppliedAmount === null) return null;
    if (doc.basePaidAmount === null) return null;
    return roundMoney(Math.max(0, Number(doc.basePaidAmount) - Number(payment.baseAppliedAmount)), session.orgCurrency);
  };

  await db.transaction(async (tx) => {
    // Remove the single journal posting for this payment.
    const entries = await tx
      .select({ id: journalEntriesTable.id })
      .from(journalEntriesTable)
      .where(and(eq(journalEntriesTable.orgId, session.orgId), eq(journalEntriesTable.sourceType, "payment"), eq(journalEntriesTable.sourceId, payment.id)));
    for (const e of entries) {
      await tx.delete(journalLinesTable).where(eq(journalLinesTable.journalEntryId, e.id));
      await tx.delete(journalEntriesTable).where(eq(journalEntriesTable.id, e.id));
    }

    if (payment.salesInvoiceId) {
      const [inv] = await tx.select().from(salesInvoicesTable).where(eq(salesInvoicesTable.id, payment.salesInvoiceId));
      if (inv) {
        // Each document is un-paid in ITS OWN currency, so both the rounding and the two status
        // thresholds come from that document rather than from a fixed half-cent.
        const c = inv.currency ?? session.orgCurrency;
        const e = moneyEpsilon(c);
        const newPaid = roundMoney(Math.max(0, Number(inv.paidAmount) - amt), c);
        const newStatus = Number(newPaid) <= e ? "sent" : Number(newPaid) >= Number(inv.total) - e ? "paid" : "partially_paid";
        await tx
          .update(salesInvoicesTable)
          .set({ paidAmount: newPaid, basePaidAmount: unpaidBase(inv, newPaid), status: newStatus, updatedAt: new Date() })
          .where(eq(salesInvoicesTable.id, inv.id));
      }
    } else if (payment.proformaInvoiceId) {
      const [pf] = await tx.select().from(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, payment.proformaInvoiceId));
      if (pf) {
        // Deleting a RECEIPT un-pays the proforma; deleting a REFUND restores the advance the
        // refund had released — the proforma's paid figures track the NET advance held, so the
        // signs are opposite. Same stored-figure arithmetic either way.
        const restore = payment.kind === "advance_refund";
        const c = pf.currency ?? session.orgCurrency;
        const newPaid = roundMoney(Math.max(0, Number(pf.paidAmount) + (restore ? amt : -amt)), c);
        let newBase: string | null;
        if (c.toUpperCase() === session.orgCurrency.toUpperCase()) newBase = newPaid;
        else if (payment.baseAppliedAmount === null || pf.basePaidAmount === null) newBase = null;
        else newBase = roundMoney(Math.max(0, Number(pf.basePaidAmount) + (restore ? 1 : -1) * Number(payment.baseAppliedAmount)), session.orgCurrency);
        await tx
          .update(proformaInvoicesTable)
          .set({ paidAmount: newPaid, basePaidAmount: newBase, updatedAt: new Date() })
          .where(eq(proformaInvoicesTable.id, pf.id));
      }
    } else if (payment.purchaseOrderId) {
      const [po] = await tx.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, payment.purchaseOrderId));
      if (po) {
        const newPaid = roundMoney(Math.max(0, Number(po.paidAmount) - amt), po.currency ?? session.orgCurrency);
        await tx
          .update(purchaseOrdersTable)
          .set({ paidAmount: newPaid, basePaidAmount: unpaidBase(po, newPaid), updatedAt: new Date() })
          .where(eq(purchaseOrdersTable.id, po.id));
      }
    }

    await tx.delete(paymentsTable).where(eq(paymentsTable.id, payment.id));
  });

  await logActivity(session, { type: "payment.deleted", description: `Deleted a payment of ${roundMoney(amt, session.orgCurrency)}`, entityType: "payment", entityId: payment.id });
  await recordAudit({ orgId: session.orgId, userId: session.userId, userName: session.name }, {
    action: "payment.deleted", entityType: "payment", entityId: payment.id,
    previousValue: { amount: payment.amount, salesInvoiceId: payment.salesInvoiceId, proformaInvoiceId: payment.proformaInvoiceId, purchaseOrderId: payment.purchaseOrderId },
  });
  revalidatePath(PATH);
  revalidatePath("/finance/bank-accounts");
  revalidatePath("/finance/chart-of-accounts");
  revalidatePath("/finance/ledger");
  revalidatePath("/finance/reports");
  revalidatePath("/sales/invoices");
  revalidatePath("/sales/proforma");
  revalidatePath("/purchasing/orders");
  revalidatePath("/dashboard");
  return {};
}
