"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import type { Product } from "@/db";
import type { ActionState } from "./actions";

export function ProductForm({
  product,
  action,
  submitLabel = "Save",
}: {
  product?: Product;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-5 max-w-xl">
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
        {!product && (
          <FormField label="Opening quantity" htmlFor="quantityOnHand">
            <Input id="quantityOnHand" name="quantityOnHand" type="number" min="0" defaultValue={0} />
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
