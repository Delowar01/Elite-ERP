"use client";

import { createContext, useContext, useMemo } from "react";

/**
 * The set of routes the current user has favorited, published once by the app layout (which already
 * loads favorites for the top-bar menu) so any screen can tell whether a given record is pinned
 * without its own query.
 *
 * Favorites are stored as a (label, href) pair, and a document's detail route is its stable
 * identity, so membership of this set is exactly "is this document favorited".
 */
const FavoriteHrefsContext = createContext<ReadonlySet<string>>(new Set());

export function FavoriteHrefsProvider({ hrefs, children }: { hrefs: string[]; children: React.ReactNode }) {
  const set = useMemo(() => new Set(hrefs), [hrefs]);
  return <FavoriteHrefsContext.Provider value={set}>{children}</FavoriteHrefsContext.Provider>;
}

/** The user's favorited routes. A list screen checks many rows against it, so it hands back the set. */
export function useFavoriteHrefs(): ReadonlySet<string> {
  return useContext(FavoriteHrefsContext);
}
