import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  FolderKanban,
  FileText,
  ClipboardList,
  Receipt,
  FileCheck2,
  Truck,
  FileMinus2,
  ShoppingCart,
  FileX2,
  Building2,
  Package,
  Users,
  Landmark,
  BookOpen,
  ListTree,
  ScrollText,
  BarChart3,
  Wallet,
  UserSquare2,
  Network,
  Banknote,
  CalendarCheck2,
  CalendarClock,
  SlidersHorizontal,
  Settings,
  ShieldCheck,
  BookUser,
  ClipboardCheck,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  roles?: Array<"owner" | "admin" | "staff">;
};

export type NavGroup = {
  label: string | null;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Projects",
    items: [{ label: "Projects", href: "/projects", icon: FolderKanban }],
  },
  {
    label: "Sales",
    items: [
      { label: "Quotations", href: "/sales/quotations", icon: FileText },
      { label: "Sales Orders", href: "/sales/orders", icon: ClipboardList },
      { label: "Proforma Invoices", href: "/sales/proforma", icon: FileCheck2 },
      { label: "Invoices", href: "/sales/invoices", icon: Receipt },
      { label: "Delivery Challans", href: "/sales/delivery-challans", icon: Truck },
      { label: "Credit Notes", href: "/sales/credit-notes", icon: FileMinus2 },
    ],
  },
  {
    label: "Purchasing",
    items: [
      { label: "Purchase Orders", href: "/purchasing/orders", icon: ShoppingCart },
      { label: "Debit Notes", href: "/purchasing/debit-notes", icon: FileX2 },
      { label: "Vendors", href: "/purchasing/vendors", icon: Building2 },
    ],
  },
  {
    label: "Inventory",
    items: [{ label: "Products", href: "/inventory/products", icon: Package }],
  },
  {
    label: "Clients",
    items: [{ label: "Clients", href: "/clients", icon: Users }],
  },
  {
    label: "Finance",
    items: [
      { label: "Bank Accounts", href: "/finance/bank-accounts", icon: Landmark },
      { label: "Journal Entry", href: "/finance/journal", icon: BookOpen },
      { label: "Chart of Accounts", href: "/finance/chart-of-accounts", icon: ListTree },
      { label: "Account Ledger", href: "/finance/ledger", icon: ScrollText },
      { label: "Account Reporting", href: "/finance/reports", icon: BarChart3 },
      { label: "Payment Records", href: "/finance/payments", icon: Wallet },
      { label: "Client & Vendor Statements", href: "/finance/statements", icon: BookUser },
    ],
  },
  {
    label: "People",
    items: [
      { label: "Employees", href: "/hr/employees", icon: UserSquare2 },
      { label: "Departments", href: "/hr/departments", icon: Network },
      { label: "Payroll", href: "/hr/payroll", icon: Banknote, roles: ["owner", "admin"] },
      { label: "Attendance", href: "/hr/attendance", icon: CalendarCheck2 },
      { label: "Leave", href: "/hr/leave", icon: CalendarClock },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Preset Management", href: "/settings/presets", icon: SlidersHorizontal, roles: ["owner", "admin"] },
      { label: "Business Settings", href: "/settings/organization", icon: Settings, roles: ["owner", "admin"] },
      { label: "Security Center", href: "/settings/security", icon: ShieldCheck },
      { label: "Compliance Center", href: "/settings/compliance", icon: ClipboardCheck, roles: ["owner", "admin"] },
    ],
  },
];

export type Role = "owner" | "admin" | "staff";

/**
 * The navigation a role can see — the ONE role filter for the sidebar, the mobile drawer and the
 * command palette. It only mirrors the server-side page guards (`requireRole` on each page); it
 * grants nothing. Groups left with no visible item are dropped.
 */
export function visibleNavGroups(role: Role): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => !it.roles || it.roles.includes(role)) })).filter(
    (g) => g.items.length > 0,
  );
}

/** Active-route rule shared by every nav surface: the item's own page or any page beneath it. */
export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

// Shell titles for authenticated routes that have no navigation entry. Presentation only — these
// routes stay out of the sidebar.
const EXTRA_SHELL_TITLES: { href: string; label: string }[] = [{ href: "/recycle-bin", label: "Recycle Bin" }];

/**
 * The dictionary key of the persistent shell title for `pathname`: the most specific nav item (or
 * extra shell route) that is the page itself or one of its ancestors, so `/new`, `/[id]` and nested
 * recycle bins resolve to their parent context. Falls back to "Dashboard", as before.
 */
export function shellTitleKey(pathname: string): string {
  const candidates = [...NAV_GROUPS.flatMap((g) => g.items), ...EXTRA_SHELL_TITLES];
  let best: { href: string; label: string } | undefined;
  for (const c of candidates) if (isNavActive(pathname, c.href) && (!best || c.href.length > best.href.length)) best = c;
  return best?.label ?? "Dashboard";
}
