"use client";

import { Bold, Italic, Underline, List, X } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";

export function NoteBox({
  locale,
  label,
  value,
  onChange,
}: {
  locale: Locale;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[11.5px] font-semibold text-ink-muted mb-1.5">{label}</label>
      <div className="rounded-xl border border-line-strong overflow-hidden">
        <div className="flex items-center gap-0.5 px-2 py-1.5 bg-surface-raised border-b border-line text-ink-muted">
          <span className="size-[26px] rounded-md inline-flex items-center justify-center opacity-60">
            <Bold className="size-3.5" />
          </span>
          <span className="size-[26px] rounded-md inline-flex items-center justify-center opacity-60">
            <Italic className="size-3.5" />
          </span>
          <span className="size-[26px] rounded-md inline-flex items-center justify-center opacity-60">
            <Underline className="size-3.5" />
          </span>
          <span className="size-[26px] rounded-md inline-flex items-center justify-center opacity-60">
            <List className="size-3.5" />
          </span>
          <span className="ms-auto size-[26px] rounded-md inline-flex items-center justify-center opacity-60">
            <X className="size-3.5" />
          </span>
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder={t(locale, "Write a note…")}
          className="w-full px-3.5 py-2.5 text-[12.5px] text-ink-muted leading-relaxed outline-none resize-none bg-transparent"
        />
      </div>
    </div>
  );
}
