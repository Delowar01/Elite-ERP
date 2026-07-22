"use client";

import { useState } from "react";
import { FileSignature, FileText, Paperclip, Plus, Bold, Italic, Underline, List, X, Check } from "lucide-react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { t, type Locale } from "@/lib/i18n/dict";
import type { ContentPreset } from "@/lib/document-presets";

// Terms & Notes block on the document builder. Wires two real presets into the document's notes:
//  • Note Templates — "Apply" replaces the notes with the chosen template (default pre-applied
//    at create time by the form).
//  • Terms & Conditions Groups — shows the chosen group's terms and "Insert into notes" appends
//    them, so the terms end up on the saved document (its single notes field).
// When no presets exist the block degrades to just the notes editor (e.g. on edit screens).
export function TermsBlock({
  locale,
  notes,
  onNotesChange,
  noteTemplates = [],
  termsGroups = [],
}: {
  locale: Locale;
  notes: string;
  onNotesChange: (v: string) => void;
  noteTemplates?: ContentPreset[];
  termsGroups?: ContentPreset[];
}) {
  const defaultTerms = termsGroups.find((g) => g.isDefault) ?? termsGroups[0];
  const defaultNote = noteTemplates.find((n) => n.isDefault) ?? noteTemplates[0];
  const [termsId, setTermsId] = useState<string>(defaultTerms ? String(defaultTerms.id) : "");
  const [noteId, setNoteId] = useState<string>(defaultNote ? String(defaultNote.id) : "");

  const selectedTerms = termsGroups.find((g) => String(g.id) === termsId);
  const selectedNote = noteTemplates.find((n) => String(n.id) === noteId);

  function insertTerms() {
    if (!selectedTerms) return;
    const next = notes.trim() ? `${notes.trim()}\n\n${selectedTerms.content}` : selectedTerms.content;
    onNotesChange(next);
  }
  function applyNote() {
    if (!selectedNote) return;
    onNotesChange(selectedNote.content);
  }

  return (
    <div>
      <div className="doc-tabbar">
        <button type="button" className="active" disabled>
          <FileSignature className="size-3.5" /> {t(locale, "Terms & Conditions")}
        </button>
        <button type="button" disabled>
          <FileText className="size-3.5" /> {t(locale, "Add Note")}
        </button>
        <button type="button" disabled>
          <Paperclip className="size-3.5" /> {t(locale, "Add Attachment")}
        </button>
      </div>

      {termsGroups.length > 0 && (
        <div className="flex flex-col gap-2 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-[12.5px] font-bold text-ink">{t(locale, "Terms & Conditions Group")}</div>
            <Select value={termsId} onValueChange={setTermsId}>
              <SelectTrigger className="h-8 w-56 text-[12.5px]">
                <SelectValue placeholder={t(locale, "Select a group")} />
              </SelectTrigger>
              <SelectContent>
                {termsGroups.map((g) => (
                  <SelectItem key={g.id} value={String(g.id)}>
                    {g.name}
                    {g.isDefault ? ` · ${t(locale, "Default")}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button type="button" className="doc-pill-btn" style={{ height: 30, fontSize: 11.5 }} onClick={insertTerms} disabled={!selectedTerms}>
              <Plus className="size-3" /> {t(locale, "Insert into notes")}
            </button>
          </div>
          {selectedTerms && (
            <div className="rounded-[10px] border border-line bg-canvas p-3 text-[12px] text-ink-muted whitespace-pre-wrap">{selectedTerms.content}</div>
          )}
        </div>
      )}

      {noteTemplates.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <div className="text-[12.5px] font-bold text-ink">{t(locale, "Note Template")}</div>
          <Select value={noteId} onValueChange={setNoteId}>
            <SelectTrigger className="h-8 w-56 text-[12.5px]">
              <SelectValue placeholder={t(locale, "Select a template")} />
            </SelectTrigger>
            <SelectContent>
              {noteTemplates.map((n) => (
                <SelectItem key={n.id} value={String(n.id)}>
                  {n.name}
                  {n.isDefault ? ` · ${t(locale, "Default")}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button type="button" className="doc-pill-btn" style={{ height: 30, fontSize: 11.5 }} onClick={applyNote} disabled={!selectedNote}>
            <Check className="size-3" /> {t(locale, "Apply to notes")}
          </button>
        </div>
      )}

      <div className="doc-note-box">
        <div className="rte-toolbar">
          <button type="button" disabled><Bold className="size-3.5" /></button>
          <button type="button" disabled><Italic className="size-3.5" /></button>
          <button type="button" disabled><Underline className="size-3.5" /></button>
          <button type="button" disabled><List className="size-3.5" /></button>
          <button type="button" className="rte-close" disabled><X className="size-3.5" /></button>
        </div>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={4}
          placeholder={t(locale, "Write a note…")}
          className="rte-body w-full outline-none resize-none bg-transparent"
        />
      </div>
    </div>
  );
}
