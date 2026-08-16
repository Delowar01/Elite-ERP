/**
 * Backfill `advance_applications` from the whole-payment applications that already posted, and
 * RE-KEY their journals onto the new allocation identity. READ-ONLY by default.
 *
 *   Dry run (default):  npx tsx --env-file-if-exists=.env scripts/migrations/2026-08-16-advance-applications-backfill.ts
 *   Apply:              npx tsx --env-file-if-exists=.env scripts/migrations/2026-08-16-advance-applications-backfill.ts --apply
 *
 * ## Why the re-key is the whole point
 *
 * Application journals were keyed `(advance_application, payment.id)` — one journal per payment,
 * because one payment could only be applied once. Partial allocation breaks that: one payment now
 * produces several applications, so the key collides and the posting path's
 * idempotency-by-existence check would silently suppress the second application's journal.
 *
 * The new key is the allocation row: `(advance_application, advance_applications.id)`. Creating
 * allocation rows WITHOUT re-keying would be worse than doing nothing — the old journal would be
 * orphaned from the identity the new code looks under, so the new code would see an allocation with
 * no journal and post a duplicate Dr 2300 / Cr 1100. Both halves therefore happen in ONE
 * transaction per payment; the intermediate state never survives a crash.
 *
 * ## What is derived, and from where
 *
 * The allocation's figures come from **the journal that actually posted**, never recomputed:
 * `carriedBase` is its Dr 2300 line, `arCleared` is its Cr 1100 line. Recomputing would silently
 * "correct" historical FX to today's rules and change what the ledger says happened. Nothing is
 * reposted, no money moves, and the entry keeps its id, date, memo and lines — only `source_id`
 * changes.
 *
 * ## What is refused
 *
 * A payment whose application journal is not exactly one entry of the expected shape (Dr 2300 /
 * Cr 1100, optional 4900, balanced, this org's accounts) goes to a printed manual-review list and
 * is never touched. Pre-advances history is the common case here: applied receipts from before the
 * customer-advances work have NO application journal at all — those belong to
 * `2026-08-12-customer-advances-audit.ts`, not to this script.
 *
 * ## Ordering (this is not arbitrary — see docs/runbook)
 *
 * Schema -> THIS BACKFILL -> restart with the new code. Running it after the restart would leave a
 * window where the new code computes availability from allocation rows that do not exist yet, so
 * every applied advance reads as fully available: a double-spend window. Running it before, with
 * the old code still live, risks only a re-conversion, which `convertedInvoiceId` already blocks.
 *
 * Idempotent: an applied receipt that already has an allocation row is skipped, so a second run —
 * dry or apply — reports zero.
 */
import { pool } from "../../src/db";

const APPLY = process.argv.includes("--apply");

type Candidate = {
  payment_id: number; org_id: number; amount: string; sales_invoice_id: number;
  currency: string | null; base_applied_amount: string | null; proforma_number: string | null;
};

