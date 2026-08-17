/**
 * Historical audit for the customer-advances fix (§20) — READ-ONLY BY DEFAULT.
 *
 *   Dry run (default):  npx tsx --env-file-if-exists=.env scripts/migrations/2026-08-12-customer-advances-audit.ts
 *   Apply repairs:      npx tsx --env-file-if-exists=.env scripts/migrations/2026-08-12-customer-advances-audit.ts --apply
 *
 * The pre-fix code could leave two distinct kinds of damage in live data, and this tool reports
 * them SEPARATELY because their repairs are different:
 *
 *  A. **Converted invoices missing their revenue journal.** A proforma with advances converted
 *     into an invoice born partially_paid/paid, which never passed through Send — so revenue, AR
 *     and VAT never posted. Detection: a posted-status invoice that a proforma points at via
 *     converted_invoice_id, with NO (sales_invoice, id) journal entry. Repair: post the normal
 *     invoice journal exactly once — Dr 1100 / Cr 4000 (derived) / Cr 2100 — at the invoice's own
 *     issue date. Cash is NOT touched (it posted once, at receipt) and VAT posts only from the
 *     invoice's own taxTotal, so nothing can duplicate. Stock is deliberately NOT adjusted: months
 *     later, on-hand may have been corrected by hand, and a silent retroactive decrement is a
 *     worse wrong than a reported gap — every repaired invoice prints a stock warning instead.
 *
 *  B. **Advance receipts credited to 1100 that belong in 2300.** The old proforma-payment branch
 *     posted Dr Bank / Cr 1100, driving AR negative for money that was never a receivable.
 *     Detection: an incoming payment against a proforma, NOT transferred to any invoice
 *     (sales_invoice_id null), whose journal credits 1100. Repair: reclassify — move that credit
 *     line to 2300 and tag the payment kind='advance_receipt'. Amounts, dates and entry identity
 *     are untouched; nothing is deleted.
 *     A transferred old-style receipt (sales_invoice_id set) is deliberately NOT in this
 *     population: its Cr 1100 functions as a payment against the invoice population A repairs, and
 *     together they land AR at exactly the outstanding balance — reclassifying it would break that.
 *
 * Apply mode repairs ONLY rows whose intent is provable from a single unambiguous journal shape:
 *  - A: the org has the required system accounts AND the invoice's base figures are known
 *       (base-currency identity, or stored base columns for foreign). A foreign invoice with no
 *       stored conversion cannot be posted without guessing a rate — manual review.
 *  - B: the receipt's entry has exactly two lines (Dr <bank> X / Cr 1100 X) and the org has 2300.
 * Everything else goes to the manual-review list, printed with the reason, and is never mutated.
 *
 * Idempotent: both detections exclude repaired rows, each repair re-checks inside its own
 * transaction, and a second run (dry or apply) finds nothing to do.
 */
import { pool } from "../../src/db";
import { roundMoney } from "../../src/lib/currency/currencies";

const APPLY = process.argv.includes("--apply");

type Line = { id: number; account_id: number; code: string; debit: string; credit: string };

