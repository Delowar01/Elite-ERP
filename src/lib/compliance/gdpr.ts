import "server-only";
import { and, eq } from "drizzle-orm";
import {
  db,
  orgsTable,
  usersTable,
  customersTable,
  vendorsTable,
  employeesTable,
  consentRecordsTable,
} from "@/db";
import { tenantScope } from "@/lib/tenant";

// ---------------------------------------------------------------------------
// Stage 11 Part 5 — GDPR data portability (Art. 20) + right to erasure (Art. 17).
//
// Export bundles the org's personal-data-bearing records into a single JSON
// document. Secrets (password hashes, MFA secrets/recovery codes) are never
// included. Erasure ANONYMISES rather than hard-deletes a data subject: their
// PII is scrubbed, but the row (and its foreign keys into immutable financial
// documents — invoices, payments) is retained, satisfying erasure without
// breaking the accounting trail required by tax law (a documented GDPR Art. 17(3)(b)
// "legal obligation" carve-out).
// ---------------------------------------------------------------------------

export type OrgDataExport = {
  exportedAt: string;
  organization: Record<string, unknown> | null;
  users: Record<string, unknown>[];
  customers: Record<string, unknown>[];
  vendors: Record<string, unknown>[];
  employees: Record<string, unknown>[];
  consentRecords: Record<string, unknown>[];
};

export async function exportOrgData(orgId: number): Promise<OrgDataExport> {
  const [org] = await db.select().from(orgsTable).where(eq(orgsTable.id, orgId));
  const users = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      mfaEnabled: usersTable.mfaEnabled,
      createdAt: usersTable.createdAt,
      lastLoginAt: usersTable.lastLoginAt,
    })
    .from(usersTable)
    .where(eq(usersTable.orgId, orgId));
  const customers = await db.select().from(customersTable).where(tenantScope(orgId, customersTable));
  const vendors = await db.select().from(vendorsTable).where(tenantScope(orgId, vendorsTable));
  const employees = await db.select().from(employeesTable).where(tenantScope(orgId, employeesTable));
  const consent = await db.select().from(consentRecordsTable).where(tenantScope(orgId, consentRecordsTable));

  return {
    exportedAt: new Date().toISOString(),
    organization: org ? { ...org } : null,
    users,
    customers,
    vendors,
    employees,
    consentRecords: consent,
  };
}

/** Scrubs a customer's personal data in place; retains the row for financial-document integrity. */
export async function anonymizeCustomer(orgId: number, customerId: number): Promise<boolean> {
  const scope = and(tenantScope(orgId, customersTable), eq(customersTable.id, customerId));
  const [existing] = await db.select({ id: customersTable.id }).from(customersTable).where(scope);
  if (!existing) return false;

  await db
    .update(customersTable)
    .set({
      name: `Redacted customer #${customerId}`,
      email: null,
      phone: null,
      address: null,
      taxId: null,
      vatNumber: null,
      notes: null,
      isActive: false,
      updatedAt: new Date(),
    })
    .where(scope);
  return true;
}
