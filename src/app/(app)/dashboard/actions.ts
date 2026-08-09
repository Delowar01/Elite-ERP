"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, orgsTable } from "@/db";
import { requireRole } from "@/lib/session";
import { logActivity } from "@/lib/activity";

/**
 * Dismisses the one-time base-currency confirmation by stamping the org row. Permanent: the notice
 * is keyed off `baseCurrencyConfirmedAt IS NULL`, so it will not return on another device or after
 * the next login.
 *
 * Owner/admin only, matching who can actually change the currency — the notice is not shown to
 * anyone else, and the guard here is what makes that true rather than merely displayed.
 *
 * Idempotent, and it deliberately does NOT overwrite an existing stamp: a second call from a stale
 * tab must not move the date that recorded the real decision.
 */
export async function confirmBaseCurrencyAction(): Promise<void> {
  const session = await requireRole("owner", "admin");

  const [org] = await db
    .select({ confirmedAt: orgsTable.baseCurrencyConfirmedAt, currency: orgsTable.currency })
    .from(orgsTable)
    .where(eq(orgsTable.id, session.orgId))
    .limit(1);

  if (!org || org.confirmedAt) return;

  await db
    .update(orgsTable)
    .set({ baseCurrencyConfirmedAt: new Date(), updatedAt: new Date() })
    .where(eq(orgsTable.id, session.orgId));

  await logActivity(session, {
    type: "org.updated",
    description: `Confirmed base currency ${org.currency}`,
    entityType: "org",
    entityId: session.orgId,
  });

  revalidatePath("/dashboard");
}
