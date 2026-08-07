"use client";

import { useMemo, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { downloadDocumentPdf } from "../_shared/download-pdf-button";
import { Eye, Star, Copy, Download } from "lucide-react";
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
import { useDocumentEditAction } from "../../_shared/edit-document";
import { getConvertTargets, runConvertTarget } from "../_shared/convert-config";

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  confirmed: "info",
  fulfilled: "success",
  cancelled: "danger",
};

export type OrderRow = {
  id: number;
  soNumber: string;
  title: string | null;
  customerName: string;
  issueDate: string;
  expectedDate: string | null;
  total: string;
  status: string;
  creatorName: string;
  isArchived: boolean;
  sourceQuotationNumber: string | null;
};

export function OrdersListClient({
  locale,
  rows,
  savedViews,
  importColumns,
  statusOptions,
  partyLabel,
}: {
  locale: Locale;
  rows: OrderRow[];
  savedViews: SavedViewDTO[];
  importColumns: ImportColumn[];
  statusOptions: string[];
  partyLabel: string;
}) {
  const rowActions = useDocumentRowActions(locale);
  const { editEntry, dialog: editDialog } = useDocumentEditAction(locale);
  const [, startTransition] = useTransition();

  const { filters, setFilters, filtered } = useListFilters(rows, {
    search: (r) => [r.soNumber, r.customerName, r.title ?? ""],
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
        <h3 className="text-[19px] font-bold">{t(locale, "Sales Orders")}</h3>
      </div>

      <StatRow
        items={[
          { label: t(locale, "Total Sales Orders"), value: String(rows.length) },
          { label: t(locale, "confirmed"), value: String(stats.confirmed ?? 0), colorClass: "text-info" },
          { label: t(locale, "fulfilled"), value: String(stats.fulfilled ?? 0), colorClass: "text-success" },
          { label: t(locale, "draft"), value: String(stats.draft ?? 0) },
        ]}
      />

      <ListWorkspaceToolbar
        locale={locale}
        module="sales_order"
        searchPlaceholder={t(locale, "Search order number, client…")}
        createHref="/sales/orders/new"
        createLabel={t(locale, "New Sales Order")}
        filters={filters}
        setFilters={setFilters}
        statusOptions={statusOptions}
        partyLabel={partyLabel}
        partyOptions={partyOptions}
        savedViews={savedViews}
        importColumns={importColumns}
      />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t(locale, "SO #")}</TableHead>
            <TableHead>{t(locale, "Title")}</TableHead>
            <TableHead>{t(locale, "Converted From")}</TableHead>
            <TableHead>{t(locale, "Client")}</TableHead>
            <TableHead>{t(locale, "Order Date")}</TableHead>
            <TableHead>{t(locale, "Expected Delivery")}</TableHead>
            <TableHead className="text-right">{t(locale, "Amount")}</TableHead>
            <TableHead>{t(locale, "Created By")}</TableHead>
            <TableHead>{t(locale, "Status")}</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((r) => {
            const convertTargets = getConvertTargets("sales_order", { status: r.status });
            const entries: RowMenuEntry[] = [
              { kind: "item", icon: Eye, label: t(locale, "View"), href: `/sales/orders/${r.id}` },
              ...editEntry("sales_order", r.id, r.soNumber, r.status, r.isArchived),
              { kind: "item", icon: Star, label: t(locale, "Add to Favorites") },
              { kind: "item", icon: Download, label: t(locale, "Download PDF"), onSelect: () => { void downloadDocumentPdf("sales-order", r.id).catch((e) => toast.error(e instanceof Error && e.message ? e.message : t(locale, "PDF download failed. Please try again."))); } },
              ...(convertTargets.length
                ? [{
                    kind: "convert" as const,
                    label: t(locale, "Convert to…"),
                    targets: convertTargets.map((tgt) => ({
                      label: t(locale, tgt.labelKey),
                      icon: tgt.icon,
                      onSelect: () => runConvertTarget(tgt, r.id, startTransition, (m: string) => toast.error(m)),
                    })),
                  }]
                : []),
              { kind: "item", icon: Copy, label: t(locale, "Duplicate") },
              { kind: "separator" },
              ...rowActions("sales_order", r.id, r.status, r.isArchived),
            ];
            return (
              <TableRow key={r.id}>
                <TableCell className="font-semibold">
                  <Link href={`/sales/orders/${r.id}`} className="hover:text-brand-orange font-mono">
                    {r.soNumber}
                  </Link>
                </TableCell>
                <TableCell className="max-w-[150px] truncate" title={r.title ?? undefined}>
                  {r.title ?? <span className="text-ink-faint">—</span>}
                </TableCell>
                <TableCell className="text-ink-muted font-mono text-xs">{r.sourceQuotationNumber ?? "—"}</TableCell>
                <TableCell>{r.customerName}</TableCell>
                <TableCell className="font-mono text-xs">{r.issueDate}</TableCell>
                <TableCell className="font-mono text-xs">{r.expectedDate ?? <span className="text-ink-faint">—</span>}</TableCell>
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
      <div className="text-[11.5px] text-ink-faint mt-2">
        {t(locale, "Showing")} {filtered.length} {t(locale, "of")} {rows.length} {t(locale, "Sales Orders")}.
      </div>
      {editDialog}
    </div>
  );
}
