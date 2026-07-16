"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import { fmt } from "../../sales/_shared/totals";
import { recordPaymentAction } from "../payments/actions";

export type OutstandingInvoice = { id: number; invoiceNumber: string; customerName: string; balance: number };
export type OutstandingPo = { id: number; poNumber: string; vendorName: string; balance: number };
export type BankAccountOption = { id: number; name: string };

// Reused from three places (Payment Records page, Invoice detail, PO detail) rather than
// three separate UIs — locked* props pre-select and disable the source-document choice
// when launched from that document's own detail page.
export function RecordPaymentDialog({
  locale,
  bankAccounts,
  invoices,
  purchaseOrders,
  trigger,
  lockedDirection,
  lockedSourceId,
}: {
  locale: Locale;
  bankAccounts: BankAccountOption[];
  invoices: OutstandingInvoice[];
  purchaseOrders: OutstandingPo[];
  trigger: React.ReactNode;
  lockedDirection?: "in" | "out";
  lockedSourceId?: number;
}) {
  function findBalance(dir: "in" | "out", id: string): number | undefined {
    return dir === "in" ? invoices.find((i) => String(i.id) === id)?.balance : purchaseOrders.find((p) => String(p.id) === id)?.balance;
  }

  const initialDirection = lockedDirection ?? "in";
  const initialSourceId = lockedSourceId ? String(lockedSourceId) : "";
  const initialBalance = findBalance(initialDirection, initialSourceId);

  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"in" | "out">(initialDirection);
  const [sourceId, setSourceId] = useState(initialSourceId);
  const [bankAccountId, setBankAccountId] = useState("");
  const [amount, setAmount] = useState(initialBalance !== undefined ? String(initialBalance) : "");
  const [method, setMethod] = useState("bank_transfer");
  const [pending, startTransition] = useTransition();

  const locked = !!lockedDirection;
  const selected = useMemo(
    () => (direction === "in" ? invoices.find((i) => String(i.id) === sourceId) : purchaseOrders.find((p) => String(p.id) === sourceId)),
    [direction, sourceId, invoices, purchaseOrders],
  );

  function selectSource(id: string) {
    setSourceId(id);
    const balance = findBalance(direction, id);
    if (balance !== undefined) setAmount(String(balance));
  }

  // Recomputes every field from the *current* invoices/purchaseOrders props (not a value
  // captured when the dialog first mounted) — called on open so a reopened dialog picks up
  // the balance left after whatever payment was just recorded, not the pre-payment one.
  function resetToDefaults() {
    setDirection(initialDirection);
    setSourceId(initialSourceId);
    setBankAccountId("");
    setAmount(initialBalance !== undefined ? String(initialBalance) : "");
    setMethod("bank_transfer");
  }

  function submit(formData: FormData) {
    formData.set("direction", direction);
    formData.set("sourceId", sourceId);
    formData.set("bankAccountId", bankAccountId);
    formData.set("method", method);
    startTransition(async () => {
      const result = await recordPaymentAction(formData);
      if (result.error) toast.error(result.error);
      else {
        toast.success(t(locale, "Payment recorded — posted to ledger."));
        setOpen(false);
      }
    });
  }

  return (
    <>
      <span
        onClick={() => {
          resetToDefaults();
          setOpen(true);
        }}
      >
        {trigger}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <Wallet className="size-4 inline-block me-1.5" style={{ color: "var(--brand-orange)" }} />
              {t(locale, "Record Payment")}
            </DialogTitle>
          </DialogHeader>
          <form action={submit} className="flex flex-col gap-4">
            {!locked && (
              <FormField label={t(locale, "Direction")} htmlFor="pay-direction">
                <Select
                  value={direction}
                  onValueChange={(v) => {
                    setDirection(v as "in" | "out");
                    setSourceId("");
                    setAmount("");
                  }}
                >
                  <SelectTrigger id="pay-direction">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in">{t(locale, "Received from Customer")}</SelectItem>
                    <SelectItem value="out">{t(locale, "Paid to Vendor")}</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            )}

            {locked ? (
              <FormField label={direction === "in" ? t(locale, "Invoice") : t(locale, "Purchase Order")} htmlFor="pay-source-locked">
                <div id="pay-source-locked" className="input plain">
                  {direction === "in"
                    ? invoices[0] && `${invoices[0].invoiceNumber} · ${invoices[0].customerName}`
                    : purchaseOrders[0] && `${purchaseOrders[0].poNumber} · ${purchaseOrders[0].vendorName}`}
                </div>
              </FormField>
            ) : (
              <FormField label={direction === "in" ? t(locale, "Invoice") : t(locale, "Purchase Order")} htmlFor="pay-source">
                <Select value={sourceId} onValueChange={selectSource}>
                  <SelectTrigger id="pay-source">
                    <SelectValue placeholder={t(locale, "Select a document")} />
                  </SelectTrigger>
                  <SelectContent>
                    {direction === "in"
                      ? invoices.map((inv) => (
                          <SelectItem key={inv.id} value={String(inv.id)}>
                            {inv.invoiceNumber} · {inv.customerName} · {t(locale, "Balance")} {fmt(inv.balance)}
                          </SelectItem>
                        ))
                      : purchaseOrders.map((po) => (
                          <SelectItem key={po.id} value={String(po.id)}>
                            {po.poNumber} · {po.vendorName} · {t(locale, "Balance")} {fmt(po.balance)}
                          </SelectItem>
                        ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}

            <FormField label={t(locale, "Bank Account")} htmlFor="pay-bank-account">
              <Select value={bankAccountId} onValueChange={setBankAccountId}>
                <SelectTrigger id="pay-bank-account">
                  <SelectValue placeholder={t(locale, "Select an account")} />
                </SelectTrigger>
                <SelectContent>
                  {bankAccounts.map((ba) => (
                    <SelectItem key={ba.id} value={String(ba.id)}>
                      {ba.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField label={t(locale, "Amount")} htmlFor="pay-amount">
              <Input
                id="pay-amount"
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={selected ? fmt(selected.balance) : "0.00"}
              />
            </FormField>

            <FormField label={t(locale, "Date")} htmlFor="pay-date">
              <Input id="pay-date" name="paymentDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
            </FormField>

            <FormField label={t(locale, "Method")} htmlFor="pay-method">
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger id="pay-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_transfer">{t(locale, "Bank Transfer")}</SelectItem>
                  <SelectItem value="cash">{t(locale, "Cash")}</SelectItem>
                  <SelectItem value="card">{t(locale, "Card")}</SelectItem>
                  <SelectItem value="cheque">{t(locale, "Cheque")}</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            <FormField label={t(locale, "Reference")} htmlFor="pay-reference">
              <Input id="pay-reference" name="reference" />
            </FormField>

            <DialogFooter>
              <Button type="submit" disabled={pending || !sourceId || !bankAccountId}>
                {pending ? t(locale, "Saving…") : t(locale, "Save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
