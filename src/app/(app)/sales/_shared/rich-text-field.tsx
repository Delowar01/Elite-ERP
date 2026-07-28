"use client";

import { useRef, useEffect, useState } from "react";
import { Bold, Italic, Underline, List, ListOrdered, Link2, RemoveFormatting, Undo2, Redo2, X } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";
import { sanitizeRichText } from "@/lib/sanitize-html";

// Sanitized rich-text editor shared by the item Description, the Note body, and any other document
// rich-text field. Toolbar: Bold / Italic / Underline / Bullet list / Numbered list / Insert link /
// Clear formatting / Undo / Redo. Produces allowlist-sanitized HTML on every change (the server
// re-sanitizes on save). Stays entirely on the page — edits flow straight into form state, so
// unsaved data is never lost.
export function RichTextField({
  locale,
  value,
  onChange,
  placeholder,
  rows = 4,
  compact = false,
  minHeightPx,
  maxHeightPx,
}: {
  locale: Locale;
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  rows?: number;
  compact?: boolean;
  /** Explicit min height for a larger editor (e.g. the description popup). Overrides rows. */
  minHeightPx?: number;
  /** Optional cap; the body scrolls internally past this height. */
  maxHeightPx?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Sync external value into the contentEditable only when it diverges from what the user typed
  // (avoids caret jumps during typing).
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== value) el.innerHTML = value || "";
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

  function insertLink() {
    const url = window.prompt(t(locale, "Enter a URL (https://…)"));
    if (url && /^(https?:\/\/|mailto:)/i.test(url)) exec("createLink", url);
  }

  const btn = "cursor-pointer hover:text-brand-orange";
  return (
    <div className="doc-note-box">
      <div className="rte-toolbar">
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
        <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={insertLink} title={t(locale, "Insert link")} aria-label={t(locale, "Insert link")}>
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
        <button type="button" className="rte-close cursor-pointer hover:text-danger" onClick={() => setCollapsed((c) => !c)} title={t(locale, "Close editor")} aria-label={t(locale, "Close editor")}>
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
          data-placeholder={placeholder}
          onInput={emit}
          onBlur={emit}
          className="rte-body w-full outline-none bg-transparent overflow-auto rte-editable"
          // white-space: pre-wrap makes the browser keep normal spaces instead of inserting
          // non-breaking spaces (&nbsp;) as you type.
          style={{ minHeight: minHeightPx ?? (compact ? 28 : rows * 20), maxHeight: maxHeightPx, whiteSpace: "pre-wrap" }}
        />
      )}
    </div>
  );
}
