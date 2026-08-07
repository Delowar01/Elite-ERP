"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useConfirm } from "../../_shared/confirm-provider";
import { t, type Locale } from "@/lib/i18n/dict";
import { updateQuotationStatusAction } from "./actions";
import { ConvertMenu } from "../_shared/convert-menu";

const STATUSES = ["draft", "sent", "accepted", "rejected", "expired"];

export function QuotationDetailActions({ locale, quotationId, quotationNumber, status }: { locale: Locale; quotationId: number; quotationNumber: string; status: string }) {
  const [pending] = useTransition();
  const confirm = useConfirm();

  function changeStatus(value: string) {
    if (value === status) return;
    confirm({
      action: "document.statusChange",
      entityType: "Quotation",
      entityNumber: quotationNumber,
      details: [{ label: "Status", value: t(locale, value) }],
      onConfirm: async () => {
        const result = await updateQuotationStatusAction(quotationId, value);
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
      <ConvertMenu locale={locale} source="quotation" id={quotationId} number={quotationNumber} typeLabel="Quotation" ctx={{ status }} disabled={pending} />
    </div>
  );
}
