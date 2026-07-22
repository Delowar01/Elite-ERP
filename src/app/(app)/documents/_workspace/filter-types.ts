// Batch B — shared list-filter state, used by the client filter hook, the Saved Views
// config, and the server-side export query. Kept dependency-free so both client and
// server modules can import it.

export type ListArchivedFilter = "all" | "active" | "archived";

export type ListFilterState = {
  search: string;
  status: string; // "" = any status, else an exact status value
  dateFrom: string; // "" or YYYY-MM-DD (inclusive)
  dateTo: string; // "" or YYYY-MM-DD (inclusive)
  party: string; // "" = any, else exact client/vendor name
  archived: ListArchivedFilter;
};

export const EMPTY_FILTERS: ListFilterState = {
  search: "",
  status: "",
  dateFrom: "",
  dateTo: "",
  party: "",
  archived: "all",
};

export function filtersActive(f: ListFilterState): boolean {
  return Boolean(f.search || f.status || f.dateFrom || f.dateTo || f.party || f.archived !== "all");
}

/** Parse a ListFilterState from URLSearchParams (used by the export route). */
export function filtersFromParams(p: URLSearchParams): ListFilterState {
  const archived = p.get("archived");
  return {
    search: p.get("search") ?? "",
    status: p.get("status") ?? "",
    dateFrom: p.get("dateFrom") ?? "",
    dateTo: p.get("dateTo") ?? "",
    party: p.get("party") ?? "",
    archived: archived === "active" || archived === "archived" ? archived : "all",
  };
}

/** Serialize a ListFilterState to a query string (only non-empty keys). */
export function filtersToParams(f: ListFilterState): string {
  const p = new URLSearchParams();
  if (f.search) p.set("search", f.search);
  if (f.status) p.set("status", f.status);
  if (f.dateFrom) p.set("dateFrom", f.dateFrom);
  if (f.dateTo) p.set("dateTo", f.dateTo);
  if (f.party) p.set("party", f.party);
  if (f.archived !== "all") p.set("archived", f.archived);
  return p.toString();
}
