"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { RecordImageUpload } from "@/components/upload/record-image-upload";
import { CROP_PARTY_LOGO } from "@/components/upload/crop-configs";
import { ClientTypeSelect, type ClientType } from "@/components/client/client-type-select";
import { AddressFields, addressHasError, type AddressValue } from "@/components/client/address-fields";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Customer } from "@/db";
import { type ActionState, uploadClientLogoAction } from "./actions";

export function ClientForm({
  locale = "en",
  client,
  action,
  submitLabel = "Save",
  defaultCountryCode = "",
}: {
  locale?: Locale;
  client?: Customer;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel?: string;
  defaultCountryCode?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [clientType, setClientType] = useState<ClientType>((client?.clientType as ClientType) ?? "individual");
  const [address, setAddress] = useState<AddressValue>({
    countryCode: client?.countryCode ?? (client ? "" : defaultCountryCode),
    stateProvince: client?.stateProvince ?? "",
    district: client?.district ?? "",
    city: client?.city ?? "",
    buildingNumber: client?.buildingNumber ?? "",
    postalCode: client?.postalCode ?? "",
    streetAddress: client?.streetAddress ?? "",
  });
  const hasAddress = Object.values(address).some((v) => v.trim());
  const invalidAddress = addressHasError(address);
  const nameLabel = clientType === "company" ? "Business Name" : "Name";

  return (
    <form action={formAction} className="flex flex-col gap-5 max-w-2xl">
      {/* Hidden inputs carry the controlled Client Type + structured address into the form submit. */}
      <input type="hidden" name="clientType" value={clientType} />
      <input type="hidden" name="countryCode" value={address.countryCode} />
      <input type="hidden" name="stateProvince" value={address.stateProvince} />
      <input type="hidden" name="district" value={address.district} />
      <input type="hidden" name="city" value={address.city} />
      <input type="hidden" name="buildingNumber" value={address.buildingNumber} />
      <input type="hidden" name="postalCode" value={address.postalCode} />
      <input type="hidden" name="streetAddress" value={address.streetAddress} />

      <ClientTypeSelect locale={locale} value={clientType} onChange={setClientType} />

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
        <FormField label={t(locale, "VAT Number")} htmlFor="vatNumber">
          <Input id="vatNumber" name="vatNumber" defaultValue={client?.vatNumber ?? ""} placeholder="3000..." className="font-mono" />
        </FormField>
        <FormField label={t(locale, "CR Number")} htmlFor="taxId">
          <Input id="taxId" name="taxId" defaultValue={client?.taxId ?? ""} className="font-mono" />
        </FormField>
        <FormField label={t(locale, "Notes")} htmlFor="notes" span={2}>
          <Input id="notes" name="notes" defaultValue={client?.notes ?? ""} />
        </FormField>
      </div>

      <AddressFields locale={locale} value={address} onChange={(patch) => setAddress((a) => ({ ...a, ...patch }))} defaultOpen={hasAddress} />

      {state?.error && <p className="text-[12.5px] text-danger">{state.error}</p>}
      <div>
        <Button type="submit" disabled={pending || invalidAddress}>
          {pending ? t(locale, "Saving…") : t(locale, submitLabel)}
        </Button>
      </div>
    </form>
  );
}
