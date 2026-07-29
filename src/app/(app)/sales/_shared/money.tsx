"use client";

import { CurrencyMark, useCurrency } from "@/components/ui/currency-mark";
import { formatMoneyNumber, formatAmount, formatRate, formatQuantity, markFormat, type CurrencyMark as Mark, type MoneyDisplayContext } from "@/lib/currency/currencies";

// Renders a monetary amount in the org's base currency: currency mark + space + formatted number.
// Show the symbol when available, otherwise the currency code — never both.
// "document" context applies the org's Number Format (grouping + configured decimals); "summary"
// context is always 0 decimals (dashboards / reports), unchanged by Number Format. The currency
// comes from <CurrencyProvider> via context; pass `mark` to override it (e.g. a settings preview).
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
  const text = context === "summary" ? formatMoneyNumber(amount, "summary") : formatAmount(amount, markFormat(m));
  return (
    <span className={className}>
      <CurrencyMark mark={m} /> {text}
    </span>
  );
}

// A symbol-less, Number-Format-aware number for document line items (rate / amount / quantity shown
// without a currency mark). Reads the org's format from context; pass `mark` to override. `kind`
// selects the rule: "amount" (money), "rate" (money + optional rate rounding), "quantity" (grouped
// + optional quantity rounding).
export function DocNum({
  value,
  kind = "amount",
  mark,
  className,
}: {
  value: string | number;
  kind?: "amount" | "rate" | "quantity";
  mark?: Mark;
  className?: string;
}) {
  const ctx = useCurrency();
  const cfg = markFormat(mark ?? ctx);
  const text = kind === "quantity" ? formatQuantity(value, cfg) : kind === "rate" ? formatRate(value, cfg) : formatAmount(value, cfg);
  return <span className={className}>{text}</span>;
}
