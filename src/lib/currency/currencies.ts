// Complete, current ISO 4217 currency catalog for Elite ERP. One entry per active currency, each
// tied to a representative country, its code, and a display symbol. This is the "currency data
// model": a symbol can be plain text OR an official asset (SVG/PNG), so every entry carries a
// symbolType + symbolValue + symbolFallback (the code, shown when no usable symbol exists).
//
// Display rule (see resolveCurrencyMark / displayCurrency + <CurrencyMark>): show the symbol when
// one is available, otherwise the currency code — never both beside every amount.
//
// SAR uses the official new Saudi Riyal symbol issued by SAMA, stored locally as an asset
// (public/assets/currencies/sar-symbol.svg + .png) — never the old ﷼ glyph and never ر.س.

export type CurrencySymbolType = "text" | "asset";

export type Currency = {
  countryCode: string;   // ISO 3166-1 alpha-2 of a representative country
  countryName: string;
  currencyCode: string;  // ISO 4217 alpha-3
  currencyName: string;
  symbolType: CurrencySymbolType;
  symbolValue: string;   // text symbol, or an app-relative asset path when symbolType === "asset"
  symbolFallback: string; // shown when no usable symbol is available (always the ISO code)
  decimalPlaces: number; // ISO 4217 minor units (0, 2 or 3)
  isActive: boolean;
};

// ---- Number Format (per-org display configuration, Business Settings → Number Format) ----
// Applies to DOCUMENT display only (forms / detail / preview / print / PDF). It never changes stored
// accounting values and never re-computes server totals — those always run on the raw stored numbers.
export type DigitGrouping = "international" | "indian";

export type NumberFormatConfig = {
  digitGrouping: DigitGrouping; // international 12,345,679  |  indian 1,23,45,679
  decimalPlaces: number;        // 0 | 1 | 2 | 3 — how many decimals money amounts show in documents
  roundQuantities: boolean;     // display quantities rounded to whole numbers
  roundRates: boolean;          // display rates rounded to whole numbers
  customCurrencySymbol: string | null; // optional symbol override (highest display priority)
};

// Existing orgs default here: 2 decimals, international grouping, no rounding, no custom symbol.
export const DEFAULT_NUMBER_FORMAT: NumberFormatConfig = {
  digitGrouping: "international",
  decimalPlaces: 2,
  roundQuantities: false,
  roundRates: false,
  customCurrencySymbol: null,
};

// A resolved, render-ready mark. Kept small so it can cross the server→client boundary cheaply.
// `format` carries the org's Number Format config so a single mark drives symbol + grouping +
// decimals everywhere it flows (context on the client, explicit prop on the print route).
export type CurrencyMark = {
  type: CurrencySymbolType;
  value: string;
  fallback: string;
  decimalPlaces: number;
  code: string;
  name: string;
  format?: NumberFormatConfig;
};

export const SAR_SYMBOL_ASSET = "/assets/currencies/sar-symbol.svg";
export const SAR_SYMBOL_ASSET_PNG = "/assets/currencies/sar-symbol.png";

// Helper to keep each row terse. Empty `symbol` => the code is shown (fallback), per the display rule.
function c(
  countryCode: string,
  countryName: string,
  currencyCode: string,
  currencyName: string,
  symbol: string,
  decimalPlaces = 2,
): Currency {
  return {
    countryCode,
    countryName,
    currencyCode,
    currencyName,
    symbolType: "text",
    symbolValue: symbol,
    symbolFallback: currencyCode,
    decimalPlaces,
    isActive: true,
  };
}

