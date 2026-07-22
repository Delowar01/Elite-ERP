"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import type { RowMenuEntry } from "../sales/_shared/row-menu";
import { t, type Locale } from "@/lib/i18n/dict";
import { can, type DocumentType } from "@/lib/document-lifecycle";
import { archiveDocumentAction, unarchiveDocumentAction, softDeleteDocumentAction } from "./lifecycle-actions";

/**
 * Batch A3 — the Archive/Unarchive + Delete (soft) row-menu entries shared by all
 * 8 document list screens. The client gates each entry with the same A1 `can()`
 * rule the server re-checks: Archive is offered when archivable, Unarchive when
 * already archived, and Delete (soft) only when soft_delete is status-permitted
 * (the server additionally enforces the downstream-reference guard, which the
 * client cannot see without extra queries).
 */
export function useDocumentRowActions(locale: Locale) {
  const [, startTransition] = useTransition();

  function run(action: (docType: DocumentType, id: number) => Promise<{ error?: string }>, docType: DocumentType, id: number) {
    startTransition(async () => {
      const result = await action(docType, id);
      if (result?.error) toast.error(result.error);
    });
  }

  return function entries(docType: DocumentType, id: number, status: string, isArchived: boolean): RowMenuEntry[] {
    const items: RowMenuEntry[] = [];

    if (isArchived) {
      items.push({ kind: "item", icon: ArchiveRestore, label: t(locale, "Unarchive"), onSelect: () => run(unarchiveDocumentAction, docType, id) });
    } else {
      const archivable = can(docType, status, "archive", { recordState: "active" });
      items.push({ kind: "item", icon: Archive, label: t(locale, "Archive"), onSelect: archivable ? () => run(archiveDocumentAction, docType, id) : undefined });
    }

    const deletable = can(docType, status, "soft_delete", { recordState: isArchived ? "archived" : "active" });
    items.push({
      kind: "item",
      icon: Trash2,
      label: t(locale, "Delete"),
      danger: true,
      onSelect: deletable ? () => run(softDeleteDocumentAction, docType, id) : undefined,
    });

    return items;
  };
}
