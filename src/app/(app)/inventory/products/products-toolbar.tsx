"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FilterPanel } from "@/components/ui/filter-panel";

export function ProductsToolbar({
  defaultQ,
  defaultLowStock,
  defaultArchived,
}: {
  defaultQ?: string;
  defaultLowStock?: boolean;
  defaultArchived?: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState(defaultQ ?? "");
  const [lowStock, setLowStock] = useState(defaultLowStock ?? false);
  const [archived, setArchived] = useState(defaultArchived ?? false);

  function navigate(nextQ: string, nextLowStock: boolean, nextArchived: boolean) {
    const params = new URLSearchParams();
    if (nextQ) params.set("q", nextQ);
    if (nextLowStock) params.set("lowStock", "1");
    if (nextArchived) params.set("archived", "1");
    router.push(`/inventory/products${params.toString() ? `?${params}` : ""}`);
  }

  return (
    <div className="mb-4 flex items-center gap-3">
      <div className="relative max-w-xs w-full">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-faint" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && navigate(q, lowStock, archived)}
          placeholder="Search products…"
          className="pl-9"
        />
      </div>
      <FilterPanel
        triggerLabel="Filters"
        hasActiveFilters={lowStock || archived}
        onApply={() => navigate(q, lowStock, archived)}
        onClear={() => {
          setLowStock(false);
          setArchived(false);
          navigate(q, false, false);
        }}
      >
        <div className="flex items-center gap-2.5">
          <Checkbox id="low-stock" checked={lowStock} onCheckedChange={(v) => setLowStock(v === true)} />
          <Label htmlFor="low-stock" className="cursor-pointer">
            Low stock only
          </Label>
        </div>
        <div className="flex items-center gap-2.5">
          <Checkbox id="include-archived" checked={archived} onCheckedChange={(v) => setArchived(v === true)} />
          <Label htmlFor="include-archived" className="cursor-pointer">
            Include archived products
          </Label>
        </div>
      </FilterPanel>
      {lowStock && (
        <Badge variant="warning" className="cursor-pointer" onClick={() => navigate(q, false, archived)}>
          Low stock ×
        </Badge>
      )}
    </div>
  );
}
