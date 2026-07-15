import "server-only";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, DEFAULT_LOCALE, type Locale } from "./dict";

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return value === "ar" ? "ar" : DEFAULT_LOCALE;
}
