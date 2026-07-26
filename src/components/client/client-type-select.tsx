"use client";

import { HelpCircle } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";
import { cn } from "@/lib/utils";

export type ClientType = "individual" | "company";

// Required Client Type selector (Individual / Company). The selected option shows a filled radio dot.
export function ClientTypeSelect({
  locale,
  value,
  onChange,
}: {
  locale: Locale;
  value: ClientType;
  onChange: (v: ClientType) => void;
}) {
  const options: { key: ClientType; label: string }[] = [
    { key: "individual", label: "Individual" },
    { key: "company", label: "Company" },
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[14px] font-semibold">{t(locale, "Client Type")}</span>
        <HelpCircle className="size-3.5 text-ink-faint" aria-hidden />
      </div>
      <div role="radiogroup" aria-label={t(locale, "Client Type")} className="flex items-center gap-10">
        {options.map((o) => {
          const selected = value === o.key;
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.key)}
              className="inline-flex items-center gap-2.5 text-[14px]"
            >
              <span
                className={cn(
                  "inline-flex size-[18px] items-center justify-center rounded-full border-2 transition-colors",
                  selected ? "border-brand-orange" : "border-line-strong",
                )}
              >
                {selected && <span className="size-2.5 rounded-full bg-brand-orange" />}
              </span>
              <span className={cn(selected && "font-medium")}>{t(locale, o.label)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
