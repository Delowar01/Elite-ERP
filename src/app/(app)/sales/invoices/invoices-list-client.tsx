"use client";

import { useMemo } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import Link from "next/link";
import { toast } from "sonner";
import { downloadDocumentPdf } from "../_shared/download-pdf-button";
import { Eye, Wallet, Send, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmptyRow } from "@/components/ui/table";
import { StatRow } from "../_shared/stat-row";
import { ListWorkspaceToolbar } from "../../documents/_workspace/list-workspace-toolbar";
import { useListFilters } from "../../documents/_workspace/use-list-filters";
import type { SavedViewDTO } from "../../documents/_workspace/saved-view-actions";
import type { ImportColumn } from "@/lib/document-list-workspace";
import { RowMenu, type RowMenuEntry } from "../_shared/row-menu";
import { Money } from "../_shared/money";
import { t, type Locale } from "@/lib/i18n/dict";
import { statusStat } from "@/lib/status-registry";
import { useDocumentRowActions } from "../../_shared/document-row-actions";
import { useDocumentEditAction } from "../../_shared/edit-document";
import { getConvertTargets } from "../_shared/convert-config";
import { useConvertConfirm } from "../../_shared/confirm-actions";
import { ListEmptyState } from "../_shared/list-empty-state";


export type InvoiceRow = {
  id: number;
  invoiceNumber: string;
  title: string | null;
  customerName: string;
  issueDate: string;
  total: string;
  status: string;
  creatorName: string;
  isArchived: boolean;
  sourceSoNumber: string | null;
};

export function InvoicesListClient({
  locale,
  rows,
  savedViews,
  importColumns,
  statusOptions,
  partyLabel,
}: {
  locale: Locale;
  rows: InvoiceRow[];
  savedViews: SavedViewDTO[];
  importColumns: ImportColumn[];
  statusOptions: string[];
  partyLabel: string;
}) {
  const rowActions = useDocumentRowActions(locale);
  const { editEntry } = useDocumentEditAction(locale);
  const { requestConvert } = useConvertConfirm(locale);


  const { filters, setFilters, filtered } = useListFilters(rows, {
    search: (r) => [r.invoiceNumber, r.customerName, r.title ?? ""],
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

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-[22px]">
        <h3 className="text-[19px] font-bold">{t(locale, "Invoices")}</h3>
      </div>

      <StatRow
        items={[
          { label: t(locale, "Total Invoices"), value: String(rows.length) },
          statusStat(locale, "sales_invoice", "paid", stats.paid),
          statusStat(locale, "sales_invoice", "sent", stats.sent),
          statusStat(locale, "sales_invoice", "draft", stats.draft),
        ]}
      />

      <ListWorkspaceToolbar
        locale={locale}
        module="sales_invoice"
        searchPlaceholder={t(locale, "Search invoice number, client…")}
        createHref="/sales/invoices/new"
        createLabel={t(locale, "New Invoice")}
        filters={filters}
        setFilters={setFilters}
        statusOptions={statusOptions}
        partyLabel={partyLabel}
        partyOptions={partyOptions}
        savedViews={savedViews}
        importColumns={importColumns}
      />

      {rows.length === 0 ? (
        <ListEmptyState locale={locale} message={t(locale, "No invoices yet.")} createHref="/sales/invoices/new" createLabel={t(locale, "New Invoice")} />
      ) : (
        <Table list>
        <TableHeader>
          <TableRow>
            <TableHead>{t(locale, "Invoice #")}</TableHead>
            <TableHead>{t(locale, "Title")}</TableHead>
            <TableHead>{t(locale, "Converted From")}</TableHead>
            <TableHead>{t(locale, "Client")}</TableHead>
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
            const convertTargets = getConvertTargets("invoice", { status: r.status });
            const entries: RowMenuEntry[] = [
              { kind: "item", icon: Eye, label: t(locale, "View"), href: `/sales/invoices/${r.id}` },
              ...editEntry("sales_invoice", r.id, r.invoiceNumber, r.status, r.isArchived),
              { kind: "item", icon: Download, label: t(locale, "Download PDF"), onSelect: () => { void downloadDocumentPdf("invoice", r.id).catch((e) => toast.error(e instanceof Error && e.message ? e.message : t(locale, "PDF download failed. Please try again."))); } },
              { kind: "item", icon: Wallet, label: t(locale, "Record Payment") },
              ...(convertTargets.length
                ? [{
                    kind: "convert" as const,
                    label: t(locale, "Convert to…"),
                    targets: convertTargets.map((tgt) => ({
                      label: t(locale, tgt.labelKey),
                      icon: tgt.icon,
                      onSelect: () => requestConvert(tgt, r.id, "Invoice", r.invoiceNumber),
                    })),
                  }]
                : []),
              { kind: "item", icon: Send, label: t(locale, "Send Reminder") },
              { kind: "separator" },
              ...rowActions("sales_invoice", r.id, r.status, r.isArchived, r.invoiceNumber),
            ];
            return (
              <TableRow key={r.id}>
                <TableCell className="font-semibold">
                  <Link href={`/sales/invoices/${r.id}`} className="hover:text-brand-orange font-mono">
                    {r.invoiceNumber}
                  </Link>
                </TableCell>
                <TableCell className="max-w-[150px] truncate" title={r.title ?? undefined}>
                  {r.title ?? <span className="text-ink-faint">—</span>}
                </TableCell>
                <TableCell className="text-ink-muted font-mono text-xs">{r.sourceSoNumber ?? "—"}</TableCell>
                <TableCell>{r.customerName}</TableCell>
                <TableCell className="num-tabular text-xs">{r.issueDate}</TableCell>
                <TableCell numeric>
                  <Money amount={r.total} />
                </TableCell>
                <TableCell className="text-body-sm text-ink-muted">{r.creatorName}</TableCell>
                <TableCell>
                  <StatusBadge domain="sales_invoice" status={r.status} locale={locale} />
                  {r.isArchived && (
                    <Badge variant="neutral" className="ms-1">
                      {t(locale, "Archived")}
                    </Badge>
                  )}
                </TableCell>
                <TableCell action>
                  <RowMenu entries={entries} label={`${t(locale, "Actions for")} ${r.invoiceNumber}`} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      )}
      <div className="text-caption text-ink-faint mt-2" role="status" aria-live="polite">
        {t(locale, "Showing")} {filtered.length} {t(locale, "of")} {rows.length} {t(locale, "Invoices")}.
      </div>
    </div>
  );
}
