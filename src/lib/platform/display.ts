import "server-only";
import type { Locale } from "@/lib/i18n/dict";
import { isCustomerSeatEnforcementEnabled } from "./flags";

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
// Counts are whole numbers (count(*)::int), so the default options print no fraction; money never
// goes through this formatter (verify:money-precision forbids fixed fraction-digit literals in src/).
const COUNT = new Intl.NumberFormat("en-US");

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

// ---- PO-03D: how a company's seats read (display only — the enforcing check is seat-enforcement.ts) -----------------

/** Who occupies the seats, as finished numbers: "2 users + 1 pending invitation = 3 of 3 seats occupied". */
export type SeatBreakdownView = { users: number; usersText: string; pending: number; pendingText: string; occupiedText: string; seats: number | null; seatsText: string | null };

type SeatFacts = { users: { total: number }; pendingInvitations: number; occupied: number; enforced: boolean; allowance: { state: "assigned"; seats: number } | { state: "none" } | { state: "not_installed" } };

export function seatBreakdownView(s: SeatFacts): SeatBreakdownView {
  const seats = s.allowance.state === "assigned" ? s.allowance.seats : null;
  return {
    users: s.users.total,
    usersText: formatPlatformCount(s.users.total),
    pending: s.pendingInvitations,
    pendingText: formatPlatformCount(s.pendingInvitations),
    occupiedText: formatPlatformCount(s.occupied),
    seats,
    seatsText: seats === null ? null : formatPlatformCount(seats),
  };
}

/**
 * What the "User limit" row says. "enforced" ONLY while enforcement is on AND the company has a current subscription
 * (the accounting's own `enforced`); with enforcement on, a company without one cannot be invited into, and an unreadable
 * foundation refuses every addition. Off, the limit is shown only.
 */
export type SeatLimitState = "enforced" | "subscription_required" | "unavailable" | "not_enforced";
export function seatLimitState(s: SeatFacts | null): SeatLimitState {
  if (s?.enforced) return "enforced";
  if (!isCustomerSeatEnforcementEnabled()) return "not_enforced";
  if (!s || s.allowance.state === "not_installed") return "unavailable";
  return s.allowance.state === "none" ? "subscription_required" : "not_enforced";
}
