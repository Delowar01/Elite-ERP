"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { t, type Locale } from "@/lib/i18n/dict";
import { issueCreditNoteAction, reverseCreditNoteAction } from "./actions";

export function CnDetailActions({ locale, creditNoteId, status }: { locale: Locale; creditNoteId: number; status: string }) {
  const [pending, startTransition] = useTransition();

  function issue() {
    startTransition(async () => {
      const result = await issueCreditNoteAction(creditNoteId);
      if (result?.error) toast.error(result.error);
      else toast.success(t(locale, "Credit note issued — posted to ledger."));
    });
  }

  function reverse() {
    startTransition(async () => {
      const result = await reverseCreditNoteAction(creditNoteId);
      if (result?.error) toast.error(result.error);
      else toast.success(t(locale, "Credit note reversed — reversing entry posted and invoice balance restored."));
    });
  }

  if (status === "draft") {
    return (
      <div className="flex items-center gap-2.5">
        <Button variant="glass" style={{ width: "auto" }} asChild>
          <Link href={`/sales/credit-notes/${creditNoteId}/edit`}>{t(locale, "Edit")}</Link>
        </Button>
        <Button style={{ width: "auto" }} disabled={pending} onClick={issue}>
          {t(locale, "Issue Credit Note")}
        </Button>
      </div>
    );
  }

  if (status === "issued") {
    return (
      <Button variant="ghost" style={{ width: "auto" }} disabled={pending} onClick={reverse} className="text-danger">
        {t(locale, "Reverse Credit Note")}
      </Button>
    );
  }

  return null;
}
