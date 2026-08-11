import "server-only";

/**
 * FX-3: the rate-provider interface.
 *
 * One method: given the org's base currency and the foreign currencies it actually uses, return
 * dated rates and say where they came from. Everything else — pair selection, validation, the
 * manual-wins rule, backoff — lives in `fetch-rates.ts` and applies identically to every provider,
 * so adding a country's central bank later is a new implementation of THIS type, not a redesign.
 *
 * ## Provider selection is per org country
 *
 * `providerForCountry` is the chain: a country with its own named source resolves to that
 * provider; everywhere else gets the general one.
 *
 * **The KSA slot is a documented gap, deliberately.** SAMA is the target source for Saudi orgs —
 * it runs an Open Data Portal with an API service — but its API service document sits behind a
 * network boundary this development environment cannot cross, and building a provider against an
 * endpoint nobody here has inspected would be guesswork wearing a class definition. Until the
 * document is read from an unblocked network (see docs/backlog.md), Saudi orgs use the general
 * provider like everyone else, and an org that wants ZATCA-exact SAMA figures enters them
 * manually — which always wins over fetched rates anyway.
 *
 * ## The date on a fetched rate is the PROVIDER's date
 *
 * A provider reports rates as of its own update time, and the row is stored under that date —
 * never under the date the caller wished it had. Claiming today's rate was March's would be a
 * fabricated historical figure in a table that feeds the ledger. `resolveRate`'s
 * most-recent-on-or-before rule then decides, honestly, which documents that rate can serve.
 */

export type ProviderRate = {
  /** ISO 4217 code of the foreign currency this rate converts FROM. */
  currency: string;
  /** Units of base currency per one unit of `currency`, as a decimal string (≤ 8 dp). */
  rate: string;
};

export type ProviderResult = {
  rates: ProviderRate[];
  /** The date (YYYY-MM-DD) the provider states these rates are for — its date, not the caller's. */
  rateDate: string;
  /** Currencies the provider could not supply, reported rather than silently missing. */
  unavailable: string[];
};

export type RateProvider = {
  /** Recorded in `source` on every row this provider writes, with the retrieval date appended. */
  id: string;
  /**
   * Human-readable attribution the UI must show wherever this provider's rates display.
   * Null when the source imposes no attribution requirement.
   */
  attribution: { text: string; href: string } | null;
  fetchRates(args: { baseCurrency: string; currencies: string[] }): Promise<ProviderResult>;
};

import { openErApiProvider } from "./open-er-api";

export function providerForCountry(country: string | null | undefined): RateProvider {
  switch ((country ?? "").trim()) {
    // case "Saudi Arabia": return samaProvider — the documented gap described above.
    default:
      return openErApiProvider;
  }
}
