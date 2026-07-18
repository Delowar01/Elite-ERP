import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const orgsTable = pgTable("orgs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  industry: text("industry"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  taxId: text("tax_id"),
  vatNumber: text("vat_number"),
  currency: text("currency").notNull().default("SAR"),
  country: text("country"),
  defaultLanguage: text("default_language").notNull().default("en"), // en | ar

  // Company branding (Business Settings -> Logo / Color Theme)
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color").notNull().default("#1B1B4E"),
  accentColor: text("accent_color").notNull().default("#E87722"),

  // Documents (Business Settings -> Seal & Signature / Print Layout)
  sealUrl: text("seal_url"),
  signatureUrl: text("signature_url"),
  printLayout: text("print_layout").notNull().default("classic"), // classic | modern | minimal
  paperSize: text("paper_size").notNull().default("A4"),
  printMarginMm: integer("print_margin_mm").notNull().default(20),

  // Finance (Business Settings -> Default Bank Account / Fiscal Year / VAT Configuration)
  // No FK constraint on defaultBankAccountId: bank_accounts.org_id already references orgs.id,
  // so a reverse reference here would create a circular module import between orgs.ts and
  // finance.ts. Validated at the action layer instead (the row must belong to the same org).
  defaultBankAccountId: integer("default_bank_account_id"),
  fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1), // 1-12
  vatRegistrationStatus: text("vat_registration_status").notNull().default("registered"), // registered | not_registered
  defaultTaxTreatment: text("default_tax_treatment").notNull().default("exclusive"), // inclusive | exclusive
  vatRounding: text("vat_rounding").notNull().default("nearest_0_01"),

  // Integrations (Business Settings -> ZATCA E-Invoicing) — connection status/reference fields
  // only; the actual e-invoice generation/signing pipeline is built alongside the Invoice module.
  zatcaEnvironment: text("zatca_environment").notNull().default("sandbox"), // sandbox | production
  zatcaCsid: text("zatca_csid"),
  zatcaCertExpiresAt: timestamp("zatca_cert_expires_at"),

  // --- Stage 11: configurable password policy (per-org) ---
  pwdMinLength: integer("pwd_min_length").notNull().default(8),
  pwdRequireUppercase: boolean("pwd_require_uppercase").notNull().default(true),
  pwdRequireLowercase: boolean("pwd_require_lowercase").notNull().default(true),
  pwdRequireNumber: boolean("pwd_require_number").notNull().default(true),
  pwdRequireSpecial: boolean("pwd_require_special").notNull().default(true),
  pwdHistoryCount: integer("pwd_history_count").notNull().default(5),
  pwdExpiryDays: integer("pwd_expiry_days").notNull().default(0), // 0 = no expiry
  mfaRequiredForPrivileged: boolean("mfa_required_for_privileged").notNull().default(true),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertOrgSchema = createInsertSchema(orgsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrg = z.infer<typeof insertOrgSchema>;
export type Org = typeof orgsTable.$inferSelect;
