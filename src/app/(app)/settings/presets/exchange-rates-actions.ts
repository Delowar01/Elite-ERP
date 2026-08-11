"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { ensureFreshRates, saveManualRate, type FetchOutcome } from "@/lib/rates/fetch-rates";

// Exchange-rate management actions. Gated Owner/Admin server-side, exactly like the other preset
// actions — the page gate alone is decoration, the action gate is the boundary.

const PATH = "/settings/presets";

export type RateActionResult = { error?: string };

export async function saveManualRateAction(input: {
  fromCurrency: string;
  rate: string;
  effectiveDate: string;
}): Promise<RateActionResult> {
  const session = await requireRole("owner", "admin");
  const result = await saveManualRate({
    orgId: session.orgId,
    baseCurrency: session.orgCurrency,
    fromCurrency: input.fromCurrency,
    rate: input.rate,
    effectiveDate: input.effectiveDate,
  });
  if (result.error) return { error: result.error };
  await logActivity(session, {
    type: "exchange_rate.saved",
    description: `Set ${input.fromCurrency.toUpperCase()} → ${session.orgCurrency} rate ${input.rate} for ${input.effectiveDate} (manual)`,
    entityType: "exchange_rate",
    entityId: session.orgId,
  });
  revalidatePath(PATH);
  return {};
}

/**
 * The screen's "fetch now" — for one pair (`only`) or all pairs-in-use. This is the AWAITED fetch
 * path: an explicit click is consent to try immediately, so it forces past the freshness check and
 * the backoff window. The provider call itself still carries its hard timeout, so a dead API
 * returns "failed" in a few seconds rather than hanging the click.
 */
export async function fetchRatesNowAction(only?: string[]): Promise<{ outcome: FetchOutcome }> {
  const session = await requireRole("owner", "admin");
  const outcome = await ensureFreshRates(session.orgId, { force: true, only });
  revalidatePath(PATH);
  return { outcome };
}
