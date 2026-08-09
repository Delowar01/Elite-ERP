import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, orgsTable, journalEntriesTable } from "@/db";

/**
 * The one-time base-currency confirmation.
 *
 * Registration now asks for a country and a base currency, and stamps `baseCurrencyConfirmedAt` on
 * the way in. Orgs created before that were never asked: `orgs.currency` simply defaulted to SAR,
 * so a non-Saudi org has been carrying a Saudi base currency it never chose — and once FX-1b locks
 * the currency on the first posted base amount, that silent default becomes permanent.
 *
 * So this exists to give exactly those orgs one chance to look at it. It is not a wizard, it blocks
 * nothing, and it disappears for good once dismissed.
 */
export type BaseCurrencyConfirmation = { currency: string; country: string | null };

/**
 * Whether to show the confirmation, and what to show in it. Null means do not show.
 *
 * Three conditions, all required:
 *
 *  - **Never asked.** `baseCurrencyConfirmedAt IS NULL`. Every org created since registration
 *    started asking is stamped, so this population only shrinks.
 *  - **Nothing posted yet.** No journal entries. After the first posting the currency is a fact
 *    about existing ledger rows, not a setting — offering to "confirm" it then would imply it can
 *    still be changed, which FX-1b makes false.
 *  - **Can act on it.** Only owners and admins can change the currency (`updateBusinessDetailsAction`
 *    is `requireRole("owner", "admin")`), so showing staff a notice about a setting they cannot
 *    reach is noise.
 */
export async function getBaseCurrencyConfirmation(
  orgId: number,
  role: string,
): Promise<BaseCurrencyConfirmation | null> {
  if (role !== "owner" && role !== "admin") return null;

  const [org] = await db
    .select({
      currency: orgsTable.currency,
      country: orgsTable.country,
      confirmedAt: orgsTable.baseCurrencyConfirmedAt,
    })
    .from(orgsTable)
    .where(eq(orgsTable.id, orgId))
    .limit(1);

  if (!org || org.confirmedAt) return null;

  const [posted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(journalEntriesTable)
    .where(eq(journalEntriesTable.orgId, orgId));

  if ((posted?.n ?? 0) > 0) return null;

  return { currency: org.currency, country: org.country };
}
