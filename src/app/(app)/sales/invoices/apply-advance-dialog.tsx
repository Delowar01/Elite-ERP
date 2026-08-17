"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import { fmt } from "../_shared/totals";
import { useConfirm } from "../../_shared/confirm-provider";
import { applyAdvanceToInvoiceAction, type AvailableAdvance } from "./advance-actions";

/**
 * Apply an available customer advance to this invoice.
 *
 * Ineligible advances are LISTED WITH THEIR REASON rather than hidden. A user holding a USD advance
 * who opens a SAR invoice would otherwise see an empty list and conclude the advance had vanished;
 * cross-currency application is a deliberate limitation, so the UI says so instead of behaving as
 * though the money is not there.
 */
export function ApplyAdvanceDialog({
  locale,
  invoiceId,
  currency,
  due,
  advances,
}: {
  locale: Locale;
  invoiceId: number;
  currency: string;
  /** Outstanding balance in the invoice's currency — the ceiling for any application. */
  due: number;
  advances: AvailableAdvance[];
}) {
  const eligible = advances.filter((a) => a.ineligibleReason === null);
  const blocked = advances.filter((a) => a.ineligibleReason !== null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(eligible[0] ? String(eligible[0].paymentId) : "");
  const chosen = eligible.find((a) => String(a.paymentId) === selected);
  const max = chosen ? Math.min(Number(chosen.available), due) : 0;
  const [amount, setAmount] = useState("");
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  if (advances.length === 0) return null;

  function submit() {
    const value = Number(amount || max);
    if (!chosen || !(value > 0)) {
      toast.error(t(locale, "Enter an amount greater than zero."));
      return;
    }
    confirm({
      action: "payment.record",
      entityType: "Customer Advance",
      entityNumber: chosen.proformaNumber,
      confirmLabel: "Apply Advance",
      description: "The advance will be applied to this invoice and its outstanding balance reduced. No new payment is recorded — the money was received when the advance was taken.",
      details: [
        { label: "Amount", value: fmt(value, currency) },
        { label: "Advance Available", value: fmt(Number(chosen.available), currency) },
      ],
      onConfirm: () =>
        new Promise<{ error?: string } | void>((resolve) => {
          start(async () => {
            const result = await applyAdvanceToInvoiceAction(invoiceId, chosen.paymentId, String(value));
            if (result.error) {
              resolve({ error: result.error });
              return;
            }
            toast.success(t(locale, "Advance applied."));
            setOpen(false);
            resolve();
          });
        }),
    });
  }

  return (
    <>
      <Button variant="glass" style={{ width: "auto" }} onClick={() => setOpen(true)} disabled={eligible.length === 0}>
        <Wallet className="size-3.5" /> {t(locale, "Apply Advance")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md w-[92vw]">
          <DialogHeader>
            <DialogTitle>{t(locale, "Apply Advance")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <FormField label={t(locale, "Customer Advance")} htmlFor="apply-advance-source">
              <Select value={selected} onValueChange={(v) => { setSelected(v); setAmount(""); }}>
                <SelectTrigger id="apply-advance-source">
                  <SelectValue placeholder={t(locale, "Select an advance")} />
                </SelectTrigger>
                <SelectContent>
                  {eligible.map((a) => (
                    <SelectItem key={a.paymentId} value={String(a.paymentId)}>
                      {a.proformaNumber} · {fmt(Number(a.available), a.currency ?? currency)} · {a.paymentDate}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label={t(locale, "Amount")} htmlFor="apply-advance-amount">
              <Input
                id="apply-advance-amount"
                type="number"
                step="0.01"
                min="0"
                max={max}
                value={amount}
                placeholder={String(max)}
                onChange={(e) => setAmount(e.target.value)}
              />
            </FormField>
            <div className="text-[11.5px] text-ink-muted" data-testid="apply-advance-max">
              {t(locale, "Up to")} {fmt(max, currency)} — {t(locale, "the lower of the advance available and the amount outstanding.")}
            </div>
            {blocked.length > 0 && (
              // Explain, never merely filter.
              <div className="rounded-xl border border-line p-2.5 text-[11.5px] text-ink-muted" data-testid="apply-advance-blocked">
                {blocked.map((a) => (
                  <div key={a.paymentId} className="mb-1 last:mb-0">
                    <span className="font-medium">{a.proformaNumber}</span> · {fmt(Number(a.available), a.currency ?? currency)} — {a.ineligibleReason}
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending || !chosen}>
              {pending ? t(locale, "Saving…") : t(locale, "Apply Advance")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
