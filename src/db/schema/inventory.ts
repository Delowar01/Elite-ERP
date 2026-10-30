import { pgTable, pgEnum, serial, integer, text, numeric, date, timestamp, index, foreignKey } from "drizzle-orm/pg-core";
import { orgsTable } from "./orgs";
import { usersTable } from "./users";
import { productsTable } from "./products";
import { journalEntriesTable } from "./accounting";

/**
 * ACC-01 — the stock ledger behind weighted-average costing.
 *
 * One row per stock event on a STOCK item (services never appear): an opening balance, a purchase
 * receipt, a sales issue, a purchase return, a manual adjustment, or the exact reversal of one of
 * those. Rows are only ever inserted — a correction is a new `reversal` row pointing at the row it
 * undoes — so the table is the audit history of every quantity and every unit of cost.
 *
 * ## The two quantities on a product, and how these rows tie to them
 *
 * `products.quantity_on_hand` is the physical count. `products.valued_quantity` /
 * `products.stock_value` are the part of it carried at cost (the weighted-average pool). For every
 * product:
 *
 *   Σ quantity   over COSTED rows (total_cost not null) = valued_quantity
 *   Σ total_cost over COSTED rows                      = stock_value
 *
 * The difference `quantity_on_hand − valued_quantity` is stock with NO cost basis — quantities that
 * existed before ACC-01 (or were written outside the app). It is never valued at zero: issuing it
 * writes an UNCOSTED row (total_cost null) and posts no COGS, and the valuation report lists it as
 * an incomplete-data exception.
 *
 * ## The tie to the ledger
 *
 * Every row a posted document wrote carries `journal_entry_id` — the entry of that posting (or of its
 * reversal), whose 1200 Inventory line holds the costed rows' cost — so the inventory-to-GL
 * reconciliation can attribute each 1200 line to the movements behind it and isolate what is left
 * (pre-ACC-01 postings, manual journals). A costed row with a non-zero cost always has one.
 *
 * `source_type` / `source_id` follow the journal's identity rule: the pair, never the id alone.
 * Values: sales_invoice | purchase_order | debit_note — the document — or product (opening stock and
 * manual adjustments, keyed by the product; their journal entries key off the movement instead:
 * `(inventory_opening | inventory_adjustment, <movement id>)`).
 */
export const inventoryMovementKindEnum = pgEnum("inventory_movement_kind", [
  "opening",
  "receipt",
  "issue",
  "purchase_return",
  "adjustment",
  "reversal",
]);
export type InventoryMovementKind = (typeof inventoryMovementKindEnum.enumValues)[number];

export const inventoryMovementsTable = pgTable(
  "inventory_movements",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
      .notNull()
      .references(() => orgsTable.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id),
    movementDate: date("movement_date").notNull(),
    kind: inventoryMovementKindEnum("kind").notNull(),
    /** Signed whole units: positive in, negative out. */
    quantity: integer("quantity").notNull(),
    /** Signed base-currency cost moved with the quantity; NULL = uncosted (no cost basis). */
    totalCost: numeric("total_cost", { precision: 15, scale: 3 }),
    sourceType: text("source_type").notNull(),
    sourceId: integer("source_id"),
    /** The document line (invoice / PO / debit note item id) this row came from, when there is one. */
    sourceLineId: integer("source_line_id"),
    journalEntryId: integer("journal_entry_id").references(() => journalEntriesTable.id),
    reversesMovementId: integer("reverses_movement_id"),
    memo: text("memo"),
    createdById: integer("created_by_id")
      .notNull()
      .references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("inventory_movements_org_product_idx").on(t.orgId, t.productId, t.id),
    index("inventory_movements_org_source_idx").on(t.orgId, t.sourceType, t.sourceId),
    // Named explicitly: the generated name is longer than Postgres's 63-byte limit, so every push
    // would drop and re-add (and re-validate) it against the truncated name the database holds.
    foreignKey({ name: "inventory_movements_reverses_movement_fk", columns: [t.reversesMovementId], foreignColumns: [t.id] }),
  ],
);

export type InventoryMovement = typeof inventoryMovementsTable.$inferSelect;
