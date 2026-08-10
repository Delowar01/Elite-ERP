import "server-only";
import { eq } from "drizzle-orm";
import { db, orgsTable } from "@/db";

/**
 * The organization's base currency.
 *
 * The general ledger holds base currency only, so every ledger-derived figure — a trial balance, a
 * balance-sheet total, a statement's paid/unpaid threshold — has to round and compare at the BASE
 * currency's minor unit. Those call sites are given an `orgId` and nothing else, which is why this
 * one-column lookup exists rather than threading a currency through every report signature.
 *
 * A missing org falls back to SAR — the historical default — so a report degrades to the previous
 * behaviour rather than to zero decimals.
 *
 * Not cached deliberately: an org's base currency is read a handful of times per request at most,
 * and a stale cache on a value this load-bearing is worse than the query.
 */
export async function orgBaseCurrency(orgId: number): Promise<string> {
  const [org] = await db.select({ currency: orgsTable.currency }).from(orgsTable).where(eq(orgsTable.id, orgId));
  return org?.currency ?? "SAR";
}
