"use client";

import { useId, useRef, useState, useTransition } from "react";
import { statusLabel } from "@/lib/status-registry";
import type { DocumentType } from "@/lib/document-lifecycle";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SlidersHorizontal, Bookmark, ChevronDown, Download, Archive, Plus, X, Pencil, Trash2, Check, Settings2 } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ListSearch } from "@/components/ui/list-search";
import { t, type Locale } from "@/lib/i18n/dict";
import { useConfirm } from "../../_shared/confirm-provider";
import type { ImportColumn } from "@/lib/document-list-workspace";
import { ImportDialog } from "./import-dialog";
import { ImportV2Dialog } from "./import-v2-dialog";
import { importSpec } from "@/lib/import/spec";
import { EMPTY_FILTERS, filtersActive, filtersToParams, type ListFilterState } from "./filter-types";
import { saveViewAction, renameViewAction, deleteViewAction, type SavedViewDTO } from "./saved-view-actions";

// Radix Select cannot hold an empty value; "any" is the empty filter ("" in ListFilterState).
const ANY = "__any";

/** How many filter DIMENSIONS are set — the text search is shown separately and not counted. */
function activeFilterCount(f: ListFilterState): number {
  return (f.status ? 1 : 0) + (f.dateFrom || f.dateTo ? 1 : 0) + (f.party ? 1 : 0) + (f.archived !== "all" ? 1 : 0);
}

/** A saved view "is current" when its stored filters equal the live ones, key by key. */
function sameFilters(a: ListFilterState, b: ListFilterState): boolean {
  return (Object.keys(EMPTY_FILTERS) as (keyof ListFilterState)[]).every((k) => (a[k] ?? EMPTY_FILTERS[k]) === (b[k] ?? EMPTY_FILTERS[k]));
}

