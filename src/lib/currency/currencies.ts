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

// A resolved, render-ready mark. Kept small so it can cross the server→client boundary cheaply.
export type CurrencyMark = {
  type: CurrencySymbolType;
  value: string;
  fallback: string;
  decimalPlaces: number;
  code: string;
  name: string;
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

// The one shared string helper: a text symbol when available, otherwise the code. Asset symbols
// have no plain-text form, so they resolve to the code for text-only contexts (aria labels, plain
// exports); the <CurrencyMark> component renders the actual asset visually.
export function displayCurrency(mark: CurrencyMark): string {
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

// The single shared number formatter. Rounds (never truncates) via toLocaleString.
export function formatMoneyNumber(amount: string | number, context: MoneyDisplayContext = "document"): string {
  const n = Number(amount) || 0;
  const d = moneyDecimals(context);
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}
