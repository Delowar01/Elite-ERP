import { amountInWordsAr, amountInWordsEn } from "@/lib/currency/amount-words";
import { moneyDecimals, roundMoney } from "@/lib/currency/currencies";
export type LineItemInput = {
  quantity: string;
  unitPrice: string;
  taxRatePercent: string;
};

/**
 * Document totals, rounded to the document currency's minor unit.
 *
 * `currencyCode` is required rather than optional: an optional parameter would default to two
 * decimals and silently truncate every Kuwaiti, Bahraini and Omani document, which is the defect
 * this replaces. Making callers name the currency means a new one cannot be added without deciding.
 */
export function computeTotals(
  items: LineItemInput[],
  discount: string | number,
  currencyCode: string,
) {
  let subtotal = 0;
  let taxTotal = 0;
  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unitPrice) || 0;
    const rate = Number(item.taxRatePercent) || 0;
    const line = qty * price;
    subtotal += line;
    taxTotal += line * (rate / 100);
  }
  const disc = Math.max(0, Number(discount) || 0);
  // Discount applies before VAT, matching the mockup's totals card (Subtotal - Discount, then VAT on the remainder).
  const taxable = Math.max(0, subtotal - disc);
  const taxRate = subtotal > 0 ? taxTotal / subtotal : 0;
  const adjustedTax = taxable * taxRate;
  const total = taxable + adjustedTax;
  return {
    subtotal: roundMoney(subtotal, currencyCode),
    discount: roundMoney(disc, currencyCode),
    taxTotal: roundMoney(adjustedTax, currencyCode),
    total: roundMoney(total, currencyCode),
  };
}

/**
 * Group-separated money for display, at the CURRENCY's minor unit.
 *
 * `currencyCode` is required rather than defaulted for the same reason `computeTotals`' is: a
 * default would silently print a Kuwaiti balance of 1,250.075 as 1,250.08 at the one call site
 * that forgot to pass it, which is exactly the truncation this helper exists to prevent.
 */
export function fmt(n: string | number, currencyCode: string) {
  const dp = moneyDecimals("document", currencyCode);
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}







// Amount in words for the document's currency. Defaults to Saudi Riyal (its subunit is the Halala)
// to preserve the original SAR wording exactly; other currencies use their name + a generic
// hundredths subunit ("and NN/100"), since subunit names vary per currency.
/**
 * Amount in words. Delegates to `@/lib/currency/amount-words`, which owns the Arabic grammar
 * (numerals from n2words, nouns from the reviewed table) and derives the minor unit from the
 * currency rather than assuming hundredths. Kept as a re-export so the ~10 document call sites did
 * not all have to move at once.
 */
export function amountInWords(
  amount: string | number,
  locale: "en" | "ar",
  currency: { code: string; name: string } = { code: "SAR", name: "Saudi Riyal" },
): string {
  return locale === "ar"
    ? amountInWordsAr(amount, currency.code, currency.name)
    : amountInWordsEn(amount, currency.code, currency.name);
}