// The document-list workspace toolbar. DEV-UI-01.5 changed its PRESENTATION only: search on the
// Input foundation, filter fields on the Select / Input / Label primitives with an active count, and
// saved views through dialogs instead of window.prompt. Filters still apply live (`set` on every
// change); the keys, predicates (use-list-filters), export URL, import and saved-view actions are
// exactly as before.
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
  // Every workspace module is a document type, and every document type is a status-registry domain.
  module: DocumentType;
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
  const confirm = useConfirm();
  const uid = useId();
  const active = filtersActive(filters);
  const count = activeFilterCount(filters);
  const set = (patch: Partial<ListFilterState>) => setFilters({ ...filters, ...patch });
  // Views menu → Dialog handoff. When a menu item opens a Dialog (Save current view, Manage saved views),
  // the closing menu must NOT return focus to the Views trigger: the Dialog has already focused its
  // content, and the trigger refocus followed by the Dialog's focus trap pulling it back drops keystrokes.
  // The flag is set only by those two items and consumed by the next close; every other close (Escape,
  // outside click, applying a view) keeps Radix's normal focus return to the trigger.
  const viewsDialogHandoff = useRef(false);
  // Save / rename dialog: `naming` is the view being renamed, or "new" for "Save current view".
  const [naming, setNaming] = useState<SavedViewDTO | "new" | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [managing, setManaging] = useState(false);

  const exportUrl = (format: string) => {
    const qp = filtersToParams(filters);
    return `/documents/export?module=${module}&format=${format}${qp ? "&" + qp : ""}`;
  };

  function openNaming(target: SavedViewDTO | "new") {
    setNameDraft(target === "new" ? "" : target.name);
    setNaming(target);
  }
  function submitName() {
    const name = nameDraft;
    const target = naming;
    if (!name.trim() || target === null) return;
    if (target === "new") {
      startTransition(async () => {
        const res = await saveViewAction(module, name, filters);
        if (res.error) toast.error(res.error);
        else { toast.success(t(locale, "View saved.")); setNaming(null); router.refresh(); }
      });
      return;
    }
    if (name === target.name) { setNaming(null); return; }
    startTransition(async () => {
      const res = await renameViewAction(target.id, name);
      if (res.error) toast.error(res.error);
      else { toast.success(t(locale, "Saved")); setNaming(null); router.refresh(); }
    });
  }
  function deleteView(v: SavedViewDTO) {
    confirm({
      action: "view.delete",
      entityType: "Saved View",
      entityNumber: v.name,
      onConfirm: () =>
        new Promise<{ error?: string } | void>((resolve) => {
          startTransition(async () => {
            const res = await deleteViewAction(v.id);
            if (res.error) {
              resolve({ error: res.error });
              return;
            }
            toast.success(t(locale, "View deleted."));
            router.refresh();
            resolve();
          });
        }),
    });
  }

  const fid = (k: string) => `${uid}-${k}`;

  return (
    <div className="list-toolbar">
      <ListSearch
        value={filters.search}
        onChange={(search) => set({ search })}
        placeholder={searchPlaceholder}
        label={searchPlaceholder}
        clearLabel={t(locale, "Clear search")}
      />

      {/* Filters — live, as before. */}
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="doc-pill-btn" data-active={active || undefined} data-list-filters="">
            <SlidersHorizontal className="size-3.5" aria-hidden /> <span>{t(locale, "Filters")}</span>
            {count > 0 && (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent-tint px-1.5 text-caption font-semibold text-accent-ink" data-filter-count={count}>
                {count}
              </span>
            )}
            <ChevronDown className="size-3 text-ink-faint" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="flex w-72 flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fid("status")}>{t(locale, "Status")}</Label>
            <Select value={filters.status || ANY} onValueChange={(v) => set({ status: v === ANY ? "" : v })}>
              <SelectTrigger id={fid("status")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t(locale, "All")}</SelectItem>
                {statusOptions.map((s) => (
                  <SelectItem key={s} value={s}>{statusLabel(locale, module, s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={fid("from")}>{t(locale, "From")}</Label>
              <Input id={fid("from")} type="date" value={filters.dateFrom} onChange={(e) => set({ dateFrom: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={fid("to")}>{t(locale, "To")}</Label>
              <Input id={fid("to")} type="date" value={filters.dateTo} onChange={(e) => set({ dateTo: e.target.value })} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fid("party")}>{t(locale, partyLabel)}</Label>
            <Select value={filters.party || ANY} onValueChange={(v) => set({ party: v === ANY ? "" : v })}>
              <SelectTrigger id={fid("party")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t(locale, "All")}</SelectItem>
                {partyOptions.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fid("archived")}>{t(locale, "Archived")}</Label>
            <Select value={filters.archived} onValueChange={(v) => set({ archived: v as ListFilterState["archived"] })}>
              <SelectTrigger id={fid("archived")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t(locale, "All")}</SelectItem>
                <SelectItem value="active">{t(locale, "Active only")}</SelectItem>
                <SelectItem value="archived">{t(locale, "Archived only")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setFilters(EMPTY_FILTERS)} disabled={!active}>
            <X /> {t(locale, "Clear filters")}
          </Button>
        </PopoverContent>
      </Popover>

      {/* Saved Views — every entry is a real menu item (keyboard-reachable); rename / delete live in
          the Manage dialog, not as stray buttons inside the menu. */}
      <DropdownMenu onOpenChange={(open) => { if (open) viewsDialogHandoff.current = false; }}>
        <DropdownMenuTrigger asChild>
          <button type="button" className="doc-pill-btn" data-list-views="">
            <Bookmark className="size-3.5" aria-hidden /> <span>{t(locale, "Views")}</span> <ChevronDown className="size-3 text-ink-faint" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-56"
          onCloseAutoFocus={(event) => {
            if (viewsDialogHandoff.current) {
              event.preventDefault();
              viewsDialogHandoff.current = false;
            }
          }}
        >
          <DropdownMenuItem className="cursor-pointer" onSelect={() => { viewsDialogHandoff.current = true; openNaming("new"); }} disabled={pending}>
            <Plus className="size-3.5" aria-hidden /> {t(locale, "Save current view")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {savedViews.map((v) => {
            const current = sameFilters(v.config, filters);
            return (
              <DropdownMenuItem key={v.id} className="cursor-pointer" data-selected={current || undefined} aria-current={current || undefined} onSelect={() => setFilters(v.config)}>
                <Check className={current ? "size-3.5" : "size-3.5 invisible"} aria-hidden /> {v.name}
              </DropdownMenuItem>
            );
          })}
          {savedViews.length === 0 && <div className="px-2.5 py-1.5 text-caption text-ink-faint">{t(locale, "No saved views yet.")}</div>}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="cursor-pointer" onSelect={() => { viewsDialogHandoff.current = true; setManaging(true); }} disabled={savedViews.length === 0}>
            <Settings2 className="size-3.5" aria-hidden /> {t(locale, "Manage saved views")}
          </DropdownMenuItem>
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

        {/* Import — modules with a full import spec use the v2 modal (template / mapping /
            validation preview / per-document transaction); the rest keep the simple CSV dialog. */}
        {importSpec(module) ? (
          <ImportV2Dialog
            locale={locale}
            module={module}
            moduleLabel={importSpec(module)!.label}
            fields={importSpec(module)!.fields}
            entity={importSpec(module)!.entity}
            duplicateHandling={importSpec(module)!.duplicateHandling}
          />
        ) : (
          <ImportDialog locale={locale} module={module} importColumns={importColumns} />
        )}

        {recycleBinHref ? (
          <Link href={recycleBinHref} className="btn btn-glass">
            <Archive className="size-3.5" /> <span>{t(locale, "Recycle Bin")}</span>
          </Link>
        ) : null}
        <Link href={createHref} className="btn btn-primary">
          <Plus className="size-3.5" /> {createLabel}
        </Link>
      </div>

      {/* Save current view / Rename view */}
      <Dialog open={naming !== null} onOpenChange={(o) => !o && setNaming(null)}>
        <DialogContent className="sm:max-w-sm" data-saved-view-dialog={naming === "new" ? "save" : "rename"}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitName();
            }}
            className="flex flex-col gap-4"
          >
            <DialogHeader>
              <DialogTitle>{naming === "new" ? t(locale, "Save current view") : t(locale, "Rename view")}</DialogTitle>
              <DialogDescription className="sr-only">{t(locale, "Name this view")}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={fid("view-name")}>{t(locale, "Name this view")}</Label>
              {/* Save keeps saveViewAction's 60-character limit; rename stays unlimited, as renameViewAction is
                  (and as the window.prompt it replaces was). */}
              <Input id={fid("view-name")} value={nameDraft} maxLength={naming === "new" ? 60 : undefined} autoFocus onChange={(e) => setNameDraft(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNaming(null)}>{t(locale, "Cancel")}</Button>
              <Button type="submit" disabled={pending || !nameDraft.trim()}>{t(locale, "Save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Manage saved views: rename (opens the dialog above) and delete (the existing confirmation). */}
      <Dialog open={managing} onOpenChange={setManaging}>
        <DialogContent className="sm:max-w-md" data-saved-view-dialog="manage">
          <DialogHeader>
            <DialogTitle>{t(locale, "Manage saved views")}</DialogTitle>
            <DialogDescription className="sr-only">{t(locale, "Manage saved views")}</DialogDescription>
          </DialogHeader>
          {savedViews.length === 0 ? (
            <p className="text-body-sm text-ink-faint">{t(locale, "No saved views yet.")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {savedViews.map((v) => (
                <li key={v.id} className="flex items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-body">{v.name}</span>
                  <Button type="button" variant="ghost" size="icon" aria-label={`${t(locale, "Rename")} ${v.name}`} disabled={pending} onClick={() => { setManaging(false); openNaming(v); }}>
                    <Pencil />
                  </Button>
                  <Button type="button" variant="destructive-ghost" size="icon" aria-label={`${t(locale, "Delete")} ${v.name}`} disabled={pending} onClick={() => deleteView(v)}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
