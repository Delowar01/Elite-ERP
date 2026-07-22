"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatRow } from "../sales/_shared/stat-row";
import { ListToolbar } from "../sales/_shared/list-toolbar";
import { RowMenu, type RowMenuEntry } from "../sales/_shared/row-menu";
import { Money } from "../sales/_shared/money";
import { t, type Locale } from "@/lib/i18n/dict";

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  planned: "neutral",
  active: "info",
  on_hold: "warning",
  completed: "success",
  cancelled: "danger",
};

export type ProjectRow = {
  id: number;
  name: string;
  clientName: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  budget: string | null;
  taskCount: number;
};

export function ProjectsListClient({ locale, rows }: { locale: Locale; rows: ProjectRow[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q) || (r.clientName ?? "").toLowerCase().includes(q));
  }, [rows, search]);

  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return counts;
  }, [rows]);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-[22px]">
        <h3 className="text-[19px] font-bold">{t(locale, "Projects")}</h3>
      </div>

      <StatRow
        items={[
          { label: t(locale, "Total Projects"), value: String(rows.length) },
          { label: t(locale, "active"), value: String(stats.active ?? 0), colorClass: "text-info" },
          { label: t(locale, "completed"), value: String(stats.completed ?? 0), colorClass: "text-success" },
          { label: t(locale, "planned"), value: String(stats.planned ?? 0) },
        ]}
      />

      <ListToolbar
        locale={locale}
        searchPlaceholder={t(locale, "Search project name, client…")}
        searchValue={search}
        onSearchChange={setSearch}
        createHref="/projects/new"
        createLabel={t(locale, "New Project")}
        recycleBinHref=""
      />

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface shadow-elevated py-12 text-center text-ink-muted text-sm">
          {t(locale, "No projects yet. Create your first project to start planning tasks.")}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Name")}</TableHead>
              <TableHead>{t(locale, "Client")}</TableHead>
              <TableHead>{t(locale, "Start Date")}</TableHead>
              <TableHead>{t(locale, "End Date")}</TableHead>
              <TableHead className="text-right">{t(locale, "Budget")}</TableHead>
              <TableHead>{t(locale, "Tasks")}</TableHead>
              <TableHead>{t(locale, "Status")}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => {
              const entries: RowMenuEntry[] = [{ kind: "item", icon: Eye, label: t(locale, "View"), href: `/projects/${r.id}` }];
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-semibold">
                    <Link href={`/projects/${r.id}`} className="hover:text-brand-orange">
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell>{r.clientName ?? <span className="text-ink-faint">—</span>}</TableCell>
                  <TableCell className="font-mono text-xs">{r.startDate ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.endDate ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">
                    {r.budget ? <Money amount={r.budget} /> : <span className="text-ink-faint">—</span>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.taskCount}</TableCell>
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
          {t(locale, "Showing")} {filtered.length} {t(locale, "of")} {rows.length} {t(locale, "Projects")}.
        </div>
      )}
    </div>
  );
}
