"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";
import { refundAdvanceAction } from "../payments/actions";
import { useConfirm } from "../../_shared/confirm-provider";

// Refund an unused customer advance (§11): Dr 2300 Customer Advances / Cr Bank at the advance's
// carried value — never AR, never revenue. Rendered only on refundable rows (an unapplied,
// unrefunded advance receipt, owner/admin); the server re-checks every one of those conditions
// regardless, so this button is convenience, not authorization.
export function RefundAdvanceButton({
  locale,
  paymentId,
  reference,
  amount,
}: {
  locale: Locale;
  paymentId: number;
  /** The payment's own reference (never a database id) — shown in the confirmation. */
  reference?: string;
  amount?: string;
}) {
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  function refund() {
    confirm({
      action: "payment.refund",
      entityType: "Payment",
      entityNumber: reference ?? "",
      details: amount ? [{ label: "Amount", value: amount }] : [],
      onConfirm: () =>
        new Promise<{ error?: string } | void>((resolve) => {
          start(async () => {
            const result = await refundAdvanceAction(paymentId);
            if (result.error) {
              resolve({ error: result.error });
              return;
            }
            toast.success(t(locale, "Advance refunded."));
            resolve();
          });
        }),
    });
  }
  return (
    <button type="button" onClick={refund} disabled={pending} className="text-ink-faint hover:text-ink disabled:opacity-50" aria-label={t(locale, "Refund")} title={t(locale, "Refund")}>
      <Undo2 className="size-3.5" />
    </button>
  );
}
