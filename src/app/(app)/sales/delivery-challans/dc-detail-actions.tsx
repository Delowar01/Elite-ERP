"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { t, type Locale } from "@/lib/i18n/dict";
import { can } from "@/lib/document-lifecycle";
import { updateDeliveryChallanStatusAction } from "./actions";

const STATUSES = ["draft", "dispatched", "delivered"];

export function DcDetailActions({ locale, dcId, status }: { locale: Locale; dcId: number; status: string }) {
  const [, startTransition] = useTransition();

  function changeStatus(value: string) {
    startTransition(async () => {
      const result = await updateDeliveryChallanStatusAction(dcId, value);
      if (result?.error) toast.error(result.error);
      else toast.success(t(locale, "Saved"));
    });
  }

  return (
    <div className="flex items-center gap-2.5">
      {can("delivery_challan", status, "edit") && (
        <Button variant="glass" style={{ width: "auto" }} asChild>
          <Link href={`/sales/delivery-challans/${dcId}/edit`}>{t(locale, "Edit")}</Link>
        </Button>
      )}
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
    </div>
  );
}
