"use client";

import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import type { RowMenuEntry } from "../sales/_shared/row-menu";
import { t, type Locale } from "@/lib/i18n/dict";
import type { DocumentType, RecordState } from "@/lib/document-lifecycle";
import { DOC_EDIT_CONFIG, canEditDocument, editHrefFor } from "@/lib/document-edit";
import { useConfirm } from "./confirm-provider";

/**
 * The Edit action, shared by the list three-dot menu and the document Preview action bar.
 *
 * Both entry points use the same availability rule (`canEditDocument`) and the same app-wide
 * confirmation dialog (`useConfirm`, policy key `document.edit`) before navigating to the edit route
 * that already exists. There is no second copy of the rule, the wording, or the popup.
 */

export function useDocumentEditAction(locale: Locale) {
  const confirm = useConfirm();
  const router = useRouter();

  function requestEdit(docType: DocumentType, id: number, number: string) {
    confirm({
      action: "document.edit",
      entityType: DOC_EDIT_CONFIG[docType].typeLabel,
      entityNumber: number,
      navigatesOnSuccess: true,
      onConfirm: () => {
        router.push(editHrefFor(docType, id));
      },
    });
  }

  /** Spread into a row's menu entries. Empty when the document is not editable, so no dead item. */
  function editEntry(docType: DocumentType, id: number, number: string, status: string, isArchived?: boolean): RowMenuEntry[] {
    const recordState: RecordState = isArchived ? "archived" : "active";
    if (!canEditDocument(docType, { status, recordState })) return [];
    return [
      {
        kind: "item",
        icon: Pencil,
        label: t(locale, "Edit"),
        // Deliberately not an href: clicking must open the confirmation, not navigate.
        onSelect: () => requestEdit(docType, id, number),
      },
    ];
  }

  return { editEntry, requestEdit };
}

/**
 * For the document Preview action bar (Edit | Download PDF | Convert to…). Same rule, same dialog —
 * renders nothing when the document is not editable.
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
  const { requestEdit } = useDocumentEditAction(locale);
  if (!canEditDocument(docType, { status, recordState })) return null;

  return (
    // Same literal button styling as the neighbouring Download PDF control.
    <button
      type="button"
      className="btn btn-glass"
      style={{ width: "auto", padding: "0 14px" }}
      onClick={() => requestEdit(docType, id, number)}
    >
      <Pencil className="size-4 me-1.5" /> {t(locale, "Edit")}
    </button>
  );
}
