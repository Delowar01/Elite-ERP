"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  COUNTRIES,
  getStates,
  hasStateDataset,
  buildingNumberError,
  postalCodeError,
} from "@/lib/geo/countries";
import { t, type Locale } from "@/lib/i18n/dict";
import { cn } from "@/lib/utils";

export type AddressValue = {
  countryCode: string;
  stateProvince: string;
  district: string;
  city: string;
  buildingNumber: string;
  postalCode: string;
  streetAddress: string;
};

export const EMPTY_ADDRESS: AddressValue = {
  countryCode: "", stateProvince: "", district: "", city: "", buildingNumber: "", postalCode: "", streetAddress: "",
};

// Module-level so it isn't recreated on every render (react-hooks/static-components).
function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[12.5px] font-medium text-ink-muted mb-1.5">{children}</label>;
}

// Collapsible "Address (optional)" section shared by the client create/edit form and the in-document
// edit popup. Country + State are searchable; State falls back to free text when no dataset exists;
// building number is validated as 4 digits for Saudi Arabia only; postal code allows alphanumerics.
export function AddressFields({
  locale,
  value,
  onChange,
  defaultOpen = false,
}: {
  locale: Locale;
  value: AddressValue;
  onChange: (patch: Partial<AddressValue>) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const countryOptions = COUNTRIES.map((c) => ({ value: c.code, label: c.name, sublabel: c.code }));
  const stateHasData = hasStateDataset(value.countryCode);
  const stateOptions = getStates(value.countryCode).map((s) => ({ value: s.name, label: s.name }));
  const buildingErr = buildingNumberError(value.countryCode, value.buildingNumber);
  const postalErr = postalCodeError(value.postalCode);

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
          <div>
            <Label>{t(locale, "Select Country")}</Label>
            <SearchableSelect
              id="addr-country"
              options={countryOptions}
              value={value.countryCode}
              // Changing country revalidates/clears the state so a stale state can't persist.
              onChange={(code) => onChange({ countryCode: code, stateProvince: "" })}
              placeholder={t(locale, "Select Country")}
              searchPlaceholder={t(locale, "Search…")}
              emptyText={t(locale, "No matches.")}
              aria-label={t(locale, "Select Country")}
            />
          </div>

          <div>
            <Label>{t(locale, "State / Province")}</Label>
            {stateHasData ? (
              <SearchableSelect
                options={stateOptions}
                value={value.stateProvince}
                onChange={(v) => onChange({ stateProvince: v })}
                placeholder={t(locale, "Select State / Province")}
                searchPlaceholder={t(locale, "Search…")}
                emptyText={t(locale, "No matches.")}
                aria-label={t(locale, "State / Province")}
              />
            ) : (
              <Input
                value={value.stateProvince}
                onChange={(e) => onChange({ stateProvince: e.target.value })}
                placeholder={t(locale, "Select State / Province")}
              />
            )}
          </div>

          <div>
            <Label>{t(locale, "District")}</Label>
            <Input value={value.district} onChange={(e) => onChange({ district: e.target.value })} placeholder={t(locale, "District Name")} />
          </div>

          <div>
            <Label>{t(locale, "City/Town")}</Label>
            <Input value={value.city} onChange={(e) => onChange({ city: e.target.value })} placeholder={t(locale, "City/Town Name")} />
          </div>

          <div>
            <Label>{t(locale, "Building Number")}</Label>
            <Input
              value={value.buildingNumber}
              onChange={(e) => onChange({ buildingNumber: e.target.value })}
              placeholder={t(locale, "4 Digit Building Number")}
              aria-invalid={!!buildingErr}
            />
            {buildingErr && <p className="text-[11.5px] text-danger mt-1">{t(locale, "Building number must be 4 digits.")}</p>}
          </div>

          <div>
            <Label>{t(locale, "Postal Code / Zip Code")}</Label>
            <Input
              value={value.postalCode}
              onChange={(e) => onChange({ postalCode: e.target.value })}
              placeholder={t(locale, "Postal Code / Zip Code")}
              aria-invalid={!!postalErr}
            />
            {postalErr && <p className="text-[11.5px] text-danger mt-1">{t(locale, "Enter a valid postal / zip code.")}</p>}
          </div>

          <div className="md:col-span-2">
            <Label>{t(locale, "Street Address")}</Label>
            <Input value={value.streetAddress} onChange={(e) => onChange({ streetAddress: e.target.value })} placeholder={t(locale, "Street Address")} />
          </div>
        </div>
      )}
    </div>
  );
}

// Whether the current address has any blocking validation error (shared by callers before submit).
export function addressHasError(value: AddressValue): boolean {
  return !!buildingNumberError(value.countryCode, value.buildingNumber) || !!postalCodeError(value.postalCode);
}
