"use client";

import { useState } from "react";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { t, type Locale } from "@/lib/i18n/dict";
import { currencySelectOptions } from "@/lib/currency/currencies";

// In-document currency picker. Clicking the "Currency" config pill opens this popup with the full
// currency catalog (searchable by country, currency name, or code). Selecting a currency updates the
// document's currency immediately and closes — no redirect, all unsaved document data preserved. The
// selected currency is saved with the document; no exchange rate or conversion is applied.
export function CurrencyPillDialog({
  locale,
  value,
  onChange,
  trigger,
}: {
  locale: Locale;
  value: string;
  onChange: (code: string) => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const options = currencySelectOptions();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t(locale, "Currency")}</DialogTitle>
        </DialogHeader>
        <SearchableSelect
          options={options}
          value={value}
          onChange={(v) => {
            onChange(v);
            setOpen(false);
          }}
          placeholder={t(locale, "Select a currency")}
          searchPlaceholder={t(locale, "Search country, name or code…")}
          emptyText={t(locale, "No matches.")}
          aria-label={t(locale, "Currency")}
        />
        <p className="text-[11px] text-ink-faint">
          {t(locale, "Amounts on this document display in the selected currency. No exchange rate or conversion is applied.")}
        </p>
      </DialogContent>
    </Dialog>
  );
}
