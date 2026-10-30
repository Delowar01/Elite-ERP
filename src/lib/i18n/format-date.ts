import type { Locale } from "./dict";

/**
 * Display dates that read the same wherever they are formatted (DEV-UI-01.7).
 *
 * Left to its defaults, a date formatter picks its own calendar, digits and time zone: "ar-SA"
 * alone means the Hijri calendar in the browser (and, with newer locale data, the Gregorian one on
 * the server) and Arabic-Indic digits, and the zone is the host's on the server and the user's in
 * the browser. So all three are written out here, once:
 *
 *  - English is `en-US`; Arabic is `ar-SA-u-ca-gregory-nu-latn` — Arabic month names on the
 *    Gregorian calendar with Western digits, matching the rest of the app (P0's money digits);
 *  - the time zone is UTC, named explicitly: the ERP has no organisation time zone yet, and when it
 *    gains one it replaces UTC here, in one place.
 *
 * Callers choose one of three shapes — the ones the planned consumers need — and nothing else. No
 * option reaches the locale, calendar, digits or zone. Each shape reads identically in Node and in
 * Chromium, so a client component can render it on both sides of hydration.
 *
 *   "date"       Jun 15, 2026              15 يونيو 2026            the attendance date pill
 *   "dateTime"   Jun 15, 2026, 09:00 AM    15 يونيو 2026، 09:00 ص   the dashboard's recent activity
 *   "monthYear"  June 2026                 يونيو 2026               the payroll period title
 *
 * docs/ui/dev-ui-01-7/c0-foundations-and-guardrails.md
 */
export type DisplayDateStyle = "date" | "dateTime" | "monthYear";

const FORMATS: Record<Locale, Record<DisplayDateStyle, Intl.DateTimeFormat>> = {
  en: {
    date: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }),
    dateTime: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }),
    monthYear: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
  },
  ar: {
    date: new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }),
    dateTime: new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }),
    monthYear: new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { month: "long", year: "numeric", timeZone: "UTC" }),
  },
};

/** `value` (a Date, or an ISO string) in the given app locale and shape; "" when it is not a valid date. */
export function formatDisplayDate(value: Date | string, locale: Locale, style: DisplayDateStyle): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "";
  return FORMATS[locale === "ar" ? "ar" : "en"][style].format(d);
}
