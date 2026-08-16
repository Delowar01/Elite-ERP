import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { advanceApplicationsTable, paymentsTable } from "@/db";
import { moneyEpsilon, roundMoney } from "@/lib/currency/currencies";
import { fxLine, mils } from "@/lib/payment-currency";

/**
 * The arithmetic of partial advance allocation, in one place.
 *
 * Every figure here is derived so that three things hold BY CONSTRUCTION rather than by luck:
 *
 *  1. **2300 never strands rounding.** An advance's carried base is apportioned across its
 *     consumers, and whichever consumer empties the pot takes the exact residual instead of a
 *     computed proportion. So Σ(consumed carried) === the original carried base, exactly, at the
 *     base currency's minor unit — however many partial applications and refunds it took.
 *  2. **1100 matches the invoice subledger.** An allocation credits AR by exactly the amount it
 *     adds to the invoice's `basePaidAmount`, and the allocation that closes the invoice derives
 *     its figure from `baseTotal − basePaidAmount`, so a fully-settled invoice lands on its
 *     `baseTotal` to the fils.
 *  3. **Every entry balances.** 4900 takes whatever remains between the 2300 debit and the 1100
 *     credit, so the two independent residual rules above can never unbalance an entry.
 *
 * ## Why there are TWO residual rules, not one
 *
 * An allocation sits at the intersection of one advance and one invoice, and "the last one" means
 * different things on each side: the allocation that empties the ADVANCE is rarely the one that
 * closes the INVOICE. So the 2300 side derives when it consumes the advance, the 1100 side derives
 * when it closes the invoice, both derive when a single allocation does both, and neither derives
 * when it does neither — four cases, one balancing line.
 *
 * ## Refunds are consumers too
 *
 * A partial refund draws on the same pot as an allocation, so it obeys the same apportionment and
 * can equally be the consumer that empties it. If refunds were excluded from the residual rule,
 * an advance emptied by a refund would leave a rounding tail sitting in 2300 forever.
 */

/** A receipt's pot: what it carries and what has already been drawn from it. */
export type AdvancePot = {
  /** The receipt's document-currency amount — immutable (it is the bank fact). */
  amount: string;
  /** The receipt's carried base value (its `baseAppliedAmount`). */
  carriedBase: string;
  /** Document amount already consumed by active allocations and refunds. */
  consumedAmount: string;
  /** Carried base already consumed by the same. */
  consumedCarried: string;
  /** The document currency of the advance (null = org base). */
  currency: string | null;
};

export type AdvanceAvailability = { availableAmount: string; availableCarried: string };

/** What is left of an advance, in both figures. Never negative — a negative here is a bug upstream. */
export function availabilityOf(pot: AdvancePot, baseCurrency: string): AdvanceAvailability {
  const docCurrency = pot.currency ?? baseCurrency;
  return {
    availableAmount: roundMoney(Math.max(0, Number(pot.amount) - Number(pot.consumedAmount)), docCurrency),
    availableCarried: roundMoney(Math.max(0, Number(pot.carriedBase) - Number(pot.consumedCarried)), baseCurrency),
  };
}

/**
 * The carried base a consumer takes from the pot.
 *
 * Proportional while the advance survives; the EXACT residual when this draw empties it — which is
 * what keeps Σ(consumed) equal to the original carried base with no drift, no matter how the
 * document amount was split. Applies to allocations and refunds alike.
 */
export function carriedBaseFor(args: {
  pot: AdvancePot;
  /** The document amount being drawn now. */
  drawAmount: string;
  baseCurrency: string;
}): string {
  const { pot, drawAmount, baseCurrency } = args;
  const docCurrency = pot.currency ?? baseCurrency;
  const remainingDoc = Number(pot.amount) - Number(pot.consumedAmount);
  const emptiesAdvance = Number(drawAmount) >= remainingDoc - moneyEpsilon(docCurrency);
  if (emptiesAdvance) {
    return roundMoney(Number(pot.carriedBase) - Number(pot.consumedCarried), baseCurrency);
  }
  return roundMoney((Number(drawAmount) / Number(pot.amount)) * Number(pot.carriedBase), baseCurrency);
}

/** The invoice side of an allocation: what it clears from 1100. */
export type AllocationInvoice = {
  /** The invoice's own currency (null = org base). Must match the advance's — see sameCurrency. */
  currency: string | null;
  /** Booked rate captured when the invoice posted. */
  exchangeRate: string | null;
  baseTotal: string | null;
  basePaidAmount: string | null;
  total: string;
  paidAmount: string;
};

