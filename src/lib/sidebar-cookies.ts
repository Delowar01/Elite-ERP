// Cookie names for sidebar layout preferences. Kept in a plain module (no "server-only") so both the
// server reader (sidebar-prefs.ts) and the client writer (sidebar.tsx) can share the exact names.
export const SIDEBAR_COLLAPSED_COOKIE = "sidebar_collapsed";
export const SIDEBAR_GROUPS_COOKIE = "sidebar_groups"; // comma-separated list of collapsed group labels
