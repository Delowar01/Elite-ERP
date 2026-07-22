"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Eye, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatRow } from "../_shared/stat-row";
import { ListWorkspaceToolbar } from "../../documents/_workspace/list-workspace-toolbar";
import { useListFilters } from "../../documents/_workspace/use-list-filters";
import type { SavedViewDTO } from "../../documents/_workspace/saved-view-actions";
import type { ImportColumn } from "@/lib/document-list-workspace";
import { RowMenu, type RowMenuEntry } from "../_shared/row-menu";
import { Money } from "../_shared/money";
import { t, type Locale } from "@/lib/i18n/dict";
import { useDocumentRowActions } from "../../_shared/document-row-actions";

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  issued: "success",
};

export type CnRow = {
  id: number;
  creditNoteNumber: string;
  title: string | null;
  customerName: string;
  issueDate: string;
  total: string;
  status: string;
  creatorName: string;
  isArchived: boolean;
  sourceInvoiceNumber: string;
  sourceInvoiceId: number;
};

export function CnListClient({
  locale,
  rows,
  savedViews,
  importColumns,
  statusOptions,
  partyLabel,
}: {
  locale: Locale;
  rows: CnRow[];
  savedViews: SavedViewDTO[];
  importColumns: ImportColumn[];
  statusOptions: string[];
  partyLabel: string;
}) {
  const rowActions = useDocumentRowActions(locale);

  const { filters, setFilters, filtered } = useListFilters(rows, {
    search: (r) => [r.creditNoteNumber, r.customerName],
    status: (r) => r.status,
    party: (r) => r.customerName,
    date: (r) => r.issueDate,
    archived: (r) => r.isArchived,
  });
  const partyOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.customerName))).sort(), [rows]);

  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return counts;
  }, [rows]);

  const thisMonthCount = useMemo(() => {
    const now = new Date();
    return rows.filter((r) => {
      const d = new Date(r.issueDate);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;
  }, [rows]);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-[22px]">
        <h3 className="text-[19px] font-bold">{t(locale, "Credit Notes")}</h3>
      </div>

      <StatRow
        items={[
          { label: t(locale, "Total Credit Notes"), value: String(rows.length) },
          { label: t(locale, "issued"), value: String(stats.issued ?? 0), colorClass: "text-success" },
          { label: t(locale, "draft"), value: String(stats.draft ?? 0) },
          { label: t(locale, "This Month"), value: String(thisMonthCount) },
        ]}
      />

      <ListWorkspaceToolbar
        locale={locale}
        module="credit_note"
        searchPlaceholder={t(locale, "Search credit note number, client…")}
        createHref="/sales/credit-notes/new"
        createLabel={t(locale, "New Credit Note")}
        filters={filters}
        setFilters={setFilters}
        statusOptions={statusOptions}
        partyLabel={partyLabel}
        partyOptions={partyOptions}
        savedViews={savedViews}
        importColumns={importColumns}
      />

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface shadow-elevated py-12 text-center text-ink-muted text-sm">
          {t(locale, "No credit notes yet. Open a sent invoice to issue one against it.")}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "CN #")}</TableHead>
              <TableHead>{t(locale, "Title")}</TableHead>
              <TableHead>{t(locale, "Converted From")}</TableHead>
              <TableHead>{t(locale, "Client")}</TableHead>
              <TableHead>{t(locale, "Issue Date")}</TableHead>
              <TableHead className="text-right">{t(locale, "Amount")}</TableHead>
              <TableHead>{t(locale, "Created By")}</TableHead>
              <TableHead>{t(locale, "Status")}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => {
              const entries: RowMenuEntry[] = [
                { kind: "item", icon: Eye, label: t(locale, "View"), href: `/sales/credit-notes/${r.id}` },
                { kind: "item", icon: Printer, label: t(locale, "Print"), href: `/print/credit-note/${r.id}` },
                { kind: "separator" },
                ...rowActions("credit_note", r.id, r.status, r.isArchived),
              ];
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-semibold">
                    <Link href={`/sales/credit-notes/${r.id}`} className="hover:text-brand-orange font-mono">
                      {r.creditNoteNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[150px] truncate" title={r.title ?? undefined}>
                    {r.title ?? <span className="text-ink-faint">—</span>}
                  </TableCell>
                  <TableCell className="text-ink-muted font-mono text-xs">
                    <Link href={`/sales/invoices/${r.sourceInvoiceId}`} className="hover:text-brand-orange">
                      {r.sourceInvoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{r.customerName}</TableCell>
                  <TableCell className="font-mono text-xs">{r.issueDate}</TableCell>
                  <TableCell className="text-right font-mono">
                    <Money amount={r.total} />
                  </TableCell>
                  <TableCell className="text-[12.5px] text-ink-muted">{r.creatorName}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status] ?? "neutral"}>{t(locale, r.status)}</Badge>
                    {r.isArchived && (
                      <Badge variant="neutral" className="ms-1">
                        {t(locale, "Archived")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <RowMenu entries={entries} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {rows.length > 0 && (
        <div className="text-[11.5px] text-ink-faint mt-2">
          {t(locale, "Showing")} {filtered.length} {t(locale, "of")} {rows.length} {t(locale, "Credit Notes")}.
        </div>
      )}
    </div>
  );
}
