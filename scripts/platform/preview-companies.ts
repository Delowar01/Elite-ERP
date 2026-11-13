/**
 * Platform Owner PO-02B — fill a local PREVIEW database with SYNTHETIC companies so the read-only
 * directory, company details and dashboard can be inspected with data. Same fail-closed rules as
 * every platform script: DATABASE_URL must be a loopback `*_test_only_*` database on a
 * loopback-only server (scripts/platform/local-db-guard.ts), and it must be empty of organizations.
 *
 *   npm run platform:preview-db                     # prints a new *_test_only_* database NAME
 *   export DATABASE_URL=postgres://…/<that name>    # in your own shell
 *   npm run platform:bootstrap                      # a fictional Platform Owner (MFA enrolment)
 *   npm run platform:preview-companies [count]      # default 120 companies, 36 invitations
 *
 * The responsible operator recorded on the synthetic access rows and invitations is the single
 * active Platform Owner. Fictional data only (scripts/platform/company-fixtures.ts); nothing is
 * printed but counts. Exit: 0 seeded · 1 error · 2 unsafe target refused.
 */
import { connectDisposable } from "./disposable-db";
import { UnsafeDatabaseTargetError } from "./local-db-guard";
import { seedSyntheticCompanies } from "./company-fixtures";

async function main() {
  const count = Number(process.argv[2] ?? 120);
  if (!Number.isInteger(count) || count < 1 || count > 5000) throw new Error("count must be an integer between 1 and 5000");
  const client = await connectDisposable(process.env.DATABASE_URL ?? "");
  try {
    const admins = await client.query<{ id: string }>("select id from platform_admins where is_active order by created_at limit 2");
    if (admins.rows.length !== 1) throw new Error("expected exactly one active Platform Owner — run `npm run platform:bootstrap` first");
    const result = await seedSyntheticCompanies(client, { companies: count, adminId: admins.rows[0].id, now: new Date() });
    console.log(
      `platform:preview-companies → ${result.orgIds.length} synthetic companies, ${result.users} users, ${result.suspended.length} suspended, ` +
        `${result.explicitActive.length} explicit active, ${result.noOwner.length} without an owner; invitations ` +
        `${result.invitations.pending} pending, ${result.invitations.expired} expired, ${result.invitations.accepted} accepted, ${result.invitations.revoked} revoked`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  if (err instanceof UnsafeDatabaseTargetError) {
    console.error(`platform:preview-companies refused: ${err.message.replace(/postgres(ql)?:\/\/\S+/g, "<redacted-url>")}`);
    process.exitCode = 2;
    return;
  }
  console.error(`platform:preview-companies failed: ${err instanceof Error ? err.message.replace(/postgres(ql)?:\/\/\S+/g, "<redacted-url>") : String(err)}`);
  process.exitCode = 1;
});
