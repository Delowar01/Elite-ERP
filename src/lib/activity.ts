import "server-only";
import { db, activityLogsTable, type Tx } from "@/db";
import type { Session } from "./session";

// Every create/update/archive/delete/restore action for a tracked entity writes one row here.
// This is the single data source both the Recycle Bin's "who deleted this" note and, later,
// the Document Timeline / Version History views read from — not a parallel tracking table.
// PO-03A: `executor` lets a Team change write its record inside its own transaction (a refused or failed change
// leaves no record); default: autocommit, exactly as every existing caller writes it.
export async function logActivity(
  session: Session,
  entry: {
    type: string;
    description: string;
    entityType: string;
    entityId: number;
  },
  executor: Tx | typeof db = db,
) {
  await executor.insert(activityLogsTable).values({
    orgId: session.orgId,
    type: entry.type,
    description: entry.description,
    entityType: entry.entityType,
    entityId: entry.entityId,
    userId: session.userId,
    userName: session.name,
  });
}
