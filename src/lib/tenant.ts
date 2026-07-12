import { eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { ROLE_RANK, type Role } from "@/db/schema";

// Every org-scoped query must filter by the session's orgId — never a client-supplied id.
export function tenantScope(orgId: number, column: PgColumn): SQL {
  return eq(column, orgId);
}

// A user can only grant/assign a role at or below their own rank (no self-escalation via others).
export function canAssignRole(actorRole: Role, targetRole: Role): boolean {
  return ROLE_RANK[actorRole] >= ROLE_RANK[targetRole];
}
