"use client";

import { t, type Locale } from "@/lib/i18n/dict";
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
import { useConfirm } from "../_shared/confirm-provider";
import type { Customer } from "@/db";
import { archiveClientAction, unarchiveClientAction, deleteClientAction, toggleClientActiveAction } from "./actions";

// One shared row-actions menu for both the list rows and the detail page header — mirrors the
// mockup's row_menu_template() pattern: a single small client component, not duplicated markup.
export function ClientRecordActions({ client, locale, label }: { client: Pick<Customer, "id" | "recordState" | "isActive" | "name" | "name">; locale: Locale; /** Row-specific accessible name (already translated); defaults to "Client actions". */ label?: string }) {
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  function run(action: () => Promise<void | { error?: string }>, successMessage: string) {
    startTransition(async () => {
      const result = await action();
      if (result && "error" in result && result.error) toast.error(result.error);
      else toast.success(successMessage);
    });
  }

  // Archiving hides the record and deleting moves it to the Recycle Bin — both ask first, through
  // the app-wide confirmation. Marking active/inactive and unarchiving are ordinary toggles.
  function ask(kind: "record.delete" | "document.archive", action: () => Promise<void | { error?: string }>, successMessage: string) {
    confirm({
      action: kind,
      entityType: "Client",
      entityNumber: client.name,
      onConfirm: () =>
        new Promise<{ error?: string } | void>((resolve) => {
          startTransition(async () => {
            const result = await action();
            if (result && "error" in result && result.error) {
              resolve({ error: result.error });
              return;
            }
            toast.success(successMessage);
            resolve();
          });
        }),
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" disabled={pending} aria-label={label ?? t(locale, "Client actions")}>
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className="cursor-pointer"
          onSelect={() => run(() => toggleClientActiveAction(client.id, !client.isActive), client.isActive ? t(locale, "Marked inactive") : t(locale, "Marked active"))}
        >
          <Power className="size-3.5" /> {client.isActive ? t(locale, "Mark Inactive") : t(locale, "Mark Active")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {client.recordState === "archived" ? (
          <DropdownMenuItem className="cursor-pointer" onSelect={() => run(() => unarchiveClientAction(client.id), t(locale, "Unarchived"))}>
            <ArchiveRestore className="size-3.5" /> {t(locale, "Unarchive")}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem className="cursor-pointer" onSelect={() => ask("document.archive", () => archiveClientAction(client.id), t(locale, "Archived"))}>
            <Archive className="size-3.5" /> {t(locale, "Archive")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className="cursor-pointer text-danger data-[highlighted]:bg-danger-bg"
          onSelect={() => ask("record.delete", () => deleteClientAction(client.id), t(locale, "Moved to Recycle Bin"))}
        >
          <Trash2 className="size-3.5" /> {t(locale, "Delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
