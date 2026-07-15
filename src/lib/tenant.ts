import { and, eq, ne, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { ROLE_RANK, type Role } from "@/db/schema";

type TenantTable = {
  orgId: PgColumn;
  recordState?: PgColumn;
};

export type TenantScopeOptions = {
  /** Include rows the user has archived. Default: excluded (matches a normal list view). */
  includeArchived?: boolean;
  /** Include soft-deleted rows. Default: excluded — the Recycle Bin queries these explicitly instead. */
  includeDeleted?: boolean;
};

// Every org-scoped query must filter by the session's orgId — never a client-supplied id.
// This is the only legal way to query tenant data; a raw `db.select().from(table)` with no
// org filter should never appear in review. For tables with a `recordState` column, this also
// applies the soft-delete default: archived/deleted rows are excluded unless explicitly requested.
export function tenantScope(orgId: number, table: TenantTable, opts: TenantScopeOptions = {}): SQL {
  const clauses: SQL[] = [eq(table.orgId, orgId)];
  if (table.recordState) {
    if (!opts.includeDeleted) clauses.push(ne(table.recordState, "deleted"));
    if (!opts.includeArchived) clauses.push(ne(table.recordState, "archived"));
  }
  return and(...clauses)!;
}

// A user can only grant/assign a role at or below their own rank (no self-escalation via others).
export function canAssignRole(actorRole: Role, targetRole: Role): boolean {
  return ROLE_RANK[actorRole] >= ROLE_RANK[targetRole];
}
