"use server";

import { cookies } from "next/headers";
import { THEME_COOKIE, type Theme } from "./theme";

// Persist the user's explicit light/dark choice for one year. The client applies the
// data-theme attribute immediately for instant feedback; this just makes it stick across
// reloads and sessions, so no revalidate is needed.
export async function setThemeAction(theme: Theme) {
  const store = await cookies();
  store.set(THEME_COOKIE, theme, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}
