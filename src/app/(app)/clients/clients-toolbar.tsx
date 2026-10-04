"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ListSearch } from "@/components/ui/list-search";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { FilterPanel } from "@/components/ui/filter-panel";
import { t, type Locale } from "@/lib/i18n/dict";

// Search box + Advanced Filter (currently just "Include Archived", the first real soft-delete
// filter) — both client-navigate via the URL so the list page (a Server Component) re-fetches
// with the new params, matching the existing q= search pattern rather than introducing a
// separate client-fetch code path for a list this small.
export function ClientsToolbar({ locale, defaultQ, defaultArchived }: { locale: Locale; defaultQ?: string; defaultArchived?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState(defaultQ ?? "");
  const [archived, setArchived] = useState(defaultArchived ?? false);

  function navigate(nextQ: string, nextArchived: boolean) {
    const params = new URLSearchParams();
    if (nextQ) params.set("q", nextQ);
    if (nextArchived) params.set("archived", "1");
    router.push(`/clients${params.toString() ? `?${params}` : ""}`);
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {/* Search still runs on Enter, through the URL (?q=) — unchanged. */}
      <ListSearch
        value={q}
        onChange={setQ}
        onKeyDown={(e) => e.key === "Enter" && navigate(q, archived)}
        placeholder={t(locale, "Search clients…")}
        label={t(locale, "Search clients…")}
      />
      <FilterPanel
        triggerLabel={t(locale, "Filters")}
        applyLabel={t(locale, "Apply Filters")}
        clearLabel={t(locale, "Clear")}
        hasActiveFilters={archived}
        activeCount={archived ? 1 : 0}
        onApply={() => navigate(q, archived)}
        onClear={() => {
          setArchived(false);
          navigate(q, false);
        }}
      >
        <div className="flex items-center gap-2.5">
          <Checkbox id="include-archived" checked={archived} onCheckedChange={(v) => setArchived(v === true)} />
          <Label htmlFor="include-archived" className="cursor-pointer">
            {t(locale, "Include archived clients")}
          </Label>
        </div>
      </FilterPanel>
    </div>
  );
}
