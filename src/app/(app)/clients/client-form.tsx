"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { RecordImageUpload } from "@/components/upload/record-image-upload";
import { CROP_PARTY_LOGO } from "@/components/upload/crop-configs";
import type { Customer } from "@/db";
import { type ActionState, uploadClientLogoAction } from "./actions";

export function ClientForm({
  client,
  action,
  submitLabel = "Save",
}: {
  client?: Customer;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-5 max-w-xl">
      {client && (
        <FormField label="Logo" htmlFor="logo">
          <RecordImageUpload locale="en" currentUrl={client.logoUrl} config={CROP_PARTY_LOGO} fieldName="logo" label="Upload Logo" action={uploadClientLogoAction.bind(null, client.id)} />
        </FormField>
      )}
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Name" htmlFor="name" span={2}>
          <Input id="name" name="name" required defaultValue={client?.name} placeholder="Kestrel Supply LLC" />
        </FormField>
        <FormField label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" defaultValue={client?.email ?? ""} />
        </FormField>
        <FormField label="Phone" htmlFor="phone">
          <Input id="phone" name="phone" defaultValue={client?.phone ?? ""} />
        </FormField>
        <FormField label="Address" htmlFor="address" span={2}>
          <Input id="address" name="address" defaultValue={client?.address ?? ""} />
        </FormField>
        <FormField label="Tax ID" htmlFor="taxId">
          <Input id="taxId" name="taxId" defaultValue={client?.taxId ?? ""} />
        </FormField>
        <FormField label="VAT number" htmlFor="vatNumber">
          <Input id="vatNumber" name="vatNumber" defaultValue={client?.vatNumber ?? ""} placeholder="3000..." />
        </FormField>
        <FormField label="Notes" htmlFor="notes" span={2}>
          <Input id="notes" name="notes" defaultValue={client?.notes ?? ""} />
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
