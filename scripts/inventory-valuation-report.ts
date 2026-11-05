// ACC-01 — read-only inventory valuation and inventory-to-GL reconciliation, per organization.
//
// Prints, for each org: the weighted-average valuation of its stock items, the stock with no cost
// basis (pre-ACC-01 quantities), the sales issued without a cost, and the reconciliation of the 1200
// Inventory ledger to the valuation — with whatever the ledger holds that no stock movement explains
// (pre-ACC-01 postings, manual journals) listed by source type. It writes nothing.
//
// Use it at the ACC-01 cut-over to see what the existing data carries, and afterwards as the
// valuation report until the app has a screen for it. DATABASE_URL is never printed.
//   Run: npx tsx --env-file-if-exists=.env --conditions=react-server scripts/inventory-valuation-report.ts [--org <id>]
import { pool } from "../src/db";
import { getInventoryReconciliation, getInventoryValuation } from "../src/lib/inventory-valuation";

async function main() {
  const orgArg = process.argv.indexOf("--org");
  const only = orgArg > 0 ? Number(process.argv[orgArg + 1]) : null;
  const { rows: orgs } = await pool.query<{ id: number; name: string; currency: string }>(
    `select id, name, currency from orgs ${only ? "where id = $1" : ""} order by id`,
    only ? [only] : [],
  );
  let failures = 0;
  for (const org of orgs) {
    const valuation = await getInventoryValuation(org.id, org.currency);
    const rec = await getInventoryReconciliation(org.id, org.currency);
    console.log(`\n== org ${org.id} (${org.currency}) — ${valuation.rows.length} stock item(s) with stock or history`);
    for (const r of valuation.rows) {
      const avg = r.averageCost === null ? "—" : String(Number(r.averageCost));
      const gap = r.unvaluedQuantity !== 0 ? `   NO COST BASIS: ${r.unvaluedQuantity}` : "";
      console.log(`   ${r.sku.padEnd(16)} on hand ${String(r.onHand).padStart(7)}  valued ${String(r.valuedQuantity).padStart(7)}  value ${r.stockValue.padStart(14)}  avg ${avg}${gap}`);
    }
    console.log(`   valuation total ${valuation.totalValue}; ${valuation.unvaluedProducts} item(s) carry stock with no cost basis`);
    console.log(`   GL 1200 ${rec.glInventory} = valued stock ${rec.valuedStock} + unattributed ${rec.unattributedTotal}`);
    for (const u of rec.unattributed) console.log(`     unattributed ${u.sourceType}: ${u.amount} (${u.entries} entr${u.entries === 1 ? "y" : "ies"})`);
    console.log(`   uncosted sales issues: ${rec.uncostedIssues.movements} movement(s), ${rec.uncostedIssues.quantity} unit(s) with no COGS`);
    console.log(`   integrity ${rec.integrityOk ? "OK" : "FAILED"}; ${rec.reconciled ? "ledger equals valuation" : "ledger differs from valuation by the unattributed amount above"}`);
    for (const p of rec.poolMismatches) console.log(`     POOL MISMATCH product ${p.productId} ${p.sku}: stored ${p.valuedQuantity} / ${p.stockValue}, movements ${p.movementQuantity} / ${p.movementValue}`);
    if (rec.detachedMovements) console.log(`     ${rec.detachedMovements} costed movement(s) with no journal entry`);
    if (!rec.integrityOk) failures++;
  }
  await pool.end();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await pool.end().catch(() => {});
  process.exit(1);
});
