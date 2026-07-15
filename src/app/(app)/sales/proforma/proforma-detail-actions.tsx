"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { t, type Locale } from "@/lib/i18n/dict";
import { updateProformaStatusAction, convertProformaToInvoiceAction } from "./actions";

const STATUSES = ["draft", "sent"];

export function ProformaDetailActions({ locale, proformaId, status }: { locale: Locale; proformaId: number; status: string }) {
  const [pending, startTransition] = useTransition();

  function changeStatus(value: string) {
    startTransition(async () => {
      const result = await updateProformaStatusAction(proformaId, value);
      if (result?.error) toast.error(result.error);
      else toast.success(t(locale, "Saved"));
    });
  }

  function convertToInvoice() {
    startTransition(async () => {
      const result = await convertProformaToInvoiceAction(proformaId);
      if (result?.error) toast.error(result.error);
    });
  }

  return (
    <div className="flex items-center gap-2.5">
      <Select value={status} onValueChange={changeStatus}>
        <SelectTrigger className="w-32">
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
      <Button variant="glass" style={{ width: "auto" }} disabled={pending} onClick={convertToInvoice}>
        {t(locale, "Convert to Invoice")}
      </Button>
    </div>
  );
}
