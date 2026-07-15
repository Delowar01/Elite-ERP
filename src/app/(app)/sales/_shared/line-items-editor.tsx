"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Product } from "@/db";

export type LineItemDraft = {
  productId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRatePercent: string;
};

export const emptyLineItem = (): LineItemDraft => ({
  productId: "",
  description: "",
  quantity: "1",
  unitPrice: "0",
  taxRatePercent: "15",
});

export function LineItemsEditor({
  locale,
  products,
  items,
  onChange,
  pricing = true,
}: {
  locale: Locale;
  products: Pick<Product, "id" | "name" | "sku" | "unitPrice" | "taxRatePercent">[];
  items: LineItemDraft[];
  onChange: (items: LineItemDraft[]) => void;
  pricing?: boolean;
}) {
  function updateLine(index: number, patch: Partial<LineItemDraft>) {
    onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function selectProduct(index: number, productId: string) {
    const product = products.find((p) => String(p.id) === productId);
    if (!product) {
      updateLine(index, { productId });
      return;
    }
    updateLine(index, {
      productId,
      description: product.name,
      ...(pricing ? { unitPrice: product.unitPrice, taxRatePercent: product.taxRatePercent } : {}),
    });
  }

  function removeLine(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  const lineTotal = (it: LineItemDraft) => (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);

  return (
    <div className="flex flex-col gap-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t(locale, "Item")}</TableHead>
            <TableHead className="w-24">{t(locale, "Qty")}</TableHead>
            {pricing && <TableHead className="w-32 text-right">{t(locale, "Unit Price")}</TableHead>}
            {pricing && <TableHead className="w-20 text-right">{t(locale, "VAT %")}</TableHead>}
            {pricing && <TableHead className="w-32 text-right">{t(locale, "Line Total")}</TableHead>}
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, i) => (
            <TableRow key={i}>
              <TableCell className="min-w-[220px]">
                <div className="flex flex-col gap-1.5">
                  <Select value={item.productId} onValueChange={(v) => selectProduct(i, v)}>
                    <SelectTrigger>
                      <SelectValue placeholder={t(locale, "Select a product")} />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.sku} · {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={item.description}
                    onChange={(e) => updateLine(i, { description: e.target.value })}
                    placeholder={t(locale, "Description")}
                    className="h-8 text-xs"
                  />
                </div>
              </TableCell>
              <TableCell>
                <Input type="number" step="0.01" value={item.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} />
              </TableCell>
              {pricing && (
                <TableCell className="text-right">
                  <Input
                    type="number"
                    step="0.01"
                    className="text-right"
                    value={item.unitPrice}
                    onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                  />
                </TableCell>
              )}
              {pricing && (
                <TableCell className="text-right">
                  <Input
                    type="number"
                    step="0.01"
                    className="text-right"
                    value={item.taxRatePercent}
                    onChange={(e) => updateLine(i, { taxRatePercent: e.target.value })}
                  />
                </TableCell>
              )}
              {pricing && (
                <TableCell className="text-right font-mono text-[13px]">
                  {lineTotal(item).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </TableCell>
              )}
              <TableCell>
                {items.length > 1 && (
                  <button type="button" onClick={() => removeLine(i)} className="text-ink-faint hover:text-danger" aria-label={t(locale, "Remove")}>
                    <X className="size-4" />
                  </button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div>
        <Button variant="ghost" size="sm" onClick={() => onChange([...items, emptyLineItem()])}>
          <Plus className="size-3.5" /> {t(locale, "Add line")}
        </Button>
      </div>
    </div>
  );
}
