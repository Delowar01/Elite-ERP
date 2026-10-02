"use client";

import { CurrencyMark, useCurrency } from "@/components/ui/currency-mark";
import { cn } from "@/lib/utils";
import { formatMoneyNumber, formatAmount, formatRate, formatQuantity, markFormat, type CurrencyMark as Mark, type MoneyDisplayContext } from "@/lib/currency/currencies";

// Renders a monetary amount in the org's base currency: currency mark + space + formatted number.
// Show the symbol when available, otherwise the currency code — never both.
// "document" context applies the org's Number Format (grouping + configured decimals); "summary"
// context is always 0 decimals (dashboards / reports), unchanged by Number Format. The currency
// comes from <CurrencyProvider> via context; pass `mark` to override it (e.g. a settings preview).
// Typography (DEV-UI-01.1-C1): money is numeric data, so it always renders in the UI face with tabular
// figures (`num-tabular`) — never in the code face, even when placed inside a legacy mono cell.
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
    <span className={cn("num-tabular", className)}>
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
  return <span className={cn("num-tabular", className)}>{text}</span>;
}
