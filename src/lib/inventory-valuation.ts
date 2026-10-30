import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { roundMoney } from "@/lib/currency/currencies";
import { INVENTORY_ACCOUNT } from "@/lib/inventory-costing";

/**
 * ACC-01 — inventory valuation and its reconciliation to the ledger, read from what was POSTED:
 * the products' weighted-average pools, the stock movements behind them, and the 1200 Inventory
 * lines of the journal. Read-only; every query is scoped to one organization.
 *
 * ## The reconciliation
 *
 * Every costed movement belongs to the journal entry whose 1200 line carries its cost (the
 * invoice's COGS lines, the receipt's inventory line, the note's, the adjustment's). So, entry by
 * entry, `1200 net − Σ costed movement cost` is zero for everything ACC-01 posts, and what is left
 * over is ledger value no movement explains:
 *
 *   - 1200 postings from before ACC-01 (purchase receipts capitalised gross, debit notes);
 *   - a debit note's credit for returned units that had no cost basis (it relieves those);
 *   - manual journals to 1200.
 *
 * GL 1200 = valued stock + that remainder, listed by source type. Separately, the integrity checks
 * prove the stock side holds together: each product's pool equals the sum of its costed movements,
 * and no costed movement is detached from the ledger.
 */

export type ValuationRow = {
  productId: number;
  sku: string;
  name: string;
  unit: string;
  onHand: number;
  valuedQuantity: number;
  /** On hand with no cost basis (stock from before ACC-01); negative = units sold before it with no stock. */
  unvaluedQuantity: number;
  stockValue: string;
  averageCost: string | null;
};

export type InventoryValuation = {
  rows: ValuationRow[];
  totalValue: string;
  unvaluedProducts: number;
};

export async function getInventoryValuation(orgId: number, baseCurrency: string): Promise<InventoryValuation> {
  const res = await db.execute(sql`
    select id, sku, name, unit, quantity_on_hand, valued_quantity, stock_value::text as stock_value
      from products
     where org_id = ${orgId} and item_type = 'stock'
       and (quantity_on_hand <> 0 or valued_quantity <> 0 or stock_value <> 0
            or exists (select 1 from inventory_movements m where m.org_id = ${orgId} and m.product_id = products.id))
     order by sku, id`);
  const rows = (res.rows as unknown as {
    id: number; sku: string; name: string; unit: string; quantity_on_hand: number; valued_quantity: number; stock_value: string;
  }[]).map((r) => {
    const onHand = Number(r.quantity_on_hand);
    const valued = Number(r.valued_quantity);
    return {
      productId: Number(r.id),
      sku: r.sku,
      name: r.name,
      unit: r.unit,
      onHand,
      valuedQuantity: valued,
      unvaluedQuantity: onHand - valued,
      stockValue: roundMoney(r.stock_value, baseCurrency),
      // Display only — the pool itself is quantity and value, never a stored unit cost.
      averageCost: valued > 0 ? String(Number(r.stock_value) / valued) : null,
    };
  });
  return {
    rows,
    totalValue: roundMoney(rows.reduce((sum, r) => sum + Number(r.stockValue), 0), baseCurrency),
    unvaluedProducts: rows.filter((r) => r.unvaluedQuantity !== 0).length,
  };
}

export type InventoryReconciliation = {
  /** GL 1200 Inventory balance (debit positive). */
  glInventory: string;
  /** Σ of the products' pools. */
  valuedStock: string;
  /** Σ of costed movements — equals valuedStock when the stock side holds together. */
  movementValue: string;
  /** GL 1200 that no movement explains, by the source type of its entry. */
  unattributed: { sourceType: string; entries: number; amount: string }[];
  unattributedTotal: string;
  /** Products whose stored pool differs from the sum of their costed movements. */
  poolMismatches: { productId: number; sku: string; valuedQuantity: number; movementQuantity: number; stockValue: string; movementValue: string }[];
  /** Costed movements with a cost but no journal entry. */
  detachedMovements: number;
  /** Units issued with no cost basis — sales whose COGS is missing. */
  uncostedIssues: { movements: number; quantity: number };
  /** True when the stock side holds together and GL 1200 = valued stock + unattributed. */
  integrityOk: boolean;
  /** True when, in addition, nothing in GL 1200 is unexplained: the ledger equals the valuation. */
  reconciled: boolean;
};

