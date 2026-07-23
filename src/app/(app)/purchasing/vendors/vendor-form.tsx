"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { RecordImageUpload } from "@/components/upload/record-image-upload";
import { CROP_PARTY_LOGO } from "@/components/upload/crop-configs";
import type { Vendor } from "@/db";
import { type ActionState, uploadVendorLogoAction } from "./actions";

export function VendorForm({
  vendor,
  action,
  submitLabel = "Save",
}: {
  vendor?: Vendor;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-5 max-w-xl">
      {vendor && (
        <FormField label="Logo" htmlFor="logo">
          <RecordImageUpload locale="en" currentUrl={vendor.logoUrl} config={CROP_PARTY_LOGO} fieldName="logo" label="Upload Logo" action={uploadVendorLogoAction.bind(null, vendor.id)} />
        </FormField>
      )}
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Name" htmlFor="name" span={2}>
          <Input id="name" name="name" required defaultValue={vendor?.name} placeholder="Northbound Steel Ltd" />
        </FormField>
        <FormField label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" defaultValue={vendor?.email ?? ""} />
        </FormField>
        <FormField label="Phone" htmlFor="phone">
          <Input id="phone" name="phone" defaultValue={vendor?.phone ?? ""} />
        </FormField>
        <FormField label="Address" htmlFor="address" span={2}>
          <Input id="address" name="address" defaultValue={vendor?.address ?? ""} />
        </FormField>
        <FormField label="Tax ID" htmlFor="taxId">
          <Input id="taxId" name="taxId" defaultValue={vendor?.taxId ?? ""} />
        </FormField>
        <FormField label="Notes" htmlFor="notes" span={2}>
          <Input id="notes" name="notes" defaultValue={vendor?.notes ?? ""} />
        </FormField>
      </div>
      {state?.error && <p className="text-[12.5px] text-danger">{state.error}</p>}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
