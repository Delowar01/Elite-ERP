"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Star, Settings } from "lucide-react";
import { LogoMark } from "@/components/brand/logo-mark";
import { NAV_GROUPS } from "./nav-config";
import { CommandPalette } from "./command-palette";
import { NotificationsMenu } from "./notifications-menu";
import type { NotificationItem } from "@/lib/notifications";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { logoutAction } from "@/app/(app)/actions";
import { LanguageSwitcher } from "./language-switcher";
import { t, type Locale } from "@/lib/i18n/dict";

// Routes with a built page — the rest are planned nav items for sections not yet implemented.
// Prefetching those 404s on every render since Section 1, keep this in sync as sections ship.
const BUILT_ROUTES = new Set([
  "/dashboard",
  "/clients",
  "/purchasing/vendors",
  "/inventory/products",
  "/settings/presets",
  "/settings/organization",
  "/finance/bank-accounts",
  "/finance/journal",
  "/finance/chart-of-accounts",
  "/finance/ledger",
  "/finance/reports",
  "/sales/quotations",
  "/sales/orders",
  "/sales/proforma",
  "/sales/invoices",
  "/sales/delivery-challans",
  "/sales/credit-notes",
  "/purchasing/orders",
  "/purchasing/debit-notes",
  "/finance/payments",
  "/projects",
  "/hr/employees",
  "/hr/departments",
  "/hr/attendance",
  "/hr/leave",
  "/hr/payroll",
  "/settings/security",
  "/settings/compliance",
  "/recycle-bin",
]);

const ROLE_LABELS: Record<SessionUser["role"], string> = { owner: "Owner", admin: "Admin", staff: "Staff" };

type SessionUser = {
  name: string;
  email: string;
  role: "owner" | "admin" | "staff";
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function AppShell({
  user,
  orgName,
  orgLogoUrl,
  orgPrimaryColor,
  orgAccentColor,
  locale,
  notifications,
  children,
}: {
  user: SessionUser;
  orgName: string;
  orgLogoUrl: string | null;
  orgPrimaryColor: string;
  orgAccentColor: string;
  locale: Locale;
  notifications: NotificationItem[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const activeItem = NAV_GROUPS.flatMap((g) => g.items).find(
    (it) => pathname === it.href || pathname.startsWith(it.href + "/"),
  );
  const pageTitle = t(locale, activeItem?.label ?? "Dashboard");

  // Per-org white-labeling: override the brand tokens everywhere they're used, in both themes —
  // !important because the built-in dark-mode block redefines --brand-orange with higher
  // selector specificity ([data-theme="dark"]) than a plain :root override could beat otherwise.
  const navy = HEX_COLOR.test(orgPrimaryColor) ? orgPrimaryColor : "#1B1B4E";
  const orange = HEX_COLOR.test(orgAccentColor) ? orgAccentColor : "#E87722";
  const themeOverrideCss = `
    :root { --brand-navy: ${navy} !important; --brand-orange: ${orange} !important; }
    :root[data-theme="dark"] { --brand-orange: ${orange} !important; }
    @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --brand-orange: ${orange} !important; } }
  `;

  return (
    <div className="flex min-h-screen">
      <style>{themeOverrideCss}</style>
      <aside className="sidebar">
        {orgLogoUrl ? (
          <div className="sidebar-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={orgLogoUrl} alt={orgName} className="h-9 max-w-full object-contain" />
          </div>
        ) : (
          <>
            <div className="sidebar-brand">
              <LogoMark size={30} color="var(--brand-orange)" />
              <div className="sidebar-brand-text">
                <div className="word1">ELITE</div>
                <div className="word2">INNOVATION SOLUTIONS</div>
              </div>
            </div>
            <div className="sidebar-product">Elite ERP</div>
          </>
        )}
        {NAV_GROUPS.map((group, gi) => {
          const items = group.items.filter((it) => !it.roles || it.roles.includes(user.role));
          if (items.length === 0) return null;
          return (
            <div key={gi} className="nav-group">
              {group.label && <div className="nav-divider">{t(locale, group.label)}</div>}
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={BUILT_ROUTES.has(item.href) ? undefined : false}
                    className={cn("nav-item", active && "active")}
                  >
                    <Icon className="size-4" />
                    {t(locale, item.label)}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="topbar sticky top-0 z-30">
          <div className="topbar-greeting">
            <h3>{pageTitle}</h3>
            <p>{orgName}</p>
          </div>
          <div className="topbar-actions">
            <CommandPalette locale={locale} />
            <LanguageSwitcher locale={locale} />
            <button type="button" className="topbar-icon-btn opacity-50 cursor-not-allowed" aria-label={t(locale, "Favorites")} title={t(locale, "Favorites — coming soon")} disabled>
              <Star className="size-4" />
            </button>
            <NotificationsMenu locale={locale} notifications={notifications} />
            <Link href="/settings/organization" className="topbar-icon-btn" aria-label={t(locale, "Business Settings")}>
              <Settings className="size-4" />
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger className="topbar-profile outline-none">
                <div className="text-right rtl:text-left hidden sm:block">
                  <div className="topbar-profile-name">{user.name}</div>
                  <div className="topbar-profile-role">{t(locale, ROLE_LABELS[user.role])}</div>
                </div>
                <Avatar className="size-8">
                  <AvatarFallback
                    className="text-[11px]"
                    style={{ background: "linear-gradient(135deg, var(--brand-orange-light), var(--brand-orange))" }}
                  >
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{user.name}</DropdownMenuLabel>
                <div className="px-3 pb-2 -mt-1 text-xs text-ink-faint">{user.email}</div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => logoutAction()} className="cursor-pointer">
                  <LogOut className="size-3.5" /> {t(locale, "Log out")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 p-7 bg-canvas">{children}</main>
      </div>
    </div>
  );
}
