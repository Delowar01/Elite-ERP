"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { Customer } from "@/db";
import type { ActionState } from "./actions";

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
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5 col-span-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required defaultValue={client?.name} placeholder="Kestrel Supply LLC" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" defaultValue={client?.email ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" defaultValue={client?.phone ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5 col-span-2">
          <Label htmlFor="address">Address</Label>
          <Input id="address" name="address" defaultValue={client?.address ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="taxId">Tax ID</Label>
          <Input id="taxId" name="taxId" defaultValue={client?.taxId ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vatNumber">VAT number</Label>
          <Input id="vatNumber" name="vatNumber" defaultValue={client?.vatNumber ?? ""} placeholder="3000..." />
        </div>
        <div className="flex flex-col gap-1.5 col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Input id="notes" name="notes" defaultValue={client?.notes ?? ""} />
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
