"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";
import { deletePaymentAction } from "../payments/actions";

export function DeletePaymentButton({ locale, paymentId }: { locale: Locale; paymentId: number }) {
  const [pending, start] = useTransition();
  function del() {
    if (!window.confirm(t(locale, "Delete this payment? Its ledger posting will be reversed."))) return;
    start(async () => {
      const result = await deletePaymentAction(paymentId);
      if (result.error) toast.error(result.error);
      else toast.success(t(locale, "Payment deleted."));
    });
  }
  return (
    <button type="button" onClick={del} disabled={pending} className="text-ink-faint hover:text-danger disabled:opacity-50" aria-label={t(locale, "Delete")} title={t(locale, "Delete")}>
      <Trash2 className="size-3.5" />
    </button>
  );
}
