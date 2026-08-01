"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { RecordPaymentDialog, type BankAccountOption } from "../../finance/_shared/record-payment-dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import { sendInvoiceAction, voidInvoiceAction } from "./actions";
import { ConvertMenu } from "../_shared/convert-menu";

export function InvoiceDetailActions({
  locale,
  invoiceId,
  invoiceNumber,
  customerName,
  balance,
  status,
  canVoid,
  bankAccounts,
}: {
  locale: Locale;
  invoiceId: number;
  invoiceNumber: string;
  customerName: string;
  balance: number;
  status: string;
  canVoid: boolean;
  bankAccounts: BankAccountOption[];
}) {
  const [pending, startTransition] = useTransition();

  function send() {
    startTransition(async () => {
      const result = await sendInvoiceAction(invoiceId);
      if (result?.error) toast.error(result.error);
      else toast.success(t(locale, "Invoice sent — posted to ledger and stock updated."));
    });
  }

  function voidInvoice() {
    startTransition(async () => {
      const result = await voidInvoiceAction(invoiceId);
      if (result?.error) toast.error(result.error);
      else toast.success(t(locale, "Invoice voided — ledger entry reversed and stock restored."));
    });
  }

  if (status === "draft") {
    return (
      <div className="flex items-center gap-2.5">
        <Button variant="glass" style={{ width: "auto" }} asChild>
          <Link href={`/sales/invoices/${invoiceId}/edit`}>{t(locale, "Edit")}</Link>
        </Button>
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
      <ConvertMenu locale={locale} source="invoice" id={invoiceId} ctx={{ status }} disabled={pending} />
    </div>
  );
}
