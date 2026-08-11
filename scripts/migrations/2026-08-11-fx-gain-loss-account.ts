// One-off migration (FX-7): seed the "4900 Exchange Gain/Loss" system account into every existing
// organization. New orgs get it from DEFAULT_CHART_OF_ACCOUNTS at signup; this closes the gap for
// orgs seeded before the account existed. Idempotent: an org that already has a 4900 account —
// seeded, migrated, or user-created — is left completely alone (a user-created 4900 keeps its own
// name and flags; payments post by code, so it still works).
//   Run: npx tsx --env-file-if-exists=.env scripts/migrations/2026-08-11-fx-gain-loss-account.ts
import { pool } from "../../src/db";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../../src/db/schema/accounting";

async function main() {
  const fx = DEFAULT_CHART_OF_ACCOUNTS.find((a) => a.code === "4900");
  if (!fx) throw new Error("4900 is missing from DEFAULT_CHART_OF_ACCOUNTS — nothing to seed.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: number }>(
      `SELECT o.id FROM orgs o
        WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.org_id = o.id AND a.code = '4900')
        ORDER BY o.id`,
    );
    for (const org of rows) {
      await client.query(
        `INSERT INTO accounts (org_id, code, name, type, normal_balance, is_system)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [org.id, fx.code, fx.name, fx.type, fx.normalBalance, fx.isSystem],
      );
    }
    await client.query("COMMIT");
    console.log(`+ seeded 4900 ${fx.name} into ${rows.length} org(s); orgs already carrying a 4900 were untouched`);
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
