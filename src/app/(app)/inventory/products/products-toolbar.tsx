"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { X } from "lucide-react";
import { ListSearch } from "@/components/ui/list-search";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { FilterPanel } from "@/components/ui/filter-panel";
import { t, type Locale } from "@/lib/i18n/dict";

export function ProductsToolbar({
  locale,
  defaultQ,
  defaultLowStock,
  defaultArchived,
}: {
  locale: Locale;
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
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {/* Search still runs on Enter, through the URL (?q=) — unchanged. */}
      <ListSearch
        value={q}
        onChange={setQ}
        onKeyDown={(e) => e.key === "Enter" && navigate(q, lowStock, archived)}
        placeholder={t(locale, "Search products…")}
        label={t(locale, "Search products…")}
      />
      <FilterPanel
        triggerLabel={t(locale, "Filters")}
        applyLabel={t(locale, "Apply Filters")}
        clearLabel={t(locale, "Clear")}
        hasActiveFilters={lowStock || archived}
        activeCount={(lowStock ? 1 : 0) + (archived ? 1 : 0)}
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
            {t(locale, "Low stock only")}
          </Label>
        </div>
        <div className="flex items-center gap-2.5">
          <Checkbox id="include-archived" checked={archived} onCheckedChange={(v) => setArchived(v === true)} />
          <Label htmlFor="include-archived" className="cursor-pointer">
            {t(locale, "Include archived products")}
          </Label>
        </div>
      </FilterPanel>
      {/* The applied low-stock filter as a removable chip — a real button (it was a clickable Badge). */}
      {lowStock && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-warning! text-warning hover:text-warning"
          aria-label={`${t(locale, "Remove filter")}: ${t(locale, "Low stock")}`}
          onClick={() => navigate(q, false, archived)}
          data-filter-chip="low-stock"
        >
          {t(locale, "Low stock")} <X />
        </Button>
      )}
    </div>
  );
}
