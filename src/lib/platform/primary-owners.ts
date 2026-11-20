import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { db, tenantPrimaryOwnersTable, type Tx } from "@/db";
import { isCustomerInviteAcceptanceEnabled } from "./flags";

// ---------------------------------------------------------------------------------------------
// Platform Owner PO-03A — a company's PRIMARY OWNER (tenant_primary_owners, PO-02D1A F5; decisions O-2, O-3).
//
//  • READ-ONLY. The one writer of a mapping is the PO-02D3 acceptance core (one insert, in the transaction that
//    creates the company). Nothing transfers, backfills (O-2: legacy companies stay "not designated") or deletes one.
//  • Consulted by exactly one customer module, src/lib/team/ownership-gate.ts (every Team change and the Team page),
//    and by the Platform Owner read model (companies.ts) for the company detail.
//  • Staged rollout (PO-03A §7). Whether the table exists is asked of the catalog, explicitly: to_regclass() on the
//    UNQUALIFIED name resolves through the search_path exactly like the application's own queries. A missing TABLE is
//    never inferred from a failing query, and a failing query is never read as a missing ROW — every error propagates
//    and the caller fails closed.
//      installed → every protected Team change is checked against the mapping, whatever any flag says;
//      absent    → no mapping can exist here — unless a feature that CREATES mappings is switched on
//                  (CUSTOMER_INVITE_ACCEPTANCE_ENABLED): the absence is then a deployment-order error and the gate
//                  refuses every protected change.
// ---------------------------------------------------------------------------------------------

type Executor = Tx | typeof db;

export type PrimaryOwnerFoundation = "installed" | "absent";

/** The catalog's answer for the mapping table (an explicit fact, never derived from an error). */
export async function primaryOwnerFoundation(executor: Executor = db): Promise<PrimaryOwnerFoundation> {
  const result = await executor.execute(sql`select to_regclass('tenant_primary_owners') is not null as present`);
  const row = result.rows[0] as { present?: unknown } | undefined;
  if (typeof row?.present !== "boolean") throw new Error("primary-owner foundation probe returned no answer");
  return row.present ? "installed" : "absent";
}

/** True while a feature that creates primary-owner mappings is switched on: the mapping table must then exist. */
export function primaryOwnerMappingsExpected(): boolean {
  return isCustomerInviteAcceptanceEnabled();
}

export type PrimaryOwnerMapping = { userId: number };

function single(rows: { userId: number }[]): PrimaryOwnerMapping | null {
  // org_id is the table's primary key: two rows mean the foundation is not what PO-02D1 installed — fail closed.
  if (rows.length > 1) throw new Error("tenant_primary_owners holds more than one row for one company");
  return rows.length ? { userId: rows[0].userId } : null;
}

/**
 * Inside the caller's READ COMMITTED Team-change transaction, AFTER it has locked the company row and the affected
 * user rows (src/lib/team/member-changes.ts). FOR SHARE keeps the mapping from changing until the caller commits. The
 * order matters: the mapping's guard trigger locks the named user row FOR SHARE before it accepts a write, so a
 * mapping write that names a user this transaction holds either committed before the user-row lock was granted (and
 * is seen here — this statement takes a fresh snapshot) or waits for this transaction and then re-checks the user.
 */
export async function lockPrimaryOwnerMapping(tx: Tx, orgId: number): Promise<PrimaryOwnerMapping | null> {
  if (!Number.isSafeInteger(orgId) || orgId <= 0) return null;
  const rows = await tx.select({ userId: tenantPrimaryOwnersTable.userId }).from(tenantPrimaryOwnersTable).where(eq(tenantPrimaryOwnersTable.orgId, orgId)).limit(2).for("share");
  return single(rows);
}

/** The mapping as committed (no lock) — for displays only, never for a decision. */
export async function readPrimaryOwnerMapping(executor: Executor, orgId: number): Promise<PrimaryOwnerMapping | null> {
  if (!Number.isSafeInteger(orgId) || orgId <= 0) return null;
  const rows = await executor.select({ userId: tenantPrimaryOwnersTable.userId }).from(tenantPrimaryOwnersTable).where(eq(tenantPrimaryOwnersTable.orgId, orgId)).limit(2);
  return single(rows);
}

/**
 * PO-03B — the mapped primary owners of several companies as committed (no lock), for a directory page: ONE query,
 * company id → user id. Display only, never a decision. The caller asks primaryOwnerFoundation() first (an absent
 * table is "not installed", never an error turned into "not designated").
 */
export async function readPrimaryOwnerUserIds(executor: Executor, orgIds: number[]): Promise<Map<number, number>> {
  const ids = [...new Set(orgIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return new Map();
  const rows = await executor
    .select({ orgId: tenantPrimaryOwnersTable.orgId, userId: tenantPrimaryOwnersTable.userId })
    .from(tenantPrimaryOwnersTable)
    .where(inArray(tenantPrimaryOwnersTable.orgId, ids));
  const out = new Map<number, number>();
  for (const r of rows) {
    // org_id is the primary key: a repeated company means the foundation is not what PO-02D1 installed — fail closed.
    if (out.has(r.orgId)) throw new Error("tenant_primary_owners holds more than one row for one company");
    out.set(r.orgId, r.userId);
  }
  return out;
}
