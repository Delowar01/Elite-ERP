// One-off migration (customer advances): seed the "2300 Customer Advances" system account into
// every existing organization. New orgs get it from DEFAULT_CHART_OF_ACCOUNTS at signup; this
// closes the gap for orgs seeded before the account existed. Idempotent: an org that already has
// ANY account coded 2300 — seeded, migrated, or user-created — is left completely alone (a
// user-created 2300 keeps its own name and flags; postings resolve by code, so it still works).
//   Run: npx tsx --env-file-if-exists=.env scripts/migrations/2026-08-12-customer-advances-account.ts
import { pool } from "../../src/db";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../../src/db/schema/accounting";

async function main() {
  const adv = DEFAULT_CHART_OF_ACCOUNTS.find((a) => a.code === "2300");
  if (!adv) throw new Error("2300 is missing from DEFAULT_CHART_OF_ACCOUNTS — nothing to seed.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: number }>(
      `SELECT o.id FROM orgs o
        WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.org_id = o.id AND a.code = '2300')
        ORDER BY o.id`,
    );
    for (const org of rows) {
      await client.query(
        `INSERT INTO accounts (org_id, code, name, type, normal_balance, is_system)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [org.id, adv.code, adv.name, adv.type, adv.normalBalance, adv.isSystem],
      );
    }
    await client.query("COMMIT");
    console.log(`+ seeded 2300 ${adv.name} into ${rows.length} org(s); orgs already carrying a 2300 were untouched`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
