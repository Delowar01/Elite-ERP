"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { t, type Locale } from "@/lib/i18n/dict";
import { issueCreditNoteAction } from "./actions";

export function CnDetailActions({ locale, creditNoteId, status }: { locale: Locale; creditNoteId: number; status: string }) {
  const [pending, startTransition] = useTransition();

  function issue() {
    startTransition(async () => {
      const result = await issueCreditNoteAction(creditNoteId);
      if (result?.error) toast.error(result.error);
      else toast.success(t(locale, "Credit note issued — posted to ledger."));
    });
  }

  if (status !== "draft") return null;

  return (
    <Button style={{ width: "auto" }} disabled={pending} onClick={issue}>
      {t(locale, "Issue Credit Note")}
    </Button>
  );
}
