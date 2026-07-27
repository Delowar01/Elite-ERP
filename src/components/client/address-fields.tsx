"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { COUNTRIES, getStates, hasStateDataset } from "@/lib/geo/countries";
import { getCountryProfile, type AddressFieldConfig, type CountryProfile } from "@/lib/geo/country-profiles";
import { t, type Locale } from "@/lib/i18n/dict";
import { cn } from "@/lib/utils";

export type AddressValue = {
  countryCode: string;
  stateProvince: string;
  district: string;
  city: string;
  buildingNumber: string;
  additionalNumber: string;
  postalCode: string;
  streetAddress: string;
};

export const EMPTY_ADDRESS: AddressValue = {
  countryCode: "", stateProvince: "", district: "", city: "",
  buildingNumber: "", additionalNumber: "", postalCode: "", streetAddress: "",
};

// Module-level so it isn't recreated on every render (react-hooks/static-components).
function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[12.5px] font-medium text-ink-muted mb-1.5">{children}</label>;
}

// Validation for a single address field, driven by its country-profile config (only when a value is
// entered — every field is optional). The 4-digit building rule bites for Saudi addresses (matches
// the server's buildingNumberError); "postal" = alphanumeric code.
function fieldError(field: AddressFieldConfig, value: string, countryCode: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (field.validate === "sa-building") {
    if (countryCode.toUpperCase() !== "SA") return null;
    return /^\d{4}$/.test(v) ? null : "Building number must be 4 digits.";
  }
  if (field.validate === "postal") return /^[A-Za-z0-9\s-]{1,12}$/.test(v) ? null : "Enter a valid postal / zip code.";
  return null;
}
const ERR_KEY: Record<string, string> = {
  "sa-building": "Building number must be 4 digits.",
  "postal": "Enter a valid postal / zip code.",
};

// Collapsible "Address (optional)" section. Which fields appear, their labels, order and validation
// all come from the organization's country profile — so one shared component renders a Saudi National
// Address, a UAE address, or a generic international address without any per-country form.
export function AddressFields({
  locale,
  profile,
  value,
  onChange,
  defaultOpen = false,
}: {
  locale: Locale;
  // The org's resolved country profile; defaults to Global when omitted.
  profile?: CountryProfile;
  value: AddressValue;
  onChange: (patch: Partial<AddressValue>) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const prof = profile ?? getCountryProfile(value.countryCode);
  const countryOptions = COUNTRIES.map((c) => ({ value: c.code, label: c.name, sublabel: c.code }));
  const stateOptions = getStates(value.countryCode).map((s) => ({ value: s.name, label: s.name }));
  const stateHasData = hasStateDataset(value.countryCode);

  function renderField(field: AddressFieldConfig) {
    const key = field.key;
    if (field.control === "country") {
      return (
        <SearchableSelect
          id="addr-country"
          options={countryOptions}
          value={value.countryCode}
          // Changing country revalidates/clears the state so a stale state can't persist.
          onChange={(code) => onChange({ countryCode: code, stateProvince: "" })}
          placeholder={t(locale, field.label)}
          searchPlaceholder={t(locale, "Search…")}
          emptyText={t(locale, "No matches.")}
          aria-label={t(locale, field.label)}
        />
      );
    }
    if (field.control === "state") {
      return stateHasData ? (
        <SearchableSelect
          options={stateOptions}
          value={value.stateProvince}
          onChange={(v) => onChange({ stateProvince: v })}
          placeholder={t(locale, field.placeholder ?? field.label)}
          searchPlaceholder={t(locale, "Search…")}
          emptyText={t(locale, "No matches.")}
          aria-label={t(locale, field.label)}
        />
      ) : (
        <Input
          value={value.stateProvince}
          onChange={(e) => onChange({ stateProvince: e.target.value })}
          placeholder={t(locale, field.placeholder ?? field.label)}
        />
      );
    }
    // Plain text field (district / city / building / additional / postal / street).
    const k = key as keyof AddressValue;
    const err = fieldError(field, value[k], value.countryCode);
    return (
      <>
        <Input
          value={value[k] ?? ""}
          onChange={(e) => onChange({ [k]: e.target.value } as Partial<AddressValue>)}
          placeholder={t(locale, field.placeholder ?? field.label)}
          aria-invalid={!!err}
        />
        {err && <p className="text-[11.5px] text-danger mt-1">{t(locale, ERR_KEY[field.validate ?? ""] ?? err)}</p>}
      </>
    );
  }

  return (
    <div className="border border-line rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-canvas"
        aria-expanded={open}
      >
        <span className="text-[14px] font-bold">
          {t(locale, "Address")} <span className="text-ink-faint font-normal">({t(locale, "optional")})</span>
        </span>
        <ChevronDown className={cn("size-4 text-ink-muted transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 pt-0">
          {prof.addressFields.map((field) => (
            <div key={field.key} className={cn(field.fullWidth && "md:col-span-2")}>
              <Label>{t(locale, field.label)}</Label>
              {renderField(field)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Whether the current address has any blocking validation error, per the given profile's field set.
export function addressHasError(value: AddressValue, profile?: CountryProfile): boolean {
  const prof = profile ?? getCountryProfile(value.countryCode);
  return prof.addressFields.some((f) => f.control === "text" && !!fieldError(f, (value[f.key as keyof AddressValue] as string) ?? "", value.countryCode));
}
