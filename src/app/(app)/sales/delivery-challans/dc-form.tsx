"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { LineItemsEditor, emptyLineItem, type LineItemDraft } from "../_shared/line-items-editor";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Customer, Product } from "@/db";
import { createDeliveryChallanAction } from "./actions";

export function DcForm({ locale, customers, products }: { locale: Locale; customers: Customer[]; products: Product[] }) {
  const [customerId, setCustomerId] = useState("");
  const [carrier, setCarrier] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [items, setItems] = useState<LineItemDraft[]>([emptyLineItem()]);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await createDeliveryChallanAction({ customerId, carrier, vehicleNo, items });
      if (result?.error) toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <div className="grid grid-cols-3 gap-4">
        <FormField label={t(locale, "Client")} htmlFor="dc-customer">
          <Select value={customerId} onValueChange={setCustomerId}>
            <SelectTrigger id="dc-customer">
              <SelectValue placeholder={t(locale, "Select a client")} />
            </SelectTrigger>
            <SelectContent>
              {customers.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label={t(locale, "Carrier")} htmlFor="dc-carrier">
          <Input id="dc-carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
        </FormField>
        <FormField label={t(locale, "Vehicle No.")} htmlFor="dc-vehicle">
          <Input id="dc-vehicle" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />
        </FormField>
      </div>

      <LineItemsEditor locale={locale} products={products} items={items} onChange={setItems} pricing={false} />

      <div>
        <Button style={{ width: "auto" }} disabled={pending} onClick={submit}>
          {pending ? t(locale, "Saving…") : t(locale, "Save Delivery Challan")}
        </Button>
      </div>
    </div>
  );
}
