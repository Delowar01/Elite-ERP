import "server-only";
import { getTenantAccess, ORG_SUSPENDED_REVOKE_REASON, tenantAccessEnforcementEnabled, type TenantAccess } from "@/lib/platform/company-access";

// ---------------------------------------------------------------------------------------------
// Tenant access gate (PO-02C). The ONE customer module that consults the company-access rule
// (src/lib/platform/company-access.ts — no access row → active; 'active' → active; anything else →
// suspended). It is used by the customer session validation (src/lib/session.ts), sign-in and
// session issuance (src/app/(auth)/actions.ts) and signed file requests (src/app/uploads).
//
//  • Off unless TENANT_ACCESS_ENFORCEMENT=enabled: with the switch off nothing here is consulted
//    and customer authentication behaves exactly as before PO-02C.
//  • Fails closed: if the access-control objects are missing (a deployment-order error) access is
//    denied and an incident line is logged — a missing TABLE is never read as a missing ROW.
//  • D-8 proposal: CUSTOMER_LEGACY_TOKENS=reject refuses customer tokens without a server-side
//    session id (minted before Stage 11). Off by default; production use needs owner approval.
// ---------------------------------------------------------------------------------------------

export { ORG_SUSPENDED_REVOKE_REASON, tenantAccessEnforcementEnabled };

/** D-8 (proposal): reject jti-less customer tokens. Off unless CUSTOMER_LEGACY_TOKENS=reject. */
export function legacyCustomerTokensRejected(): boolean {
  return process.env.CUSTOMER_LEGACY_TOKENS === "reject";
}

/** The access-control objects could not be read (missing table or column): access is denied. */
export class TenantAccessUnavailableError extends Error {
  constructor() {
    super("tenant access controls unavailable");
    this.name = "TenantAccessUnavailableError";
  }
}

// undefined_table, undefined_column — what a database without the PO-02A objects answers.
const MISSING_OBJECT_CODES = new Set(["42P01", "42703"]);

function sqlStateOf(err: unknown): string | undefined {
  for (let e: unknown = err, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/**
 * The company's effective access, or null when no such organization exists. Throws
 * TenantAccessUnavailableError (after logging an incident line) when the access-control objects are
 * missing; any other database failure propagates unchanged, exactly like every other query.
 */
export async function readOrgAccess(orgId: number): Promise<TenantAccess | null> {
  try {
    return await getTenantAccess(orgId);
  } catch (err) {
    if (MISSING_OBJECT_CODES.has(sqlStateOf(err) ?? "")) {
      console.error("[tenant-access] access-control objects unavailable — access denied (fail closed)");
      throw new TenantAccessUnavailableError();
    }
    throw err;
  }
}

/** Only an explicitly active (or legacy-default) company may be served. */
export function accessAllows(access: TenantAccess | null): boolean {
  return access?.status === "active";
}

/**
 * The gate's decision for one organization: `active` (may be served), `suspended` (not active — no
 * such organization included), or `unavailable` (the access-control objects cannot be read: denied,
 * but never reported to the customer as a suspension).
 */
export type OrgAccessDecision = "active" | "suspended" | "unavailable";

export async function orgAccessDecision(orgId: number): Promise<OrgAccessDecision> {
  try {
    return accessAllows(await readOrgAccess(orgId)) ? "active" : "suspended";
  } catch (err) {
    if (err instanceof TenantAccessUnavailableError) return "unavailable";
    throw err;
  }
}

/** True only for `active`: fails closed when access cannot be read at all. */
export async function orgAccessAllowed(orgId: number): Promise<boolean> {
  return (await orgAccessDecision(orgId)) === "active";
}
