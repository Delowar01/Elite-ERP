"use client";

import { CurrencyMark, useCurrency } from "@/components/ui/currency-mark";
import { formatMoneyNumber, type CurrencyMark as Mark, type MoneyDisplayContext } from "@/lib/currency/currencies";

// Renders a monetary amount in the org's base currency: currency mark + space + formatted number.
// Show the symbol when available, otherwise the currency code — never both.
// Decimals follow the DISPLAY CONTEXT, not the currency: "document" → always 2 decimals,
// "summary" → always 0 (rounded). Documents are the default so a formal amount never loses cents.
// The currency comes from <CurrencyProvider> via context; pass `mark` to override it.
export function Money({
  amount,
  context = "document",
  mark,
  className,
}: {
  amount: string | number;
  context?: MoneyDisplayContext;
  mark?: Mark;
  className?: string;
}) {
  const ctx = useCurrency();
  const m = mark ?? ctx;
  return (
    <span className={className}>
      <CurrencyMark mark={m} /> {formatMoneyNumber(amount, context)}
    </span>
  );
}
