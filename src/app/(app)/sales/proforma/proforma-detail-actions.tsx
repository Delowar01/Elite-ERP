"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { RecordPaymentDialog, type BankAccountOption } from "../../finance/_shared/record-payment-dialog";
import { useConfirm } from "../../_shared/confirm-provider";
import { t, type Locale } from "@/lib/i18n/dict";
import { updateProformaStatusAction } from "./actions";
import { ConvertMenu } from "../_shared/convert-menu";

const STATUSES = ["draft", "sent"];

export function ProformaDetailActions({
  locale,
  currency,
  proformaId,
  proformaNumber,
  customerName,
  status,
  balance,
  convertedInvoiceId,
  bankAccounts,
}: {
  locale: Locale;
  currency: string;
  proformaId: number;
  proformaNumber: string;
  customerName: string;
  status: string;
  balance: number;
  convertedInvoiceId: number | null;
  bankAccounts: BankAccountOption[];
}) {
  const [pending] = useTransition();
  const confirm = useConfirm();
  const converted = convertedInvoiceId != null;

  function changeStatus(value: string) {
    if (value === status) return;
    confirm({
      action: "document.statusChange",
      entityType: "Proforma Invoice",
      entityNumber: proformaNumber,
      description: "Changing the status moves this proforma forward. Proformas never post to the ledger.",
      details: [{ label: "Status", value: t(locale, value) }],
      onConfirm: async () => {
        const result = await updateProformaStatusAction(proformaId, value);
        if (result?.error) return result;
        toast.success(t(locale, "Saved"));
      },
    });
  }

  // Once converted, the proforma is read-only: it just links to the sales invoice.
  if (converted) {
    return (
      <Button variant="glass" style={{ width: "auto" }} asChild>
        <Link href={`/sales/invoices/${convertedInvoiceId}`}>{t(locale, "View Sales Invoice")}</Link>
      </Button>
    );
  }

  const canRecordPayment = status === "sent" && balance > 0;

  return (
    <div className="flex items-center gap-2.5">
      <Select value={status} onValueChange={changeStatus}>
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {t(locale, s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {canRecordPayment && (
        <RecordPaymentDialog
          locale={locale}
          currency={currency}
          bankAccounts={bankAccounts}
          invoices={[]}
          purchaseOrders={[]}
          proformas={[{ id: proformaId, proformaNumber, customerName, balance }]}
          lockedDirection="in"
          lockedSourceType="proforma"
          lockedSourceId={proformaId}
          trigger={<Button style={{ width: "auto" }}>{t(locale, "Record Payment")}</Button>}
        />
      )}
      <ConvertMenu locale={locale} source="proforma" id={proformaId} number={proformaNumber} typeLabel="Proforma Invoice" ctx={{ status, converted }} disabled={pending} />
    </div>
  );
}
