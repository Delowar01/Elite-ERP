"use client";

import { useState, useRef, useTransition } from "react";
import { toast } from "sonner";
import { FileSignature, FileText, Paperclip, Plus, X, Check, Upload, Trash2, FileIcon } from "lucide-react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { t, type Locale } from "@/lib/i18n/dict";
import { RichTextField } from "./rich-text-field";
import { uploadDocumentAttachmentAction } from "./creation-popup-actions";
import type { ContentPreset } from "@/lib/document-presets";

export type AttachmentDraft = { fileName: string; fileUrl: string; contentType?: string; sizeBytes?: number };

type Tab = "terms" | "note" | "attachments";

// Terms, Notes & Attachments block. Three functional tabs, all in-page (no redirect):
//  • Terms & Conditions — pick a group (Change Group), edit its terms (Add/Remove Term, Add New
//    Group as a local working set), Insert into notes so they persist on the document.
//  • Add Note — a sanitized rich-text editor writing to the document's notes field.
//  • Add Attachment — upload files (staged in form state, persisted with the document on save),
//    preview/download, remove.
export function TermsBlock({
  locale,
  notes,
  onNotesChange,
  noteTemplates = [],
  termsGroups = [],
  attachments = [],
  onAttachmentsChange,
}: {
  locale: Locale;
  notes: string;
  onNotesChange: (v: string) => void;
  noteTemplates?: ContentPreset[];
  termsGroups?: ContentPreset[];
  attachments?: AttachmentDraft[];
  onAttachmentsChange?: (a: AttachmentDraft[]) => void;
}) {
  const defaultTerms = termsGroups.find((g) => g.isDefault) ?? termsGroups[0];
  const defaultNote = noteTemplates.find((n) => n.isDefault) ?? noteTemplates[0];
  const [tab, setTab] = useState<Tab>("terms");
  const [termsId, setTermsId] = useState<string>(defaultTerms ? String(defaultTerms.id) : "");
  const [noteId, setNoteId] = useState<string>(defaultNote ? String(defaultNote.id) : "");
  const [workingTerms, setWorkingTerms] = useState<string[]>(defaultTerms ? splitTerms(defaultTerms.content) : []);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedNote = noteTemplates.find((n) => String(n.id) === noteId);

  function changeGroup(id: string) {
    setTermsId(id);
    const g = termsGroups.find((x) => String(x.id) === id);
    setWorkingTerms(g ? splitTerms(g.content) : []);
  }
  function updateTerm(i: number, v: string) {
    setWorkingTerms((ts) => ts.map((t2, idx) => (idx === i ? v : t2)));
  }
  function removeTerm(i: number) {
    setWorkingTerms((ts) => ts.filter((_, idx) => idx !== i));
  }
  function addTerm() {
    setWorkingTerms((ts) => [...ts, ""]);
  }
  function addGroup() {
    // A fresh, empty local group (persists through the document's notes, not as a reusable preset).
    setTermsId("");
    setWorkingTerms([""]);
  }
  function insertTerms() {
    const body = workingTerms.map((x) => x.trim()).filter(Boolean).map((x, i) => `${i + 1}. ${x}`).join("\n");
    if (!body) return;
    const next = notes.trim() ? `${notes}\n\n${body}` : body;
    onNotesChange(next);
    toast.success(t(locale, "Inserted into notes."));
    setTab("note");
  }
  function applyNote() {
    if (!selectedNote) return;
    onNotesChange(selectedNote.content);
    toast.success(t(locale, "Applied to notes."));
    setTab("note");
  }

  function uploadAttachment() {
    const file = fileRef.current?.files?.[0];
    if (!file || !onAttachmentsChange) return;
    const fd = new FormData();
    fd.set("attachment", file);
    start(async () => {
      const res = await uploadDocumentAttachmentAction(fd);
      if (res.error || !res.url) toast.error(res.error ?? t(locale, "Upload failed."));
      else {
        onAttachmentsChange([...attachments, { fileName: res.fileName ?? file.name, fileUrl: res.url, contentType: res.contentType, sizeBytes: res.sizeBytes }]);
        if (fileRef.current) fileRef.current.value = "";
        toast.success(t(locale, "Saved"));
      }
    });
  }
  function removeAttachment(i: number) {
    onAttachmentsChange?.(attachments.filter((_, idx) => idx !== i));
  }

  return (
    <div>
      <div className="doc-tabbar">
        <button type="button" className={tab === "terms" ? "active" : "cursor-pointer"} onClick={() => setTab("terms")}>
          <FileSignature className="size-3.5" /> {t(locale, "Terms & Conditions")}
        </button>
        <button type="button" className={tab === "note" ? "active" : "cursor-pointer"} onClick={() => setTab("note")}>
          <FileText className="size-3.5" /> {t(locale, "Add Note")}
        </button>
        <button type="button" className={tab === "attachments" ? "active" : "cursor-pointer"} onClick={() => setTab("attachments")}>
          <Paperclip className="size-3.5" /> {t(locale, "Add Attachment")}
          {attachments.length > 0 ? ` (${attachments.length})` : ""}
        </button>
      </div>

      {tab === "terms" && (
        <div className="flex flex-col gap-2 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-[12.5px] font-bold text-ink">{t(locale, "Terms & Conditions Group")}</div>
            {termsGroups.length > 0 && (
              <Select value={termsId} onValueChange={changeGroup}>
                <SelectTrigger className="h-8 w-56 text-[12.5px]" title={t(locale, "Change Group")}>
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
            )}
            <button type="button" className="doc-pill-btn" style={{ height: 30, fontSize: 11.5 }} onClick={addGroup}>
              <Plus className="size-3" /> {t(locale, "Add New Group")}
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {workingTerms.map((term, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="text-[11.5px] text-ink-faint w-5 text-right">{i + 1}.</span>
                <input
                  value={term}
                  onChange={(e) => updateTerm(i, e.target.value)}
                  placeholder={t(locale, "Term text…")}
                  className="flex-1 h-8 rounded-[8px] border border-line px-2 text-[12px] outline-none focus:border-brand-orange bg-transparent"
                />
                <button type="button" className="item-del-btn" onClick={() => removeTerm(i)} aria-label={t(locale, "Remove Term")} title={t(locale, "Remove Term")}>
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="doc-pill-btn" style={{ height: 30, fontSize: 11.5 }} onClick={addTerm}>
              <Plus className="size-3" /> {t(locale, "Add New Term")}
            </button>
            <button type="button" className="doc-pill-btn" style={{ height: 30, fontSize: 11.5 }} onClick={insertTerms} disabled={workingTerms.every((x) => !x.trim())}>
              <Check className="size-3" /> {t(locale, "Insert into notes")}
            </button>
          </div>
        </div>
      )}

      {tab === "note" && (
        <div className="flex flex-col gap-2">
          {noteTemplates.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
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
          <RichTextField locale={locale} value={notes} onChange={onNotesChange} placeholder={t(locale, "Write a note…")} rows={5} />
        </div>
      )}

      {tab === "attachments" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,application/pdf" className="text-[12px]" />
            <button type="button" className="doc-pill-btn" style={{ height: 30, fontSize: 11.5 }} onClick={uploadAttachment} disabled={pending}>
              <Upload className="size-3" /> {pending ? t(locale, "Saving…") : t(locale, "Upload")}
            </button>
          </div>
          <p className="text-[11px] text-ink-faint">{t(locale, "PDF, PNG or JPG, up to 8 MB.")}</p>
          {attachments.length > 0 && (
            <div className="flex flex-col gap-1">
              {attachments.map((a, i) => (
                <div key={i} className="flex items-center gap-2 rounded-[8px] border border-line px-2 py-1 text-[12px]">
                  <FileIcon className="size-3.5 text-ink-faint" />
                  <a href={a.fileUrl} target="_blank" rel="noreferrer" className="flex-1 truncate hover:text-brand-orange" title={a.fileName}>
                    {a.fileName}
                  </a>
                  <button type="button" className="item-del-btn" onClick={() => removeAttachment(i)} aria-label={t(locale, "Remove")} title={t(locale, "Remove")}>
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function splitTerms(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean);
}
