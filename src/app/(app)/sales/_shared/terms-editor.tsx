"use client";

import { useState } from "react";
import { GripVertical, ArrowUp, ArrowDown, X, Plus, Layers } from "lucide-react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import type { ContentPreset } from "@/lib/document-presets";
import { type DocumentTerm, splitGroupTerms } from "./document-terms";

// A single editable, reorderable term row. Shared by the document editor and the master group editor.
function TermRow({
  locale, index, text, badge, onText, onMoveUp, onMoveDown, onDelete, onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  locale: Locale; index: number; text: string; badge?: string;
  onText: (v: string) => void; onMoveUp: () => void; onMoveDown: () => void; onDelete: () => void;
  onDragStart: () => void; onDragOver: (e: React.DragEvent) => void; onDrop: () => void; onDragEnd: () => void;
}) {
  const [draggable, setDraggable] = useState(false);
  return (
    <div
      className="flex items-start gap-1.5 group"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={() => { setDraggable(false); onDragEnd(); }}
    >
      <button
        type="button"
        className="cursor-grab text-ink-faint hover:text-ink shrink-0 mt-1.5"
        title={t(locale, "Drag to reorder")}
        aria-label={t(locale, "Drag to reorder")}
        onMouseDown={() => setDraggable(true)}
        onMouseUp={() => setDraggable(false)}
      >
        <GripVertical className="size-3.5" />
      </button>
      <span className="text-[11.5px] text-ink-faint w-6 text-right shrink-0 mt-1.5">{index + 1}.</span>
      <textarea
        value={text}
        onChange={(e) => onText(e.target.value)}
        rows={1}
        placeholder={t(locale, "Term text…")}
        // A term may hold multiple lines of text; auto-grow so the whole term stays visible.
        ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } }}
        className="flex-1 min-h-8 py-1.5 rounded-[8px] border border-line px-2 text-[12px] leading-snug outline-none focus:border-brand-orange bg-surface resize-none overflow-hidden"
      />
      {badge && <span className="pill shrink-0 mt-1" style={{ fontSize: 10 }}>{badge}</span>}
      <button type="button" className="item-del-btn shrink-0 mt-1" onClick={onMoveUp} disabled={index === 0} aria-label={t(locale, "Move up")} title={t(locale, "Move up")}>
        <ArrowUp className="size-3.5" />
      </button>
      <button type="button" className="item-del-btn shrink-0 mt-1" onClick={onMoveDown} aria-label={t(locale, "Move down")} title={t(locale, "Move down")}>
        <ArrowDown className="size-3.5" />
      </button>
      <button type="button" className="item-del-btn shrink-0 mt-1" onClick={onDelete} aria-label={t(locale, "Remove Term")} title={t(locale, "Remove Term")}>
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function reorder<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
  const next = [...arr];
  const [m] = next.splice(from, 1);
  next.splice(to, 0, m);
  return next;
}
function swap<T>(arr: T[], i: number, dir: number): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

