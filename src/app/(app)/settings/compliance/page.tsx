import { desc, sql } from "drizzle-orm";
import { db, consentRecordsTable, customersTable } from "@/db";
import { encryptionConfigured } from "@/lib/crypto/field-encryption";
import { requireRole } from "@/lib/session";
import { tenantScope } from "@/lib/tenant";
import { getLocale } from "@/lib/i18n/server";
import { ComplianceCenterClient } from "./compliance-client";

export default async function ComplianceCenterPage() {
  // Compliance operations (data export, erasure) are privileged.
  const session = await requireRole("owner", "admin");
  const locale = await getLocale();

  const consents = await db
    .select()
    .from(consentRecordsTable)
    .where(tenantScope(session.orgId, consentRecordsTable))
    .orderBy(desc(consentRecordsTable.createdAt))
    .limit(50);

  const customers = await db
    .select({ id: customersTable.id, name: customersTable.name, email: customersTable.email, isActive: customersTable.isActive })
    .from(customersTable)
    .where(tenantScope(session.orgId, customersTable))
    .orderBy(customersTable.name)
    .limit(500);

  // The two controls whose real state this deployment can actually be asked about. Everything else
  // on that screen is either build-time truth (the feature is in this codebase or it is not) or
  // genuinely outside the application's view (backups, key rotation, incident process) — and those
  // are shown as informational, never as satisfied.
  const [fieldEncryption, auditTrigger] = await Promise.all([
    Promise.resolve(encryptionConfigured()),
    db
      .execute(sql`select count(*)::int as n from pg_trigger where tgname in ('audit_logs_immutable','security_events_immutable')`)
      .then((r) => Number((r.rows as unknown as { n: number }[])[0]?.n ?? 0) >= 2)
      .catch(() => false),
  ]);

  return (
    <ComplianceCenterClient
      liveState={{ fieldEncryption, auditTrigger }}
      locale={locale}
      consents={consents.map((c) => ({
        id: c.id,
        subject: c.subject,
        granted: c.granted,
        version: c.version,
        createdAt: c.createdAt.toISOString(),
      }))}
      customers={customers}
    />
  );
}
