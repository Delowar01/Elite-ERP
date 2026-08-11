"use client";

import { t, type Locale } from "@/lib/i18n/dict";
import type { ConfirmRecovery } from "./confirm-provider";
import { fetchMissingRateAction } from "./missing-rate-actions";

/**
 * Maps a posting action's `missingRate` block into the confirm dialog's one-click recovery:
 * "Fetch rate & retry" fetches the missing currency (awaited — an explicit click is the one place
 * a fetch may sit on the request path, still capped by the provider's per-request timeout), then
 * re-runs the same posting attempt.
 *
 * The retry decides everything: rates are stored under the PROVIDER'S own date, and posting
 * resolves the most recent rate on or before the document's date. So a fetched rate dated after a
 * backdated document leaves the posting blocked — that outcome is turned into a message pointing
 * at manual entry (Preset Management → Exchange Rates) instead of re-offering a fetch that cannot
 * ever help.
 */

export type MissingRate = { currency: string; date: string };
export type RescuableResult = { error?: string; missingRate?: MissingRate; recovery?: ConfirmRecovery } | void;

export function withRateRescue(
  locale: Locale,
  result: { error?: string; missingRate?: MissingRate },
  retry: () => Promise<RescuableResult>,
): RescuableResult {
  if (!result.error || !result.missingRate) return { error: result.error };
  const { currency, date } = result.missingRate;
  return {
    error: result.error,
    missingRate: result.missingRate,
    recovery: {
      label: t(locale, "Fetch rate & retry"),
      run: async () => {
        const { outcome } = await fetchMissingRateAction(currency);
        if (outcome.status !== "fetched" || outcome.written + outcome.skippedManual === 0) {
          const why = outcome.status === "failed" ? ` (${outcome.error})` : "";
          return { error: `${t(locale, "Automatic fetch could not get a rate — enter it manually in Preset Management → Exchange Rates.")}${why}` };
        }
        const retried = await retry();
        if (retried && retried.error && retried.missingRate) {
          // A rate WAS fetched, but it is dated after this document — on-or-before cannot use it,
          // and fetching again cannot change that. Point at manual entry instead of looping.
          return {
            error: `${t(locale, "The fetched rate is dated after this document, so it cannot apply. Enter a rate manually in Preset Management → Exchange Rates for")} ${currency} · ${date}`,
          };
        }
        return retried;
      },
    },
  };
}
