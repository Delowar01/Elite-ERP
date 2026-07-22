"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { t, type Locale } from "@/lib/i18n/dict";
import { updateSalesOrderStatusAction, cancelSalesOrderAction, convertSoToProformaAction, convertSoToInvoiceAction, convertSoToDeliveryChallanAction } from "./actions";

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

  function convert(action: (id: number) => Promise<{ error?: string }>) {
    startTransition(async () => {
      const result = await action(orderId);
      if (result?.error) toast.error(result.error);
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="glass" style={{ width: "auto" }} disabled={pending}>
            {t(locale, "Convert to…")} <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem className="cursor-pointer" onSelect={() => convert(convertSoToProformaAction)}>
            {t(locale, "Proforma Invoice")}
          </DropdownMenuItem>
          <DropdownMenuItem className="cursor-pointer" onSelect={() => convert(convertSoToInvoiceAction)}>
            {t(locale, "Invoice")}
          </DropdownMenuItem>
          <DropdownMenuItem className="cursor-pointer" onSelect={() => convert(convertSoToDeliveryChallanAction)}>
            {t(locale, "Delivery Challan")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
