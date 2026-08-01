"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { t, type Locale } from "@/lib/i18n/dict";
import { updateQuotationStatusAction } from "./actions";
import { ConvertMenu } from "../_shared/convert-menu";

const STATUSES = ["draft", "sent", "accepted", "rejected", "expired"];

export function QuotationDetailActions({ locale, quotationId, status }: { locale: Locale; quotationId: number; status: string }) {
  const [pending, startTransition] = useTransition();

  function changeStatus(value: string) {
    startTransition(async () => {
      const result = await updateQuotationStatusAction(quotationId, value);
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
      <ConvertMenu locale={locale} source="quotation" id={quotationId} ctx={{ status }} disabled={pending} />
    </div>
  );
}
