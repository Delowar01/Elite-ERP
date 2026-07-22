"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { evaluate, type DocumentType } from "@/lib/document-lifecycle";
import { docAdmin, recordStateOf } from "@/lib/document-registry";

/**
 * Batch A3 — generic Archive / Recycle-Bin server actions for all 8 document
 * types. Every rule is decided by the Batch A1 lifecycle module (`evaluate`),
 * fed the live record-state (active/archived/deleted), the actor's role, and
 * whether the document is referenced downstream. Accounting, inventory, and
 * business status are never touched here — only the orthogonal record-state
 * columns (archivedAt / deletedAt). Every action writes one audit-log row.
 */

export type LifecycleActionResult = { error?: string };

function revalidate(paths: string[], extra: string) {
  for (const p of paths) revalidatePath(p);
  revalidatePath(extra);
}

export async function archiveDocumentAction(docType: DocumentType, id: number): Promise<LifecycleActionResult> {
  const session = await requireSession();
  const entry = docAdmin(docType);
  const state = await entry.loadState(session.orgId, id);
  if (!state) return { error: "Document not found." };
  if (state.deletedAt) return { error: "This document is in the Recycle Bin; restore it before archiving." };
  if (state.archivedAt) return { error: "This document is already archived." };

  const decision = evaluate(docType, state.status, "archive", { recordState: "active" });
  if (!decision.allowed) return { error: decision.reason };

  await entry.setArchivedAt(session.orgId, id, new Date());
  await logActivity(session, { type: `${docType}.archived`, description: `Archived ${entry.typeLabel} ${state.number}`, entityType: docType, entityId: id });
  revalidate(entry.revalidatePaths, entry.detailHref(id));
  return {};
}

export async function unarchiveDocumentAction(docType: DocumentType, id: number): Promise<LifecycleActionResult> {
  const session = await requireSession();
  const entry = docAdmin(docType);
  const state = await entry.loadState(session.orgId, id);
  if (!state) return { error: "Document not found." };
  if (state.deletedAt) return { error: "This document is in the Recycle Bin; restore it instead." };
  if (!state.archivedAt) return { error: "This document is not archived." };

  await entry.setArchivedAt(session.orgId, id, null);
  await logActivity(session, { type: `${docType}.unarchived`, description: `Unarchived ${entry.typeLabel} ${state.number}`, entityType: docType, entityId: id });
  revalidate(entry.revalidatePaths, entry.detailHref(id));
  return {};
}

export async function softDeleteDocumentAction(docType: DocumentType, id: number): Promise<LifecycleActionResult> {
  const session = await requireSession();
  const entry = docAdmin(docType);
  const state = await entry.loadState(session.orgId, id);
  if (!state) return { error: "Document not found." };
  if (state.deletedAt) return { error: "This document is already in the Recycle Bin." };

  const isReferenced = (await entry.countReferences(session.orgId, id)) > 0;
  // Posted/finalized documents are rejected here; reference-guard enforced for statuses that require it.
  const decision = evaluate(docType, state.status, "soft_delete", { recordState: recordStateOf(state), isReferenced });
  if (!decision.allowed) return { error: decision.reason };

  await entry.setDeletedAt(session.orgId, id, new Date());
  await logActivity(session, { type: `${docType}.deleted`, description: `Moved ${entry.typeLabel} ${state.number} to the Recycle Bin`, entityType: docType, entityId: id });
  revalidate(entry.revalidatePaths, entry.detailHref(id));
  return {};
}

export async function restoreDocumentAction(docType: DocumentType, id: number): Promise<LifecycleActionResult> {
  const session = await requireSession();
  const entry = docAdmin(docType);
  const state = await entry.loadState(session.orgId, id);
  if (!state) return { error: "Document not found." };
  if (!state.deletedAt) return { error: "This document is not in the Recycle Bin." };

  const decision = evaluate(docType, state.status, "restore", { recordState: "deleted" });
  if (!decision.allowed) return { error: decision.reason };

  await entry.setDeletedAt(session.orgId, id, null);
  await logActivity(session, { type: `${docType}.restored`, description: `Restored ${entry.typeLabel} ${state.number} from the Recycle Bin`, entityType: docType, entityId: id });
  revalidate(entry.revalidatePaths, entry.detailHref(id));
  return {};
}

export async function permanentDeleteDocumentAction(docType: DocumentType, id: number): Promise<LifecycleActionResult> {
  const session = await requireSession();
  const entry = docAdmin(docType);
  const state = await entry.loadState(session.orgId, id);
  if (!state) return { error: "Document not found." };

  const isReferenced = (await entry.countReferences(session.orgId, id)) > 0;
  // Owner-only, draft-only, unposted, unreferenced, and only from the Recycle Bin — all decided by A1.
  const decision = evaluate(docType, state.status, "permanent_delete", { role: session.role, recordState: recordStateOf(state), isReferenced });
  if (!decision.allowed) return { error: decision.reason };

  // Audit first so the document number survives in the immutable log; the numbering
  // sequence is never rolled back, so the number is never reused.
  await logActivity(session, {
    type: `${docType}.permanently_deleted`,
    description: `Permanently deleted ${entry.typeLabel} ${state.number} (number retained in audit log, never reissued)`,
    entityType: docType,
    entityId: id,
  });
  await entry.hardDelete(session.orgId, id);
  revalidate(entry.revalidatePaths, entry.detailHref(id));
  return {};
}
