import { Building2, CreditCard, LayoutDashboard, Package, ScrollText, Settings, Users, type LucideIcon } from "lucide-react";
import type { PlatformStringKey } from "./i18n";

// The Platform Owner console navigation (PR #11 UI spec): three groups, seven sections. Separate
// from the customer NAV_GROUPS (components/layout/nav-config.ts) — no customer route appears here
// and no platform route appears there. `phase` marks a section whose management features arrive in
// a later phase; its page is a visibly labelled, non-operational preview.

export type PlatformNavItem = { href: string; label: PlatformStringKey; icon: LucideIcon; phase?: string };
export type PlatformNavGroup = { label: PlatformStringKey; items: readonly PlatformNavItem[] };

export const PLATFORM_NAV: readonly PlatformNavGroup[] = [
  { label: "nav.workspace", items: [{ href: "/platform/dashboard", label: "nav.dashboard", icon: LayoutDashboard, phase: "PO-02" }] },
  {
    label: "nav.tenants",
    items: [
      { href: "/platform/companies", label: "nav.companies", icon: Building2, phase: "PO-02" },
      { href: "/platform/users", label: "nav.users", icon: Users, phase: "PO-03" },
      { href: "/platform/subscribers", label: "nav.subscribers", icon: CreditCard, phase: "PO-05" },
      { href: "/platform/packages", label: "nav.packages", icon: Package, phase: "PO-04" },
    ],
  },
  {
    label: "nav.governance",
    items: [
      { href: "/platform/activity", label: "nav.activity", icon: ScrollText, phase: "PO-06" },
      { href: "/platform/settings", label: "nav.settings", icon: Settings },
    ],
  },
];

/** The console's own sidebar-collapse preference — scoped to /platform, separate from the ERP's sidebar cookie. */
export const PLATFORM_SIDEBAR_COOKIE = "platform_sidebar_collapsed";

export function isPlatformNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
