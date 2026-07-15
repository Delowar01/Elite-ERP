import { pgTable, serial, integer, text, numeric, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgsTable } from "./orgs";
import { recordStateEnum } from "./record-state";

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
    unit: text("unit").notNull().default("pcs"),
    unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
    costPrice: numeric("cost_price", { precision: 14, scale: 2 }),
    taxRatePercent: numeric("tax_rate_percent", { precision: 5, scale: 2 }).notNull().default("15"),
    quantityOnHand: integer("quantity_on_hand").notNull().default(0),
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
  createdAt: true,
  updatedAt: true,
});
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
