"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "../../_shared/confirm-provider";
import { RecordPaymentDialog, type BankAccountOption } from "../../finance/_shared/record-payment-dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import { sendInvoiceAction, voidInvoiceAction } from "./actions";
import { ConvertMenu } from "../_shared/convert-menu";

export function InvoiceDetailActions({
  locale,
  currency,
  invoiceId,
  invoiceNumber,
  customerName,
  balance,
  status,
  canVoid,
  bankAccounts,
}: {
  locale: Locale;
  currency: string;
  invoiceId: number;
  invoiceNumber: string;
  customerName: string;
  balance: number;
  status: string;
  canVoid: boolean;
  bankAccounts: BankAccountOption[];
}) {
  const [pending] = useTransition();
  const confirm = useConfirm();

  // Sending posts to the ledger and moves stock, so it is confirmed as a financial action.
  function send() {
    confirm({
      action: "document.submit",
      entityType: "Invoice",
      entityNumber: invoiceNumber,
      confirmLabel: "Send Invoice",
      description: "Sending posts this invoice to the ledger and reduces stock on hand.",
      details: [{ label: "Client", value: customerName }],
      onConfirm: async () => {
        const result = await sendInvoiceAction(invoiceId);
        if (result?.error) return result;
        toast.success(t(locale, "Invoice sent — posted to ledger and stock updated."));
      },
    });
  }

  function voidInvoice() {
    confirm({
      action: "document.void",
      entityType: "Invoice",
      entityNumber: invoiceNumber,
      details: [{ label: "Client", value: customerName }],
      onConfirm: async () => {
        const result = await voidInvoiceAction(invoiceId);
        if (result?.error) return result;
        toast.success(t(locale, "Invoice voided — ledger entry reversed and stock restored."));
      },
    });
  }

  if (status === "draft") {
    return (
      <div className="flex items-center gap-2.5">
        <Button style={{ width: "auto" }} disabled={pending} onClick={send}>
          {t(locale, "Send Invoice")}
        </Button>
      </div>
    );
  }

  if (status === "void") return null;

  const canRecordPayment = (status === "sent" || status === "partially_paid") && balance > 0;

  return (
    <div className="flex items-center gap-2.5">
      {canVoid && (
        <Button variant="ghost" style={{ width: "auto" }} disabled={pending} onClick={voidInvoice} className="text-danger">
          {t(locale, "Void")}
        </Button>
      )}
      {canRecordPayment && (
        <RecordPaymentDialog
          locale={locale}
          currency={currency}
          bankAccounts={bankAccounts}
          invoices={[{ id: invoiceId, invoiceNumber, customerName, balance }]}
          purchaseOrders={[]}
          lockedDirection="in"
          lockedSourceId={invoiceId}
          trigger={
            <Button style={{ width: "auto" }}>{t(locale, "Record Payment")}</Button>
          }
        />
      )}
      <ConvertMenu locale={locale} source="invoice" id={invoiceId} number={invoiceNumber} typeLabel="Invoice" ctx={{ status }} disabled={pending} />
    </div>
  );
}
