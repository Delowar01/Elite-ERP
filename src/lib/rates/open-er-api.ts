import "server-only";
import type { RateProvider, ProviderRate } from "./provider";

/**
 * The general rate provider: ExchangeRate-API's keyless open endpoint (open.er-api.com).
 *
 * Chosen because it covers ~160 currencies including every GCC base, updates daily, and needs no
 * API key — the terms ask for attribution instead, which `attribution` carries and the rate screen
 * displays wherever fetched rates appear. Chosen ON PAPER: the development sandbox's egress proxy
 * blocks every rate API, so this implementation could not be exercised against the live service
 * here. `npm run smoke:rates` exists precisely to run that check from the deployment box, which is
 * the only place the answer is real.
 *
 * ## One request per foreign currency, by design
 *
 * `GET /v6/latest/{FOREIGN}` returns how much of every currency one unit of FOREIGN buys, so
 * `rates[BASE]` is directly "units of base per one unit of foreign" — exactly the multiply
 * convention `exchangeRatesTable` documents. The alternative (one call for the base, inverted per
 * pair) would divide, and the direction convention exists because dividing is how rates get
 * silently entered backwards. Orgs use a handful of pairs and the endpoint tolerates hourly
 * calls, so the extra requests cost nothing that matters.
 *
 * ## The timeout is load-bearing
 *
 * Every call is capped at five seconds. The fetch runs un-awaited on read paths, but the awaited
 * one-click path must degrade to "stale, warned" rather than "hung" when the API is dead.
 *
 * `RATE_API_BASE` overrides the endpoint — ordinary configuration, used by the browser tier to
 * point the REAL production code at a local mock (localhost bypasses the proxy), so the one-click
 * flow is testable end-to-end without a live API in the loop.
 */

const API_BASE = () => process.env.RATE_API_BASE ?? "https://open.er-api.com/v6";
const TIMEOUT_MS = 5000;

export const openErApiProvider: RateProvider = {
  id: "open.er-api.com",
  attribution: { text: "Rates By Exchange Rate API", href: "https://www.exchangerate-api.com" },

  async fetchRates({ baseCurrency, currencies }) {
    const base = baseCurrency.toUpperCase();
    const rates: ProviderRate[] = [];
    const unavailable: string[] = [];
    let rateDate: string | null = null;

    for (const raw of currencies) {
      const foreign = raw.toUpperCase();
      try {
        const res = await fetch(`${API_BASE()}/latest/${foreign}`, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          // The endpoint updates once a day; a same-process cache would mask the mock in tests and
          // the backoff in fetch-rates.ts already prevents hammering.
          cache: "no-store",
        });
        if (!res.ok) {
          unavailable.push(foreign);
          continue;
        }
        const body = (await res.json()) as {
          result?: string;
          time_last_update_utc?: string;
          rates?: Record<string, number>;
        };
        const value = body.result === "success" ? body.rates?.[base] : undefined;
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
          unavailable.push(foreign);
          continue;
        }
        // The provider's own update date. All pairs come from the same daily bulletin, so the
        // first parsed date stands for the batch; a missing header degrades to today.
        if (!rateDate && body.time_last_update_utc) {
          const d = new Date(body.time_last_update_utc);
          if (!Number.isNaN(d.getTime())) rateDate = d.toISOString().slice(0, 10);
        }
        rates.push({ currency: foreign, rate: value.toFixed(8) });
      } catch {
        // Timeout or network failure — this currency is unavailable this round; the caller's
        // backoff decides when to try again, and staleness is surfaced in the UI, never a block.
        unavailable.push(foreign);
      }
    }

    return { rates, rateDate: rateDate ?? new Date().toISOString().slice(0, 10), unavailable };
  },
};
