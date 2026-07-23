"use server";

import { db, documentColumnConfigsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { resolveColumns, validateColumns, type ColumnDef } from "@/lib/column-config";

const DOC_TYPES = new Set(["quotation", "sales_order", "proforma_invoice", "sales_invoice", "purchase_order"]);

export type ColumnConfigResult = { error?: string; ok?: boolean };

// Save the current user's line-item column configuration for one document type. Tenant- AND
// user-scoped (one row per org+user+documentType). Server-side validation mirrors the client's,
// so a tampered payload is rejected the same way.
export async function saveColumnConfigAction(documentType: string, columns: ColumnDef[]): Promise<ColumnConfigResult> {
  const session = await requireSession();
  if (!DOC_TYPES.has(documentType)) return { error: "Unknown document type." };

  // Resolve first (normalizes/guards shape, forces Actions last + required visible), then validate.
  const resolved = resolveColumns(columns);
  const err = validateColumns(resolved);
  if (err) return { error: err };

  const now = new Date();
  await db
    .insert(documentColumnConfigsTable)
    .values({ orgId: session.orgId, userId: session.userId, documentType, config: resolved, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [documentColumnConfigsTable.orgId, documentColumnConfigsTable.userId, documentColumnConfigsTable.documentType],
      set: { config: resolved, updatedAt: now },
    });

  await logActivity(session, {
    type: "column-config.updated",
    description: `Updated line-item columns for ${documentType}`,
    entityType: "document_column_config",
    entityId: session.userId,
  });
  return { ok: true };
}