export const CURRENCIES: Currency[] = [
  // Saudi Arabia — official SAMA new symbol, rendered from the locally-stored asset.
  {
    countryCode: "SA",
    countryName: "Saudi Arabia",
    currencyCode: "SAR",
    currencyName: "Saudi Riyal",
    symbolType: "asset",
    symbolValue: SAR_SYMBOL_ASSET,
    symbolFallback: "SAR",
    decimalPlaces: 2,
    isActive: true,
  },
  c("AE", "United Arab Emirates", "AED", "UAE Dirham", "د.إ"),
  c("AF", "Afghanistan", "AFN", "Afghan Afghani", "؋"),
  c("AL", "Albania", "ALL", "Albanian Lek", "L"),
  c("AM", "Armenia", "AMD", "Armenian Dram", "֏"),
  c("CW", "Curaçao", "ANG", "Netherlands Antillean Guilder", "ƒ"),
  c("AO", "Angola", "AOA", "Angolan Kwanza", "Kz"),
  c("AR", "Argentina", "ARS", "Argentine Peso", "$"),
  c("AU", "Australia", "AUD", "Australian Dollar", "$"),
  c("AW", "Aruba", "AWG", "Aruban Florin", "ƒ"),
  c("AZ", "Azerbaijan", "AZN", "Azerbaijani Manat", "₼"),
  c("BA", "Bosnia and Herzegovina", "BAM", "Convertible Mark", "KM"),
  c("BB", "Barbados", "BBD", "Barbadian Dollar", "$"),
  c("BD", "Bangladesh", "BDT", "Bangladeshi Taka", "৳"),
  c("BG", "Bulgaria", "BGN", "Bulgarian Lev", "лв"),
  c("BH", "Bahrain", "BHD", "Bahraini Dinar", "", 3),
  c("BI", "Burundi", "BIF", "Burundian Franc", "FBu", 0),
  c("BM", "Bermuda", "BMD", "Bermudian Dollar", "$"),
  c("BN", "Brunei", "BND", "Brunei Dollar", "$"),
  c("BO", "Bolivia", "BOB", "Bolivian Boliviano", "Bs."),
  c("BR", "Brazil", "BRL", "Brazilian Real", "R$"),
  c("BS", "Bahamas", "BSD", "Bahamian Dollar", "$"),
  c("BT", "Bhutan", "BTN", "Bhutanese Ngultrum", "Nu."),
  c("BW", "Botswana", "BWP", "Botswana Pula", "P"),
  c("BY", "Belarus", "BYN", "Belarusian Ruble", "Br"),
  c("BZ", "Belize", "BZD", "Belize Dollar", "$"),
  c("CA", "Canada", "CAD", "Canadian Dollar", "$"),
  c("CD", "DR Congo", "CDF", "Congolese Franc", "FC"),
  c("CH", "Switzerland", "CHF", "Swiss Franc", "CHF"),
  c("CL", "Chile", "CLP", "Chilean Peso", "$", 0),
  c("CN", "China", "CNY", "Chinese Yuan", "¥"),
  c("CO", "Colombia", "COP", "Colombian Peso", "$"),
  c("CR", "Costa Rica", "CRC", "Costa Rican Colón", "₡"),
  c("CU", "Cuba", "CUP", "Cuban Peso", "$"),
  c("CV", "Cabo Verde", "CVE", "Cape Verdean Escudo", "$"),
  c("CZ", "Czechia", "CZK", "Czech Koruna", "Kč"),
  c("DJ", "Djibouti", "DJF", "Djiboutian Franc", "Fdj", 0),
  c("DK", "Denmark", "DKK", "Danish Krone", "kr"),
  c("DO", "Dominican Republic", "DOP", "Dominican Peso", "RD$"),
  c("DZ", "Algeria", "DZD", "Algerian Dinar", "دج"),
  c("EG", "Egypt", "EGP", "Egyptian Pound", "£"),
  c("ER", "Eritrea", "ERN", "Eritrean Nakfa", "Nfk"),
  c("ET", "Ethiopia", "ETB", "Ethiopian Birr", "Br"),
  c("EU", "European Union", "EUR", "Euro", "€"),
  c("FJ", "Fiji", "FJD", "Fijian Dollar", "$"),
  c("FK", "Falkland Islands", "FKP", "Falkland Islands Pound", "£"),
  c("GB", "United Kingdom", "GBP", "Pound Sterling", "£"),
  c("GE", "Georgia", "GEL", "Georgian Lari", "₾"),
  c("GH", "Ghana", "GHS", "Ghanaian Cedi", "₵"),
  c("GI", "Gibraltar", "GIP", "Gibraltar Pound", "£"),
  c("GM", "Gambia", "GMD", "Gambian Dalasi", "D"),
  c("GN", "Guinea", "GNF", "Guinean Franc", "FG", 0),
  c("GT", "Guatemala", "GTQ", "Guatemalan Quetzal", "Q"),
  c("GY", "Guyana", "GYD", "Guyanese Dollar", "$"),
  c("HK", "Hong Kong", "HKD", "Hong Kong Dollar", "$"),
  c("HN", "Honduras", "HNL", "Honduran Lempira", "L"),
  c("HT", "Haiti", "HTG", "Haitian Gourde", "G"),
  c("HU", "Hungary", "HUF", "Hungarian Forint", "Ft"),
  c("ID", "Indonesia", "IDR", "Indonesian Rupiah", "Rp"),
  c("IL", "Israel", "ILS", "Israeli New Shekel", "₪"),
  c("IN", "India", "INR", "Indian Rupee", "₹"),
  c("IQ", "Iraq", "IQD", "Iraqi Dinar", "", 3),
  c("IR", "Iran", "IRR", "Iranian Rial", ""),
  c("IS", "Iceland", "ISK", "Icelandic Króna", "kr", 0),
  c("JM", "Jamaica", "JMD", "Jamaican Dollar", "$"),
  c("JO", "Jordan", "JOD", "Jordanian Dinar", "", 3),
  c("JP", "Japan", "JPY", "Japanese Yen", "¥", 0),
  c("KE", "Kenya", "KES", "Kenyan Shilling", "KSh"),
  c("KG", "Kyrgyzstan", "KGS", "Kyrgyzstani Som", "с"),
  c("KH", "Cambodia", "KHR", "Cambodian Riel", "៛"),
  c("KM", "Comoros", "KMF", "Comorian Franc", "CF", 0),
  c("KP", "North Korea", "KPW", "North Korean Won", "₩"),
  c("KR", "South Korea", "KRW", "South Korean Won", "₩", 0),
  c("KW", "Kuwait", "KWD", "Kuwaiti Dinar", "", 3),
  c("KY", "Cayman Islands", "KYD", "Cayman Islands Dollar", "$"),
  c("KZ", "Kazakhstan", "KZT", "Kazakhstani Tenge", "₸"),
  c("LA", "Laos", "LAK", "Lao Kip", "₭"),
  c("LB", "Lebanon", "LBP", "Lebanese Pound", "ل.ل"),
  c("LK", "Sri Lanka", "LKR", "Sri Lankan Rupee", "Rs"),
  c("LR", "Liberia", "LRD", "Liberian Dollar", "$"),
  c("LS", "Lesotho", "LSL", "Lesotho Loti", "L"),
  c("LY", "Libya", "LYD", "Libyan Dinar", "", 3),
  c("MA", "Morocco", "MAD", "Moroccan Dirham", "د.م."),
  c("MD", "Moldova", "MDL", "Moldovan Leu", "L"),
  c("MG", "Madagascar", "MGA", "Malagasy Ariary", "Ar"),
  c("MK", "North Macedonia", "MKD", "Macedonian Denar", "ден"),
  c("MM", "Myanmar", "MMK", "Myanmar Kyat", "K"),
  c("MN", "Mongolia", "MNT", "Mongolian Tögrög", "₮"),
  c("MO", "Macao", "MOP", "Macanese Pataca", "MOP$"),
  c("MR", "Mauritania", "MRU", "Mauritanian Ouguiya", "UM"),
  c("MU", "Mauritius", "MUR", "Mauritian Rupee", "₨"),
  c("MV", "Maldives", "MVR", "Maldivian Rufiyaa", "Rf"),
  c("MW", "Malawi", "MWK", "Malawian Kwacha", "MK"),
  c("MX", "Mexico", "MXN", "Mexican Peso", "$"),
  c("MY", "Malaysia", "MYR", "Malaysian Ringgit", "RM"),
  c("MZ", "Mozambique", "MZN", "Mozambican Metical", "MT"),
  c("NA", "Namibia", "NAD", "Namibian Dollar", "$"),
  c("NG", "Nigeria", "NGN", "Nigerian Naira", "₦"),
  c("NI", "Nicaragua", "NIO", "Nicaraguan Córdoba", "C$"),
  c("NO", "Norway", "NOK", "Norwegian Krone", "kr"),
  c("NP", "Nepal", "NPR", "Nepalese Rupee", "₨"),
  c("NZ", "New Zealand", "NZD", "New Zealand Dollar", "$"),
  c("OM", "Oman", "OMR", "Omani Rial", "", 3),
  c("PA", "Panama", "PAB", "Panamanian Balboa", "B/."),
  c("PE", "Peru", "PEN", "Peruvian Sol", "S/"),
  c("PG", "Papua New Guinea", "PGK", "Papua New Guinean Kina", "K"),
  c("PH", "Philippines", "PHP", "Philippine Peso", "₱"),
  c("PK", "Pakistan", "PKR", "Pakistani Rupee", "₨"),
  c("PL", "Poland", "PLN", "Polish Złoty", "zł"),
  c("PY", "Paraguay", "PYG", "Paraguayan Guaraní", "₲", 0),
  c("QA", "Qatar", "QAR", "Qatari Riyal", "ر.ق"),
  c("RO", "Romania", "RON", "Romanian Leu", "lei"),
  c("RS", "Serbia", "RSD", "Serbian Dinar", "дин."),
  c("RU", "Russia", "RUB", "Russian Ruble", "₽"),
  c("RW", "Rwanda", "RWF", "Rwandan Franc", "FRw", 0),
  c("SB", "Solomon Islands", "SBD", "Solomon Islands Dollar", "$"),
  c("SC", "Seychelles", "SCR", "Seychellois Rupee", "₨"),
  c("SD", "Sudan", "SDG", "Sudanese Pound", ""),
  c("SE", "Sweden", "SEK", "Swedish Krona", "kr"),
  c("SG", "Singapore", "SGD", "Singapore Dollar", "$"),
  c("SH", "Saint Helena", "SHP", "Saint Helena Pound", "£"),
  c("SL", "Sierra Leone", "SLE", "Sierra Leonean Leone", "Le"),
  c("SO", "Somalia", "SOS", "Somali Shilling", "Sh"),
  c("SR", "Suriname", "SRD", "Surinamese Dollar", "$"),
  c("SS", "South Sudan", "SSP", "South Sudanese Pound", "£"),
  c("ST", "São Tomé and Príncipe", "STN", "Dobra", "Db"),
  c("SY", "Syria", "SYP", "Syrian Pound", "£"),
  c("SZ", "Eswatini", "SZL", "Swazi Lilangeni", "L"),
  c("TH", "Thailand", "THB", "Thai Baht", "฿"),
  c("TJ", "Tajikistan", "TJS", "Tajikistani Somoni", "SM"),
  c("TM", "Turkmenistan", "TMT", "Turkmenistani Manat", "m"),
  c("TN", "Tunisia", "TND", "Tunisian Dinar", "", 3),
  c("TO", "Tonga", "TOP", "Tongan Paʻanga", "T$"),
  c("TR", "Türkiye", "TRY", "Turkish Lira", "₺"),
  c("TT", "Trinidad and Tobago", "TTD", "Trinidad and Tobago Dollar", "$"),
  c("TW", "Taiwan", "TWD", "New Taiwan Dollar", "NT$"),
  c("TZ", "Tanzania", "TZS", "Tanzanian Shilling", "TSh"),
  c("UA", "Ukraine", "UAH", "Ukrainian Hryvnia", "₴"),
  c("UG", "Uganda", "UGX", "Ugandan Shilling", "USh", 0),
  c("US", "United States", "USD", "US Dollar", "$"),
  c("UY", "Uruguay", "UYU", "Uruguayan Peso", "$U"),
  c("UZ", "Uzbekistan", "UZS", "Uzbekistani Soʻm", "soʻm"),
  c("VE", "Venezuela", "VES", "Venezuelan Bolívar", "Bs"),
  c("VN", "Vietnam", "VND", "Vietnamese Đồng", "₫", 0),
  c("VU", "Vanuatu", "VUV", "Vanuatu Vatu", "VT", 0),
  c("WS", "Samoa", "WST", "Samoan Tālā", "$"),
  c("CM", "Central Africa (CEMAC)", "XAF", "Central African CFA Franc", "FCFA", 0),
  c("AG", "Eastern Caribbean (OECS)", "XCD", "East Caribbean Dollar", "$"),
  c("SN", "West Africa (UEMOA)", "XOF", "West African CFA Franc", "CFA", 0),
  c("PF", "French Polynesia", "XPF", "CFP Franc", "₣", 0),
  c("YE", "Yemen", "YER", "Yemeni Rial", ""),
  c("ZA", "South Africa", "ZAR", "South African Rand", "R"),
  c("ZM", "Zambia", "ZMW", "Zambian Kwacha", "ZK"),
  c("ZW", "Zimbabwe", "ZWG", "Zimbabwe Gold", "ZiG"),
];

