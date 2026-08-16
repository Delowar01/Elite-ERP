/**
 * READ-ONLY audit: bank accounts linked to a GL account they must not be linked to.
 *
 *   npx tsx --env-file-if-exists=.env scripts/audit-bank-gl-mappings.ts
 *
 * This script NEVER writes. A bad mapping cannot be repaired mechanically — the correct fix is to
 * create a proper cash/bank asset account, re-point the bank account to it, and reclassify the
 * postings that already landed in the wrong account, which is a judgement call about real money
 * (production's single occurrence was corrected by hand exactly that way). So this reports and
 * stops; the code fix in lib/bank-gl-accounts.ts is what prevents new ones.
 *
 * Reported per row: the org, the bank account, the GL account it points at, why that is wrong, and
 * how many payments have already posted through it — the last figure is the blast radius.
 */
import { pool } from "../src/db";
import { bankGlRefusal, STRUCTURAL_POSTING_CODES } from "../src/lib/bank-gl-accounts";

async function main() {
  console.log("== Bank-account GL mapping audit (READ-ONLY — nothing is modified) ==");
  console.log(`Structural posting codes guarded: ${STRUCTURAL_POSTING_CODES.join(", ")}`);
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{
      org_id: number; org_name: string; bank_id: number; bank_name: string;
      code: string; name: string; type: string; payments: number; posted: string;
    }>(
      `SELECT b.org_id, o.name AS org_name, b.id AS bank_id, b.name AS bank_name,
              a.code, a.name, a.type,
              (SELECT count(*)::int FROM payments p WHERE p.bank_account_id = b.id) AS payments,
              COALESCE((SELECT sum(l.debit) - sum(l.credit) FROM journal_lines l
                          JOIN journal_entries e ON e.id = l.journal_entry_id
                         WHERE e.org_id = b.org_id AND l.account_id = a.id), 0)::text AS posted
         FROM bank_accounts b
         JOIN accounts a ON a.id = b.gl_account_id
         JOIN orgs o ON o.id = b.org_id
        ORDER BY b.org_id, b.id`,
    );

    const bad = rows
      .map((r) => ({ row: r, refusal: bankGlRefusal({ code: r.code, name: r.name, type: r.type }) }))
      .filter((x): x is { row: (typeof rows)[number]; refusal: string } => x.refusal !== null);

    console.log(`\nScanned ${rows.length} bank account(s) across all organizations.`);
    if (bad.length === 0) {
      console.log("+ No bank account is linked to a control or non-asset account. Nothing to correct.");
    } else {
      console.log(`! ${bad.length} bank account(s) carry a mapping the code now refuses:\n`);
      for (const { row: r, refusal } of bad) {
        console.log(`  org ${r.org_id} (${r.org_name})  bank account ${r.bank_id} "${r.bank_name}"  ->  ${r.code} ${r.name} [${r.type}]`);
        console.log(`      why: ${refusal}`);
        console.log(`      blast radius: ${r.payments} payment(s) recorded through it; that GL account's ledger balance is ${r.posted}`);
      }
      console.log(`\nNo changes were made. Correct each one by hand: create a cash/bank asset account,`);
      console.log(`re-point the bank account to it, then reclassify the postings that landed in the wrong account.`);
    }
    console.log(`\nTotals: scanned=${rows.length} bad=${bad.length}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
