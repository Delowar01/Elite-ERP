"use client";

import { useTransition } from "react";
import { MoreVertical, Archive, ArchiveRestore, Trash2, Power } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { Product } from "@/db";
import { archiveProductAction, unarchiveProductAction, deleteProductAction, toggleProductActiveAction } from "./actions";

export function ProductRecordActions({ product }: { product: Pick<Product, "id" | "recordState" | "isActive"> }) {
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<void | { error?: string }>, successMessage: string) {
    startTransition(async () => {
      const result = await action();
      if (result && "error" in result && result.error) toast.error(result.error);
      else toast.success(successMessage);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" disabled={pending} aria-label="Product actions">
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className="cursor-pointer"
          onSelect={() => run(() => toggleProductActiveAction(product.id, !product.isActive), product.isActive ? "Marked inactive" : "Marked active")}
        >
          <Power className="size-3.5" /> Mark {product.isActive ? "Inactive" : "Active"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {product.recordState === "archived" ? (
          <DropdownMenuItem className="cursor-pointer" onSelect={() => run(() => unarchiveProductAction(product.id), "Unarchived")}>
            <ArchiveRestore className="size-3.5" /> Unarchive
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem className="cursor-pointer" onSelect={() => run(() => archiveProductAction(product.id), "Archived")}>
            <Archive className="size-3.5" /> Archive
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className="cursor-pointer text-danger data-[highlighted]:bg-danger-bg"
          onSelect={() => run(() => deleteProductAction(product.id), "Moved to Recycle Bin")}
        >
          <Trash2 className="size-3.5" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
