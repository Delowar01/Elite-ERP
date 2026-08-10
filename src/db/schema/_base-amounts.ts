import { numeric } from "drizzle-orm/pg-core";

/**
 * Base-currency amounts, stored on every document that carries money.
 *
 * Phase 1 of multi-currency converts **once, at posting time, and stores the result**. These are
 * that result: the document's own figures expressed in the organization's base currency, frozen at
 * the rate that applied on the document's own date. Nothing re-derives them later, and no report
 * converts anything — a posted document keeps the numbers it was posted with, permanently.
 *
 * Spread into each table rather than repeated, because seven hand-written copies of the same three
 * columns is seven chances for one to drift in precision or nullability, and a report that sums a
 * `numeric(14,2)` on six tables and a `numeric(12,2)` on the seventh is wrong in a way nobody sees.
 *
 * ## Why every column is nullable
 *
 * Null means **"not converted — this number is not known"**, and it is the only honest value for a
 * foreign-currency document that predates conversion. The alternative, defaulting to the foreign
 * amount, would state that 1,000 USD is 1,000 SAR: a wrong number that looks like a right one and
 * that every downstream sum would silently absorb. FX-8 must therefore EXCLUDE nulls from report
 * totals and say so on screen with a count, never coerce them to zero.
 *
 * ## Why baseTaxAmount is stored rather than derived
 *
 * ZATCA requires the VAT amount to be shown in SAR on the invoice, at the official rate for the
 * date of supply, even when the invoice itself is denominated in another currency. Deriving it from
 * `baseTotal` afterwards does not reproduce that figure cleanly: tax is computed per line and
 * rounded, so `baseTotal − baseSubtotal` accumulates rounding differences against the number the
 * invoice is required to display. It is converted and stored in its own right.
 */
export const baseAmountColumns = {
  /**
   * Units of base currency per one unit of the document's currency, captured on the document's own
   * date. `1` for a base-currency document. Stored so the conversion can be audited later — a base
   * amount without the rate that produced it cannot be checked against anything.
   */
  exchangeRate: numeric("exchange_rate", { precision: 18, scale: 8 }),
  /** `total` in base currency: total × exchangeRate, rounded at the BASE currency's minor unit. Null = not converted. */
  baseTotal: numeric("base_total", { precision: 15, scale: 3 }),
  /** `taxTotal` in base currency. Converted in its own right — see the ZATCA note above. */
  baseTaxAmount: numeric("base_tax_amount", { precision: 15, scale: 3 }),
};

/**
 * `paidAmount` in base currency, for the three tables that track payment against a document.
 *
 * Separate from the set above because only invoices, proformas and purchase orders carry
 * `paidAmount` — and because the aging reports compute `total − paidAmount` directly off these
 * tables. Without a base counterpart, that subtraction would mix a base total with a foreign paid
 * amount and report a balance that is wrong in neither currency.
 *
 * Nothing writes this until payments capture a rate (FX-7). Until then it holds only what the
 * backfill put there, and null everywhere else — which is the point: an obviously absent number
 * rather than a plausible wrong one.
 */
export const basePaidAmountColumn = {
  basePaidAmount: numeric("base_paid_amount", { precision: 15, scale: 3 }),
};
