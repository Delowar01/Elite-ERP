"use client";

import { FileSignature, FileText, Paperclip, GripVertical, X, Plus, Bold, Italic, Underline, List } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";

const TERM_GROUPS: Record<string, { name: string; terms: string[] }> = {
  "group-a": {
    name: "Group A — Standard Sales Terms",
    terms: [
      "Lorem Ipsum is simply dummy text of the printing and typesetting industry, standard since the 1500s.",
      "Prices are valid for the period stated above and are subject to change thereafter.",
      "Delivery timelines are estimates and may vary based on stock availability.",
    ],
  },
  "group-b": {
    name: "Group B — Tax Invoice Terms",
    terms: [
      "Payment is due in full within the payment terms stated on this invoice.",
      "A late payment fee of 2% per month applies to overdue balances.",
      "Goods remain the property of the seller until payment is received in full.",
    ],
  },
  "group-c": {
    name: "Group C — Purchase Terms",
    terms: [
      "Goods must match the specifications and quantities stated on this purchase order.",
      "Vendor is responsible for delivery to the address stated above within the agreed timeframe.",
      "Any discrepancy must be reported within 48 hours of receipt.",
    ],
  },
};

// Matches the mockup's terms_notes_block() exactly: .doc-tabbar, the resolved term
// group's name + "Change Group" pill, .term-group-row × N (numbered, decorative — the
// Term Groups library itself isn't wired to real data yet, same scope decision as v18),
// .doc-add-links, then the real .doc-note-box (wired to the document's actual notes field).
export function TermsBlock({
  locale,
  groupKey,
  notes,
  onNotesChange,
}: {
  locale: Locale;
  groupKey: "group-a" | "group-b" | "group-c";
  notes: string;
  onNotesChange: (v: string) => void;
}) {
  const group = TERM_GROUPS[groupKey];
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
      <div className="flex items-center justify-between mb-2.5">
        <div className="text-[12.5px] font-bold text-ink">{t(locale, group.name)}</div>
        <div className="doc-pill-btn" style={{ height: 30, fontSize: 11.5 }}>
          {t(locale, "Change Group")}
        </div>
      </div>
      {group.terms.map((term, i) => (
        <div className="term-group-row" key={i}>
          <span className="grip">
            <GripVertical className="size-3.5" />
          </span>
          <div className="tg-text">
            <b>
              {t(locale, "Term")} {i + 1}:
            </b>{" "}
            {t(locale, term)}
          </div>
          <span className="tg-remove">
            <X className="size-3.5" />
          </span>
        </div>
      ))}
      <div className="doc-add-links">
        <span>
          <Plus className="size-3" /> {t(locale, "Add New Term")}
        </span>
        <span>
          <Plus className="size-3" /> {t(locale, "Add New Group")}
        </span>
      </div>
      <div className="doc-note-box">
        <div className="rte-toolbar">
          <button type="button" disabled>
            <Bold className="size-3.5" />
          </button>
          <button type="button" disabled>
            <Italic className="size-3.5" />
          </button>
          <button type="button" disabled>
            <Underline className="size-3.5" />
          </button>
          <button type="button" disabled>
            <List className="size-3.5" />
          </button>
          <button type="button" className="rte-close" disabled>
            <X className="size-3.5" />
          </button>
        </div>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={3}
          placeholder={t(locale, "Write a note…")}
          className="rte-body w-full outline-none resize-none bg-transparent"
        />
      </div>
    </div>
  );
}
