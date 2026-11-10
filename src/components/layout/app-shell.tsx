"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Settings } from "lucide-react";
import { shellTitleKey, type Role } from "./nav-config";
import { BrandMark } from "./brand-mark";
import { buildThemeOverrideCss, isColorThemeMode, type ThemeOverrides, type ThemeOverridesByMode } from "@/lib/brand-theme";
import { Sidebar } from "./sidebar";
import { MobileNav } from "./mobile-nav";
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
  role: Role;
};

// Mirrors the server guard on /settings/organization — requireRole("owner", "admin") — so the gear is
// never shown to someone the page would bounce (D-01.3-D). Presentation only; the guard is unchanged.
const SETTINGS_ROLES: readonly Role[] = ["owner", "admin"];

function AccountMenu({ user, locale, initials }: { user: SessionUser; locale: Locale; initials: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="topbar-profile" aria-label={user.name}>
        <span className="topbar-profile-text">
          <span className="topbar-profile-name">{user.name}</span>
          <span className="topbar-profile-role">{t(locale, ROLE_LABELS[user.role])}</span>
        </span>
        <Avatar className="size-8 font-semibold">
          {/* Solid fallback (D-04 solid-only) — no gradient. */}
          <AvatarFallback className="topbar-avatar">{initials}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{user.name}</DropdownMenuLabel>
        <div className="px-3 pb-2 -mt-1 text-xs text-ink-faint">{user.email}</div>
        <div className="px-3 pb-2 text-xs text-ink-faint">{t(locale, ROLE_LABELS[user.role])}</div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logoutAction()} className="cursor-pointer">
          <LogOut className="size-3.5" aria-hidden /> {t(locale, "Log out")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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

  // The contextual title of the current page (never an <h1>): the label Favorites stores for it. The
  // LCP header shows the organization, not a page title — the page's own <h1> names the page.
  const pageTitle = t(locale, shellTitleKey(pathname));

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

  const canOpenSettings = SETTINGS_ROLES.includes(user.role);
  // The utilities: in the top bar from 640px up; below that, in the navigation drawer (shell.css
  // decides which copy is displayed, so a hidden copy is never focusable).
  const utilities = (
    <>
      <ThemeToggle locale={locale} initial={theme} />
      <FavoritesMenu locale={locale} favorites={favorites} currentLabel={pageTitle} />
      <NotificationsMenu locale={locale} notifications={notifications} unreadCount={unreadCount} />
      {canOpenSettings && (
        <Link href="/settings/organization" className="topbar-icon-btn" aria-label={t(locale, "Business Settings")} title={t(locale, "Business Settings")}>
          <Settings className="size-4" aria-hidden />
        </Link>
      )}
      <AccountMenu user={user} locale={locale} initials={initials} />
    </>
  );

  return (
    <>
      <a href="#main-content" className="skip-link">
        {t(locale, "Skip to main content")}
      </a>
      {/* LCP shell: a dark 56px header across the full width, then the light sidebar and the page. The
          document scrolls; the header is sticky and the sidebar is its own sticky, scrolling column. */}
      <div className="app-frame">
        <style>{themeOverrideCss}</style>
        <header className="topbar">
          <MobileNav role={user.role} locale={locale} orgName={orgName} orgLogoUrl={orgLogoUrl} utilities={utilities} />
          {/* The organization identity (LCP tenant slot): its logo on a white plate, or the Elite mark,
              and its name. Not a heading — the page owns its <h1>. */}
          <Link href="/dashboard" className="topbar-brand" aria-label={`${orgName} — ${t(locale, "Dashboard")}`}>
            <BrandMark orgLogoUrl={orgLogoUrl} />
            <span className="topbar-brand-name" dir="auto">{orgName}</span>
          </Link>
          <div className="topbar-search-slot">
            <TopbarSearch locale={locale} role={user.role} />
          </div>
          <div className="topbar-actions">
            <LanguageSwitcher locale={locale} />
            <div className="topbar-utilities">{utilities}</div>
          </div>
        </header>
        <div className="app-body">
          <Sidebar
            role={user.role}
            locale={locale}
            orgName={orgName}
            orgLogoUrl={orgLogoUrl}
            initialCollapsed={sidebarPrefs.collapsed}
            initialCollapsedGroups={sidebarPrefs.collapsedGroups}
          />
          <main id="main-content" tabIndex={-1} className="app-main">
            <div className="app-main-inner">{children}</div>
          </main>
        </div>
      </div>
    </>
  );
}
