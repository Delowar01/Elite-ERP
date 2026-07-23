"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GripVertical, Eye, EyeOff, Plus, Trash2, AlertCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
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

let CUSTOM_SEQ = 0;

// In-page Configure Columns modal (Edit Columns). Reorder (drag), show/hide (eye), rename, change
// width, add/edit/remove custom + calculated columns. The Actions column is fixed last and locked.
// On save the config is persisted per user + document type and applied to the table immediately;
// the creation page and all unsaved form data stay mounted behind the modal.
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
  // Add-custom-column form
  const [nLabel, setNLabel] = useState("");
  const [nType, setNType] = useState<FieldType>("text");
  const [nWidth, setNWidth] = useState(10);
  const [nVisible, setNVisible] = useState(true);
  const [nFormula, setNFormula] = useState("");

  const configError = validateColumns(cols);
  const editable = cols.filter((c) => c.key !== ACTIONS_KEY);
  const actions = cols.find((c) => c.key === ACTIONS_KEY)!;

  function reset(list: ColumnDef[]) {
    setCols(resolveColumns(list));
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

  // Native HTML5 drag reorder within the editable (non-actions) region; Actions always stays last.
  function onDrop(targetIdx: number) {
    if (dragIdx === null || dragIdx === targetIdx) { setDragIdx(null); return; }
    setCols((prev) => {
      const list = prev.filter((c) => c.key !== ACTIONS_KEY);
      const [moved] = list.splice(dragIdx, 1);
      list.splice(targetIdx, 0, moved);
      return [...list, prev.find((c) => c.key === ACTIONS_KEY)!];
    });
    setDragIdx(null);
  }

  function addCustom() {
    const label = nLabel.trim();
    if (!label) { toast.error(t(locale, "Column labels cannot be empty.")); return; }
    if (cols.some((c) => (c.label || "").trim().toLowerCase() === label.toLowerCase())) {
      toast.error(t(locale, "Duplicate column name is not allowed.")); return;
    }
    if (nType === "formula") {
      const err = validateFormula(nFormula, ALLOWED_FORMULA_VARS);
      if (err) { toast.error(err); return; }
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
    if (configError) { toast.error(configError); return; }
    start(async () => {
      const res = await saveColumnConfigAction(documentType, cols);
      if (res.error) { toast.error(res.error); return; }
      const applied = resolveColumns(cols);
      onApply(applied); // update the live table immediately (unsaved form data preserved)
      toast.success(t(locale, "Configuration saved."));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(columns); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto p-0 gap-0">
        <DialogHeader className="cc-head">
          <div className="flex items-start gap-3">
            <span className="cc-head-icon"><GripVertical className="size-5" /></span>
            <div>
              <DialogTitle className="text-[17px]">{t(locale, "Configure Columns")}</DialogTitle>
              <p className="text-[12px] text-ink-muted mt-0.5">
                {t(locale, "Drag to reorder • Toggle visibility • Rename columns • Actions column always stays at the end")}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="p-5">
          <p className="text-[13px] text-ink-muted mb-3">{t(locale, "Drag columns to reorder. Click to toggle visibility and edit names.")}</p>

          <div className="flex flex-col gap-2">
            {editable.map((c, idx) => (
              <div
                key={c.key}
                draggable
                onDragStart={() => setDragIdx(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(idx)}
                className={`cc-row ${c.visible ? "" : "cc-row-hidden"} ${dragIdx === idx ? "cc-row-dragging" : ""}`}
              >
                <span className="cc-drag" aria-label={t(locale, "Drag to reorder")}><GripVertical className="size-4" /></span>
                <button type="button" className="cc-eye" onClick={() => toggleVisible(c)} disabled={c.required}
                  aria-label={c.visible ? t(locale, "Hide column") : t(locale, "Show column")}
                  title={c.required ? t(locale, "Required by the totals — cannot be hidden.") : c.visible ? t(locale, "Hide column") : t(locale, "Show column")}>
                  {c.visible ? <Eye className="size-4 text-success" /> : <EyeOff className="size-4 text-ink-faint" />}
                </button>
                <input className="cc-label input" value={c.label} onChange={(e) => update(c.key, { label: e.target.value })} />
                <select className="cc-width input" value={c.widthPct} onChange={(e) => update(c.key, { widthPct: Number(e.target.value) })}>
                  {WIDTH_OPTIONS.map((w) => <option key={w} value={w}>{w}%</option>)}
                </select>
                <span className="cc-order">#{idx + 1}</span>
                {c.custom ? (
                  <button type="button" className="cc-remove" onClick={() => removeCustom(c.key)} aria-label={t(locale, "Remove column")} title={t(locale, "Remove column")}>
                    <Trash2 className="size-4" />
                  </button>
                ) : <span className="cc-remove-spacer" />}
                {c.custom && c.fieldType === "formula" && (
                  <input className="cc-formula input" value={c.formula ?? ""} onChange={(e) => update(c.key, { formula: e.target.value })}
                    placeholder="e.g., {quantity} * {unit_price} * 0.1" />
                )}
              </div>
            ))}

            {/* Locked Actions row — always last */}
            <div className="cc-sep" />
            <div className="cc-row cc-row-locked">
              <span className="cc-drag cc-drag-off"><GripVertical className="size-4" /></span>
              <span className="cc-eye cc-eye-off"><Eye className="size-4 text-ink-faint" /></span>
              <input className="cc-label input" value={t(locale, "Actions")} disabled readOnly />
              <select className="cc-width input" value={actions.widthPct} disabled><option value={actions.widthPct}>{actions.widthPct}%</option></select>
              <span className="cc-order">{t(locale, "Last")}</span>
              <span className="cc-remove-spacer" />
            </div>
          </div>

          <div className="cc-sep-dashed" />

          {/* Add Custom Column */}
          <div className="mt-4">
            <div className="flex items-center gap-2 text-brand-orange font-semibold text-[14px] mb-3">
              <Plus className="size-4" /> {t(locale, "Add Custom Column")}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3">
              <div className="flex flex-col gap-1">
                <label className="text-[12.5px] font-medium">{t(locale, "Column Label")} *</label>
                <input className="input" value={nLabel} onChange={(e) => setNLabel(e.target.value)} placeholder={t(locale, "e.g., Margin, Notes, Location")} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12.5px] font-medium">{t(locale, "Field Type")}</label>
                <select className="input" value={nType} onChange={(e) => setNType(e.target.value as FieldType)}>
                  <option value="text">{t(locale, "Text")}</option>
                  <option value="number">{t(locale, "Number")}</option>
                  <option value="formula">{t(locale, "Formula (calculated)")}</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12.5px] font-medium">{t(locale, "Width")}</label>
                <select className="input" value={nWidth} onChange={(e) => setNWidth(Number(e.target.value))}>
                  {WIDTH_OPTIONS.map((w) => <option key={w} value={w}>{w}%</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-[13px] cursor-pointer select-none mt-6">
                <Checkbox checked={nVisible} onCheckedChange={(v) => setNVisible(!!v)} /> {t(locale, "Visible by default")}
              </label>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label className="text-[12.5px] font-medium">{t(locale, "Formula (optional - for calculated columns)")}</label>
                <input className="input" value={nFormula} onChange={(e) => setNFormula(e.target.value)} placeholder="e.g., {quantity} * {unit_price} * 0.1" disabled={nType !== "formula"} />
                <span className="text-[11px] text-ink-faint">{t(locale, "Use {field_name} to reference other fields")}: {ALLOWED_FORMULA_VARS.map((v) => `{${v}}`).join(", ")}</span>
              </div>
            </div>
            <div className="flex justify-end mt-3">
              <button type="button" className="btn btn-primary" onClick={addCustom} disabled={!nLabel.trim()}>
                <Plus className="size-3.5" /> {t(locale, "Add Column")}
              </button>
            </div>
          </div>

          {configError && (
            <div className="flex items-center gap-2 text-danger text-[12.5px] mt-4">
              <AlertCircle className="size-4 shrink-0" /> {configError}
            </div>
          )}
        </div>

        <DialogFooter className="px-5 py-4 border-t border-line">
          <DialogClose asChild>
            <button type="button" className="btn btn-glass" disabled={pending}>{t(locale, "Cancel")}</button>
          </DialogClose>
          <button type="button" className="btn btn-primary" onClick={save} disabled={pending || !!configError}>
            {pending ? t(locale, "Saving…") : t(locale, "Save Configuration")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
