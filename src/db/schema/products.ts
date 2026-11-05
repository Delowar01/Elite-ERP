import { pgTable, pgEnum, serial, integer, text, numeric, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgsTable } from "./orgs";
import { recordStateEnum } from "./record-state";

// ACC-01: a service is never counted, valued or costed; a stock item is (see inventory_movements).
export const inventoryItemTypeEnum = pgEnum("inventory_item_type", ["stock", "service"]);
export type InventoryItemType = (typeof inventoryItemTypeEnum.enumValues)[number];

export const productsTable = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
      .notNull()
      .references(() => orgsTable.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    // Item image, saved to the master when a document line is promoted to a product ("Save this item").
    imageUrl: text("image_url"),
    unit: text("unit").notNull().default("pcs"),
    unitPrice: numeric("unit_price", { precision: 15, scale: 3 }).notNull().default("0"),
    costPrice: numeric("cost_price", { precision: 15, scale: 3 }),
    taxRatePercent: numeric("tax_rate_percent", { precision: 5, scale: 2 }).notNull().default("15"),
    quantityOnHand: integer("quantity_on_hand").notNull().default(0),
    // Existing rows are stock — what every product was before ACC-01.
    itemType: inventoryItemTypeEnum("item_type").notNull().default("stock"),
    // ACC-01 weighted-average pool: the on-hand units carried at cost, and their base-currency value.
    // quantity_on_hand − valued_quantity is stock with no cost basis (see inventory_movements).
    valuedQuantity: integer("valued_quantity").notNull().default(0),
    stockValue: numeric("stock_value", { precision: 15, scale: 3 }).notNull().default("0"),
    reorderLevel: integer("reorder_level").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    recordState: recordStateEnum("record_state").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.orgId, t.sku)],
);

export const insertProductSchema = createInsertSchema(productsTable).omit({
  id: true,
  recordState: true,
  valuedQuantity: true,
  stockValue: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
