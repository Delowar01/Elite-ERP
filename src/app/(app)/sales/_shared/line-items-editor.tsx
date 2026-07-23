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

// Matches the mockup's full_items_table()/simple_items_table()/qty_items_table()
// exactly: <div class="table-scroll"><table class="doc-items-table">...</table></div>
// <div class="doc-add-item-btn">+ Add New Item</div>. "full" = quotation/SO/proforma/
// invoice (image thumb + rich description + VAT% + unit price); "simple" = credit/debit
// note (name + qty + unit price, no VAT/thumb); "qty" = delivery challan (thumb + qty only).
export function LineItemsEditor({
  locale,
  products,
  items,
  onChange,
  variant = "full",
  pricing,
}: {
  locale: Locale;
  products: Pick<Product, "id" | "name" | "sku" | "unitPrice" | "taxRatePercent">[];
  items: LineItemDraft[];
  onChange: (items: LineItemDraft[]) => void;
  variant?: "full" | "simple" | "qty";
  /** @deprecated use variant="simple" instead of pricing={false} */
  pricing?: boolean;
}) {
  const resolvedVariant = pricing === false ? "simple" : variant;

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
      ...(resolvedVariant !== "qty" ? { unitPrice: product.unitPrice, taxRatePercent: product.taxRatePercent } : {}),
    });
  }

  function removeLine(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  const lineTotal = (it: LineItemDraft) => (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
  const showThumb = resolvedVariant !== "simple";
  const showPricing = resolvedVariant === "full";
  const showQtyOnly = resolvedVariant === "qty";

  return (
    <div className="flex flex-col gap-1">
      <div className="table-scroll">
        <table className="doc-items-table">
          <thead>
            <tr>
              <th>{t(locale, "Item Description")}</th>
              {showPricing && <th className="num">{t(locale, "VAT %")}</th>}
              <th className="num">{t(locale, "Qty")}</th>
              {showPricing && (
                <>
                  <th className="num">{t(locale, "Unit Price")}</th>
                  <th className="num">{t(locale, "Amount")}</th>
                </>
              )}
              {resolvedVariant === "simple" && (
                <>
                  <th className="num">{t(locale, "Unit Price")}</th>
                  <th className="num">{t(locale, "Line Total")}</th>
                </>
              )}
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr className="item-row" key={i}>
                <td>
                  {showThumb ? (
                    <div className="item-desc-cell">
                      <div className="item-thumb cursor-not-allowed" title={t(locale, "Product images are managed in Inventory.")} aria-disabled>
                        <ImageIcon className="size-4" />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }} className="flex flex-col gap-1.5">
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
                        {!showQtyOnly && (
                          <input
                            value={item.description}
                            onChange={(e) => updateLine(i, { description: e.target.value })}
                            placeholder={t(locale, "Description")}
                            className="item-desc-text w-full h-7 rounded-md border border-line px-2 text-[11.5px] outline-none focus:border-brand-orange bg-transparent"
                          />
                        )}
                      </div>
                    </div>
                  ) : (
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
                    </div>
                  )}
                </td>
                {showPricing && (
                  <td className="num">
                    <input
                      type="number"
                      step="1"
                      value={item.taxRatePercent}
                      onChange={(e) => updateLine(i, { taxRatePercent: e.target.value })}
                      className="item-cell-input"
                    />
                  </td>
                )}
                <td className="num">
                  <input
                    type="number"
                    step="0.01"
                    value={item.quantity}
                    onChange={(e) => updateLine(i, { quantity: e.target.value })}
                    className="item-cell-input"
                  />
                </td>
                {(showPricing || resolvedVariant === "simple") && (
                  <>
                    <td className="num">
                      <input
                        type="number"
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                        className="item-cell-input"
                      />
                    </td>
                    <td className="num cellval" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                      {fmt(lineTotal(item))}
                    </td>
                  </>
                )}
                <td>
                  {items.length > 1 && (
                    <div className="item-del-btn" onClick={() => removeLine(i)} role="button" aria-label={t(locale, "Remove")}>
                      <X className="size-4" />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="doc-add-item-btn" onClick={() => onChange([...items, emptyLineItem()])} role="button">
        <Plus className="size-3.5" /> {t(locale, "Add New Item")}
      </div>
    </div>
  );
}
