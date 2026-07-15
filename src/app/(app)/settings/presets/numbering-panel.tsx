"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Settings, Check, X } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t, type Locale } from "@/lib/i18n/dict";
import type { DocumentSequence } from "@/db";
import { updateSequenceAction } from "./actions";

const DOC_TYPE_LABELS: Record<string, string> = {
  quotation: "Quotation",
  sales_order: "Sales Order",
  proforma_invoice: "Proforma Invoice",
  sales_invoice: "Invoice",
  delivery_challan: "Delivery Challan",
  credit_note: "Credit Note",
  purchase_order: "Purchase Order",
  debit_note: "Debit Note",
};

type Draft = { prefix: string; nextNumber: string; padding: string };

export function NumberingPanel({ locale, sequences }: { locale: Locale; sequences: DocumentSequence[] }) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>({ prefix: "", nextNumber: "", padding: "" });
  const [pending, startTransition] = useTransition();

  function startEdit(seq: DocumentSequence) {
    setEditingId(seq.id);
    setDraft({ prefix: seq.prefix, nextNumber: String(seq.nextNumber), padding: String(seq.padding) });
  }

  // A <form> can't be a direct child of <tr> (invalid table content model — browsers hoist it
  // out, breaking the row), so this edits via local state + a direct action call, not a form.
  function save(seq: DocumentSequence) {
    startTransition(async () => {
      const result = await updateSequenceAction(seq.id, draft.prefix, draft.nextNumber, draft.padding);
      if (result.error) toast.error(result.error);
      else {
        toast.success(t(locale, "Saved"));
        setEditingId(null);
      }
    });
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t(locale, "Document Type")}</TableHead>
          <TableHead>{t(locale, "Prefix")}</TableHead>
          <TableHead className="text-right">{t(locale, "Next Number")}</TableHead>
          <TableHead className="text-right">{t(locale, "Padding")}</TableHead>
          <TableHead className="w-24" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sequences.map((seq) => {
          const editing = editingId === seq.id;
          const preview = `${seq.prefix}${String(seq.nextNumber).padStart(seq.padding, "0")}`;
          return (
            <TableRow key={seq.id}>
              {editing ? (
                <>
                  <TableCell className="font-medium">{t(locale, DOC_TYPE_LABELS[seq.documentType] ?? seq.documentType)}</TableCell>
                  <TableCell>
                    <Input
                      value={draft.prefix}
                      onChange={(e) => setDraft((d) => ({ ...d, prefix: e.target.value }))}
                      className="h-8 font-mono w-24"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      value={draft.nextNumber}
                      onChange={(e) => setDraft((d) => ({ ...d, nextNumber: e.target.value }))}
                      className="h-8 font-mono w-24 ml-auto text-right"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      value={draft.padding}
                      onChange={(e) => setDraft((d) => ({ ...d, padding: e.target.value }))}
                      className="h-8 font-mono w-16 ml-auto text-right"
                    />
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button variant="ghost" size="icon" disabled={pending} onClick={() => save(seq)} aria-label={t(locale, "Save")}>
                      <Check className="size-3.5 text-success" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setEditingId(null)} aria-label={t(locale, "Cancel")}>
                      <X className="size-3.5" />
                    </Button>
                  </TableCell>
                </>
              ) : (
                <>
                  <TableCell className="font-medium">{t(locale, DOC_TYPE_LABELS[seq.documentType] ?? seq.documentType)}</TableCell>
                  <TableCell className="font-mono text-xs">{seq.prefix}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{String(seq.nextNumber).padStart(seq.padding, "0")}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{seq.padding}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <span className="text-ink-faint text-xs font-mono mr-2 hidden sm:inline">{preview}</span>
                    <Button variant="ghost" size="icon" onClick={() => startEdit(seq)} aria-label={t(locale, "Edit")}>
                      <Settings className="size-3.5" />
                    </Button>
                  </TableCell>
                </>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
