"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Account } from "@/db";
import { postJournalEntryAction } from "./actions";

type Line = { accountId: string; memo: string; debit: string; credit: string };

const emptyLine = (): Line => ({ accountId: "", memo: "", debit: "", credit: "" });

export function JournalForm({ locale, accounts }: { locale: Locale; accounts: Account[] }) {
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);
  const [pending, startTransition] = useTransition();

  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
  const balanced = totalDebit > 0 && Math.round(totalDebit * 100) === Math.round(totalCredit * 100);
  const filledLines = lines.filter((l) => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0));
  const canPost = balanced && filledLines.length >= 2 && memo.trim().length > 0;

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function submit() {
    startTransition(async () => {
      const result = await postJournalEntryAction({
        entryDate,
        memo,
        lines: filledLines.map((l) => ({ accountId: Number(l.accountId), memo: l.memo, debit: l.debit || "0", credit: l.credit || "0" })),
      });
      if (result.error) toast.error(result.error);
      else {
        toast.success(t(locale, "Saved"));
        setMemo("");
        setLines([emptyLine(), emptyLine()]);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-4">
        <FormField label={t(locale, "Entry Date")} htmlFor="je-date">
          <Input id="je-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
        </FormField>
        <div className="col-span-2">
          <FormField label={t(locale, "Memo")} htmlFor="je-memo">
            <Input id="je-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Owner capital injection" />
          </FormField>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t(locale, "Account")}</TableHead>
            <TableHead>{t(locale, "Memo")}</TableHead>
            <TableHead className="text-right">{t(locale, "Debit")}</TableHead>
            <TableHead className="text-right">{t(locale, "Credit")}</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line, i) => (
            <TableRow key={i}>
              <TableCell className="min-w-[200px]">
                <Select value={line.accountId} onValueChange={(v) => updateLine(i, { accountId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder={t(locale, "Select an account")} />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.code} · {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Input value={line.memo} onChange={(e) => updateLine(i, { memo: e.target.value })} />
              </TableCell>
              <TableCell className="text-right">
                <Input
                  type="number"
                  step="0.01"
                  className="text-right"
                  value={line.debit}
                  onChange={(e) => updateLine(i, { debit: e.target.value, credit: e.target.value ? "" : line.credit })}
                />
              </TableCell>
              <TableCell className="text-right">
                <Input
                  type="number"
                  step="0.01"
                  className="text-right"
                  value={line.credit}
                  onChange={(e) => updateLine(i, { credit: e.target.value, debit: e.target.value ? "" : line.debit })}
                />
              </TableCell>
              <TableCell>
                {lines.length > 2 && (
                  <button type="button" onClick={() => removeLine(i)} className="text-ink-faint hover:text-danger" aria-label={t(locale, "Remove")}>
                    <X className="size-4" />
                  </button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div>
        <Button variant="ghost" size="sm" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
          <Plus className="size-3.5" /> {t(locale, "Add line")}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-line bg-surface p-4">
          <div className="text-[11px] uppercase tracking-wide text-ink-faint">{t(locale, "Total debits")}</div>
          <div className="font-mono text-[15px] font-bold mt-1">{totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4">
          <div className="text-[11px] uppercase tracking-wide text-ink-faint">{t(locale, "Total credits")}</div>
          <div className="font-mono text-[15px] font-bold mt-1">{totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
        </div>
        <div
          className={cn(
            "rounded-2xl border p-4",
            balanced ? "border-success bg-success-bg" : "border-line bg-surface",
          )}
        >
          <div className="text-[11px] uppercase tracking-wide text-ink-faint">{t(locale, "Balance check")}</div>
          <div className={cn("text-[15px] font-bold mt-1 flex items-center gap-1", balanced ? "text-success" : "text-ink-muted")}>
            {balanced && <Check className="size-4" />} {balanced ? t(locale, "Balanced") : t(locale, "Not balanced")}
          </div>
        </div>
      </div>

      <div>
        <Button style={{ width: "auto" }} disabled={!canPost || pending} onClick={submit}>
          {pending ? t(locale, "Saving…") : t(locale, "Post entry")}
        </Button>
      </div>
    </div>
  );
}
