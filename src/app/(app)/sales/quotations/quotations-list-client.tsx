"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Eye, Star, Pencil, Copy, Printer, Send, Archive, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatRow } from "../_shared/stat-row";
import { ListToolbar } from "../_shared/list-toolbar";
import { RowMenu, type RowMenuEntry } from "../_shared/row-menu";
import { Money } from "../_shared/money";
import { t, type Locale } from "@/lib/i18n/dict";
import { can } from "@/lib/document-lifecycle";
import {
  convertToSalesOrderAction,
  convertToProformaAction,
  convertToInvoiceAction,
  convertToDeliveryChallanAction,
  updateQuotationStatusAction,
} from "./actions";

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  sent: "info",
  accepted: "success",
  rejected: "danger",
  expired: "warning",
};

export type QuotationRow = {
  id: number;
  quotationNumber: string;
  title: string | null;
  customerName: string;
  issueDate: string;
  validUntil: string | null;
  total: string;
  status: string;
  creatorName: string;
};

export function QuotationsListClient({ locale, rows }: { locale: Locale; rows: QuotationRow[] }) {
  const [search, setSearch] = useState("");
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.quotationNumber.toLowerCase().includes(q) || r.customerName.toLowerCase().includes(q) || (r.title ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return counts;
  }, [rows]);

  function convert(id: number, action: (id: number) => Promise<{ error?: string }>) {
    startTransition(async () => {
      const result = await action(id);
      if (result?.error) toast.error(result.error);
    });
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="main-head flex items-center justify-between mb-[22px]">
        <h3 className="text-[19px] font-bold">{t(locale, "Quotations")}</h3>
      </div>

      <StatRow
        items={[
          { label: t(locale, "Total Quotations"), value: String(rows.length) },
          { label: t(locale, "accepted"), value: String(stats.accepted ?? 0), colorClass: "text-success" },
          { label: t(locale, "sent"), value: String(stats.sent ?? 0), colorClass: "text-info" },
          { label: t(locale, "draft"), value: String(stats.draft ?? 0) },
        ]}
      />

      <ListToolbar
        locale={locale}
        searchPlaceholder={t(locale, "Search quotation number, client…")}
        searchValue={search}
        onSearchChange={setSearch}
        createHref="/sales/quotations/new"
        createLabel={t(locale, "New Quotation")}
      />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t(locale, "Quotation #")}</TableHead>
            <TableHead>{t(locale, "Title")}</TableHead>
            <TableHead>{t(locale, "Converted From")}</TableHead>
            <TableHead>{t(locale, "Client")}</TableHead>
            <TableHead>{t(locale, "Issue Date")}</TableHead>
            <TableHead>{t(locale, "Valid Till")}</TableHead>
            <TableHead className="text-right">{t(locale, "Amount")}</TableHead>
            <TableHead>{t(locale, "Created By")}</TableHead>
            <TableHead>{t(locale, "Status")}</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((r) => {
            const entries: RowMenuEntry[] = [
              { kind: "item", icon: Eye, label: t(locale, "View"), href: `/sales/quotations/${r.id}` },
              { kind: "item", icon: Star, label: t(locale, "Add to Favorites") },
              { kind: "item", icon: Pencil, label: t(locale, "Edit"), href: can("quotation", r.status, "edit") ? `/sales/quotations/${r.id}/edit` : undefined },
              { kind: "item", icon: Copy, label: t(locale, "Duplicate") },
              { kind: "item", icon: Printer, label: t(locale, "Print / Download PDF"), href: `/print/quotation/${r.id}` },
              {
                kind: "convert",
                label: t(locale, "Convert to…"),
                targets: [
                  { label: t(locale, "Sales Order"), onSelect: () => convert(r.id, convertToSalesOrderAction) },
                  { label: t(locale, "Proforma Invoice"), onSelect: () => convert(r.id, convertToProformaAction) },
                  { label: t(locale, "Invoice"), onSelect: () => convert(r.id, convertToInvoiceAction) },
                  { label: t(locale, "Delivery Challan"), onSelect: () => convert(r.id, convertToDeliveryChallanAction) },
                  { label: t(locale, "Purchase Order"), onSelect: () => window.location.assign(`/purchasing/orders/new?fromQuotation=${r.id}`) },
                ],
              },
              { kind: "item", icon: Send, label: t(locale, "Send to Client"), onSelect: () => convert(r.id, (id) => updateQuotationStatusAction(id, "sent")) },
              { kind: "item", icon: Archive, label: t(locale, "Archive") },
              { kind: "separator" },
              { kind: "item", icon: Trash2, label: t(locale, "Delete"), danger: true },
            ];
            return (
              <TableRow key={r.id}>
                <TableCell className="font-semibold">
                  <Link href={`/sales/quotations/${r.id}`} className="hover:text-brand-orange font-mono">
                    {r.quotationNumber}
                  </Link>
                </TableCell>
                <TableCell className="max-w-[150px] truncate" title={r.title ?? undefined}>
                  {r.title ?? <span className="text-ink-faint">—</span>}
                </TableCell>
                <TableCell className="text-ink-faint font-mono text-xs">—</TableCell>
                <TableCell>{r.customerName}</TableCell>
                <TableCell className="font-mono text-xs">{r.issueDate}</TableCell>
                <TableCell className="font-mono text-xs">{r.validUntil ?? "—"}</TableCell>
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
        {t(locale, "Showing")} {filtered.length} {t(locale, "of")} {rows.length} {t(locale, "Quotations")}.
      </div>
    </div>
  );
}
