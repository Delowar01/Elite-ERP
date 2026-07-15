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
import type { Vendor } from "@/db";
import { archiveVendorAction, unarchiveVendorAction, deleteVendorAction, toggleVendorActiveAction } from "./actions";

export function VendorRecordActions({ vendor }: { vendor: Pick<Vendor, "id" | "recordState" | "isActive"> }) {
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
        <Button variant="ghost" size="icon" disabled={pending} aria-label="Vendor actions">
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className="cursor-pointer"
          onSelect={() => run(() => toggleVendorActiveAction(vendor.id, !vendor.isActive), vendor.isActive ? "Marked inactive" : "Marked active")}
        >
          <Power className="size-3.5" /> Mark {vendor.isActive ? "Inactive" : "Active"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {vendor.recordState === "archived" ? (
          <DropdownMenuItem className="cursor-pointer" onSelect={() => run(() => unarchiveVendorAction(vendor.id), "Unarchived")}>
            <ArchiveRestore className="size-3.5" /> Unarchive
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem className="cursor-pointer" onSelect={() => run(() => archiveVendorAction(vendor.id), "Archived")}>
            <Archive className="size-3.5" /> Archive
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className="cursor-pointer text-danger data-[highlighted]:bg-danger-bg"
          onSelect={() => run(() => deleteVendorAction(vendor.id), "Moved to Recycle Bin")}
        >
          <Trash2 className="size-3.5" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