// ---- Document Terms editor: one continuously-numbered list mixing appended group terms + individual
// terms. Appending a group ADDS its terms (never replaces). Edits/deletes/reorders here never touch
// the master group (the doc stores a snapshot). Removing a group offers the three required options.
export function DocumentTermsEditor({
  locale, terms, onChange, groups = [],
}: {
  locale: Locale;
  terms: DocumentTerm[];
  onChange: (terms: DocumentTerm[]) => void;
  groups?: ContentPreset[];
}) {
  const [addGroupId, setAddGroupId] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [removeGroup, setRemoveGroup] = useState<{ id: number; name: string } | null>(null);

  // Distinct groups currently present in the document, in first-appearance order.
  const presentGroups: { id: number; name: string }[] = [];
  for (const tm of terms) {
    if (tm.groupId != null && !presentGroups.some((g) => g.id === tm.groupId)) {
      presentGroups.push({ id: tm.groupId, name: tm.groupName ?? "" });
    }
  }

  function appendGroup(id: string) {
    const g = groups.find((x) => String(x.id) === id);
    if (!g) return;
    // Append the group's structured terms (falling back to splitting the display content for any
    // legacy shape). Each term keeps its own multiline text — no splitting on newlines here.
    const source = g.terms ?? splitGroupTerms(g.content);
    const added = source.map((text) => text.trim()).filter(Boolean).map((text) => ({ text, groupId: g.id, groupName: g.name }));
    if (added.length) onChange([...terms, ...added]); // append — do not replace
    setAddGroupId("");
  }
  function confirmRemoveGroup(mode: "all" | "keep") {
    if (!removeGroup) return;
    if (mode === "all") onChange(terms.filter((tm) => tm.groupId !== removeGroup.id));
    else onChange(terms.map((tm) => (tm.groupId === removeGroup.id ? { ...tm, groupId: null, groupName: null } : tm)));
    setRemoveGroup(null);
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* Append a group's terms (does not replace the existing list). */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-[12.5px] font-bold text-ink">{t(locale, "Terms & Conditions")}</div>
        {groups.length > 0 && (
          <>
            <Select value={addGroupId} onValueChange={appendGroup}>
              <SelectTrigger className="h-8 w-56 text-[12.5px]"><SelectValue placeholder={t(locale, "Add a group…")} /></SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={String(g.id)}>{g.name}{g.isDefault ? ` · ${t(locale, "Default")}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[11px] text-ink-faint">{t(locale, "Adds the group's terms to the list.")}</span>
          </>
        )}
      </div>

      {/* Groups present in this document, each removable with the three required options. */}
      {presentGroups.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-ink-faint inline-flex items-center gap-1"><Layers className="size-3" /> {t(locale, "Groups in this document")}:</span>
          {presentGroups.map((g) => (
            <button key={g.id} type="button" className="pill inline-flex items-center gap-1 hover:opacity-80" style={{ fontSize: 11 }} onClick={() => setRemoveGroup(g)} title={t(locale, "Remove group")}>
              {g.name || t(locale, "Group")} <X className="size-3" />
            </button>
          ))}
        </div>
      )}

      {/* The continuous numbered list. */}
      <div className="flex flex-col gap-1.5">
        {terms.length === 0 && <p className="text-[11.5px] text-ink-faint">{t(locale, "No terms yet — add a group or an individual term.")}</p>}
        {terms.map((tm, i) => (
          <TermRow
            key={i}
            locale={locale}
            index={i}
            text={tm.text}
            badge={tm.groupName || undefined}
            onText={(v) => onChange(terms.map((x, idx) => (idx === i ? { ...x, text: v } : x)))}
            onMoveUp={() => onChange(swap(terms, i, -1))}
            onMoveDown={() => onChange(swap(terms, i, 1))}
            onDelete={() => onChange(terms.filter((_, idx) => idx !== i))}
            onDragStart={() => setDragIdx(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragIdx !== null) onChange(reorder(terms, dragIdx, i)); setDragIdx(null); }}
            onDragEnd={() => setDragIdx(null)}
          />
        ))}
      </div>

      <div>
        <button type="button" className="doc-pill-btn" style={{ height: 30, fontSize: 11.5 }} onClick={() => onChange([...terms, { text: "", groupId: null, groupName: null }])}>
          <Plus className="size-3" /> {t(locale, "Add Individual Term")}
        </button>
      </div>

      {/* Remove-group confirmation with the three required options. */}
      <Dialog open={!!removeGroup} onOpenChange={(o) => { if (!o) setRemoveGroup(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t(locale, "Remove group")}: {removeGroup?.name}</DialogTitle>
            <DialogDescription>{t(locale, "Choose what to do with this group's terms in this document.")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <button type="button" className="btn btn-primary" onClick={() => confirmRemoveGroup("all")}>{t(locale, "Remove group and its terms")}</button>
            <button type="button" className="btn btn-glass" onClick={() => confirmRemoveGroup("keep")}>{t(locale, "Remove group reference but keep the terms")}</button>
            <button type="button" className="btn btn-glass" onClick={() => setRemoveGroup(null)}>{t(locale, "Cancel")}</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- Master group editor: a reorderable list of plain term strings (create/add/edit/delete/reorder/
// move up/down). Used in Preset Management. Emits the joined-by-newline content via onChange.
export function MasterTermsListEditor({
  locale, terms, onChange,
}: {
  locale: Locale;
  terms: string[];
  onChange: (terms: string[]) => void;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        {terms.length === 0 && <p className="text-[11.5px] text-ink-faint">{t(locale, "No terms yet — add the first term.")}</p>}
        {terms.map((term, i) => (
          <TermRow
            key={i}
            locale={locale}
            index={i}
            text={term}
            onText={(v) => onChange(terms.map((x, idx) => (idx === i ? v : x)))}
            onMoveUp={() => onChange(swap(terms, i, -1))}
            onMoveDown={() => onChange(swap(terms, i, 1))}
            onDelete={() => onChange(terms.filter((_, idx) => idx !== i))}
            onDragStart={() => setDragIdx(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragIdx !== null) onChange(reorder(terms, dragIdx, i)); setDragIdx(null); }}
            onDragEnd={() => setDragIdx(null)}
          />
        ))}
      </div>
      <div>
        <button type="button" className="doc-pill-btn" style={{ height: 30, fontSize: 11.5 }} onClick={() => onChange([...terms, ""])}>
          <Plus className="size-3" /> {t(locale, "Add New Term")}
        </button>
      </div>
    </div>
  );
}
