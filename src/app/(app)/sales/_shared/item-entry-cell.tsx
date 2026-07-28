"use client";

import { useState, useRef, useEffect } from "react";
import { PlusCircle, FileText, Loader2, Check } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";
import { richTextToPlain } from "@/lib/sanitize-html";
import { RichTextField } from "./rich-text-field";
import { ItemImageDialog } from "./item-image-dialog";
import { LINE_DESC_KEY } from "./line-item-desc";
import type { LineItemDraft, ProductLite } from "./line-items-editor";

// Shared item entry for a document line.
//  • Item name: one normal editable field. While typing it searches saved items by name / SKU /
//    description and lists matches; picking one links the line. When the typed name has no exact
//    match it offers "Create New Item", which creates the item from the typed name and links it in
//    place (no dialog, no redirect, no locked name pasted elsewhere).
//  • Description: a separate "Add Description" box (opened on demand) for a full multiline
//    description, shown on the line and stored on the line. For a newly-created item the description
//    is saved onto the item automatically; for an existing item it stays document-local until the
//    user clicks "Save to Item". Everything stays in-page — unsaved document data is never lost.
export function ItemEntryCell({
  locale,
  products,
  item,
  showThumb,
  justCreated,
  pending,
  onPatch,
  onSetDesc,
  onSelectProduct,
  onCreateNew,
  onSaveToMaster,
}: {
  locale: Locale;
  products: ProductLite[];
  item: LineItemDraft;
  showThumb: boolean;
  justCreated: boolean;
  pending: boolean;
  onPatch: (patch: Partial<LineItemDraft>) => void;
  onSetDesc: (html: string) => void;
  onSelectProduct: (product: ProductLite) => void;
  onCreateNew: (name: string) => void;
  onSaveToMaster: (html: string) => void;
}) {
  const displayName = richTextToPlain(item.description);
  const desc = item.customFields?.[LINE_DESC_KEY] ?? "";
  const [query, setQuery] = useState(displayName);
  const [open, setOpen] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the input in sync when the line's name changes externally (item picked/created), but never
  // while the user is typing (avoids caret jumps).
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
  const canCreate = q.length > 0 && !exactExists && !item.productId;
  const hasItem = !!item.productId || displayName.trim().length > 0;

  function pick(p: ProductLite) {
    onSelectProduct(p);
    setQuery(p.name);
    setOpen(false);
  }
  function createNew() {
    onCreateNew(query.trim());
    setOpen(false);
  }

  return (
    <div className="item-desc-cell">
      {showThumb && (
        <ItemImageDialog locale={locale} imageUrl={item.imageUrl || undefined} onUploaded={(url) => onPatch({ imageUrl: url })} />
      )}
      <div style={{ flex: 1, minWidth: 0 }} className="flex flex-col gap-1.5">
        {/* Item name field + searchable dropdown */}
        <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); onPatch({ description: e.target.value, productId: "" }); setOpen(true); }}
              onFocus={() => setOpen(true)}
              placeholder={t(locale, "Item name")}
              className="flex-1 h-8 rounded-[8px] border border-line px-2 text-xs outline-none focus:border-brand-orange bg-surface"
            />
            {pending && <Loader2 className="size-3.5 animate-spin text-brand-orange shrink-0" />}
          </div>
          {open && (
            <div className="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-[10px] border border-line bg-surface-raised shadow-lg text-xs">
              <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-ink-faint">{t(locale, "Saved items")}</div>
              {matches.length === 0 ? (
                <div className="px-2 py-1.5 text-ink-faint">{t(locale, "No matching items")}</div>
              ) : (
                matches.map((p) => (
                  <button key={p.id} type="button" className="w-full text-start px-2 py-1.5 hover:bg-canvas flex items-center gap-1.5" onClick={() => pick(p)}>
                    <span className="text-ink-faint">{p.sku}</span>
                    <span className="truncate">{p.name}</span>
                  </button>
                ))
              )}
              {canCreate && (
                <>
                  <div className="border-t border-line" />
                  <button type="button" className="w-full text-start px-2 py-1.5 hover:bg-canvas flex items-center gap-1.5 text-brand-orange font-semibold" onClick={createNew}>
                    <PlusCircle className="size-3.5" /> {t(locale, "Create New Item")}: “{query.trim()}”
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Description: shown on the line; opened on demand for a full multiline edit. */}
        {hasItem && (
          <div className="flex flex-col gap-1">
            {!descOpen && (
              <div className="flex items-center gap-2">
                <button type="button" className="text-[11px] text-ink-faint hover:text-brand-orange inline-flex items-center gap-1" onClick={() => setDescOpen(true)}>
                  <FileText className="size-3" /> {desc.trim() ? t(locale, "Edit description") : t(locale, "Add Description")}
                </button>
                {desc.trim() && <span className="text-[11px] text-ink-muted truncate">{richTextToPlain(desc)}</span>}
              </div>
            )}
            {descOpen && (
              <div className="flex flex-col gap-1">
                <RichTextField
                  locale={locale}
                  value={desc}
                  onChange={onSetDesc}
                  placeholder={t(locale, "Write a full description…")}
                  rows={4}
                />
                <div className="flex items-center gap-2">
                  <button type="button" className="text-[11px] text-ink-faint hover:text-ink" onClick={() => { if (justCreated && item.productId) onSaveToMaster(desc); setDescOpen(false); }}>
                    {t(locale, "Done")}
                  </button>
                  {item.productId && !justCreated && (
                    <button type="button" className="text-[11px] text-brand-orange hover:opacity-80 inline-flex items-center gap-1" onClick={() => onSaveToMaster(desc)}>
                      <Check className="size-3" /> {t(locale, "Save to Item")}
                    </button>
                  )}
                  {item.productId && justCreated && (
                    <span className="text-[11px] text-success inline-flex items-center gap-1"><Check className="size-3" /> {t(locale, "Saved with the new item")}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
