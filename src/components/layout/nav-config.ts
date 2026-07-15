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
  ReceiptText,
  UserSquare2,
  Network,
  Banknote,
  CalendarCheck2,
  CalendarClock,
  SlidersHorizontal,
  Settings,
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
      { label: "Expenses", href: "/finance/expenses", icon: ReceiptText },
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
    ],
  },
];
