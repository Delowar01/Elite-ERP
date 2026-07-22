import "server-only";
import { and, desc, eq, gt } from "drizzle-orm";
import { db, activityLogsTable, notificationReadsTable, userPreferencesTable } from "@/db";
import { tenantScope } from "@/lib/tenant";
import { notificationHref } from "@/lib/notification-routes";

export type NotificationItem = {
  id: number;
  type: string;
  description: string;
  userName: string | null;
  createdAt: string;
  read: boolean;
  href: string | null;
};

export type NotificationsData = {
  items: NotificationItem[];
  unreadCount: number;
};

// Powers the topbar notifications bell — the most recent org activity from the same
// append-only activity_logs feed the dashboard "Recent Activities" widget reads. Read state is
// per-user and layered on top without ever mutating the audit feed: an item is read when its id
// has a notification_reads row for this user, OR its createdAt is at/before this user's
// "mark all read" watermark. Fully tenant- AND user-scoped.
export async function getNotifications(orgId: number, userId: number, limit = 10): Promise<NotificationsData> {
  const [rows, reads, prefRow] = await Promise.all([
    db
      .select()
      .from(activityLogsTable)
      .where(tenantScope(orgId, activityLogsTable))
      .orderBy(desc(activityLogsTable.createdAt))
      .limit(limit),
    db
      .select({ activityId: notificationReadsTable.activityId })
      .from(notificationReadsTable)
      .where(and(eq(notificationReadsTable.orgId, orgId), eq(notificationReadsTable.userId, userId))),
    db
      .select({ readAt: userPreferencesTable.notificationsReadAt })
      .from(userPreferencesTable)
      .where(and(eq(userPreferencesTable.orgId, orgId), eq(userPreferencesTable.userId, userId))),
  ]);

  const readIds = new Set(reads.map((r) => r.activityId));
  const watermark = prefRow[0]?.readAt ?? null;

  const items = rows.map((r) => ({
    id: r.id,
    type: r.type,
    description: r.description,
    userName: r.userName,
    createdAt: r.createdAt.toISOString(),
    read: readIds.has(r.id) || (watermark != null && r.createdAt <= watermark),
    href: notificationHref(r.entityType, r.entityId),
  }));

  // The badge counts everything currently unread for this user across the whole feed, not just
  // the page shown — cheaper as one count query against the same watermark + read set.
  const unreadCount = await countUnread(orgId, userId, watermark, readIds);
  return { items, unreadCount };
}

async function countUnread(orgId: number, userId: number, watermark: Date | null, readIds: Set<number>): Promise<number> {
  const conds = [tenantScope(orgId, activityLogsTable)];
  if (watermark) conds.push(gt(activityLogsTable.createdAt, watermark));
  const rows = await db.select({ id: activityLogsTable.id }).from(activityLogsTable).where(and(...conds));
  // Exclude individually-read ids. readIds already covers items at/under the watermark too, but
  // the watermark filter above removed those, so this only subtracts reads newer than it.
  return rows.reduce((n, r) => (readIds.has(r.id) ? n : n + 1), 0);
}
