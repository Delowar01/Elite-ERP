// Central country-profile registry.
//
// One shared ERP interface; only country-specific fields, labels, defaults and validation change
// based on the organization's registered country. Add a new country by adding one entry here — no
// shared form, page or module changes required. Countries without a dedicated profile use GLOBAL.
//
// This module is pure (no server-only imports) so both Server Components and Client Components can
// import it. It builds on the country/state datasets in ./countries.

import { countryCodeByName, countryName } from "./countries";
import { currencyCodeForCountry } from "../currency/currencies";

// A registration/identity field surfaced on org + client/vendor forms (e.g. Commercial Registration
// Number, Trade License Number). `key` maps to an existing column so no per-country schema is needed.
export type RegistrationField = {
  key: "taxId";
  label: string; // "Commercial Registration Number"
  shortLabel: string; // "CR Number"
  placeholder?: string;
};

// Which underlying structured-address column an address field maps to. The storage columns are fixed
// (customers.*), the profile only decides which are shown, in what order, with which label/validation.
export type AddressFieldKey =
  | "country"
  | "stateProvince"
  | "district"
  | "city"
  | "buildingNumber"
  | "additionalNumber"
  | "postalCode"
  | "streetAddress";

export type AddressFieldControl = "country" | "state" | "text";

export type AddressFieldConfig = {
  key: AddressFieldKey;
  label: string;
  control: AddressFieldControl;
  placeholder?: string;
  fullWidth?: boolean;
  // Validation applied when a value is entered. "sa-building" = 4 digits; "postal" = alphanumeric.
  validate?: "sa-building" | "postal";
};

export type TaxSystem = "VAT" | "GST" | "Sales Tax" | "None";

// A country-specific capability toggle. Kept as opaque strings so new features slot in without a
// type change. Currently only "zatca_phase1" is meaningful (Saudi Arabia only).
export type CountryFeature = "zatca_phase1";

export type CountryProfile = {
  countryCode: string;
  countryName: string;
  defaultCurrencyCode: string;
  taxSystem: TaxSystem;
  taxName: string; // "VAT" / "Tax" — the human name of the tax system
  taxNumberLabel: string; // labels the customers/orgs.vat_number column ("VAT Number" / "TRN")
  registrationFields: RegistrationField[];
  addressFields: AddressFieldConfig[];
  defaultTaxRate: number; // percent applied to new document lines
  enabledFeatures: CountryFeature[];
  // GLOBAL is configurable: an org may override tax name / tax-number label / registration label.
  configurable: boolean;
};

// ---- Shared address-field building blocks (reused across profiles for consistency) ----
const COUNTRY_FIELD: AddressFieldConfig = { key: "country", label: "Country", control: "country" };
const STREET_FIELD: AddressFieldConfig = { key: "streetAddress", label: "Street Address", control: "text", placeholder: "Street Address", fullWidth: true };

// ---- Saudi Arabia ----
const SAUDI_ARABIA: CountryProfile = {
  countryCode: "SA",
  countryName: "Saudi Arabia",
  defaultCurrencyCode: "SAR",
  taxSystem: "VAT",
  taxName: "VAT",
  taxNumberLabel: "VAT Number",
  registrationFields: [
    { key: "taxId", label: "Commercial Registration Number", shortLabel: "CR Number", placeholder: "1010XXXXXX" },
  ],
  // SA National Address: Building Number (4 digits), Street, District, City, Postal Code,
  // Additional Number, Country. No state/region field.
  addressFields: [
    { key: "buildingNumber", label: "Building Number", control: "text", placeholder: "4 Digit Building Number", validate: "sa-building" },
    { key: "streetAddress", label: "Street", control: "text", placeholder: "Street" },
    { key: "district", label: "District", control: "text", placeholder: "District Name" },
    { key: "city", label: "City", control: "text", placeholder: "City" },
    { key: "postalCode", label: "Postal Code", control: "text", placeholder: "Postal Code", validate: "postal" },
    { key: "additionalNumber", label: "Additional Number", control: "text", placeholder: "Additional Number" },
    COUNTRY_FIELD,
  ],
  defaultTaxRate: 15,
  enabledFeatures: ["zatca_phase1"], // ZATCA Phase 1 only — Phase 2 explicitly out of scope
  configurable: false,
};

