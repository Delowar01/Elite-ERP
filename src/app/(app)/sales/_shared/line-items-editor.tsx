"use client";

import { Plus, X, Image as ImageIcon } from "lucide-react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { t, type Locale } from "@/lib/i18n/dict";
import { fmt } from "./totals";
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
  const inputCls =
    "h-8 min-w-[84px] w-full rounded-[7px] border border-line-strong bg-surface px-2 font-mono text-[12px] text-ink text-right outline-none focus:border-brand-orange";

  return (
    <div className="flex flex-col gap-1">
      <div className="overflow-x-auto rounded-xl shadow-elevated">
        <table className="w-full min-w-[760px] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="bg-linear-to-br from-brand-orange-light to-brand-orange text-white text-[10.5px] font-bold uppercase tracking-wide px-3.5 py-2.5 text-start rounded-ss-xl">
                {t(locale, "Item Description")}
              </th>
              <th className="bg-linear-to-br from-brand-orange-light to-brand-orange text-white text-[10.5px] font-bold uppercase tracking-wide px-3.5 py-2.5 text-end w-24">
                {t(locale, "Qty")}
              </th>
              {pricing && (
                <>
                  <th className="bg-linear-to-br from-brand-orange-light to-brand-orange text-white text-[10.5px] font-bold uppercase tracking-wide px-3.5 py-2.5 text-end w-28">
                    {t(locale, "Unit Price")}
                  </th>
                  <th className="bg-linear-to-br from-brand-orange-light to-brand-orange text-white text-[10.5px] font-bold uppercase tracking-wide px-3.5 py-2.5 text-end w-20">
                    {t(locale, "VAT %")}
                  </th>
                  <th className="bg-linear-to-br from-brand-orange-light to-brand-orange text-white text-[10.5px] font-bold uppercase tracking-wide px-3.5 py-2.5 text-end w-28">
                    {t(locale, "Amount")}
                  </th>
                </>
              )}
              <th className="bg-linear-to-br from-brand-orange-light to-brand-orange w-10 rounded-se-xl" />
            </tr>
          </thead>
          <tbody className="bg-surface">
            {items.map((item, i) => (
              <tr key={i}>
                <td className="px-3.5 py-3 border-b border-line align-top min-w-[240px]">
                  <div className="flex gap-2.5 items-start">
                    <div className="size-10 rounded-[9px] bg-canvas border border-line flex items-center justify-center text-ink-faint shrink-0">
                      <ImageIcon className="size-4" />
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                      <Select value={item.productId} onValueChange={(v) => selectProduct(i, v)}>
                        <SelectTrigger className="h-8 text-xs">
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
                      <input
                        value={item.description}
                        onChange={(e) => updateLine(i, { description: e.target.value })}
                        placeholder={t(locale, "Description")}
                        className="h-7 rounded-md border border-line px-2 text-[11.5px] text-ink-muted outline-none focus:border-brand-orange"
                      />
                    </div>
                  </div>
                </td>
                <td className="px-3.5 py-3 border-b border-line align-top">
                  <input
                    type="number"
                    step="0.01"
                    value={item.quantity}
                    onChange={(e) => updateLine(i, { quantity: e.target.value })}
                    className={inputCls}
                  />
                </td>
                {pricing && (
                  <>
                    <td className="px-3.5 py-3 border-b border-line align-top">
                      <input
                        type="number"
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                        className={inputCls}
                      />
                    </td>
                    <td className="px-3.5 py-3 border-b border-line align-top">
                      <input
                        type="number"
                        step="0.01"
                        value={item.taxRatePercent}
                        onChange={(e) => updateLine(i, { taxRatePercent: e.target.value })}
                        className={inputCls}
                      />
                    </td>
                    <td className="px-3.5 py-3 border-b border-line align-top text-end font-mono text-[13px] font-semibold text-ink whitespace-nowrap">
                      {fmt(lineTotal(item))}
                    </td>
                  </>
                )}
                <td className="px-3.5 py-3 border-b border-line align-top">
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      className="size-[30px] rounded-lg inline-flex items-center justify-center text-ink-faint hover:bg-danger-bg hover:text-danger"
                      aria-label={t(locale, "Remove")}
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={() => onChange([...items, emptyLineItem()])}
        className="inline-flex items-center gap-1.5 self-start text-[12.5px] font-semibold text-brand-orange py-2.5"
      >
        <Plus className="size-3.5" /> {t(locale, "Add New Item")}
      </button>
    </div>
  );
}
