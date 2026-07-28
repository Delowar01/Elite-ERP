"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { PlusCircle, FileText, Loader2, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
//    place. The results list is rendered in a body portal (fixed-positioned) so it is never clipped
//    by the line-item table's overflow and always stacks above surrounding content.
//  • Description: a separate large, responsive popup for a full multiline description, shown on the
//    line and stored on the line. For a newly-created item the description is saved onto the item;
//    for an existing item it stays document-local until "Save to Item". Nothing leaves the page.
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
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [descOpen, setDescOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // Keep the input in sync when the line's name changes externally (item picked/created), but never
  // while the user is typing (avoids caret jumps).
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setQuery(displayName);
  }, [displayName]);

  function openList() {
    const el = inputRef.current;
    if (el) { const r = el.getBoundingClientRect(); setRect({ top: r.bottom + 4, left: r.left, width: r.width }); }
    setOpen(true);
  }

  // While open, keep the portal aligned to the input (scroll/resize) and close on an outside press.
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const el = inputRef.current;
      if (el) { const r = el.getBoundingClientRect(); setRect({ top: r.bottom + 4, left: r.left, width: r.width }); }
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (inputRef.current?.contains(target) || dropRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

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
  // Closing the description popup saves it onto a just-created item (its own new item); existing
  // items are only updated via the explicit "Save to Item" button.
  function closeDesc() {
    if (justCreated && item.productId) onSaveToMaster(desc);
    setDescOpen(false);
  }

  return (
    <div className="item-desc-cell">
      {showThumb && (
        <ItemImageDialog locale={locale} imageUrl={item.imageUrl || undefined} onUploaded={(url) => onPatch({ imageUrl: url })} />
      )}
      <div style={{ flex: 1, minWidth: 0 }} className="flex flex-col gap-1.5">
        {/* Item name field (the searchable list is portaled to <body>, below). */}
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); onPatch({ description: e.target.value, productId: "" }); openList(); }}
            onFocus={openList}
            placeholder={t(locale, "Item name")}
            className="flex-1 h-8 rounded-[8px] border border-line px-2 text-xs outline-none focus:border-brand-orange bg-surface"
          />
          {pending && <Loader2 className="size-3.5 animate-spin text-brand-orange shrink-0" />}
        </div>

        {/* Description: shown on the line; opened on demand in a large responsive popup. */}
        {hasItem && (
          <div className="flex items-center gap-2">
            <button type="button" className="text-[11px] text-ink-faint hover:text-brand-orange inline-flex items-center gap-1 shrink-0" onClick={() => setDescOpen(true)}>
              <FileText className="size-3" /> {desc.trim() ? t(locale, "Edit description") : t(locale, "Add Description")}
            </button>
            {desc.trim() && <span className="text-[11px] text-ink-muted truncate">{richTextToPlain(desc)}</span>}
          </div>
        )}
      </div>

      {/* Portaled results list — fixed-positioned to the input, above all surrounding content. */}
      {open && rect && typeof document !== "undefined" && createPortal(
        <div
          ref={dropRef}
          style={{ position: "fixed", top: rect.top, left: rect.left, width: Math.max(rect.width, 180), zIndex: 120 }}
          className="max-h-64 overflow-auto rounded-[10px] border border-line bg-surface-raised shadow-lg text-xs"
        >
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
        </div>,
        document.body,
      )}

      {/* Large, responsive, scrollable description popup. */}
      <Dialog open={descOpen} onOpenChange={(o) => (o ? setDescOpen(true) : closeDesc())}>
        <DialogContent className="max-w-2xl w-[92vw] max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{displayName.trim() || t(locale, "Description")}</DialogTitle>
          </DialogHeader>
          <RichTextField
            locale={locale}
            value={desc}
            onChange={onSetDesc}
            placeholder={t(locale, "Write a full description…")}
            minHeightPx={200}
            maxHeightPx={360}
          />
          <DialogFooter>
            {item.productId && justCreated && (
              <span className="text-[11px] text-success inline-flex items-center gap-1 me-auto"><Check className="size-3" /> {t(locale, "Saved with the new item")}</span>
            )}
            {item.productId && !justCreated && (
              <Button type="button" variant="glass" onClick={() => onSaveToMaster(desc)}>
                <Check className="size-3.5" /> {t(locale, "Save to Item")}
              </Button>
            )}
            <Button type="button" onClick={closeDesc}>{t(locale, "Done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
