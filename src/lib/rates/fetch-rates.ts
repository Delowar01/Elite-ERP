import "server-only";
import { and, eq, gte, isNotNull, ne, sql } from "drizzle-orm";
import {
  db,
  exchangeRatesTable,
  rateFetchAttemptsTable,
  orgsTable,
  quotationsTable,
  salesOrdersTable,
  proformaInvoicesTable,
  salesInvoicesTable,
  creditNotesTable,
  debitNotesTable,
  purchaseOrdersTable,
} from "@/db";
import { validateRateInput } from "@/lib/exchange-rates";
import { providerForCountry, type RateProvider } from "./provider";

/**
 * FX-3: the fetch engine. Rates become invisible to users — fetched on demand, written through the
 * same validated path as manual entry, with manual always winning.
 *
 * ## The trigger never sits on a user's request path synchronously
 *
 * Read paths call `fireEnsureFreshRates` — fire-and-forget. The screen renders whatever is stored,
 * with a staleness indicator if it is old, and the fetch fills in for next time. The ONE place a
 * fetch is awaited is the one-click on a blocked posting, where freshness is the point — and even
 * there the provider call carries a hard 5-second timeout, so a dead API degrades to "stale,
 * warned", never "hung".
 *
 * ## Backoff, stated as a rule
 *
 * **No re-attempt within 15 minutes of the last attempt, success or failure.** A provider outage
 * plus a busy org must not mean one fetch per click; `rate_fetch_attempts` remembers the last
 * attempt per org and this module refuses inside the window. The awaited one-click path uses
 * `force: true` — an explicit user click is consent to try again — but shares the in-flight lock,
 * so even clicks cannot stack concurrent fetches.
 *
 * ## Manual always wins
 *
 * A fetched rate never overwrites a row whose source is "manual" — the upsert's set-clause is
 * conditioned on it. Manual entry (`saveManualRate`) upserts unconditionally, so a manual rate
 * replaces a fetched one for the same pair and date. Both directions are asserted, and
 * mutation-proofed, in verify-rate-fetch.mts.
 *
 * ## Scope
 *
 * Per org, only the pairs in use: distinct foreign currencies across the org's documents plus any
 * pair that already has a rate row. No 160-currency pulls — and the org filter on every query here
 * is tenant isolation, not an optimisation: the trigger runs inside authenticated request context,
 * so a fetch fired by org A writing org B's rows would be a cross-tenant write.
 */

export const MANUAL_SOURCE = "manual";
/** No re-attempt within this window of the previous attempt, success or failure. */
export const FETCH_BACKOFF_MINUTES = 15;
/** The screen shows a staleness warning when the newest rate for a pair is older than this. */
export const STALE_AFTER_DAYS = 7;

export type FetchOutcome =
  | { status: "fetched"; written: number; skippedManual: number; unavailable: string[]; rateDate: string }
  | { status: "no-pairs" }
  | { status: "fresh" }
  | { status: "backoff" }
  | { status: "in-flight" }
  | { status: "failed"; error: string };

/**
 * Distinct foreign currencies THIS org uses: across its seven money-carrying document tables, plus
 * any pair that already has a rate row (an org that once tracked EUR keeps its EUR rate fresh even
 * in a quiet month).
 */
export async function pairsInUse(orgId: number, baseCurrency: string): Promise<string[]> {
  const docTables = [
    quotationsTable, salesOrdersTable, proformaInvoicesTable, salesInvoicesTable,
    creditNotesTable, debitNotesTable, purchaseOrdersTable,
  ] as const;
  const found = new Set<string>();
  for (const t of docTables) {
    const rows = await db
      .selectDistinct({ currency: t.currency })
      .from(t)
      .where(and(eq(t.orgId, orgId), isNotNull(t.currency)));
    for (const r of rows) if (r.currency) found.add(r.currency.toUpperCase());
  }
  const rated = await db
    .selectDistinct({ currency: exchangeRatesTable.fromCurrency })
    .from(exchangeRatesTable)
    .where(eq(exchangeRatesTable.orgId, orgId));
  for (const r of rated) found.add(r.currency.toUpperCase());
  found.delete(baseCurrency.toUpperCase());
  return [...found].sort();
}

/**
 * Write one provider batch through the SAME validation as manual entry. Fetched rows carry the
 * provider id plus the retrieval date as their source; the upsert updates an existing (pair, date)
 * row only when that row is not manual.
 */
async function writeFetchedRates(args: {
  orgId: number;
  baseCurrency: string;
  provider: RateProvider;
  rates: { currency: string; rate: string }[];
  rateDate: string;
}): Promise<{ written: number; skippedManual: number }> {
  const source = `${args.provider.id} (retrieved ${new Date().toISOString().slice(0, 10)})`;
  let written = 0;
  let skippedManual = 0;

  for (const r of args.rates) {
    const checked = validateRateInput({
      fromCurrency: r.currency,
      toCurrency: args.baseCurrency,
      baseCurrency: args.baseCurrency,
      rate: r.rate,
      effectiveDate: args.rateDate,
      source,
    });
    if (checked.error !== null) continue; // a provider row that fails validation is dropped, never stored

    const res = await db
      .insert(exchangeRatesTable)
      .values({ orgId: args.orgId, ...checked.value })
      .onConflictDoUpdate({
        target: [
          exchangeRatesTable.orgId,
          exchangeRatesTable.fromCurrency,
          exchangeRatesTable.toCurrency,
          exchangeRatesTable.effectiveDate,
        ],
        set: { rate: checked.value.rate, source: checked.value.source },
        // MANUAL ALWAYS WINS: a fetch never overwrites a manually entered row.
        setWhere: ne(exchangeRatesTable.source, MANUAL_SOURCE),
      })
      .returning({ id: exchangeRatesTable.id, source: exchangeRatesTable.source });

    // With setWhere unmet, Postgres returns no row — that IS the manual-win happening.
    if (res.length === 0) skippedManual += 1;
    else written += 1;
  }
  return { written, skippedManual };
}

