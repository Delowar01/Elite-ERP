"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { t, type Locale } from "@/lib/i18n/dict";
import { sendPurchaseOrderAction, receivePurchaseOrderAction, cancelPurchaseOrderAction } from "./actions";

export function PoDetailActions({ locale, poId, status }: { locale: Locale; poId: number; status: string }) {
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
      <Button style={{ width: "auto" }} asChild>
        <Link href={`/purchasing/debit-notes/new?po=${poId}`}>{t(locale, "Create Debit Note")}</Link>
      </Button>
    );
  }

  return null;
}
