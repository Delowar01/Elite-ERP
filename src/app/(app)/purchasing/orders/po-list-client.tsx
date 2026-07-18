"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Eye, Printer, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatRow } from "../../sales/_shared/stat-row";
import { ListToolbar } from "../../sales/_shared/list-toolbar";
import { RowMenu, type RowMenuEntry } from "../../sales/_shared/row-menu";
import { Money } from "../../sales/_shared/money";
import { t, type Locale } from "@/lib/i18n/dict";

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
};

export function PoListClient({ locale, rows }: { locale: Locale; rows: PoRow[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.poNumber.toLowerCase().includes(q) || r.vendorName.toLowerCase().includes(q) || (r.title ?? "").toLowerCase().includes(q));
  }, [rows, search]);

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

      <ListToolbar
        locale={locale}
        searchPlaceholder={t(locale, "Search PO number, vendor…")}
        searchValue={search}
        onSearchChange={setSearch}
        createHref="/purchasing/orders/new"
        createLabel={t(locale, "New Purchase Order")}
      />

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface shadow-elevated py-12 text-center text-ink-muted text-sm">
          {t(locale, "No purchase orders yet.")}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Number")}</TableHead>
              <TableHead>{t(locale, "Title")}</TableHead>
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
                { kind: "item", icon: Printer, label: t(locale, "Print / Download PDF"), href: `/print/purchase-order/${r.id}` },
                { kind: "separator" },
                { kind: "item", icon: Trash2, label: t(locale, "Delete"), danger: true },
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
                  <TableCell>{r.vendorName}</TableCell>
                  <TableCell className="font-mono text-xs">{r.orderDate}</TableCell>
                  <TableCell className="font-mono text-xs">{r.expectedDate ?? <span className="text-ink-faint">—</span>}</TableCell>
                  <TableCell className="text-right font-mono">
                    <Money amount={r.total} />
                  </TableCell>
                  <TableCell className="text-[12.5px] text-ink-muted">{r.creatorName}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status] ?? "neutral"}>{t(locale, r.status)}</Badge>
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
