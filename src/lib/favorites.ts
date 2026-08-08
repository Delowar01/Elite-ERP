import "server-only";
import { and, eq, desc } from "drizzle-orm";
import { db, favoritesTable } from "@/db";

export type FavoriteItem = { id: number; label: string; href: string };

/**
 * Ceiling on favorites per user. The top-bar menu itself scrolls, so this is not about the menu —
 * it is because the app layout loads this list on every single request, and an unbounded pin list
 * would grow that cost forever. Enforced on write (with a clear message) and mirrored on read, so
 * a user can never accumulate entries the menu would silently drop.
 */
export const MAX_FAVORITES = 100;

// Per-user favorites for the global shell — tenant- AND user-scoped.
export async function getFavorites(orgId: number, userId: number): Promise<FavoriteItem[]> {
  const rows = await db
    .select({ id: favoritesTable.id, label: favoritesTable.label, href: favoritesTable.href })
    .from(favoritesTable)
    .where(and(eq(favoritesTable.orgId, orgId), eq(favoritesTable.userId, userId)))
    .orderBy(desc(favoritesTable.id))
    .limit(MAX_FAVORITES);
  return rows;
}
