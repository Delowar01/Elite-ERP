// Unit tests for the shared Number Format utility (src/lib/currency/currencies.ts). Covers digit
// grouping (international vs Indian), the split between money decimals (the CURRENCY's) and
// quantity/rate decimals (the ORG's setting), quantity/rate rounding, custom-symbol priority, and
// currency-code fallback. Pure functions — no DB, no server-only imports.
// Run: npx tsx scripts/tests/number-format.test.ts
import {
  formatAmount,
  formatRate,
  formatQuantity,
  displayCurrency,
  buildMoneyMark,
  type NumberFormatConfig,
} from "../../src/lib/currency/currencies";

let pass = 0,
  fail = 0;
function check(name: string, got: unknown, want: unknown) {
  if (got === want) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const cfg = (o: Partial<NumberFormatConfig>): NumberFormatConfig => ({
  digitGrouping: "international",
  quantityRateDecimals: 2,
  currencyDecimals: 2,
  roundQuantities: false,
  roundRates: false,
  customCurrencySymbol: null,
  ...o,
});

console.log("Number Format utility\n");

// 1. International grouping
check("international grouping 12,345,679", formatAmount(12345679, cfg({ digitGrouping: "international", currencyDecimals: 0 })), "12,345,679");
// 2. Indian grouping
check("indian grouping 1,23,45,679", formatAmount(12345679, cfg({ digitGrouping: "indian", currencyDecimals: 0 })), "1,23,45,679");

// 3. Money decimals come from the CURRENCY
check("0 decimals (JPY-shaped)", formatAmount(1234.5, cfg({ currencyDecimals: 0 })), "1,235"); // rounds
check("2 decimals (SAR-shaped)", formatAmount(1234.5, cfg({ currencyDecimals: 2 })), "1,234.50");
check("3 decimals (KWD-shaped)", formatAmount(1234.5, cfg({ currencyDecimals: 3 })), "1,234.500");

// 3b. The org's Number Format decimals setting must NOT reach money. This is the regression that
// printed a Kuwaiti 1,250.075 as 1,250.08 because the org was left on the default 2.
check("org setting cannot shorten a KWD amount",
  formatAmount(1250.075, cfg({ currencyDecimals: 3, quantityRateDecimals: 2 })), "1,250.075");
check("org setting cannot lengthen a JPY amount",
  formatAmount(1250, cfg({ currencyDecimals: 0, quantityRateDecimals: 3 })), "1,250");
check("a KWD mark carries 3 money decimals whatever the org picked",
  buildMoneyMark({ currencyCode: "KWD", decimalPlaces: 2 }).format?.currencyDecimals, 3);
check("...while the org's own setting is still carried, for quantities and rates",
  buildMoneyMark({ currencyCode: "KWD", decimalPlaces: 2 }).format?.quantityRateDecimals, 2);
check("a JPY mark carries 0 money decimals",
  buildMoneyMark({ currencyCode: "JPY", decimalPlaces: 2 }).format?.currencyDecimals, 0);

// 4. Quantity rounding
check("quantity not rounded", formatQuantity(12.5, cfg({})), "12.5");
check("quantity rounded to whole", formatQuantity(12.5, cfg({ roundQuantities: true })), "13");
check("quantity grouping (indian)", formatQuantity(1234567, cfg({ digitGrouping: "indian", roundQuantities: true })), "12,34,567");

// 5. Rate rounding
check("rate not rounded (2 dp)", formatRate(1234.56, cfg({ quantityRateDecimals: 2 })), "1,234.56");
check("rate rounded to whole", formatRate(1234.56, cfg({ roundRates: true, quantityRateDecimals: 2 })), "1,235");
// Rates DO follow the org setting — that is what it governs now.
check("rate follows the org setting, not the currency", formatRate(1234.5678, cfg({ quantityRateDecimals: 3, currencyDecimals: 2 })), "1,234.568");

// 6. Custom symbol display priority (over the SAR asset, and over an official text symbol)
check("custom symbol wins for SAR", displayCurrency(buildMoneyMark({ currencyCode: "SAR", customCurrencySymbol: "R$" })), "R$");
check("custom symbol wins for USD", displayCurrency(buildMoneyMark({ currencyCode: "USD", customCurrencySymbol: "US$" })), "US$");

// 7. Currency-code fallback (no symbol available), and SAR never falls back to the old ﷼ glyph
check("BHD has no symbol → code", displayCurrency(buildMoneyMark({ currencyCode: "BHD" })), "BHD");
check("unknown code → itself", displayCurrency(buildMoneyMark({ currencyCode: "XYZ" })), "XYZ");
const sar = buildMoneyMark({ currencyCode: "SAR" });
check("SAR text projection is the code (asset renders visually)", displayCurrency(sar), "SAR");
check("SAR is an asset symbol (official new symbol, not ﷼)", sar.type, "asset");
check("SAR asset value is the official new symbol asset", sar.value.includes("sar-symbol"), true);

// 8. USD official symbol still shows when no custom set
check("USD official symbol", displayCurrency(buildMoneyMark({ currencyCode: "USD" })), "$");

// 9. buildMoneyMark clamps + normalizes the config
const m = buildMoneyMark({ currencyCode: "SAR", decimalPlaces: 9, digitGrouping: "indian", roundQuantities: true });
check("quantity/rate decimals clamped to 3", m.format?.quantityRateDecimals, 3);
check("grouping carried", m.format?.digitGrouping, "indian");
check("roundQuantities carried", m.format?.roundQuantities, true);
check("empty custom symbol → null", buildMoneyMark({ currencyCode: "SAR", customCurrencySymbol: "  " }).format?.customCurrencySymbol, null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
