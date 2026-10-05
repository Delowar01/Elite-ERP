"use client";

import { useId, useRef, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GripVertical, Eye, EyeOff, Plus, Trash2, AlertCircle, ArrowUp, ArrowDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { t, type Locale } from "@/lib/i18n/dict";
import {
  ACTIONS_KEY,
  WIDTH_OPTIONS,
  ALLOWED_FORMULA_VARS,
  validateColumns,
  validateFormula,
  resolveColumns,
  type ColumnDef,
  type FieldType,
} from "@/lib/column-config";
import { saveColumnConfigAction } from "./column-config-actions";
import { columnDisplayLabel } from "./column-label";

let CUSTOM_SEQ = 0;

// In-page Configure Columns modal (Edit Columns). Reorder (drag, or Move Up / Move Down), show/hide
// (eye), rename, change width, add/edit/remove custom + calculated columns. The Actions column is fixed
// last and locked. On save the config is persisted per user + document type and applied to the table
// immediately; the creation page and all unsaved form data stay mounted behind the modal.
// DEV-UI-01.6: presentation and accessibility only — approved controls, named per row, labels bound to
// their fields, a keyboard reorder path, built-in labels shown translated (never written back unless
// the user edits them), validation messages shown through the dictionary when they are fixed text.
// Validation, normalisation and persistence (column-config.ts / column-config-actions.ts) are unchanged.
export function ConfigureColumnsDialog({
  locale,
  documentType,
  columns,
  onApply,
  trigger,
}: {
  locale: Locale;
  documentType: string;
  columns: ColumnDef[];
  onApply: (cols: ColumnDef[]) => void;
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cols, setCols] = useState<ColumnDef[]>(columns);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [pending, start] = useTransition();
  // Built-in labels the user has typed into in this session; an untouched one is displayed translated
  // while its stored value stays the English default it was saved with.
  const [touched, setTouched] = useState<Set<string>>(new Set());
  // Add-custom-column form
  const [nLabel, setNLabel] = useState("");
  const [nType, setNType] = useState<FieldType>("text");
  const [nWidth, setNWidth] = useState(10);
  const [nVisible, setNVisible] = useState(true);
  const [nFormula, setNFormula] = useState("");
  const ids = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{ key: string; dir: "up" | "down" } | null>(null);

  const configError = validateColumns(cols);
  const editable = cols.filter((c) => c.key !== ACTIONS_KEY);
  const actions = cols.find((c) => c.key === ACTIONS_KEY)!;

  function reset(list: ColumnDef[]) {
    setCols(resolveColumns(list));
    setTouched(new Set());
  }

  function update(key: string, patch: Partial<ColumnDef>) {
    setCols((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }
  function toggleVisible(c: ColumnDef) {
    if (c.locked || c.required) return;
    update(c.key, { visible: !c.visible });
  }
  function removeCustom(key: string) {
    setCols((prev) => prev.filter((c) => c.key !== key));
  }

  /** What the label field shows: a translated default for an untouched built-in, else the stored text. */
  function labelValue(c: ColumnDef) {
    return touched.has(c.key) ? c.label : columnDisplayLabel(locale, c);
  }
  function editLabel(c: ColumnDef, value: string) {
    setTouched((prev) => new Set(prev).add(c.key));
    update(c.key, { label: value });
  }

  // Move within the editable (non-actions) region; Actions always stays last. Drag uses the same move.
  function moveTo(from: number, to: number) {
    setCols((prev) => {
      const list = prev.filter((c) => c.key !== ACTIONS_KEY);
      if (from === to || to < 0 || to >= list.length) return prev;
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      return [...list, prev.find((c) => c.key === ACTIONS_KEY)!];
    });
  }
  function onDrop(targetIdx: number) {
    if (dragIdx === null || dragIdx === targetIdx) { setDragIdx(null); return; }
    moveTo(dragIdx, targetIdx);
    setDragIdx(null);
  }
  function moveByKey(key: string, idx: number, dir: "up" | "down") {
    pendingFocus.current = { key, dir };
    moveTo(idx, dir === "up" ? idx - 1 : idx + 1);
  }
  // Keep focus on the moved column's same button (or its other one at the list edge).
  useEffect(() => {
    const p = pendingFocus.current;
    if (!p || !listRef.current) return;
    pendingFocus.current = null;
    const row = listRef.current.querySelector<HTMLElement>(`[data-cc-key="${CSS.escape(p.key)}"]`);
    const btn = row?.querySelector<HTMLButtonElement>(`[data-cc-move="${p.dir}"]`);
    (btn && !btn.disabled ? btn : row?.querySelector<HTMLButtonElement>("[data-cc-move]:not(:disabled)"))?.focus();
  }, [cols]);

  function addCustom() {
    const label = nLabel.trim();
    if (!label) { toast.error(t(locale, "Column labels cannot be empty.")); return; }
    if (cols.some((c) => (c.label || "").trim().toLowerCase() === label.toLowerCase())) {
      toast.error(t(locale, "Duplicate column name is not allowed.")); return;
    }
    if (nType === "formula") {
      const err = validateFormula(nFormula, ALLOWED_FORMULA_VARS);
      if (err) { toast.error(t(locale, err)); return; }
    }
    const col: ColumnDef = {
      key: `custom_${Date.now()}_${CUSTOM_SEQ++}`,
      label,
      visible: nVisible,
      widthPct: nWidth,
      kind: nType === "formula" ? "formula" : "input",
      custom: true,
      fieldType: nType,
      formula: nType === "formula" ? nFormula.trim() : "",
    };
    setCols((prev) => {
      const list = prev.filter((c) => c.key !== ACTIONS_KEY);
      return [...list, col, prev.find((c) => c.key === ACTIONS_KEY)!];
    });
    setNLabel(""); setNType("text"); setNWidth(10); setNVisible(true); setNFormula("");
    toast.success(t(locale, "Column added."));
  }

  function save() {
    if (configError) { toast.error(t(locale, configError)); return; }
    start(async () => {
      const res = await saveColumnConfigAction(documentType, cols);
      if (res.error) { toast.error(t(locale, res.error)); return; }
      const applied = resolveColumns(cols);
      onApply(applied); // update the live table immediately (unsaved form data preserved)
      toast.success(t(locale, "Configuration saved."));
      setOpen(false);
      router.refresh();
    });
  }

  const f = (name: string) => `${ids}-${name}`;
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(columns); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto p-0 gap-0" data-configure-columns="">
        <DialogHeader className="cc-head">
          <div className="flex items-start gap-3">
            <span className="cc-head-icon" aria-hidden><GripVertical className="size-5" /></span>
            <div>
              <DialogTitle className="text-page">{t(locale, "Configure Columns")}</DialogTitle>
              <DialogDescription className="text-body-sm text-ink-muted mt-0.5">
                {t(locale, "Drag to reorder • Toggle visibility • Rename columns • Actions column always stays at the end")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-5">
          <p className="text-body text-ink-muted mb-3">{t(locale, "Drag columns to reorder, or use Move up / Move down. Toggle visibility and edit names.")}</p>

          <div className="flex flex-col gap-2" ref={listRef}>
            {editable.map((c, idx) => {
              const shown = columnDisplayLabel(locale, c);
              return (
                <div
                  key={c.key}
                  data-cc-key={c.key}
                  draggable
                  onDragStart={() => setDragIdx(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(idx)}
                  className={`cc-row ${c.visible ? "" : "cc-row-hidden"} ${dragIdx === idx ? "cc-row-dragging" : ""}`}
                >
                  <span className="cc-drag" aria-hidden title={t(locale, "Drag to reorder")}><GripVertical className="size-4" /></span>
                  <div className="cc-move">
                    <Button type="button" variant="ghost" size="icon-sm" disabled={idx === 0} onClick={() => moveByKey(c.key, idx, "up")} aria-label={`${t(locale, "Move up")}: ${shown}`} title={t(locale, "Move up")} data-cc-move="up">
                      <ArrowUp className="size-3.5" aria-hidden />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" disabled={idx === editable.length - 1} onClick={() => moveByKey(c.key, idx, "down")} aria-label={`${t(locale, "Move down")}: ${shown}`} title={t(locale, "Move down")} data-cc-move="down">
                      <ArrowDown className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="cc-eye"
                    onClick={() => toggleVisible(c)}
                    disabled={c.required}
                    aria-pressed={c.visible}
                    aria-label={`${c.visible ? t(locale, "Hide column") : t(locale, "Show column")}: ${shown}`}
                    title={c.required ? t(locale, "Required by the totals — cannot be hidden.") : c.visible ? t(locale, "Hide column") : t(locale, "Show column")}
                  >
                    {c.visible ? <Eye className="size-4 text-success" aria-hidden /> : <EyeOff className="size-4 text-ink-faint" aria-hidden />}
                  </Button>
                  <Input className="cc-label" value={labelValue(c)} onChange={(e) => editLabel(c, e.target.value)} aria-label={`${t(locale, "Column label")} ${idx + 1}`} />
                  <Select value={String(c.widthPct)} onValueChange={(v) => update(c.key, { widthPct: Number(v) })}>
                    <SelectTrigger className="cc-width" aria-label={`${t(locale, "Width")}: ${shown}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WIDTH_OPTIONS.map((w) => <SelectItem key={w} value={String(w)}>{w}%</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="cc-order" aria-hidden>#{idx + 1}</span>
                  {c.custom ? (
                    <Button type="button" variant="destructive-ghost" size="icon-sm" className="cc-remove" onClick={() => removeCustom(c.key)} aria-label={`${t(locale, "Remove column")}: ${shown}`} title={t(locale, "Remove column")}>
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  ) : <span className="cc-remove-spacer" />}
                  {c.custom && c.fieldType === "formula" && (
                    <Input className="cc-formula" value={c.formula ?? ""} onChange={(e) => update(c.key, { formula: e.target.value })}
                      placeholder="e.g., {quantity} * {unit_price} * 0.1" aria-label={`${t(locale, "Formula")}: ${shown}`} dir="ltr" />
                  )}
                </div>
              );
            })}

            {/* Locked Actions row — always last */}
            <div className="cc-sep" />
            <div className="cc-row cc-row-locked">
              <span className="cc-drag cc-drag-off" aria-hidden><GripVertical className="size-4" /></span>
              <span className="cc-move" aria-hidden />
              <span className="cc-eye cc-eye-off" aria-hidden><Eye className="size-4 text-ink-faint" /></span>
              <Input className="cc-label" value={t(locale, "Actions")} disabled readOnly aria-label={`${t(locale, "Column label")}: ${t(locale, "Actions")}`} />
              <Select value={String(actions.widthPct)} disabled>
                <SelectTrigger className="cc-width" aria-label={`${t(locale, "Width")}: ${t(locale, "Actions")}`}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={String(actions.widthPct)}>{actions.widthPct}%</SelectItem></SelectContent>
              </Select>
              <span className="cc-order">{t(locale, "Last")}</span>
              <span className="cc-remove-spacer" />
            </div>
          </div>

          <div className="cc-sep-dashed" />

          {/* Add Custom Column */}
          <div className="mt-4">
            <div className="flex items-center gap-2 text-brand-orange font-semibold text-body mb-3">
              <Plus className="size-4" aria-hidden /> {t(locale, "Add Custom Column")}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={f("label")}>{t(locale, "Column Label")} <span className="text-danger" aria-hidden>*</span></Label>
                <Input id={f("label")} aria-required value={nLabel} onChange={(e) => setNLabel(e.target.value)} placeholder={t(locale, "e.g., Margin, Notes, Location")} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={f("type")}>{t(locale, "Field Type")}</Label>
                <Select value={nType} onValueChange={(v) => setNType(v as FieldType)}>
                  <SelectTrigger id={f("type")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">{t(locale, "Text")}</SelectItem>
                    <SelectItem value="number">{t(locale, "Number")}</SelectItem>
                    <SelectItem value="formula">{t(locale, "Formula (calculated)")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={f("width")}>{t(locale, "Width")}</Label>
                <Select value={String(nWidth)} onValueChange={(v) => setNWidth(Number(v))}>
                  <SelectTrigger id={f("width")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WIDTH_OPTIONS.map((w) => <SelectItem key={w} value={String(w)}>{w}%</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 sm:mt-6">
                <Checkbox id={f("visible")} checked={nVisible} onCheckedChange={(v) => setNVisible(!!v)} />
                <Label htmlFor={f("visible")} className="cursor-pointer select-none">{t(locale, "Visible by default")}</Label>
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor={f("formula")}>{t(locale, "Formula (optional - for calculated columns)")}</Label>
                <Input id={f("formula")} value={nFormula} onChange={(e) => setNFormula(e.target.value)} placeholder="e.g., {quantity} * {unit_price} * 0.1" disabled={nType !== "formula"} aria-describedby={f("formula-help")} dir="ltr" />
                <span id={f("formula-help")} className="text-caption text-ink-faint">{t(locale, "Use {field_name} to reference other fields")}: <span dir="ltr">{ALLOWED_FORMULA_VARS.map((v) => `{${v}}`).join(", ")}</span></span>
              </div>
            </div>
            <div className="flex justify-end mt-3">
              <Button type="button" onClick={addCustom} disabled={!nLabel.trim()}>
                <Plus className="size-3.5" aria-hidden /> {t(locale, "Add Column")}
              </Button>
            </div>
          </div>

          {configError && (
            <div className="flex items-center gap-2 text-danger text-body-sm mt-4" role="alert">
              <AlertCircle className="size-4 shrink-0" aria-hidden /> {t(locale, configError)}
            </div>
          )}
        </div>

        <DialogFooter className="px-5 py-4 border-t border-line">
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>{t(locale, "Cancel")}</Button>
          </DialogClose>
          <Button type="button" onClick={save} disabled={!!configError} loading={pending}>
            {t(locale, "Save Configuration")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