async function main() {
  console.log(`== Customer-advances historical audit (${APPLY ? "APPLY MODE — repairable rows will be fixed" : "DRY RUN — nothing will be modified"}) ==`);
  const client = await pool.connect();
  try {
    // ---------------- Population A ----------------
    const { rows: aRows } = await client.query(
      `SELECT i.org_id, i.id AS invoice_id, i.invoice_number, p.id AS proforma_id, p.proforma_number,
              i.status, i.currency, o.currency AS org_currency, i.issue_date::text,
              i.total::text, i.tax_total::text, i.paid_amount::text,
              i.exchange_rate::text, i.base_total::text, i.base_tax_amount::text
         FROM sales_invoices i
         JOIN proforma_invoices p ON p.converted_invoice_id = i.id AND p.org_id = i.org_id
         JOIN orgs o ON o.id = i.org_id
        WHERE i.status IN ('sent','partially_paid','paid')
          AND NOT EXISTS (SELECT 1 FROM journal_entries e
                           WHERE e.org_id = i.org_id AND e.source_type = 'sales_invoice' AND e.source_id = i.id)
        ORDER BY i.org_id, i.id`,
    );

    console.log(`\n-- Population A: converted invoices missing their revenue journal (${aRows.length} candidate(s)) --`);
    let aRepairable = 0, aRepaired = 0;
    const aManual: string[] = [];
    for (const r of aRows) {
      const base = (r.org_currency ?? "SAR") as string;
      const isBase = !r.currency || String(r.currency).toUpperCase() === base.toUpperCase();
      const desc = `org ${r.org_id}  ${r.invoice_number} (invoice ${r.invoice_id}, from proforma ${r.proforma_number} #${r.proforma_id})  status=${r.status}  total=${r.total} ${r.currency ?? base}  paid=${r.paid_amount}`;

      const { rows: accts } = await client.query(
        `SELECT code, id FROM accounts WHERE org_id = $1 AND code IN ('1100','4000','2100')`, [r.org_id]);
      const byCode = new Map<string, number>(accts.map((a: { code: string; id: number }) => [a.code, a.id]));
      const { rows: users } = await client.query(
        `SELECT id FROM users WHERE org_id = $1 ORDER BY id LIMIT 1`, [r.org_id]);

      // Base figures: identity for base-currency documents (the FX-8 rule made explicit), stored
      // conversion for foreign ones. A foreign invoice with no stored base CANNOT be posted
      // without inventing a rate — that is exactly what this tool must never do.
      const baseTotal = isBase ? r.total : r.base_total;
      const baseTax = isBase ? r.tax_total : r.base_tax_amount;
      let reason: string | null = null;
      if (!byCode.get("1100") || !byCode.get("4000")) reason = "org is missing system account 1100/4000";
      else if (Number(r.tax_total) > 0 && !byCode.get("2100")) reason = "invoice carries VAT but the org has no 2100 account";
      else if (!isBase && (baseTotal === null || baseTax === null)) reason = "foreign invoice with no stored base-currency conversion — enter the rate context manually";
      else if (users.length === 0) reason = "org has no user to attribute the journal to";

      if (reason) {
        aManual.push(`${desc}\n      -> MANUAL REVIEW: ${reason}`);
        continue;
      }
      aRepairable++;
      console.log(`  ${desc}  -> repairable (${isBase ? "base-currency identity" : "stored base conversion"})`);

      if (APPLY) {
        await client.query("BEGIN");
        try {
          // Idempotency re-check inside the transaction — a concurrent run or a rerun must not
          // double-post revenue.
          const { rows: dup } = await client.query(
            `SELECT 1 FROM journal_entries WHERE org_id=$1 AND source_type='sales_invoice' AND source_id=$2 FOR UPDATE`,
            [r.org_id, r.invoice_id]);
          if (dup.length > 0) { await client.query("ROLLBACK"); console.log("      = already repaired, skipping"); continue; }

          const revenue = roundMoney(Number(baseTotal) - Number(baseTax), base);
          const { rows: [entry] } = await client.query(
            `INSERT INTO journal_entries (org_id, entry_date, memo, source_type, source_id, created_by_id)
             VALUES ($1,$2,$3,'sales_invoice',$4,$5) RETURNING id`,
            [r.org_id, r.issue_date,
             `Invoice ${r.invoice_number} posted retroactively (customer-advances audit — revenue was skipped at conversion)`,
             r.invoice_id, users[0].id]);
          const lines: [number, string, string][] = [
            [byCode.get("1100")!, String(baseTotal), "0"],
            [byCode.get("4000")!, "0", revenue],
          ];
          if (Number(baseTax) > 0) lines.push([byCode.get("2100")!, "0", String(baseTax)]);
          for (const [accountId, debit, credit] of lines) {
            await client.query(
              `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1,$2,$3,$4)`,
              [entry.id, accountId, debit, credit]);
          }
          // Store the base columns the posting used, where they were missing (base-currency
          // identity only — foreign rows already carried theirs to be repairable at all).
          if (isBase) {
            await client.query(
              `UPDATE sales_invoices SET exchange_rate = COALESCE(exchange_rate, '1'),
                      base_total = COALESCE(base_total, total), base_tax_amount = COALESCE(base_tax_amount, tax_total),
                      base_paid_amount = COALESCE(base_paid_amount, paid_amount)
                WHERE id = $1`, [r.invoice_id]);
          }
          await client.query("COMMIT");
          aRepaired++;
          console.log(`      + posted Dr 1100 ${baseTotal} / Cr 4000 ${revenue}${Number(baseTax) > 0 ? ` / Cr 2100 ${baseTax}` : ""}`);
          console.log(`      ! stock NOT adjusted — review on-hand quantities for this invoice's items manually`);
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        }
      }
    }
    for (const m of aManual) console.log(`  ${m}`);
    console.log(`  A: ${aRows.length} candidate(s) — ${aRepairable} repairable${APPLY ? ` (${aRepaired} repaired)` : ""}, ${aManual.length} for manual review`);

    // ---------------- Population B ----------------
    const { rows: bRows } = await client.query(
      `SELECT pay.id AS payment_id, pay.org_id, pay.amount::text, pay.kind,
              p.id AS proforma_id, p.proforma_number, e.id AS entry_id
         FROM payments pay
         JOIN proforma_invoices p ON p.id = pay.proforma_invoice_id AND p.org_id = pay.org_id
         JOIN journal_entries e ON e.org_id = pay.org_id AND e.source_type = 'payment' AND e.source_id = pay.id
        -- "Not applied" reads BOTH records of applied-ness, because during the migration window
        -- either one can be the only one. sales_invoice_id IS NULL alone stops meaning anything
        -- once the 2026-08-17 clear runs (it becomes true of every advance receipt); an allocation
        -- check alone would widen this population to include old-style receipts that WERE applied
        -- through the field, which the clear deliberately refuses to erase until they are
        -- backfilled. Requiring both keeps the population identical in every state.
        WHERE pay.direction = 'in' AND pay.sales_invoice_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM advance_applications aa
                           WHERE aa.advance_payment_id = pay.id AND aa.released_at IS NULL)
          AND EXISTS (SELECT 1 FROM journal_lines l JOIN accounts a ON a.id = l.account_id
                       WHERE l.journal_entry_id = e.id AND a.org_id = pay.org_id AND a.code = '1100' AND l.credit > 0)
        ORDER BY pay.org_id, pay.id`,
    );

    console.log(`\n-- Population B: advance receipts credited to 1100 that belong in 2300 (${bRows.length} candidate(s)) --`);
    let bRepairable = 0, bRepaired = 0;
    const bManual: string[] = [];
    for (const r of bRows) {
      const desc = `org ${r.org_id}  payment ${r.payment_id} (${r.amount} against proforma ${r.proforma_number} #${r.proforma_id})`;
      const { rows: lines } = await client.query<Line>(
        `SELECT l.id, l.account_id, a.code, l.debit::text, l.credit::text
           FROM journal_lines l JOIN accounts a ON a.id = l.account_id
          WHERE l.journal_entry_id = $1 ORDER BY l.id`, [r.entry_id]);
      const { rows: adv } = await client.query(
        `SELECT id FROM accounts WHERE org_id = $1 AND code = '2300'`, [r.org_id]);

      const crAr = lines.filter((l) => l.code === "1100" && Number(l.credit) > 0);
      const other = lines.filter((l) => !crAr.includes(l));
      // The one provable shape: Dr <something> X / Cr 1100 X, nothing else. Anything richer — an
      // FX line, a partial application by hand, a manual correction — carries intent this tool
      // cannot see, so it is reported, not rewritten.
      const unambiguous = lines.length === 2 && crAr.length === 1 && other.length === 1
        && Number(other[0].debit) === Number(crAr[0].credit) && Number(other[0].credit) === 0;
      let reason: string | null = null;
      if (adv.length === 0) reason = "org has no 2300 account — run scripts/migrations/2026-08-12-customer-advances-account.ts first";
      else if (!unambiguous) reason = `journal shape is not the plain Dr Bank / Cr 1100 pair (${lines.map((l) => `${l.code}:${l.debit}/${l.credit}`).join(", ")})`;

      if (reason) {
        bManual.push(`${desc}\n      -> MANUAL REVIEW: ${reason}`);
        continue;
      }
      bRepairable++;
      console.log(`  ${desc}  -> repairable (reclassify Cr ${crAr[0].credit} from 1100 to 2300)`);

      if (APPLY) {
        await client.query("BEGIN");
        try {
          // Idempotency re-check: the line must still be on 1100.
          const { rows: still } = await client.query(
            `SELECT 1 FROM journal_lines l JOIN accounts a ON a.id = l.account_id
              WHERE l.id = $1 AND a.code = '1100' FOR UPDATE OF l`, [crAr[0].id]);
          if (still.length === 0) { await client.query("ROLLBACK"); console.log("      = already reclassified, skipping"); continue; }
          await client.query(`UPDATE journal_lines SET account_id = $1 WHERE id = $2`, [adv[0].id, crAr[0].id]);
          await client.query(`UPDATE payments SET kind = 'advance_receipt' WHERE id = $1 AND kind IS NULL`, [r.payment_id]);
          await client.query("COMMIT");
          bRepaired++;
          console.log(`      + moved the credit to 2300 and tagged the payment kind='advance_receipt'`);
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        }
      }
    }
    for (const m of bManual) console.log(`  ${m}`);
    console.log(`  B: ${bRows.length} candidate(s) — ${bRepairable} repairable${APPLY ? ` (${bRepaired} repaired)` : ""}, ${bManual.length} for manual review`);

    console.log(`\nTotals: A=${aRows.length} B=${bRows.length} repairable=${aRepairable + bRepairable} manual=${aManual.length + bManual.length}`);
    if (!APPLY && aRepairable + bRepairable > 0) {
      console.log(`(dry run — run again with --apply to repair the ${aRepairable + bRepairable} repairable row(s))`);
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
