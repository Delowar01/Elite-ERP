import { toCardinal } from "n2words/ar-SA";
import { getCurrency, roundMoney } from "./currencies";
import { MONEY_NOUNS, countedPhraseAr, nounFormEn } from "./money-nouns";

/**
 * Amount in words, for the line every invoice carries above the signature.
 *
 * Numerals come from `n2words`, which implements Arabic numeral polarity (ثلاث هللات against
 * ثلاثة ريالات), the dual, and the accusative — grammar with more cases than is worth hand-rolling,
 * and which our previous implementation got wrong in all of them. The nouns come from
 * `money-nouns.ts`, because no library can supply those: they depend on the currency, and the two
 * candidates evaluated both hardcode riyal/halala or take the currency from the *locale*, which
 * would print a Kuwaiti invoice as ريالاً.
 *
 * ## The subunit is an integer taken from the decimal string
 *
 * Not `(value - whole) * 1000`. That is precisely the arithmetic that made the two libraries
 * disagree about KWD 1,250.075 — one said 7 fils, the other 8, neither said 75. Float noise in a
 * figure that appears in words on a tax document is not acceptable, so the amount is rounded once
 * through `roundMoney` (the single currency-aware rounder) and the fractional digits are then read
 * off the resulting string: "1250.075" → "075" → 75. Exact by construction, no multiplication.
 */

/** Splits a money value into whole units and an integer count of minor units, without float math. */
function splitUnits(amount: string | number, currencyCode: string): { whole: number; sub: number; negative: boolean } {
  const text = roundMoney(amount, currencyCode);
  const negative = text.startsWith("-");
  const [wholePart, fracPart = ""] = (negative ? text.slice(1) : text).split(".");
  return {
    whole: Number(wholePart),
    // "075" -> 75. Empty for 0-decimal currencies, which have no minor unit at all.
    sub: fracPart ? Number(fracPart) : 0,
    negative,
  };
}

export function amountInWordsAr(amount: string | number, currencyCode: string, currencyName: string): string {
  const code = currencyCode.toUpperCase();
  const { whole, sub } = splitUnits(amount, code);
  const nouns = MONEY_NOUNS[code];
  const divisor = 10 ** (getCurrency(code)?.decimalPlaces ?? 2);

  // Outside the GCC we have no verified nouns. Spell the whole part, state the fraction as digits,
  // and name the currency as the catalogue does — plain, but never wrong.
  if (!nouns) {
    const head = `فقط ${toCardinal(whole).replaceAll("مائة", "مئة")} ${currencyName}`;
    return sub > 0 ? `${head} و${sub}/${divisor} لا غير` : `${head} لا غير`;
  }

  // n2words mixes the two hundred-spellings — مائة for 100/300/500/700 but مئتان for 200. The
  // modern مئة is the house style, so its output is normalised once here; the substring also
  // catches خمسمائة → خمسمئة and مائة ألف → مئة ألف.
  const spell = (n: number, gender: "masculine" | "feminine") =>
    toCardinal(n, { gender }).replaceAll("مائة", "مئة");
  const majorWords = countedPhraseAr(nouns.major, whole, spell);
  if (sub <= 0 || !nouns.sub) return `فقط ${majorWords} لا غير`;
  return `فقط ${majorWords} و${countedPhraseAr(nouns.sub, sub, spell)} لا غير`;
}

export function amountInWordsEn(amount: string | number, currencyCode: string, currencyName: string): string {
  const code = currencyCode.toUpperCase();
  const { whole, sub } = splitUnits(amount, code);
  const nouns = MONEY_NOUNS[code];
  const divisor = 10 ** (getCurrency(code)?.decimalPlaces ?? 2);
  const majorWords = `${integerToWordsEn(whole)} ${nouns ? nounFormEn(nouns.major, whole) : currencyName}`;

  if (sub <= 0) return `${majorWords} Only`;
  return nouns?.sub
    ? `${majorWords} and ${integerToWordsEn(sub)} ${nounFormEn(nouns.sub, sub)} Only`
    : `${majorWords} and ${sub}/${divisor} Only`;
}

// --- English number spelling. Kept local: n2words' English is fine, but this already existed, is
// --- tested, and swapping it would change output on every existing document for no gain.
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function threeDigits(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} Hundred`); n %= 100; }
  if (n >= 20) parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10].toLowerCase()}` : ""));
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(" ");
}

export function integerToWordsEn(n: number): string {
  if (n === 0) return "Zero";
  const groups: [number, string][] = [[1_000_000_000, "Billion"], [1_000_000, "Million"], [1_000, "Thousand"], [1, ""]];
  const parts: string[] = [];
  let rest = n;
  for (const [value, label] of groups) {
    if (rest >= value) {
      const count = Math.floor(rest / value);
      parts.push(label ? `${threeDigits(count)} ${label}` : threeDigits(count));
      rest %= value;
    }
  }
  return parts.join(" ");
}
