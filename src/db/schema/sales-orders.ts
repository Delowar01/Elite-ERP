import { pgTable, serial, integer, text, numeric, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgsTable } from "./orgs";
import { customersTable } from "./customers";
import { productsTable } from "./products";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { quotationsTable } from "./quotations";

export const salesOrdersTable = pgTable("sales_orders", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  soNumber: text("so_number").notNull(),
  title: text("title"),
  customerId: integer("customer_id")
    .notNull()
    .references(() => customersTable.id),
  projectId: integer("project_id").references(() => projectsTable.id),
  sourceQuotationId: integer("source_quotation_id").references(() => quotationsTable.id),
  status: text("status").notNull().default("draft"), // draft | confirmed | fulfilled | cancelled
  issueDate: date("issue_date").notNull(),
  expectedDate: date("expected_date"),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  discount: numeric("discount", { precision: 14, scale: 2 }).notNull().default("0"),
  taxTotal: numeric("tax_total", { precision: 14, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 14, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  createdById: integer("created_by_id")
    .notNull()
    .references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertSalesOrderSchema = createInsertSchema(salesOrdersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSalesOrder = z.infer<typeof insertSalesOrderSchema>;
export type SalesOrder = typeof salesOrdersTable.$inferSelect;

export const salesOrderItemsTable = pgTable("sales_order_items", {
  id: serial("id").primaryKey(),
  salesOrderId: integer("sales_order_id")
    .notNull()
    .references(() => salesOrdersTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id),
  description: text("description"),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull().default("1"),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
  taxRatePercent: numeric("tax_rate_percent", { precision: 5, scale: 2 }).notNull().default("15"),
  lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull().default("0"),
});
export type SalesOrderItem = typeof salesOrderItemsTable.$inferSelect;
