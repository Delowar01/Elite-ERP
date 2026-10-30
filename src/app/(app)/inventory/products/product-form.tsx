"use client";

import { useActionState, useState } from "react";
import { useDirtyFormFields } from "../../_shared/dirty-form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormField, fieldIds } from "@/components/ui/form-field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Product } from "@/db";
import type { ActionState } from "./actions";

export function ProductForm({
  product,
  action,
  submitLabel = "Save",
  locale = "en",
}: {
  product?: Product;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel?: string;
  locale?: Locale;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [itemType, setItemType] = useState<string>(product?.itemType ?? "stock");
  // Unsaved-changes protection, shared with every other form in the app.
  const { ref: dirtyRef, form: dirtyForm } = useDirtyFormFields();

  return (
    <form ref={dirtyRef} action={formAction} onSubmit={() => dirtyForm.markClean()} className="flex flex-col gap-5 max-w-xl">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="SKU" htmlFor="sku">
          <Input id="sku" name="sku" required defaultValue={product?.sku} placeholder="SKU-00482" />
        </FormField>
        <FormField label="Unit" htmlFor="unit">
          <Input id="unit" name="unit" defaultValue={product?.unit ?? "pcs"} />
        </FormField>
        <FormField label="Name" htmlFor="name" span={2}>
          <Input id="name" name="name" required defaultValue={product?.name} placeholder="Precision Steel Bracket" />
        </FormField>
        <FormField label="Description" htmlFor="description" span={2}>
          <Input id="description" name="description" defaultValue={product?.description ?? ""} />
        </FormField>
        <FormField label="Unit price (SAR)" htmlFor="unitPrice">
          <Input id="unitPrice" name="unitPrice" type="number" step="0.01" min="0" defaultValue={product?.unitPrice ?? "0"} />
        </FormField>
        <FormField label="Cost price (SAR)" htmlFor="costPrice">
          <Input id="costPrice" name="costPrice" type="number" step="0.01" min="0" defaultValue={product?.costPrice ?? ""} />
        </FormField>
        <FormField label="Tax rate %" htmlFor="taxRatePercent">
          <Input
            id="taxRatePercent"
            name="taxRatePercent"
            type="number"
            step="0.01"
            min="0"
            defaultValue={product?.taxRatePercent ?? "15"}
          />
        </FormField>
        <FormField label="Reorder level" htmlFor="reorderLevel">
          <Input id="reorderLevel" name="reorderLevel" type="number" min="0" defaultValue={product?.reorderLevel ?? 0} />
        </FormField>
        {/* ACC-01: stock items are counted and valued; services never are. Two choices, both in view, on the shared
            native RadioGroup (as Client Type); the radios submit `itemType` themselves. */}
        <div className="flex flex-col gap-1.5 col-span-2">
          <span id="itemType-label" className="text-body-sm font-medium text-ink-muted">{t(locale, "Item type")}</span>
          <p id={fieldIds("itemType").description} className="text-caption text-ink-faint">
            {t(locale, "Stock items are counted and valued at weighted-average cost; services carry no stock.")}
          </p>
          <RadioGroup name="itemType" value={itemType} onValueChange={setItemType}
            aria-labelledby="itemType-label" aria-describedby={fieldIds("itemType").description}>
            <RadioGroupItem value="stock">{t(locale, "Stock item")}</RadioGroupItem>
            <RadioGroupItem value="service">{t(locale, "Service")}</RadioGroupItem>
          </RadioGroup>
        </div>
        {!product && (
          <FormField label="Opening quantity" htmlFor="quantityOnHand">
            <Input id="quantityOnHand" name="quantityOnHand" type="number" min="0" defaultValue={0} />
          </FormField>
        )}
        {!product && (
          <FormField label={t(locale, "Opening unit cost")} htmlFor="openingUnitCost"
            description={t(locale, "In the base currency. Required when the opening quantity is above zero.")}>
            {(field) => (
              <Input id={field.id} aria-describedby={field.describedBy} name="openingUnitCost" type="number" step="any" min="0" />
            )}
          </FormField>
        )}
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
