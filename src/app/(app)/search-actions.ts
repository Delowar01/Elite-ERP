"use server";

import { requireSession } from "@/lib/session";
import { searchRecords, type SearchResult } from "@/lib/global-search";

// Tenant-scoped global record search for the command palette. Returns [] for short queries.
export async function globalSearchAction(query: string): Promise<SearchResult[]> {
  const session = await requireSession();
  return searchRecords(session.orgId, query);
}
