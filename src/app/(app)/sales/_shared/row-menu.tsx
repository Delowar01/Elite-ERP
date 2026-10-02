"use client";

import { useState } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { MoreVertical, RefreshCw, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

export type RowMenuEntry =
  | { kind: "item"; icon: LucideIcon; label: string; onSelect?: () => void; href?: string; danger?: boolean }
  | { kind: "convert"; label: string; targets: { label: string; icon?: LucideIcon; onSelect: () => void }[] }
  | { kind: "separator" };

// The shared row-actions menu of the list tables. DEV-UI-01.5: the trigger is the approved 36px ghost
// icon Button (it keeps the `row-menu-btn` class only as a hook) and carries a localized accessible
// name — callers pass a row-specific one such as "Actions for INV-0006". An entry with neither a
// handler nor a link is an unavailable placeholder: it is a truly disabled menu item (Radix
// `disabled`: aria-disabled, skipped by the keyboard, not actionable), not a greyed enabled one.
export function RowMenu({ entries, label }: { entries: RowMenuEntry[]; label: string }) {
  const [convertOpen, setConvertOpen] = useState(false);
  return (
    <DropdownMenu onOpenChange={(open) => !open && setConvertOpen(false)}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="row-menu-btn data-[state=open]:bg-surface-subtle data-[state=open]:text-ink" aria-label={label}>
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      {/* The inline Convert list grows the open menu; cap it to the space Radix measured so it scrolls instead
          of running off-screen (short viewports, e.g. 1024×768). */}
      <DropdownMenuContent align="end" className="max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto">
        {entries.map((e, i) => {
          if (e.kind === "separator") return <DropdownMenuSeparator key={i} />;
          if (e.kind === "convert") {
            return (
              <div key={i}>
                <DropdownMenuItem
                  className={cn("has-submenu", convertOpen && "expanded")}
                  aria-expanded={convertOpen}
                  onSelect={(ev) => {
                    ev.preventDefault();
                    setConvertOpen((v) => !v);
                  }}
                >
                  <RefreshCw className="size-3.5 me-2.5 opacity-80" /> {e.label}
                  <ChevronRight className="size-3.5" />
                </DropdownMenuItem>
                <div className={cn("row-menu-submenu", convertOpen && "open")}>
                  {e.targets.map((target) => {
                    const TIcon = target.icon;
                    return (
                      <DropdownMenuItem key={target.label} className="cursor-pointer" onSelect={target.onSelect}>
                        {TIcon && <TIcon className="size-3.5 me-2.5 opacity-80" />} {target.label}
                      </DropdownMenuItem>
                    );
                  })}
                </div>
              </div>
            );
          }
          const Icon = e.icon;
          const unavailable = !e.onSelect && !e.href;
          const cls = cn(e.danger && "danger");
          if (e.href) {
            return (
              <DropdownMenuItem key={i} asChild className={cls}>
                <Link href={e.href}>
                  <Icon className="size-3.5 me-2.5 opacity-80" /> {e.label}
                </Link>
              </DropdownMenuItem>
            );
          }
          return (
            <DropdownMenuItem key={i} className={cls} onSelect={e.onSelect} disabled={unavailable}>
              <Icon className="size-3.5 me-2.5 opacity-80" /> {e.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
