"use client";

import { ChevronDown, FileText, Eye } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { t, type Locale } from "@/lib/i18n/dict";

// Top titlebar actions shared by every creation page: Save as Draft, a Preview & Print button, and
// a functional More Actions dropdown (Preview & Print, Save as Draft). Every option works — no
// decorative controls, no redirect. The preview modal itself is owned by the form (one instance,
// opened via onPreview) so the bottom action bar and this menu share it.
export function DocTopActions({ locale, busy, onSaveDraft, onPreview }: { locale: Locale; busy: boolean; onSaveDraft: () => void; onPreview: () => void }) {
  return (
    <div className="doc-titlebar-actions">
      <button type="button" className="btn btn-glass" disabled={busy} onClick={onSaveDraft}>
        {t(locale, "Save as Draft")}
      </button>
      <button type="button" className="btn btn-glass" onClick={onPreview}>
        <FileText className="size-3.5" /> {t(locale, "Preview & Print")}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger className="btn btn-glass outline-none" aria-label={t(locale, "More Actions")}>
          {t(locale, "More Actions")} <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem className="cursor-pointer" onSelect={onPreview}>
            <Eye className="size-3.5" /> {t(locale, "Preview & Print")}
          </DropdownMenuItem>
          <DropdownMenuItem className="cursor-pointer" onSelect={onSaveDraft} disabled={busy}>
            <FileText className="size-3.5" /> {t(locale, "Save as Draft")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
