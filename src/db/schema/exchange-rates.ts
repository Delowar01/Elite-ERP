import { pgTable, serial, integer, text, numeric, date, unique, check, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgsTable } from "./orgs";

/**
 * Manually maintained exchange rates, one row per (org, currency pair, effective date).
 *
 * Phase 1 converts **once, at posting time**, and stores the result in base currency. Nothing here
 * is consulted at display time, and no report converts anything — a posted document keeps the rate
 * it was posted with, forever. That is the whole reason `effectiveDate` is a column rather than a
 * timestamp on the row: a rate belongs to a *day*, and a posting event picks the rate for its own
 * document date, not for "now".
 *
 * ## Direction convention — read this before writing any conversion code
 *
 * `fromCurrency` is the foreign currency, `toCurrency` is the org's base currency, and `rate` is
 * how many units of base one unit of foreign buys. So the row
 *
 *     fromCurrency = "USD", toCurrency = "SAR", rate = 3.75000000
 *
 * means **one US dollar is worth 3.75 Saudi riyals**, and conversion is a **multiplication**:
 *
 *     baseAmount = foreignAmount × rate          // 100 USD × 3.75 = 375.00 SAR
 *
 * never a division. `toBaseAmount()` in `src/lib/exchange-rates.ts` is the only implementation of
 * that arithmetic; use it rather than writing the multiply out again, so an inverted rate cannot
 * creep in through a second call site.
 *
 * ## Why `toCurrency` exists but never varies
 *
 * Phase 1 converts only to the org's base currency, so every row's `toCurrency` equals
 * `orgs.currency`. The column is kept for a future phase that reports in a second currency, but
 * the write path validates it against the org's base today (`validateRateInput`) — a row pointing
 * anywhere else would be silently ignored by `resolveRate`, which is worse than being rejected.
 *
 * ## Future-dated rates are inert, deliberately
 *
 * `resolveRate` takes the most recent row with `effectiveDate <= date`. A rate entered today with
 * next month's date therefore sits unused until that date arrives — which is the point: it lets an
 * org enter a known future rate in advance without retroactively changing what today posts at.
 */
export const exchangeRatesTable = pgTable(
  "exchange_rates",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
      .notNull()
      .references(() => orgsTable.id, { onDelete: "cascade" }),
    /** ISO 4217 code of the foreign currency being converted FROM. */
    fromCurrency: text("from_currency").notNull(),
    /** ISO 4217 code being converted TO. Always the org's base currency in Phase 1 — see above. */
    toCurrency: text("to_currency").notNull(),
    /** Units of `toCurrency` per ONE unit of `fromCurrency`. baseAmount = foreignAmount × rate. */
    rate: numeric("rate", { precision: 18, scale: 8 }).notNull(),
    /** The day this rate applies from. Used by `effectiveDate <= documentDate`, newest wins. */
    effectiveDate: date("effective_date").notNull(),
    /** Where the number came from, e.g. "SAMA" or "Bank statement 2026-03-01". Required, free text. */
    source: text("source").notNull(),
  },
  (t) => [
    // Named explicitly. Drizzle's generated name for these four columns is 64 characters, one over
    // Postgres's 63-byte identifier limit, so the server silently truncated the trailing "_unique"
    // — after which drizzle-kit could never match the constraint it had just created, and every
    // subsequent `db:push` stopped to ask whether to truncate the table. Same convention as
    // `favorites_org_user_href_uq`.
    unique("exchange_rates_org_pair_date_uq").on(t.orgId, t.fromCurrency, t.toCurrency, t.effectiveDate),
    // A numeric(18,8) column stores 0 and -1 perfectly happily, and a zero rate would silently
    // zero every converted total that used it. Rejected in the database as well as on write, so a
    // bad row cannot arrive through a path that skips the action layer.
    check("exchange_rates_rate_positive", sql`${t.rate} > 0`),
  ],
);

export const insertExchangeRateSchema = createInsertSchema(exchangeRatesTable).omit({ id: true });
export type InsertExchangeRate = z.infer<typeof insertExchangeRateSchema>;
export type ExchangeRate = typeof exchangeRatesTable.$inferSelect;

/**
 * One row per org: when a rate fetch was last ATTEMPTED, and how it went.
 *
 * This is the failure-backoff's memory. The on-demand trigger (`ensureFreshRates`) refuses to
 * re-attempt within its backoff window of `lastAttemptedAt` — measured from the attempt, success
 * or failure, so a provider outage plus a busy org never means one fetch per click. `lastError`
 * is kept so the rate screen can say WHY rates are stale rather than just that they are.
 */
export const rateFetchAttemptsTable = pgTable("rate_fetch_attempts", {
  orgId: integer("org_id")
    .primaryKey()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  lastAttemptedAt: timestamp("last_attempted_at").notNull(),
  lastSucceededAt: timestamp("last_succeeded_at"),
  lastError: text("last_error"),
});
