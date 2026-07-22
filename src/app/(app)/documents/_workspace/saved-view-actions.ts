"use server";

import { and, eq, asc } from "drizzle-orm";
import { db, savedViewsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { DOCUMENT_TYPES } from "@/lib/document-lifecycle";
import type { ListFilterState } from "./filter-types";

/**
 * Batch B — Saved Views. Each view is tenant- AND user-scoped: every query filters on both
 * orgId and userId, so a view is invisible to any other user or org. Save/rename/delete are
 * audited. No effect on documents themselves.
 */

export type SavedViewDTO = { id: number; name: string; config: ListFilterState };
export type SavedViewResult = { error?: string; id?: number };

function validModule(m: string): boolean {
  return (DOCUMENT_TYPES as readonly string[]).includes(m);
}

export async function listSavedViews(module: string): Promise<SavedViewDTO[]> {
  const session = await requireSession();
  if (!validModule(module)) return [];
  const rows = await db
    .select({ id: savedViewsTable.id, name: savedViewsTable.name, config: savedViewsTable.config })
    .from(savedViewsTable)
    .where(and(eq(savedViewsTable.orgId, session.orgId), eq(savedViewsTable.userId, session.userId), eq(savedViewsTable.module, module)))
    .orderBy(asc(savedViewsTable.name));
  return rows.map((r) => ({ id: r.id, name: r.name, config: r.config as ListFilterState }));
}

export async function saveViewAction(module: string, name: string, config: ListFilterState): Promise<SavedViewResult> {
  const session = await requireSession();
  if (!validModule(module)) return { error: "Unknown module." };
  const trimmed = name.trim();
  if (!trimmed) return { error: "View name is required." };
  if (trimmed.length > 60) return { error: "View name is too long." };

  const [existing] = await db
    .select({ id: savedViewsTable.id })
    .from(savedViewsTable)
    .where(and(eq(savedViewsTable.orgId, session.orgId), eq(savedViewsTable.userId, session.userId), eq(savedViewsTable.module, module), eq(savedViewsTable.name, trimmed)));

  let id: number;
  if (existing) {
    await db.update(savedViewsTable).set({ config, updatedAt: new Date() }).where(eq(savedViewsTable.id, existing.id));
    id = existing.id;
  } else {
    const [row] = await db.insert(savedViewsTable).values({ orgId: session.orgId, userId: session.userId, module, name: trimmed, config }).returning({ id: savedViewsTable.id });
    id = row.id;
  }
  await logActivity(session, { type: "saved_view.saved", description: `Saved list view "${trimmed}" for ${module}`, entityType: "saved_view", entityId: id });
  return { id };
}

export async function renameViewAction(id: number, name: string): Promise<SavedViewResult> {
  const session = await requireSession();
  const trimmed = name.trim();
  if (!trimmed) return { error: "View name is required." };
  const result = await db
    .update(savedViewsTable)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(and(eq(savedViewsTable.id, id), eq(savedViewsTable.orgId, session.orgId), eq(savedViewsTable.userId, session.userId)))
    .returning({ id: savedViewsTable.id });
  if (!result.length) return { error: "View not found." };
  await logActivity(session, { type: "saved_view.renamed", description: `Renamed list view to "${trimmed}"`, entityType: "saved_view", entityId: id });
  return { id };
}

export async function deleteViewAction(id: number): Promise<SavedViewResult> {
  const session = await requireSession();
  const result = await db
    .delete(savedViewsTable)
    .where(and(eq(savedViewsTable.id, id), eq(savedViewsTable.orgId, session.orgId), eq(savedViewsTable.userId, session.userId)))
    .returning({ id: savedViewsTable.id });
  if (!result.length) return { error: "View not found." };
  await logActivity(session, { type: "saved_view.deleted", description: "Deleted a list view", entityType: "saved_view", entityId: id });
  return { id };
}
