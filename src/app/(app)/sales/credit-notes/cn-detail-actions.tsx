"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "../../_shared/confirm-provider";
import { withRateRescue, type RescuableResult } from "../../_shared/missing-rate";
import { t, type Locale } from "@/lib/i18n/dict";
import { issueCreditNoteAction, reverseCreditNoteAction } from "./actions";

export function CnDetailActions({ locale, creditNoteId, creditNoteNumber, status }: { locale: Locale; creditNoteId: number; creditNoteNumber: string; status: string }) {
  const [pending] = useTransition();
  const confirm = useConfirm();

  function issue() {
    // A missing-rate block maps to "Fetch rate & retry", which re-runs this same attempt.
    const attempt = async (): Promise<RescuableResult> => {
      const result = await issueCreditNoteAction(creditNoteId);
      if (result?.error) return withRateRescue(locale, result, attempt);
      toast.success(t(locale, "Credit note issued — posted to ledger."));
    };
    confirm({
      action: "document.submit",
      entityType: "Credit Note",
      entityNumber: creditNoteNumber,
      confirmLabel: "Issue Credit Note",
      description: "Issuing posts a reversing entry against the source invoice and restores its balance.",
      onConfirm: attempt,
    });
  }

  function reverse() {
    confirm({
      action: "document.reverse",
      entityType: "Credit Note",
      entityNumber: creditNoteNumber,
      onConfirm: async () => {
        const result = await reverseCreditNoteAction(creditNoteId);
        if (result?.error) return result;
        toast.success(t(locale, "Credit note reversed — reversing entry posted and invoice balance restored."));
      },
    });
  }

  if (status === "draft") {
    return (
      <div className="flex items-center gap-2.5">
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