/**
 * The base amount this allocation clears from AR: at the invoice's BOOKED rate normally, or the
 * derived remainder (`baseTotal − basePaidAmount`) when it settles the invoice — the same closing
 * construction invoice payments already use, so a fully-settled invoice lands exactly on its
 * `baseTotal` and GL 1100 equals the subledger to the fils.
 */
export function arClearedFor(args: {
  invoice: AllocationInvoice;
  applyAmount: string;
  baseCurrency: string;
}): { ok: true; arCleared: string; closesInvoice: boolean } | { ok: false; error: string } {
  const { invoice, applyAmount, baseCurrency } = args;
  const docCurrency = invoice.currency ?? baseCurrency;
  const eps = moneyEpsilon(docCurrency);
  const closesInvoice = Number(invoice.paidAmount) + Number(applyAmount) >= Number(invoice.total) - eps;

  const isBase = !invoice.currency || invoice.currency.toUpperCase() === baseCurrency.toUpperCase();
  if (isBase) {
    // Base-currency identity: the document figures ARE base figures (the FX-8 reading rule), so no
    // stored conversion is required and the closing case still derives against baseTotal when the
    // invoice carries one.
    const baseTotal = invoice.baseTotal ?? invoice.total;
    const basePaid = invoice.basePaidAmount ?? invoice.paidAmount;
    return {
      ok: true,
      closesInvoice,
      arCleared: closesInvoice
        ? roundMoney(Number(baseTotal) - Number(basePaid), baseCurrency)
        : roundMoney(Number(applyAmount), baseCurrency),
    };
  }
  if (invoice.exchangeRate === null || invoice.baseTotal === null) {
    // A foreign invoice with no stored conversion (pre-FX-6 history): its AR was never booked in
    // base, so there is no figure to clear against. An honest refusal, not a guessed rate.
    return { ok: false, error: "This invoice has no stored base-currency conversion, so an advance cannot be applied against it." };
  }
  return {
    ok: true,
    closesInvoice,
    arCleared: closesInvoice
      ? roundMoney(Number(invoice.baseTotal) - Number(invoice.basePaidAmount ?? "0"), baseCurrency)
      : roundMoney(Number(applyAmount) * Number(invoice.exchangeRate), baseCurrency),
  };
}

export type AllocationPosting = {
  carriedBase: string;
  arCleared: string;
  /** Dr 2300 / Cr 1100 / optional derived 4900 — in that order. */
  lines: { accountId: number; debit: string; credit: string }[];
  closesInvoice: boolean;
  emptiesAdvance: boolean;
};

/**
 * The complete three-line construction for one allocation. No cash line: the money moved once,
 * when the advance was received. No revenue line: the invoice's own posting recognised it.
 */
export function buildAllocationPosting(args: {
  pot: AdvancePot;
  invoice: AllocationInvoice;
  applyAmount: string;
  baseCurrency: string;
  advancesAccountId: number;
  arAccountId: number;
  fxAccountId: number | null;
}): { ok: true; posting: AllocationPosting } | { ok: false; error: string } {
  const { pot, invoice, applyAmount, baseCurrency, advancesAccountId, arAccountId, fxAccountId } = args;

  const carriedBase = carriedBaseFor({ pot, drawAmount: applyAmount, baseCurrency });
  const ar = arClearedFor({ invoice, applyAmount, baseCurrency });
  if (!ar.ok) return { ok: false, error: ar.error };

  const fx = fxLine({ baseAmount: carriedBase, baseApplied: ar.arCleared, direction: "in", baseCurrency, fxAccountId: fxAccountId ?? -1 });
  if (fx && fxAccountId === null) {
    return { ok: false, error: "Chart of accounts is missing a required system account (4900 Exchange Gain/Loss)." };
  }

  const docCurrency = pot.currency ?? baseCurrency;
  const remainingDoc = Number(pot.amount) - Number(pot.consumedAmount);
  return {
    ok: true,
    posting: {
      carriedBase,
      arCleared: ar.arCleared,
      closesInvoice: ar.closesInvoice,
      emptiesAdvance: Number(applyAmount) >= remainingDoc - moneyEpsilon(docCurrency),
      lines: [
        { accountId: advancesAccountId, debit: carriedBase, credit: "0" },
        { accountId: arAccountId, debit: "0", credit: ar.arCleared },
        ...(fx ? [fx] : []),
      ],
    },
  };
}

