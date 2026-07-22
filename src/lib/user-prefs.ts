import "server-only";
import { and, eq } from "drizzle-orm";
import { db, userPreferencesTable } from "@/db";
import { isDashboardRange, type DashboardRange } from "./dashboard-range";
import { normalizeLayout, type DashboardLayoutItem } from "./dashboard-layout";

export type DashboardPrefs = {
  range: DashboardRange;
  layout: DashboardLayoutItem[];
};

// Per-(org,user) dashboard preferences, with safe defaults when no row exists yet.
export async function getDashboardPrefs(orgId: number, userId: number): Promise<DashboardPrefs> {
  const [row] = await db
    .select({ range: userPreferencesTable.dashboardRange, layout: userPreferencesTable.dashboardLayout })
    .from(userPreferencesTable)
    .where(and(eq(userPreferencesTable.orgId, orgId), eq(userPreferencesTable.userId, userId)));
  return {
    range: isDashboardRange(row?.range) ? (row!.range as DashboardRange) : "this_month",
    layout: normalizeLayout(row?.layout),
  };
}
