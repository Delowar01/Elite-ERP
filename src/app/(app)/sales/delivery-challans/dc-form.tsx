"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Truck } from "lucide-react";
import { PartyCardStatic, PartyCardSelect } from "../_shared/party-card";
import { DocFieldBox } from "../_shared/doc-field-box";
import { LineItemsEditor, emptyLineItem, type LineItemDraft } from "../_shared/line-items-editor";
import { DocActionBar } from "../_shared/doc-action-bar";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Customer, Product, Org } from "@/db";
import { createDeliveryChallanAction } from "./actions";

export function DcForm({
  locale,
  customers,
  products,
  org,
  numberPreview,
}: {
  locale: Locale;
  customers: Customer[];
  products: Product[];
  org: Org;
  numberPreview: string;
}) {
  const [title, setTitle] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [dispatchDate, setDispatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [carrier, setCarrier] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [items, setItems] = useState<LineItemDraft[]>([emptyLineItem()]);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await createDeliveryChallanAction({ title, customerId, dispatchDate, carrier, vehicleNo, items });
      if (result?.error) toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-5 max-w-4xl">
      <div className="flex items-center gap-2.5">
        <Truck className="size-5 text-brand-orange" />
        <div>
          <h3 className="text-[19px] font-bold">{t(locale, "Create Delivery Challan")}</h3>
          <div className="text-[12px] text-ink-muted">{t(locale, "Dispatch stock to a client — logistics only, no pricing or ledger impact.")}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        <DocFieldBox label={t(locale, "DC Number")} required gear>
          {numberPreview}
        </DocFieldBox>
        <DocFieldBox label={t(locale, "Dispatch Date")} required mono={false}>
          <input type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} className="w-full bg-transparent outline-none" />
        </DocFieldBox>
      </div>
      <div className="grid grid-cols-2 gap-3.5">
        <div>
          <label className="block text-[11.5px] font-semibold text-ink-muted mb-1.5">{t(locale, "Carrier")}</label>
          <input
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            className="w-full h-[38px] rounded-[9px] border border-line-strong bg-surface px-3 text-[12.5px] text-ink outline-none focus:border-brand-orange"
          />
        </div>
        <div>
          <label className="block text-[11.5px] font-semibold text-ink-muted mb-1.5">{t(locale, "Vehicle No.")}</label>
          <input
            value={vehicleNo}
            onChange={(e) => setVehicleNo(e.target.value)}
            className="w-full h-[38px] rounded-[9px] border border-line-strong bg-surface px-3 text-[12.5px] text-ink outline-none focus:border-brand-orange"
          />
        </div>
      </div>
      <div>
        <label className="block text-[11.5px] font-semibold text-ink-muted mb-1.5">{t(locale, "Delivery Challan Title")}</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full h-[38px] rounded-[9px] border border-line-strong bg-surface px-3 text-[12.5px] text-ink outline-none focus:border-brand-orange"
        />
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        <PartyCardStatic label={t(locale, "From")} name={org.name} address={org.address} email={org.email} phone={org.phone} />
        <PartyCardSelect locale={locale} label={t(locale, "To Client")} customers={customers} value={customerId} onChange={setCustomerId} />
      </div>

      <LineItemsEditor locale={locale} products={products} items={items} onChange={setItems} pricing={false} />

      <DocActionBar locale={locale} pending={pending} onSubmit={submit} primaryLabel="Save as Draft" />
    </div>
  );
}
