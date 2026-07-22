"use client";

import { useState } from "react";
import { EMPTY_FILTERS, type ListFilterState } from "./filter-types";

// Batch B — client-side list filtering shared by all 8 document lists. The list page loads
// every non-deleted row for the org (tenant-scoped in SQL); this hook narrows that set by the
// active filters. Export re-applies the same filters server-side, so the two stay consistent.
export type ListAccessors<T> = {
  search: (r: T) => string[];
  status: (r: T) => string;
  party: (r: T) => string;
  date: (r: T) => string; // "YYYY-MM-DD" (or "" when absent)
  archived: (r: T) => boolean;
};

export function useListFilters<T>(rows: T[], acc: ListAccessors<T>) {
  const [filters, setFilters] = useState<ListFilterState>(EMPTY_FILTERS);

  const q = filters.search.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (q && !acc.search(r).some((s) => (s ?? "").toLowerCase().includes(q))) return false;
    if (filters.status && acc.status(r) !== filters.status) return false;
    if (filters.party && acc.party(r) !== filters.party) return false;
    const d = acc.date(r);
    if (filters.dateFrom && (!d || d < filters.dateFrom)) return false;
    if (filters.dateTo && (!d || d > filters.dateTo)) return false;
    const arch = acc.archived(r);
    if (filters.archived === "active" && arch) return false;
    if (filters.archived === "archived" && !arch) return false;
    return true;
  });

  return { filters, setFilters, filtered };
}
