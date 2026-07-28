"use server";

import { requireSession } from "@/lib/session";
import { getGeneralLedger, type GlAccountBlock } from "@/lib/finance-reports";

// Drill-down: the posted journal transactions behind a report line (an account, over the period).
// Tenant-scoped — getGeneralLedger only returns the account when it belongs to the session's org,
// so a foreign accountId yields nothing (no cross-tenant leakage).
export async function getAccountDrilldownAction(accountId: number, from: string, to: string): Promise<GlAccountBlock | null> {
  const session = await requireSession();
  const blocks = await getGeneralLedger(session.orgId, { from, to }, accountId);
  return blocks[0] ?? null;
}
