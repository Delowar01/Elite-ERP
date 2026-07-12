"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { Vendor } from "@/db";
import type { ActionState } from "./actions";

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
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5 col-span-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required defaultValue={vendor?.name} placeholder="Northbound Steel Ltd" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" defaultValue={vendor?.email ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" defaultValue={vendor?.phone ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5 col-span-2">
          <Label htmlFor="address">Address</Label>
          <Input id="address" name="address" defaultValue={vendor?.address ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="taxId">Tax ID</Label>
          <Input id="taxId" name="taxId" defaultValue={vendor?.taxId ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5 col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Input id="notes" name="notes" defaultValue={vendor?.notes ?? ""} />
        </div>
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
