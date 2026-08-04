"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Settings } from "lucide-react";
import { NAV_GROUPS } from "./nav-config";
import { buildThemeOverrideCss, isColorThemeMode, type ThemeOverrides, type ThemeOverridesByMode } from "@/lib/brand-theme";
import { Sidebar } from "./sidebar";
import { TopbarSearch } from "./topbar-search";
import { NotificationsMenu } from "./notifications-menu";
import { ThemeToggle } from "./theme-toggle";
import { FavoritesMenu } from "./favorites-menu";
import type { NotificationItem } from "@/lib/notifications";
import type { FavoriteItem } from "@/lib/favorites";
import type { Theme } from "@/lib/theme";
import type { SidebarPrefs } from "@/lib/sidebar-prefs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { logoutAction } from "@/app/(app)/actions";
import { LanguageSwitcher } from "./language-switcher";
import { t, type Locale } from "@/lib/i18n/dict";

const ROLE_LABELS: Record<SessionUser["role"], string> = { owner: "Owner", admin: "Admin", staff: "Staff" };

type SessionUser = {
  name: string;
  email: string;
  role: "owner" | "admin" | "staff";
};

export function AppShell({
  user,
  orgName,
  orgLogoUrl,
  orgPrimaryColor,
  orgAccentColor,
  orgColorThemeMode,
  orgGradientFrom,
  orgGradientTo,
  orgThemeOverrides,
  locale,
  theme,
  notifications,
  unreadCount,
  favorites,
  sidebarPrefs,
  children,
}: {
  user: SessionUser;
  orgName: string;
  orgLogoUrl: string | null;
  orgPrimaryColor: string;
  orgAccentColor: string;
  orgColorThemeMode: string;
  orgGradientFrom: string;
  orgGradientTo: string;
  // Per-appearance overrides ({ light?: {...}, dark?: {...} }); legacy flat rows migrate on read.
  orgThemeOverrides: ThemeOverridesByMode | ThemeOverrides | null;
  locale: Locale;
  theme: Theme | null;
  notifications: NotificationItem[];
  unreadCount: number;
  favorites: FavoriteItem[];
  sidebarPrefs: SidebarPrefs;
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

  // Per-org Color Theme. Gradient mode → no override (the built-in Elite gradient renders as-is).
  // Single mode → flatten the main gradient to a solid Primary + route secondary highlights to
  // Accent, with auto-contrast foregrounds. Injected server-side so colors are right before paint.
  const themeOverrideCss = buildThemeOverrideCss({
    mode: isColorThemeMode(orgColorThemeMode) ? orgColorThemeMode : "gradient",
    primaryColor: orgPrimaryColor,
    accentColor: orgAccentColor,
    gradientFrom: orgGradientFrom,
    gradientTo: orgGradientTo,
    overrides: orgThemeOverrides,
  });

  return (
    <div className="flex min-h-screen">
      <style>{themeOverrideCss}</style>
      <Sidebar
        role={user.role}
        locale={locale}
        orgName={orgName}
        orgLogoUrl={orgLogoUrl}
        initialCollapsed={sidebarPrefs.collapsed}
        initialCollapsedGroups={sidebarPrefs.collapsedGroups}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="topbar sticky top-0 z-30">
          <div className="topbar-greeting">
            <h3>{pageTitle}</h3>
            <p>{orgName}</p>
          </div>
          <div className="topbar-actions">
            <TopbarSearch locale={locale} role={user.role} />
            <LanguageSwitcher locale={locale} />
            <ThemeToggle locale={locale} initial={theme} />
            <FavoritesMenu locale={locale} favorites={favorites} currentLabel={pageTitle} />
            <NotificationsMenu locale={locale} notifications={notifications} unreadCount={unreadCount} />
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
