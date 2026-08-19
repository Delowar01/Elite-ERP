import "server-only";
import { moneyEpsilon, roundMoney } from "@/lib/currency/currencies";

/**
 * How a sales invoice is settled — the one place the arithmetic lives.
 *
 * THREE channels, deliberately separate:
 *
 *  - `paid`     cash received, plus advances applied as payment (they were cash, once);
 *  - `credited` value returned by issued credit notes;
 *  - what is left: `outstanding = total − paid − credited`.
 *
 * Credits used to be added into `paidAmount`. That made outstanding come out right and made
 * `paidAmount` itself false — a fully-paid 575 invoice credited in full showed Paid 1,150 and a
 * balance of −575. The increment was not careless: it was holding up the ledger identity
 * `GL 1100 = baseTotal − basePaidAmount`, because a credit note credits AR just as a payment does.
 * That identity is preserved here, restated over both channels:
 *
 *     GL 1100 = baseTotal − basePaidAmount − baseCreditedAmount
 *
 * so nothing about the postings changes — only which column carries which fact.
 */
export type Settlement = {
  /** Everything that has reduced the receivable, by any channel. */
  settled: string;
  /** `total − settled`, floored at zero: crediting alone can never push a balance negative. */
  outstanding: string;
  /** The real status set: sent | partially_paid | paid. */
  status: "sent" | "partially_paid" | "paid";
};

export function settlementOf(args: {
  total: string;
  paid: string;
  credited: string;
  docCurrency: string;
}): Settlement {
  const eps = moneyEpsilon(args.docCurrency);
  const settled = Number(args.paid) + Number(args.credited);
  const outstanding = Math.max(0, Number(args.total) - settled);
  return {
    settled: roundMoney(settled, args.docCurrency),
    // Floored, and it matters: a credit note on a fully-paid invoice used to drive the displayed
    // balance to −575. An over-credit is a data question, not a negative debt.
    outstanding: roundMoney(outstanding, args.docCurrency),
    status: settled <= eps ? "sent" : settled >= Number(args.total) - eps ? "paid" : "partially_paid",
  };
}

/**
 * How much a settlement channel has OVER-settled the invoice — what a credit note may have to
 * release back to an advance.
 *
 * Reads `paid` and `credited` separately for the same reason everything else here does: with
 * credits folded into `paid`, a second credit note computed its over-settlement against a figure a
 * FIRST credit note had already inflated, and released more advance than the customer had.
 */
export function overSettlement(args: {
  total: string;
  paid: string;
  /** Credits already issued BEFORE this note. */
  priorCredited: string;
  /** The note being issued now. */
  thisCredit: string;
}): number {
  return Number(args.paid) + Number(args.priorCredited) + Number(args.thisCredit) - Number(args.total);
}
