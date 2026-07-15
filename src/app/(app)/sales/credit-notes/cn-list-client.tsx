"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Eye, Printer, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatRow } from "../_shared/stat-row";
import { ListToolbar } from "../_shared/list-toolbar";
import { RowMenu, type RowMenuEntry } from "../_shared/row-menu";
import { Money } from "../_shared/money";
import { t, type Locale } from "@/lib/i18n/dict";

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
  sourceInvoiceNumber: string;
  sourceInvoiceId: number;
};

export function CnListClient({ locale, rows }: { locale: Locale; rows: CnRow[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.creditNoteNumber.toLowerCase().includes(q) || r.customerName.toLowerCase().includes(q) || (r.title ?? "").toLowerCase().includes(q));
  }, [rows, search]);

  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return counts;
  }, [rows]);

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-[22px]">
        <h3 className="text-[19px] font-bold">{t(locale, "Credit Notes")}</h3>
      </div>

      <StatRow
        items={[
          { label: t(locale, "Total Credit Notes"), value: String(rows.length) },
          { label: t(locale, "issued"), value: String(stats.issued ?? 0), colorClass: "text-success" },
          { label: t(locale, "draft"), value: String(stats.draft ?? 0) },
        ]}
      />

      <ListToolbar
        locale={locale}
        searchPlaceholder={t(locale, "Search credit note number, client…")}
        searchValue={search}
        onSearchChange={setSearch}
        createHref="/sales/credit-notes/new"
        createLabel={t(locale, "New Credit Note")}
      />

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface shadow-elevated py-12 text-center text-ink-muted text-sm">
          {t(locale, "No credit notes yet. Open a sent invoice to issue one against it.")}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Number")}</TableHead>
              <TableHead>{t(locale, "Title")}</TableHead>
              <TableHead>{t(locale, "Against Invoice")}</TableHead>
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
                { kind: "item", icon: Printer, label: t(locale, "Print") },
                { kind: "separator" },
                { kind: "item", icon: Trash2, label: t(locale, "Delete"), danger: true },
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
