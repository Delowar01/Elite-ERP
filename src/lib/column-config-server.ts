import "server-only";
import { and, eq } from "drizzle-orm";
import { db, documentColumnConfigsTable } from "@/db";
import { resolveColumns, type ColumnDef } from "./column-config";

// Load a user's saved column configuration for a document type, resolved against the current
// defaults. Returns the default columns when no row exists. Tenant- AND user-scoped.
export async function getColumnConfig(orgId: number, userId: number, documentType: string): Promise<ColumnDef[]> {
  const [row] = await db
    .select({ config: documentColumnConfigsTable.config })
    .from(documentColumnConfigsTable)
    .where(
      and(
        eq(documentColumnConfigsTable.orgId, orgId),
        eq(documentColumnConfigsTable.userId, userId),
        eq(documentColumnConfigsTable.documentType, documentType),
      ),
    );
  return resolveColumns(row?.config ?? null);
}
