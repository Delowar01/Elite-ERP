/**
 * Clear `payments.salesInvoiceId` for ADVANCE RECEIPTS ONLY.
 *
 * Run read-only:  npx tsx --env-file-if-exists=.env scripts/migrations/2026-08-17-clear-advance-sales-invoice-id.ts
 * Run for real:   … same command … --apply
 *
 * ## Why
 *
 * For an advance receipt the field became a lie the moment allocations shipped: it can only say
 * "all of this receipt went to that one invoice", so a partial draw leaves it null and an advance
 * split across two invoices cannot be expressed at all. Keeping it would mean the field means "the
 * application" in one row and "the first of several applications" in another — the field
 * overloading this model exists to remove. Allocations become the sole truth.
 *
 * ORDINARY payments keep it. For them it is the correct and only invoice linkage, so the UPDATE is
 * scoped to `kind = 'advance_receipt'` and nothing else. `proformaInvoiceId` is untouched on every
 * row: it is the receipt's origin pointer, not an application.
 *
 * ## The safety property — the reason this is a one-way door with a lock on it
 *
 * An advance receipt that has `salesInvoiceId` set and NO allocation row is a receipt whose
 * applied-ness exists in exactly one place: that field. Clearing it would erase the fact with no
 * record anywhere — allocations are the only place it could survive, and it has none. That
 * population is precisely what the 2026-08-16 backfill exists to migrate.
 *
 * So this script REFUSES to clear while any such row exists, and reports them. A non-zero count
 * means **run the backfill first**, never force the clear.
 *
 * ## Deploy order — the OPPOSITE of the backfill's, which is the trap
 *
 *   backfill (2026-08-16):  schema → backfill → deploy code
 *   this clear:             deploy code → clear
 *
 * The readers must already be reading allocations BEFORE the field goes null. Clearing first would
 * leave deployed code reading `salesInvoiceId` and finding nothing: advance-applied shows 0,
 * payment history loses rows, project costing loses advance cash. Wrong figures rather than a
 * double-spend window, but silent ones. Every migrated reader is written to produce the SAME output
 * before and after this runs (they exclude `advance_receipt` from the field-based path and read
 * allocations instead), which is what makes the ordering safe rather than merely correct.
 */
import { Pool } from "pg";

const APPLY = process.argv.includes("--apply");
// Optional single-tenant scope: `--org 42`. Production can roll this out one org at a time, and the
// verification suite uses it to run the real script against its own fixture without touching
// anybody else's rows.
const ORG_ARG = process.argv.indexOf("--org");
const ORG = ORG_ARG >= 0 ? Number(process.argv[ORG_ARG + 1]) : null;
const orgFilter = ORG === null ? "" : ` and org_id = ${ORG}`;
const orgFilterP = ORG === null ? "" : ` and p.org_id = ${ORG}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type Row = Record<string, string | number | null>;

async function main() {
  console.log(`\nCLEAR payments.salesInvoiceId FOR ADVANCE RECEIPTS — ${APPLY ? "APPLY" : "DRY RUN (read-only)"}${ORG === null ? "" : ` — org ${ORG} only`}\n`);

  const scope = (await pool.query<Row>(`
    select count(*)::int as n
      from payments where kind = 'advance_receipt' and sales_invoice_id is not null${orgFilter}`)).rows[0];
  const total = Number(scope.n);

  // The refusal population: applied-ness recorded ONLY in the field.
  const unbacked = (await pool.query<Row>(`
    select p.id, p.org_id, o.name as org, p.reference, p.amount::text as amount, p.sales_invoice_id, i.invoice_number
      from payments p
      join orgs o on o.id = p.org_id
      left join sales_invoices i on i.id = p.sales_invoice_id
     where p.kind = 'advance_receipt' and p.sales_invoice_id is not null${orgFilterP}
       and not exists (select 1 from advance_applications a where a.advance_payment_id = p.id)
     order by p.org_id, p.id`)).rows;

  const ordinary = (await pool.query<Row>(`
    select count(*)::int as n from payments where kind <> 'advance_receipt' and sales_invoice_id is not null${orgFilter}`)).rows[0];

  console.log(`  advance receipts still carrying salesInvoiceId : ${total}`);
  console.log(`  …of those, with NO allocation row              : ${unbacked.length}`);
  console.log(`  ordinary payments carrying it (never touched)  : ${Number(ordinary.n)}\n`);

  if (unbacked.length > 0) {
    console.log("REFUSING TO CLEAR. These receipts record their applied-ness ONLY in the field this");
    console.log("script would erase — there is no allocation row to carry it. Run the backfill");
    console.log("(scripts/migrations/2026-08-16-advance-applications-backfill.ts --apply) first, then");
    console.log("re-run this. Do NOT force the clear.\n");
    for (const r of unbacked.slice(0, 50)) {
      console.log(`   org ${r.org_id} (${r.org})  payment ${r.id}  ${r.amount}  → invoice ${r.invoice_number ?? r.sales_invoice_id}`);
    }
    if (unbacked.length > 50) console.log(`   … and ${unbacked.length - 50} more`);
    await pool.end();
    process.exit(2);
  }

  if (!APPLY) {
    console.log(`Dry run: ${total} advance receipt${total === 1 ? "" : "s"} would have salesInvoiceId cleared.`);
    console.log("Re-run with --apply once the new readers are DEPLOYED (deploy code → then clear).\n");
    await pool.end();
    return;
  }

  // One statement, scoped by kind. Re-running is inert: the second pass matches nothing.
  const res = await pool.query(`
    update payments set sales_invoice_id = null
     where kind = 'advance_receipt' and sales_invoice_id is not null${orgFilter}`);
  console.log(`Cleared ${res.rowCount} advance receipt${res.rowCount === 1 ? "" : "s"}.`);

  const after = (await pool.query<Row>(`
    select
      (select count(*)::int from payments where kind = 'advance_receipt' and sales_invoice_id is not null${orgFilter}) as advances_left,
      (select count(*)::int from payments where kind <> 'advance_receipt' and sales_invoice_id is not null${orgFilter}) as ordinary_left`)).rows[0];
  console.log(`  advance receipts still carrying it : ${Number(after.advances_left)} (expected 0)`);
  console.log(`  ordinary payments still carrying it: ${Number(after.ordinary_left)} (expected ${Number(ordinary.n)})\n`);
  if (Number(after.ordinary_left) !== Number(ordinary.n)) {
    console.log("MISMATCH: an ordinary payment lost its invoice link. This should be impossible — investigate before deploying further.\n");
    await pool.end();
    process.exit(3);
  }
}

main()
  .then(() => pool.end())
  .catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
