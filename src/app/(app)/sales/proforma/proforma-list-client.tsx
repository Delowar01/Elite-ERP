"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Eye, Printer, Wallet, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatRow } from "../_shared/stat-row";
import { ListToolbar } from "../_shared/list-toolbar";
import { RowMenu, type RowMenuEntry } from "../_shared/row-menu";
import { Money } from "../_shared/money";
import { t, type Locale } from "@/lib/i18n/dict";
import { convertProformaToInvoiceAction } from "./actions";

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  sent: "info",
};

export type ProformaRow = {
  id: number;
  proformaNumber: string;
  title: string | null;
  customerName: string;
  issueDate: string;
  total: string;
  status: string;
  creatorName: string;
  sourceSoNumber: string | null;
};

export function ProformaListClient({ locale, rows }: { locale: Locale; rows: ProformaRow[] }) {
  const [search, setSearch] = useState("");
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.proformaNumber.toLowerCase().includes(q) || r.customerName.toLowerCase().includes(q) || (r.title ?? "").toLowerCase().includes(q));
  }, [rows, search]);

  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return counts;
  }, [rows]);

  function convert(id: number) {
    startTransition(async () => {
      const result = await convertProformaToInvoiceAction(id);
      if (result?.error) toast.error(result.error);
    });
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-[22px]">
        <h3 className="text-[19px] font-bold">{t(locale, "Proforma Invoices")}</h3>
      </div>

      <StatRow
        items={[
          { label: t(locale, "Total Proformas"), value: String(rows.length) },
          { label: t(locale, "sent"), value: String(stats.sent ?? 0), colorClass: "text-info" },
          { label: t(locale, "draft"), value: String(stats.draft ?? 0) },
        ]}
      />

      <ListToolbar
        locale={locale}
        searchPlaceholder={t(locale, "Search proforma number, client…")}
        searchValue={search}
        onSearchChange={setSearch}
        createHref="/sales/proforma/new"
        createLabel={t(locale, "New Proforma Invoice")}
      />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t(locale, "Number")}</TableHead>
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
              { kind: "item", icon: Eye, label: t(locale, "View"), href: `/sales/proforma/${r.id}` },
              { kind: "item", icon: Printer, label: t(locale, "Print / Download PDF"), href: `/print/proforma/${r.id}` },
              { kind: "item", icon: Wallet, label: t(locale, "Record Payment") },
              {
                kind: "convert",
                label: t(locale, "Convert to…"),
                targets: [{ label: t(locale, "Invoice"), onSelect: () => convert(r.id) }],
              },
              { kind: "separator" },
              { kind: "item", icon: Trash2, label: t(locale, "Delete"), danger: true },
            ];
            return (
              <TableRow key={r.id}>
                <TableCell className="font-semibold">
                  <Link href={`/sales/proforma/${r.id}`} className="hover:text-brand-orange font-mono">
                    {r.proformaNumber}
                  </Link>
                </TableCell>
                <TableCell className="max-w-[150px] truncate" title={r.title ?? undefined}>
                  {r.title ?? <span className="text-ink-faint">—</span>}
                </TableCell>
                <TableCell className="text-ink-muted font-mono text-xs">{r.sourceSoNumber ?? "—"}</TableCell>
                <TableCell>{r.customerName}</TableCell>
                <TableCell className="font-mono text-xs">{r.issueDate}</TableCell>
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
      <div className="text-[11.5px] text-ink-faint mt-2">
        {t(locale, "Showing")} {filtered.length} {t(locale, "of")} {rows.length} {t(locale, "Proforma Invoices")}.
      </div>
    </div>
  );
}
