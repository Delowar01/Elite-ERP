"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";
import { deletePaymentAction } from "../payments/actions";
import { useConfirm } from "../../_shared/confirm-provider";

export function DeletePaymentButton({
  locale,
  paymentId,
  reference,
  amount,
  party,
}: {
  locale: Locale;
  paymentId: number;
  /** The payment's own reference (never a database id) — shown in the confirmation. */
  reference?: string;
  amount?: string;
  party?: string;
}) {
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  function del() {
    confirm({
      action: "payment.delete",
      entityType: "Payment",
      entityNumber: reference ?? "",
      details: [
        ...(amount ? [{ label: "Amount", value: amount }] : []),
        ...(party ? [{ label: "Party", value: party }] : []),
      ],
      onConfirm: () =>
        new Promise<{ error?: string } | void>((resolve) => {
          start(async () => {
            const result = await deletePaymentAction(paymentId);
            if (result.error) {
              resolve({ error: result.error });
              return;
            }
            toast.success(t(locale, "Payment deleted."));
            resolve();
          });
        }),
    });
  }
  return (
    <button type="button" onClick={del} disabled={pending} className="text-ink-faint hover:text-danger disabled:opacity-50" aria-label={t(locale, "Delete")} title={t(locale, "Delete")}>
      <Trash2 className="size-3.5" />
    </button>
  );
}
