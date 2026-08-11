import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * FX-8: how the reporting layer reads money. One rule, one place, zero conversion.
 *
 * A document's base-currency value is decided by the SAME identity rule capture and backfill
 * follow — restated for readers, not re-derived:
 *
 *  - **Base-currency document** (`currency` null or equal to the org base): the stored document
 *    figures ARE base amounts, verbatim. This is not a fallback — it is the definition, and it is
 *    load-bearing: non-posting documents (quotations, sales orders) and invoices born paid from a
 *    proforma conversion never pass through posting, so their `baseTotal` is legitimately null
 *    while their `total` is exactly right.
 *  - **Foreign document**: ONLY the stored base columns, captured at posting. Never the document
 *    figures (that is the 1:1 defect), never a fresh conversion (that is what storing them killed).
 *  - **Foreign with null base columns**: NULL. Unconverted, known bad. SQL `sum()` skips nulls, so
 *    such rows drop out of every total natively — and `unconverted*Pred` counts them so the
 *    omission is a visible, actionable warning ("N documents excluded — missing exchange rate"),
 *    never a total that is quietly short.
 *
 * Anything summing document money MUST go through these expressions; a report reaching for a bare
 * `total` on a mixed-currency table is the exact bug FX-4..7 existed to make impossible.
 */

type CurrencyDoc = { currency: PgColumn };

/** True when the document is denominated in the organization's base currency (null = base). */
export function isBaseCurrencyPred(t: CurrencyDoc, base: string): SQL<boolean> {
  return sql<boolean>`(${t.currency} is null or upper(${t.currency}) = upper(${base}))`;
}

/** The document's total in base currency, or NULL when foreign and unconverted. */
export function baseTotalExpr(t: CurrencyDoc & { total: PgColumn; baseTotal: PgColumn }, base: string): SQL<string | null> {
  return sql`case when ${isBaseCurrencyPred(t, base)} then ${t.total} else ${t.baseTotal} end`;
}

/** The document's tax total in base currency, or NULL when foreign and unconverted. */
export function baseTaxExpr(t: CurrencyDoc & { taxTotal: PgColumn; baseTaxAmount: PgColumn }, base: string): SQL<string | null> {
  return sql`case when ${isBaseCurrencyPred(t, base)} then ${t.taxTotal} else ${t.baseTaxAmount} end`;
}

/**
 * The document's outstanding balance in base currency: `total − paidAmount` for base documents,
 * `baseTotal − basePaidAmount` for foreign ones — BOTH sides from the same world, never a base
 * total minus a foreign paid amount (the mix that justified `basePaidAmount`'s existence). NULL —
 * and therefore excluded and counted — when either foreign column is missing.
 */
export function baseOutstandingExpr(
  t: CurrencyDoc & { total: PgColumn; paidAmount: PgColumn; baseTotal: PgColumn; basePaidAmount: PgColumn },
  base: string,
): SQL<string | null> {
  return sql`case when ${isBaseCurrencyPred(t, base)} then ${t.total} - ${t.paidAmount} else ${t.baseTotal} - ${t.basePaidAmount} end`;
}

/** Foreign document whose base total was never captured — the excluded-and-counted set. */
export function unconvertedTotalPred(t: CurrencyDoc & { baseTotal: PgColumn }, base: string): SQL<boolean> {
  return sql<boolean>`(not ${isBaseCurrencyPred(t, base)} and ${t.baseTotal} is null)`;
}

/** The document's paid amount in base currency, or NULL when foreign and unconverted. */
export function basePaidExpr(t: CurrencyDoc & { paidAmount: PgColumn; basePaidAmount: PgColumn }, base: string): SQL<string | null> {
  return sql`case when ${isBaseCurrencyPred(t, base)} then ${t.paidAmount} else ${t.basePaidAmount} end`;
}

/** Foreign document whose outstanding balance cannot be stated in base (either column missing). */
export function unconvertedOutstandingPred(
  t: CurrencyDoc & { baseTotal: PgColumn; basePaidAmount: PgColumn },
  base: string,
): SQL<boolean> {
  return sql<boolean>`(not ${isBaseCurrencyPred(t, base)} and (${t.baseTotal} is null or ${t.basePaidAmount} is null))`;
}
