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

const ONES_EN = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS_EN = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function threeDigitsEn(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES_EN[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS_EN[Math.floor(n / 10)] + (n % 10 ? `-${ONES_EN[n % 10].toLowerCase()}` : ""));
  } else if (n > 0) {
    parts.push(ONES_EN[n]);
  }
  return parts.join(" ");
}

function integerToWordsEn(n: number): string {
  if (n === 0) return "Zero";
  const groups: [number, string][] = [
    [1_000_000_000, "Billion"],
    [1_000_000, "Million"],
    [1_000, "Thousand"],
    [1, ""],
  ];
  const parts: string[] = [];
  for (const [value, label] of groups) {
    if (n >= value) {
      const count = Math.floor(n / value);
      parts.push(label ? `${threeDigitsEn(count)} ${label}` : threeDigitsEn(count));
      n %= value;
    }
  }
  return parts.join(" ");
}

const ONES_AR = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة",
  "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const TENS_AR = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const HUNDREDS_AR = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];

function threeDigitsAr(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(HUNDREDS_AR[Math.floor(n / 100)]);
    n %= 100;
  }
  if (n >= 20) {
    const tens = TENS_AR[Math.floor(n / 10)];
    const ones = n % 10;
    parts.push(ones ? `${ONES_AR[ones]} و${tens}` : tens);
  } else if (n > 0) {
    parts.push(ONES_AR[n]);
  }
  return parts.join(" و");
}

function integerToWordsAr(n: number): string {
  if (n === 0) return "صفر";
  const groups: [number, string, string][] = [
    [1_000_000_000, "مليار", "مليارات"],
    [1_000_000, "مليون", "ملايين"],
    [1_000, "ألف", "آلاف"],
    [1, "", ""],
  ];
  const parts: string[] = [];
  for (const [value, singular, plural] of groups) {
    if (n >= value) {
      const count = Math.floor(n / value);
      if (!singular) {
        parts.push(threeDigitsAr(count));
      } else if (count === 1) {
        parts.push(singular);
      } else if (count === 2) {
        parts.push(singular === "ألف" ? "ألفان" : singular === "مليون" ? "مليونان" : "مليارتان");
      } else if (count <= 10) {
        parts.push(`${threeDigitsAr(count)} ${plural}`);
      } else {
        parts.push(`${threeDigitsAr(count)} ${singular}`);
      }
      n %= value;
    }
  }
  return parts.join(" و");
}

export function amountInWords(sar: string | number, locale: "en" | "ar"): string {
  const value = Number(sar) || 0;
  const whole = Math.floor(value);
  const halalas = Math.round((value - whole) * 100);
  if (locale === "ar") {
    const wholeWords = integerToWordsAr(whole);
    const base = `فقط ${wholeWords} ريال سعودي`;
    return halalas > 0 ? `${base} و${integerToWordsAr(halalas)} هللة لا غير` : `${base} لا غير`;
  }
  const wholeWords = integerToWordsEn(whole);
  const base = `${wholeWords} Saudi Riyal`;
  return halalas > 0 ? `${base} and ${integerToWordsEn(halalas)} Halalas Only` : `${base} Only`;
}
