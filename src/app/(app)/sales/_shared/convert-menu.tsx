"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { t, type Locale } from "@/lib/i18n/dict";
import { getConvertTargets, type ConvertSource, type ConvertCtx } from "./convert-config";
import { useConvertConfirm } from "../../_shared/confirm-actions";

// The document Preview / detail "Convert to…" menu. Built entirely from the shared convert-config,
// so it always matches the list/detail three-dot menu (same targets, order, labels, icons, gating,
// and conversion actions). Renders nothing when no conversion is currently allowed.
export function ConvertMenu({
  locale,
  source,
  id,
  number,
  typeLabel,
  ctx,
  disabled,
}: {
  locale: Locale;
  source: ConvertSource;
  id: number;
  /** The source document's own number, shown in the confirmation. */
  number: string;
  /** i18n key for the source document's type, e.g. "Quotation". */
  typeLabel: string;
  ctx: ConvertCtx;
  disabled?: boolean;
}) {
  const { requestConvert } = useConvertConfirm(locale);
  const targets = getConvertTargets(source, ctx);
  if (targets.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="glass" style={{ width: "auto" }} disabled={disabled}>
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
              onSelect={() => requestConvert(target, id, typeLabel, number)}
            >
              <Icon className="size-3.5 me-2.5 opacity-80" /> {t(locale, target.labelKey)}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
