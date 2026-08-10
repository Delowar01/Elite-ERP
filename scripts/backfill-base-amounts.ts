// FX-5: backfill base-currency amounts for documents that are ALREADY in their org's base currency.
//
// Run: npx tsx --env-file-if-exists=.env scripts/backfill-base-amounts.ts
//
// For a base-currency document the conversion is the identity — rate 1, base amounts equal to the
// document's own amounts — so it can be filled mechanically with no rate lookup and no judgment.
// Everything else is left EXACTLY as it is:
//
//  - **A foreign-currency row is never touched.** Its base amounts stay null, which means
//    "unconverted, known bad" — the honest value. Writing `baseTotal = total` on a USD row would
//    claim 1,000 USD is 1,000 SAR: a wrong number shaped like a right one, absorbed silently by
//    every downstream sum. The count of skipped rows is REPORTED so a non-zero number is seen
//    rather than assumed away.
//  - **A null document currency means the org's base** — the same thing it means everywhere else
//    in the schema — so those rows are filled.
//  - **Each row is compared to ITS OWN org's base currency**, not to any global default. A USD
//    document is base-currency in a US org and foreign in a Saudi one; the join makes that
//    per-row, so orgs cannot contaminate each other.
//  - **Idempotent** via the `base_total is null` guard: a second run finds nothing to fill and
//    changes nothing, so re-running after a partial failure is safe.
//
// ## What a correct run looks like
//
// Against production as counted at FX-5 planning time: **18 filled, 0 skipped** — every existing
// document is base-currency there. A non-zero skipped count in production means foreign-currency
// documents exist and is worth a look before proceeding, not an error. (Dev databases will show
// much larger fills and a non-zero skip from test activity.)
//
// This is a snapshot, not a trigger: documents created AFTER the run have null base amounts until
// FX-6's posting-time capture writes them. Run it once at deploy, alongside or before FX-6.

import { Pool } from "pg";
import { pathToFileURL } from "node:url";

type TableSpec = { table: string; hasPaid: boolean };

/** The seven money-carrying document tables. Delivery challans carry no money and have no base columns. */
export const BACKFILL_TABLES: TableSpec[] = [
  { table: "quotations", hasPaid: false },
  { table: "sales_orders", hasPaid: false },
  { table: "proforma_invoices", hasPaid: true },
  { table: "sales_invoices", hasPaid: true },
  { table: "credit_notes", hasPaid: false },
  { table: "debit_notes", hasPaid: false },
  { table: "purchase_orders", hasPaid: true },
];

export type BackfillResult = {
  perTable: { table: string; filled: number; skippedForeign: number }[];
  filled: number;
  /** Rows left null because their currency differs from their org's base. These await FX-6/real conversion. */
  skippedForeign: number;
};

/**
 * `orgFilter` narrows the run to specific org ids — used by the verify suite so its assertions are
 * about its own fixtures rather than whatever else the database holds. Production runs pass nothing
 * and cover every org.
 */
export async function backfillBaseAmounts(pool: Pool, orgFilter?: number[]): Promise<BackfillResult> {
  const perTable: BackfillResult["perTable"] = [];
  const orgCond = orgFilter?.length ? `and d.org_id = any($1)` : "";
  const params = orgFilter?.length ? [orgFilter] : [];

  for (const { table, hasPaid } of BACKFILL_TABLES) {
    const paidSet = hasPaid ? `, base_paid_amount = d.paid_amount` : "";
    // Currency codes are stored uppercase, but upper() on both sides costs nothing and removes the
    // one way a case mismatch could misclassify a base row as foreign.
    const fill = await pool.query(
      `update ${table} d
          set exchange_rate = 1,
              base_total = d.total,
              base_tax_amount = d.tax_total${paidSet}
         from orgs o
        where o.id = d.org_id
          and d.base_total is null
          and (d.currency is null or upper(d.currency) = upper(o.currency))
          ${orgCond}`,
      params,
    );
    const skipped = await pool.query(
      `select count(*)::int n
         from ${table} d
         join orgs o on o.id = d.org_id
        where d.base_total is null
          and d.currency is not null
          and upper(d.currency) <> upper(o.currency)
          ${orgCond}`,
      params,
    );
    perTable.push({ table, filled: fill.rowCount ?? 0, skippedForeign: skipped.rows[0].n });
  }

  return {
    perTable,
    filled: perTable.reduce((s, t) => s + t.filled, 0),
    skippedForeign: perTable.reduce((s, t) => s + t.skippedForeign, 0),
  };
}

// CLI entry — import as a module (the verify suite does) and nothing below runs. Wrapped in a
// function rather than top-level await so the module also loads under a CJS transform.
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const r = await backfillBaseAmounts(pool);
  console.log("FX-5 base-amount backfill\n");
  for (const t of r.perTable) {
    console.log(`  ${t.table.padEnd(20)} filled ${String(t.filled).padStart(5)}   left unconverted (foreign) ${t.skippedForeign}`);
  }
  console.log(`\n  total filled: ${r.filled}`);
  console.log(`  total left unconverted (foreign currency, awaiting a real rate): ${r.skippedForeign}`);
  if (r.skippedForeign > 0) {
    console.log(
      "\n  The unconverted rows are NOT an error and were NOT given fake base amounts. They keep\n" +
      "  null until a real conversion (FX-6) supplies the rate for their document date.",
    );
  }
  await pool.end();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
