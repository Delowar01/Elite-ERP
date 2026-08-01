"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { t, type Locale } from "@/lib/i18n/dict";
import { getConvertTargets, runConvertTarget, type ConvertSource, type ConvertCtx } from "./convert-config";

// The document Preview / detail "Convert to…" menu. Built entirely from the shared convert-config,
// so it always matches the list/detail three-dot menu (same targets, order, labels, icons, gating,
// and conversion actions). Renders nothing when no conversion is currently allowed.
export function ConvertMenu({
  locale,
  source,
  id,
  ctx,
  disabled,
}: {
  locale: Locale;
  source: ConvertSource;
  id: number;
  ctx: ConvertCtx;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const targets = getConvertTargets(source, ctx);
  if (targets.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="glass" style={{ width: "auto" }} disabled={disabled || pending}>
          {t(locale, "Convert to…")} <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {targets.map((target) => {
          const Icon = target.icon;
          return (
            <DropdownMenuItem
              key={target.key}
              className="cursor-pointer"
              onSelect={() => runConvertTarget(target, id, startTransition, (m) => toast.error(m))}
            >
              <Icon className="size-3.5 me-2.5 opacity-80" /> {t(locale, target.labelKey)}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
