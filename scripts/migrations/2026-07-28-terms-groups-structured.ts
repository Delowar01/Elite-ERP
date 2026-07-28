// One-off migration: master Terms Groups move from a single newline-joined `content` text column
// to a structured, ordered `terms` jsonb array (one entry per term, each keeping its own multiline
// content and position). Existing groups are migrated by splitting their `content` into terms with
// the same helper the app uses — no terms are lost. Idempotent: safe to re-run.
//   Run: npx tsx scripts/migrations/2026-07-28-terms-groups-structured.ts
import { pool } from "../../src/db";
import { splitGroupTerms } from "../../src/app/(app)/sales/_shared/document-terms";

async function columnExists(name: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='terms_conditions_groups' AND column_name=$1`,
    [name],
  );
  return rows.length > 0;
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const hasContent = await columnExists("content");
    const hasTerms = await columnExists("terms");

    // 1. Add the new structured column (nullable for now so backfill can run).
    if (!hasTerms) {
      await client.query(`ALTER TABLE terms_conditions_groups ADD COLUMN terms jsonb`);
      console.log("+ added column terms jsonb");
    }

    // 2. Backfill terms from the legacy content, preserving order, using the app's own splitter.
    if (hasContent) {
      const { rows } = await client.query<{ id: number; content: string | null }>(
        `SELECT id, content FROM terms_conditions_groups WHERE terms IS NULL`,
      );
      for (const r of rows) {
        const terms = splitGroupTerms(r.content);
        await client.query(`UPDATE terms_conditions_groups SET terms = $1::jsonb WHERE id = $2`, [JSON.stringify(terms), r.id]);
      }
      console.log(`~ backfilled ${rows.length} group(s) from content`);
    }

    // 3. Any remaining nulls (rows created with no content) become an empty array.
    await client.query(`UPDATE terms_conditions_groups SET terms = '[]'::jsonb WHERE terms IS NULL`);

    // 4. Lock down the column: default + not null, matching the Drizzle schema.
    await client.query(`ALTER TABLE terms_conditions_groups ALTER COLUMN terms SET DEFAULT '[]'::jsonb`);
    await client.query(`ALTER TABLE terms_conditions_groups ALTER COLUMN terms SET NOT NULL`);

    // 5. Drop the legacy column.
    if (hasContent) {
      await client.query(`ALTER TABLE terms_conditions_groups DROP COLUMN content`);
      console.log("- dropped column content");
    }

    await client.query("COMMIT");
    console.log("migration complete");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
