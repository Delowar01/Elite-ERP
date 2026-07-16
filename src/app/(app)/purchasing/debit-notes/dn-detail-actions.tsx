"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { t, type Locale } from "@/lib/i18n/dict";
import { issueDebitNoteAction } from "./actions";

export function DnDetailActions({ locale, debitNoteId, status }: { locale: Locale; debitNoteId: number; status: string }) {
  const [pending, startTransition] = useTransition();

  function issue() {
    startTransition(async () => {
      const result = await issueDebitNoteAction(debitNoteId);
      if (result?.error) toast.error(result.error);
      else toast.success(t(locale, "Debit note issued — posted to ledger."));
    });
  }

  if (status !== "draft") return null;

  return (
    <Button style={{ width: "auto" }} disabled={pending} onClick={issue}>
      {t(locale, "Issue Debit Note")}
    </Button>
  );
}
