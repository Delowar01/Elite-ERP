"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, activityLogsTable, notificationReadsTable, userPreferencesTable } from "@/db";
import { requireSession } from "@/lib/session";

export type ActionResult = { error?: string; ok?: boolean };

// Mark a single notification read for the current user. Tenant- AND user-scoped: we first
// confirm the activity row belongs to the caller's org, then record the read (idempotent).
// The append-only activity_logs feed is never mutated.
export async function markNotificationRead(activityId: number): Promise<ActionResult> {
  const session = await requireSession();
  const [row] = await db
    .select({ id: activityLogsTable.id })
    .from(activityLogsTable)
    .where(and(eq(activityLogsTable.id, activityId), eq(activityLogsTable.orgId, session.orgId)));
  if (!row) return { error: "Notification not found." };

  await db
    .insert(notificationReadsTable)
    .values({ orgId: session.orgId, userId: session.userId, activityId })
    .onConflictDoNothing({ target: [notificationReadsTable.orgId, notificationReadsTable.userId, notificationReadsTable.activityId] });
  revalidatePath("/", "layout");
  return { ok: true };
}

// Mark every notification read for the current user by advancing their "read watermark" to now.
// Stored on the per-(org,user) preferences row (upserted). Everything at/older than the
// watermark counts as read without writing a row per item.
export async function markAllNotificationsRead(): Promise<ActionResult> {
  const session = await requireSession();
  const now = new Date();
  await db
    .insert(userPreferencesTable)
    .values({ orgId: session.orgId, userId: session.userId, notificationsReadAt: now })
    .onConflictDoUpdate({
      target: [userPreferencesTable.orgId, userPreferencesTable.userId],
      set: { notificationsReadAt: now, updatedAt: now },
    });
  revalidatePath("/", "layout");
  return { ok: true };
}
