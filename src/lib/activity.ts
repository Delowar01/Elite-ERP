import "server-only";
import { db, activityLogsTable } from "@/db";
import type { Session } from "./session";

// Every create/update/archive/delete/restore action for a tracked entity writes one row here.
// This is the single data source both the Recycle Bin's "who deleted this" note and, later,
// the Document Timeline / Version History views read from — not a parallel tracking table.
export async function logActivity(
  session: Session,
  entry: {
    type: string;
    description: string;
    entityType: string;
    entityId: number;
  },
) {
  await db.insert(activityLogsTable).values({
    orgId: session.orgId,
    type: entry.type,
    description: entry.description,
    entityType: entry.entityType,
    entityId: entry.entityId,
    userId: session.userId,
    userName: session.name,
  });
}
