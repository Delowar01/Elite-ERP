import "server-only";
import { cookies } from "next/headers";
import { SIDEBAR_COLLAPSED_COOKIE, SIDEBAR_GROUPS_COOKIE } from "./sidebar-cookies";

// Sidebar layout preferences, read server-side so the correct collapsed state is rendered on the
// first paint (no flash on refresh), the same approach used for the theme cookie. The client writes
// these cookies directly (a pure UI preference — no server action needed).

export type SidebarPrefs = { collapsed: boolean; collapsedGroups: string[] };

export async function getSidebarPrefs(): Promise<SidebarPrefs> {
  const store = await cookies();
  const collapsed = store.get(SIDEBAR_COLLAPSED_COOKIE)?.value === "1";
  const raw = store.get(SIDEBAR_GROUPS_COOKIE)?.value;
  let collapsedGroups: string[] = [];
  if (raw) {
    try {
      collapsedGroups = decodeURIComponent(raw)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      collapsedGroups = [];
    }
  }
  return { collapsed, collapsedGroups };
}
