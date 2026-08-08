"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Trash2, Copy, Star, StarOff } from "lucide-react";
import type { RowMenuEntry } from "../sales/_shared/row-menu";
import { t, type Locale } from "@/lib/i18n/dict";
import { can, type DocumentType } from "@/lib/document-lifecycle";
import { archiveDocumentAction, unarchiveDocumentAction, softDeleteDocumentAction } from "./lifecycle-actions";
import { duplicateDocumentAction } from "./duplicate-actions";
import { isDuplicableType } from "@/lib/document-duplicate";
import { DOCUMENT_DETAIL_HREF } from "@/lib/document-hrefs";
import { useFavoriteHrefs } from "./favorites-context";
import { toggleFavoriteAction } from "../favorites-actions";
import { useConfirm } from "./confirm-provider";
import { DOC_EDIT_CONFIG } from "@/lib/document-edit";

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
  const favoriteHrefs = useFavoriteHrefs();
  const confirm = useConfirm();

  // Unarchive is a plain restore with no consequence, so it runs straight away (see the policy's
  // NON_SENSITIVE_ACTIONS list). Archive and Delete both change what the org can see, so both ask.
  function run(action: (docType: DocumentType, id: number) => Promise<{ error?: string }>, docType: DocumentType, id: number) {
    startTransition(async () => {
      const result = await action(docType, id);
      if (result?.error) toast.error(result.error);
    });
  }

  function ask(
    kind: "document.archive" | "document.delete",
    docType: DocumentType,
    id: number,
    number: string,
    action: (docType: DocumentType, id: number) => Promise<{ error?: string }>,
  ) {
    confirm({
      action: kind,
      entityType: DOC_EDIT_CONFIG[docType].typeLabel,
      entityNumber: number,
      onConfirm: async () => {
        const result = await action(docType, id);
        if (result?.error) return result;
      },
    });
  }

  // Not confirmed on purpose: the policy lists addToFavorites among the actions that must never
  // ask, and this one is reversed by clicking the very same row again.
  function toggleFavorite(href: string, label: string) {
    startTransition(async () => {
      const result = await toggleFavoriteAction(label, href);
      if (result?.error) toast.error(result.error);
      else toast.success(t(locale, result.favorited ? "Added to favorites." : "Removed from favorites."));
    });
  }

  // Duplicating redirects to the new draft's builder, so — exactly like a conversion — the promise
  // never resolves on the happy path and the dialog holds its working state until the new page
  // takes over. Only a refusal comes back, and that keeps the dialog open and retry-able.
  function askDuplicate(docType: DocumentType, id: number, number: string) {
    confirm({
      action: "document.duplicate",
      entityType: DOC_EDIT_CONFIG[docType].typeLabel,
      entityNumber: number,
      navigatesOnSuccess: true,
      onConfirm: () =>
        new Promise<{ error?: string } | void>((resolve) => {
          startTransition(async () => {
            const result = await duplicateDocumentAction(docType, id);
            if (result?.error) resolve({ error: result.error });
          });
        }),
    });
  }

  return function entries(docType: DocumentType, id: number, status: string, isArchived: boolean, number = ""): RowMenuEntry[] {
    const items: RowMenuEntry[] = [];

    // Favorite / unfavorite. Two-way: the label follows the current state, so the same row never
    // offers an action that silently does nothing. Available on all 8 types — a delivery challan is
    // as worth pinning as an invoice.
    const href = DOCUMENT_DETAIL_HREF[docType](id);
    const favorited = favoriteHrefs.has(href);
    items.push({
      kind: "item",
      icon: favorited ? StarOff : Star,
      label: t(locale, favorited ? "Remove from Favorites" : "Add to Favorites"),
      onSelect: () => toggleFavorite(href, number || DOC_EDIT_CONFIG[docType].typeLabel),
    });

    // Duplicate — offered only for the six types where a copy is safe. Credit and Debit Notes are
    // omitted entirely (not shown disabled): their source binding is mandatory, so a copy would be
    // a second identical reversal against the same invoice/PO, one click from a wrong ledger.
    if (isDuplicableType(docType) && can(docType, status, "duplicate", { recordState: isArchived ? "archived" : "active" })) {
      items.push({
        kind: "item",
        icon: Copy,
        label: t(locale, "Duplicate"),
        onSelect: () => askDuplicate(docType, id, number),
      });
    }

    if (isArchived) {
      items.push({ kind: "item", icon: ArchiveRestore, label: t(locale, "Unarchive"), onSelect: () => run(unarchiveDocumentAction, docType, id) });
    } else {
      const archivable = can(docType, status, "archive", { recordState: "active" });
      items.push({ kind: "item", icon: Archive, label: t(locale, "Archive"), onSelect: archivable ? () => ask("document.archive", docType, id, number, archiveDocumentAction) : undefined });
    }

    const deletable = can(docType, status, "soft_delete", { recordState: isArchived ? "archived" : "active" });
    items.push({
      kind: "item",
      icon: Trash2,
      label: t(locale, "Delete"),
      danger: true,
      onSelect: deletable ? () => ask("document.delete", docType, id, number, softDeleteDocumentAction) : undefined,
    });

    return items;
  };
}
