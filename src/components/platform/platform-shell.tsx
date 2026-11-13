"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { BrandMark } from "@/components/layout/brand-mark";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import type { Locale } from "@/lib/i18n/dict";
import type { Theme } from "@/lib/theme";
import { pt } from "./i18n";
import { PlatformAccountMenu } from "./platform-account-menu";
import { PlatformMobileNav } from "./platform-mobile-nav";
import { PlatformSidebar } from "./platform-sidebar";

// The Platform Owner console shell (PO-01B) — a separate component from the customer AppShell, built
// on the production shell's classes and tokens (dark 56px header, light sidebar 256/68px, the
// drawer below 768px) so it reads as the same product without changing any shared component or
// stylesheet. It carries no organization branding, no tenant data and no customer navigation.
export function PlatformShell({
  operator,
  locale,
  theme,
  sidebarCollapsed,
  children,
}: {
  operator: { name: string; email: string };
  locale: Locale;
  theme: Theme | null;
  sidebarCollapsed: boolean;
  children: React.ReactNode;
}) {
  const utilities = (
    <>
      <ThemeToggle locale={locale} initial={theme} />
      <PlatformAccountMenu operator={operator} locale={locale} />
    </>
  );
  // Search arrives with company management (PO-02): the entry point is shown, visibly marked as a
  // preview, and performs no query.
  const searchPreview = () => toast.info(pt(locale, "shell.searchPreview"));

  return (
    <>
      <a href="#main-content" className="skip-link">
        {pt(locale, "shell.skip")}
      </a>
      <div className="app-frame platform-frame">
        <header className="topbar">
          <PlatformMobileNav locale={locale} utilities={utilities} />
          <Link href="/platform/dashboard" className="topbar-brand" aria-label={`${pt(locale, "brand.console")} — ${pt(locale, "nav.dashboard")}`}>
            <BrandMark orgLogoUrl={null} />
            <span className="topbar-brand-name">Elite ERP</span>
            <span className="platform-console-tag">{pt(locale, "brand.product")}</span>
          </Link>
          <div className="topbar-search-slot">
            <button type="button" className="topbar-search platform-search-preview" onClick={searchPreview} aria-label={`${pt(locale, "shell.search")} (${pt(locale, "common.preview")})`}>
              <Search className="size-[15px] shrink-0" aria-hidden />
              <span className="truncate">{pt(locale, "shell.search")}</span>
              <span className="platform-preview-chip" aria-hidden>{pt(locale, "common.preview")}</span>
            </button>
            <button type="button" className="topbar-icon-btn topbar-search-icon" onClick={searchPreview} aria-label={`${pt(locale, "shell.search")} (${pt(locale, "common.preview")})`} title={pt(locale, "shell.searchPreview")}>
              <Search className="size-4" aria-hidden />
            </button>
          </div>
          <div className="topbar-actions">
            <LanguageSwitcher locale={locale} />
            <div className="topbar-utilities">{utilities}</div>
          </div>
        </header>
        <div className="app-body">
          <PlatformSidebar locale={locale} initialCollapsed={sidebarCollapsed} />
          <main id="main-content" tabIndex={-1} className="app-main">
            <div className="app-main-inner">{children}</div>
          </main>
        </div>
      </div>
    </>
  );
}