const CURRENCY_BY_CODE = new Map(CURRENCIES.map((cur) => [cur.currencyCode, cur]));

export function getCurrency(code: string | null | undefined): Currency | undefined {
  if (!code) return undefined;
  return CURRENCY_BY_CODE.get(code.toUpperCase());
}

export function isValidCurrencyCode(code: string): boolean {
  return CURRENCY_BY_CODE.has(code.toUpperCase());
}

// ---------------------------------------------------------------------------------------------
// Country -> currency
//
// `CURRENCIES` holds one entry per CURRENCY, tagged with a single representative country, so a
// direct `countryCode` lookup answers 145 of the 198 countries in `COUNTRIES` and nothing for the
// other 53 — every country that shares its currency with another. The Euro's representative is the
// pseudo-code "EU", which is why Germany resolved to nothing and fell through to a USD default.
//
// This table names the 53. It is data, not logic: each entry is a country that uses a currency
// another country represents in the catalog. `verify-registration-currency.mts` asserts that every
// country in `COUNTRIES` resolves to a currency that exists in `CURRENCIES`, so adding a country
// without deciding its currency fails the suite rather than silently defaulting.
const SHARED_CURRENCY_BY_COUNTRY: Record<string, string> = {
  // Eurozone members, plus the microstates and unilateral adopters that use the euro.
  AD: "EUR", AT: "EUR", BE: "EUR", HR: "EUR", CY: "EUR", EE: "EUR", FI: "EUR", FR: "EUR",
  DE: "EUR", GR: "EUR", IE: "EUR", IT: "EUR", LV: "EUR", LT: "EUR", LU: "EUR", MT: "EUR",
  MC: "EUR", ME: "EUR", NL: "EUR", PT: "EUR", SM: "EUR", SK: "EUR", SI: "EUR", ES: "EUR",
  VA: "EUR",
  // West African CFA franc (Senegal represents XOF in the catalog).
  BJ: "XOF", BF: "XOF", CI: "XOF", GW: "XOF", ML: "XOF", NE: "XOF", TG: "XOF",
  // Central African CFA franc (Cameroon represents XAF).
  CF: "XAF", TD: "XAF", CG: "XAF", GQ: "XAF", GA: "XAF",
  // East Caribbean dollar (Antigua and Barbuda represents XCD).
  DM: "XCD", GD: "XCD", KN: "XCD", LC: "XCD", VC: "XCD",
  // Economies that use the US dollar directly.
  EC: "USD", SV: "USD", FM: "USD", MH: "USD", PW: "USD", TL: "USD",
  // Australian dollar users.
  KI: "AUD", NR: "AUD", TV: "AUD",
  // Remaining one-offs.
  LI: "CHF", // Liechtenstein uses the Swiss franc
  PS: "ILS", // Palestine uses the Israeli new shekel
};

