"use client";

import { CurrencyMark, useCurrency } from "@/components/ui/currency-mark";
import type { CurrencyMark as Mark } from "@/lib/currency/currencies";

// Renders a monetary amount in the org's base currency: currency mark + space + formatted number.
// Per the display rule we show the symbol when available, otherwise the currency code — never both.
// Decimal places follow the currency (2 for SAR/USD, 3 for BHD/KWD/OMR, 0 for JPY/KRW, …).
// The currency comes from <CurrencyProvider> via context; pass `mark` to override it.
export function Money({ amount, mark, className }: { amount: string | number; mark?: Mark; className?: string }) {
  const ctx = useCurrency();
  const m = mark ?? ctx;
  const n = Number(amount) || 0;
  const formatted = n.toLocaleString(undefined, {
    minimumFractionDigits: m.decimalPlaces,
    maximumFractionDigits: m.decimalPlaces,
  });
  return (
    <span className={className}>
      <CurrencyMark mark={m} /> {formatted}
    </span>
  );
}
