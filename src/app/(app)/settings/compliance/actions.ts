"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, consentRecordsTable } from "@/db";
import { requireSession, requireRole } from "@/lib/session";
import { tenantScope } from "@/lib/tenant";
import { exportOrgData, anonymizeCustomer } from "@/lib/compliance/gdpr";
import { recordAudit, recordSecurityEvent } from "@/lib/security/audit";

export type ActionResult = { error?: string; ok?: boolean };

const PATH = "/settings/compliance";

// ---- Consent (any signed-in user records their own consent) ----
export async function recordConsentAction(subject: string, granted: boolean, version?: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!subject.trim()) return { error: "A consent subject is required." };
  await db.insert(consentRecordsTable).values({
    orgId: session.orgId,
    userId: session.userId,
    subject: subject.trim(),
    granted,
    version: version?.trim() || null,
  });
  await recordAudit(
    { orgId: session.orgId, userId: session.userId, userName: session.name },
    { action: granted ? "consent.granted" : "consent.withdrawn", entityType: "consent", newValue: { subject, version } },
  );
  revalidatePath(PATH);
  return { ok: true };
}

// ---- GDPR Art. 20 data export (owner/admin only) ----
export async function exportOrgDataAction(): Promise<{ json: string; filename: string } | { error: string }> {
  const session = await requireRole("owner", "admin");
  const data = await exportOrgData(session.orgId);
  await recordAudit(
    { orgId: session.orgId, userId: session.userId, userName: session.name },
    { action: "gdpr.data_exported", entityType: "org", entityId: session.orgId },
  );
  await recordSecurityEvent({ orgId: session.orgId, userId: session.userId, email: session.email, type: "gdpr.data_exported", severity: "medium" });
  const stamp = new Date().toISOString().slice(0, 10);
  return { json: JSON.stringify(data, null, 2), filename: `elite-erp-data-export-${stamp}.json` };
}

// ---- GDPR Art. 17 erasure — anonymise a customer (owner/admin only) ----
export async function anonymizeCustomerAction(customerId: number): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const ok = await anonymizeCustomer(session.orgId, customerId);
  if (!ok) return { error: "Customer not found." };
  await recordAudit(
    { orgId: session.orgId, userId: session.userId, userName: session.name },
    { action: "gdpr.customer_anonymized", entityType: "customer", entityId: customerId },
  );
  await recordSecurityEvent({ orgId: session.orgId, userId: session.userId, email: session.email, type: "gdpr.customer_anonymized", severity: "high", detail: `customer #${customerId}` });
  revalidatePath(PATH);
  revalidatePath("/clients");
  return { ok: true };
}

// ---- Withdraw a specific consent record (owner/admin housekeeping) ----
export async function deleteConsentAction(id: number): Promise<ActionResult> {
  const session = await requireSession();
  await db.delete(consentRecordsTable).where(and(tenantScope(session.orgId, consentRecordsTable), eq(consentRecordsTable.id, id)));
  revalidatePath(PATH);
  return { ok: true };
}
