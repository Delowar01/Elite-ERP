"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";
import { reversePaymentAction } from "../payments/actions";
import { useConfirm } from "../../_shared/confirm-provider";

/**
 * Reverse a recorded payment — sales invoice or purchase order.
 *
 * Rendered ONLY on rows that can actually be reversed: an ordinary payment (never an advance), on
 * this document, not already reversed. An already-reversed row shows no control at all rather than
 * a disabled one — the same choice the duplicate action makes on a credit/debit note. A greyed
 * button invites a click and then explains why it was never going to work; an absent one says the
 * same thing without the round trip, and the row's own "Reversed" badge carries the reason.
 *
 * The server re-checks every one of those conditions under the payment's row lock, so this decides
 * what is worth offering and never what is permitted.
 */
export function ReversePaymentButton({
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

  function reverse() {
    confirm({
      action: "payment.reverse",
      entityType: "Payment",
      entityNumber: reference ?? "",
      details: amount ? [{ label: "Amount", value: amount }] : [],
      onConfirm: () =>
        new Promise<{ error?: string } | void>((resolve) => {
          start(async () => {
            const result = await reversePaymentAction(paymentId);
            if (result.error) {
              resolve({ error: result.error });
              return;
            }
            toast.success(t(locale, "Payment reversed."));
            resolve();
          });
        }),
    });
  }
  return (
    <button
      type="button"
      onClick={reverse}
      disabled={pending}
      className="text-ink-faint hover:text-danger disabled:opacity-50"
      aria-label={t(locale, "Reverse Payment")}
      title={t(locale, "Reverse Payment")}
      data-testid={`reverse-payment-${paymentId}`}
    >
      <Undo2 className="size-3.5" />
    </button>
  );
}
