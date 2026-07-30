import "server-only";
import { eq } from "drizzle-orm";
import { db, orgsTable } from "@/db";
import { recordAudit } from "@/lib/security/audit";

// ---------------------------------------------------------------------------
// ZATCA Phase 1 — backend administrator control.
//
// Enabling Phase 1 is done by the organization itself (enableZatcaPhase1Action).
// DISABLING it is intentionally NOT exposed to organization users anywhere in
// the app — once an org enables Phase 1 it is locked on for them. Only a backend
// administrator / the future Elite Marcom Platform Owner may turn it off, by
// invoking this helper from a privileged/back-office context. Every backend
// disable is written to the immutable audit log, same as the enable event.
// ---------------------------------------------------------------------------

export async function disableZatcaPhase1Backend(
  orgId: number,
  admin: { userId: number | null; userName?: string | null },
): Promise<{ error?: string }> {
  const [org] = await db.select({ enabled: orgsTable.zatcaPhase1Enabled }).from(orgsTable).where(eq(orgsTable.id, orgId));
  if (!org) return { error: "Organization not found." };
  if (!org.enabled) return {}; // already off — idempotent

  await db.update(orgsTable).set({ zatcaPhase1Enabled: false, updatedAt: new Date() }).where(eq(orgsTable.id, orgId));
  await recordAudit(
    { orgId, userId: admin.userId, userName: admin.userName ?? "backend-admin" },
    {
      action: "zatca.phase1_disabled_by_backend",
      entityType: "org",
      entityId: orgId,
      previousValue: { zatcaPhase1Enabled: true },
      newValue: { zatcaPhase1Enabled: false },
    },
  );
  return {};
}
