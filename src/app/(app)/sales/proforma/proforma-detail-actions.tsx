"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { RecordPaymentDialog, type BankAccountOption } from "../../finance/_shared/record-payment-dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import { updateProformaStatusAction } from "./actions";
import { ConvertMenu } from "../_shared/convert-menu";

const STATUSES = ["draft", "sent"];

export function ProformaDetailActions({
  locale,
  proformaId,
  proformaNumber,
  customerName,
  status,
  balance,
  convertedInvoiceId,
  bankAccounts,
}: {
  locale: Locale;
  proformaId: number;
  proformaNumber: string;
  customerName: string;
  status: string;
  balance: number;
  convertedInvoiceId: number | null;
  bankAccounts: BankAccountOption[];
}) {
  const [pending, startTransition] = useTransition();
  const converted = convertedInvoiceId != null;

  function changeStatus(value: string) {
    startTransition(async () => {
      const result = await updateProformaStatusAction(proformaId, value);
      if (result?.error) toast.error(result.error);
      else toast.success(t(locale, "Saved"));
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
      <ConvertMenu locale={locale} source="proforma" id={proformaId} ctx={{ status, converted }} disabled={pending} />
    </div>
  );
}
