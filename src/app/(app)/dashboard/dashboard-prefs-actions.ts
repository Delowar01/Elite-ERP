"use server";

import { revalidatePath } from "next/cache";
import { db, userPreferencesTable } from "@/db";
import { requireSession } from "@/lib/session";
import { isDashboardRange } from "@/lib/dashboard-range";
import { normalizeLayout, type DashboardLayoutItem } from "@/lib/dashboard-layout";

export type PrefResult = { error?: string; ok?: boolean };

async function upsertPref(orgId: number, userId: number, set: Record<string, unknown>) {
  const now = new Date();
  await db
    .insert(userPreferencesTable)
    .values({ orgId, userId, ...set })
    .onConflictDoUpdate({
      target: [userPreferencesTable.orgId, userPreferencesTable.userId],
      set: { ...set, updatedAt: now },
    });
}

// Persist the user's chosen dashboard date range (per-user default the next visit uses).
export async function setDashboardRangeAction(range: string): Promise<PrefResult> {
  const session = await requireSession();
  if (!isDashboardRange(range)) return { error: "Invalid range." };
  await upsertPref(session.orgId, session.userId, { dashboardRange: range });
  revalidatePath("/dashboard");
  return { ok: true };
}

// Persist the user's dashboard layout (widget visibility + order). Normalized before storing so
// only known widgets in a complete list are saved.
export async function saveDashboardLayoutAction(layout: DashboardLayoutItem[]): Promise<PrefResult> {
  const session = await requireSession();
  const clean = normalizeLayout(layout);
  await upsertPref(session.orgId, session.userId, { dashboardLayout: clean });
  revalidatePath("/dashboard");
  return { ok: true };
}
