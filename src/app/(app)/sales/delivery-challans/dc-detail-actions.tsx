"use client";

import { toast } from "sonner";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { t, type Locale } from "@/lib/i18n/dict";
import { useConfirm } from "../../_shared/confirm-provider";
import { updateDeliveryChallanStatusAction } from "./actions";

const STATUSES = ["draft", "dispatched", "delivered"];

export function DcDetailActions({ locale, dcId, dcNumber, status }: { locale: Locale; dcId: number; dcNumber: string; status: string }) {
  const confirm = useConfirm();

  // Dispatching/delivering advances the logistics workflow — confirmed, but not a ledger posting.
  function changeStatus(value: string) {
    if (value === status) return;
    confirm({
      action: "document.statusChange",
      entityType: "Delivery Challan",
      entityNumber: dcNumber,
      description: "Changing the status moves this delivery challan forward in its workflow.",
      details: [{ label: "Status", value: t(locale, value) }],
      onConfirm: async () => {
        const result = await updateDeliveryChallanStatusAction(dcId, value);
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
    </div>
  );
}
