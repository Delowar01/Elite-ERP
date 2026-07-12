import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const orgsTable = pgTable("orgs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  industry: text("industry"),
  address: text("address"),
  phone: text("phone"),
  taxId: text("tax_id"),
  vatNumber: text("vat_number"),
  currency: text("currency").notNull().default("SAR"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertOrgSchema = createInsertSchema(orgsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrg = z.infer<typeof insertOrgSchema>;
export type Org = typeof orgsTable.$inferSelect;
