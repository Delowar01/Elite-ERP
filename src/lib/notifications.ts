import "server-only";
import { desc } from "drizzle-orm";
import { db, activityLogsTable } from "@/db";
import { tenantScope } from "@/lib/tenant";

export type NotificationItem = {
  id: number;
  type: string;
  description: string;
  userName: string | null;
  createdAt: string;
};

// Powers the topbar notifications bell — the most recent org activity from the
// same activity_logs feed the dashboard "Recent Activities" widget reads.
export async function getRecentNotifications(orgId: number, limit = 8): Promise<NotificationItem[]> {
  const rows = await db
    .select()
    .from(activityLogsTable)
    .where(tenantScope(orgId, activityLogsTable))
    .orderBy(desc(activityLogsTable.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    description: r.description,
    userName: r.userName,
    createdAt: r.createdAt.toISOString(),
  }));
}
