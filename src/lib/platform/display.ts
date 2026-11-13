import "server-only";
import type { Locale } from "@/lib/i18n/dict";

// ---------------------------------------------------------------------------------------------
// Server-side display formatting for the console's company screens (PO-02B), matching Settings:
// Riyadh time (Asia/Riyadh), Gregorian calendar, Western digits, in both languages. Pages format
// on the server and hand finished text to components, so a client component never formats a date
// or a number (no hydration drift; verify:date-timezone and verify:number-locale).
// ---------------------------------------------------------------------------------------------

const ZONE = "Asia/Riyadh";
const TAGS: Record<Locale, string> = { en: "en-US", ar: "ar-SA-u-ca-gregory-nu-latn" };

const DATE: Record<Locale, Intl.DateTimeFormat> = {
  en: new Intl.DateTimeFormat(TAGS.en, { day: "numeric", month: "short", year: "numeric", timeZone: ZONE }),
  ar: new Intl.DateTimeFormat(TAGS.ar, { day: "numeric", month: "short", year: "numeric", timeZone: ZONE }),
};
const DATE_TIME: Record<Locale, Intl.DateTimeFormat> = {
  en: new Intl.DateTimeFormat(TAGS.en, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: ZONE }),
  ar: new Intl.DateTimeFormat(TAGS.ar, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: ZONE }),
};
const MONTH: Record<Locale, Intl.DateTimeFormat> = {
  en: new Intl.DateTimeFormat(TAGS.en, { month: "short", year: "numeric", timeZone: ZONE }),
  ar: new Intl.DateTimeFormat(TAGS.ar, { month: "short", year: "numeric", timeZone: ZONE }),
};
const COUNT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const lang = (locale: Locale): Locale => (locale === "ar" ? "ar" : "en");

export function formatPlatformDate(date: Date, locale: Locale): string {
  return DATE[lang(locale)].format(date);
}

export function formatPlatformDateTime(date: Date, locale: Locale): string {
  return DATE_TIME[lang(locale)].format(date);
}

/** "2026-11" → "Nov 2026" / "نوفمبر 2026" (mid-month, so no zone can move it across a boundary). */
export function formatPlatformMonth(key: string, locale: Locale): string {
  const [year, month] = key.split("-").map(Number);
  return MONTH[lang(locale)].format(new Date(Date.UTC(year, month - 1, 15, 12)));
}

/** Whole counts with Western digits and "," grouping in both languages. */
export function formatPlatformCount(value: number): string {
  return COUNT.format(value);
}
