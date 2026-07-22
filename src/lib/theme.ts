import "server-only";
import { cookies } from "next/headers";

export const THEME_COOKIE = "theme";
export type Theme = "light" | "dark";

// Explicit user choice only. When no cookie is set we return null and render nothing on
// <html>, so the app follows the OS preference via the prefers-color-scheme media query
// (same three-way scheme the dark-mode CSS blocks already implement).
export async function getTheme(): Promise<Theme | null> {
  const store = await cookies();
  const v = store.get(THEME_COOKIE)?.value;
  return v === "dark" || v === "light" ? v : null;
}
