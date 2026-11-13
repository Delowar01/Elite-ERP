import "server-only";
import { eq, sql, type SQL } from "drizzle-orm";
import { db, orgsTable, tenantAccessControlsTable, type Tx } from "@/db";

// ---------------------------------------------------------------------------------------------
// Company access — THE compatibility rule for organizations (PO-02A; PR #11 Schema.md §4.1,
// TRD §4; PO-00 §F.4 M2).
//
//  • An organization with NO tenant_access_controls row existed before PO-02. It is ACTIVE
//    (grandfathered). This module is the only place that rule is written; PO-02A backfills
//    nothing and modifies no existing company.
//  • A row decides otherwise; only 'active' grants access. Any other value — impossible under
//    tenant_access_controls_status_chk, but a drifted or hand-edited database could hold one —
//    fails CLOSED: it resolves to suspended, never to active.
//  • Subscription state never enters this decision. Expiry, trials and payments cannot suspend a
//    company (Schema.md §11 items 5–7, TRD §7.2); only an explicit, attributed platform action can
//    (PO-02C), and the database refuses a suspended row without a responsible administrator.
//  • Read-only. PO-02A wires this into nothing: the customer session / login / file / export
//    checks that will consult it are PO-02C, under separate approval.
// ---------------------------------------------------------------------------------------------

export const TENANT_ACCESS_STATUSES = ["active", "suspended"] as const;
export type TenantAccessStatus = (typeof TENANT_ACCESS_STATUSES)[number];

export type TenantAccess =
  /** No row: a pre-existing organization, active by the compatibility rule. */
  | { status: "active"; source: "legacy_default" }
  /** A row with a known status. */
  | { status: TenantAccessStatus; source: "access_control" }
  /** A row whose status is not a known value: fails closed. */
  | { status: "suspended"; source: "invalid_state" };

/** The compatibility rule for one organization's row as read (`null` = no row). Pure. */
export function resolveTenantAccess(row: { accessStatus: unknown } | null | undefined): TenantAccess {
  if (!row) return { status: "active", source: "legacy_default" };
  if (row.accessStatus === "active" || row.accessStatus === "suspended") return { status: row.accessStatus, source: "access_control" };
  return { status: "suspended", source: "invalid_state" };
}

/**
 * The same rule as one SQL expression, for queries that LEFT JOIN tenant_access_controls on the
 * organization (the PO-02B directory, the PO-02C session check). Fails closed exactly like
 * resolveTenantAccess: no row → 'active'; 'active' → 'active'; anything else → 'suspended'.
 */
export const effectiveTenantAccessSql: SQL<TenantAccessStatus> = sql<TenantAccessStatus>`(case when ${tenantAccessControlsTable.orgId} is null then 'active' when ${tenantAccessControlsTable.accessStatus} = 'active' then 'active' else 'suspended' end)`;

/** Effective access of one organization, or null when no such organization exists. */
export async function getTenantAccess(orgId: number, executor: Tx | typeof db = db): Promise<TenantAccess | null> {
  if (!Number.isSafeInteger(orgId) || orgId <= 0) return null;
  const [row] = await executor
    .select({ orgId: orgsTable.id, accessRowOrgId: tenantAccessControlsTable.orgId, accessStatus: tenantAccessControlsTable.accessStatus })
    .from(orgsTable)
    .leftJoin(tenantAccessControlsTable, eq(tenantAccessControlsTable.orgId, orgsTable.id))
    .where(eq(orgsTable.id, orgId))
    .limit(1);
  if (!row) return null;
  return resolveTenantAccess(row.accessRowOrgId === null ? null : { accessStatus: row.accessStatus });
}
