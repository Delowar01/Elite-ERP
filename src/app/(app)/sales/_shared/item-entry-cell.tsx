"use client";

import { useState, useRef, useEffect } from "react";
import { Search, Pencil, PlusCircle } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";
import { richTextToPlain } from "@/lib/sanitize-html";
import { RichTextField } from "./rich-text-field";
import { ItemImageDialog } from "./item-image-dialog";
import { SaveItemDialog } from "./save-item-dialog";
import type { SavedItem } from "./creation-popup-actions";
import type { LineItemDraft, ProductLite } from "./line-items-editor";

const looksLikeHtml = (s: string) => /<\/?[a-z][\s\S]*>/i.test(s);

// Shared item entry for a document line. Replaces the old product dropdown with a searchable
// combobox: while typing it searches saved products by name / SKU / description; results are shown
// separately from a "Save this item" action, which only appears when the typed name doesn't already
// exist as a product. Picking a result links the line and fills its price/tax/unit/image; typing a
// new name keeps it as a document-only line. A per-line rich-text description (full variant) reuses
// the shared editor. Everything stays in-page — unsaved document data is never lost.
export function ItemEntryCell({
  locale,
  products,
  item,
  showThumb,
  showRich,
  showPricingInDialog = true,
  onPatch,
  onSelectProduct,
  onProductCreated,
}: {
  locale: Locale;
  products: ProductLite[];
  item: LineItemDraft;
  showThumb: boolean;
  showRich: boolean;
  showPricingInDialog?: boolean;
  onPatch: (patch: Partial<LineItemDraft>) => void;
  onSelectProduct: (product: ProductLite) => void;
  onProductCreated: (product: SavedItem) => void;
}) {
  const displayName = richTextToPlain(item.description);
  const [query, setQuery] = useState(displayName);
  const [open, setOpen] = useState(false);
  const [richMode, setRichMode] = useState(() => looksLikeHtml(item.description));
  const [saveOpen, setSaveOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the input in sync when the line's name changes externally (product picked/created),
  // but never while the user is typing (avoids caret jumps).
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setQuery(displayName);
  }, [displayName]);

  const q = query.trim().toLowerCase();
  const matches = (q
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          richTextToPlain(p.description ?? "").toLowerCase().includes(q),
      )
    : products
  ).slice(0, 20);
  const exactExists = products.some((p) => p.name.trim().toLowerCase() === q);
  const showSave = q.length > 0 && !exactExists && !item.productId;

  function pick(p: ProductLite) {
    onSelectProduct(p);
    setQuery(p.name);
    setOpen(false);
  }

  function editorBody() {
    if (richMode) {
      return (
        <div className="flex flex-col gap-1">
          <RichTextField
            locale={locale}
            value={item.description}
            onChange={(html) => onPatch({ description: html })}
            placeholder={t(locale, "Description")}
            compact
          />
          <button type="button" className="self-start text-[11px] text-ink-faint hover:text-brand-orange inline-flex items-center gap-1" onClick={() => { setRichMode(false); setQuery(richTextToPlain(item.description)); }}>
            <Search className="size-3" /> {t(locale, "Search or type an item name…")}
          </button>
        </div>
      );
    }
    return (
      <div
        className="relative"
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}
      >
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); onPatch({ description: e.target.value, productId: "" }); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={t(locale, "Search or type an item name…")}
            className="flex-1 h-8 rounded-[8px] border border-line px-2 text-xs outline-none focus:border-brand-orange bg-surface"
          />
          {showRich && (
            <button type="button" className="shrink-0 text-ink-faint hover:text-brand-orange" title={t(locale, "Add description")} aria-label={t(locale, "Add description")} onClick={() => setRichMode(true)}>
              <Pencil className="size-3.5" />
            </button>
          )}
        </div>
        {open && (
          <div className="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-[10px] border border-line bg-surface-raised shadow-lg text-xs">
            {/* Saved-item search results */}
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-ink-faint">{t(locale, "Saved items")}</div>
            {matches.length === 0 ? (
              <div className="px-2 py-1.5 text-ink-faint">{t(locale, "No matching items")}</div>
            ) : (
              matches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-start px-2 py-1.5 hover:bg-canvas flex items-center gap-1.5"
                  onClick={() => pick(p)}
                >
                  <span className="text-ink-faint">{p.sku}</span>
                  <span className="truncate">{p.name}</span>
                </button>
              ))
            )}
            {/* Save-this-item action, visually separated from the results above */}
            {showSave && (
              <>
                <div className="border-t border-line" />
                <button
                  type="button"
                  className="w-full text-start px-2 py-1.5 hover:bg-canvas flex items-center gap-1.5 text-brand-orange font-semibold"
                  onClick={() => { setOpen(false); setSaveOpen(true); }}
                >
                  <PlusCircle className="size-3.5" /> {t(locale, "Save this item")}: “{query.trim()}”
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="item-desc-cell">
      {showThumb && (
        <ItemImageDialog locale={locale} imageUrl={item.imageUrl || undefined} onUploaded={(url) => onPatch({ imageUrl: url })} />
      )}
      <div style={{ flex: 1, minWidth: 0 }} className="flex flex-col gap-1.5">
        {editorBody()}
      </div>
      <SaveItemDialog
        locale={locale}
        open={saveOpen}
        onOpenChange={setSaveOpen}
        showPricing={showPricingInDialog}
        initial={{
          name: query.trim() || richTextToPlain(item.description),
          description: item.description,
          imageUrl: item.imageUrl,
          unit: item.unit,
          unitPrice: item.unitPrice,
          taxRatePercent: item.taxRatePercent,
        }}
        onSaved={onProductCreated}
      />
    </div>
  );
}
