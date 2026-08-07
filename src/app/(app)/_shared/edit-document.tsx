"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { RowMenuEntry } from "../sales/_shared/row-menu";
import { t, type Locale } from "@/lib/i18n/dict";
import type { DocumentType, RecordState } from "@/lib/document-lifecycle";
import { DOC_EDIT_CONFIG, canEditDocument, editHrefFor } from "@/lib/document-edit";

/**
 * The Edit action, shared by the list three-dot menu and the document Preview action bar.
 *
 * Both entry points call the same availability rule (`canEditDocument`), open the same confirmation
 * dialog, and navigate to the same existing edit route — there is no second copy of any of it. The
 * dialog is the app's own Radix dialog (solid surface, themed tokens, Escape to close, focus trap,
 * RTL-aware), never `window.confirm`.
 *
 * Navigation happens in the same tab via the router and nothing is created or duplicated on the way
 * — Continue to Edit is a plain navigation to the edit page that already exists.
 */

export type EditTarget = {
  docType: DocumentType;
  id: number;
  /** The document's human number, shown in the dialog title. */
  number: string;
};

export function EditConfirmDialog({
  locale,
  target,
  onOpenChange,
}: {
  locale: Locale;
  target: EditTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  // Guards against a double-click firing two navigations; also drives the button's busy state.
  const [navigating, setNavigating] = useState(false);

  function confirm() {
    if (!target || navigating) return;
    setNavigating(true);
    router.push(editHrefFor(target.docType, target.id));
  }

  const typeLabel = target ? t(locale, DOC_EDIT_CONFIG[target.docType].typeLabel) : "";

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) setNavigating(false);
        onOpenChange(open);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {target?.number
              ? `${t(locale, "Edit")} ${typeLabel} ${target.number}?`
              : t(locale, "Edit this document?")}
          </DialogTitle>
          <DialogDescription>
            {t(
              locale,
              "You are about to edit this document. Any changes you save may update the document details. Do you want to continue?",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={navigating}>
            {t(locale, "Cancel")}
          </Button>
          <Button onClick={confirm} disabled={navigating}>
            {navigating ? t(locale, "Opening…") : t(locale, "Continue to Edit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * For list screens: one dialog per table, plus a builder for the row-menu entry.
 *
 * Render `dialog` once inside the list, and spread `editEntry(...)` into the row's menu entries.
 * The entry is omitted entirely when the document is not editable, so an unusable Edit item never
 * appears (and the menu never shows two of them).
 */
export function useDocumentEditAction(locale: Locale) {
  const [target, setTarget] = useState<EditTarget | null>(null);

  function editEntry(docType: DocumentType, id: number, number: string, status: string, isArchived?: boolean): RowMenuEntry[] {
    const recordState: RecordState = isArchived ? "archived" : "active";
    if (!canEditDocument(docType, { status, recordState })) return [];
    return [
      {
        kind: "item",
        icon: Pencil,
        label: t(locale, "Edit"),
        // Deliberately not an href: clicking must open the confirmation, not navigate.
        onSelect: () => setTarget({ docType, id, number }),
      },
    ];
  }

  const dialog = <EditConfirmDialog locale={locale} target={target} onOpenChange={(open) => !open && setTarget(null)} />;

  return { editEntry, dialog };
}

/**
 * For the document Preview action bar (Edit | Download PDF | Convert To). Same rule, same dialog —
 * it renders nothing at all when the document is not editable.
 */
export function EditDocumentButton({
  locale,
  docType,
  id,
  number,
  status,
  recordState = "active",
}: {
  locale: Locale;
  docType: DocumentType;
  id: number;
  number: string;
  status: string;
  recordState?: RecordState;
}) {
  const [target, setTarget] = useState<EditTarget | null>(null);
  if (!canEditDocument(docType, { status, recordState })) return null;

  return (
    <>
      {/* Same literal button styling as the neighbouring Download PDF control. */}
      <button
        type="button"
        className="btn btn-glass"
        style={{ width: "auto", padding: "0 14px" }}
        onClick={() => setTarget({ docType, id, number })}
      >
        <Pencil className="size-4 me-1.5" /> {t(locale, "Edit")}
      </button>
      <EditConfirmDialog locale={locale} target={target} onOpenChange={(open) => !open && setTarget(null)} />
    </>
  );
}
