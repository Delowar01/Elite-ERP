"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "../../_shared/confirm-provider";
import { withRateRescue, type RescuableResult } from "../../_shared/missing-rate";
import { t, type Locale } from "@/lib/i18n/dict";
import type { ReturnableLine } from "@/lib/credit-note-returns";
import { issueCreditNoteAction, reverseCreditNoteAction, returnCreditNoteGoodsAction } from "./actions";

// ACC-01: the goods a customer physically sent back, returned to stock against this issued note — line
// by line, in whole units, never more than the line credits or the invoice issued. Each comes back at
// the cost the invoice sold it at (the server's figures; the action returns its refusal, already in
// the session's language).
//
// Each opening of the dialog is one submission, with its own key: a double click or a retried request
// sends the same key and the server records it once; a later delivery opens the dialog again.
const submissionKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

function ReturnGoodsDialog({ locale, creditNoteId, lines }: { locale: Locale; creditNoteId: number; lines: ReturnableLine[] }) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [requestKey, setRequestKey] = useState("");
  const [pending, startTransition] = useTransition();
  const entered = lines.map((l) => ({ line: l, raw: (qty[l.lineId] ?? "").trim() }));
  const invalid = entered.some(({ line, raw }) => raw !== "" && (!Number.isInteger(Number(raw)) || Number(raw) < 0 || Number(raw) > line.returnable));
  const units = entered.reduce((n, { raw }) => n + (Number(raw) || 0), 0);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setRequestKey(submissionKey()); else setQty({}); }}>
      <DialogTrigger asChild>
        <Button variant="glass">{t(locale, "Return goods to stock")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(locale, "Return goods to stock")}</DialogTitle>
          <DialogDescription>
            {t(locale, "Record the goods the customer sent back. They return to stock at the cost the invoice sold them at, and that cost comes off cost of goods sold. Leave a line empty if nothing came back on it.")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {lines.map((l) => (
            <div key={l.lineId} className="flex flex-col gap-1.5">
              <Label htmlFor={`return-${l.lineId}`}>{l.label}</Label>
              <Input
                id={`return-${l.lineId}`}
                type="number"
                step="1"
                min="0"
                max={l.returnable}
                inputMode="numeric"
                disabled={l.returnable === 0}
                value={qty[l.lineId] ?? ""}
                onChange={(e) => setQty((q) => ({ ...q, [l.lineId]: e.target.value }))}
                aria-describedby={`return-${l.lineId}-counts`}
              />
              <p id={`return-${l.lineId}-counts`} className="text-xs text-ink-faint">
                {t(locale, "Credited")}: <span className="num">{l.credited}</span> · {t(locale, "Already returned")}: <span className="num">{l.returned}</span> ·{" "}
                {t(locale, "Can still come back")}: <span className="num">{l.returnable}</span>
              </p>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button
            variant="primary"
            disabled={pending || invalid || units === 0}
            onClick={() => {
              startTransition(async () => {
                const request = lines.map((l) => ({ lineId: l.lineId, quantity: (qty[l.lineId] ?? "").trim() || "0" }));
                const result = await returnCreditNoteGoodsAction(creditNoteId, request, requestKey);
                if (result?.error) {
                  toast.error(result.error);
                  return;
                }
                toast.success(t(locale, "Goods returned to stock."));
                setOpen(false);
                setQty({});
              });
            }}
          >
            {pending ? t(locale, "Returning…") : t(locale, "Return to stock")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CnDetailActions({ locale, creditNoteId, creditNoteNumber, status, returnables = [] }: { locale: Locale; creditNoteId: number; creditNoteNumber: string; status: string; returnables?: ReturnableLine[] }) {
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
        <Button disabled={pending} onClick={issue}>
          {t(locale, "Issue Credit Note")}
        </Button>
      </div>
    );
  }

  if (status === "issued") {
    return (
      <>
        {returnables.some((l) => l.returnable > 0) && <ReturnGoodsDialog locale={locale} creditNoteId={creditNoteId} lines={returnables} />}
        <Button variant="destructive-ghost" disabled={pending} onClick={reverse}>
          {t(locale, "Reverse Credit Note")}
        </Button>
      </>
    );
  }

  return null;
}
