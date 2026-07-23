"use client";

import { useRef, useEffect, useState } from "react";
import { Bold, Italic, Underline, ListOrdered, Link2, X } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";
import { sanitizeRichText } from "@/lib/sanitize-html";

// Sanitized rich-text editor used on the creation pages for the Note body and the item
// Description. Toolbar: Bold / Italic / Underline / Numbered list / Insert link / Close editor.
// Produces allowlist-sanitized HTML on every change (server re-sanitizes on save). Stays entirely
// on the creation page — edits flow straight into form state, so unsaved data is never lost.
export function RichTextField({
  locale,
  value,
  onChange,
  placeholder,
  rows = 4,
  compact = false,
}: {
  locale: Locale;
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  rows?: number;
  compact?: boolean;
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
        <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertOrderedList")} title={t(locale, "Numbered list")} aria-label={t(locale, "Numbered list")}>
          <ListOrdered className="size-3.5" />
        </button>
        <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={insertLink} title={t(locale, "Insert link")} aria-label={t(locale, "Insert link")}>
          <Link2 className="size-3.5" />
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
          style={{ minHeight: compact ? 28 : rows * 20 }}
        />
      )}
    </div>
  );
}
