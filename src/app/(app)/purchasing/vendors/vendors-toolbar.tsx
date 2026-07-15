"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { FilterPanel } from "@/components/ui/filter-panel";

export function VendorsToolbar({ defaultQ, defaultArchived }: { defaultQ?: string; defaultArchived?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState(defaultQ ?? "");
  const [archived, setArchived] = useState(defaultArchived ?? false);

  function navigate(nextQ: string, nextArchived: boolean) {
    const params = new URLSearchParams();
    if (nextQ) params.set("q", nextQ);
    if (nextArchived) params.set("archived", "1");
    router.push(`/purchasing/vendors${params.toString() ? `?${params}` : ""}`);
  }

  return (
    <div className="mb-4 flex items-center gap-3">
      <div className="relative max-w-xs w-full">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-faint" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && navigate(q, archived)}
          placeholder="Search vendors…"
          className="pl-9"
        />
      </div>
      <FilterPanel
        triggerLabel="Filters"
        hasActiveFilters={archived}
        onApply={() => navigate(q, archived)}
        onClear={() => {
          setArchived(false);
          navigate(q, false);
        }}
      >
        <div className="flex items-center gap-2.5">
          <Checkbox id="include-archived" checked={archived} onCheckedChange={(v) => setArchived(v === true)} />
          <Label htmlFor="include-archived" className="cursor-pointer">
            Include archived vendors
          </Label>
        </div>
      </FilterPanel>
    </div>
  );
}
