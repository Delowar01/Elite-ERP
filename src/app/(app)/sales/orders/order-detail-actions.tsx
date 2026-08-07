"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useConfirm } from "../../_shared/confirm-provider";
import { t, type Locale } from "@/lib/i18n/dict";
import { updateSalesOrderStatusAction, cancelSalesOrderAction } from "./actions";
import { ConvertMenu } from "../_shared/convert-menu";

const STATUSES = ["draft", "confirmed", "fulfilled", "cancelled"];

export function OrderDetailActions({ locale, orderId, orderNumber, status }: { locale: Locale; orderId: number; orderNumber: string; status: string }) {
  const [pending] = useTransition();
  const confirm = useConfirm();

  function changeStatus(value: string) {
    if (value === status) return;
    const cancelling = value === "cancelled";
    confirm({
      action: cancelling ? "document.cancel" : "document.statusChange",
      entityType: "Sales Order",
      entityNumber: orderNumber,
      details: cancelling ? undefined : [{ label: "Status", value: t(locale, value) }],
      onConfirm: async () => {
        // Cancel is a lifecycle-gated transition (a fulfilled order cannot be cancelled), so route
        // it through the dedicated, audited action rather than the free-form status setter.
        const result = cancelling ? await cancelSalesOrderAction(orderId) : await updateSalesOrderStatusAction(orderId, value);
        if (result?.error) return result;
        toast.success(t(locale, "Saved"));
      },
    });
  }

  return (
    <div className="flex items-center gap-2.5">
      <Select value={status} onValueChange={changeStatus}>
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {t(locale, s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ConvertMenu locale={locale} source="sales_order" id={orderId} number={orderNumber} typeLabel="Sales Order" ctx={{ status }} disabled={pending} />
    </div>
  );
}