async function main() {
  console.log(`== advance_applications backfill (${APPLY ? "APPLY MODE — rows will be created and journals re-keyed" : "DRY RUN — nothing will be modified"}) ==`);
  const client = await pool.connect();
  try {
    const { rows: candidates } = await client.query<Candidate>(
      `SELECT pay.id AS payment_id, pay.org_id, pay.amount::text, pay.sales_invoice_id,
              pay.currency, pay.base_applied_amount::text, pf.proforma_number
         FROM payments pay
         LEFT JOIN proforma_invoices pf ON pf.id = pay.proforma_invoice_id
        WHERE pay.kind = 'advance_receipt'
          AND pay.sales_invoice_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM advance_applications a
                           WHERE a.org_id = pay.org_id AND a.advance_payment_id = pay.id)
        ORDER BY pay.org_id, pay.id`,
    );
    console.log(`\nApplied advance receipts with no allocation row: ${candidates.length}`);

    let migrated = 0;
    const manual: string[] = [];
    for (const c of candidates) {
      const where = `org ${c.org_id}  payment ${c.payment_id} (${c.amount}${c.currency ? " " + c.currency : ""} against invoice ${c.sales_invoice_id}${c.proforma_number ? `, from ${c.proforma_number}` : ""})`;

      const { rows: entries } = await client.query<{ id: number; entry_date: string; created_by_id: number }>(
        `SELECT id, entry_date::text, created_by_id FROM journal_entries
          WHERE org_id = $1 AND source_type = 'advance_application' AND source_id = $2`,
        [c.org_id, c.payment_id],
      );
      if (entries.length !== 1) {
        manual.push(`${where}\n      -> MANUAL REVIEW: expected exactly 1 application journal, found ${entries.length}` +
          (entries.length === 0 ? " (pre-advances history — see 2026-08-12-customer-advances-audit.ts)" : ""));
        continue;
      }
      const entry = entries[0];

      const { rows: lines } = await client.query<{ code: string; debit: string; credit: string }>(
        `SELECT a.code, l.debit::text, l.credit::text
           FROM journal_lines l JOIN accounts a ON a.id = l.account_id
          WHERE l.journal_entry_id = $1 ORDER BY l.id`,
        [entry.id],
      );
      const dr2300 = lines.filter((l) => l.code === "2300" && Number(l.debit) > 0);
      const cr1100 = lines.filter((l) => l.code === "1100" && Number(l.credit) > 0);
      const others = lines.filter((l) => !dr2300.includes(l) && !cr1100.includes(l));
      const balanced =
        Math.round(lines.reduce((s, l) => s + Number(l.debit) * 1000, 0)) ===
        Math.round(lines.reduce((s, l) => s + Number(l.credit) * 1000, 0));
      // The one shape this script understands. Anything richer carries intent it cannot read.
      const shapeOk = dr2300.length === 1 && cr1100.length === 1 && others.every((l) => l.code === "4900") && balanced;
      if (!shapeOk) {
        manual.push(`${where}\n      -> MANUAL REVIEW: unexpected journal shape (${lines.map((l) => `${l.code}:${l.debit}/${l.credit}`).join(", ")})`);
        continue;
      }

      console.log(`  ${where}`);
      console.log(`      -> allocation: applied ${c.amount}, carriedBase ${dr2300[0].debit} (Dr 2300), arCleared ${cr1100[0].credit} (Cr 1100)${others.length ? `, FX ${others[0].debit}/${others[0].credit}` : ""}`);
      console.log(`      -> re-key journal ${entry.id}: source_id ${c.payment_id} -> <new allocation id>`);

      if (APPLY) {
        await client.query("BEGIN");
        try {
          // Re-check inside the transaction: a concurrent run must not create a second allocation.
          const { rows: dup } = await client.query(
            `SELECT 1 FROM advance_applications WHERE org_id = $1 AND advance_payment_id = $2 FOR UPDATE`,
            [c.org_id, c.payment_id],
          );
          if (dup.length > 0) { await client.query("ROLLBACK"); console.log("      = already migrated, skipping"); continue; }

          const { rows: [alloc] } = await client.query<{ id: number }>(
            `INSERT INTO advance_applications
               (org_id, advance_payment_id, sales_invoice_id, applied_amount, carried_base, ar_cleared, applied_date, created_by_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [c.org_id, c.payment_id, c.sales_invoice_id, c.amount, dr2300[0].debit, cr1100[0].credit, entry.entry_date, entry.created_by_id],
          );
          // The journal keeps its id, date, memo and every line. Only the identity pointer moves.
          await client.query(`UPDATE journal_entries SET source_id = $1 WHERE id = $2`, [alloc.id, entry.id]);
          await client.query("COMMIT");
          migrated++;
          console.log(`      + allocation ${alloc.id} created and journal ${entry.id} re-keyed`);
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        }
      }
    }

    for (const m of manual) console.log(`  ${m}`);
    console.log(`\nTotals: candidates=${candidates.length} migrated=${APPLY ? migrated : 0} manual=${manual.length}`);
    if (!APPLY && candidates.length - manual.length > 0) {
      console.log(`(dry run — run again with --apply to migrate the ${candidates.length - manual.length} eligible row(s))`);
    }
    if (candidates.length === 0) {
      console.log("Nothing to migrate. A zero here is the expected outcome on an installation whose advances were never applied.");
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