export async function getInventoryReconciliation(orgId: number, baseCurrency: string): Promise<InventoryReconciliation> {
  const money = (v: string | number | null | undefined) => roundMoney(v ?? 0, baseCurrency);

  const gl = await db.execute(sql`
    select coalesce(sum(l.debit - l.credit), 0)::text as balance
      from journal_lines l
      join journal_entries e on e.id = l.journal_entry_id
      join accounts a on a.id = l.account_id
     where e.org_id = ${orgId} and a.org_id = ${orgId} and a.code = ${INVENTORY_ACCOUNT}`);
  const glInventory = money((gl.rows[0] as { balance: string }).balance);

  const pools = await db.execute(sql`
    select coalesce(sum(stock_value), 0)::text as value from products where org_id = ${orgId}`);
  const valuedStock = money((pools.rows[0] as { value: string }).value);

  // An uncosted issue that was later reversed (its invoice voided) no longer counts as missing COGS.
  const moves = await db.execute(sql`
    with m as (
      select mv.*, exists (select 1 from inventory_movements r where r.org_id = ${orgId} and r.reverses_movement_id = mv.id) as reversed
        from inventory_movements mv where mv.org_id = ${orgId})
    select coalesce(sum(total_cost), 0)::text as value,
           count(*) filter (where total_cost is not null and total_cost <> 0 and journal_entry_id is null)::int as detached,
           count(*) filter (where total_cost is null and kind = 'issue' and not reversed)::int as uncosted_issues,
           coalesce(-sum(quantity) filter (where total_cost is null and kind = 'issue' and not reversed), 0)::int as uncosted_quantity
      from m`);
  const m = moves.rows[0] as { value: string; detached: number; uncosted_issues: number; uncosted_quantity: number };

  // Entry by entry: 1200 net against the cost of the movements that belong to it.
  const residuals = await db.execute(sql`
    with gl as (
      select l.journal_entry_id as entry_id, sum(l.debit - l.credit) as amount
        from journal_lines l
        join journal_entries e on e.id = l.journal_entry_id
        join accounts a on a.id = l.account_id
       where e.org_id = ${orgId} and a.org_id = ${orgId} and a.code = ${INVENTORY_ACCOUNT}
       group by l.journal_entry_id),
    mv as (
      select journal_entry_id as entry_id, sum(total_cost) as amount
        from inventory_movements
       where org_id = ${orgId} and total_cost is not null and journal_entry_id is not null
       group by journal_entry_id)
    select e.source_type, count(*)::int as entries, sum(coalesce(gl.amount, 0) - coalesce(mv.amount, 0))::text as amount
      from gl full outer join mv on mv.entry_id = gl.entry_id
      join journal_entries e on e.id = coalesce(gl.entry_id, mv.entry_id) and e.org_id = ${orgId}
     where coalesce(gl.amount, 0) <> coalesce(mv.amount, 0)
     group by e.source_type
     order by e.source_type`);
  const unattributed = (residuals.rows as unknown as { source_type: string; entries: number; amount: string }[])
    .map((r) => ({ sourceType: r.source_type, entries: Number(r.entries), amount: money(r.amount) }));
  const unattributedTotal = money(unattributed.reduce((sum, r) => sum + Number(r.amount), 0));

  const mismatch = await db.execute(sql`
    select p.id, p.sku, p.valued_quantity, p.stock_value::text as stock_value,
           coalesce(sum(m.quantity) filter (where m.total_cost is not null), 0)::int as movement_quantity,
           coalesce(sum(m.total_cost), 0)::text as movement_value
      from products p
      left join inventory_movements m on m.product_id = p.id and m.org_id = ${orgId}
     where p.org_id = ${orgId}
     group by p.id
    having p.valued_quantity <> coalesce(sum(m.quantity) filter (where m.total_cost is not null), 0)
        or p.stock_value <> coalesce(sum(m.total_cost), 0)
     order by p.id`);
  const poolMismatches = (mismatch.rows as unknown as {
    id: number; sku: string; valued_quantity: number; stock_value: string; movement_quantity: number; movement_value: string;
  }[]).map((r) => ({
    productId: Number(r.id), sku: r.sku, valuedQuantity: Number(r.valued_quantity), movementQuantity: Number(r.movement_quantity),
    stockValue: money(r.stock_value), movementValue: money(r.movement_value),
  }));

  const movementValue = money(m.value);
  const integrityOk = poolMismatches.length === 0 && Number(m.detached) === 0 && movementValue === valuedStock
    && money(Number(glInventory) - Number(unattributedTotal)) === valuedStock;
  return {
    glInventory,
    valuedStock,
    movementValue,
    unattributed,
    unattributedTotal,
    poolMismatches,
    detachedMovements: Number(m.detached),
    uncostedIssues: { movements: Number(m.uncosted_issues), quantity: Number(m.uncosted_quantity) },
    integrityOk,
    reconciled: integrityOk && Number(unattributedTotal) === 0,
  };
}
