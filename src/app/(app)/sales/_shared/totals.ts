import { amountInWordsAr, amountInWordsEn } from "@/lib/currency/amount-words";
export type LineItemInput = {
  quantity: string;
  unitPrice: string;
  taxRatePercent: string;
};

export function computeTotals(items: LineItemInput[], discount: string | number = 0) {
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
    subtotal: subtotal.toFixed(2),
    discount: disc.toFixed(2),
    taxTotal: adjustedTax.toFixed(2),
    total: total.toFixed(2),
  };
}

export function fmt(n: string | number) {
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