export type PlannedAllocation = {
  advancePaymentId: number;
  appliedAmount: string;
  carriedBase: string;
  arCleared: string;
  lines: { accountId: number; debit: string; credit: string }[];
  /** True when this allocation exhausted its advance — the receipt is then fully spent. */
  emptiesAdvance: boolean;
};

/**
 * Plan a run of allocations against ONE invoice, drawing from advances in the order given.
 *
 * Shared by conversion and by applying an advance to an existing invoice, so both produce the same
 * accounting from the same rules. The invoice's running paid figures are threaded through the plan,
 * which is what lets the LAST draw against an invoice derive its AR figure against `baseTotal`
 * instead of reconverting — the invoice-side residual. The advance-side residual is handled per
 * pot inside `buildAllocationPosting`.
 *
 * Callers must have LOCKED every pot first (see `lockAdvanceAndReadPot`) — the availability inside
 * each pot is only trustworthy while its row is held.
 */
export function planAllocations(args: {
  /** Advances in the order they should be consumed — oldest receipt first. */
  pots: { paymentId: number; pot: AdvancePot }[];
  /** The invoice as it stands BEFORE any of these allocations. */
  invoice: AllocationInvoice;
  baseCurrency: string;
  advancesAccountId: number;
  arAccountId: number;
  fxAccountId: number | null;
}):
  | { ok: true; plan: PlannedAllocation[]; totalApplied: string; totalArCleared: string }
  | { ok: false; error: string } {
  const { pots, invoice, baseCurrency, advancesAccountId, arAccountId, fxAccountId } = args;
  const docCurrency = invoice.currency ?? baseCurrency;
  const eps = moneyEpsilon(docCurrency);

  const plan: PlannedAllocation[] = [];
  let paidAmount = Number(invoice.paidAmount);
  let basePaidAmount = Number(invoice.basePaidAmount ?? invoice.paidAmount);

  for (const { paymentId, pot } of pots) {
    const due = Number(invoice.total) - paidAmount;
    if (due <= eps) break; // the invoice is settled — later advances stay available
    const { availableAmount } = availabilityOf(pot, baseCurrency);
    const applyAmount = roundMoney(Math.min(Number(availableAmount), due), docCurrency);
    if (Number(applyAmount) <= eps) continue; // an exhausted advance contributes nothing

    const built = buildAllocationPosting({
      pot,
      invoice: { ...invoice, paidAmount: roundMoney(paidAmount, docCurrency), basePaidAmount: roundMoney(basePaidAmount, baseCurrency) },
      applyAmount,
      baseCurrency,
      advancesAccountId,
      arAccountId,
      fxAccountId,
    });
    if (!built.ok) return { ok: false, error: built.error };
    if (!postingIsBalanced(built.posting.lines)) {
      // Unreachable by construction; asserted anyway, because an unbalanced entry reaching the
      // ledger is the one failure this whole model cannot recover from.
      return { ok: false, error: "Internal error: the advance application entry did not balance." };
    }

    plan.push({
      advancePaymentId: paymentId,
      appliedAmount: applyAmount,
      carriedBase: built.posting.carriedBase,
      arCleared: built.posting.arCleared,
      lines: built.posting.lines,
      emptiesAdvance: built.posting.emptiesAdvance,
    });
    paidAmount += Number(applyAmount);
    basePaidAmount += Number(built.posting.arCleared);
  }

  return {
    ok: true,
    plan,
    totalApplied: roundMoney(paidAmount - Number(invoice.paidAmount), docCurrency),
    totalArCleared: roundMoney(basePaidAmount - Number(invoice.basePaidAmount ?? invoice.paidAmount), baseCurrency),
  };
}

/** Debits must equal credits at the base currency's minor unit — asserted at build time, not hoped for. */
export function postingIsBalanced(lines: { debit: string; credit: string }[]): boolean {
  return lines.reduce((s, l) => s + mils(l.debit), 0) === lines.reduce((s, l) => s + mils(l.credit), 0);
}

// ---------------------------------------------------------------------------------------------
// Invariants — refused server-side, inside the allocating transaction.
// ---------------------------------------------------------------------------------------------

