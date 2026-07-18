import { desc } from "drizzle-orm";
import { db, consentRecordsTable, customersTable } from "@/db";
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

  return (
    <ComplianceCenterClient
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