// ---- United Arab Emirates ----
const UAE: CountryProfile = {
  countryCode: "AE",
  countryName: "United Arab Emirates",
  defaultCurrencyCode: "AED",
  taxSystem: "VAT",
  taxName: "VAT",
  taxNumberLabel: "TRN", // Tax Registration Number
  registrationFields: [
    { key: "taxId", label: "Trade License Number", shortLabel: "Trade License", placeholder: "CN-XXXXXXX" },
  ],
  // UAE address: Emirate, Area, City, Street, Building, PO Box / Postal Code, Country.
  addressFields: [
    { key: "stateProvince", label: "Emirate", control: "state", placeholder: "Select Emirate" },
    { key: "district", label: "Area", control: "text", placeholder: "Area" },
    { key: "city", label: "City", control: "text", placeholder: "City" },
    { key: "streetAddress", label: "Street", control: "text", placeholder: "Street" },
    { key: "buildingNumber", label: "Building", control: "text", placeholder: "Building" },
    { key: "postalCode", label: "PO Box / Postal Code", control: "text", placeholder: "PO Box / Postal Code", validate: "postal" },
    COUNTRY_FIELD,
  ],
  defaultTaxRate: 5,
  enabledFeatures: [], // no UAE e-invoicing / compliance module
  configurable: false,
};

// ---- Global default (every country without a dedicated profile) ----
const GLOBAL: CountryProfile = {
  countryCode: "",
  countryName: "Global",
  defaultCurrencyCode: "USD", // overridden by the org's chosen country currency where known
  taxSystem: "None",
  taxName: "Tax",
  taxNumberLabel: "Tax Number",
  registrationFields: [
    { key: "taxId", label: "Registration Number", shortLabel: "Reg. Number" },
  ],
  // Standard international address fields.
  addressFields: [
    COUNTRY_FIELD,
    { key: "stateProvince", label: "State / Province", control: "state", placeholder: "Select State / Province" },
    { key: "district", label: "District", control: "text", placeholder: "District Name" },
    { key: "city", label: "City / Town", control: "text", placeholder: "City/Town Name" },
    { key: "buildingNumber", label: "Building Number", control: "text", placeholder: "Building Number" },
    { key: "postalCode", label: "Postal / ZIP Code", control: "text", placeholder: "Postal / ZIP Code", validate: "postal" },
    STREET_FIELD,
  ],
  defaultTaxRate: 0,
  enabledFeatures: [],
  configurable: true,
};

const PROFILES: Record<string, CountryProfile> = {
  SA: SAUDI_ARABIA,
  AE: UAE,
};

export const COUNTRY_PROFILES: CountryProfile[] = [SAUDI_ARABIA, UAE];
export const GLOBAL_PROFILE = GLOBAL;

// Resolve a profile by ISO country code. Unknown/empty codes fall back to a GLOBAL profile whose
// default currency follows the given country's own currency when known.
//
// That last clause is what this comment always claimed and the code did not do: `defaultCurrencyCode`
// stayed at GLOBAL's "USD" for every country without a dedicated profile, so a German org was shown
// USD. Invisible while nobody was asked their country; a visible defect the moment registration
// started asking. `currencyCodeForCountry` now supplies it, falling back to USD only for a country
// genuinely not in the catalog.
export function getCountryProfile(countryCode: string | null | undefined): CountryProfile {
  const code = (countryCode ?? "").trim().toUpperCase();
  const dedicated = PROFILES[code];
  if (dedicated) return dedicated;
  // Global profile personalized to the resolved country name/currency where we can.
  return {
    ...GLOBAL,
    countryCode: code,
    countryName: countryName(code) || GLOBAL.countryName,
    defaultCurrencyCode: currencyCodeForCountry(code) ?? GLOBAL.defaultCurrencyCode,
  };
}

// Resolve a profile from an org's stored country NAME (e.g. "Saudi Arabia"). This is what the app
// stores today; the code is derived so no schema migration of orgs.country is needed.
export function getProfileByCountryName(name: string | null | undefined): CountryProfile {
  return getCountryProfile(countryCodeByName(name));
}

// A serializable, resolved label set for a given org — merges the profile defaults with any org-level
// overrides (only honored for the configurable GLOBAL profile). Safe to pass across the RSC boundary.
export type ResolvedTaxLabels = {
  taxName: string;
  taxNumberLabel: string;
  registrationLabel: string;
  registrationShortLabel: string;
  registrationPlaceholder?: string;
  defaultTaxRate: number;
};

// Accepts an org-shaped object carrying the optional override columns. Overrides are only honored for
// the configurable Global profile; dedicated profiles always use their fixed terminology.
export function resolveTaxLabels(
  profile: CountryProfile,
  org?: { customTaxName?: string | null; customTaxNumberLabel?: string | null; customRegistrationLabel?: string | null } | null,
): ResolvedTaxLabels {
  const reg = profile.registrationFields[0];
  const allow = profile.configurable;
  return {
    taxName: (allow && org?.customTaxName?.trim()) || profile.taxName,
    taxNumberLabel: (allow && org?.customTaxNumberLabel?.trim()) || profile.taxNumberLabel,
    registrationLabel: (allow && org?.customRegistrationLabel?.trim()) || reg.label,
    registrationShortLabel: reg.shortLabel,
    registrationPlaceholder: reg.placeholder,
    defaultTaxRate: profile.defaultTaxRate,
  };
}

export function profileHasFeature(profile: CountryProfile, feature: CountryFeature): boolean {
  return profile.enabledFeatures.includes(feature);
}
