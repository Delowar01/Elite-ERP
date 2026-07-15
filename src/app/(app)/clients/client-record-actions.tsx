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
import type { Customer } from "@/db";
import { archiveClientAction, unarchiveClientAction, deleteClientAction, toggleClientActiveAction } from "./actions";

// One shared row-actions menu for both the list rows and the detail page header — mirrors the
// mockup's row_menu_template() pattern: a single small client component, not duplicated markup.
export function ClientRecordActions({ client }: { client: Pick<Customer, "id" | "recordState" | "isActive"> }) {
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
        <Button variant="ghost" size="icon" disabled={pending} aria-label="Client actions">
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className="cursor-pointer"
          onSelect={() => run(() => toggleClientActiveAction(client.id, !client.isActive), client.isActive ? "Marked inactive" : "Marked active")}
        >
          <Power className="size-3.5" /> Mark {client.isActive ? "Inactive" : "Active"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {client.recordState === "archived" ? (
          <DropdownMenuItem className="cursor-pointer" onSelect={() => run(() => unarchiveClientAction(client.id), "Unarchived")}>
            <ArchiveRestore className="size-3.5" /> Unarchive
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem className="cursor-pointer" onSelect={() => run(() => archiveClientAction(client.id), "Archived")}>
            <Archive className="size-3.5" /> Archive
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className="cursor-pointer text-danger data-[highlighted]:bg-danger-bg"
          onSelect={() => run(() => deleteClientAction(client.id), "Moved to Recycle Bin")}
        >
          <Trash2 className="size-3.5" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
