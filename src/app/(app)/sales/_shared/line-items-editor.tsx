"use client";

import { Plus, X } from "lucide-react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { t, type Locale } from "@/lib/i18n/dict";
import { fmt } from "./totals";
import { ItemImageDialog } from "./item-image-dialog";
import { RichTextField } from "./rich-text-field";
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

export const emptyLineItem = (): LineItemDraft => ({
  productId: "",
  description: "",
  quantity: "1",
  unitPrice: "0",
  taxRatePercent: "15",
  imageUrl: "",
  unit: "",
  customFields: {},
});

const DEFAULT_UNITS = ["pcs", "unit", "box", "kg", "m", "m²", "hour", "day", "set", "lot"];

type ProductLite = Pick<Product, "id" | "name" | "sku" | "unitPrice" | "taxRatePercent">;

export function LineItemsEditor({
  locale,
  products,
  items,
  onChange,
  variant = "full",
  pricing,
  units = [],
  columns,
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
}) {
  const resolvedVariant = pricing === false ? "simple" : variant;

  // Column-driven full variant (Edit Columns applied). Simple/qty variants keep the fixed layout.
  if (resolvedVariant === "full" && columns && columns.length > 0) {
    return <ColumnDrivenEditor locale={locale} products={products} items={items} onChange={onChange} units={units} columns={columns} />;
  }

  return <FixedEditor locale={locale} products={products} items={items} onChange={onChange} resolvedVariant={resolvedVariant} units={units} />;
}

// ---------------- Column-driven full editor ----------------
function ColumnDrivenEditor({
  locale,
  products,
  items,
  onChange,
  units,
  columns,
}: {
  locale: Locale;
  products: ProductLite[];
  items: LineItemDraft[];
  onChange: (items: LineItemDraft[]) => void;
  units: string[];
  columns: ColumnDef[];
}) {
  const unitOptions = Array.from(new Set([...units, ...DEFAULT_UNITS]));
  const visible = columns.filter((c) => c.visible || c.key === ACTIONS_KEY);

  function updateLine(index: number, patch: Partial<LineItemDraft>) {
    onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }
  function setCustom(index: number, key: string, value: string) {
    onChange(items.map((it, i) => (i === index ? { ...it, customFields: { ...it.customFields, [key]: value } } : it)));
  }
  function selectProduct(index: number, productId: string) {
    const product = products.find((p) => String(p.id) === productId);
    if (!product) { updateLine(index, { productId }); return; }
    updateLine(index, { productId, description: product.name, unitPrice: product.unitPrice, taxRatePercent: product.taxRatePercent });
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
        return (
          <div className="item-desc-cell">
            <ItemImageDialog locale={locale} imageUrl={item.imageUrl || undefined} onUploaded={(url) => updateLine(i, { imageUrl: url })} />
            <div style={{ flex: 1, minWidth: 0 }} className="flex flex-col gap-1.5">
              <Select value={item.productId} onValueChange={(v) => selectProduct(i, v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t(locale, "Select a product")} /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => (<SelectItem key={p.id} value={String(p.id)}>{p.sku} · {p.name}</SelectItem>))}
                </SelectContent>
              </Select>
              <RichTextField locale={locale} value={item.description} onChange={(html) => updateLine(i, { description: html })} placeholder={t(locale, "Description")} compact />
            </div>
          </div>
        );
      case "taxRatePercent":
        return <input type="number" step="1" value={item.taxRatePercent} onChange={(e) => updateLine(i, { taxRatePercent: e.target.value })} className="item-cell-input" />;
      case "quantity":
        return <input type="number" step="0.01" value={item.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="item-cell-input" />;
      case "unit":
        return <input list="lie-units" value={item.unit} onChange={(e) => updateLine(i, { unit: e.target.value })} placeholder={t(locale, "Unit")} className="item-cell-input" style={{ minWidth: 56 }} />;
      case "unitPrice":
        return <input type="number" step="0.01" value={item.unitPrice} onChange={(e) => updateLine(i, { unitPrice: e.target.value })} className="item-cell-input" />;
      case "amount":
        return <span className="cellval">{fmt(cmp.amount)}</span>;
      case "vatAmount":
        return <span className="cellval">{fmt(cmp.vatAmount)}</span>;
      case "discPercent":
        return <input type="number" step="0.01" value={item.customFields?.discPercent ?? ""} onChange={(e) => setCustom(i, "discPercent", e.target.value)} className="item-cell-input" />;
      case "discAmount":
        return <span className="cellval">{fmt(cmp.discAmount)}</span>;
      case "total":
        return <span className="cellval" style={{ fontWeight: 600 }}>{fmt(cmp.total)}</span>;
      default:
        if (c.custom && c.fieldType === "formula") {
          const val = evalFormula(c.formula || "", lineVars(cmp.qty, cmp.price, cmp.vat, cmp.disc));
          return <span className="cellval">{val === null ? "—" : fmt(val)}</span>;
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
      <div className="doc-add-item-btn" onClick={() => onChange([...items, emptyLineItem()])} role="button">
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
}: {
  locale: Locale;
  products: ProductLite[];
  items: LineItemDraft[];
  onChange: (items: LineItemDraft[]) => void;
  resolvedVariant: "full" | "simple" | "qty";
  units: string[];
}) {
  const unitOptions = Array.from(new Set([...units, ...DEFAULT_UNITS]));

  function updateLine(index: number, patch: Partial<LineItemDraft>) {
    onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }
  function selectProduct(index: number, productId: string) {
    const product = products.find((p) => String(p.id) === productId);
    if (!product) { updateLine(index, { productId }); return; }
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
                  {showThumb ? (
                    <div className="item-desc-cell">
                      <ItemImageDialog locale={locale} imageUrl={item.imageUrl || undefined} onUploaded={(url) => updateLine(i, { imageUrl: url })} />
                      <div style={{ flex: 1, minWidth: 0 }} className="flex flex-col gap-1.5">
                        <Select value={item.productId} onValueChange={(v) => selectProduct(i, v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t(locale, "Select a product")} /></SelectTrigger>
                          <SelectContent>{products.map((p) => (<SelectItem key={p.id} value={String(p.id)}>{p.sku} · {p.name}</SelectItem>))}</SelectContent>
                        </Select>
                        {showPricing && (
                          <RichTextField locale={locale} value={item.description} onChange={(html) => updateLine(i, { description: html })} placeholder={t(locale, "Description")} compact />
                        )}
                        {showQtyOnly && (
                          <input value={item.description} onChange={(e) => updateLine(i, { description: e.target.value })} placeholder={t(locale, "Description")} className="item-desc-text w-full h-7 rounded-md border border-line px-2 text-[11.5px] outline-none focus:border-brand-orange bg-transparent" />
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                      <Select value={item.productId} onValueChange={(v) => selectProduct(i, v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t(locale, "Select a product")} /></SelectTrigger>
                        <SelectContent>{products.map((p) => (<SelectItem key={p.id} value={String(p.id)}>{p.sku} · {p.name}</SelectItem>))}</SelectContent>
                      </Select>
                    </div>
                  )}
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
                    <td className="num cellval" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{fmt(lineTotal(item))}</td>
                  </>
                )}
                <td>{items.length > 1 && (<div className="item-del-btn" onClick={() => removeLine(i)} role="button" aria-label={t(locale, "Remove")}><X className="size-4" /></div>)}</td>
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
