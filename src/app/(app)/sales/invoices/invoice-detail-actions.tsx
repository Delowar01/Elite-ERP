"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { t, type Locale } from "@/lib/i18n/dict";
import { sendInvoiceAction, voidInvoiceAction, convertInvoiceToDeliveryChallanAction } from "./actions";

export function InvoiceDetailActions({ locale, invoiceId, status }: { locale: Locale; invoiceId: number; status: string }) {
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
      else toast.success(t(locale, "Saved"));
    });
  }

  function createDc() {
    startTransition(async () => {
      const result = await convertInvoiceToDeliveryChallanAction(invoiceId);
      if (result?.error) toast.error(result.error);
    });
  }

  if (status === "draft") {
    return (
      <div className="flex items-center gap-2.5">
        <Button variant="ghost" style={{ width: "auto" }} disabled={pending} onClick={voidInvoice}>
          {t(locale, "Void")}
        </Button>
        <Button style={{ width: "auto" }} disabled={pending} onClick={send}>
          {t(locale, "Send Invoice")}
        </Button>
      </div>
    );
  }

  if (status === "void") return null;

  return (
    <div className="flex items-center gap-2.5">
      <Button variant="glass" style={{ width: "auto" }} disabled={pending} onClick={createDc}>
        {t(locale, "Create Delivery Challan")}
      </Button>
      <Button style={{ width: "auto" }} asChild>
        <Link href={`/sales/credit-notes/new?invoice=${invoiceId}`}>{t(locale, "Create Credit Note")}</Link>
      </Button>
    </div>
  );
}
