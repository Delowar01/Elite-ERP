import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgsTable } from "./orgs";
import { recordStateEnum } from "./record-state";

export const customersTable = pgTable("customers", {
  logoUrl: text("logo_url"),
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // Individual person vs. company/legal business entity. Existing rows default to individual (no
  // data loss — the name column is reused for the person or business name).
  clientType: text("client_type").notNull().default("individual"),
  email: text("email"),
  phone: text("phone"),
  // Legacy single-line address kept for existing clients; the structured fields below are preferred.
  address: text("address"),
  countryCode: text("country_code"),
  stateProvince: text("state_province"),
  district: text("district"),
  city: text("city"),
  buildingNumber: text("building_number"),
  // Saudi National Address "Additional Number" (secondary building identifier); shown only for
  // country profiles that support it (currently SA). Nullable/additive.
  additionalNumber: text("additional_number"),
  postalCode: text("postal_code"),
  streetAddress: text("street_address"),
  taxId: text("tax_id"),
  vatNumber: text("vat_number"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  recordState: recordStateEnum("record_state").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCustomerSchema = createInsertSchema(customersTable).omit({
  id: true,
  recordState: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customersTable.$inferSelect;
