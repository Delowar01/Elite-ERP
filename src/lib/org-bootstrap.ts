import "server-only";
import { orgsTable, usersTable } from "@/db/schema";
import type { Tx } from "@/db";
import { seedOrgDefaults } from "@/lib/seed-org";

// ---------------------------------------------------------------------------------------------
// The ONE organization bootstrap (PO-02D3; Stage 2 appflow §4: "do not implement a second inconsistent org
// bootstrap path"). /register (registerAction) and invitation acceptance both create a company through it, inside
// THEIR OWN transaction: the organization, its owner user and the default records a new organization needs
// (seedOrgDefaults). Nothing is committed here and nothing happens outside the caller's transaction.
//
// It takes only already-validated values. The password is hashed by the caller (hashPassword) BEFORE the
// transaction, so bcrypt never runs while locks are held, and the owner e-mail must already be normalized
// (trim + lower case) — every writer of users.email stores that form, which is what makes the case-sensitive
// users_email_unique constraint a complete guard against two accounts for one address
// (verify:platform-email-uniqueness).
// ---------------------------------------------------------------------------------------------

export type OrganizationBootstrapFields = {
  orgName: string;
  /** The country NAME, as orgs.country stores it (getProfileByCountryName reads it everywhere else). */
  country: string;
  /** ISO 4217 base currency, chosen deliberately (at /register by the owner; in an invitation by the operator). */
  currency: string;
  ownerName: string;
  /** Already normalized: trim().toLowerCase(). */
  ownerEmail: string;
  passwordHash: string;
  /** Invitation acceptance only: the operator-validated metadata carried into the organization. */
  industry?: string | null;
  companyEmail?: string | null;
};

export async function bootstrapOrganization(tx: Tx, fields: OrganizationBootstrapFields): Promise<{ orgId: number; userId: number }> {
  if (fields.ownerEmail !== fields.ownerEmail.trim().toLowerCase()) {
    throw new Error("bootstrapOrganization: the owner e-mail must be normalized (trim + lower case) before it is stored");
  }
  const [org] = await tx
    .insert(orgsTable)
    // Stamped now because the base currency was just chosen deliberately — this org never needs the one-time
    // base-currency confirmation, which exists only for orgs created before the question was asked.
    .values({
      name: fields.orgName,
      country: fields.country,
      currency: fields.currency,
      baseCurrencyConfirmedAt: new Date(),
      ...(fields.industry ? { industry: fields.industry } : {}),
      ...(fields.companyEmail ? { email: fields.companyEmail } : {}),
    })
    .returning();
  const [user] = await tx
    .insert(usersTable)
    .values({ orgId: org.id, email: fields.ownerEmail, passwordHash: fields.passwordHash, name: fields.ownerName, role: "owner" })
    .returning();
  await seedOrgDefaults(tx, org.id, fields.country);
  return { orgId: org.id, userId: user.id };
}
