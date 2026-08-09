import "server-only";
import { and, desc, eq, lte } from "drizzle-orm";
import { db, exchangeRatesTable } from "@/db";

/**
 * Rate lookup for posting-time currency conversion.
 *
 * The rule this file exists to enforce: convert **once, at posting time, and store the result**.
 * Nothing here should ever be called from a report, a table cell, or a PDF — a posted document
 * carries the base-currency amount it was posted with, and re-deriving it later with a different
 * rate would silently rewrite history.
 *
 * The direction convention (`baseAmount = foreignAmount × rate`) is documented in full on
 * `exchangeRatesTable` in `src/db/schema/exchange-rates.ts`. `toBaseAmount()` below is the only
 * place that arithmetic is written down.
 */

/** What a resolved rate carries. The date and source travel with the number so a posting can be
 *  audited later — "3.75" alone cannot be checked against anything. */
export type ResolvedRate = {
  /** Units of base per one unit of foreign, as a decimal string (numeric(18,8) precision). */
  rate: string;
  /** The `effectiveDate` of the row that was used — NOT the date that was asked for. */
  effectiveDate: string;
  /** The stored provenance of the rate, e.g. "SAMA". */
  source: string;
};

/** Thrown when a foreign-currency document is posted on a date with no rate on or before it. */
export class MissingExchangeRateError extends Error {
  readonly currency: string;
  readonly date: string;

  constructor(currency: string, date: string) {
    super(`No exchange rate for ${currency} on or before ${date}.`);
    this.name = "MissingExchangeRateError";
    this.currency = currency;
    this.date = date;
  }
}

/**
 * The rate to use when posting a `fromCurrency` document dated `date`.
 *
 * Picks the most recent row whose `effectiveDate` is on or before `date`, which means a rate
 * entered for a future date is inert until that date arrives — see the schema file for why that
 * is intended rather than a gap.
 *
 * @param date the *document's own* date (invoice date, receipt date, note date, payment date) in
 *             `YYYY-MM-DD` — never "today", unless the document is dated today.
 * @throws MissingExchangeRateError when no rate is on file. Callers must let this reach the user
 *         rather than falling back to 1.0; a wrong rate is worse than a refused posting.
 */
export async function resolveRate(args: {
  orgId: number;
  /** The org's base currency (`orgs.currency`). */
  baseCurrency: string;
  /** The document's currency. */
  fromCurrency: string;
  /** `YYYY-MM-DD`. */
  date: string;
}): Promise<ResolvedRate> {
  const base = args.baseCurrency.toUpperCase();
  const from = args.fromCurrency.toUpperCase();

  // Base-currency documents never touch the rates table: there is nothing to look up, and an org
  // that has never entered a rate must still be able to post its own currency.
  if (from === base) {
    return { rate: "1", effectiveDate: args.date, source: "base currency" };
  }

  const [row] = await db
    .select({
      rate: exchangeRatesTable.rate,
      effectiveDate: exchangeRatesTable.effectiveDate,
      source: exchangeRatesTable.source,
    })
    .from(exchangeRatesTable)
    .where(
      and(
        eq(exchangeRatesTable.orgId, args.orgId),
        eq(exchangeRatesTable.fromCurrency, from),
        eq(exchangeRatesTable.toCurrency, base),
        lte(exchangeRatesTable.effectiveDate, args.date),
      ),
    )
    .orderBy(desc(exchangeRatesTable.effectiveDate))
    .limit(1);

  if (!row) throw new MissingExchangeRateError(from, args.date);
  return row;
}

/**
 * Convert a foreign amount to base currency. **Multiplies** — see the direction convention on
 * `exchangeRatesTable`. Rounds half away from zero to 2 decimals, matching how every other money
 * figure in the app is stored (`numeric(14,2)`).
 */
export function toBaseAmount(foreignAmount: string | number, rate: string | number): string {
  const raw = (Number(foreignAmount) || 0) * (Number(rate) || 0) * 100;
  const cents = raw < 0 ? -Math.round(-raw) : Math.round(raw);
  return (cents / 100).toFixed(2);
}

/**
 * Validation for the write path (Task 3's rate management screen calls this).
 *
 * Returns an error message, or `null` plus the normalized row to insert. Two rules beyond the
 * obvious: the rate must be strictly positive (the database enforces this too — a zero rate would
 * silently zero every total it touched), and `toCurrency` must equal the org's base currency,
 * because `resolveRate` only ever looks for base-currency rows and a row pointing anywhere else
 * would be stored and then ignored.
 */
export function validateRateInput(input: {
  fromCurrency: string;
  toCurrency: string;
  baseCurrency: string;
  rate: string;
  effectiveDate: string;
  source: string;
}): { error: string } | { error: null; value: {
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  effectiveDate: string;
  source: string;
} } {
  const from = input.fromCurrency.trim().toUpperCase();
  const to = input.toCurrency.trim().toUpperCase();
  const base = input.baseCurrency.trim().toUpperCase();
  const source = input.source.trim();

  if (!/^[A-Z]{3}$/.test(from)) return { error: "Currency must be a 3-letter code." };
  if (to !== base) return { error: `Rates must convert to the base currency (${base}).` };
  if (from === base) return { error: "The base currency does not need a rate against itself." };

  const rate = Number(input.rate);
  if (!Number.isFinite(rate)) return { error: "Rate must be a number." };
  if (rate <= 0) return { error: "Rate must be greater than zero." };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) return { error: "Effective date is required." };
  if (!source) return { error: "Source is required." };

  return {
    error: null,
    value: { fromCurrency: from, toCurrency: to, rate: input.rate.trim(), effectiveDate: input.effectiveDate, source },
  };
}
