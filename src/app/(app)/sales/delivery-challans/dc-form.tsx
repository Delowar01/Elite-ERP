"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Truck } from "lucide-react";
import { PartyCardStatic, PartyCardSelect } from "../_shared/party-card";
import { DocFieldBox } from "../_shared/doc-field-box";
import { LineItemsEditor, emptyLineItem, type LineItemDraft } from "../_shared/line-items-editor";
import { DocFooterContact } from "../_shared/doc-footer-contact";
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
  const [customerId, setCustomerId] = useState("");
  const [dispatchDate, setDispatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [carrier, setCarrier] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [items, setItems] = useState<LineItemDraft[]>([emptyLineItem()]);
  const [pendingDraft, startDraftTransition] = useTransition();
  const [pendingPrimary, startPrimaryTransition] = useTransition();

  function submit(andDispatch: boolean) {
    const start = andDispatch ? startPrimaryTransition : startDraftTransition;
    start(async () => {
      const result = await createDeliveryChallanAction({ title: "", customerId, dispatchDate, carrier, vehicleNo, items }, andDispatch);
      if (result?.error) toast.error(result.error);
    });
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="doc-titlebar">
        <div>
          <h3>
            <Truck className="size-5" style={{ color: "var(--brand-orange)" }} /> {t(locale, "Create Delivery Challan")}
          </h3>
          <div className="sub">{t(locale, "Dispatch stock to a client — logistics only, no pricing or ledger impact.")}</div>
        </div>
        <div className="doc-titlebar-actions">
          <button type="button" className="btn btn-glass" disabled>
            {t(locale, "Save as Draft")}
          </button>
        </div>
      </div>

      <div className="doc-header-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <DocFieldBox label={t(locale, "DC Number")} required gear>
          {numberPreview}
        </DocFieldBox>
        <DocFieldBox label={t(locale, "Dispatch Date")} required>
          <input type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} className="w-full bg-transparent outline-none" />
        </DocFieldBox>
      </div>
      <div className="doc-header-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <DocFieldBox label={t(locale, "Carrier")} plain>
          <input value={carrier} onChange={(e) => setCarrier(e.target.value)} className="w-full bg-transparent outline-none" />
        </DocFieldBox>
        <DocFieldBox label={t(locale, "Vehicle No.")} plain>
          <input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} className="w-full bg-transparent outline-none" />
        </DocFieldBox>
      </div>

      <div className="doc-meta-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <PartyCardStatic label={t(locale, "From")} name={org.name} address={org.address} email={org.email} phone={org.phone} />
        <PartyCardSelect locale={locale} label={t(locale, "To Client")} customers={customers} value={customerId} onChange={setCustomerId} />
      </div>

      <LineItemsEditor locale={locale} products={products} items={items} onChange={setItems} variant="qty" />

      <DocFooterContact locale={locale} email={org.email} phone={org.phone} />

      <DocActionBar
        locale={locale}
        pendingDraft={pendingDraft}
        pendingPrimary={pendingPrimary}
        onSaveDraft={() => submit(false)}
        onPrimary={() => submit(true)}
        primaryLabel="Create & Dispatch"
      />
    </div>
  );
}
