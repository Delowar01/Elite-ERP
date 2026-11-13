"use client";

import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { BrandMark } from "@/components/layout/brand-mark";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n/dict";
import { pt } from "./i18n";
import { PLATFORM_SIDEBAR_COOKIE } from "./nav-config";
import { PlatformNavList } from "./platform-nav-list";

// Same breakpoint model as the ERP shell (≥1024 expanded/mini by preference, 768–1023 mini rail,
// <768 the drawer); the production shell.css enforces the geometry from the first paint.
const TABLET_RAIL_QUERY = "(min-width: 768px) and (max-width: 1023.98px)";

function useTabletRail(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(TABLET_RAIL_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(TABLET_RAIL_QUERY).matches,
    () => false,
  );
}

export function PlatformSidebar({ locale, initialCollapsed }: { locale: Locale; initialCollapsed: boolean }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const tabletRail = useTabletRail();
  const rail = collapsed || tabletRail;

  function toggleSidebar() {
    setCollapsed((c) => {
      const next = !c;
      document.cookie = `${PLATFORM_SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/platform; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
      return next;
    });
  }

  function toggleGroup(label: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  const rtl = locale === "ar";
  const ToggleIcon = collapsed ? (rtl ? ChevronsLeft : ChevronsRight) : rtl ? ChevronsRight : ChevronsLeft;
  const toggleLabel = pt(locale, collapsed ? "shell.expandSidebar" : "shell.collapseSidebar");

  return (
    <aside className={cn("sidebar", collapsed && "collapsed")} data-rail={rail ? "true" : undefined}>
      <PlatformNavList locale={locale} pathname={pathname} rail={rail} collapsedGroups={collapsedGroups} onToggleGroup={toggleGroup} idPrefix="sidebar" />
      <div className="sidebar-footer">
        <div className="sidebar-org" title={rail ? pt(locale, "brand.console") : undefined}>
          <BrandMark orgLogoUrl={null} size="lg" />
          {!rail && (
            <div className="sidebar-org-text">
              <div className="sidebar-org-name">Elite ERP</div>
              <div className="sidebar-org-product">{pt(locale, "brand.product")}</div>
            </div>
          )}
        </div>
        <button type="button" className="sidebar-toggle" onClick={toggleSidebar} aria-label={toggleLabel} title={toggleLabel} aria-expanded={!collapsed}>
          <ToggleIcon className="size-4" aria-hidden />
          {!rail && <span className="sidebar-toggle-label">{pt(locale, collapsed ? "shell.expand" : "shell.collapse")}</span>}
        </button>
      </div>
    </aside>
  );
}
