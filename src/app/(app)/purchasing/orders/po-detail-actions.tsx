"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "../../_shared/confirm-provider";
import { RecordPaymentDialog, type BankAccountOption } from "../../finance/_shared/record-payment-dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import { sendPurchaseOrderAction, receivePurchaseOrderAction, cancelPurchaseOrderAction } from "./actions";
import { ConvertMenu } from "../../sales/_shared/convert-menu";

export function PoDetailActions({
  locale,
  currency,
  poId,
  poNumber,
  vendorName,
  balance,
  status,
  bankAccounts,
}: {
  locale: Locale;
  currency: string;
  poId: number;
  poNumber: string;
  vendorName: string;
  balance: number;
  status: string;
  bankAccounts: BankAccountOption[];
}) {
  const [pending] = useTransition();
  const confirm = useConfirm();

  function send() {
    confirm({
      action: "document.submit",
      entityType: "Purchase Order",
      entityNumber: poNumber,
      confirmLabel: "Send to Vendor",
      description: "The order will be issued to the vendor. Nothing is posted to the ledger until it is received.",
      details: [{ label: "Vendor", value: vendorName }],
      onConfirm: async () => {
        const result = await sendPurchaseOrderAction(poId);
        if (result?.error) return result;
        toast.success(t(locale, "Saved"));
      },
    });
  }

  function receive() {
    confirm({
      action: "document.receive",
      entityType: "Purchase Order",
      entityNumber: poNumber,
      details: [{ label: "Vendor", value: vendorName }],
      onConfirm: async () => {
        const result = await receivePurchaseOrderAction(poId);
        if (result?.error) return result;
        toast.success(t(locale, "Purchase order received — posted to ledger and stock updated."));
      },
    });
  }

  function cancel() {
    confirm({
      action: "document.cancel",
      entityType: "Purchase Order",
      entityNumber: poNumber,
      details: [{ label: "Vendor", value: vendorName }],
      onConfirm: async () => {
        const result = await cancelPurchaseOrderAction(poId);
        if (result?.error) return result;
        toast.success(t(locale, "Saved"));
      },
    });
  }

  if (status === "draft") {
    return (
      <div className="flex items-center gap-2.5">
        <Button variant="ghost" style={{ width: "auto" }} disabled={pending} onClick={cancel}>
          {t(locale, "Cancel")}
        </Button>
        <Button style={{ width: "auto" }} disabled={pending} onClick={send}>
          {t(locale, "Send to Vendor")}
        </Button>
      </div>
    );
  }

  if (status === "ordered") {
    return (
      <div className="flex items-center gap-2.5">
        <Button variant="glass" style={{ width: "auto" }} disabled={pending} onClick={cancel}>
          {t(locale, "Cancel")}
        </Button>
        <Button style={{ width: "auto" }} disabled={pending} onClick={receive}>
          {t(locale, "Receive")}
        </Button>
      </div>
    );
  }

  if (status === "received") {
    return (
      <div className="flex items-center gap-2.5">
        <ConvertMenu locale={locale} source="purchase_order" id={poId} number={poNumber} typeLabel="Purchase Order" ctx={{ status }} disabled={pending} />
        {balance > 0 && (
          <RecordPaymentDialog
            locale={locale}
            currency={currency}
            bankAccounts={bankAccounts}
            invoices={[]}
            purchaseOrders={[{ id: poId, poNumber, vendorName, balance }]}
            lockedDirection="out"
            lockedSourceId={poId}
            trigger={<Button style={{ width: "auto" }}>{t(locale, "Record Payment")}</Button>}
          />
        )}
      </div>
    );
  }

  return null;
}