/**
 * Manual entry: validated identically, `source: "manual"`, and the upsert is UNCONDITIONAL — a
 * manual rate replaces a fetched one for the same pair and date. The other half of manual-wins.
 */
export async function saveManualRate(args: {
  orgId: number;
  baseCurrency: string;
  fromCurrency: string;
  rate: string;
  effectiveDate: string;
}): Promise<{ error: string } | { error: null }> {
  const checked = validateRateInput({
    fromCurrency: args.fromCurrency,
    toCurrency: args.baseCurrency,
    baseCurrency: args.baseCurrency,
    rate: args.rate,
    effectiveDate: args.effectiveDate,
    source: MANUAL_SOURCE,
  });
  if (checked.error !== null) return { error: checked.error };

  await db
    .insert(exchangeRatesTable)
    .values({ orgId: args.orgId, ...checked.value })
    .onConflictDoUpdate({
      target: [
        exchangeRatesTable.orgId,
        exchangeRatesTable.fromCurrency,
        exchangeRatesTable.toCurrency,
        exchangeRatesTable.effectiveDate,
      ],
      set: { rate: checked.value.rate, source: MANUAL_SOURCE },
    });
  return { error: null };
}

// One fetch per org at a time. A module-level map is sufficient because the deployment is a single
// long-running server process (plain `npm start` behind pm2); a multi-process deployment would move
// this into the attempts table, which is the seam for that.
const inFlight = new Map<number, Promise<FetchOutcome>>();

export async function ensureFreshRates(
  orgId: number,
  opts: { provider?: RateProvider; force?: boolean; only?: string[] } = {},
): Promise<FetchOutcome> {
  const existing = inFlight.get(orgId);
  if (existing) return opts.force ? existing : { status: "in-flight" };

  const run = (async (): Promise<FetchOutcome> => {
    const [org] = await db
      .select({ currency: orgsTable.currency, country: orgsTable.country })
      .from(orgsTable)
      .where(eq(orgsTable.id, orgId));
    if (!org) return { status: "failed", error: "Organization not found." };
    const base = org.currency ?? "SAR";

    let pairs = await pairsInUse(orgId, base);
    // The screen's per-pair "fetch now". An INTERSECTION with pairs-in-use, never a way to widen
    // scope: a currency the org does not use cannot be fetched by naming it here.
    if (opts.only?.length) {
      const wanted = new Set(opts.only.map((c) => c.toUpperCase()));
      pairs = pairs.filter((p) => wanted.has(p));
    }
    if (pairs.length === 0) return { status: "no-pairs" };

    const today = new Date().toISOString().slice(0, 10);
    if (!opts.force) {
      // Fresh enough? The newest FETCHED-OR-MANUAL rate across the pairs being from today means
      // today's bulletin already landed.
      const [newest] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(exchangeRatesTable)
        .where(and(eq(exchangeRatesTable.orgId, orgId), gte(exchangeRatesTable.effectiveDate, today)));
      if (newest.n >= pairs.length) return { status: "fresh" };

      // Backoff: no re-attempt within the window of the last attempt, success or failure.
      const [attempt] = await db
        .select({ at: rateFetchAttemptsTable.lastAttemptedAt })
        .from(rateFetchAttemptsTable)
        .where(eq(rateFetchAttemptsTable.orgId, orgId));
      if (attempt && Date.now() - attempt.at.getTime() < FETCH_BACKOFF_MINUTES * 60_000) {
        return { status: "backoff" };
      }
    }

    const now = new Date();
    await db
      .insert(rateFetchAttemptsTable)
      .values({ orgId, lastAttemptedAt: now })
      .onConflictDoUpdate({ target: rateFetchAttemptsTable.orgId, set: { lastAttemptedAt: now } });

    const provider = opts.provider ?? providerForCountry(org.country);
    try {
      const result = await provider.fetchRates({ baseCurrency: base, currencies: pairs });
      const { written, skippedManual } = await writeFetchedRates({
        orgId, baseCurrency: base, provider, rates: result.rates, rateDate: result.rateDate,
      });
      await db
        .update(rateFetchAttemptsTable)
        .set({ lastSucceededAt: new Date(), lastError: null })
        .where(eq(rateFetchAttemptsTable.orgId, orgId));
      return { status: "fetched", written, skippedManual, unavailable: result.unavailable, rateDate: result.rateDate };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await db
        .update(rateFetchAttemptsTable)
        .set({ lastError: message })
        .where(eq(rateFetchAttemptsTable.orgId, orgId));
      return { status: "failed", error: message };
    }
  })();

  inFlight.set(orgId, run);
  try {
    return await run;
  } finally {
    inFlight.delete(orgId);
  }
}

/**
 * The read-path trigger: fire and forget. Never awaited, never throws into the request, so a slow
 * or dead provider costs a screen load nothing — the page renders stored rates plus the staleness
 * indicator, and this fills in for next time.
 */
export function fireEnsureFreshRates(orgId: number): void {
  void ensureFreshRates(orgId).catch(() => {
    // The attempts table already recorded the error; a fire-and-forget path has no one to tell.
  });
}
