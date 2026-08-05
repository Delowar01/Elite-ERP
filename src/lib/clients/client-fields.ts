import { buildingNumberError, postalCodeError, composeAddress, getCountry, countryCodeByName } from "@/lib/geo/countries";

// One place that turns raw client input (form fields or a spreadsheet row) into the exact column
// values written to `customers`. The create/edit form and the batch importer both call this, so a
// value the form accepts can never be rejected by import, or vice versa.

/** Columns a client carries. Values are already trimmed; empty strings become null. */
export type ClientFieldValues = Record<string, string | null>;

export type NormalizeResult = { errors: string[]; fields?: ClientFieldValues };

const clean = (v: string | undefined | null) => String(v ?? "").trim();

/** Country may be given as an ISO code ("SA") or a country name ("Saudi Arabia"). */
export function resolveCountryCode(raw: string): { code: string | null; ok: boolean } {
  const v = clean(raw);
  if (!v) return { code: null, ok: true };
  const upper = v.toUpperCase();
  if (getCountry(upper)) return { code: upper, ok: true };
  const byName = countryCodeByName(v);
  return byName ? { code: byName, ok: true } : { code: null, ok: false };
}

/** Deliberately permissive: one @, no spaces, a dot in the domain. */
export function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean(v));
}

/**
 * Phone sanity check. The app has never enforced a phone format anywhere else, so this only rejects
 * input that cannot be a phone number at all (stray letters, too few digits) rather than imposing a
 * country pattern that would refuse legitimate international numbers.
 */
export function isValidPhone(v: string): boolean {
  const s = clean(v);
  if (!/^[+()\-.\s\d]+$/.test(s)) return false;
  return (s.match(/\d/g) ?? []).length >= 6;
}

export type NormalizeOptions = {
  /**
   * Reject a country the app doesn't know (import). The create/edit form picks countries from a
   * fixed list and has never validated the value, so it keeps the permissive behaviour — that way
   * an older client carrying an unrecognized code can still be saved from the form.
   */
  strictCountry?: boolean;
};

/**
 * Normalize + validate one client's fields. `input` uses the same keys as the customers columns.
 * Every field except `name` is optional, and a blank optional value is never an error.
 */
export function normalizeClientFields(
  input: Record<string, string | undefined>,
  { strictCountry = true }: NormalizeOptions = {},
): NormalizeResult {
  const errors: string[] = [];

  const name = clean(input.name);
  if (!name) errors.push("Client Name is required.");

  const typeRaw = clean(input.clientType).toLowerCase();
  if (typeRaw && !["individual", "company"].includes(typeRaw)) {
    errors.push(`Client Type "${clean(input.clientType)}" must be either "individual" or "company".`);
  }
  const clientType = typeRaw === "company" ? "company" : "individual";

  const email = clean(input.email);
  if (email && !isValidEmail(email)) errors.push(`Email "${email}" is not a valid email address.`);

  const phone = clean(input.phone);
  if (phone && !isValidPhone(phone)) errors.push(`Phone "${phone}" is not a valid phone number.`);

  const rawCountry = clean(input.countryCode);
  const resolved = resolveCountryCode(rawCountry);
  if (!resolved.ok && strictCountry) errors.push(`Country "${rawCountry}" is not a country Elite ERP recognizes.`);
  // Non-strict: keep whatever the caller sent, uppercased, exactly as the form always did.
  const country = { code: resolved.ok ? resolved.code : (strictCountry ? null : rawCountry.toUpperCase() || null) };

  const buildingNumber = clean(input.buildingNumber) || null;
  const postalCode = clean(input.postalCode) || null;
  // Reuse the app's own address rules rather than restating them.
  const bErr = buildingNumberError(country.code, buildingNumber ?? "");
  if (bErr) errors.push(bErr);
  const pErr = postalCodeError(postalCode ?? "");
  if (pErr) errors.push(pErr);

  const structured = {
    countryCode: country.code,
    stateProvince: clean(input.stateProvince) || null,
    district: clean(input.district) || null,
    city: clean(input.city) || null,
    buildingNumber,
    additionalNumber: clean(input.additionalNumber) || null,
    postalCode,
    streetAddress: clean(input.streetAddress) || null,
  };
  // Same rule as the form: the legacy single-line address is refreshed from the structured fields
  // when any of them are set, and otherwise left to whatever was supplied directly.
  const composed = composeAddress(structured);
  const address = composed || clean(input.address) || null;

  if (errors.length) return { errors };

  return {
    errors: [],
    fields: {
      name,
      clientType,
      email: email || null,
      phone: phone || null,
      taxId: clean(input.taxId) || null,
      vatNumber: clean(input.vatNumber) || null,
      notes: clean(input.notes) || null,
      ...structured,
      ...(address ? { address } : {}),
    },
  };
}
