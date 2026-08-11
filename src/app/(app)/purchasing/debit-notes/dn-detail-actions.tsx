"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "../../_shared/confirm-provider";
import { withRateRescue, type RescuableResult } from "../../_shared/missing-rate";
import { t, type Locale } from "@/lib/i18n/dict";
import { issueDebitNoteAction, reverseDebitNoteAction } from "./actions";

export function DnDetailActions({ locale, debitNoteId, debitNoteNumber, status }: { locale: Locale; debitNoteId: number; debitNoteNumber: string; status: string }) {
  const [pending] = useTransition();
  const confirm = useConfirm();

  function issue() {
    // A missing-rate block maps to "Fetch rate & retry", which re-runs this same attempt.
    const attempt = async (): Promise<RescuableResult> => {
      const result = await issueDebitNoteAction(debitNoteId);
      if (result?.error) return withRateRescue(locale, result, attempt);
      toast.success(t(locale, "Debit note issued — posted to ledger."));
    };
    confirm({
      action: "document.submit",
      entityType: "Debit Note",
      entityNumber: debitNoteNumber,
      confirmLabel: "Issue Debit Note",
      description: "Issuing posts a reversing entry against the source purchase order and returns the stock.",
      onConfirm: attempt,
    });
  }

  function reverse() {
    confirm({
      action: "document.reverse",
      entityType: "Debit Note",
      entityNumber: debitNoteNumber,
      onConfirm: async () => {
        const result = await reverseDebitNoteAction(debitNoteId);
        if (result?.error) return result;
        toast.success(t(locale, "Debit note reversed — reversing entry posted and stock restored."));
      },
    });
  }

  if (status === "draft") {
    return (
      <div className="flex items-center gap-2.5">
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
