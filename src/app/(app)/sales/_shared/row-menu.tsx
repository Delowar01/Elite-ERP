"use client";

import { useState } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { MoreVertical, RefreshCw, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

export type RowMenuEntry =
  | { kind: "item"; icon: LucideIcon; label: string; onSelect?: () => void; href?: string; danger?: boolean }
  | { kind: "convert"; label: string; targets: { label: string; onSelect: () => void }[] }
  | { kind: "separator" };

export function RowMenu({ entries }: { entries: RowMenuEntry[] }) {
  const [convertOpen, setConvertOpen] = useState(false);
  return (
    <DropdownMenu onOpenChange={(open) => !open && setConvertOpen(false)}>
      <DropdownMenuTrigger className="row-menu-btn outline-none">
        <MoreVertical className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {entries.map((e, i) => {
          if (e.kind === "separator") return <DropdownMenuSeparator key={i} />;
          if (e.kind === "convert") {
            return (
              <div key={i}>
                <DropdownMenuItem
                  className={cn("has-submenu", convertOpen && "expanded")}
                  onSelect={(ev) => {
                    ev.preventDefault();
                    setConvertOpen((v) => !v);
                  }}
                >
                  <RefreshCw className="size-3.5 me-2.5 opacity-80" /> {e.label}
                  <ChevronRight className="size-3.5" />
                </DropdownMenuItem>
                <div className={cn("row-menu-submenu", convertOpen && "open")}>
                  {e.targets.map((target) => (
                    <DropdownMenuItem key={target.label} className="cursor-pointer" onSelect={target.onSelect}>
                      {target.label}
                    </DropdownMenuItem>
                  ))}
                </div>
              </div>
            );
          }
          const Icon = e.icon;
          const disabled = !e.onSelect && !e.href;
          const cls = cn(e.danger && "danger", disabled && "opacity-45 pointer-events-none");
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
            <DropdownMenuItem key={i} className={cls} onSelect={e.onSelect}>
              <Icon className="size-3.5 me-2.5 opacity-80" /> {e.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
