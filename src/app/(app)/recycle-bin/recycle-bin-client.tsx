"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Trash2, RotateCcw, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { t, type Locale } from "@/lib/i18n/dict";
import type { DocumentType } from "@/lib/document-lifecycle";
import { restoreDocumentAction, permanentDeleteDocumentAction } from "../_shared/lifecycle-actions";

export type BinRow = {
  docType: DocumentType;
  id: number;
  number: string;
  status: string;
  partyName: string;
  typeLabel: string;
  detailHref: string;
  deletedAt: string;
  canPermanentDelete: boolean;
};

export function RecycleBinClient({ locale, rows, isOwner }: { locale: Locale; rows: BinRow[]; isOwner: boolean }) {
  const [search, setSearch] = useState("");
  const [pending, startTransition] = useTransition();
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.number.toLowerCase().includes(q) || r.partyName.toLowerCase().includes(q) || t(locale, r.typeLabel).toLowerCase().includes(q));
  }, [rows, search, locale]);

  function restore(r: BinRow) {
    startTransition(async () => {
      const result = await restoreDocumentAction(r.docType, r.id);
      if (result?.error) toast.error(result.error);
      else toast.success(t(locale, "Document restored."));
    });
  }

  function permanentDelete(r: BinRow) {
    startTransition(async () => {
      const result = await permanentDeleteDocumentAction(r.docType, r.id);
      if (result?.error) toast.error(result.error);
      else toast.success(t(locale, "Document permanently deleted."));
      setConfirmKey(null);
    });
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="main-head flex items-center justify-between mb-[22px]">
        <h3 className="text-[19px] font-bold flex items-center gap-2">
          <Trash2 className="size-5" style={{ color: "var(--brand-orange)" }} /> {t(locale, "Recycle Bin")}
        </h3>
      </div>

      <p className="text-[12.5px] text-ink-muted mb-4 flex items-center gap-1.5">
        <ShieldAlert className="size-3.5 shrink-0" />
        {t(locale, "Deleted documents are kept here. Restore returns them to their list. Permanent delete is owner-only and irreversible; the document number is retained in the audit log and never reissued.")}
      </p>

      <div className="topbar-search max-w-sm mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t(locale, "Search number, party, type…")}
          className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-ink-faint"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface shadow-elevated py-12 text-center text-ink-muted text-sm">
          {t(locale, "The Recycle Bin is empty.")}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Type")}</TableHead>
              <TableHead>{t(locale, "Number")}</TableHead>
              <TableHead>{t(locale, "Party")}</TableHead>
              <TableHead>{t(locale, "Status")}</TableHead>
              <TableHead>{t(locale, "Deleted")}</TableHead>
              <TableHead className="text-right">{t(locale, "Actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => {
              const key = `${r.docType}:${r.id}`;
              return (
                <TableRow key={key}>
                  <TableCell className="text-[12.5px] text-ink-muted">{t(locale, r.typeLabel)}</TableCell>
                  <TableCell className="font-semibold">
                    <Link href={r.detailHref} className="hover:text-brand-orange font-mono">
                      {r.number}
                    </Link>
                  </TableCell>
                  <TableCell>{r.partyName}</TableCell>
                  <TableCell>
                    <Badge variant="neutral">{t(locale, r.status)}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.deletedAt || "—"}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="glass" style={{ width: "auto" }} disabled={pending} onClick={() => restore(r)}>
                        <RotateCcw className="size-3.5" /> {t(locale, "Restore")}
                      </Button>
                      {isOwner &&
                        r.canPermanentDelete &&
                        (confirmKey === key ? (
                          <>
                            <Button variant="destructive" style={{ width: "auto" }} disabled={pending} onClick={() => permanentDelete(r)}>
                              {t(locale, "Confirm")}
                            </Button>
                            <Button variant="ghost" style={{ width: "auto" }} disabled={pending} onClick={() => setConfirmKey(null)}>
                              {t(locale, "Cancel")}
                            </Button>
                          </>
                        ) : (
                          <Button variant="ghost" style={{ width: "auto" }} disabled={pending} onClick={() => setConfirmKey(key)} className="text-danger">
                            <Trash2 className="size-3.5" /> {t(locale, "Permanent Delete")}
                          </Button>
                        ))}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
