"use client";

import { useMemo, useState, useTransition } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import Link from "next/link";
import { toast } from "sonner";
import { Trash2, RotateCcw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmptyRow } from "@/components/ui/table";
import { ListSearch } from "@/components/ui/list-search";
import { t, type Locale } from "@/lib/i18n/dict";
import type { DocumentType } from "@/lib/document-lifecycle";
import { restoreDocumentAction, permanentDeleteDocumentAction } from "../_shared/lifecycle-actions";
import { useConfirm } from "../_shared/confirm-provider";

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
  const confirm = useConfirm();

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

  // The single most destructive action in the app — owner-only, draft-only, and gone for good.
  function permanentDelete(r: BinRow) {
    confirm({
      action: "document.permanentDelete",
      entityType: r.typeLabel,
      entityNumber: r.number,
      details: [{ label: "Party", value: r.partyName }],
      onConfirm: () =>
        new Promise<{ error?: string } | void>((resolve) => {
          startTransition(async () => {
            const result = await permanentDeleteDocumentAction(r.docType, r.id);
            if (result?.error) {
              resolve({ error: result.error });
              return;
            }
            toast.success(t(locale, "Document permanently deleted."));
            resolve();
          });
        }),
    });
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="main-head flex items-center justify-between mb-[22px]">
        <h3 className="text-[19px] font-bold flex items-center gap-2">
          <Trash2 className="size-5" style={{ color: "var(--brand-orange)" }} /> {t(locale, "Recycle Bin")}
        </h3>
      </div>

      <p className="text-body-sm text-ink-muted mb-4 flex items-center gap-1.5">
        <ShieldAlert className="size-3.5 shrink-0" />
        {t(locale, "Deleted documents are kept here. Restore returns them to their list. Permanent delete is owner-only and irreversible; the document number is retained in the audit log and never reissued.")}
      </p>

      <div className="mb-4">
        <ListSearch
          value={search}
          onChange={setSearch}
          placeholder={t(locale, "Search number, party, type…")}
          label={t(locale, "Search number, party, type…")}
          clearLabel={t(locale, "Clear search")}
        />
      </div>

      {/* An empty bin and "nothing matches the search" are different states (DEV-UI-01.5). */}
      {rows.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface py-12 text-center text-body text-ink-muted" data-list-empty="">
          {t(locale, "The Recycle Bin is empty.")}
        </div>
      ) : (
        <Table list>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Type")}</TableHead>
              <TableHead>{t(locale, "Number")}</TableHead>
              <TableHead>{t(locale, "Party")}</TableHead>
              <TableHead>{t(locale, "Status")}</TableHead>
              <TableHead>{t(locale, "Deleted")}</TableHead>
              <TableHead action>{t(locale, "Actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableEmptyRow colSpan={6}>{t(locale, "No records match the current search or filters.")}</TableEmptyRow>
            )}
            {filtered.map((r) => {
              const key = `${r.docType}:${r.id}`;
              return (
                <TableRow key={key}>
                  <TableCell className="text-body-sm text-ink-muted">{t(locale, r.typeLabel)}</TableCell>
                  <TableCell className="font-semibold">
                    <Link href={r.detailHref} className="hover:text-brand-orange font-mono">
                      {r.number}
                    </Link>
                  </TableCell>
                  <TableCell>{r.partyName}</TableCell>
                  <TableCell>
                    <StatusBadge domain={r.docType} status={r.status} locale={locale} />
                  </TableCell>
                  <TableCell className="num-tabular text-xs">{r.deletedAt || "—"}</TableCell>
                  <TableCell action>
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="glass" disabled={pending} onClick={() => restore(r)}>
                        <RotateCcw className="size-3.5" /> {t(locale, "Restore")}
                      </Button>
                      {isOwner && r.canPermanentDelete && (
                        <Button variant="destructive-ghost" disabled={pending} onClick={() => permanentDelete(r)}>
                          <Trash2 className="size-3.5" /> {t(locale, "Permanent Delete")}
                        </Button>
                      )}
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
