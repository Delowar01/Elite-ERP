"use client";

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { t, type Locale } from "@/lib/i18n/dict";
import { adjustStockAction } from "./actions";

// ACC-01: an adjustment is a valued stock movement. Adding stock needs the unit cost of what is added
// (no stock is ever valued without one); removing it takes the weighted-average cost. The action
// returns its refusal, already in the session's language.
export function AdjustStockDialog({ productId, currentQty, locale = "en" }: { productId: number; currentQty: number; locale?: Locale }) {
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState("0");
  const [reason, setReason] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [pending, startTransition] = useTransition();

  const parsedDelta = Number(delta) || 0;
  const resultingQty = currentQty + parsedDelta;
  const adding = parsedDelta > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="glass" size="sm">
          {t(locale, "Adjust stock")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(locale, "Adjust stock")}</DialogTitle>
          <DialogDescription>
            {t(locale, "Manually correct the quantity on hand.")} {t(locale, "Current")}: <span className="num">{currentQty}</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delta">{t(locale, "Change in quantity (negative to remove)")}</Label>
            <Input id="delta" type="number" step="1" value={delta} onChange={(e) => setDelta(e.target.value)} />
            <p className="text-xs text-ink-faint">
              {t(locale, "Resulting quantity")}: <span className="num">{resultingQty}</span>
            </p>
          </div>
          {adding && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="unitCost">{t(locale, "Unit cost of the stock added")}</Label>
              <Input id="unitCost" type="number" step="any" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} aria-describedby="unitCost-description" />
              <p id="unitCost-description" className="text-xs text-ink-faint">
                {t(locale, "In the base currency. Removals leave at the weighted-average cost.")}
              </p>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reason">{t(locale, "Reason")}</Label>
            <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t(locale, "Stock count correction")} />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="primary"
            disabled={pending || resultingQty < 0 || parsedDelta === 0 || !Number.isInteger(parsedDelta) || (adding && unitCost.trim() === "")}
            onClick={() => {
              startTransition(async () => {
                const result = await adjustStockAction(productId, parsedDelta, reason || "No reason given", adding ? unitCost : undefined);
                if (result?.error) {
                  toast.error(t(locale, result.error));
                  return;
                }
                toast.success(t(locale, "Stock adjusted"));
                setOpen(false);
                setDelta("0");
                setReason("");
                setUnitCost("");
              });
            }}
          >
            {pending ? t(locale, "Saving…") : t(locale, "Apply adjustment")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
