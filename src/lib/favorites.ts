import "server-only";
import { and, eq, desc } from "drizzle-orm";
import { db, favoritesTable } from "@/db";

export type FavoriteItem = { id: number; label: string; href: string };

// Per-user favorites for the global shell — tenant- AND user-scoped.
export async function getFavorites(orgId: number, userId: number): Promise<FavoriteItem[]> {
  const rows = await db
    .select({ id: favoritesTable.id, label: favoritesTable.label, href: favoritesTable.href })
    .from(favoritesTable)
    .where(and(eq(favoritesTable.orgId, orgId), eq(favoritesTable.userId, userId)))
    .orderBy(desc(favoritesTable.id));
  return rows;
}
