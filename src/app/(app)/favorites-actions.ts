"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, favoritesTable } from "@/db";
import { requireSession } from "@/lib/session";

export type FavoriteResult = { error?: string; favorited?: boolean };

// Toggle the given in-app page as a favorite for the current user. Idempotent per (org,user,href).
// Only relative in-app paths are accepted (no external URLs).
export async function toggleFavoriteAction(label: string, href: string): Promise<FavoriteResult> {
  const session = await requireSession();
  const cleanHref = href.trim();
  const cleanLabel = label.trim();
  if (!cleanHref.startsWith("/") || cleanHref.startsWith("//")) return { error: "Invalid link." };
  if (!cleanLabel) return { error: "Label is required." };

  const [existing] = await db
    .select({ id: favoritesTable.id })
    .from(favoritesTable)
    .where(and(eq(favoritesTable.orgId, session.orgId), eq(favoritesTable.userId, session.userId), eq(favoritesTable.href, cleanHref)));

  if (existing) {
    await db.delete(favoritesTable).where(eq(favoritesTable.id, existing.id));
    revalidatePath("/", "layout");
    return { favorited: false };
  }
  await db.insert(favoritesTable).values({ orgId: session.orgId, userId: session.userId, label: cleanLabel, href: cleanHref });
  revalidatePath("/", "layout");
  return { favorited: true };
}

// Remove a favorite by id (scoped to the current user).
export async function removeFavoriteAction(id: number): Promise<FavoriteResult> {
  const session = await requireSession();
  await db.delete(favoritesTable).where(and(eq(favoritesTable.id, id), eq(favoritesTable.orgId, session.orgId), eq(favoritesTable.userId, session.userId)));
  revalidatePath("/", "layout");
  return {};
}
