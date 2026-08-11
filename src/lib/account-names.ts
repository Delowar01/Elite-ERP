import { DEFAULT_CHART_OF_ACCOUNTS } from "@/db/schema/accounting";
import type { Locale } from "./i18n/dict";

/**
 * Arabic names for the seeded chart of accounts.
 *
 * Kept in the display layer rather than as a column on the table, for three reasons:
 *
 *  - Nothing needs it stored. Every lookup in the app is by `code`
 *    (eq(accountsTable.code, …), orderBy(code)); `name` appears only in select() projections. So
 *    the name is display-only already, and translating it cannot affect posting, grouping or
 *    sorting. Codes are language-neutral and were doing that work before this change.
 *  - A column would need backfilling for every existing org, and would then drift the moment
 *    someone renames an account.
 *  - User-created accounts get a correct fallback for free: no entry, so their stored name is
 *    shown as-is in both languages, which is the only sensible thing to do with a name a person
 *    typed themselves.
 *
 * A renamed system account also keeps its new name. The translation only applies while the stored
 * name is still the seeded English one — someone who renames "Cash" to "Petty Cash" means it, and
 * should not have Arabic quietly override them.
 */

/** code -> native Arabic name, for the seeded accounts only. */
const ARABIC_BY_CODE: Record<string, string> = {
  "1000": "النقد",
  "1100": "الذمم المدينة",
  "1200": "المخزون",
  "2000": "الذمم الدائنة",
  "2100": "ضريبة القيمة المضافة المستحقة",
  "2200": "الرواتب المستحقة",
  "3000": "حقوق الملكية",
  "4000": "إيرادات المبيعات",
  "4900": "أرباح وخسائر فروق العملة",
  "5000": "تكلفة البضاعة المباعة",
  "5100": "المصروفات التشغيلية",
  "5200": "مصروف الرواتب",
};

/** The seeded English name per code, used to detect whether an account has been renamed. */
const SEEDED_EN_BY_CODE: Record<string, string> = Object.fromEntries(
  DEFAULT_CHART_OF_ACCOUNTS.map((a) => [a.code, a.name]),
);

/**
 * The account name to display. Falls back to the stored name whenever there is nothing better:
 * a user-created account, a renamed system account, an unknown code, or English.
 */
export function accountName(
  locale: Locale,
  account: { code: string; name: string },
): string {
  if (locale !== "ar") return account.name;
  const ar = ARABIC_BY_CODE[account.code];
  if (!ar) return account.name; // user-created, or a code we do not seed
  if (SEEDED_EN_BY_CODE[account.code] !== account.name) return account.name; // renamed — respect it
  return ar;
}

/** "1100 · Accounts Receivable" / "1100 · الذمم المدينة" — the code first, so it reads the same either way. */
export function accountLabel(locale: Locale, account: { code: string; name: string }): string {
  return `${account.code} · ${accountName(locale, account)}`;
}

/** Every seeded code that carries a translation — used by the verification. */
export const TRANSLATED_ACCOUNT_CODES = Object.keys(ARABIC_BY_CODE);
