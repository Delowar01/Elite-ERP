"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, SlidersHorizontal, Bookmark, ChevronDown, Download, Archive, Plus, X, Pencil, Trash2, Check } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { t, type Locale } from "@/lib/i18n/dict";
import type { ImportColumn } from "@/lib/document-list-workspace";
import { ImportDialog } from "./import-dialog";
import { EMPTY_FILTERS, filtersActive, filtersToParams, type ListFilterState } from "./filter-types";
import { saveViewAction, renameViewAction, deleteViewAction, type SavedViewDTO } from "./saved-view-actions";

export function ListWorkspaceToolbar({
  locale,
  module,
  searchPlaceholder,
  createHref,
  createLabel,
  recycleBinHref = "/recycle-bin",
  filters,
  setFilters,
  statusOptions,
  partyLabel,
  partyOptions,
  savedViews,
  importColumns,
}: {
  locale: Locale;
  module: string;
  searchPlaceholder: string;
  createHref: string;
  createLabel: string;
  recycleBinHref?: string;
  filters: ListFilterState;
  setFilters: (f: ListFilterState) => void;
  statusOptions: string[];
  partyLabel: string;
  partyOptions: string[];
  savedViews: SavedViewDTO[];
  importColumns: ImportColumn[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const active = filtersActive(filters);
  const set = (patch: Partial<ListFilterState>) => setFilters({ ...filters, ...patch });

  const exportUrl = (format: string) => {
    const qp = filtersToParams(filters);
    return `/documents/export?module=${module}&format=${format}${qp ? "&" + qp : ""}`;
  };

  function saveCurrentView() {
    const name = window.prompt(t(locale, "Name this view"));
    if (!name?.trim()) return;
    startTransition(async () => {
      const res = await saveViewAction(module, name, filters);
      if (res.error) toast.error(res.error);
      else { toast.success(t(locale, "View saved.")); router.refresh(); }
    });
  }
  function renameView(v: SavedViewDTO) {
    const name = window.prompt(t(locale, "Rename view"), v.name);
    if (!name?.trim() || name === v.name) return;
    startTransition(async () => {
      const res = await renameViewAction(v.id, name);
      if (res.error) toast.error(res.error);
      else { toast.success(t(locale, "Saved")); router.refresh(); }
    });
  }
  function deleteView(v: SavedViewDTO) {
    if (!window.confirm(t(locale, "Delete this view?"))) return;
    startTransition(async () => {
      const res = await deleteViewAction(v.id);
      if (res.error) toast.error(res.error);
      else { toast.success(t(locale, "View deleted.")); router.refresh(); }
    });
  }

  return (
    <div className="list-toolbar">
      <div className="topbar-search">
        <Search className="size-3.5 shrink-0" />
        <input
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
          placeholder={searchPlaceholder}
          className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-ink-faint"
        />
      </div>

      {/* Filters */}
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="doc-pill-btn" data-active={active || undefined}>
            <SlidersHorizontal className="size-3.5" /> <span>{t(locale, "Filters")}</span>
            {active && <span className="ms-1 inline-block size-1.5 rounded-full bg-brand-orange" />}
            <ChevronDown className="size-3" style={{ color: "var(--ink-faint)" }} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 flex flex-col gap-3">
          <div className="field">
            <label className="text-[11px] text-ink-muted">{t(locale, "Status")}</label>
            <select value={filters.status} onChange={(e) => set({ status: e.target.value })} className="input plain w-full h-9 outline-none">
              <option value="">{t(locale, "All")}</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>{t(locale, s)}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="field">
              <label className="text-[11px] text-ink-muted">{t(locale, "From")}</label>
              <input type="date" value={filters.dateFrom} onChange={(e) => set({ dateFrom: e.target.value })} className="input plain w-full h-9 outline-none" />
            </div>
            <div className="field">
              <label className="text-[11px] text-ink-muted">{t(locale, "To")}</label>
              <input type="date" value={filters.dateTo} onChange={(e) => set({ dateTo: e.target.value })} className="input plain w-full h-9 outline-none" />
            </div>
          </div>
          <div className="field">
            <label className="text-[11px] text-ink-muted">{t(locale, partyLabel)}</label>
            <select value={filters.party} onChange={(e) => set({ party: e.target.value })} className="input plain w-full h-9 outline-none">
              <option value="">{t(locale, "All")}</option>
              {partyOptions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="text-[11px] text-ink-muted">{t(locale, "Archived")}</label>
            <select value={filters.archived} onChange={(e) => set({ archived: e.target.value as ListFilterState["archived"] })} className="input plain w-full h-9 outline-none">
              <option value="all">{t(locale, "All")}</option>
              <option value="active">{t(locale, "Active only")}</option>
              <option value="archived">{t(locale, "Archived only")}</option>
            </select>
          </div>
          <button type="button" className="btn btn-glass" onClick={() => setFilters(EMPTY_FILTERS)} disabled={!active}>
            <X className="size-3.5" /> {t(locale, "Clear filters")}
          </button>
        </PopoverContent>
      </Popover>

      {/* Saved Views */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="doc-pill-btn">
            <Bookmark className="size-3.5" /> <span>{t(locale, "Views")}</span> <ChevronDown className="size-3" style={{ color: "var(--ink-faint)" }} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          <DropdownMenuItem className="cursor-pointer" onSelect={saveCurrentView} disabled={pending}>
            <Check className="size-3.5" /> {t(locale, "Save current view")}
          </DropdownMenuItem>
          {savedViews.length > 0 && <DropdownMenuSeparator />}
          {savedViews.map((v) => (
            <div key={v.id} className="flex items-center">
              <DropdownMenuItem className="cursor-pointer flex-1" onSelect={() => setFilters(v.config)}>
                {v.name}
              </DropdownMenuItem>
              <button type="button" className="p-1.5 text-ink-faint hover:text-ink" title={t(locale, "Rename")} onClick={(e) => { e.preventDefault(); renameView(v); }}>
                <Pencil className="size-3.5" />
              </button>
              <button type="button" className="p-1.5 text-ink-faint hover:text-danger" title={t(locale, "Delete")} onClick={(e) => { e.preventDefault(); deleteView(v); }}>
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          {savedViews.length === 0 && <div className="px-2 py-1.5 text-[11.5px] text-ink-faint">{t(locale, "No saved views yet.")}</div>}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="toolbar-actions-right">
        {/* Export */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="btn btn-glass">
              <Download className="size-3.5" /> <span>{t(locale, "Export")}</span> <ChevronDown className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="cursor-pointer" onSelect={() => { window.location.href = exportUrl("csv"); }}>{t(locale, "CSV")}</DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer" onSelect={() => { window.location.href = exportUrl("xlsx"); }}>{t(locale, "Excel")}</DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer" onSelect={() => { window.location.href = exportUrl("pdf"); }}>{t(locale, "PDF")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Import */}
        <ImportDialog locale={locale} module={module} importColumns={importColumns} />

        {recycleBinHref ? (
          <Link href={recycleBinHref} className="btn btn-glass">
            <Archive className="size-3.5" /> <span>{t(locale, "Recycle Bin")}</span>
          </Link>
        ) : null}
        <Link href={createHref} className="btn btn-primary">
          <Plus className="size-3.5" /> {createLabel}
        </Link>
      </div>
    </div>
  );
}
