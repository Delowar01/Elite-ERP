"use client";

import { useId } from "react";
import { HelpCircle } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export type ClientType = "individual" | "company";

// Required Client Type selector (Individual / Company), on the shared native RadioGroup.
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
  const labelId = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <span id={labelId} className="text-[14px] font-semibold">{t(locale, "Client Type")}</span>
        <HelpCircle className="size-3.5 text-ink-faint" aria-hidden />
      </div>
      {/* Native radios (DEV-UI-01.4). The value still reaches the server through the form's own hidden
          `clientType` input; this group's name is deliberately different so it never collides. */}
      <RadioGroup
        name={`client-type-choice${labelId}`}
        value={value}
        onValueChange={(v) => onChange(v as ClientType)}
        aria-labelledby={labelId}
        className="gap-x-10 gap-y-2"
      >
        {options.map((o) => (
          <RadioGroupItem key={o.key} value={o.key}>
            {t(locale, o.label)}
          </RadioGroupItem>
        ))}
      </RadioGroup>
    </div>
  );
}
