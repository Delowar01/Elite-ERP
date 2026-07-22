"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Eye, Star, Pencil, Printer, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatRow } from "../../sales/_shared/stat-row";
import { ListWorkspaceToolbar } from "../../documents/_workspace/list-workspace-toolbar";
import { useListFilters } from "../../documents/_workspace/use-list-filters";
import type { SavedViewDTO } from "../../documents/_workspace/saved-view-actions";
import type { ImportColumn } from "@/lib/document-list-workspace";
import { RowMenu, type RowMenuEntry } from "../../sales/_shared/row-menu";
import { Money } from "../../sales/_shared/money";
import { t, type Locale } from "@/lib/i18n/dict";
import { useDocumentRowActions } from "../../_shared/document-row-actions";
import { can } from "@/lib/document-lifecycle";

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  ordered: "info",
  received: "success",
  cancelled: "danger",
};

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
          { label: t(locale, "received"), value: String(stats.received ?? 0), colorClass: "text-success" },
          { label: t(locale, "ordered"), value: String(stats.ordered ?? 0), colorClass: "text-info" },
          { label: t(locale, "draft"), value: String(stats.draft ?? 0) },
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
        <div className="rounded-2xl border border-line bg-surface shadow-elevated py-12 text-center text-ink-muted text-sm">
          {t(locale, "No purchase orders yet.")}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "PO #")}</TableHead>
              <TableHead>{t(locale, "Title")}</TableHead>
              <TableHead>{t(locale, "Converted From")}</TableHead>
              <TableHead>{t(locale, "Vendor")}</TableHead>
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
              const entries: RowMenuEntry[] = [
                { kind: "item", icon: Eye, label: t(locale, "View"), href: `/purchasing/orders/${r.id}` },
                { kind: "item", icon: Star, label: t(locale, "Add to Favorites") },
                { kind: "item", icon: Pencil, label: t(locale, "Edit"), href: can("purchase_order", r.status, "edit") ? `/purchasing/orders/${r.id}/edit` : undefined },
                { kind: "item", icon: Printer, label: t(locale, "Print / Download PDF"), href: `/print/purchase-order/${r.id}` },
                {
                  kind: "item",
                  icon: RefreshCw,
                  label: t(locale, "Create Debit Note"),
                  href: r.status === "received" ? `/purchasing/debit-notes/new?po=${r.id}` : undefined,
                },
                { kind: "separator" },
                ...rowActions("purchase_order", r.id, r.status, r.isArchived),
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
                  <TableCell className="font-mono text-xs">{r.orderDate}</TableCell>
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
      )}
      {rows.length > 0 && (
        <div className="text-[11.5px] text-ink-faint mt-2">
          {t(locale, "Showing")} {filtered.length} {t(locale, "of")} {rows.length} {t(locale, "Purchase Orders")}.
        </div>
      )}
    </div>
  );
}
