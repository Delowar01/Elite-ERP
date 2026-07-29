"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";
import { useCurrency } from "@/components/ui/currency-mark";
import { formatAmount, markFormat } from "@/lib/currency/currencies";
import { ItemEntryCell } from "./item-entry-cell";
import { LINE_DESC_KEY } from "./line-item-desc";
import { saveLineItemAsProductAction, updateProductDescriptionAction } from "./creation-popup-actions";
import { ACTIONS_KEY, evalFormula, lineVars, type ColumnDef } from "@/lib/column-config";
import type { Product } from "@/db";

export type LineItemDraft = {
  productId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRatePercent: string;
  imageUrl: string;
  unit: string;
  /** Per-line values for custom / line-input columns (Disc %, custom text/number columns). */
  customFields: Record<string, string>;
};

// The default line VAT/tax rate comes from the org's country profile (SA 15, UAE 5, Global 0…).
export const emptyLineItem = (defaultTaxRate: string = "15"): LineItemDraft => ({
  productId: "",
  description: "",
  quantity: "1",
  unitPrice: "0",
  taxRatePercent: defaultTaxRate,
  imageUrl: "",
  unit: "",
  customFields: {},
});

const DEFAULT_UNITS = ["pcs", "unit", "box", "kg", "m", "m²", "hour", "day", "set", "lot"];

// Fields the line-item entry needs from a product: identity + search (name/sku/description) + the
// values it fills onto the line when picked (price/tax/unit/image).
export type ProductLite = Pick<Product, "id" | "name" | "sku" | "unitPrice" | "taxRatePercent" | "description" | "unit" | "imageUrl">;

// Shared item-entry actions for a variant's editor: searchable product list (with items created
// in-session merged in), linking a picked item, creating a new item from the typed name, per-line
// description editing (stored on the line), and pushing a description onto the item's master.
function useItemActions(locale: Locale, items: LineItemDraft[], onChange: (items: LineItemDraft[]) => void, resolvedVariant: "full" | "simple" | "qty", baseProducts: ProductLite[]) {
  const [created, setCreated] = useState<ProductLite[]>([]);
  const [createdIds, setCreatedIds] = useState<number[]>([]);
  const [pendingIdx, setPendingIdx] = useState<number[]>([]);
  const products = created.length ? [...created, ...baseProducts] : baseProducts;

  const updateLine = (i: number, patch: Partial<LineItemDraft>) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const setDesc = (i: number, html: string) => updateLine(i, { customFields: { ...items[i].customFields, [LINE_DESC_KEY]: html } });
  // Link a picked product: name → the line's name field, its description → the line description
  // (never pasted into the name), and price/tax/unit/image filled in.
  const selectProduct = (i: number, p: ProductLite) =>
    updateLine(i, {
      productId: String(p.id),
      description: p.name,
      unit: p.unit || items[i].unit,
      imageUrl: p.imageUrl || items[i].imageUrl,
      customFields: { ...items[i].customFields, [LINE_DESC_KEY]: p.description ?? items[i].customFields[LINE_DESC_KEY] ?? "" },
      ...(resolvedVariant !== "qty" ? { unitPrice: p.unitPrice, taxRatePercent: p.taxRatePercent } : {}),
    });
  // Create a brand-new item from the typed name and link it in place (no dialog / redirect).
  const createNew = async (i: number, name: string) => {
    if (!name.trim()) return;
    setPendingIdx((p) => [...p, i]);
    const res = await saveLineItemAsProductAction({ name: name.trim(), unit: items[i].unit, unitPrice: items[i].unitPrice, taxRatePercent: items[i].taxRatePercent, imageUrl: items[i].imageUrl });
    setPendingIdx((p) => p.filter((x) => x !== i));
    if (res.error || !res.product) { toast.error(res.error ?? t(locale, "Something went wrong.")); return; }
    const product = res.product;
    setCreated((prev) => [product, ...prev]);
    setCreatedIds((prev) => [...prev, product.id]);
    updateLine(i, { productId: String(product.id), description: product.name });
  };
  const saveToMaster = async (productId: number, html: string) => {
    const res = await updateProductDescriptionAction(productId, html);
    if (res.error) toast.error(res.error);
    else toast.success(t(locale, "Description saved to item."));
  };
  return {
    products, updateLine, setDesc, selectProduct, createNew, saveToMaster,
    isCreated: (productId: number) => createdIds.includes(productId),
    isPending: (i: number) => pendingIdx.includes(i),
  };
}

// Render the shared item-entry cell for line `i` wired to a variant editor's item actions.
function itemCell(locale: Locale, item: LineItemDraft, i: number, showThumb: boolean, h: ReturnType<typeof useItemActions>) {
  const linkedId = Number(item.productId) || 0;
  return (
    <ItemEntryCell
      locale={locale}
      products={h.products}
      item={item}
      showThumb={showThumb}
      justCreated={!!linkedId && h.isCreated(linkedId)}
      pending={h.isPending(i)}
      onPatch={(patch) => h.updateLine(i, patch)}
      onSetDesc={(html) => h.setDesc(i, html)}
      onSelectProduct={(p) => h.selectProduct(i, p)}
      onCreateNew={(name) => h.createNew(i, name)}
      onSaveToMaster={(html) => { if (linkedId) h.saveToMaster(linkedId, html); }}
    />
  );
}

