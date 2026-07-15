"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Eye, Printer, Truck as TruckIcon, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatRow } from "../_shared/stat-row";
import { ListToolbar } from "../_shared/list-toolbar";
import { RowMenu, type RowMenuEntry } from "../_shared/row-menu";
import { t, type Locale } from "@/lib/i18n/dict";

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  dispatched: "warning",
  delivered: "success",
};

export type DcRow = {
  id: number;
  dcNumber: string;
  title: string | null;
  customerName: string;
  dispatchDate: string | null;
  status: string;
  creatorName: string;
  sourceLabel: string | null;
};

export function DcListClient({ locale, rows }: { locale: Locale; rows: DcRow[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.dcNumber.toLowerCase().includes(q) || r.customerName.toLowerCase().includes(q) || (r.title ?? "").toLowerCase().includes(q));
  }, [rows, search]);

  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return counts;
  }, [rows]);

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-[22px]">
        <h3 className="text-[19px] font-bold">{t(locale, "Delivery Challans")}</h3>
      </div>

      <StatRow
        items={[
          { label: t(locale, "Total Challans"), value: String(rows.length) },
          { label: t(locale, "delivered"), value: String(stats.delivered ?? 0), colorClass: "text-success" },
          { label: t(locale, "dispatched"), value: String(stats.dispatched ?? 0), colorClass: "text-warning" },
          { label: t(locale, "draft"), value: String(stats.draft ?? 0) },
        ]}
      />

      <ListToolbar
        locale={locale}
        searchPlaceholder={t(locale, "Search DC number, client…")}
        searchValue={search}
        onSearchChange={setSearch}
        createHref="/sales/delivery-challans/new"
        createLabel={t(locale, "New Delivery Challan")}
      />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t(locale, "Number")}</TableHead>
            <TableHead>{t(locale, "Title")}</TableHead>
            <TableHead>{t(locale, "Converted From")}</TableHead>
            <TableHead>{t(locale, "Client")}</TableHead>
            <TableHead>{t(locale, "Dispatch Date")}</TableHead>
            <TableHead>{t(locale, "Created By")}</TableHead>
            <TableHead>{t(locale, "Status")}</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((r) => {
            const entries: RowMenuEntry[] = [
              { kind: "item", icon: Eye, label: t(locale, "View"), href: `/sales/delivery-challans/${r.id}` },
              { kind: "item", icon: Printer, label: t(locale, "Print") },
              { kind: "item", icon: TruckIcon, label: t(locale, "Mark Delivered") },
              { kind: "separator" },
              { kind: "item", icon: Trash2, label: t(locale, "Delete"), danger: true },
            ];
            return (
              <TableRow key={r.id}>
                <TableCell className="font-semibold">
                  <Link href={`/sales/delivery-challans/${r.id}`} className="hover:text-brand-orange font-mono">
                    {r.dcNumber}
                  </Link>
                </TableCell>
                <TableCell className="max-w-[150px] truncate" title={r.title ?? undefined}>
                  {r.title ?? <span className="text-ink-faint">—</span>}
                </TableCell>
                <TableCell className="text-ink-muted font-mono text-xs">{r.sourceLabel ?? "—"}</TableCell>
                <TableCell>{r.customerName}</TableCell>
                <TableCell className="font-mono text-xs">{r.dispatchDate ?? "—"}</TableCell>
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
      <div className="text-[11.5px] text-ink-faint mt-2">
        {t(locale, "Showing")} {filtered.length} {t(locale, "of")} {rows.length} {t(locale, "Delivery Challans")}.
      </div>
    </div>
  );
}
