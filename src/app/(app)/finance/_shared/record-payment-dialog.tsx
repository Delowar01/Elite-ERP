"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Wallet, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import { fmt } from "../../sales/_shared/totals";
import { moneyDecimals } from "@/lib/currency/currencies";
import { recordPaymentAction, resolvePaymentRateAction } from "../payments/actions";
import { useConfirm } from "../../_shared/confirm-provider";
import { withRateRescue, type RescuableResult } from "../../_shared/missing-rate";

export type OutstandingInvoice = { id: number; invoiceNumber: string; customerName: string; balance: number; currency?: string | null };
export type OutstandingProforma = { id: number; proformaNumber: string; customerName: string; balance: number; currency?: string | null };
export type OutstandingPo = { id: number; poNumber: string; vendorName: string; balance: number; currency?: string | null };
export type BankAccountOption = { id: number; name: string };
export type PaymentSourceType = "invoice" | "proforma" | "po";

// Reused from every payment entry point (Payment Records page, Invoice/Proforma/PO detail) rather
// than separate UIs — locked* props pre-select and disable the source-document choice when launched
// from a document's own detail page. lockedSourceType targets a proforma (Issue #14) or invoice/PO.
export function RecordPaymentDialog({
  locale,
  currency,
  baseCurrency,
  bankAccounts,
  invoices,
  purchaseOrders,
  proformas = [],
  trigger,
  lockedDirection,
  lockedSourceId,
  lockedSourceType,
}: {
  locale: Locale;
  /** The currency the balances and the amount are in — the document's, not a fixed two decimals. */
  currency: string;
  /** The organization's base currency — when the document's differs, the received-in-base field shows (FX-7). */
  baseCurrency: string;
  bankAccounts: BankAccountOption[];
  invoices: OutstandingInvoice[];
  purchaseOrders: OutstandingPo[];
  proformas?: OutstandingProforma[];
  trigger: React.ReactNode;
  lockedDirection?: "in" | "out";
  lockedSourceId?: number;
  lockedSourceType?: PaymentSourceType;
}) {
  // The source type: locked value wins; otherwise derived from the direction (Payment Records page
  // records against invoices when receiving and POs when paying).
  const sourceType: PaymentSourceType = lockedSourceType ?? (lockedDirection === "out" ? "po" : "invoice");

  // One minor unit of this currency: the smallest amount that can be paid, and the input's step.
  // Hardcoding 0.01 stopped a Kuwaiti user entering 0.075 at all — the browser rejected it.
  const minorUnit = String(1 / 10 ** moneyDecimals("document", currency));
  const zeroPlaceholder = (0).toFixed(moneyDecimals("document", currency));

  function findBalance(dir: "in" | "out", id: string): number | undefined {
    if (sourceType === "proforma") return proformas.find((p) => String(p.id) === id)?.balance;
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
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  // FX-7 (received-amount-first): the base figure the bank statement shows. Pre-filled from the
  // rate on file at the payment date; once the USER edits it, it is the override — the effective
  // rate follows it, and neither a date change nor a fresh resolve overwrites it.
  const [baseReceived, setBaseReceived] = useState("");
  const [baseEdited, setBaseEdited] = useState(false);
  const [fetched, setFetched] = useState<{ rate: string; source: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  const locked = !!lockedDirection;
  const selected = useMemo(
    () =>
      sourceType === "proforma"
        ? proformas.find((p) => String(p.id) === sourceId)
        : direction === "in"
          ? invoices.find((i) => String(i.id) === sourceId)
          : purchaseOrders.find((p) => String(p.id) === sourceId),
    [sourceType, direction, sourceId, invoices, purchaseOrders, proformas],
  );

  // The SELECTED document's currency decides whether the second field exists at all.
  const docCurrency = (selected?.currency ?? currency ?? baseCurrency).toUpperCase();
  const foreign = docCurrency !== baseCurrency.toUpperCase();
  const baseDp = moneyDecimals("document", baseCurrency);

  // Re-resolve the pre-fill rate whenever the dialog opens, the document changes, or the payment
  // date changes (async state only — the React compiler forbids synchronous setState in effects).
  // A user-edited base amount is never overwritten (the override rule) — but the fetched rate is
  // still refreshed, because the deviation warning compares against it.
  useEffect(() => {
    if (!open || !foreign) return;
    let stale = false;
    void resolvePaymentRateAction(docCurrency, paymentDate)
      .then((r) => { if (!stale) setFetched(r); })
      .catch(() => { if (!stale) setFetched(null); });
    return () => { stale = true; };
  }, [open, foreign, docCurrency, paymentDate]);

  // The visible base figure: the user's own value once edited (pinned — nothing overwrites it),
  // otherwise DERIVED at render from amount × the fetched rate. No state tracks the pre-fill, so
  // there is nothing to keep in sync when the amount or the date's rate changes.
  const shownBase = baseEdited
    ? baseReceived
    : foreign && fetched && Number(amount) > 0
      ? (Number(amount) * Number(fetched.rate)).toFixed(baseDp)
      : "";

  // The effective rate is always DERIVED from the two visible figures — the bank statement is
  // ground truth, the rate follows it, never the other way around.
  const effectiveRate = foreign && Number(amount) > 0 && Number(shownBase) > 0 ? Number(shownBase) / Number(amount) : null;
  const deviates =
    effectiveRate !== null && fetched !== null &&
    Math.abs(effectiveRate - Number(fetched.rate)) / Number(fetched.rate) > 0.1;

  function selectSource(id: string) {
    setSourceId(id);
    const balance = findBalance(direction, id);
    if (balance !== undefined) setAmount(String(balance));
    setBaseEdited(false);
    setBaseReceived("");
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
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setBaseReceived("");
    setBaseEdited(false);
    setFetched(null);
  }

  // Recording a payment moves cash and the ledger, so it is confirmed with the figures that matter
  // (amount, document, party, bank account) before anything is posted. Nothing runs until confirm.
  // Invoked from onSubmit rather than a form action DELIBERATELY: React resets a form when its
  // action completes, and this "action" completes instantly (it only opens the confirmation) — the
  // reset was blanking the bank-account select and the typed fields behind the confirm dialog, so
  // a user returning from a refused attempt found a half-cleared form.
  function submit(formData: FormData) {
    formData.set("direction", direction);
    formData.set("sourceType", sourceType);
    formData.set("sourceId", sourceId);
    formData.set("bankAccountId", bankAccountId);
    formData.set("method", method);
    // Only a USER-EDITED base figure travels: an untouched pre-fill is omitted so the server
    // resolves the rate itself and records the rate row's own source; a typed figure IS the rate.
    if (foreign && baseEdited && shownBase.trim() !== "") formData.set("baseReceived", shownBase.trim());
    else formData.delete("baseReceived");

    const docNumber =
      sourceType === "proforma"
        ? proformas.find((x) => String(x.id) === sourceId)?.proformaNumber
        : direction === "in"
          ? invoices.find((x) => String(x.id) === sourceId)?.invoiceNumber
          : purchaseOrders.find((x) => String(x.id) === sourceId)?.poNumber;
    const party =
      sourceType === "proforma"
        ? proformas.find((x) => String(x.id) === sourceId)?.customerName
        : direction === "in"
          ? invoices.find((x) => String(x.id) === sourceId)?.customerName
          : purchaseOrders.find((x) => String(x.id) === sourceId)?.vendorName;
    const bankName = bankAccounts.find((b) => String(b.id) === bankAccountId)?.name;

    confirm({
      action: "payment.record",
      // Reads as "Record Payment against Purchase Order PO-000123?" in both languages.
      entityType: sourceType === "proforma" ? "against Proforma Invoice" : direction === "in" ? "against Invoice" : "against Purchase Order",
      entityNumber: docNumber ?? "",
      description:
        direction === "in"
          ? "The payment will be posted against this document and will increase your bank balance."
          : "The payment will be posted against this document and will reduce your bank balance.",
      details: [
        { label: "Amount", value: fmt(Number(amount) || 0, currency) },
        ...(docNumber ? [{ label: "Document", value: docNumber }] : []),
        ...(party ? [{ label: direction === "in" ? "Client" : "Vendor", value: party }] : []),
        ...(bankName ? [{ label: "Bank Account", value: bankName }] : []),
      ],
      onConfirm: () => {
        // Recursive on purpose: a missing payment-date rate maps to "Fetch rate & retry", which
        // re-runs this same attempt after the fetch — the identical seam as the posting paths.
        const attempt = (): Promise<RescuableResult> =>
          new Promise((resolve) => {
            startTransition(async () => {
              const result = await recordPaymentAction(formData);
              if (result.error) {
                resolve(withRateRescue(locale, result, attempt));
                return;
              }
              toast.success(t(locale, "Payment recorded — posted to ledger."));
              setOpen(false);
              resolve(undefined);
            });
          });
        return attempt();
      },
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
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(new FormData(e.currentTarget));
            }}
            className="flex flex-col gap-4"
          >
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
              <FormField
                label={sourceType === "proforma" ? t(locale, "Proforma Invoice") : direction === "in" ? t(locale, "Invoice") : t(locale, "Purchase Order")}
                htmlFor="pay-source-locked"
              >
                <div id="pay-source-locked" className="input plain">
                  {sourceType === "proforma"
                    ? proformas[0] && `${proformas[0].proformaNumber} · ${proformas[0].customerName}`
                    : direction === "in"
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
                            {inv.invoiceNumber} · {inv.customerName} · {t(locale, "Balance")} {fmt(inv.balance, currency)}
                          </SelectItem>
                        ))
                      : purchaseOrders.map((po) => (
                          <SelectItem key={po.id} value={String(po.id)}>
                            {po.poNumber} · {po.vendorName} · {t(locale, "Balance")} {fmt(po.balance, currency)}
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
                step={minorUnit}
                min={minorUnit}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={selected ? fmt(selected.balance, currency) : zeroPlaceholder}
              />
            </FormField>

            {foreign && (
              <FormField
                label={`${t(locale, direction === "in" ? "Amount Received in" : "Amount Paid in")} ${baseCurrency.toUpperCase()}`}
                htmlFor="pay-base-received"
              >
                <Input
                  id="pay-base-received"
                  type="number"
                  step={String(1 / 10 ** baseDp)}
                  min="0"
                  value={shownBase}
                  onChange={(e) => {
                    setBaseReceived(e.target.value);
                    setBaseEdited(true);
                  }}
                  placeholder={fetched ? undefined : t(locale, "No rate on file — enter the bank statement figure")}
                />
                {effectiveRate !== null && (
                  <div className="mt-1 text-[12px] text-ink-muted" data-testid="effective-rate">
                    1 {docCurrency} = {effectiveRate.toFixed(4)} {baseCurrency.toUpperCase()}
                  </div>
                )}
                {deviates && (
                  <div className="mt-1 flex items-center gap-1.5 text-[12px]" style={{ color: "var(--warning)" }} role="status">
                    <AlertTriangle className="size-3.5 shrink-0" />
                    {t(locale, "This is more than 10% away from the rate on file for this date — check the received amount.")}
                  </div>
                )}
              </FormField>
            )}

            <FormField label={t(locale, "Date")} htmlFor="pay-date">
              <Input
                id="pay-date"
                name="paymentDate"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                required
              />
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

            <FormField label={t(locale, "Note")} htmlFor="pay-notes">
              <textarea id="pay-notes" name="notes" rows={2} className="input" style={{ height: "auto", paddingTop: 8, paddingBottom: 8, resize: "vertical" }} />
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