export function LineItemsEditor({
  locale,
  products,
  items,
  onChange,
  variant = "full",
  pricing,
  units = [],
  columns,
  defaultTaxRate = "15",
}: {
  locale: Locale;
  products: ProductLite[];
  items: LineItemDraft[];
  onChange: (items: LineItemDraft[]) => void;
  variant?: "full" | "simple" | "qty";
  /** @deprecated use variant="simple" instead of pricing={false} */
  pricing?: boolean;
  /** Preset unit names offered in the unit selector; falls back to common units. */
  units?: string[];
  /** Column configuration (Edit Columns). Only used for the "full" variant. */
  columns?: ColumnDef[];
  /** Default VAT/tax rate for newly-added lines, from the org's country profile. */
  defaultTaxRate?: string;
}) {
  const resolvedVariant = pricing === false ? "simple" : variant;

  // Column-driven full variant (Edit Columns applied). Simple/qty variants keep the fixed layout.
  if (resolvedVariant === "full" && columns && columns.length > 0) {
    return <ColumnDrivenEditor locale={locale} products={products} items={items} onChange={onChange} units={units} columns={columns} defaultTaxRate={defaultTaxRate} />;
  }

  return <FixedEditor locale={locale} products={products} items={items} onChange={onChange} resolvedVariant={resolvedVariant} units={units} defaultTaxRate={defaultTaxRate} />;
}