/**
 * §5: an advance belongs to the customer who paid it. Applying it to somebody else's invoice
 * would move one customer's money onto another's receivable, which no report could later explain.
 */
export function sameCustomerRefusal(advanceCustomerId: number, invoiceCustomerId: number): string | null {
  return advanceCustomerId === invoiceCustomerId
    ? null
    : "This advance belongs to a different client and cannot be applied to this invoice.";
}

/**
 * Same currency. `applyAmount × invoice.exchangeRate` has no meaning across currencies, and adding
 * a USD figure to a SAR invoice's `paidAmount` mixes denominations in a stored column. The old
 * whole-payment model could not produce a mismatch (the invoice WAS the converted proforma);
 * applying an advance to a different invoice can, so it is refused explicitly.
 *
 * Known limitation, deliberately: lifting it needs a rate policy for the cross-currency conversion
 * and a redefinition of what `paidAmount` means on a foreign invoice.
 */
export function sameCurrencyRefusal(advanceCurrency: string | null, invoiceCurrency: string | null, baseCurrency: string): string | null {
  const a = (advanceCurrency ?? baseCurrency).toUpperCase();
  const i = (invoiceCurrency ?? baseCurrency).toUpperCase();
  return a === i
    ? null
    : `This advance is in ${a} and the invoice is in ${i}. An advance can only be applied to an invoice in the same currency.`;
}

// ---------------------------------------------------------------------------------------------
// Reading the pot — always inside the allocating transaction, always behind the row lock.
// ---------------------------------------------------------------------------------------------

/**
 * Lock the advance receipt and read its pot **inside** the lock.
 *
 * Without this, two conversions can each read "2,000 available" and each allocate it, driving 2300
 * negative — the whole-payment model was accidentally protected by `salesInvoiceId` being either
 * null or not, and an allocation table has no such natural guard. Callers that consume several
 * advances for one invoice must lock them in ASCENDING id order, so two such callers can never
 * take the same two locks in opposite orders and deadlock.
 */
export async function lockAdvanceAndReadPot(
  tx: Tx,
  args: { orgId: number; advancePaymentId: number },
): Promise<{ pot: AdvancePot; proformaInvoiceId: number | null } | null> {
  const locked = await tx.execute(sql`
    select id, amount::text as amount, currency, base_applied_amount::text as carried, proforma_invoice_id, kind
      from payments
     where id = ${args.advancePaymentId} and org_id = ${args.orgId}
       for update
  `);
  const row = (locked.rows as unknown as {
    amount: string; currency: string | null; carried: string | null; proforma_invoice_id: number | null; kind: string | null;
  }[])[0];
  if (!row || row.kind !== "advance_receipt") return null;

  const [alloc] = await tx
    .select({
      amount: sql<string>`coalesce(sum(${advanceApplicationsTable.appliedAmount}), 0)::text`,
      carried: sql<string>`coalesce(sum(${advanceApplicationsTable.carriedBase}), 0)::text`,
    })
    .from(advanceApplicationsTable)
    .where(and(
      eq(advanceApplicationsTable.orgId, args.orgId),
      eq(advanceApplicationsTable.advancePaymentId, args.advancePaymentId),
      isNull(advanceApplicationsTable.releasedAt),
    ));

  const [refunded] = await tx
    .select({
      amount: sql<string>`coalesce(sum(${paymentsTable.amount}), 0)::text`,
      carried: sql<string>`coalesce(sum(${paymentsTable.baseAppliedAmount}), 0)::text`,
    })
    .from(paymentsTable)
    .where(and(
      eq(paymentsTable.orgId, args.orgId),
      eq(paymentsTable.refundsPaymentId, args.advancePaymentId),
    ));

  // A pre-FX-7 foreign receipt stored no base value, so its carried base is unknown; the identity
  // holds for base-currency receipts. Callers refuse to allocate a null carried base rather than
  // inventing one.
  const carriedBase = row.carried ?? (row.currency === null ? row.amount : null);
  if (carriedBase === null) return null;

  return {
    proformaInvoiceId: row.proforma_invoice_id,
    pot: {
      amount: row.amount,
      carriedBase,
      consumedAmount: String(Number(alloc?.amount ?? 0) + Number(refunded?.amount ?? 0)),
      consumedCarried: String(Number(alloc?.carried ?? 0) + Number(refunded?.carried ?? 0)),
      currency: row.currency,
    },
  };
}
