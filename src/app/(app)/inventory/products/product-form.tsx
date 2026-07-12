"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sku">SKU</Label>
          <Input id="sku" name="sku" required defaultValue={product?.sku} placeholder="SKU-00482" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="unit">Unit</Label>
          <Input id="unit" name="unit" defaultValue={product?.unit ?? "pcs"} />
        </div>
        <div className="flex flex-col gap-1.5 col-span-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required defaultValue={product?.name} placeholder="Precision Steel Bracket" />
        </div>
        <div className="flex flex-col gap-1.5 col-span-2">
          <Label htmlFor="description">Description</Label>
          <Input id="description" name="description" defaultValue={product?.description ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="unitPrice">Unit price (SAR)</Label>
          <Input id="unitPrice" name="unitPrice" type="number" step="0.01" min="0" defaultValue={product?.unitPrice ?? "0"} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="costPrice">Cost price (SAR)</Label>
          <Input id="costPrice" name="costPrice" type="number" step="0.01" min="0" defaultValue={product?.costPrice ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="taxRatePercent">Tax rate %</Label>
          <Input
            id="taxRatePercent"
            name="taxRatePercent"
            type="number"
            step="0.01"
            min="0"
            defaultValue={product?.taxRatePercent ?? "15"}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reorderLevel">Reorder level</Label>
          <Input id="reorderLevel" name="reorderLevel" type="number" min="0" defaultValue={product?.reorderLevel ?? 0} />
        </div>
        {!product && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quantityOnHand">Opening quantity</Label>
            <Input id="quantityOnHand" name="quantityOnHand" type="number" min="0" defaultValue={0} />
          </div>
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
