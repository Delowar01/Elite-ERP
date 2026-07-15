"use client";

import { useState, useTransition } from "react";
import { ArchiveRestore, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { restoreProductAction, permanentlyDeleteProductAction } from "./actions";

export function ProductRecycleBinActions({ id, name }: { id: number; name: string }) {
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function restore() {
    startTransition(async () => {
      const result = await restoreProductAction(id);
      if (result?.error) toast.error(result.error);
      else toast.success("Restored");
    });
  }

  function permanentlyDelete() {
    startTransition(async () => {
      const result = await permanentlyDeleteProductAction(id);
      if (result?.error) toast.error(result.error);
      else toast.success("Permanently deleted");
      setConfirmOpen(false);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" disabled={pending} onClick={restore}>
        <ArchiveRestore className="size-3.5" /> Restore
      </Button>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" disabled={pending} className="text-danger hover:bg-danger-bg">
            <Trash2 className="size-3.5" /> Delete Permanently
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &quot;{name}&quot; permanently?</DialogTitle>
            <DialogDescription>
              This cannot be undone. The record will be removed entirely, not just moved to the Recycle Bin.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" disabled={pending} onClick={permanentlyDelete}>
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
