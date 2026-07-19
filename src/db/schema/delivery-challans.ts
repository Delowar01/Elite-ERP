import { pgTable, serial, integer, text, numeric, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgsTable } from "./orgs";
import { customersTable } from "./customers";
import { productsTable } from "./products";
import { usersTable } from "./users";
import { quotationsTable } from "./quotations";
import { salesOrdersTable } from "./sales-orders";
import { proformaInvoicesTable } from "./proforma-invoices";
import { salesInvoicesTable } from "./sales-invoices";

export const deliveryChallansTable = pgTable("delivery_challans", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  dcNumber: text("dc_number").notNull(),
  title: text("title"),
  customerId: integer("customer_id")
    .notNull()
    .references(() => customersTable.id),
  sourceQuotationId: integer("source_quotation_id").references(() => quotationsTable.id),
  sourceSalesOrderId: integer("source_sales_order_id").references(() => salesOrdersTable.id),
  sourceProformaId: integer("source_proforma_id").references(() => proformaInvoicesTable.id),
  sourceInvoiceId: integer("source_invoice_id").references(() => salesInvoicesTable.id),
  status: text("status").notNull().default("draft"), // draft | dispatched | delivered — logistics-only, no stock/accounting posting
  dispatchDate: date("dispatch_date"),
  deliveredDate: date("delivered_date"),
  carrier: text("carrier"),
  vehicleNo: text("vehicle_no"),
  notes: text("notes"),
  createdById: integer("created_by_id")
    .notNull()
    .references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertDeliveryChallanSchema = createInsertSchema(deliveryChallansTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDeliveryChallan = z.infer<typeof insertDeliveryChallanSchema>;
export type DeliveryChallan = typeof deliveryChallansTable.$inferSelect;

export const deliveryChallanItemsTable = pgTable("delivery_challan_items", {
  id: serial("id").primaryKey(),
  deliveryChallanId: integer("delivery_challan_id")
    .notNull()
    .references(() => deliveryChallansTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id),
  description: text("description"),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull().default("1"),
});
export type DeliveryChallanItem = typeof deliveryChallanItemsTable.$inferSelect;
