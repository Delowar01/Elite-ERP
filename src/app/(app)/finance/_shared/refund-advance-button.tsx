"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";
import { refundAdvanceAction, resolvePaymentRateAction } from "../payments/actions";
import { useConfirm } from "../../_shared/confirm-provider";
import { moneyDecimals } from "@/lib/currency/currencies";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Refund a customer advance — partially or in full (§10).
 *
 * A dialog rather than a one-click confirm, because two figures are now genuinely the user's:
 *
 *  - **How much** to refund. An advance can be 80% applied and 20% refundable, so "refund it" no
 *    longer has one meaning. Pre-filled with the whole available balance, which is the common case.
 *  - **What the bank actually paid out**, for a foreign advance. A refund is a real cash movement,
 *    and if the rate moved since the receipt the bank pays a different base figure than the
 *    liability was carried at. Pre-filled at the payout date's rate and EDITABLE — the bank
 *    statement is ground truth and the effective rate follows it, exactly as the received-amount
 *    field works for money coming in.
 *
 * Rendered only on rows with an available balance; the server recomputes availability under the
 * advance's row lock and refuses anything this pre-fill got wrong, so the dialog is convenience,
 * never authorization.
 */
export function RefundAdvanceButton({
  locale,
  paymentId,
  reference,
  available,
  currency,
  baseCurrency,
}: {
  locale: Locale;
  paymentId: number;
  /** The payment's own reference (never a database id) — shown in the confirmation. */
  reference?: string;
  /** Document-currency balance still refundable, from the same arithmetic the server applies. */
  available: string;
  /** The advance's own currency; null = base. */
  currency: string | null;
  baseCurrency: string;
}) {
  const [pending, start] = useTransition();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(available);
  const [basePaidOut, setBasePaidOut] = useState("");
  const [baseEdited, setBaseEdited] = useState(false);
  const [fetched, setFetched] = useState<{ rate: string; source: string } | null>(null);

  const docCurrency = (currency ?? baseCurrency).toUpperCase();
  const foreign = docCurrency !== baseCurrency.toUpperCase();
  const baseDp = moneyDecimals("document", baseCurrency);
  const today = new Date().toISOString().slice(0, 10);

  // The payout-date rate, for the pre-fill. A user-edited figure is never overwritten.
  useEffect(() => {
    if (!open || !foreign) return;
    let stale = false;
    void resolvePaymentRateAction(docCurrency, today)
      .then((r) => { if (!stale) setFetched(r); })
      .catch(() => { if (!stale) setFetched(null); });
    return () => { stale = true; };
  }, [open, foreign, docCurrency, today]);

  const shownBase = baseEdited
    ? basePaidOut
    : foreign && fetched && Number(amount) > 0
      ? (Number(amount) * Number(fetched.rate)).toFixed(baseDp)
      : "";
  // Derived from the two visible figures, never the other way around.
  const effectiveRate = foreign && Number(amount) > 0 && Number(shownBase) > 0 ? Number(shownBase) / Number(amount) : null;
  const overAvailable = Number(amount) > Number(available) + 1e-9;

  function submit() {
    if (Number(amount) <= 0 || overAvailable) return;
    setOpen(false);
    confirm({
      action: "payment.refund",
      entityType: "Payment",
      entityNumber: reference ?? "",
      details: [
        { label: "Amount", value: `${amount} ${docCurrency}` },
        ...(foreign && shownBase ? [{ label: "Paid out", value: `${shownBase} ${baseCurrency.toUpperCase()}` }] : []),
      ],
      onConfirm: () =>
        new Promise<{ error?: string } | void>((resolve) => {
          start(async () => {
            const result = await refundAdvanceAction(paymentId, {
              amount,
              // Sent only when the user edited it: an untouched pre-fill leaves the server to
              // resolve the payout-date rate itself and record that rate's own provenance.
              ...(foreign && baseEdited && shownBase.trim() !== "" ? { basePaidOut: shownBase.trim() } : {}),
            });
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
    <>
      <button
        type="button"
        onClick={() => { setAmount(available); setBaseEdited(false); setBasePaidOut(""); setOpen(true); }}
        disabled={pending}
        className="text-ink-faint hover:text-ink disabled:opacity-50"
        aria-label={t(locale, "Refund")}
        title={t(locale, "Refund")}
      >
        <Undo2 className="size-3.5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{t(locale, "Refund Advance")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-[12px] text-ink-muted" htmlFor="refund-amount">
                {t(locale, "Amount to refund")} ({docCurrency})
              </label>
              <input
                id="refund-amount"
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="input w-full"
              />
              <div className="mt-1 text-[12px] text-ink-muted" data-testid="refund-available">
                {t(locale, "Available")}: {available} {docCurrency}
              </div>
              {overAvailable && (
                <div className="mt-1 text-[12px] text-danger" data-testid="refund-over-available">
                  {t(locale, "More than the available balance of this advance.")}
                </div>
              )}
            </div>

            {foreign && (
              <div>
                <label className="text-[12px] text-ink-muted" htmlFor="refund-base">
                  {t(locale, "Amount paid out")} ({baseCurrency.toUpperCase()})
                </label>
                <input
                  id="refund-base"
                  type="number"
                  step="0.01"
                  value={shownBase}
                  onChange={(e) => { setBaseEdited(true); setBasePaidOut(e.target.value); }}
                  placeholder={fetched ? undefined : t(locale, "No rate on file — enter the bank statement figure")}
                  className="input w-full"
                />
                {effectiveRate !== null && (
                  <div className="mt-1 text-[12px] text-ink-muted" data-testid="refund-effective-rate">
                    1 {docCurrency} = {effectiveRate.toFixed(4)} {baseCurrency.toUpperCase()}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" style={{ width: "auto" }} onClick={() => setOpen(false)}>{t(locale, "Cancel")}</Button>
            <Button style={{ width: "auto" }} disabled={pending || Number(amount) <= 0 || overAvailable} onClick={submit}>
              {t(locale, "Refund Advance")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