// ---------------- Column-driven full editor ----------------
function ColumnDrivenEditor({
  locale,
  products,
  items,
  onChange,
  units,
  columns,
  defaultTaxRate = "15",
}: {
  locale: Locale;
  products: ProductLite[];
  items: LineItemDraft[];
  onChange: (items: LineItemDraft[]) => void;
  units: string[];
  columns: ColumnDef[];
  defaultTaxRate?: string;
}) {
  const unitOptions = Array.from(new Set([...units, ...DEFAULT_UNITS]));
  const visible = columns.filter((c) => c.visible || c.key === ACTIONS_KEY);
  const h = useItemActions(locale, items, onChange, "full", products);
  const updateLine = h.updateLine;
  const cfg = markFormat(useCurrency());

  function setCustom(index: number, key: string, value: string) {
    onChange(items.map((it, i) => (i === index ? { ...it, customFields: { ...it.customFields, [key]: value } } : it)));
  }
  function removeLine(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  function computed(item: LineItemDraft) {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unitPrice) || 0;
    const vat = Number(item.taxRatePercent) || 0;
    const disc = Number(item.customFields?.discPercent) || 0;
    const amount = qty * price;
    const vatAmount = (amount * vat) / 100;
    const discAmount = (amount * disc) / 100;
    const total = amount + vatAmount - discAmount;
    return { qty, price, vat, disc, amount, vatAmount, discAmount, total };
  }

  function cell(item: LineItemDraft, i: number, c: ColumnDef) {
    const cmp = computed(item);
    switch (c.key) {
      case "description":
        return itemCell(locale, item, i, true, h);
      case "taxRatePercent":
        return <input type="number" step="1" value={item.taxRatePercent} onChange={(e) => updateLine(i, { taxRatePercent: e.target.value })} className="item-cell-input" />;
      case "quantity":
        return <input type="number" step="0.01" value={item.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="item-cell-input" />;
      case "unit":
        return <input list="lie-units" value={item.unit} onChange={(e) => updateLine(i, { unit: e.target.value })} placeholder={t(locale, "Unit")} className="item-cell-input" style={{ minWidth: 56 }} />;
      case "unitPrice":
        return <input type="number" step="0.01" value={item.unitPrice} onChange={(e) => updateLine(i, { unitPrice: e.target.value })} className="item-cell-input" />;
      case "amount":
        return <span className="cellval">{formatAmount(cmp.amount, cfg)}</span>;
      case "vatAmount":
        return <span className="cellval">{formatAmount(cmp.vatAmount, cfg)}</span>;
      case "discPercent":
        return <input type="number" step="0.01" value={item.customFields?.discPercent ?? ""} onChange={(e) => setCustom(i, "discPercent", e.target.value)} className="item-cell-input" />;
      case "discAmount":
        return <span className="cellval">{formatAmount(cmp.discAmount, cfg)}</span>;
      case "total":
        return <span className="cellval" style={{ fontWeight: 600 }}>{formatAmount(cmp.total, cfg)}</span>;
      default:
        if (c.custom && c.fieldType === "formula") {
          const val = evalFormula(c.formula || "", lineVars(cmp.qty, cmp.price, cmp.vat, cmp.disc));
          return <span className="cellval">{val === null ? "—" : formatAmount(val, cfg)}</span>;
        }
        if (c.custom) {
          return (
            <input
              type={c.fieldType === "number" ? "number" : "text"}
              step={c.fieldType === "number" ? "0.01" : undefined}
              value={item.customFields?.[c.key] ?? ""}
              onChange={(e) => setCustom(i, c.key, e.target.value)}
              className="item-cell-input"
            />
          );
        }
        return null;
    }
  }

  const isNum = (c: ColumnDef) =>
    ["taxRatePercent", "quantity", "unitPrice", "amount", "vatAmount", "discPercent", "discAmount", "total"].includes(c.key) ||
    (c.custom && (c.fieldType === "number" || c.fieldType === "formula"));

  return (
    <div className="flex flex-col gap-1">
      <datalist id="lie-units">{unitOptions.map((u) => <option key={u} value={u} />)}</datalist>
      <div className="table-scroll">
        <table className="doc-items-table" style={{ tableLayout: "fixed", width: "100%" }}>
          <colgroup>
            {visible.map((c) => <col key={c.key} style={{ width: `${c.widthPct}%` }} />)}
          </colgroup>
          <thead>
            <tr>
              {visible.map((c) => (
                <th key={c.key} className={isNum(c) ? "num" : undefined}>
                  {c.key === ACTIONS_KEY ? "" : c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr className="item-row" key={i}>
                {visible.map((c) => (
                  <td key={c.key} className={isNum(c) ? "num" : undefined} style={c.key === "total" || c.key === "amount" ? { whiteSpace: "nowrap" } : undefined}>
                    {c.key === ACTIONS_KEY ? (
                      items.length > 1 ? (
                        <div className="item-del-btn" onClick={() => removeLine(i)} role="button" aria-label={t(locale, "Remove")}><X className="size-4" /></div>
                      ) : null
                    ) : (
                      cell(item, i, c)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="doc-add-item-btn" onClick={() => onChange([...items, emptyLineItem(defaultTaxRate)])} role="button">
        <Plus className="size-3.5" /> {t(locale, "Add New Item")}
      </div>
    </div>
  );
}

// ---------------- Fixed editor (simple / qty / full-without-config) ----------------
function FixedEditor({
  locale,
  products,
  items,
  onChange,
  resolvedVariant,
  units,
  defaultTaxRate = "15",
}: {
  locale: Locale;
  products: ProductLite[];
  items: LineItemDraft[];
  onChange: (items: LineItemDraft[]) => void;
  resolvedVariant: "full" | "simple" | "qty";
  units: string[];
  defaultTaxRate?: string;
}) {
  const unitOptions = Array.from(new Set([...units, ...DEFAULT_UNITS]));
  const h = useItemActions(locale, items, onChange, resolvedVariant, products);
  const updateLine = h.updateLine;
  const cfg = markFormat(useCurrency());

  function removeLine(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }
  const lineTotal = (it: LineItemDraft) => (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
  const showThumb = resolvedVariant !== "simple";
  const showPricing = resolvedVariant === "full";

  return (
    <div className="flex flex-col gap-1">
      <datalist id="lie-units">{unitOptions.map((u) => <option key={u} value={u} />)}</datalist>
      <div className="table-scroll">
        <table className="doc-items-table">
          <thead>
            <tr>
              <th>{t(locale, "Item Description")}</th>
              {showPricing && <th className="num">{t(locale, "VAT %")}</th>}
              <th className="num">{t(locale, "Qty")}</th>
              {showPricing && <th>{t(locale, "Unit")}</th>}
              {showPricing && (<><th className="num">{t(locale, "Unit Price")}</th><th className="num">{t(locale, "Amount")}</th></>)}
              {resolvedVariant === "simple" && (<><th className="num">{t(locale, "Unit Price")}</th><th className="num">{t(locale, "Line Total")}</th></>)}
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr className="item-row" key={i}>
                <td>
                  {itemCell(locale, item, i, showThumb, h)}
                </td>
                {showPricing && (
                  <td className="num"><input type="number" step="1" value={item.taxRatePercent} onChange={(e) => updateLine(i, { taxRatePercent: e.target.value })} className="item-cell-input" /></td>
                )}
                <td className="num"><input type="number" step="0.01" value={item.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="item-cell-input" /></td>
                {showPricing && (
                  <td><input list="lie-units" value={item.unit} onChange={(e) => updateLine(i, { unit: e.target.value })} placeholder={t(locale, "Unit")} className="item-cell-input" style={{ minWidth: 64 }} /></td>
                )}
                {(showPricing || resolvedVariant === "simple") && (
                  <>
                    <td className="num"><input type="number" step="0.01" value={item.unitPrice} onChange={(e) => updateLine(i, { unitPrice: e.target.value })} className="item-cell-input" /></td>
                    <td className="num cellval" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{formatAmount(lineTotal(item), cfg)}</td>
                  </>
                )}
                <td>{items.length > 1 && (<div className="item-del-btn" onClick={() => removeLine(i)} role="button" aria-label={t(locale, "Remove")}><X className="size-4" /></div>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="doc-add-item-btn" onClick={() => onChange([...items, emptyLineItem(defaultTaxRate)])} role="button">
        <Plus className="size-3.5" /> {t(locale, "Add New Item")}
      </div>
    </div>
  );
}
