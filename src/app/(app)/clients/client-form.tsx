"use client";

import { useActionState, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { RecordImageUpload } from "@/components/upload/record-image-upload";
import { CROP_PARTY_LOGO } from "@/components/upload/crop-configs";
import { ClientTypeSelect, type ClientType } from "@/components/client/client-type-select";
import { AddressFields, addressHasError, type AddressValue } from "@/components/client/address-fields";
import { getCountryProfile, resolveTaxLabels, type CountryProfile } from "@/lib/geo/country-profiles";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Customer } from "@/db";
import { type ActionState, uploadClientLogoAction } from "./actions";

export function ClientForm({
  locale = "en",
  client,
  action,
  submitLabel = "Save",
  defaultCountryCode = "",
  profile,
  taxLabels,
  inDialog = false,
  onSuccess,
  onCancel,
  onDirty,
}: {
  locale?: Locale;
  client?: Customer;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel?: string;
  defaultCountryCode?: string;
  // The org's country profile drives address layout + tax/registration labels.
  profile?: CountryProfile;
  taxLabels?: { taxNumberLabel: string; registrationLabel: string; registrationPlaceholder?: string };
  // Dialog mode: dialog controls width + adds a Cancel button; onSuccess fires with the created
  // client (from the inline action) so the caller can auto-select it without a reload.
  inDialog?: boolean;
  onSuccess?: (client: Customer) => void;
  onCancel?: () => void;
  onDirty?: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [clientType, setClientType] = useState<ClientType>((client?.clientType as ClientType) ?? "individual");
  // Auto-select flow: the inline create action returns the created client on success.
  useEffect(() => {
    if (state?.client) onSuccess?.(state.client);
  }, [state, onSuccess]);
  const prof = profile ?? getCountryProfile(defaultCountryCode);
  const labels = taxLabels ?? resolveTaxLabels(prof);
  const [address, setAddress] = useState<AddressValue>({
    countryCode: client?.countryCode ?? (client ? "" : defaultCountryCode),
    stateProvince: client?.stateProvince ?? "",
    district: client?.district ?? "",
    city: client?.city ?? "",
    buildingNumber: client?.buildingNumber ?? "",
    additionalNumber: client?.additionalNumber ?? "",
    postalCode: client?.postalCode ?? "",
    streetAddress: client?.streetAddress ?? "",
  });
  const hasAddress = Object.values(address).some((v) => v.trim());
  const invalidAddress = addressHasError(address, prof);
  const nameLabel = clientType === "company" ? "Business Name" : "Name";

  return (
    <form action={formAction} onInput={onDirty} className={inDialog ? "flex flex-col gap-5" : "flex flex-col gap-5 max-w-2xl"}>
      {/* Hidden inputs carry the controlled Client Type + structured address into the form submit. */}
      <input type="hidden" name="clientType" value={clientType} />
      <input type="hidden" name="countryCode" value={address.countryCode} />
      <input type="hidden" name="stateProvince" value={address.stateProvince} />
      <input type="hidden" name="district" value={address.district} />
      <input type="hidden" name="city" value={address.city} />
      <input type="hidden" name="buildingNumber" value={address.buildingNumber} />
      <input type="hidden" name="additionalNumber" value={address.additionalNumber} />
      <input type="hidden" name="postalCode" value={address.postalCode} />
      <input type="hidden" name="streetAddress" value={address.streetAddress} />

      <ClientTypeSelect locale={locale} value={clientType} onChange={(v) => { setClientType(v); onDirty?.(); }} />

      {client && (
        <FormField label={t(locale, "Logo")} htmlFor="logo">
          <RecordImageUpload locale={locale} currentUrl={client.logoUrl} config={CROP_PARTY_LOGO} fieldName="logo" label="Upload Logo" action={uploadClientLogoAction.bind(null, client.id)} />
        </FormField>
      )}
      <div className="grid grid-cols-2 gap-4">
        <FormField label={t(locale, nameLabel)} htmlFor="name" span={2}>
          <Input id="name" name="name" required defaultValue={client?.name} placeholder={clientType === "company" ? "Kestrel Supply LLC" : "Layla Khan"} />
        </FormField>
        <FormField label={t(locale, "Email")} htmlFor="email">
          <Input id="email" name="email" type="email" defaultValue={client?.email ?? ""} />
        </FormField>
        <FormField label={t(locale, "Phone")} htmlFor="phone">
          <Input id="phone" name="phone" defaultValue={client?.phone ?? ""} />
        </FormField>
        <FormField label={t(locale, labels.taxNumberLabel)} htmlFor="vatNumber">
          <Input id="vatNumber" name="vatNumber" defaultValue={client?.vatNumber ?? ""} placeholder="3000..." className="font-mono" />
        </FormField>
        <FormField label={t(locale, labels.registrationLabel)} htmlFor="taxId">
          <Input id="taxId" name="taxId" defaultValue={client?.taxId ?? ""} placeholder={labels.registrationPlaceholder} className="font-mono" />
        </FormField>
        <FormField label={t(locale, "Notes")} htmlFor="notes" span={2}>
          <Input id="notes" name="notes" defaultValue={client?.notes ?? ""} />
        </FormField>
      </div>

      <AddressFields locale={locale} profile={prof} value={address} onChange={(patch) => { setAddress((a) => ({ ...a, ...patch })); onDirty?.(); }} defaultOpen={hasAddress} />

      {state?.error && <p className="text-[12.5px] text-danger">{state.error}</p>}
      <div className={inDialog ? "flex items-center justify-end gap-2" : ""}>
        {inDialog && onCancel && (
          <button type="button" className="btn btn-glass" style={{ width: "auto", padding: "0 18px" }} disabled={pending} onClick={onCancel}>
            {t(locale, "Cancel")}
          </button>
        )}
        <Button type="submit" disabled={pending || invalidAddress}>
          {pending ? t(locale, "Saving…") : t(locale, submitLabel)}
        </Button>
      </div>
    </form>
  );
}
