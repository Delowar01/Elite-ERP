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
import { adjustStockAction } from "./actions";

export function AdjustStockDialog({ productId, currentQty }: { productId: number; currentQty: number }) {
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState("0");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const parsedDelta = Number(delta) || 0;
  const resultingQty = currentQty + parsedDelta;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="glass" size="sm">
          Adjust stock
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust stock</DialogTitle>
          <DialogDescription>Manually correct the quantity on hand. Current: {currentQty}.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delta">Delta (use negative to subtract)</Label>
            <Input id="delta" type="number" value={delta} onChange={(e) => setDelta(e.target.value)} />
            <p className="text-xs text-ink-faint">Resulting quantity: {resultingQty}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Stock count correction" />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="primary"
            disabled={pending || resultingQty < 0 || parsedDelta === 0}
            onClick={() => {
              startTransition(async () => {
                try {
                  await adjustStockAction(productId, parsedDelta, reason || "No reason given");
                  toast.success("Stock adjusted");
                  setOpen(false);
                  setDelta("0");
                  setReason("");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Failed to adjust stock");
                }
              });
            }}
          >
            {pending ? "Saving…" : "Apply adjustment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
