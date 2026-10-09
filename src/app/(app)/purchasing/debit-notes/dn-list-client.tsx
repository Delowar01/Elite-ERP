"use client";

import { useMemo } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import Link from "next/link";
import { Eye, Download } from "lucide-react";
import { toast } from "sonner";
import { downloadDocumentPdf } from "../../sales/_shared/download-pdf-button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmptyRow } from "@/components/ui/table";
import { StatRow } from "../../sales/_shared/stat-row";
import { ListWorkspaceToolbar } from "../../documents/_workspace/list-workspace-toolbar";
import { useListFilters } from "../../documents/_workspace/use-list-filters";
import type { SavedViewDTO } from "../../documents/_workspace/saved-view-actions";
import type { ImportColumn } from "@/lib/document-list-workspace";
import { RowMenu, type RowMenuEntry } from "../../sales/_shared/row-menu";
import { Money } from "../../sales/_shared/money";
import { t, type Locale } from "@/lib/i18n/dict";
import { statusStat } from "@/lib/status-registry";
import { useDocumentRowActions } from "../../_shared/document-row-actions";
import { useDocumentEditAction } from "../../_shared/edit-document";
import { ListEmptyState } from "../../sales/_shared/list-empty-state";


export type DnRow = {
  id: number;
  debitNoteNumber: string;
  title: string | null;
  vendorName: string;
  issueDate: string;
  total: string;
  status: string;
  creatorName: string;
  isArchived: boolean;
  sourcePoNumber: string;
  sourcePurchaseOrderId: number;
};

export function DnListClient({
  locale,
  rows,
  savedViews,
  importColumns,
  statusOptions,
  partyLabel,
  currentMonthKey,
}: {
  locale: Locale;
  rows: DnRow[];
  savedViews: SavedViewDTO[];
  importColumns: ImportColumn[];
  statusOptions: string[];
  partyLabel: string;
  /** The server's UTC month, "YYYY-MM" — what "This Month" means (docs/ui/pre-dev-ui-01-7/business-date-determinism.md). */
  currentMonthKey: string;
}) {
  const rowActions = useDocumentRowActions(locale);
  const { editEntry } = useDocumentEditAction(locale);

  const { filters, setFilters, filtered } = useListFilters(rows, {
    search: (r) => [r.debitNoteNumber, r.vendorName],
    status: (r) => r.status,
    party: (r) => r.vendorName,
    date: (r) => r.issueDate,
    archived: (r) => r.isArchived,
  });
  const partyOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.vendorName))).sort(), [rows]);

  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return counts;
  }, [rows]);

  // A calendar comparison of "YYYY-MM" text: neither the browser's clock nor its zone enters it, so
  // the hydrated count is the count the server rendered.
  const thisMonthCount = useMemo(() => rows.filter((r) => r.issueDate.slice(0, 7) === currentMonthKey).length, [rows, currentMonthKey]);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-[22px]">
        <h3 className="text-[19px] font-bold">{t(locale, "Debit Notes")}</h3>
      </div>

      <StatRow
        items={[
          { label: t(locale, "Total Debit Notes"), value: String(rows.length) },
          statusStat(locale, "debit_note", "issued", stats.issued),
          statusStat(locale, "debit_note", "draft", stats.draft),
          { label: t(locale, "This Month"), value: String(thisMonthCount) },
        ]}
      />

      <ListWorkspaceToolbar
        locale={locale}
        module="debit_note"
        searchPlaceholder={t(locale, "Search debit note number, vendor…")}
        createHref="/purchasing/debit-notes/new"
        createLabel={t(locale, "New Debit Note")}
        filters={filters}
        setFilters={setFilters}
        statusOptions={statusOptions}
        partyLabel={partyLabel}
        partyOptions={partyOptions}
        savedViews={savedViews}
        importColumns={importColumns}
      />

      {rows.length === 0 ? (
        <ListEmptyState locale={locale} message={t(locale, "No debit notes yet.")} hint={t(locale, "Open a received purchase order to issue one against it.")} createHref="/purchasing/debit-notes/new" createLabel={t(locale, "New Debit Note")} />
      ) : (
        <Table list>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "DN #")}</TableHead>
              <TableHead>{t(locale, "Title")}</TableHead>
              <TableHead>{t(locale, "Converted From")}</TableHead>
              <TableHead>{t(locale, "Vendor")}</TableHead>
              <TableHead>{t(locale, "Issue Date")}</TableHead>
              <TableHead numeric>{t(locale, "Amount")}</TableHead>
              <TableHead>{t(locale, "Created By")}</TableHead>
              <TableHead>{t(locale, "Status")}</TableHead>
              <TableHead action>{t(locale, "Actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableEmptyRow colSpan={9}>{t(locale, "No records match the current search or filters.")}</TableEmptyRow>
            )}
            {filtered.map((r) => {
              const entries: RowMenuEntry[] = [
                { kind: "item", icon: Eye, label: t(locale, "View"), href: `/purchasing/debit-notes/${r.id}` },
                ...editEntry("debit_note", r.id, r.debitNoteNumber, r.status, r.isArchived),
                { kind: "item", icon: Download, label: t(locale, "Download PDF"), onSelect: () => { void downloadDocumentPdf("debit-note", r.id).catch((e) => toast.error(e instanceof Error && e.message ? e.message : t(locale, "PDF download failed. Please try again."))); } },
                { kind: "separator" },
                ...rowActions("debit_note", r.id, r.status, r.isArchived, r.debitNoteNumber),
              ];
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-semibold">
                    <Link href={`/purchasing/debit-notes/${r.id}`} className="hover:text-brand-orange font-mono">
                      {r.debitNoteNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[150px] truncate" title={r.title ?? undefined}>
                    {r.title ?? <span className="text-ink-faint">—</span>}
                  </TableCell>
                  <TableCell className="text-ink-muted font-mono text-xs">
                    <Link href={`/purchasing/orders/${r.sourcePurchaseOrderId}`} className="hover:text-brand-orange">
                      {r.sourcePoNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{r.vendorName}</TableCell>
                  <TableCell className="num-tabular text-xs">{r.issueDate}</TableCell>
                  <TableCell numeric>
                    <Money amount={r.total} />
                  </TableCell>
                  <TableCell className="text-body-sm text-ink-muted">{r.creatorName}</TableCell>
                  <TableCell>
                    <StatusBadge domain="debit_note" status={r.status} locale={locale} />
                    {r.isArchived && (
                      <Badge variant="neutral" className="ms-1">
                        {t(locale, "Archived")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell action>
                    <RowMenu entries={entries} label={`${t(locale, "Actions for")} ${r.debitNoteNumber}`} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {rows.length > 0 && (
        <div className="text-caption text-ink-faint mt-2" role="status" aria-live="polite">
          {t(locale, "Showing")} {filtered.length} {t(locale, "of")} {rows.length} {t(locale, "Debit Notes")}.
        </div>
      )}
    </div>
  );
}
