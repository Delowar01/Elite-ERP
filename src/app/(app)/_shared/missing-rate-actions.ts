"use server";

import { requireSession } from "@/lib/session";
import { ensureFreshRates, type FetchOutcome } from "@/lib/rates/fetch-rates";

/**
 * The one-click rescue behind a blocked posting: "no rate for this currency" → fetch one now,
 * awaited, then the caller retries the posting.
 *
 * Gated on authentication, NOT on the owner/admin manual-entry privilege — deliberately. This
 * triggers the same automatic provider fetch the read paths already fire in the background for any
 * signed-in user: org-scoped, provider-sourced, and it can never overwrite a manual row. Anyone
 * allowed to attempt the posting may retry it with fresh provider data; entering a rate by hand
 * stays owner/admin. `only` is intersected with pairs-in-use inside the engine, so a caller cannot
 * widen the org's fetch scope by naming an arbitrary currency — and the org id comes from the
 * session, never from the caller.
 */
export async function fetchMissingRateAction(currency: string): Promise<{ outcome: FetchOutcome }> {
  const session = await requireSession();
  const outcome = await ensureFreshRates(session.orgId, { force: true, only: [currency] });
  return { outcome };
}
