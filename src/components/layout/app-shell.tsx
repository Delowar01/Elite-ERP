"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Search, Star, Bell, Settings, Command } from "lucide-react";
import { LogoMark } from "@/components/brand/logo-mark";
import { NAV_GROUPS } from "./nav-config";
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
  children,
}: {
  user: SessionUser;
  orgName: string;
  orgLogoUrl: string | null;
  orgPrimaryColor: string;
  orgAccentColor: string;
  locale: Locale;
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
      <aside
        className="w-60 shrink-0 flex flex-col gap-[18px] pt-5 px-3.5 pb-3.5 overflow-y-auto border-r"
        style={{ background: "var(--sidebar-bg)", borderColor: "var(--sidebar-border)" }}
      >
        <div>
          {orgLogoUrl ? (
            <div className="flex items-center px-1.5 pb-3 mb-1 border-b" style={{ borderColor: "var(--sidebar-border)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={orgLogoUrl} alt={orgName} className="h-9 max-w-full object-contain" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5 px-1.5 pb-3 mb-1 border-b" style={{ borderColor: "var(--sidebar-border)" }}>
                <LogoMark size={30} color="var(--brand-orange)" />
                <div>
                  <div
                    className="font-display font-extrabold text-[14px] tracking-tight leading-tight"
                    style={{ color: "var(--sidebar-ink)" }}
                  >
                    ELITE
                  </div>
                  <div className="font-medium text-[7.5px] tracking-[0.15em] text-ink-faint">INNOVATION SOLUTIONS</div>
                </div>
              </div>
              <div className="font-display font-extrabold text-[16px] px-1.5 pb-2" style={{ color: "var(--sidebar-ink)" }}>
                Elite ERP
              </div>
            </>
          )}
        </div>
        <nav className="flex flex-col gap-4">
          {NAV_GROUPS.map((group, gi) => {
            const items = group.items.filter((it) => !it.roles || it.roles.includes(user.role));
            if (items.length === 0) return null;
            return (
              <div key={gi} className="flex flex-col gap-0.5">
                {group.label && (
                  <div
                    className="px-3 pb-1 text-[10.5px] font-bold uppercase tracking-wider"
                    style={{ color: "var(--sidebar-ink-muted)" }}
                  >
                    {t(locale, group.label)}
                  </div>
                )}
                {items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(item.href + "/");
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch={BUILT_ROUTES.has(item.href) ? undefined : false}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[12.8px] font-medium transition-colors",
                        !active && "hover:bg-canvas hover:text-ink",
                      )}
                      style={{
                        background: active ? "var(--sidebar-active-bg)" : undefined,
                        color: active ? "#fff" : "var(--sidebar-ink-muted)",
                        boxShadow: active ? "0 4px 12px -3px rgba(232,119,34,0.5)" : undefined,
                      }}
                    >
                      <Icon className="size-4 shrink-0" />
                      {t(locale, item.label)}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 shrink-0 flex items-center justify-between gap-5 px-6.5 border-b border-line bg-surface/70 backdrop-blur-md sticky top-0 z-30">
          <div className="min-w-0">
            <h3 className="text-[17px] font-bold truncate">{pageTitle}</h3>
            <p className="text-[12px] text-ink-muted truncate">{orgName}</p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="hidden lg:flex items-center gap-2 h-[38px] w-[260px] rounded-[10px] bg-canvas border border-line px-3 text-ink-faint text-[12.5px]">
              <Search className="size-[15px] shrink-0" />
              <span className="truncate">{t(locale, "Search anything…")}</span>
            </div>
            <button
              type="button"
              className="hidden md:inline-flex items-center gap-1.5 h-9 rounded-[9px] border border-line-strong bg-surface px-3 text-[11.5px] text-ink-muted"
            >
              <Command className="size-3" />
              <span className="font-mono text-[10.5px] border border-line-strong rounded-[5px] px-1.5">K</span>
            </button>
            <LanguageSwitcher locale={locale} />
            <button
              type="button"
              className="w-9 h-9 rounded-[10px] border border-line bg-surface flex items-center justify-center text-ink-muted hover:bg-canvas hover:border-line-strong hover:text-ink transition-colors"
              aria-label={t(locale, "Favorites")}
            >
              <Star className="size-4" />
            </button>
            <button
              type="button"
              className="relative w-9 h-9 rounded-[10px] border border-line bg-surface flex items-center justify-center text-ink-muted hover:bg-canvas hover:border-line-strong hover:text-ink transition-colors"
              aria-label={t(locale, "Notifications")}
            >
              <Bell className="size-4" />
              <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-[3px] rounded-full bg-danger text-white text-[9px] font-bold flex items-center justify-center">
                4
              </span>
            </button>
            <Link
              href="/settings/organization"
              className="w-9 h-9 rounded-[10px] border border-line bg-surface flex items-center justify-center text-ink-muted hover:bg-canvas hover:border-line-strong hover:text-ink transition-colors"
              aria-label={t(locale, "Business Settings")}
            >
              <Settings className="size-4" />
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2.5 outline-none rounded-[10px] pl-3 py-1 -my-1 border-l border-line hover:bg-canvas transition-colors">
                <div className="text-right rtl:text-left hidden sm:block">
                  <div className="text-[12.5px] font-bold leading-tight">{user.name}</div>
                  <div className="text-[10.5px] text-ink-faint leading-tight">{t(locale, ROLE_LABELS[user.role])}</div>
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
