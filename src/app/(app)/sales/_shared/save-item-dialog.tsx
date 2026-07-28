"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { t, type Locale } from "@/lib/i18n/dict";
import { RichTextField } from "./rich-text-field";
import { ItemImageDialog } from "./item-image-dialog";
import { saveLineItemAsProductAction, type SavedItem } from "./creation-popup-actions";

// In-page "Save this item" popup. Promotes the current document line into a saved product without
// leaving the document — captures name / description / image / unit / rate / tax, saves to the master,
// and hands the new product back so the caller can auto-link the line. Unsaved document data is never
// touched (this only reads the line's values and writes to the product master).
export function SaveItemDialog({
  locale,
  open,
  onOpenChange,
  initial,
  showPricing = true,
  onSaved,
}: {
  locale: Locale;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: { name: string; description: string; imageUrl: string; unit: string; unitPrice: string; taxRatePercent: string };
  showPricing?: boolean;
  onSaved: (product: SavedItem) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [imageUrl, setImageUrl] = useState(initial.imageUrl);
  const [unit, setUnit] = useState(initial.unit);
  const [unitPrice, setUnitPrice] = useState(initial.unitPrice);
  const [taxRatePercent, setTaxRatePercent] = useState(initial.taxRatePercent);
  const [pending, start] = useTransition();

  // Re-seed the form from the line each time the dialog opens (values may have changed since mount).
  const [seededFor, setSeededFor] = useState(false);
  if (open && !seededFor) {
    setName(initial.name); setDescription(initial.description); setImageUrl(initial.imageUrl);
    setUnit(initial.unit); setUnitPrice(initial.unitPrice); setTaxRatePercent(initial.taxRatePercent);
    setSeededFor(true);
  }
  if (!open && seededFor) setSeededFor(false);

  function save() {
    start(async () => {
      const res = await saveLineItemAsProductAction({ name, description, imageUrl, unit, unitPrice, taxRatePercent });
      if (res.error || !res.product) { toast.error(res.error ?? t(locale, "Something went wrong.")); return; }
      toast.success(t(locale, "Item saved to your product list."));
      onSaved(res.product);
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(locale, "Save item to your product list")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <div className="flex flex-col items-center gap-1">
              <ItemImageDialog locale={locale} imageUrl={imageUrl || undefined} onUploaded={setImageUrl} />
              <span className="text-[10px] text-ink-faint">{t(locale, "Add Image")}</span>
            </div>
            <div className="flex-1">
              <FormField label={t(locale, "Item name")} htmlFor="si-name">
                <Input id="si-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
              </FormField>
            </div>
          </div>
          <FormField label={t(locale, "Description")} htmlFor="si-desc">
            <RichTextField locale={locale} value={description} onChange={setDescription} placeholder={t(locale, "Description")} />
          </FormField>
          <div className="grid grid-cols-3 gap-3">
            <FormField label={t(locale, "Unit")} htmlFor="si-unit">
              <Input id="si-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </FormField>
            {showPricing && (
              <>
                <FormField label={t(locale, "Rate")} htmlFor="si-rate">
                  <Input id="si-rate" type="number" step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
                </FormField>
                <FormField label={t(locale, "Tax %")} htmlFor="si-tax">
                  <Input id="si-tax" type="number" step="0.01" value={taxRatePercent} onChange={(e) => setTaxRatePercent(e.target.value)} />
                </FormField>
              </>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="glass" onClick={() => onOpenChange(false)} disabled={pending}>
            {t(locale, "Cancel")}
          </Button>
          <Button type="button" onClick={save} disabled={pending || !name.trim()}>
            {pending ? t(locale, "Saving…") : t(locale, "Save this item")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
