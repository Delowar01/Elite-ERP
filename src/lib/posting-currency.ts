import "server-only";
import { resolveRate, toBaseAmount, MissingExchangeRateError } from "@/lib/exchange-rates";
import { roundMoney } from "@/lib/currency/currencies";

/**
 * FX-6: the one conversion every posting path performs.
 *
 * Convert once, at posting time, store the result. The caller supplies the document's own event
 * date (invoice date, receipt date, note date — never "today" unless today IS the event date),
 * and gets back the three figures the document stores and the ledger posts from.
 *
 * ## The base-currency short-circuit
 *
 * A document whose currency is null or equals the org's base converts by identity: rate "1", base
 * amounts equal to the document's own amounts, **no rate lookup and no rate-table dependency**.
 * This is the overwhelmingly common case, and it must behave exactly as posting always has — a
 * SAR org that has never entered a rate posts a SAR invoice with nothing new in the way.
 *
 * ## Blocking
 *
 * A foreign document with no rate on or before its date does NOT post. `blocked` names the
 * currency and the date so the UI can say precisely what is missing, and carries them as a
 * structured `missingRate` — the seam FX-3's one-click fetch will hang off. Falling back to 1.0
 * or posting unconverted is never acceptable: both write a wrong ledger, and a blocked posting is
 * recoverable while a wrong ledger is not.
 *
 * ## Why `baseRevenue`-style lines must be DERIVED, not converted separately
 *
 * The posted entry must balance exactly: Dr baseTotal = Cr revenue + Cr baseTaxAmount. Converting
 * total, subtotal and tax independently rounds three times and can miss by a minor unit — and the
 * pre-FX-6 lines had a worse version of the same flaw, crediting the full `subtotal` against a
 * discounted `total`, which unbalanced the entry by the whole discount. So this helper returns
 * only the two converted figures, and the caller computes its middle line as
 * `baseTotal − baseTaxAmount` (see `subtractMoney`), making every entry balanced by construction.
 */

export type CapturedBaseAmounts = {
  ok: true;
  /** Units of base currency per unit of document currency. "1" for a base-currency document. */
  exchangeRate: string;
  baseTotal: string;
  baseTaxAmount: string;
};

export type MissingRateBlock = {
  ok: false;
  error: string;
  /** Structured form of the block, for FX-3's rate-entry affordance. */
  missingRate: { currency: string; date: string };
};

export async function captureBaseAmounts(args: {
  orgId: number;
  baseCurrency: string;
  /** The document's currency column, verbatim — null means base. */
  docCurrency: string | null;
  total: string;
  taxTotal: string;
  /** The posting event's own date (YYYY-MM-DD), per the FX model's rate-date table. */
  date: string;
}): Promise<CapturedBaseAmounts | MissingRateBlock> {
  const { orgId, baseCurrency, docCurrency, total, taxTotal, date } = args;

  if (!docCurrency || docCurrency.toUpperCase() === baseCurrency.toUpperCase()) {
    // Identity — the stored amounts ARE base amounts. Copied verbatim rather than re-rounded, the
    // same rule the FX-5 backfill followed.
    return { ok: true, exchangeRate: "1", baseTotal: total, baseTaxAmount: taxTotal };
  }

  try {
    const rate = await resolveRate({ orgId, baseCurrency, fromCurrency: docCurrency, date });
    return {
      ok: true,
      exchangeRate: rate.rate,
      baseTotal: toBaseAmount(total, rate.rate, baseCurrency),
      baseTaxAmount: toBaseAmount(taxTotal, rate.rate, baseCurrency),
    };
  } catch (e) {
    if (e instanceof MissingExchangeRateError) {
      return {
        ok: false,
        error:
          `No ${docCurrency.toUpperCase()} → ${baseCurrency.toUpperCase()} exchange rate exists on or before ` +
          `${date}. Enter a rate for that date in Preset Management before posting this document.`,
        missingRate: { currency: docCurrency.toUpperCase(), date },
      };
    }
    throw e;
  }
}

/**
 * `a − b` at the base currency's minor unit, for deriving the balancing middle line of a 3-line
 * entry. Both inputs are already rounded base amounts, so the subtraction is exact within float
 * range and the final rounding only normalises the string form.
 */
export function subtractMoney(a: string, b: string, baseCurrency: string): string {
  return roundMoney(Number(a) - Number(b), baseCurrency);
}