const COUNTRY_TO_CURRENCY = new Map<string, string>([
  ...CURRENCIES.map((cur) => [cur.countryCode, cur.currencyCode] as [string, string]),
  ...Object.entries(SHARED_CURRENCY_BY_COUNTRY),
]);

/**
 * The ISO 4217 code a country uses, or undefined when the country is unknown.
 *
 * Used only to SUGGEST a base currency — registration and Business Settings both pre-fill the
 * currency picker from it and both let the user change it before anything is stored. Nothing posts
 * or persists on this value directly.
 */
export function currencyCodeForCountry(countryCode: string | null | undefined): string | undefined {
  if (!countryCode) return undefined;
  return COUNTRY_TO_CURRENCY.get(countryCode.trim().toUpperCase());
}

// Normalize a document's selected currency for storage: uppercased ISO code when valid, else null
// (null means "use the org base currency" on read). Shared by every document create/update action.
export function normalizeDocCurrency(code: string | null | undefined): string | null {
  if (!code) return null;
  const up = code.trim().toUpperCase();
  return isValidCurrencyCode(up) ? up : null;
}

// Resolve a currency code to a render-ready mark. Unknown codes degrade gracefully to a
// code-only mark (2 decimals), so a document never renders blank.
export function resolveCurrencyMark(code: string | null | undefined): CurrencyMark {
  const cur = getCurrency(code);
  if (!cur) {
    const fallback = (code || "SAR").toUpperCase();
    return { type: "text", value: "", fallback, decimalPlaces: 2, code: fallback, name: fallback };
  }
  return {
    type: cur.symbolType,
    value: cur.symbolValue,
    fallback: cur.symbolFallback,
    decimalPlaces: cur.decimalPlaces,
    code: cur.currencyCode,
    name: cur.currencyName,
  };
}

