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
import { getConvertTargets } from "../../sales/_shared/convert-config";
import { useConvertConfirm } from "../../_shared/confirm-actions";
import { ListEmptyState } from "../../sales/_shared/list-empty-state";


export type PoRow = {
  id: number;
  poNumber: string;
  title: string | null;
  vendorName: string;
  orderDate: string;
  expectedDate: string | null;
  total: string;
  status: string;
  creatorName: string;
  isArchived: boolean;
};

export function PoListClient({
  locale,
  rows,
  savedViews,
  importColumns,
  statusOptions,
  partyLabel,
}: {
  locale: Locale;
  rows: PoRow[];
  savedViews: SavedViewDTO[];
  importColumns: ImportColumn[];
  statusOptions: string[];
  partyLabel: string;
}) {
  const rowActions = useDocumentRowActions(locale);
  const { editEntry } = useDocumentEditAction(locale);
  const { requestConvert } = useConvertConfirm(locale);

  const { filters, setFilters, filtered } = useListFilters(rows, {
    search: (r) => [r.poNumber, r.vendorName, r.title ?? ""],
    status: (r) => r.status,
    party: (r) => r.vendorName,
    date: (r) => r.orderDate,
    archived: (r) => r.isArchived,
  });
  const partyOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.vendorName))).sort(), [rows]);

  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return counts;
  }, [rows]);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-[22px]">
        <h3 className="text-[19px] font-bold">{t(locale, "Purchase Orders")}</h3>
      </div>

      <StatRow
        items={[
          { label: t(locale, "Total POs"), value: String(rows.length) },
          statusStat(locale, "purchase_order", "received", stats.received),
          statusStat(locale, "purchase_order", "ordered", stats.ordered),
          statusStat(locale, "purchase_order", "draft", stats.draft),
        ]}
      />

      <ListWorkspaceToolbar
        locale={locale}
        module="purchase_order"
        searchPlaceholder={t(locale, "Search PO number, vendor…")}
        createHref="/purchasing/orders/new"
        createLabel={t(locale, "New Purchase Order")}
        filters={filters}
        setFilters={setFilters}
        statusOptions={statusOptions}
        partyLabel={partyLabel}
        partyOptions={partyOptions}
        savedViews={savedViews}
        importColumns={importColumns}
      />

      {rows.length === 0 ? (
        <ListEmptyState locale={locale} message={t(locale, "No purchase orders yet.")} createHref="/purchasing/orders/new" createLabel={t(locale, "New Purchase Order")} />
      ) : (
        <Table list>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "PO #")}</TableHead>
              <TableHead>{t(locale, "Title")}</TableHead>
              <TableHead>{t(locale, "Converted From")}</TableHead>
              <TableHead>{t(locale, "Vendor")}</TableHead>
              <TableHead>{t(locale, "Order Date")}</TableHead>
              <TableHead>{t(locale, "Expected Delivery")}</TableHead>
              <TableHead numeric>{t(locale, "Amount")}</TableHead>
              <TableHead>{t(locale, "Created By")}</TableHead>
              <TableHead>{t(locale, "Status")}</TableHead>
              <TableHead action>{t(locale, "Actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableEmptyRow colSpan={10}>{t(locale, "No records match the current search or filters.")}</TableEmptyRow>
            )}
            {filtered.map((r) => {
              const convertTargets = getConvertTargets("purchase_order", { status: r.status });
              const entries: RowMenuEntry[] = [
                { kind: "item", icon: Eye, label: t(locale, "View"), href: `/purchasing/orders/${r.id}` },
                ...editEntry("purchase_order", r.id, r.poNumber, r.status, r.isArchived),
                { kind: "item", icon: Download, label: t(locale, "Download PDF"), onSelect: () => { void downloadDocumentPdf("purchase-order", r.id).catch((e) => toast.error(e instanceof Error && e.message ? e.message : t(locale, "PDF download failed. Please try again."))); } },
                ...(convertTargets.length
                  ? [{
                      kind: "convert" as const,
                      label: t(locale, "Convert to…"),
                      targets: convertTargets.map((tgt) => ({
                        label: t(locale, tgt.labelKey),
                        icon: tgt.icon,
                        onSelect: () => requestConvert(tgt, r.id, "Purchase Order", r.poNumber),
                      })),
                    }]
                  : []),
                { kind: "separator" },
                ...rowActions("purchase_order", r.id, r.status, r.isArchived, r.poNumber),
              ];
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-semibold">
                    <Link href={`/purchasing/orders/${r.id}`} className="hover:text-brand-orange font-mono">
                      {r.poNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[150px] truncate" title={r.title ?? undefined}>
                    {r.title ?? <span className="text-ink-faint">—</span>}
                  </TableCell>
                  <TableCell className="text-ink-faint font-mono text-xs">—</TableCell>
                  <TableCell>{r.vendorName}</TableCell>
                  <TableCell className="num-tabular text-xs">{r.orderDate}</TableCell>
                  <TableCell className="num-tabular text-xs">{r.expectedDate ?? <span className="text-ink-faint">—</span>}</TableCell>
                  <TableCell numeric>
                    <Money amount={r.total} />
                  </TableCell>
                  <TableCell className="text-body-sm text-ink-muted">{r.creatorName}</TableCell>
                  <TableCell>
                    <StatusBadge domain="purchase_order" status={r.status} locale={locale} />
                    {r.isArchived && (
                      <Badge variant="neutral" className="ms-1">
                        {t(locale, "Archived")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell action>
                    <RowMenu entries={entries} label={`${t(locale, "Actions for")} ${r.poNumber}`} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {rows.length > 0 && (
        <div className="text-caption text-ink-faint mt-2" role="status" aria-live="polite">
          {t(locale, "Showing")} {filtered.length} {t(locale, "of")} {rows.length} {t(locale, "Purchase Orders")}.
        </div>
      )}
    </div>
  );
}
