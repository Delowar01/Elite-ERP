"use client";

import { createContext, useContext } from "react";
import { RiyalSymbol } from "@/components/ui/riyal-symbol";
import { SAR_SYMBOL_ASSET, type CurrencyMark as Mark } from "@/lib/currency/currencies";

// Shared currency-rendering layer. A currency symbol is NOT always a plain character — the official
// SAR symbol is an image asset — so this renders three cases:
//   1. text symbol  → the character(s) as-is
//   2. asset symbol → the official SVG (inline for theme-aware currentColor)
//   3. no symbol    → the ISO code (fallback)
// The org's base currency is provided once via <CurrencyProvider> (fed server-side) and read by
// <CurrencyMark>/<Money> through context, so no component has to thread the currency down manually.

// Default keeps SAR behaviour if a consumer is ever rendered outside a provider.
const DEFAULT_MARK: Mark = { type: "asset", value: SAR_SYMBOL_ASSET, fallback: "SAR", decimalPlaces: 2, code: "SAR", name: "Saudi Riyal" };

const CurrencyContext = createContext<Mark>(DEFAULT_MARK);

export function CurrencyProvider({ mark, children }: { mark: Mark; children: React.ReactNode }) {
  return <CurrencyContext.Provider value={mark}>{children}</CurrencyContext.Provider>;
}

export function useCurrency(): Mark {
  return useContext(CurrencyContext);
}

// Renders just the currency mark (symbol or code fallback). Pass `mark` to override the org currency
// (e.g. a settings preview); otherwise it uses the org currency from context.
export function CurrencyMark({ mark, className }: { mark?: Mark; className?: string }) {
  const m = mark ?? useContext(CurrencyContext); // eslint-disable-line react-hooks/rules-of-hooks
  if (m.type === "asset") {
    // Our only asset currency is SAR; the official symbol renders inline so it inherits the text
    // colour (correct in light and dark). The same vector is also stored at m.value for PDF/img use.
    return <RiyalSymbol className={className} />;
  }
  const text = m.value.trim();
  return <span className={className}>{text || m.fallback}</span>;
}
