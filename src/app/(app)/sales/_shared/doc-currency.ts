import { buildMoneyMark, type CurrencyMark } from "@/lib/currency/currencies";
import type { Org } from "@/db";

// Build the money mark for a document from its selected currency + the org's Number Format settings
// (grouping / decimals / rounding). The org's custom currency symbol only applies when the document
// uses the org's own base currency — a document billed in another currency shows that currency's own
// symbol/code. Shared by document forms (live display), detail pages, preview, and print/PDF so a
// selected currency renders consistently everywhere. No exchange rate or conversion is applied.
export function docMoneyMark(org: Org, currency: string | null | undefined): CurrencyMark {
  const code = currency || org.currency;
  return buildMoneyMark({
    currencyCode: code,
    customCurrencySymbol: code === org.currency ? org.customCurrencySymbol : null,
    digitGrouping: org.numberDigitGrouping,
    decimalPlaces: org.numberDecimalPlaces,
    roundQuantities: org.roundQuantities,
    roundRates: org.roundRates,
  });
}
