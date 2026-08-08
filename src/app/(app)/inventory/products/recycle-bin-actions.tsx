"use client";

import { useTransition } from "react";
import { ArchiveRestore, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "../../_shared/confirm-provider";
import { restoreProductAction, permanentlyDeleteProductAction } from "./actions";

// Restore is harmless and runs straight away; permanent delete goes through the app-wide
// confirmation (see confirm-policy.ts) rather than a dialog written for this one screen.
export function ProductRecycleBinActions({ id, name, isOwner }: { id: number; name: string; isOwner: boolean }) {
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  function restore() {
    startTransition(async () => {
      const result = await restoreProductAction(id);
      if (result?.error) toast.error(result.error);
      else toast.success("Restored");
    });
  }

  function permanentlyDelete() {
    confirm({
      action: "record.permanentDelete",
      entityType: "Product",
      entityNumber: name,
      onConfirm: () =>
        new Promise<{ error?: string } | void>((resolve) => {
          startTransition(async () => {
            const result = await permanentlyDeleteProductAction(id);
            if (result?.error) {
              resolve({ error: result.error });
              return;
            }
            toast.success("Permanently deleted");
            resolve();
          });
        }),
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" disabled={pending} onClick={restore}>
        <ArchiveRestore className="size-3.5" /> Restore
      </Button>
      {isOwner && (<Button variant="ghost" size="sm" disabled={pending} onClick={permanentlyDelete} className="text-danger hover:bg-danger-bg">
        <Trash2 className="size-3.5" /> Delete Permanently
      </Button>)}
    </div>
  );
}