// The one shared string helper: display priority is (1) custom symbol, (2) official text symbol,
// (3) currency code. Asset symbols (SAR) have no plain-text form, so they resolve to the code for
// text-only contexts (aria labels, plain exports); the <CurrencyMark> component renders the actual
// asset visually. A configured custom symbol always wins, even over the SAR asset, in text contexts.
export function displayCurrency(mark: CurrencyMark): string {
  const custom = mark.format?.customCurrencySymbol?.trim();
  if (custom) return custom;
  if (mark.type === "text") return mark.value.trim() || mark.fallback;
  return mark.fallback;
}

// Elite ERP uses a context-based decimal rule (NOT the currency's ISO minor units):
//   - "document" — formal commercial/financial documents → ALWAYS 2 decimals (even JPY/BHD/KWD).
//   - "summary"  — dashboards, reports, analytics, overview cards → ALWAYS 0 decimals (rounded).
// This is display formatting only; the stored value keeps its two-decimal precision.
export type MoneyDisplayContext = "document" | "summary";

export function moneyDecimals(context: MoneyDisplayContext): number {
  return context === "summary" ? 0 : 2;
}

// The single shared number formatter for SUMMARY-context money (dashboards / reports / overview
// cards — always 0 decimals) and any legacy caller. Documents use the Number-Format-aware helpers
// below (formatAmount / formatRate / formatQuantity) so the org's grouping + decimals + rounding
// apply. Both round (never truncate) via toLocaleString.
export function formatMoneyNumber(amount: string | number, context: MoneyDisplayContext = "document"): string {
  const n = Number(amount) || 0;
  const d = moneyDecimals(context);
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

// ---- Number Format helpers (document display only; the shared formatting utility) ----

// Clamp the decimal-places setting to the supported 0..3 range.
export function clampDecimals(d: number | null | undefined): number {
  const n = Math.trunc(Number(d));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > 3 ? 3 : n;
}

// International grouping renders 12,345,679; Indian grouping renders 1,23,45,679. Achieved via the
// locale's own grouping rules (en-US vs en-IN) rather than hand-rolled digit chunking.
function groupingLocale(g: DigitGrouping): string {
  return g === "indian" ? "en-IN" : "en-US";
}

export function markFormat(mark?: CurrencyMark | null): NumberFormatConfig {
  return mark?.format ?? DEFAULT_NUMBER_FORMAT;
}

// A money amount (line amount, VAT, subtotal, total, discount) — grouping + configured decimals.
export function formatAmount(value: string | number, cfg: NumberFormatConfig = DEFAULT_NUMBER_FORMAT): string {
  const n = Number(value) || 0;
  const d = clampDecimals(cfg.decimalPlaces);
  return n.toLocaleString(groupingLocale(cfg.digitGrouping), { minimumFractionDigits: d, maximumFractionDigits: d });
}

// A unit rate — like an amount, but rounded to a whole number when "Round rates" is enabled.
export function formatRate(value: string | number, cfg: NumberFormatConfig = DEFAULT_NUMBER_FORMAT): string {
  const n = Number(value) || 0;
  const d = cfg.roundRates ? 0 : clampDecimals(cfg.decimalPlaces);
  return n.toLocaleString(groupingLocale(cfg.digitGrouping), { minimumFractionDigits: d, maximumFractionDigits: d });
}

// A quantity — grouped; rounded to a whole number when "Round quantities" is enabled, otherwise
// shown with up to 3 trailing decimals (trailing zeros trimmed).
export function formatQuantity(value: string | number, cfg: NumberFormatConfig = DEFAULT_NUMBER_FORMAT): string {
  const n = Number(value) || 0;
  if (cfg.roundQuantities) return Math.round(n).toLocaleString(groupingLocale(cfg.digitGrouping));
  return n.toLocaleString(groupingLocale(cfg.digitGrouping), { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

// Build the org's render-ready money mark: the official currency mark with the Number Format config
// attached. One mark then drives symbol + grouping + decimals + rounding everywhere it flows.
export function buildMoneyMark(opts: {
  currencyCode: string | null | undefined;
  customCurrencySymbol?: string | null;
  digitGrouping?: string | null;
  decimalPlaces?: number | null;
  roundQuantities?: boolean | null;
  roundRates?: boolean | null;
}): CurrencyMark {
  const base = resolveCurrencyMark(opts.currencyCode);
  const custom = (opts.customCurrencySymbol ?? "").trim();
  const format: NumberFormatConfig = {
    digitGrouping: opts.digitGrouping === "indian" ? "indian" : "international",
    decimalPlaces: clampDecimals(opts.decimalPlaces ?? 2),
    roundQuantities: !!opts.roundQuantities,
    roundRates: !!opts.roundRates,
    customCurrencySymbol: custom || null,
  };
  return { ...base, format };
}

// A plain-text symbol for a currency, or its code when the symbol is an asset (SAR) or absent — used
// in compact text UIs like the currency-picker option label. The document itself renders the real
// symbol (incl. the SAR asset) via <CurrencyMark>.
export function currencyLabelSymbol(cur: Currency): string {
  if (cur.symbolType === "text") {
    const s = cur.symbolValue.trim();
    return s || cur.currencyCode;
  }
  return cur.currencyCode; // asset symbols (SAR) show the code in text-only pickers
}

// Options for the in-document currency picker: value = ISO code, label shows the code + symbol, the
// sublabel shows country + currency name, and `keywords` lets the search match on country, currency
// name, code, and symbol (per the requirement to search by country, name, and code).
export function currencySelectOptions(): { value: string; label: string; sublabel: string; keywords: string }[] {
  return CURRENCIES.filter((c) => c.isActive).map((c) => {
    const sym = currencyLabelSymbol(c);
    return {
      value: c.currencyCode,
      label: sym === c.currencyCode ? c.currencyCode : `${c.currencyCode} · ${sym}`,
      sublabel: `${c.countryName} — ${c.currencyName}`,
      keywords: `${c.countryName} ${c.currencyName} ${c.currencyCode} ${sym}`,
    };
  });
}
