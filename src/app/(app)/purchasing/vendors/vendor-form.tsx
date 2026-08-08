"use client";

import { useActionState, useEffect } from "react";
import { useDirtyFormFields } from "../../_shared/dirty-form";
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
  taxNumberLabel = "VAT Number",
  registrationLabel = "CR Number",
  inDialog = false,
  onSuccess,
  onCancel,
  onDirty,
}: {
  vendor?: Vendor;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel?: string;
  // Tax/registration labels follow the org's country profile (VAT Number/CR, TRN/Trade License, …).
  taxNumberLabel?: string;
  registrationLabel?: string;
  // Dialog mode: the dialog controls width and adds a Cancel button; onSuccess fires with the
  // created vendor so the caller can auto-select it. Mirrors ClientForm's dialog mode exactly.
  inDialog?: boolean;
  onSuccess?: (vendor: Vendor) => void;
  onCancel?: () => void;
  onDirty?: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  // Unsaved-changes protection, shared with every other form in the app.
  const { ref: dirtyRef, form: dirtyForm } = useDirtyFormFields();

  // Only the inline action returns a vendor; the full-page action redirects and never reaches here.
  useEffect(() => {
    if (state?.vendor) onSuccess?.(state.vendor);
  }, [state, onSuccess]);

  return (
    <form ref={dirtyRef} action={formAction} onInput={onDirty} onSubmit={() => dirtyForm.markClean()} className={inDialog ? "flex flex-col gap-5" : "flex flex-col gap-5 max-w-xl"}>
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
        <FormField label={taxNumberLabel} htmlFor="vatNumber">
          <Input id="vatNumber" name="vatNumber" defaultValue={vendor?.vatNumber ?? ""} className="font-mono" />
        </FormField>
        <FormField label={registrationLabel} htmlFor="taxId">
          <Input id="taxId" name="taxId" defaultValue={vendor?.taxId ?? ""} className="font-mono" />
        </FormField>
        <FormField label="Notes" htmlFor="notes" span={2}>
          <Input id="notes" name="notes" defaultValue={vendor?.notes ?? ""} />
        </FormField>
      </div>
      {state?.error && <p className="text-[12.5px] text-danger">{state.error}</p>}
      <div className={inDialog ? "flex items-center justify-end gap-2" : ""}>
        {inDialog && onCancel && (
          <button type="button" className="btn btn-glass" style={{ width: "auto", padding: "0 18px" }} disabled={pending} onClick={onCancel}>
            Cancel
          </button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
