"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { t, type Locale } from "@/lib/i18n/dict";
import { updateSalesOrderStatusAction, cancelSalesOrderAction } from "./actions";
import { ConvertMenu } from "../_shared/convert-menu";

const STATUSES = ["draft", "confirmed", "fulfilled", "cancelled"];

export function OrderDetailActions({ locale, orderId, status }: { locale: Locale; orderId: number; status: string }) {
  const [pending, startTransition] = useTransition();

  function changeStatus(value: string) {
    startTransition(async () => {
      // Cancel is a lifecycle-gated transition (a fulfilled order cannot be cancelled), so route
      // it through the dedicated, audited action rather than the free-form status setter.
      const result = value === "cancelled" ? await cancelSalesOrderAction(orderId) : await updateSalesOrderStatusAction(orderId, value);
      if (result?.error) toast.error(result.error);
      else toast.success(t(locale, "Saved"));
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
      <ConvertMenu locale={locale} source="sales_order" id={orderId} ctx={{ status }} disabled={pending} />
    </div>
  );
}
