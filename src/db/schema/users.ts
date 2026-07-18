import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgsTable } from "./orgs";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("staff"), // owner | admin | staff
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at"),
  // --- Stage 11: MFA (TOTP) ---
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  mfaSecret: text("mfa_secret"), // field-encrypted TOTP secret (base32)
  mfaRecoveryCodes: text("mfa_recovery_codes"), // field-encrypted JSON array of bcrypt-hashed recovery codes
  // --- Stage 11: password lifecycle ---
  passwordChangedAt: timestamp("password_changed_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

export type Role = "owner" | "admin" | "staff";
export const ROLE_RANK: Record<Role, number> = { staff: 0, admin: 1, owner: 2 };
