"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { t, type Locale } from "@/lib/i18n/dict";
import { issueDebitNoteAction, reverseDebitNoteAction } from "./actions";

export function DnDetailActions({ locale, debitNoteId, status }: { locale: Locale; debitNoteId: number; status: string }) {
  const [pending, startTransition] = useTransition();

  function issue() {
    startTransition(async () => {
      const result = await issueDebitNoteAction(debitNoteId);
      if (result?.error) toast.error(result.error);
      else toast.success(t(locale, "Debit note issued — posted to ledger."));
    });
  }

  function reverse() {
    startTransition(async () => {
      const result = await reverseDebitNoteAction(debitNoteId);
      if (result?.error) toast.error(result.error);
      else toast.success(t(locale, "Debit note reversed — reversing entry posted and stock restored."));
    });
  }

  if (status === "draft") {
    return (
      <div className="flex items-center gap-2.5">
        <Button variant="glass" style={{ width: "auto" }} asChild>
          <Link href={`/purchasing/debit-notes/${debitNoteId}/edit`}>{t(locale, "Edit")}</Link>
        </Button>
        <Button style={{ width: "auto" }} disabled={pending} onClick={issue}>
          {t(locale, "Issue Debit Note")}
        </Button>
      </div>
    );
  }

  if (status === "issued") {
    return (
      <Button variant="ghost" style={{ width: "auto" }} disabled={pending} onClick={reverse} className="text-danger">
        {t(locale, "Reverse Debit Note")}
      </Button>
    );
  }

  return null;
}
