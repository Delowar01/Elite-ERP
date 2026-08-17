import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { advanceApplicationsTable, advanceApplicationReleasesTable, paymentsTable, journalEntriesTable, journalLinesTable } from "@/db";
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
  /**
   * Cap on the TOTAL document amount drawn across this plan — a user applying part of an advance
   * by hand. Passed explicitly rather than faked by shrinking `invoice.total`, because the total
   * is also what decides `closesInvoice`: a shrunken total would make a 2,000 draw on a 10,000
   * invoice look like the closing one and derive its AR figure against the real baseTotal.
   */
  limitAmount?: string;
}):
  | { ok: true; plan: PlannedAllocation[]; totalApplied: string; totalArCleared: string }
  | { ok: false; error: string } {
  const { pots, invoice, baseCurrency, advancesAccountId, arAccountId, fxAccountId } = args;
  const docCurrency = invoice.currency ?? baseCurrency;
  const eps = moneyEpsilon(docCurrency);

  const plan: PlannedAllocation[] = [];
  let paidAmount = Number(invoice.paidAmount);
  let basePaidAmount = Number(invoice.basePaidAmount ?? invoice.paidAmount);

  let remainingLimit = args.limitAmount === undefined ? Infinity : Number(args.limitAmount);
  for (const { paymentId, pot } of pots) {
    const due = Number(invoice.total) - paidAmount;
    if (due <= eps) break; // the invoice is settled — later advances stay available
    if (remainingLimit <= eps) break; // the caller's explicit cap is spent
    const { availableAmount } = availabilityOf(pot, baseCurrency);
    const applyAmount = roundMoney(Math.min(Number(availableAmount), due, remainingLimit), docCurrency);
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
    remainingLimit -= Number(applyAmount);
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

  // Consumption is the ACTIVE allocations' posted figures MINUS their live releases: a partially
  // released allocation still settles part of its invoice, so neither counting it in full nor
  // dropping it is right. A fully released allocation contributes nothing from either side — its
  // row is excluded by `released_at`, and so are its release rows, which is why the subtraction
  // joins back through the same filter instead of summing releases independently.
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
  const [releasedBack] = await tx
    .select({
      amount: sql<string>`coalesce(sum(${advanceApplicationReleasesTable.releasedAmount}), 0)::text`,
      carried: sql<string>`coalesce(sum(${advanceApplicationReleasesTable.releasedCarried}), 0)::text`,
    })
    .from(advanceApplicationReleasesTable)
    .innerJoin(advanceApplicationsTable, eq(advanceApplicationsTable.id, advanceApplicationReleasesTable.allocationId))
    .where(and(
      eq(advanceApplicationReleasesTable.orgId, args.orgId),
      eq(advanceApplicationsTable.advancePaymentId, args.advancePaymentId),
      isNull(advanceApplicationsTable.releasedAt),
      isNull(advanceApplicationReleasesTable.reversedAt),
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
      consumedAmount: String(Number(alloc?.amount ?? 0) - Number(releasedBack?.amount ?? 0) + Number(refunded?.amount ?? 0)),
      consumedCarried: String(Number(alloc?.carried ?? 0) - Number(releasedBack?.carried ?? 0) + Number(refunded?.carried ?? 0)),
      currency: row.currency,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Releasing allocations (D).
// ---------------------------------------------------------------------------------------------

export type ReleasedAllocation = {
  allocationId: number;
  releaseId: number;
  /** Document amount returned to the advance. */
  appliedAmount: string;
  /** Base carried value returned to 2300. */
  carriedBase: string;
  /** Base AR restored to 1100 — what the invoice's `basePaidAmount` must give back. */
  arCleared: string;
  /** True when this release consumed the whole remaining allocation. */
  fullyReleased: boolean;
};

/** An allocation as it currently STANDS: what it posted, minus what has been released from it. */
type EffectiveAllocation = {
  id: number;
  appliedAmount: string;
  carriedBase: string;
  arCleared: string;
};

/**
 * The share of an allocation a release takes — proportional, or the EXACT remainder when the
 * release closes the allocation out.
 *
 * The same construction `carriedBaseFor` uses on the pot, one level down, and for the same reason:
 * three partial releases of one allocation must give back exactly what the allocation took, to the
 * fils, or an apply → release round-trip strands rounding in 2300 forever. Both base figures derive
 * from the same ratio, so an allocation with no FX difference (carried === AR) cannot acquire one
 * by being released in pieces.
 */
export function releaseShareOf(args: {
  effective: EffectiveAllocation;
  releaseAmount: string;
  baseCurrency: string;
  docCurrency: string;
}): { carried: string; arCleared: string; full: boolean } {
  const { effective, releaseAmount, baseCurrency, docCurrency } = args;
  const full = Number(releaseAmount) >= Number(effective.appliedAmount) - moneyEpsilon(docCurrency);
  // Rounded even in the exact-remainder case: the effective figures are a subtraction of two stored
  // numerics, which carries float noise a numeric column would silently absorb and a comparison
  // would not.
  if (full) {
    return { carried: roundMoney(effective.carriedBase, baseCurrency), arCleared: roundMoney(effective.arCleared, baseCurrency), full: true };
  }
  const ratio = Number(releaseAmount) / Number(effective.appliedAmount);
  return {
    carried: roundMoney(ratio * Number(effective.carriedBase), baseCurrency),
    arCleared: roundMoney(ratio * Number(effective.arCleared), baseCurrency),
    full: false,
  };
}

/**
 * Read an invoice's live allocations, newest first, with their EFFECTIVE figures.
 *
 * LIFO is the exact inverse of oldest-first application, which is what makes a round-trip restore
 * the prior state including its FX residuals rather than a differently-apportioned equivalent.
 */
async function liveAllocationsOf(tx: Tx, orgId: number, salesInvoiceId: number): Promise<EffectiveAllocation[]> {
  const rows = await tx
    .select({
      id: advanceApplicationsTable.id,
      appliedAmount: advanceApplicationsTable.appliedAmount,
      carriedBase: advanceApplicationsTable.carriedBase,
      arCleared: advanceApplicationsTable.arCleared,
      // The outer column is written out QUALIFIED, not interpolated. Drizzle renders
      // `${advanceApplicationsTable.id}` as a bare `"id"`, which inside this subquery binds to the
      // RELEASE table's own id — a correlated reference that silently points at the wrong table,
      // matches nothing, and returns a plausible zero instead of an error.
      releasedAmount: sql<string>`coalesce((
        select sum(r.released_amount) from advance_application_releases r
         where r.allocation_id = advance_applications.id and r.reversed_at is null), 0)::text`,
      releasedCarried: sql<string>`coalesce((
        select sum(r.released_carried) from advance_application_releases r
         where r.allocation_id = advance_applications.id and r.reversed_at is null), 0)::text`,
      releasedAr: sql<string>`coalesce((
        select sum(r.released_ar_cleared) from advance_application_releases r
         where r.allocation_id = advance_applications.id and r.reversed_at is null), 0)::text`,
    })
    .from(advanceApplicationsTable)
    .where(and(
      eq(advanceApplicationsTable.orgId, orgId),
      eq(advanceApplicationsTable.salesInvoiceId, salesInvoiceId),
      isNull(advanceApplicationsTable.releasedAt),
    ))
    .orderBy(desc(advanceApplicationsTable.id));

  return rows.map((r) => ({
    id: r.id,
    appliedAmount: String(Number(r.appliedAmount) - Number(r.releasedAmount)),
    carriedBase: String(Number(r.carriedBase) - Number(r.releasedCarried)),
    arCleared: String(Number(r.arCleared) - Number(r.releasedAr)),
  }));
}

/** The accounts an allocation actually posted to: [0] 2300, [1] 1100, [2] 4900 if it carried FX. */
async function applicationAccountsOf(
  tx: Tx,
  orgId: number,
  allocationId: number,
): Promise<{ advancesAccountId: number; arAccountId: number; fxAccountId: number | null } | null> {
  const [application] = await tx
    .select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .where(and(
      eq(journalEntriesTable.orgId, orgId),
      eq(journalEntriesTable.sourceType, "advance_application"),
      eq(journalEntriesTable.sourceId, allocationId),
    ))
    .limit(1);
  if (!application) return null;
  const lines = await tx
    .select({ accountId: journalLinesTable.accountId, debit: journalLinesTable.debit, credit: journalLinesTable.credit })
    .from(journalLinesTable)
    .where(eq(journalLinesTable.journalEntryId, application.id))
    .orderBy(journalLinesTable.id);
  // The accounts come from what POSTED, not from today's chart: a remapped account code must not
  // send the release to a different account from the application it reverses. The shape is the one
  // `buildAllocationPosting` writes — Dr 2300, Cr 1100, optional 4900 — in that order.
  if (lines.length < 2 || Number(lines[0].debit) <= 0 || Number(lines[1].credit) <= 0) return null;
  return {
    advancesAccountId: lines[0].accountId,
    arAccountId: lines[1].accountId,
    fxAccountId: lines[2]?.accountId ?? null,
  };
}

/**
 * Release allocations from an invoice — all of them, or only as much as `limitAmount` allows.
 *
 * A void gives everything back. A credit note gives back only what it over-settles by, which is
 * usually PART of one allocation, so the release is apportioned with the same residual discipline
 * the pot uses (`releaseShareOf`). The journal is built application-shaped from those shares and
 * then mirrored, so a full release reproduces the application's own lines exactly and a run of
 * partial releases sums to them exactly — the round-trip property, by construction rather than by
 * arithmetic luck.
 *
 * Idempotency is keyed on the CAUSE, `(causeType, causeId)`, not on the allocation: one allocation
 * can legitimately be released twice in two parts by two different credit notes, so "a release
 * already exists for this allocation" is not evidence of a retry, while "a release already exists
 * for THIS credit note" is exactly that.
 *
 * The allocation row is never rewritten and never deleted. It is marked `releasedAt` only when
 * nothing of it is left, which keeps `appliedAmount` meaning "what this application posted" — the
 * property the mirroring depends on.
 *
 * ## Locking
 *
 * Callers hold the INVOICE row, which is what serialises two releases against the same allocations.
 * The advance rows are deliberately NOT locked here: a release only ever RAISES availability, so an
 * apply computing availability under the payment lock is conservative if a release commits beside
 * it. Taking the payment lock too would invert the apply path's order (payment → invoice) and open
 * a deadlock for no gain.
 */
export async function releaseAllocations(
  tx: Tx,
  args: {
    orgId: number;
    userId: number;
    salesInvoiceId: number;
    reason: "invoice_void" | "credit_note";
    /** What this release is attributable to — the idempotency key and the handle a reversal uses. */
    causeType: "sales_invoice" | "credit_note";
    causeId: number;
    /** Entry date for the reversing journals. */
    date: string;
    /** Memo prefix, e.g. the invoice number. */
    memoSubject: string;
    baseCurrency: string;
    /** The invoice's own currency — allocations are same-currency by invariant. */
    docCurrency: string;
    /** Cap on the total DOCUMENT amount released. Omitted = release everything. */
    limitAmount?: string;
  },
): Promise<ReleasedAllocation[]> {
  const eps = moneyEpsilon(args.docCurrency);
  // A retry of the same cause finds its own work already done and adds nothing.
  const already = await tx
    .select({ id: advanceApplicationReleasesTable.id })
    .from(advanceApplicationReleasesTable)
    .where(and(
      eq(advanceApplicationReleasesTable.orgId, args.orgId),
      eq(advanceApplicationReleasesTable.causeType, args.causeType),
      eq(advanceApplicationReleasesTable.causeId, args.causeId),
      isNull(advanceApplicationReleasesTable.reversedAt),
    ))
    .limit(1);
  if (already.length > 0) return [];

  let remaining = args.limitAmount === undefined ? Infinity : Number(args.limitAmount);
  if (remaining <= eps) return [];

  const released: ReleasedAllocation[] = [];
  for (const alloc of await liveAllocationsOf(tx, args.orgId, args.salesInvoiceId)) {
    if (remaining <= eps) break;
    if (Number(alloc.appliedAmount) <= eps) continue;
    const releaseAmount = roundMoney(Math.min(Number(alloc.appliedAmount), remaining), args.docCurrency);
    const share = releaseShareOf({ effective: alloc, releaseAmount, baseCurrency: args.baseCurrency, docCurrency: args.docCurrency });

    const [row] = await tx
      .insert(advanceApplicationReleasesTable)
      .values({
        orgId: args.orgId,
        allocationId: alloc.id,
        releasedAmount: releaseAmount,
        releasedCarried: share.carried,
        releasedArCleared: share.arCleared,
        reason: args.reason,
        causeType: args.causeType,
        causeId: args.causeId,
        releasedDate: args.date,
        createdById: args.userId,
      })
      .returning({ id: advanceApplicationReleasesTable.id });

    const accounts = await applicationAccountsOf(tx, args.orgId, alloc.id);
    if (accounts) {
      const fx = fxLine({
        baseAmount: share.carried,
        baseApplied: share.arCleared,
        direction: "in",
        baseCurrency: args.baseCurrency,
        fxAccountId: accounts.fxAccountId ?? -1,
      });
      if (fx && accounts.fxAccountId === null) {
        // Unreachable: a share carries an FX difference only where the application did, and an
        // application with an FX difference posted a 4900 line to take it.
        throw new Error("Internal error: releasing an advance application needs a 4900 line the application never posted.");
      }
      const applied = [
        { accountId: accounts.advancesAccountId, debit: share.carried, credit: "0" },
        { accountId: accounts.arAccountId, debit: "0", credit: share.arCleared },
        ...(fx ? [fx] : []),
      ];
      if (!postingIsBalanced(applied)) {
        throw new Error("Internal error: the advance release entry did not balance.");
      }
      const [entry] = await tx
        .insert(journalEntriesTable)
        .values({
          orgId: args.orgId,
          entryDate: args.date,
          memo: `Advance application released — ${args.memoSubject}`,
          sourceType: "advance_application_release",
          sourceId: row.id,
          createdById: args.userId,
        })
        .returning({ id: journalEntriesTable.id });
      await tx.insert(journalLinesTable).values(
        applied.map((l) => ({ journalEntryId: entry.id, accountId: l.accountId, debit: l.credit, credit: l.debit })),
      );
    }

    if (share.full) {
      await tx
        .update(advanceApplicationsTable)
        .set({ releasedAt: new Date(), releaseReason: args.reason })
        .where(eq(advanceApplicationsTable.id, alloc.id));
    }
    released.push({
      allocationId: alloc.id,
      releaseId: row.id,
      appliedAmount: releaseAmount,
      carriedBase: share.carried,
      arCleared: share.arCleared,
      fullyReleased: share.full,
    });
    remaining -= Number(releaseAmount);
  }
  return released;
}

/**
 * Undo the releases a cause created — a reversed credit note re-applying what it released.
 *
 * The mirror of a mirror: each release entry's own lines are inverted, so the ledger returns to the
 * state the application left it in, FX line included. The release row is marked reversed rather
 * than deleted, and the allocation's `releasedAt` is lifted where the reversal leaves something of
 * it live again.
 */
export async function reverseReleasesOfCause(
  tx: Tx,
  args: {
    orgId: number;
    userId: number;
    causeType: "sales_invoice" | "credit_note";
    causeId: number;
    date: string;
    memoSubject: string;
  },
): Promise<ReleasedAllocation[]> {
  const live = await tx
    .select({
      id: advanceApplicationReleasesTable.id,
      allocationId: advanceApplicationReleasesTable.allocationId,
      releasedAmount: advanceApplicationReleasesTable.releasedAmount,
      releasedCarried: advanceApplicationReleasesTable.releasedCarried,
      releasedArCleared: advanceApplicationReleasesTable.releasedArCleared,
    })
    .from(advanceApplicationReleasesTable)
    .where(and(
      eq(advanceApplicationReleasesTable.orgId, args.orgId),
      eq(advanceApplicationReleasesTable.causeType, args.causeType),
      eq(advanceApplicationReleasesTable.causeId, args.causeId),
      isNull(advanceApplicationReleasesTable.reversedAt),
    ))
    .orderBy(desc(advanceApplicationReleasesTable.id));

  const undone: ReleasedAllocation[] = [];
  for (const rel of live) {
    const [releaseEntry] = await tx
      .select({ id: journalEntriesTable.id })
      .from(journalEntriesTable)
      .where(and(
        eq(journalEntriesTable.orgId, args.orgId),
        eq(journalEntriesTable.sourceType, "advance_application_release"),
        eq(journalEntriesTable.sourceId, rel.id),
      ))
      .limit(1);
    const alreadyReversed = await tx
      .select({ id: journalEntriesTable.id })
      .from(journalEntriesTable)
      .where(and(
        eq(journalEntriesTable.orgId, args.orgId),
        eq(journalEntriesTable.sourceType, "advance_application_release_reversal"),
        eq(journalEntriesTable.sourceId, rel.id),
      ))
      .limit(1);
    if (releaseEntry && alreadyReversed.length === 0) {
      const lines = await tx
        .select({ accountId: journalLinesTable.accountId, debit: journalLinesTable.debit, credit: journalLinesTable.credit })
        .from(journalLinesTable)
        .where(eq(journalLinesTable.journalEntryId, releaseEntry.id));
      const [entry] = await tx
        .insert(journalEntriesTable)
        .values({
          orgId: args.orgId,
          entryDate: args.date,
          memo: `Advance application re-applied — ${args.memoSubject}`,
          sourceType: "advance_application_release_reversal",
          sourceId: rel.id,
          createdById: args.userId,
        })
        .returning({ id: journalEntriesTable.id });
      await tx.insert(journalLinesTable).values(
        lines.map((l) => ({ journalEntryId: entry.id, accountId: l.accountId, debit: l.credit, credit: l.debit })),
      );
    }

    await tx
      .update(advanceApplicationReleasesTable)
      .set({ reversedAt: new Date() })
      .where(eq(advanceApplicationReleasesTable.id, rel.id));
    // Something of the allocation is live again, so it is no longer a released allocation.
    await tx
      .update(advanceApplicationsTable)
      .set({ releasedAt: null, releaseReason: null })
      .where(eq(advanceApplicationsTable.id, rel.allocationId));

    undone.push({
      allocationId: rel.allocationId,
      releaseId: rel.id,
      appliedAmount: rel.releasedAmount,
      carriedBase: rel.releasedCarried,
      arCleared: rel.releasedArCleared,
      fullyReleased: false,
    });
  }
  return undone;
}

// ---------------------------------------------------------------------------------------------
// Credit notes.
// ---------------------------------------------------------------------------------------------

/**
 * How much of an invoice's allocations a credit note releases.
 *
 * A credit note reduces what the customer owes. Where the invoice was settled by an advance, that
 * reduction has to go somewhere: leaving it in AR drives the receivable NEGATIVE while the customer
 * genuinely holds value — the exact state 2300 exists to prevent, arriving through a different
 * door. So the over-settlement goes back to 2300 as available advance, and AR stays put:
 *
 * ```text
 * invoice 10,000 settled by a 10,000 advance, credit note 2,000
 *   note:    Dr 4000 revenue 2,000 / Cr 1100 AR 2,000
 *   release: Dr 1100 AR 2,000      / Cr 2300 advances 2,000
 *   net:     Dr 4000 2,000 / Cr 2300 2,000 — revenue down, customer credit up, AR untouched at 0
 * ```
 *
 * Two caps, and BOTH are needed:
 *
 *  - **The over-settlement.** Only what the note over-pays the invoice by is released. A 5,000 note
 *    against a 10,000 invoice with a 3,000 advance applied leaves the invoice owing 2,000 with the
 *    advance still settling its share — releasing the 3,000 there would strand the customer's money
 *    as a floating advance while their invoice showed 5,000 outstanding, and put the aging report
 *    at odds with the relationship.
 *  - **The active allocations.** Only advance money can go back to 2300. Where an invoice was
 *    settled in CASH, the over-settlement has no allocation behind it and this returns less than the
 *    note over-pays by — the cash-paid remainder, which still drives AR negative and is a separate
 *    decision recorded in the backlog, not something this cap can reach.
 */
export function creditNoteReleaseAmount(args: {
  invoiceTotal: string;
  invoicePaidAmount: string;
  creditNoteTotal: string;
  activeAllocationTotal: string;
  docCurrency: string;
}): string {
  const overSettlement = Number(args.invoicePaidAmount) + Number(args.creditNoteTotal) - Number(args.invoiceTotal);
  return roundMoney(
    Math.max(0, Math.min(overSettlement, Number(args.activeAllocationTotal))),
    args.docCurrency,
  );
}

/** The invoice's live allocation total, in document currency — what `creditNoteReleaseAmount` caps against. */
export async function activeAllocationTotal(tx: Tx, orgId: number, salesInvoiceId: number, docCurrency: string): Promise<string> {
  const live = await liveAllocationsOf(tx, orgId, salesInvoiceId);
  return roundMoney(live.reduce((sum, a) => sum + Number(a.appliedAmount), 0), docCurrency);
}
