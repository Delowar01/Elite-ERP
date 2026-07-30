import { pgTable, serial, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
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

  // Country-profile overrides — only honored for the configurable Global profile (countries without
  // a dedicated profile). When null, the resolved country profile's defaults are used. Dedicated
  // profiles (Saudi Arabia, UAE) ignore these and always use their fixed terminology.
  customTaxName: text("custom_tax_name"),
  customTaxNumberLabel: text("custom_tax_number_label"),
  customRegistrationLabel: text("custom_registration_label"),

  // Company branding (Business Settings -> Logo / Color Theme)
  logoUrl: text("logo_url"),
  // "gradient" (Elite default) or "single" (solid primary + accent). Existing/new orgs default to gradient.
  colorThemeMode: text("color_theme_mode").notNull().default("gradient"),
  primaryColor: text("primary_color").notNull().default("#1B1B4E"),
  accentColor: text("accent_color").notNull().default("#E87722"),

  // Documents — org-wide seal/signature (the fallback default; per-document-type defaults live in
  // orgs.sealDefaults + seal_signature_assets, managed under Preset Management → Seal & Signature).
  sealUrl: text("seal_url"),
  signatureUrl: text("signature_url"),
  // Per-document-type default seal/signature (Preset Management → Seal & Signature). Maps a
  // document type (e.g. "sales_invoice") to the chosen asset ids; unset types fall back to the
  // org-wide sealUrl/signatureUrl. Snapshots are taken at document save, so editing this only
  // affects NEW documents.
  sealDefaults: jsonb("seal_defaults").$type<Record<string, { sealAssetId?: number | null; signatureAssetId?: number | null }>>(),

  // Print Layout (Preset Management → Print Layout). Applied to every rendered document
  // (preview, browser print, PDF, download/share) since all go through the one /print route.
  printLayout: text("print_layout").notNull().default("classic"), // classic | modern | minimal | custom
  paperSize: text("paper_size").notNull().default("A4"),
  printMarginMm: integer("print_margin_mm").notNull().default(20),
  // One color theme applied to all documents (named preset → header/accent color in print.css).
  // Default "orange" == the existing PDF accent (#E87722), so current documents look unchanged.
  documentColorTheme: text("document_color_theme").notNull().default("orange"),
  // Per-document-type layout override; unset types use printLayout (the default layout).
  documentLayoutOverrides: jsonb("document_layout_overrides").$type<Record<string, string>>(),
  // Optional custom letterhead/background uploaded by the org (validated, org-scoped). Used when a
  // document's resolved layout is "custom".
  customLayoutUrl: text("custom_layout_url"),

  // Finance (Business Settings -> Default Bank Account / Fiscal Year / VAT Configuration)
  // No FK constraint on defaultBankAccountId: bank_accounts.org_id already references orgs.id,
  // so a reverse reference here would create a circular module import between orgs.ts and
  // finance.ts. Validated at the action layer instead (the row must belong to the same org).
  defaultBankAccountId: integer("default_bank_account_id"),
  // Preset Management → Default Bank Accounts. Ordered list of bank_accounts.id that pre-fill the
  // Bank Account section on NEW documents (display-only payment instructions). Stored as an ordered
  // id array; document snapshots are taken at save so changing this never alters saved documents.
  defaultBankAccountIds: jsonb("default_bank_account_ids").$type<number[]>(),
  // Remembered "Valid Till = Issue Date + N days" offset for documents with a Valid Till (Quotation).
  // Set from the Valid Till gear popup; new documents auto-compute Valid Till from this, and it is
  // recalculated whenever the Issue Date changes.
  defaultValidityDays: integer("default_validity_days").notNull().default(30),
  fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1), // 1-12
  vatRegistrationStatus: text("vat_registration_status").notNull().default("registered"), // registered | not_registered
  defaultTaxTreatment: text("default_tax_treatment").notNull().default("exclusive"), // inclusive | exclusive
  vatRounding: text("vat_rounding").notNull().default("nearest_0_01"),

  // Number Format (Business Settings -> Number Format). Display formatting for documents only — it
  // never changes stored accounting values. Existing orgs default to 2 decimals + international
  // grouping + no rounding + no custom symbol (so historical documents render exactly as before).
  numberDigitGrouping: text("number_digit_grouping").notNull().default("international"), // international | indian
  numberDecimalPlaces: integer("number_decimal_places").notNull().default(2), // 0 | 1 | 2 | 3
  roundQuantities: boolean("round_quantities").notNull().default(false),
  roundRates: boolean("round_rates").notNull().default(false),
  customCurrencySymbol: text("custom_currency_symbol"), // optional override; null = use official symbol/code

  // Integrations (Business Settings -> ZATCA E-Invoicing) — ZATCA Phase 1 only.
  // Once an eligible Saudi org enables Phase 1 it is locked ON for organization users: only a
  // backend administrator / Elite Marcom Platform Owner may turn it off. Enabling and any backend
  // disabling are both recorded in the immutable audit log.
  zatcaPhase1Enabled: boolean("zatca_phase1_enabled").notNull().default(false),
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
