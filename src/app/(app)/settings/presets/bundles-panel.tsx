"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Package } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import type { ProductBundle, ProductBundleItem, Product } from "@/db";
import { createBundleAction, deleteBundleAction, addBundleItemAction, removeBundleItemAction } from "./actions";

type BundleWithItems = ProductBundle & { items: (ProductBundleItem & { productName: string; productSku: string })[] };

export function BundlesPanel({
  locale,
  bundles,
  products,
}: {
  locale: Locale;
  bundles: BundleWithItems[];
  products: Pick<Product, "id" | "name" | "sku">[];
}) {
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<BundleWithItems | null>(null);
  const [productId, setProductId] = useState<string>("");
  const [pending, startTransition] = useTransition();

  function createBundle(formData: FormData) {
    const name = String(formData.get("name") ?? "");
    startTransition(async () => {
      const result = await createBundleAction(name);
      if (result.error) toast.error(result.error);
      else {
        toast.success(t(locale, "Saved"));
        setCreating(false);
      }
    });
  }

  function deleteBundle(id: number) {
    startTransition(async () => {
      const result = await deleteBundleAction(id);
      if (result.error) toast.error(result.error);
      else toast.success(t(locale, "Deleted"));
    });
  }

  function addItem(formData: FormData) {
    if (!managing) return;
    const quantity = String(formData.get("quantity") ?? "1");
    const pid = Number(productId);
    if (!pid) {
      toast.error(t(locale, "Select a product."));
      return;
    }
    startTransition(async () => {
      const result = await addBundleItemAction(managing.id, pid, quantity);
      if (result.error) toast.error(result.error);
      else {
        toast.success(t(locale, "Saved"));
        setProductId("");
      }
    });
  }

  function removeItem(itemId: number, bundleId: number) {
    startTransition(async () => {
      const result = await removeBundleItemAction(itemId, bundleId);
      if (result.error) toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {bundles.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-ink-muted text-sm">{t(locale, "No bundles yet.")}</CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Bundle Name")}</TableHead>
              <TableHead className="text-right">{t(locale, "Items")}</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {bundles.map((bundle) => (
              <TableRow key={bundle.id}>
                <TableCell className="font-medium">{bundle.name}</TableCell>
                <TableCell className="text-right font-mono text-xs">{bundle.items.length}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => setManaging(bundle)}>
                    <Package className="size-3.5" /> {t(locale, "Manage")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={pending}
                    onClick={() => deleteBundle(bundle.id)}
                    aria-label={t(locale, "Delete")}
                    className="text-danger hover:text-danger"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="add-row-btn" onClick={() => setCreating(true)} role="button">
        <Plus className="size-3.5" /> {t(locale, "Add Bundle")}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(locale, "Add Bundle")}</DialogTitle>
          </DialogHeader>
          <form action={createBundle} className="flex flex-col gap-4">
            <FormField label={t(locale, "Bundle Name")} htmlFor="bundle-name">
              <Input id="bundle-name" name="name" required autoFocus />
            </FormField>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? t(locale, "Saving…") : t(locale, "Save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={managing !== null} onOpenChange={(open) => !open && setManaging(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{managing?.name}</DialogTitle>
          </DialogHeader>
          {managing && (
            <div className="flex flex-col gap-4">
              {managing.items.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {managing.items.map((item) => (
                    <li key={item.id} className="flex items-center justify-between text-[13px] py-1.5 border-b border-line last:border-0">
                      <span>
                        {item.productName} <span className="text-ink-faint font-mono text-xs">{item.productSku}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-xs">× {item.quantity}</span>
                        <Button variant="ghost" size="icon" disabled={pending} onClick={() => removeItem(item.id, managing.id)} aria-label={t(locale, "Delete")}>
                          <Trash2 className="size-3.5 text-danger" />
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <form action={addItem} className="flex items-end gap-2">
                <FormField label={t(locale, "Item")} htmlFor="bundle-product" className="flex-1">
                  <Select value={productId} onValueChange={setProductId}>
                    <SelectTrigger id="bundle-product">
                      <SelectValue placeholder={t(locale, "Select a product")} />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name} ({p.sku})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label={t(locale, "Qty")} htmlFor="bundle-qty" className="w-20">
                  <Input id="bundle-qty" name="quantity" type="number" step="any" defaultValue="1" />
                </FormField>
                <Button type="submit" disabled={pending}>
                  <Plus className="size-4" />
                </Button>
              </form>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
