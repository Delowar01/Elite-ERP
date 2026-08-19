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
 *
 * Documents that can be CREDITED (sales invoices) subtract a third channel as well. Pass their
 * credited columns and the identity becomes `total − paid − credited`; omit them — as purchase
 * orders do, having no credit notes against them — and it stays the two-term form.
 *
 * This is why splitting credits out of `paidAmount` cost so little at the reporting layer: AR
 * aging, the dashboard receivables total and every other consumer read outstanding through here,
 * so the identity changed in ONE place rather than in each of them.
 */
export function baseOutstandingExpr(
  t: CurrencyDoc & { total: PgColumn; paidAmount: PgColumn; baseTotal: PgColumn; basePaidAmount: PgColumn;
                     creditedAmount?: PgColumn; baseCreditedAmount?: PgColumn },
  base: string,
): SQL<string | null> {
  // GREATEST(0, …) on both forms, matching `settlementOf`'s floor.
  //
  // Without it an invoice that is both fully paid and fully credited contributes a NEGATIVE
  // receivable: 2156.25 − 2156.25 − 2156.25 = −2156.25. AR aging drops non-positive rows so it
  // never showed there, but the dashboard SUMS this expression, so one over-settled invoice would
  // have silently reduced total receivables below the true figure. An over-settlement is a refund
  // owed, not a negative debt — the same reasoning that floors the document-side balance.
  if (!t.creditedAmount || !t.baseCreditedAmount) {
    return sql`GREATEST(0, case when ${isBaseCurrencyPred(t, base)} then ${t.total} - ${t.paidAmount} else ${t.baseTotal} - ${t.basePaidAmount} end)`;
  }
  // `coalesce` on the base credited column only: a foreign invoice with credits but no captured
  // base figure would otherwise null the whole expression and drop the row from every total, which
  // is the right treatment for an unknown TOTAL but not for an absent credit.
  return sql`GREATEST(0, case when ${isBaseCurrencyPred(t, base)}
                  then ${t.total} - ${t.paidAmount} - ${t.creditedAmount}
                  else ${t.baseTotal} - ${t.basePaidAmount} - coalesce(${t.baseCreditedAmount}, 0) end)`;
}

/** The value credited back in base currency — the third settlement channel, for readers that show it. */
export function baseCreditedExpr(
  t: CurrencyDoc & { creditedAmount: PgColumn; baseCreditedAmount: PgColumn },
  base: string,
): SQL<string | null> {
  return sql`case when ${isBaseCurrencyPred(t, base)} then ${t.creditedAmount} else coalesce(${t.baseCreditedAmount}, 0) end`;
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
