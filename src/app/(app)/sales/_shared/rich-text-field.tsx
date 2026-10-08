"use client";

import { useRef, useEffect, useId, useState } from "react";
import { Bold, Italic, Underline, List, ListOrdered, Link2, RemoveFormatting, Undo2, Redo2, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t, type Locale } from "@/lib/i18n/dict";
import { sanitizeRichText } from "@/lib/sanitize-html";

// The only link targets the editor accepts (unchanged from the window.prompt version).
const ALLOWED_LINK = /^(https?:\/\/|mailto:)/i;

// Sanitized rich-text editor shared by the item Description, the Note body, and any other document
// rich-text field. Toolbar: Bold / Italic / Underline / Bullet list / Numbered list / Insert link /
// Clear formatting / Undo / Redo. Produces allowlist-sanitized HTML on every change (the server
// re-sanitizes on save). Stays entirely on the page — edits flow straight into form state, so
// unsaved data is never lost.
// DEV-UI-01.6: a required accessible `label`; a named role="toolbar"; dir="auto" so mixed-language
// text lays out by its own direction; the shared focus recipe; and Insert link through a Dialog that
// keeps the user's selection (captured before the Dialog opens, restored before the link is made).
export function RichTextField({
  locale,
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
  compact = false,
  minHeightPx,
  maxHeightPx,
  onRemove,
}: {
  locale: Locale;
  /** Accessible name of the editable area, e.g. "Note" or "Description — <item>". */
  label: string;
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  rows?: number;
  compact?: boolean;
  /** Explicit min height for a larger editor (e.g. the description popup). Overrides rows. */
  minHeightPx?: number;
  /** Optional cap; the body scrolls internally past this height. */
  maxHeightPx?: number;
  /**
   * When provided, the toolbar's X becomes a REMOVE action (calls onRemove) instead of a
   * collapse toggle — the parent is expected to clear the value and unmount this whole editor
   * (toolbar included). Used by the Note editor so removing a note also hides its toolbar.
   */
  onRemove?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  // Insert-link dialog: the selection it will apply to, the URL being typed, and a rejected-URL flag.
  const savedRange = useRef<Range | null>(null);
  const pendingUrl = useRef<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [urlRejected, setUrlRejected] = useState(false);
  const urlId = useId();

  // Sync external value into the contentEditable only when it diverges from what the user typed,
  // and never while the editor is focused — rewriting innerHTML during typing collapses the caret
  // back to the start (the "Enter jumps to the first line" bug). While focused the DOM is already the
  // source of truth (emit() sanitizes on input/blur), so there's nothing to sync in.
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.innerHTML !== value) el.innerHTML = value || "";
  }, [value]);

  function emit() {
    const el = ref.current;
    if (el) onChange(sanitizeRichText(el.innerHTML));
  }

  function exec(command: string, arg?: string) {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  }

  // Remember the editor's selection (only one that lies inside this editor) before the dialog takes focus.
  function openLinkDialog() {
    const sel = window.getSelection();
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    savedRange.current = range && ref.current?.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
    pendingUrl.current = null;
    setUrl("");
    setUrlRejected(false);
    setLinkOpen(true);
  }

  function confirmLink() {
    const target = url.trim();
    if (!ALLOWED_LINK.test(target)) {
      setUrlRejected(true);
      return;
    }
    pendingUrl.current = target;
    setLinkOpen(false);
  }

  // Runs once the dialog has closed and released focus: put focus and the saved selection back in the
  // editor, then (only when a link was confirmed) apply the existing createLink command and emit.
  function restoreAndApply(e: Event) {
    e.preventDefault();
    const el = ref.current;
    if (!el) return;
    el.focus();
    const range = savedRange.current;
    if (range) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    const link = pendingUrl.current;
    pendingUrl.current = null;
    savedRange.current = null;
    if (link) {
      document.execCommand("createLink", false, link);
      emit();
    }
  }

  const btn = "cursor-pointer hover:text-brand-orange";
  return (
    <div className="doc-note-box">
      <div className="rte-toolbar" role="toolbar" aria-label={`${t(locale, "Formatting")} — ${label}`}>
        <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("bold")} title={t(locale, "Bold")} aria-label={t(locale, "Bold")}>
          <Bold className="size-3.5" />
        </button>
        <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("italic")} title={t(locale, "Italic")} aria-label={t(locale, "Italic")}>
          <Italic className="size-3.5" />
        </button>
        <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("underline")} title={t(locale, "Underline")} aria-label={t(locale, "Underline")}>
          <Underline className="size-3.5" />
        </button>
        <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertUnorderedList")} title={t(locale, "Bullet list")} aria-label={t(locale, "Bullet list")}>
          <List className="size-3.5" />
        </button>
        <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertOrderedList")} title={t(locale, "Numbered list")} aria-label={t(locale, "Numbered list")}>
          <ListOrdered className="size-3.5" />
        </button>
        <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={openLinkDialog} title={t(locale, "Insert link")} aria-label={t(locale, "Insert link")} data-rte-link="">
          <Link2 className="size-3.5" />
        </button>
        <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("removeFormat")} title={t(locale, "Clear formatting")} aria-label={t(locale, "Clear formatting")}>
          <RemoveFormatting className="size-3.5" />
        </button>
        <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("undo")} title={t(locale, "Undo")} aria-label={t(locale, "Undo")}>
          <Undo2 className="size-3.5" />
        </button>
        <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("redo")} title={t(locale, "Redo")} aria-label={t(locale, "Redo")}>
          <Redo2 className="size-3.5" />
        </button>
        <button
          type="button"
          className="rte-close cursor-pointer hover:text-danger"
          onClick={() => (onRemove ? onRemove() : setCollapsed((c) => !c))}
          title={t(locale, onRemove ? "Remove note" : "Close editor")}
          aria-label={t(locale, onRemove ? "Remove note" : "Close editor")}
        >
          <X className="size-3.5" />
        </button>
      </div>
      {!collapsed && (
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          dir="auto"
          data-placeholder={placeholder}
          onInput={emit}
          onBlur={emit}
          className="rte-body w-full bg-transparent overflow-auto rte-editable"
          // white-space: pre-wrap makes the browser keep normal spaces instead of inserting
          // non-breaking spaces (&nbsp;) as you type.
          style={{ minHeight: minHeightPx ?? (compact ? 28 : rows * 20), maxHeight: maxHeightPx, whiteSpace: "pre-wrap" }}
        />
      )}

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="sm:max-w-md" onCloseAutoFocus={restoreAndApply} data-rte-link-dialog="">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              confirmLink();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t(locale, "Insert link")}</DialogTitle>
              <DialogDescription className="text-body-sm text-ink-muted">{t(locale, "Links must start with https://, http:// or mailto:.")}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={urlId}>{t(locale, "Link address")}</Label>
              <Input
                id={urlId}
                value={url}
                autoFocus
                placeholder="https://"
                aria-invalid={urlRejected || undefined}
                aria-describedby={urlRejected ? `${urlId}-error` : undefined}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setUrlRejected(false);
                }}
              />
              {urlRejected && (
                <p id={`${urlId}-error`} className="text-caption text-danger" role="alert">
                  {t(locale, "Enter a URL (https://…)")}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLinkOpen(false)}>
                {t(locale, "Cancel")}
              </Button>
              <Button type="submit">{t(locale, "Insert link")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
