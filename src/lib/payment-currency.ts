import "server-only";
import { resolveRate, MissingExchangeRateError } from "@/lib/exchange-rates";
import { roundMoney } from "@/lib/currency/currencies";

/**
 * FX-7: the payment-time half of currency capture (posting-currency.ts is the document-time half).
 *
 * A payment carries TWO base figures, and the distinction is the whole design:
 *
 *  - **baseAmount** — what the bank truly received or paid, in base currency. This is the Bank
 *    journal line. The bank statement is ground truth: when the user types the received base
 *    figure, the effective rate is DERIVED from it (`baseAmount / amount`), never the reverse.
 *  - **baseAppliedAmount** — what the source document is credited with: amount × the document's
 *    BOOKED rate (the one stored at posting, FX-6). This is the AR/AP journal line, and clears
 *    receivables/payables at exactly what was booked. Computed by the caller, because only the
 *    caller knows the document.
 *
 * `baseAmount − baseAppliedAmount` is the realized FX gain/loss, posted to 4900 as a DERIVED
 * line — the entry balances by construction, the same rule as FX-6's derived revenue line.
 *
 * This module resolves only the received side. Resolution order for a foreign payment:
 *
 *  1. A user-typed base figure (`baseReceived`) wins outright — it IS the rate, and no lookup can
 *     supersede it. `rateSource` records "derived-from-received".
 *  2. Otherwise `resolveRate` at the PAYMENT date (most recent on or before), `rateSource`
 *     records the resolved row's own source. No rate → a `missingRate` block, the same seam the
 *     one-click fetch already serves everywhere else.
 *
 * Base-currency payments are the identity: rate "1", baseAmount = amount, nothing looked up.
 */

/** `rateSource` when the user typed the received base figure and the rate was derived from it. */
export const DERIVED_RATE_SOURCE = "derived-from-received";

/** Integer thousandths — every base column is numeric(15,3), so this comparison is exact. */
export const mils = (v: string | number) => Math.round(Number(v) * 1000);

/**
 * The realized-FX journal line, shared by every path that clears a booked figure with a payment's
 * carried value: invoice/PO payments (Bank vs booked AR/AP) and advance applications on conversion
 * (2300's carried payment-date value vs booked AR). `baseAmount` (what was truly carried) minus
 * `baseApplied` (what the document is credited with, at its booked rate) is the realized
 * gain/loss — DERIVED, never independently converted, so the entry balances by construction.
 * Returns null when the difference is zero (same rate, or a base-currency payment).
 *
 * Sign: for money IN, carrying more base than booked is a gain; for money OUT, paying less base
 * than booked is a gain. Gains CREDIT 4900 (credit-normal), losses debit it.
 */
export function fxLine(args: {
  baseAmount: string;
  baseApplied: string;
  direction: "in" | "out";
  baseCurrency: string;
  fxAccountId: number;
}): { accountId: number; debit: string; credit: string } | null {
  const diff = mils(args.baseAmount) - mils(args.baseApplied);
  if (diff === 0) return null;
  const magnitude =
    diff > 0
      ? roundMoney(Number(args.baseAmount) - Number(args.baseApplied), args.baseCurrency)
      : roundMoney(Number(args.baseApplied) - Number(args.baseAmount), args.baseCurrency);
  const gain = args.direction === "in" ? diff > 0 : diff < 0;
  return gain
    ? { accountId: args.fxAccountId, debit: "0", credit: magnitude }
    : { accountId: args.fxAccountId, debit: magnitude, credit: "0" };
}

export type PaymentCapture =
  | {
      ok: true;
      /** Stored on the payment row: null = base currency, matching the document tables. */
      currency: string | null;
      /** Effective units of base per unit of payment currency, 8 dp. */
      exchangeRate: string;
      /** The Bank line: base value of the cash movement, rounded at the base minor unit. */
      baseAmount: string;
      rateSource: string;
    }
  | { ok: false; error: string; missingRate?: { currency: string; date: string } };

export async function capturePaymentBase(args: {
  orgId: number;
  baseCurrency: string;
  /** The source document's currency column, verbatim — null means base. */
  docCurrency: string | null;
  /** Payment amount in the document's currency; caller has validated > 0. */
  amount: number;
  /** `YYYY-MM-DD` — the payment's own date, per the FX model's rate-date table. */
  paymentDate: string;
  /** The user-typed received figure in base currency, or null when none was typed. */
  baseReceived: number | null;
}): Promise<PaymentCapture> {
  const base = args.baseCurrency.toUpperCase();
  const doc = (args.docCurrency ?? base).toUpperCase();

  if (doc === base) {
    return { ok: true, currency: null, exchangeRate: "1", baseAmount: roundMoney(args.amount, base), rateSource: "base currency" };
  }

  if (args.baseReceived !== null) {
    if (!Number.isFinite(args.baseReceived) || args.baseReceived <= 0) {
      return { ok: false, error: "The received amount in base currency must be greater than zero." };
    }
    return {
      ok: true,
      currency: doc,
      exchangeRate: (args.baseReceived / args.amount).toFixed(8),
      baseAmount: roundMoney(args.baseReceived, base),
      rateSource: DERIVED_RATE_SOURCE,
    };
  }

  try {
    const resolved = await resolveRate({ orgId: args.orgId, baseCurrency: base, fromCurrency: doc, date: args.paymentDate });
    return {
      ok: true,
      currency: doc,
      exchangeRate: resolved.rate,
      baseAmount: roundMoney(args.amount * Number(resolved.rate), base),
      rateSource: resolved.source,
    };
  } catch (e) {
    if (e instanceof MissingExchangeRateError) {
      return {
        ok: false,
        error:
          `No ${doc} → ${base} exchange rate exists on or before ${args.paymentDate}. ` +
          `Enter the received amount in ${base} directly, or add a rate in Preset Management.`,
        missingRate: { currency: doc, date: args.paymentDate },
      };
    }
    throw e;
  }
}
