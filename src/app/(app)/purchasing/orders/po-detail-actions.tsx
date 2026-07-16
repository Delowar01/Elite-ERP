"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { RecordPaymentDialog, type BankAccountOption } from "../../finance/_shared/record-payment-dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import { sendPurchaseOrderAction, receivePurchaseOrderAction, cancelPurchaseOrderAction } from "./actions";

export function PoDetailActions({
  locale,
  poId,
  poNumber,
  vendorName,
  balance,
  status,
  bankAccounts,
}: {
  locale: Locale;
  poId: number;
  poNumber: string;
  vendorName: string;
  balance: number;
  status: string;
  bankAccounts: BankAccountOption[];
}) {
  const [pending, startTransition] = useTransition();

  function send() {
    startTransition(async () => {
      const result = await sendPurchaseOrderAction(poId);
      if (result?.error) toast.error(result.error);
    });
  }

  function receive() {
    startTransition(async () => {
      const result = await receivePurchaseOrderAction(poId);
      if (result?.error) toast.error(result.error);
      else toast.success(t(locale, "Purchase order received — posted to ledger and stock updated."));
    });
  }

  function cancel() {
    startTransition(async () => {
      const result = await cancelPurchaseOrderAction(poId);
      if (result?.error) toast.error(result.error);
      else toast.success(t(locale, "Saved"));
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
        <Button variant="glass" style={{ width: "auto" }} asChild>
          <Link href={`/purchasing/debit-notes/new?po=${poId}`}>{t(locale, "Create Debit Note")}</Link>
        </Button>
        {balance > 0 && (
          <RecordPaymentDialog
            locale={locale}
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
